"use server";

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { quotes, serviceRequests } from "@/server/db/schema";
import type { PaymentTerm } from "@/server/db/schema/commerce";
import { ForbiddenError } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { sha256 } from "@/server/lib/crypto";
import { todayISO } from "@/server/engines/dates";
import { notify } from "@/server/modules/notify";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { fmtSAR, type ActionState } from "@/lib/utils";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { logEvent, transition } from "@/server/modules/requests/engine";
import { buildQuote, quoteCanonical, quoteExpired } from "./pure";
import { vatRateSetting } from "./state";

const uuid = z.string().uuid("قيمة غير صالحة.");
const reval = (id: string) => [`/app/requests/${id}`, `/admin/requests/${id}`, "/admin/requests", "/app/requests"];
const AMEND_STATUSES = ["awaiting_contract", "in_progress", "quality_review", "awaiting_client_approval"];

function jsonArr<T>(v: FormDataEntryValue | null): T[] {
  try {
    const x = JSON.parse(String(v ?? "[]"));
    return Array.isArray(x) ? (x as T[]) : [];
  } catch {
    return [];
  }
}

const saveSchema = z.object({
  id: uuid,
  quoteId: z.string().optional().default(""),
  kind: z.enum(["initial", "amendment"]).default("initial"),
  scope: z.string().trim().min(20, "اكتب نطاق العمل بوضوح (20 حرفًا على الأقل).").max(6000),
  deliverables: z.string().trim().min(3, "اذكر المخرجات.").max(4000),
  exclusions: z.string().trim().max(4000).optional().default(""),
  assumptions: z.string().trim().max(4000).optional().default(""),
  clientObligations: z.string().trim().max(4000).optional().default(""),
  durationDays: z.coerce.number({ message: "أدخل المدة بالأيام." }).int("المدة عدد صحيح.").min(1, "المدة يوم واحد على الأقل.").max(3650),
  discount: z.coerce.number({ message: "الخصم رقم." }).min(0).default(0),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "حدّد تاريخ صلاحية العرض."),
});

