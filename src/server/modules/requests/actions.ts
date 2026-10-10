"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import {
  deliverables, documents, priceQuoteHistory, recommendations, requestNotes, serviceRequests, services, userRoles, roles, users, waqfs, workflowTemplates,
} from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { assignableRoleKeys, loadRequestCtx, memberCan } from "./access";
import { flagMap, readSetting, serviceAvailability, type License } from "./catalog";
import { advance, createStages, logEvent, opsManagerIds, transition, type ActCtx } from "./engine";
import { evaluateConflict, HOLD_PARTY_LABEL, STATUS_LABEL, type RequestStatus } from "./workflow";

const uuid = z.string().uuid("قيمة غير صالحة.");
const STATUSES = Object.keys(STATUS_LABEL) as [RequestStatus, ...RequestStatus[]];
const revalidateReq = (id: string) => [`/app/requests/${id}`, `/admin/requests/${id}`, "/app/requests", "/admin/requests"];

// ───────────────────────── Client: create ─────────────────────────

const createSchema = z.object({
  service: z.string().min(2, "اختر الخدمة."),
  waqf: z.string().optional().default(""),
  details: z.string().trim().min(10, "صف طلبك في 10 أحرف على الأقل.").max(4000, "النص طويل جدًا (4000 حرف كحد أقصى)."),
  priority: z.enum(["low", "normal", "high", "urgent"], { message: "اختر الأولوية." }),
  contact: z.enum(["platform", "phone", "email", "whatsapp"], { message: "اختر وسيلة التواصل." }),
  rec: z.string().optional().default(""),
});

export async function createRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(createSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let newId = "";
  const res = await userAction(async ({ auth, tx, ip, userAgent }) => {
    const [svc] = await tx.select().from(services).where(and(eq(services.code, d.service.toUpperCase()), eq(services.isPublished, true))).limit(1);
    if (!svc) throw new UserError("الخدمة غير موجودة.");
    const avail = serviceAvailability(svc, await flagMap(tx), await readSetting<License[]>(tx, "company.licenses", []));
    if (!avail.available) throw new UserError(`الخدمة غير متاحة حاليًا: ${avail.reason}`);

    let waqf: { id: string; waqfakRole: string } | null = null;
    if (d.waqf && d.waqf !== "none") {
      if (!uuid.safeParse(d.waqf).success) throw new UserError("اختر وقفًا صحيحًا.");
      if (!(await memberCan(tx, auth, d.waqf, "requests.create"))) throw new ForbiddenError("لا تملك صلاحية طلب خدمات لهذا الوقف.");
      const [w] = await tx.select({ id: waqfs.id, waqfakRole: waqfs.waqfakRole }).from(waqfs).where(eq(waqfs.id, d.waqf)).limit(1);
      if (!w) throw new ForbiddenError("لا يمكنك الوصول إلى هذا الوقف.");
      waqf = w;
    }

    // Separation of duties / independence check
    let openCodes: string[] = [];
    if (waqf) {
      const open = await tx
        .select({ code: services.code })
        .from(serviceRequests)
        .innerJoin(services, eq(services.id, serviceRequests.serviceId))
        .where(and(eq(serviceRequests.waqfId, waqf.id), notInArray(serviceRequests.status, ["closed", "cancelled", "rejected", "draft"])));
      openCodes = open.map((o) => o.code);
    }
    const conflict = svc.conflictRule === "none" ? { result: "passed" as const, note: null } : evaluateConflict({ rule: svc.conflictRule, waqfakRole: waqf?.waqfakRole ?? null, openServiceCodes: openCodes, hasWaqf: !!waqf });

    // Recommendation source
    let recId: string | null = null;
    if (d.rec) {
      if (!uuid.safeParse(d.rec).success) throw new UserError("التوصية غير صالحة.");
      const [rec] = await tx.select().from(recommendations).where(eq(recommendations.id, d.rec)).limit(1);
      if (!rec) throw new UserError("التوصية غير موجودة.");
      if (rec.waqfId && rec.waqfId !== waqf?.id) throw new UserError("التوصية تخص وقفًا آخر.");
      recId = rec.id;
    }

    const [wf] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.code, svc.workflowTemplateCode)).limit(1);
    const number = await nextNumber(tx, "REQ");
    const [req] = await tx
      .insert(serviceRequests)
      .values({
        number, serviceId: svc.id, waqfId: waqf?.id ?? null, requesterUserId: auth.user.id, status: "submitted", priority: d.priority,
        source: recId ? "recommendation" : "manual", sourceRef: recId, details: d.details, intake: { preferredContact: d.contact },
        departmentKey: svc.departmentKey, conflictCheck: conflict.result, conflictNote: conflict.note, submittedAt: new Date(), createdBy: auth.user.id,
      })
      .returning();
    newId = req.id;
    await createStages(tx, req.id, req.waqfId, wf?.stages ?? []);
    await logEvent(tx, req, auth.user.id, conflict.result === "blocked" ? "أُرسل الطلب وأُحيل إلى مدير التشغيل لمراجعة الاستقلالية" : "أُرسل الطلب", "draft", "submitted");
    if (recId) await tx.update(recommendations).set({ status: "converted", serviceRequestId: req.id }).where(eq(recommendations.id, recId));
    await audit(tx, {
      actorUserId: auth.user.id, action: "requests.create", entityType: "service_request", entityId: req.id, waqfId: req.waqfId, ip, userAgent,
      after: { number, service: svc.code, priority: d.priority, conflictCheck: conflict.result, source: recId ? "recommendation" : "manual" },
    });
    for (const opsId of await opsManagerIds(tx))
      await notify(opsId, "request.status", { number, status: `طلب جديد بانتظار التوزيع — ${svc.nameAr}${conflict.result === "blocked" ? " (تعارض استقلال)" : ""}` }, { waqfId: req.waqfId, link: `/admin/requests/${req.id}`, tx });
  });
  if (res.error) return res;
  redirect(`/app/requests/${newId}?created=1`);
}

