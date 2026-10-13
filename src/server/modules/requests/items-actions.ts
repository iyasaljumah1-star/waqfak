"use server";

import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { documents, requestEvents, requestItemEvents, requestItems, serviceRequests } from "@/server/db/schema";
import type { RequestItemKind } from "@/server/db/schema/commerce";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { loadRequestCtx, type RequestCtx } from "./access";
import { logEvent, transition, type ActCtx } from "./engine";
import { awaitingClient, blocking, ITEM_KIND_LABEL } from "./items-pure";
import type { RequestStatus } from "./workflow";

export type { DocReviewEntry as DocReview } from "./intake/engine";
import type { DocReviewEntry as DocReview } from "./intake/engine";

import { syncTask } from "@/server/modules/operations/exec";
import { linksOfRequest } from "@/server/modules/operations/links";

const uuid = z.string().uuid("قيمة غير صالحة.");
const reval = (id: string) => [`/app/requests/${id}`, `/admin/requests/${id}`, "/admin/requests", "/app/requests"];
const CLOSED = ["closed", "cancelled", "rejected"];

async function itemsOf(c: ActCtx, requestId: string) {
  return c.tx.select().from(requestItems).where(eq(requestItems.requestId, requestId));
}

/** Status the request returns to when the client has answered everything (the one it left for awaiting_client). */
async function resumeStatus(c: ActCtx, requestId: string): Promise<RequestStatus> {
  const [ev] = await c.tx.select({ from: requestEvents.fromStatus }).from(requestEvents)
    .where(and(eq(requestEvents.requestId, requestId), eq(requestEvents.toStatus, "awaiting_client"))).orderBy(desc(requestEvents.at)).limit(1);
  return ev?.from === "in_progress" ? "in_progress" : "triage";
}

/** Moves the request to «بانتظار العميل» when a required client item opens while the team holds it. */
async function holdForClient(c: ActCtx, rc: RequestCtx, note: string) {
  if (!["triage", "in_progress"].includes(rc.req.status)) return false;
  await transition(c, rc, { to: "awaiting_client", note, system: true }); // notifies the client
  return true;
}

/** Returns the request to the team when no required client item is waiting any more. */
async function releaseIfAnswered(c: ActCtx, requestId: string) {
  const rc = await loadRequestCtx(c.tx, c.auth, requestId, "any");
  if (rc.req.status !== "awaiting_client") return false;
  const items = await itemsOf(c, requestId);
  if (items.some((i) => awaitingClient(i) && i.required)) return false;
  await transition(c, rc, { to: await resumeStatus(c, requestId), note: "استكمل العميل النواقص المطلوبة", system: true });
  return true;
}

async function itemEvent(c: ActCtx, item: { id: string; requestId: string; waqfId: string | null }, action: string, note?: string | null, documentId?: string | null) {
  await c.tx.insert(requestItemEvents).values({ itemId: item.id, requestId: item.requestId, waqfId: item.waqfId, action, note: note ?? null, documentId: documentId ?? null, actorUserId: c.auth.user.id });
}

async function docOfRequest(c: ActCtx, requestId: string, documentId: string | undefined) {
  if (!documentId) return null;
  if (!uuid.safeParse(documentId).success) throw new UserError("اختر وثيقة صحيحة.");
  const [d] = await c.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.requestId, requestId))).limit(1);
  if (!d) throw new UserError("الوثيقة ليست من وثائق هذا الطلب.");
  return d.id;
}

// ───────────────────────── Staff: raise ─────────────────────────

const raiseSchema = z.object({
  id: uuid,
  kind: z.enum(["data", "document", "question", "internal", "technical"], { message: "اختر نوع البند." }),
  title: z.string().trim().min(4, "اكتب عنوانًا واضحًا للبند.").max(200),
  body: z.string().trim().max(2000).optional().default(""),
  fieldKey: z.string().trim().max(60).optional().default(""),
  docType: z.string().trim().max(40).optional().default(""),
  required: z.string().optional(),
  dueOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح.")]).optional().default(""),
  visibility: z.enum(["client", "internal"]).optional().default("client"),
});