/** Staff: creates or edits the draft quote of a request (scope + lines + payment terms). A sent quote is never edited. */
export async function saveQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(saveSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const lines = jsonArr<{ description: string; qty: number | string; unit: number | string }>(fd.get("lines")).map((l) => ({ description: String(l.description ?? ""), qty: Number(l.qty), unit: Number(l.unit) }));
  const terms = jsonArr<{ label: string; percent: number | string; due: PaymentTerm["due"]; beforeStart?: boolean }>(fd.get("terms")).map((t) => ({
    label: String(t.label ?? ""), percent: Number(t.percent), due: (["on_contract", "before_start", "on_delivery", "on_completion"].includes(t.due) ? t.due : "on_contract") as PaymentTerm["due"], beforeStart: !!t.beforeStart,
  }));
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("يعدّ العرض المختص المسند إليه الطلب أو مدير التشغيل.");
    if (rc.service.pricingModel === "free") throw new UserError("الخدمة مجانية ولا تحتاج عرض سعر.");
    const all = await c.tx.select().from(quotes).where(eq(quotes.requestId, d.id)).orderBy(desc(quotes.createdAt));
    const acceptedInitial = all.find((q) => q.kind === "initial" && q.status === "accepted");
    if (d.kind === "initial") {
      // Legacy requests that reached «بانتظار العقد» with an amount-only quote get a full quote before their contract.
      const legacy = rc.req.status === "awaiting_contract" && !all.some((q) => q.kind === "initial");
      if (!["triage", "awaiting_client", "quote"].includes(rc.req.status) && !legacy) throw new UserError("يُعدّ العرض الأولي أثناء الفرز أو بعد طلب العميل تعديله.");
      if (acceptedInitial) throw new UserError("قُبل العرض الأولي. أي تغيير في النطاق أو السعر بعده يكون «ملحق تعديل».");
    } else {
      if (!acceptedInitial) throw new UserError("ملحق التعديل يأتي بعد قبول العرض الأولي.");
      if (!AMEND_STATUSES.includes(rc.req.status)) throw new UserError("يُعدّ ملحق التعديل بعد قبول العرض وقبل اكتمال الطلب.");
    }
    const vatRate = await vatRateSetting(c.tx);
    const built = buildQuote({ lines, discount: d.discount, vatRate, terms, validUntil: d.validUntil, today: todayISO() });
    if (!built.ok) return { error: built.errors.join(" ") };
    const content = {
      scope: d.scope, deliverables: d.deliverables, exclusions: d.exclusions || null, assumptions: d.assumptions || null, clientObligations: d.clientObligations || null,
      durationDays: d.durationDays, lines: built.lines, subtotal: built.subtotal.toFixed(2), discount: built.discount.toFixed(2), net: built.net.toFixed(2),
      vatRate: String(vatRate), vat: built.vat.toFixed(2), total: built.total.toFixed(2), paymentTerms: built.terms, validUntil: d.validUntil,
    };
    const editing = d.quoteId ? all.find((q) => q.id === d.quoteId) : all.find((q) => q.kind === d.kind && q.status === "draft");
    if (editing) {
      if (editing.status !== "draft") throw new UserError("هذه النسخة لم تعد مسودة؛ أنشئ نسخة جديدة.");
      if (editing.kind !== d.kind) throw new UserError("نوع العرض لا يتغير.");
      await c.tx.update(quotes).set({ ...content, preparedBy: c.auth.user.id, updatedBy: c.auth.user.id }).where(and(eq(quotes.id, editing.id), eq(quotes.status, "draft")));
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "quotes.edit", entityType: "quote", entityId: editing.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { net: content.net, total: content.total } });
      return { ok: true, message: `حُفظت مسودة العرض ${editing.number} (نسخة ${editing.version}).` };
    }
    // New version of the same chain when the last one was not accepted; otherwise a new number.
    const chain = all.find((q) => q.kind === d.kind && q.status !== "accepted");
    const number = chain ? chain.number : await nextNumber(c.tx, "QUO");
    const version = chain ? Math.max(...all.filter((q) => q.number === chain.number).map((q) => q.version)) + 1 : 1;
    const [row] = await c.tx.insert(quotes).values({
      number, version, requestId: d.id, waqfId: rc.req.waqfId, kind: d.kind, parentQuoteId: d.kind === "amendment" ? acceptedInitial!.id : chain?.id ?? null,
      status: "draft", ...content, preparedBy: c.auth.user.id, createdBy: c.auth.user.id,
    }).returning({ id: quotes.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "quotes.create", entityType: "quote", entityId: row.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, version, kind: d.kind, net: content.net, total: content.total } });
    return { ok: true, message: `أُنشئت مسودة العرض ${number} (نسخة ${version}). تُعتمد داخليًا قبل إرسالها.` };
  }, { perm: "staff.requests.assigned", revalidate: reval(d.id) });
}

const qSchema = z.object({ quoteId: uuid, note: z.string().trim().max(2000).optional().default("") });

async function loadQuote(c: Parameters<Parameters<typeof userAction>[0]>[0], quoteId: string, side: "staff" | "client") {
  const [q] = await c.tx.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!q) throw new UserError("العرض غير موجود.");
  const rc = await loadRequestCtx(c.tx, c.auth, q.requestId, side);
  return { q, rc };
}

/** Maker-checker: a quote is approved by a second person holding requests.quotes.approve. */
export async function approveQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(qSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let reqId = "";
  const res = await userAction(async (c) => {
    const { q, rc } = await loadQuote(c, d.quoteId, "staff");
    reqId = q.requestId;
    if (q.status !== "draft") throw new UserError("تُعتمد المسودات فقط.");
    if (q.preparedBy === c.auth.user.id) throw new UserError("مبدأ الفصل بين المهام: يعتمد العرض شخص غير من أعدّه.");
    if (q.validUntil < todayISO()) throw new UserError("تاريخ صلاحية العرض مضى. عدّله في المسودة ثم اعتمده.");
    await c.tx.update(quotes).set({ status: "approved", approvedBy: c.auth.user.id, approvedAt: new Date(), updatedBy: c.auth.user.id }).where(and(eq(quotes.id, q.id), eq(quotes.status, "draft")));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "quotes.approve", entityType: "quote", entityId: q.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: q.number, version: q.version } });
    if (rc.req.assignedToUserId && rc.req.assignedToUserId !== c.auth.user.id)
      await notify(rc.req.assignedToUserId, "request.status", { number: rc.req.number, status: `اعتُمد العرض ${q.number} (نسخة ${q.version}) وجاهز للإرسال` }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}#quote`, tx: c.tx });
    return { ok: true, message: "اعتُمد العرض. أرسله للعميل." };
  }, { perm: "requests.quotes.approve" });
  return revalidated(res, reqId);
}

