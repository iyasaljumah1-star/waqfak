"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { dataConflicts, documents, outputOfficialRecords, outputReviews, outputs, requestItems } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { raiseItem } from "@/server/modules/requests/items-actions";
import type { ActionState } from "@/lib/utils";
import { todayISO } from "@/server/engines/dates";
import { citationOf } from "./citations";
import { checksOf } from "./quality";
import { versionOf } from "./server";

/**
 * The specialist's part of a draft, recorded — never inferred: findings on checks the platform cannot decide, the
 * review of each clause's source, and the official documentation once it actually happened. The client correction
 * path for a conflict goes through the deficiencies register (a data item the client answers).
 */

const uuid = z.string().uuid("قيمة غير صالحة.");
const reval = (id: string) => [`/admin/requests/${id}`, "/admin"];

async function outputFor(tx: Parameters<Parameters<typeof userAction>[0]>[0]["tx"], auth: Parameters<Parameters<typeof userAction>[0]>[0]["auth"], outputId: string, requestId: string) {
  const rc = await loadRequestCtx(tx, auth, requestId, "staff");
  if (!rc.staffSide) throw new ForbiddenError();
  const [o] = await tx.select().from(outputs).where(and(eq(outputs.id, outputId), eq(outputs.requestId, requestId))).limit(1).for("update");
  if (!o) throw new UserError("المخرج غير موجود أو لا تملك صلاحية الوصول إليه.");
  return { rc, o };
}

const reviewer = (perms: Set<string>) => perms.has("staff.quality_review") || perms.has("admin.requests.all") || perms.has("approvals.direct");

// ───────────────────────── findings on checks ─────────────────────────

const findingSchema = z.object({
  outputId: uuid, requestId: uuid, key: z.string().min(2).max(60),
  status: z.enum(["verified", "failed", "na"], { message: "اختر رأيك في الفحص." }),
  note: z.string().trim().min(10, "اكتب سند رأيك (10 أحرف على الأقل).").max(3000),
});

export async function recordCheckFinding(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(findingSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    if (!reviewer(c.auth.perms)) throw new ForbiddenError("رأي المختص في الفحوص لمن يملك صلاحية المراجعة.");
    const { o } = await outputFor(c.tx, c.auth, d.outputId, d.requestId);
    if (o.status === "approved") throw new UserError("المخرج معتمد: يُفتح للمراجعة أولًا.");
    const cur = await versionOf(c.tx, o.id, o.currentVersion);
    const check = cur ? checksOf(cur.sections).find((x) => x.key === d.key) : undefined;
    if (!check) throw new UserError("الفحص غير موجود في النسخة الحالية.");
    if (check.status !== "specialist" && check.status !== "client_attested") throw new UserError("هذا الفحص آلي النتيجة: يُصحَّح مصدر البيانات لا النتيجة.");
    await c.tx.insert(outputReviews).values({ outputId: o.id, requestId: o.requestId, waqfId: o.waqfId, version: o.currentVersion, kind: "check", targetKey: d.key, status: d.status, note: d.note, createdBy: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.check_finding", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, version: o.currentVersion, check: d.key, status: d.status } });
    return { ok: true, message: "سُجّل رأي المختص في الفحص." };
  }, { revalidate: reval(d.requestId) });
}

// ───────────────────────── review of a clause's source ─────────────────────────

const citationSchema = z.object({
  outputId: uuid, requestId: uuid, clause: z.string().min(2).max(80), ref: z.string().min(2).max(300),
  status: z.enum(["supports", "needs_more", "unavailable", "unverified"], { message: "اختر نتيجة المراجعة." }),
  note: z.string().trim().min(5, "اكتب وجه الاستدلال أو سبب الحكم (5 أحرف على الأقل).").max(3000),
  location: z.string().trim().max(300).optional().default(""),
});

export async function recordCitationReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(citationSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    if (!reviewer(c.auth.perms) && !c.auth.perms.has("staff.deliver")) throw new ForbiddenError();
    const { o } = await outputFor(c.tx, c.auth, d.outputId, d.requestId);
    const cur = await versionOf(c.tx, o.id, o.currentVersion);
    const clause = cur?.sections.flatMap((s) => s.blocks).find((b) => b.type === "clause" && b.key === d.clause);
    if (!clause || clause.type !== "clause" || !(clause.refs ?? []).includes(d.ref)) throw new UserError("المرجع غير مرتبط بهذا البند في النسخة الحالية.");
    await c.tx.insert(outputReviews).values({ outputId: o.id, requestId: o.requestId, waqfId: o.waqfId, version: o.currentVersion, kind: "citation", targetKey: `${d.clause}|${d.ref}`, status: d.status, note: d.note, location: d.location || citationOf(d.ref)?.location || null, createdBy: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.citation_review", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, version: o.currentVersion, clause: d.clause, ref: d.ref, status: d.status } });
    return { ok: true, message: "سُجّلت مراجعة المرجع." };
  }, { revalidate: reval(d.requestId) });
}

// ───────────────────────── official documentation ─────────────────────────

const officialSchema = z.object({
  outputId: uuid, requestId: uuid,
  authority: z.string().trim().min(3, "اذكر الجهة التي وثّقت.").max(200),
  referenceNo: z.string().trim().min(2, "اكتب رقم الوثيقة الرسمية.").max(100),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح."),
  documentId: uuid,
  verified: z.literal("on", { message: "أكّد أنك اطلعت على الوثيقة الرسمية وطابقتها." }),
  note: z.string().trim().max(1000).optional().default(""),
});

/** Records that the approved document was officially documented — only with the instrument itself attached. */
export async function recordOfficialDoc(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(officialSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.issuedOn > todayISO()) return { error: "تاريخ التوثيق في المستقبل.", fieldErrors: { issuedOn: "التوثيق يُسجَّل بعد حصوله." } };
  return userAction(async (c) => {
    if (!reviewer(c.auth.perms)) throw new ForbiddenError("تسجيل التوثيق الرسمي لمن يملك صلاحية المراجعة.");
    const { o, rc } = await outputFor(c.tx, c.auth, d.outputId, d.requestId);
    if (o.status !== "approved" || !o.approvedVersion) throw new UserError("يُسجَّل التوثيق الرسمي لمخرج معتمد.");
    const [doc] = await c.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d.documentId), eq(documents.requestId, rc.req.id))).limit(1);
    if (!doc) throw new UserError("المستند ليس من مستندات هذا الطلب: ارفع الوثيقة الرسمية في الطلب أولًا.");
    await c.tx.insert(outputOfficialRecords).values({ outputId: o.id, requestId: o.requestId, waqfId: o.waqfId, version: o.approvedVersion, authority: d.authority, referenceNo: d.referenceNo, issuedOn: d.issuedOn, documentId: d.documentId, note: d.note || null, createdBy: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.official_record", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, version: o.approvedVersion, authority: d.authority, referenceNo: d.referenceNo, issuedOn: d.issuedOn, documentId: d.documentId } });
    return { ok: true, message: "سُجّل التوثيق الرسمي مع وثيقته." };
  }, { revalidate: reval(d.requestId) });
}