// ───────────────────────── Shared: transitions ─────────────────────────

const transitionSchema = z.object({
  id: uuid,
  to: z.enum(STATUSES),
  note: z.string().max(2000).optional().default(""),
  holdParty: z.string().optional().default(""),
  holdFollowUpOn: z.string().optional().default(""),
});

async function doTransition(side: "client" | "staff", fd: FormData) {
  const r = parseForm(transitionSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.holdParty && !HOLD_PARTY_LABEL[d.holdParty]) return { error: "اختر جهة تعليق صحيحة." };
  if (d.holdFollowUpOn && !/^\d{4}-\d{2}-\d{2}$/.test(d.holdFollowUpOn)) return { error: "تاريخ المتابعة غير صالح." };
  return userAction(
    async (c) => {
      if (side === "staff" && !c.auth.isStaff) throw new ForbiddenError();
      const rc = await loadRequestCtx(c.tx, c.auth, d.id, side);
      await transition(c, rc, { to: d.to, note: d.note, holdParty: d.holdParty || undefined, holdFollowUpOn: d.holdFollowUpOn || undefined });
      return { ok: true, message: `تم: ${STATUS_LABEL[d.to]}.` };
    },
    { revalidate: revalidateReq(d.id) },
  );
}

export async function clientTransition(_: ActionState, fd: FormData) {
  return doTransition("client", fd);
}
export async function staffTransition(_: ActionState, fd: FormData) {
  return doTransition("staff", fd);
}

export async function advanceStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "طلب غير صالح." };
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, id, "staff");
    await advance(c, rc);
    return { ok: true, message: "انتقل الطلب إلى المرحلة التالية." };
  }, { perm: "staff.requests.assigned", revalidate: revalidateReq(id) });
}

// ───────────────────────── Notes ─────────────────────────

const noteSchema = z.object({ id: uuid, body: z.string().trim().min(2, "اكتب نص الرسالة.").max(4000, "النص طويل جدًا."), visibility: z.enum(["client", "internal"]).optional().default("client") });