/** Sends an approved quote: freezes it (hash), supersedes the earlier open versions, moves the request to «عرض سعر». */
export async function sendQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(qSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let reqId = "";
  const res = await userAction(async (c) => {
    const { q, rc } = await loadQuote(c, d.quoteId, "staff");
    reqId = q.requestId;
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    if (q.status !== "approved") throw new UserError("يُرسل العرض بعد اعتماده داخليًا.");
    if (q.validUntil < todayISO()) throw new UserError("تاريخ صلاحية العرض مضى؛ أنشئ نسخة جديدة.");
    const hash = sha256(quoteCanonical(q));
    const now = new Date();
    // The request must be ready: initial quotes need the request verified and accepted (guards in the transition).
    if (q.kind === "initial" && rc.req.status === "triage") {
      await c.tx.update(serviceRequests).set({ quoteAmount: q.net, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, rc.req.id));
      const fresh = await loadRequestCtx(c.tx, c.auth, rc.req.id, "staff");
      await transition(c, fresh, { to: "quote", note: `عرض السعر ${q.number} (نسخة ${q.version}): ${fmtSAR(q.total)} شامل الضريبة، صالح حتى ${q.validUntil}` });
    } else if (q.kind === "initial" && !["quote", "awaiting_contract"].includes(rc.req.status)) {
      throw new UserError("يُرسل العرض الأولي أثناء الفرز أو بعد طلب العميل تعديله.");
    } else if (q.kind === "initial") {
      await c.tx.update(serviceRequests).set({ quoteAmount: q.net, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, rc.req.id));
      await logEvent(c.tx, rc.req, c.auth.user.id, `أُرسلت نسخة ${q.version} من عرض السعر ${q.number}: ${fmtSAR(q.total)} شامل الضريبة`);
    } else {
      await logEvent(c.tx, rc.req, c.auth.user.id, `أُرسل ملحق التعديل ${q.number}: ${fmtSAR(q.total)} شامل الضريبة`);
    }
    await c.tx.update(quotes).set({ status: "sent", contentHash: hash, sentBy: c.auth.user.id, sentAt: now, updatedBy: c.auth.user.id }).where(and(eq(quotes.id, q.id), eq(quotes.status, "approved")));
    const older = await c.tx.select({ id: quotes.id }).from(quotes).where(and(eq(quotes.number, q.number), ne(quotes.id, q.id), inArray(quotes.status, ["draft", "approved", "sent", "change_requested", "expired"])));
    if (older.length) await c.tx.update(quotes).set({ status: "superseded", supersededBy: q.id }).where(inArray(quotes.id, older.map((o) => o.id)));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "quotes.send", entityType: "quote", entityId: q.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: q.number, version: q.version, contentHash: hash, superseded: older.length } });
    if (q.kind === "amendment" || rc.req.status !== "triage")
      await notify(rc.req.requesterUserId, "request.awaiting_client", { number: rc.req.number, note: `${q.kind === "amendment" ? "ملحق تعديل" : "عرض سعر"} ${q.number} بانتظار ردك — صالح حتى ${q.validUntil}` }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}#quote`, tx: c.tx });
    return { ok: true, message: "أُرسل العرض للعميل." };
  }, { perm: "staff.requests.assigned" });
  return revalidated(res, reqId);
}

/** Withdraws a sent quote before the client answers (with a reason). */
export async function withdrawQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(qSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let reqId = "";
  const res = await userAction(async (c) => {
    const { q, rc } = await loadQuote(c, d.quoteId, "staff");
    reqId = q.requestId;
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError();
    if (!["sent", "approved", "draft"].includes(q.status)) throw new UserError("لا يُسحب عرض أجاب عنه العميل.");
    if (d.note.length < 5) throw new UserError("اكتب سبب سحب العرض.");
    await c.tx.update(quotes).set({ status: "withdrawn", responseNote: d.note, updatedBy: c.auth.user.id }).where(eq(quotes.id, q.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `سُحب العرض ${q.number} (نسخة ${q.version}): ${d.note}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "quotes.withdraw", entityType: "quote", entityId: q.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: q.status }, after: { reason: d.note } });
    if (q.status === "sent") await notify(rc.req.requesterUserId, "request.status", { number: rc.req.number, status: `سُحب العرض ${q.number}: ${d.note}` }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}#quote`, tx: c.tx });
    return { ok: true, message: "سُحب العرض." };
  }, { perm: "staff.requests.assigned" });
  return revalidated(res, reqId);
}