export async function raiseItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(raiseSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("يسجّل النواقص المختص المسند إليه الطلب أو مدير التشغيل.");
    if (rc.req.status === "draft" || CLOSED.includes(rc.req.status)) throw new UserError("لا تُسجّل نواقص على طلب غير مرسل أو منتهٍ.");
    if (d.kind === "document" && !d.docType) throw new UserError("حدّد نوع المستند المطلوب.");
    const visibility = d.kind === "internal" ? "internal" : d.kind === "technical" ? d.visibility : "client";
    const required = d.required === "on";
    const [{ m }] = await c.tx.select({ m: max(requestItems.seq) }).from(requestItems).where(eq(requestItems.requestId, d.id));
    const [item] = await c.tx.insert(requestItems).values({
      requestId: d.id, waqfId: rc.req.waqfId, seq: (m ?? 0) + 1, kind: d.kind as RequestItemKind, title: d.title, body: d.body || null,
      fieldKey: d.fieldKey || null, docType: d.docType || null, required, visibility, dueOn: d.dueOn || null, createdBy: c.auth.user.id,
    }).returning();
    await itemEvent(c, item, "raised", d.body || null);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.item_raise", entityType: "request_item", entityId: item.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { seq: item.seq, kind: d.kind, required, visibility } });
    if (visibility === "client") {
      await logEvent(c.tx, rc.req, c.auth.user.id, `سُجّل بند ${item.seq}: ${ITEM_KIND_LABEL[item.kind]} — ${d.title}`);
      const held = required && (await holdForClient(c, rc, `بانتظار استكمال: ${d.title}`));
      if (!held) await notify(rc.req.requesterUserId, "request.awaiting_client", { number: rc.req.number, note: `مطلوب منك: ${d.title}` }, { waqfId: rc.req.waqfId, link: `/app/requests/${d.id}#items`, tx: c.tx });
    }
    return { ok: true, message: `سُجّل البند رقم ${item.seq}.` };
  }, { revalidate: reval(d.id) });
}

// ───────────────────────── Client: answer ─────────────────────────

const answerSchema = z.object({
  itemId: uuid,
  response: z.string().trim().max(4000).optional().default(""),
  documentId: z.string().optional().default(""),
});

export async function answerItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(answerSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let reqId = "";
  const res = await userAction(async (c) => {
    const [item] = await c.tx.select().from(requestItems).where(eq(requestItems.id, d.itemId)).limit(1);
    if (!item) throw new UserError("البند غير موجود.");
    reqId = item.requestId;
    const rc = await loadRequestCtx(c.tx, c.auth, item.requestId, "client");
    if (!rc.isRequester && !rc.memberCreate) throw new ForbiddenError("لا تملك صلاحية الرد على هذا الطلب.");
    if (item.visibility !== "client") throw new ForbiddenError();
    if (!["open", "correction_requested"].includes(item.status)) throw new UserError("هذا البند لا ينتظر ردك.");
    const documentId = await docOfRequest(c, item.requestId, d.documentId || undefined);
    if (item.kind === "document" && !documentId) throw new UserError("ارفع المستند المطلوب ثم اختره.");
    if (!documentId && d.response.length < 2) throw new UserError("اكتب ردك أو أرفق مستندًا.");
    const now = new Date();
    await c.tx.update(requestItems).set({ status: "answered", responseText: d.response || null, responseDocumentId: documentId, answeredBy: c.auth.user.id, answeredAt: now, updatedBy: c.auth.user.id }).where(eq(requestItems.id, item.id));
    await itemEvent(c, item, "answered", d.response || null, documentId);
    await logEvent(c.tx, rc.req, c.auth.user.id, `أجاب العميل على البند ${item.seq}: ${item.title}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.item_answer", entityType: "request_item", entityId: item.id, waqfId: item.waqfId, ip: c.ip, userAgent: c.userAgent, after: { documentId } });
    if (rc.req.assignedToUserId) await notify(rc.req.assignedToUserId, "request.status", { number: rc.req.number, status: `أجاب العميل على البند ${item.seq}` }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}#items`, tx: c.tx });
    const released = await releaseIfAnswered(c, item.requestId);
    return { ok: true, message: released ? "أُرسل ردك. اكتملت النواقص المطلوبة وعاد الطلب إلى الفريق." : "أُرسل ردك إلى الفريق للمراجعة." };
  });
  if (reqId) {
    const { revalidatePath } = await import("next/cache");
    for (const p of reval(reqId)) revalidatePath(p);
  }
  return res;
}