async function addNote(side: "client" | "staff", fd: FormData): Promise<ActionState> {
  const r = parseForm(noteSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c: ActCtx) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, side);
    const visibility = side === "client" ? "client" : d.visibility;
    await c.tx.insert(requestNotes).values({ requestId: rc.req.id, waqfId: rc.req.waqfId, authorId: c.auth.user.id, visibility, body: d.body });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.note", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { visibility } });
    const vars = { number: rc.req.number, status: STATUS_LABEL[rc.req.status as RequestStatus], note: "رسالة جديدة على الطلب" };
    if (side === "client" && rc.req.assignedToUserId) await notify(rc.req.assignedToUserId, "request.status", { ...vars, status: "رسالة جديدة من العميل" }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}`, tx: c.tx });
    if (side === "staff" && visibility === "client" && rc.req.requesterUserId !== c.auth.user.id) await notify(rc.req.requesterUserId, "request.status", { ...vars, status: "رسالة جديدة من فريق وقفك" }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}`, tx: c.tx });
    return { ok: true, message: visibility === "internal" ? "أُضيفت الملاحظة الداخلية." : "أُرسلت الرسالة." };
  }, { revalidate: revalidateReq(d.id) });
}
export async function postClientNote(_: ActionState, fd: FormData) {
  return addNote("client", fd);
}
export async function postStaffNote(_: ActionState, fd: FormData) {
  return addNote("staff", fd);
}

// ───────────────────────── Client: rating ─────────────────────────

const rateSchema = z.object({ id: uuid, rating: z.coerce.number().int().min(1, "اختر تقييمًا من 1 إلى 5.").max(5), comment: z.string().max(1000).optional().default("") });
export async function rateRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(rateSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "client");
    if (!rc.isRequester && !rc.memberCreate) throw new ForbiddenError();
    if (!["completed", "closed"].includes(rc.req.status)) throw new UserError("يُتاح التقييم بعد اكتمال الطلب.");
    await c.tx.update(serviceRequests).set({ rating: d.rating, ratingComment: d.comment || null }).where(eq(serviceRequests.id, d.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.rate", entityType: "service_request", entityId: d.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { rating: d.rating } });
    return { ok: true, message: "شكرًا لتقييمك." };
  }, { revalidate: revalidateReq(d.id) });
}

// ───────────────────────── Staff: assignment ─────────────────────────