const respondSchema = z.object({
  quoteId: uuid,
  decision: z.enum(["accept", "reject", "change"]),
  note: z.string().trim().max(2000).optional().default(""),
  hash: z.string().optional().default(""),
});

/**
 * Client: accepts, rejects, or asks to change a sent quote. Acceptance binds to the exact content shown (its hash)
 * and is refused after the validity date. A change request is a rejection with a new request (م36/1(ب)).
 */
export async function respondQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(respondSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let reqId = "";
  const res = await userAction(async (c) => {
    const { q, rc } = await loadQuote(c, d.quoteId, "client");
    reqId = q.requestId;
    if (!rc.isRequester && !rc.memberSign) throw new ForbiddenError("الرد على العرض لمقدّم الطلب أو لمن يملك صلاحية توقيع العقود في الوقف.");
    if (q.status !== "sent") throw new UserError(q.status === "superseded" ? "استُبدل هذا العرض بنسخة أحدث." : "هذا العرض لا ينتظر ردك.");
    if (quoteExpired(q, todayISO())) {
      await c.tx.update(quotes).set({ status: "expired" }).where(eq(quotes.id, q.id));
      await logEvent(c.tx, rc.req, c.auth.user.id, `انتهت صلاحية العرض ${q.number} (نسخة ${q.version}) قبل الرد عليه`);
      if (rc.req.assignedToUserId) await notify(rc.req.assignedToUserId, "request.status", { number: rc.req.number, status: `انتهت صلاحية العرض ${q.number} — حاول العميل الرد عليه` }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}#quote`, tx: c.tx });
      return { error: "انتهت صلاحية هذا العرض ولا يمكن قبوله. أبلغنا الفريق ليصدر لك نسخة جديدة." };
    }
    if (d.decision !== "accept" && d.note.length < 5) throw new UserError(d.decision === "change" ? "اكتب التعديل الذي تطلبه." : "اكتب سبب الرفض.");
    if (d.decision === "accept" && d.hash && d.hash !== q.contentHash) throw new UserError("تغيّر العرض المعروض. أعد تحميل الصفحة وراجعه من جديد.");
    const now = new Date();
    const status = d.decision === "accept" ? "accepted" : d.decision === "reject" ? "rejected" : "change_requested";
    await c.tx.update(quotes).set({ status, respondedBy: c.auth.user.id, respondedAt: now, responseNote: d.note || null }).where(and(eq(quotes.id, q.id), eq(quotes.status, "sent")));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: `quotes.${status}`, entityType: "quote", entityId: q.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: q.number, version: q.version, contentHash: q.contentHash, note: d.note || undefined } });
    const label = { accepted: "قبل العميل", rejected: "رفض العميل", change_requested: "طلب العميل تعديل" }[status];
    if (status === "accepted" && q.kind === "initial" && rc.req.status === "quote") {
      await c.tx.update(serviceRequests).set({ agreedPrice: q.net, quoteAmount: q.net, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, rc.req.id));
      const fresh = await loadRequestCtx(c.tx, c.auth, rc.req.id, "client");
      await transition(c, fresh, { to: "awaiting_contract", note: `${label} العرض ${q.number} (نسخة ${q.version}) — ${fmtSAR(q.total)} شامل الضريبة` });
    } else {
      if (status === "accepted" && q.kind === "initial") await c.tx.update(serviceRequests).set({ agreedPrice: q.net, quoteAmount: q.net, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, rc.req.id));
      await logEvent(c.tx, rc.req, c.auth.user.id, `${label} ${q.kind === "amendment" ? "ملحق التعديل" : "العرض"} ${q.number} (نسخة ${q.version})${d.note ? ` — ${d.note}` : ""}`);
      if (rc.req.assignedToUserId) await notify(rc.req.assignedToUserId, "request.status", { number: rc.req.number, status: `${label} العرض ${q.number}${d.note ? `: ${d.note}` : ""}` }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}#quote`, tx: c.tx });
    }
    return { ok: true, message: status === "accepted" ? "سُجّل قبولك للعرض. يُعدّ العقد الآن." : status === "rejected" ? "سُجّل رفضك للعرض." : "أُرسل طلب التعديل إلى الفريق." };
  });
  return revalidated(res, reqId);
}

async function revalidated(res: ActionState, reqId: string) {
  if (reqId) {
    const { revalidatePath } = await import("next/cache");
    for (const p of reval(reqId)) revalidatePath(p);
  }
  return res;
}