// ───────────────────────── client correction of a conflict ─────────────────────────

const conflictItemSchema = z.object({ requestId: uuid, conflictId: uuid });

/** Asks the client which value is meant (a required data item); the conflict stays open until the data is corrected. */
export async function raiseConflictItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(conflictItemSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let title = "";
  const pre = await userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.requestId, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("يطلب التصحيح المسند إليه الطلب أو مدير التشغيل.");
    const [row] = await c.tx.select().from(dataConflicts).where(and(eq(dataConflicts.id, d.conflictId), eq(dataConflicts.requestId, d.requestId))).limit(1);
    if (!row || row.status !== "open") throw new UserError("التعارض غير قائم.");
    if (row.itemId) throw new UserError("طُلب من العميل تصحيحه سابقًا.");
    title = `تصحيح تعارض: ${row.label}`.slice(0, 200);
    const body = `${row.sides.map((s) => `• ${s.label}: «${s.value}» (${s.source})`).join("\n")}\n\nالمطلوب: ${row.action}`;
    const f = new FormData();
    for (const [k, v] of Object.entries({ id: d.requestId, kind: "data", title, body: body.slice(0, 2000), fieldKey: row.fields[0] ?? "", required: "on", visibility: "client" })) f.set(k, v);
    return { ok: true, data: { form: f } } as ActionState;
  });
  if ("error" in pre && pre.error) return pre;
  const res = await raiseItem(undefined as unknown as ActionState, (pre.data as { form: FormData }).form);
  if ("error" in res && res.error) return res;
  return userAction(async (c) => {
    const [item] = await c.tx.select({ id: requestItems.id }).from(requestItems).where(and(eq(requestItems.requestId, d.requestId), eq(requestItems.title, title))).orderBy(desc(requestItems.seq)).limit(1);
    if (item) await c.tx.update(dataConflicts).set({ itemId: item.id }).where(eq(dataConflicts.id, d.conflictId));
    return { ok: true, message: `${res.message ?? "سُجّل البند."} يبقى التعارض قائمًا حتى تُصحَّح البيانات ويُعاد التحقق.` };
  }, { revalidate: reval(d.requestId) });
}