const assignSchema = z.object({ id: uuid, userId: uuid });
export async function assignRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(assignSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isOps) throw new ForbiddenError("التوزيع لمدير التشغيل فقط.");
    if (["closed", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("لا يُسند طلب منتهٍ.");
    const keys = await assignableRoleKeys();
    const [emp] = await c.tx
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.id, d.userId), eq(users.isStaff, true), eq(users.status, "active"), inArray(roles.key, keys)))
      .limit(1);
    if (!emp) throw new UserError("اختر موظفًا يحمل دورًا تشغيليًا.");
    const before = rc.req.assignedToUserId;
    await c.tx.update(serviceRequests).set({ assignedToUserId: emp.id, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `أُسند الطلب إلى ${emp.name ?? "موظف"}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.assign", entityType: "service_request", entityId: d.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before: { assignedTo: before }, after: { assignedTo: emp.id } });
    const waqfName = rc.waqf?.name ?? "بلا وقف";
    await notify(emp.id, "request.assigned", { number: rc.req.number, service: rc.service.nameAr, waqf: waqfName }, { waqfId: rc.req.waqfId, link: `/admin/requests/${d.id}`, tx: c.tx });
    // A newly submitted request moves to triage on assignment.
    if (rc.req.status === "submitted") {
      const fresh = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
      await transition(c, fresh, { to: "triage", note: "بدء الفرز عند الإسناد" });
    }
    return { ok: true, message: `أُسند الطلب إلى ${emp.name ?? "الموظف"}.` };
  }, { perm: "admin.requests.all", revalidate: revalidateReq(d.id) });
}

// ───────────────────────── Staff: quote ─────────────────────────

const quoteSchema = z.object({ id: uuid, amount: z.coerce.number({ message: "أدخل مبلغًا صحيحًا." }).positive("المبلغ يجب أن يكون أكبر من صفر.").max(100_000_000), send: z.string().optional() });
export async function setQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(quoteSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!["triage", "quote", "awaiting_client"].includes(rc.req.status)) throw new UserError("يُحدد عرض السعر أثناء الفرز فقط.");
    const amount = d.amount.toFixed(2);
    await c.tx.update(serviceRequests).set({ quoteAmount: amount, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    await c.tx.insert(priceQuoteHistory).values({ entityType: "service_request", entityId: d.id, field: "quoteAmount", oldValue: rc.req.quoteAmount, newValue: amount, actorUserId: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.quote", entityType: "service_request", entityId: d.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before: { quoteAmount: rc.req.quoteAmount }, after: { quoteAmount: amount } });
    if (d.send && rc.req.status === "triage") {
      const fresh = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
      await transition(c, fresh, { to: "quote", note: `عرض السعر: ${amount} ر.س قبل الضريبة` });
      return { ok: true, message: "أُرسل عرض السعر للعميل." };
    }
    return { ok: true, message: "حُفظ مبلغ العرض." };
  }, { perm: "staff.requests.assigned", revalidate: revalidateReq(d.id) });
}

// ───────────────────────── Ops: conflict override ─────────────────────────

const overrideSchema = z.object({ id: uuid, justification: z.string().trim().min(20, "اكتب مبررًا واضحًا (20 حرفًا على الأقل): لماذا لا يخل الاستثناء بالاستقلال؟").max(2000) });
export async function overrideConflict(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(overrideSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isOps) throw new ForbiddenError("اعتماد الاستثناء لمدير التشغيل فقط.");
    if (rc.req.conflictCheck !== "blocked") throw new UserError("الطلب ليس موقوفًا بسبب تعارض.");
    const note = `${rc.req.conflictNote ?? ""}\n— استثناء معتمد: ${d.justification}`.trim();
    await c.tx.update(serviceRequests).set({ conflictCheck: "override_approved", conflictNote: note, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `اعتمد مدير التشغيل استثناءً من قاعدة الاستقلال: ${d.justification}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.conflict_override", entityType: "service_request", entityId: d.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before: { conflictCheck: "blocked" }, after: { conflictCheck: "override_approved", justification: d.justification } });
    return { ok: true, message: "اعتُمد الاستثناء وسُجل في سجل العمليات." };
  }, { perm: "admin.requests.all", revalidate: revalidateReq(d.id) });
}

// ───────────────────────── Staff: deliverables ─────────────────────────

const delivSchema = z.object({
  id: uuid,
  title: z.string().trim().min(3, "اكتب عنوان المخرج.").max(300),
  documentId: z.string().optional().default(""),
  signedBy: z.string().trim().max(300).optional().default(""),
});
export async function addDeliverable(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(delivSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    if (!c.auth.perms.has("staff.deliver")) throw new ForbiddenError("رفع المخرجات يتطلب صلاحية التسليم.");
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!["in_progress", "quality_review"].includes(rc.req.status)) throw new UserError("تُرفع المخرجات أثناء التنفيذ.");
    let documentId: string | null = null;
    if (d.documentId) {
      if (!uuid.safeParse(d.documentId).success) throw new UserError("اختر وثيقة صحيحة.");
      const [doc] = await c.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d.documentId), eq(documents.requestId, d.id))).limit(1);
      if (!doc) throw new UserError("الوثيقة ليست من وثائق هذا الطلب.");
      documentId = doc.id;
    }
    const prev = await c.tx.select({ v: deliverables.version, title: deliverables.title }).from(deliverables).where(eq(deliverables.requestId, d.id));
    const version = Math.max(0, ...prev.filter((p) => p.title === d.title).map((p) => p.v)) + 1;
    const [row] = await c.tx.insert(deliverables).values({
      requestId: d.id, waqfId: rc.req.waqfId, title: d.title, documentId, version, status: "submitted", signedBy: d.signedBy || null, submittedAt: new Date(), createdBy: c.auth.user.id,
    }).returning({ id: deliverables.id });
    await logEvent(c.tx, rc.req, c.auth.user.id, `رُفع مخرج: ${d.title} (إصدار ${version})`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.deliverable", entityType: "deliverable", entityId: row.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { title: d.title, version, signedBy: d.signedBy || null } });
    return { ok: true, message: "أُضيف المخرج." };
  }, { perm: "staff.requests.assigned", revalidate: revalidateReq(d.id) });
}
