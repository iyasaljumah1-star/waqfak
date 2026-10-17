"use server";

import { contextFor } from "./context/map";
import { findField } from "./intake/engine";
import { serviceForm } from "./intake/server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { deliverables, documents, requestNotes, serviceRequests, userRoles, roles, users } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { assignableRoleKeys, loadRequestCtx } from "./access";
import { advance, logEvent, transition, type ActCtx } from "./engine";
import { moveOpenTasks } from "@/server/modules/operations/exec";
import { HOLD_PARTY_LABEL, STATUS_LABEL, type RequestStatus } from "./workflow";

const uuid = z.string().uuid("قيمة غير صالحة.");
const STATUSES = Object.keys(STATUS_LABEL) as [RequestStatus, ...RequestStatus[]];
const revalidateReq = (id: string) => [`/app/requests/${id}`, `/admin/requests/${id}`, "/app/requests", "/admin/requests"];

// Client: creating a request is the intake flow (./intake/actions.ts: startRequest → saveIntake → submitIntake).

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
  }, { revalidate: revalidateReq(id) });
}

// ───────────────────────── Notes ─────────────────────────

const noteSchema = z.object({
  id: uuid,
  body: z.string().trim().min(2, "اكتب نص الرسالة.").max(4000, "النص طويل جدًا."),
  visibility: z.enum(["client", "internal"]).optional().default("client"),
  documentId: z.string().optional().default(""),
  /** The field (or "ctx:<block>") the note or evidence is about. */
  fieldKey: z.string().trim().max(80).regex(/^(ctx:[a-z.]+|[A-Za-z][A-Za-z0-9_]*)?$/, "حقل غير صالح.").optional().default(""),
});

/** A note may concern a field of the service's form or a waqf-file block the service reads. */
function fieldExists(rc: { service: { code: string; audiences: string[]; requiredDocuments: unknown } }, key: string) {
  if (key.startsWith("ctx:")) return (contextFor(rc.service.code) as string[]).includes(key.slice(4));
  return !!findField(serviceForm(rc.service as Parameters<typeof serviceForm>[0]), key);
}

async function addNote(side: "client" | "staff", fd: FormData): Promise<ActionState> {
  const r = parseForm(noteSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c: ActCtx) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, side);
    if (side === "client" && !rc.isRequester && !rc.memberCreate) throw new ForbiddenError("لا تملك صلاحية المراسلة على هذا الطلب.");
    if (["closed", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("الطلب منتهٍ؛ لا تُضاف إليه رسائل.");
    const visibility = side === "client" ? "client" : d.visibility;
    let documentId: string | null = null;
    if (d.documentId) {
      if (!uuid.safeParse(d.documentId).success) throw new UserError("المرفق غير صالح.");
      const [doc] = await c.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d.documentId), eq(documents.requestId, rc.req.id))).limit(1);
      if (!doc) throw new UserError("المرفق ليس من وثائق هذا الطلب.");
      documentId = doc.id;
    }
    if (d.fieldKey && !fieldExists(rc, d.fieldKey)) throw new UserError("الحقل غير موجود في نموذج هذه الخدمة.");
    const fieldKey = d.fieldKey || null;
    await c.tx.insert(requestNotes).values({ requestId: rc.req.id, waqfId: rc.req.waqfId, authorId: c.auth.user.id, visibility, body: d.body, documentId, fieldKey });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.note", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { visibility, documentId, fieldKey } });
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
    await moveOpenTasks(c.tx, d.id, before, emp.id, c.auth.user.id);
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

// Staff: quotes are versioned documents (scope, lines, VAT, payment terms, validity) — see ../commerce/quote-actions.ts.

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
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("يرفع المخرجات المسند إليه الطلب أو المدير المخوّل.");
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
  }, { revalidate: revalidateReq(d.id) });
}