// ───────────────────────── Staff: review ─────────────────────────

const reviewSchema = z.object({
  itemId: uuid,
  decision: z.enum(["accept", "correct", "cancel", "close"]),
  note: z.string().trim().max(2000).optional().default(""),
});

export async function reviewItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reviewSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let reqId = "";
  const res = await userAction(async (c) => {
    const [item] = await c.tx.select().from(requestItems).where(eq(requestItems.id, d.itemId)).limit(1);
    if (!item) throw new UserError("البند غير موجود.");
    reqId = item.requestId;
    const rc = await loadRequestCtx(c.tx, c.auth, item.requestId, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    if ((d.decision === "correct" || d.decision === "cancel") && d.note.length < 3) throw new UserError("اكتب سبب طلب التصحيح أو الإلغاء.");
    const now = new Date();
    if (d.decision === "accept") {
      if (item.status !== "answered") throw new UserError("يُقبل البند بعد رد العميل عليه.");
      await c.tx.update(requestItems).set({ status: "accepted", resolvedBy: c.auth.user.id, resolvedAt: now, updatedBy: c.auth.user.id }).where(eq(requestItems.id, item.id));
      await itemEvent(c, item, "accepted", d.note || null);
      await notify(rc.req.requesterUserId, "request.status", { number: rc.req.number, status: `قُبل البند ${item.seq}: ${item.title}` }, { waqfId: rc.req.waqfId, link: `/app/requests/${item.requestId}#items`, tx: c.tx });
    } else if (d.decision === "close") {
      if (item.visibility !== "internal" || item.status !== "open") throw new UserError("الإغلاق المباشر للبنود الداخلية فقط.");
      await c.tx.update(requestItems).set({ status: "accepted", resolvedBy: c.auth.user.id, resolvedAt: now, updatedBy: c.auth.user.id }).where(eq(requestItems.id, item.id));
      await itemEvent(c, item, "closed", d.note || null);
    } else if (d.decision === "correct") {
      if (item.status !== "answered") throw new UserError("يُطلب التصحيح بعد رد العميل.");
      await c.tx.update(requestItems).set({ status: "correction_requested", updatedBy: c.auth.user.id }).where(eq(requestItems.id, item.id));
      await itemEvent(c, item, "correction_requested", d.note);
      const held = item.required && (await holdForClient(c, rc, `مطلوب تصحيح البند ${item.seq}: ${d.note}`));
      if (!held) await notify(rc.req.requesterUserId, "request.awaiting_client", { number: rc.req.number, note: `مطلوب تصحيح البند ${item.seq}: ${d.note}` }, { waqfId: rc.req.waqfId, link: `/app/requests/${item.requestId}#items`, tx: c.tx });
    } else {
      if (["accepted", "cancelled"].includes(item.status)) throw new UserError("البند مغلق.");
      await c.tx.update(requestItems).set({ status: "cancelled", resolvedBy: c.auth.user.id, resolvedAt: now, updatedBy: c.auth.user.id }).where(eq(requestItems.id, item.id));
      await itemEvent(c, item, "cancelled", d.note);
    }
    if (item.visibility === "client") await logEvent(c.tx, rc.req, c.auth.user.id, `البند ${item.seq} (${item.title}): ${{ accept: "قُبل", correct: "طُلب تصحيحه", cancel: "أُلغي", close: "أُغلق" }[d.decision]}${d.note ? ` — ${d.note}` : ""}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: `requests.item_${d.decision}`, entityType: "request_item", entityId: item.id, waqfId: item.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: item.status }, after: { note: d.note || undefined } });
    if (d.decision === "cancel") await releaseIfAnswered(c, item.requestId);
    return { ok: true, message: { accept: "قُبل البند وأُغلق.", correct: "أُرسل طلب التصحيح إلى العميل.", cancel: "أُلغي البند.", close: "أُغلق البند." }[d.decision] };
  });
  if (reqId) {
    const { revalidatePath } = await import("next/cache");
    for (const p of reval(reqId)) revalidatePath(p);
  }
  return res;
}

// ───────────────────────── Staff: verify intake / accept request ─────────────────────────

const idSchema = z.object({ id: uuid, note: z.string().trim().max(1000).optional().default("") });

/** Records that the submitted data and documents were checked and nothing required is pending. */
export async function verifyIntake(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    if (!["triage", "awaiting_client"].includes(rc.req.status)) throw new UserError("يُتحقق من البيانات أثناء الفرز.");
    if (rc.req.intakeVerifiedAt) throw new UserError("تحققت البيانات مسبقًا.");
    const items = await itemsOf(c, d.id);
    const pending = items.filter((i) => blocking(i) && i.visibility === "client");
    if (pending.length) throw new UserError(`لا يكتمل التحقق وفيه ${pending.length} من النواقص المطلوبة غير المقبولة.`);
    const unverified = await unverifiedRequiredSlots(c, rc);
    if (unverified.length) throw new UserError(`تحقق من المستندات المطلوبة أولًا (مرفوع لا يعني متحققًا منه): ${unverified.join("، ")}.`);
    await c.tx.update(serviceRequests).set({ intakeVerifiedAt: new Date(), intakeVerifiedBy: c.auth.user.id, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `تحقق الفريق من بيانات الطلب ومستنداته${d.note ? ` — ${d.note}` : ""}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.verify_intake", entityType: "service_request", entityId: d.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { note: d.note || undefined } });
    return { ok: true, message: "سُجّل التحقق من البيانات والمستندات." };
  }, { revalidate: reval(d.id) });
}

/** Accepts the request for service (after verification, with the independence check passed). */
export async function acceptRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    if (rc.req.status !== "triage") throw new UserError("يُقبل الطلب أثناء الفرز.");
    if (!rc.req.intakeVerifiedAt) throw new UserError("تحقق من البيانات والمستندات أولًا.");
    if (rc.req.conflictCheck === "blocked") throw new UserError("تعارض استقلال قائم: يقرر فيه مدير التشغيل أولًا.");
    if (rc.req.acceptedAt) throw new UserError("قُبل الطلب مسبقًا.");
    if (rc.service.code === "N01") {
      // The acceptance of a nazara request is the acceptance decision on its nazara file (nazara.approve).
      const eng = (await linksOfRequest(c.tx, d.id)).find((l) => l.entityType === "nazara_engagement");
      if (!eng || !["accepted", "active", "suspended", "ending"].includes(eng.status ?? "")) throw new UserError("يُقبل طلب النظارة باعتماد قبول ملف النظارة المرتبط به من لوحة «النظارة الاعتبارية».");
    }
    await c.tx.update(serviceRequests).set({ acceptedAt: new Date(), acceptedBy: c.auth.user.id, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    await syncTask(c.tx, d.id, "intake", undefined, "done", c.auth.user.id, "قُبل الطلب للخدمة");
    await logEvent(c.tx, rc.req, c.auth.user.id, `قُبل الطلب للخدمة${d.note ? ` — ${d.note}` : ""}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.accept", entityType: "service_request", entityId: d.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { note: d.note || undefined } });
    await notify(rc.req.requesterUserId, "request.status", { number: rc.req.number, status: rc.service.pricingModel === "free" ? "قُبل طلبك وسيبدأ تنفيذه" : "قُبل طلبك، ويُعدّ الآن نطاق العمل وعرض السعر" }, { waqfId: rc.req.waqfId, link: `/app/requests/${d.id}`, tx: c.tx });
    return { ok: true, message: "قُبل الطلب للخدمة." };
  }, { revalidate: reval(d.id) });
}

// ───────────────────────── Staff: review of the documents attached in the form ─────────────────────────

const docReviewSchema = z.object({
  id: uuid,
  documentId: uuid,
  slot: z.string().min(1).max(60),
  decision: z.enum(["verified", "rejected"]),
  note: z.string().trim().max(1000).optional().default(""),
});

/**
 * A document attached to the form is «uploaded», not «verified»: the team checks it against the form slot and records
 * the result. A rejected document raises a required document item for the client (the deficiencies register), and the
 * intake cannot be verified while a required slot has no verified document.
 */
export async function reviewIntakeDoc(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(docReviewSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.decision === "rejected" && d.note.length < 5) return { error: "اذكر سبب رفض المستند.", fieldErrors: { note: "اكتب السبب (5 أحرف على الأقل)." } };
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    if (rc.req.status === "draft" || CLOSED.includes(rc.req.status)) throw new UserError("لا تُراجع مستندات طلب غير مرسل أو منتهٍ.");
    const intake = (rc.req.intake ?? {}) as { docs?: Record<string, string[]>; docReview?: Record<string, DocReview> };
    if (!(intake.docs?.[d.slot] ?? []).includes(d.documentId)) throw new UserError("المستند ليس مرفقًا في هذه الخانة من النموذج.");
    const prev = intake.docReview?.[d.documentId];
    if (prev?.status === d.decision) throw new UserError(d.decision === "verified" ? "المستند متحقق منه سابقًا." : "المستند مرفوض سابقًا وله بند استبدال.");
    const review: DocReview = { status: d.decision, slot: d.slot, by: c.auth.user.id, at: new Date().toISOString(), note: d.note || null };
    await audit(c.tx, { actorUserId: c.auth.user.id, action: `requests.doc_${d.decision}`, entityType: "document", entityId: d.documentId, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { slot: d.slot, note: d.note || undefined } });
    if (d.decision === "rejected") {
      const [doc] = await c.tx.select({ title: documents.title, docType: documents.docType }).from(documents).where(eq(documents.id, d.documentId)).limit(1);
      const [{ m }] = await c.tx.select({ m: max(requestItems.seq) }).from(requestItems).where(eq(requestItems.requestId, d.id));
      const [item] = await c.tx.insert(requestItems).values({
        requestId: d.id, waqfId: rc.req.waqfId, seq: (m ?? 0) + 1, kind: "document", title: `استبدال مستند: ${doc?.title ?? "مستند"}`, body: d.note,
        docType: doc?.docType ?? null, required: true, visibility: "client", createdBy: c.auth.user.id,
      }).returning();
      review.itemId = item.id;
      await itemEvent(c, item, "raised", d.note);
      await logEvent(c.tx, rc.req, c.auth.user.id, `رُفض مستند «${doc?.title ?? ""}»: ${d.note}`);
      const held = await holdForClient(c, rc, `بانتظار استبدال مستند: ${doc?.title ?? ""}`);
      if (!held) await notify(rc.req.requesterUserId, "request.awaiting_client", { number: rc.req.number, note: `مطلوب منك: استبدال ${doc?.title ?? "مستند"}` }, { waqfId: rc.req.waqfId, link: `/app/requests/${d.id}#items`, tx: c.tx });
    }
    await c.tx.update(serviceRequests).set({ intake: { ...intake, docReview: { ...(intake.docReview ?? {}), [d.documentId]: review } }, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    return { ok: true, message: d.decision === "verified" ? "سُجّل التحقق من المستند." : "رُفض المستند وسُجّل بند لاستبداله." };
  }, { revalidate: reval(d.id) });
}

/** Required form slots whose attached documents were not verified by the team (an accepted replacement item counts). */
async function unverifiedRequiredSlots(c: ActCtx, rc: RequestCtx): Promise<string[]> {
  const { serviceForm, intakeOf } = await import("./intake/server");
  const { unverifiedSlots } = await import("./intake/engine");
  const intake = intakeOf(rc.req) as ReturnType<typeof intakeOf> & { docReview?: Record<string, DocReview> };
  if (!intake.formVersion) return []; // legacy requests (before forms) keep the old check
  const accepted = new Set((await itemsOf(c, rc.req.id)).filter((i) => i.status === "accepted").map((i) => i.id));
  return unverifiedSlots(serviceForm(rc.service), intake.answers ?? {}, intake.docs ?? {}, intake.docReview ?? {}, accepted).map((s) => s.label);
}
