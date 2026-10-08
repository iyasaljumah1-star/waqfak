"use server";

/** Deed & versions, conditions catalog, interpretations (never auto-ruled), exceptions, revenue allocation, approvals. */
import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { approvals, conditionInterpretations, conditions, deedVersions, revenueAllocations, waqfDeeds, waqfExceptions, waqfs } from "../../db/schema";
import { audit } from "../../lib/audit";
import { UserError } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { optDate, optMoney, optPct, optText, reqText } from "../waqf-file/form";
import { addTimeline, assertFound, fileAction } from "../waqf-file/guard";
import { CONDITION_CATEGORIES } from "../waqf-file/labels";
import { validateAllocation } from "./pure";

const meta = (c: { ip: string; userAgent: string }) => ({ ip: c.ip, userAgent: c.userAgent });
const optUuid = z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null);

// ───────────── Deed record & versions ─────────────
const deedSchema = z.object({
  deedNo: optText(60),
  issuer: optText(160),
  issuedOnHijri: optText(40),
  issuedOn: optDate,
  status: z.enum(["draft", "documented", "amended"], { error: "اختر حالة الوثيقة." }),
});

export async function saveDeed(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, deedSchema, "deed.edit", async (c, d) => {
    const w = c.access.waqf;
    const [cur] = await c.tx.select().from(waqfDeeds).where(eq(waqfDeeds.waqfId, w.id)).orderBy(desc(waqfDeeds.createdAt)).limit(1);
    let id: string;
    if (cur) {
      await c.tx.update(waqfDeeds).set({ ...d, updatedBy: c.auth.user.id }).where(eq(waqfDeeds.id, cur.id));
      id = cur.id;
    } else {
      const [n] = await c.tx.insert(waqfDeeds).values({ ...d, waqfId: w.id, currentVersion: 0, createdBy: c.auth.user.id, updatedBy: c.auth.user.id }).returning({ id: waqfDeeds.id });
      id = n.id;
    }
    // Keep the waqf profile's deed reference in step (dates of documentation stay on the profile form, which drives obligations).
    const patch: Partial<typeof waqfs.$inferInsert> = {};
    if (d.deedNo && d.deedNo !== w.deedNo) patch.deedNo = d.deedNo;
    if (d.issuer && d.issuer !== w.deedIssuer) patch.deedIssuer = d.issuer;
    if (d.issuedOn && d.issuedOn !== w.deedDate) patch.deedDate = d.issuedOn;
    if (d.issuedOnHijri && d.issuedOnHijri !== w.deedDateHijri) patch.deedDateHijri = d.issuedOnHijri;
    if (Object.keys(patch).length) await c.tx.update(waqfs).set({ ...patch, updatedBy: c.auth.user.id }).where(eq(waqfs.id, w.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: cur ? "deed.updated" : "deed.created", entityType: "waqf_deed", entityId: id, waqfId: w.id, ...meta(c), before: cur ?? null, after: d });
    const note = d.status === "documented" && !w.documentedOn ? " أدخل تاريخ التوثيق في البيانات الأساسية ليُحسب التزام التسجيل." : "";
    return { ok: true, message: `حُفظت بيانات الوثيقة.${note}` };
  }, "deed");
}

const versionSchema = z.object({ body: reqText(60000, "الصق نص الوثيقة أو البند المعدل.", 20), changeNote: reqText(500, "اذكر سبب الإصدار أو ما تغيّر.") });

export async function addDeedVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, versionSchema, "deed.edit", async (c, d) => {
    const w = c.access.waqf;
    let [deed] = await c.tx.select().from(waqfDeeds).where(eq(waqfDeeds.waqfId, w.id)).orderBy(desc(waqfDeeds.createdAt)).limit(1);
    if (!deed) [deed] = await c.tx.insert(waqfDeeds).values({ waqfId: w.id, deedNo: w.deedNo, issuer: w.deedIssuer, issuedOn: w.deedDate, issuedOnHijri: w.deedDateHijri, status: w.documentedOn ? "documented" : "draft", currentVersion: 0, createdBy: c.auth.user.id }).returning();
    const [m] = await c.tx.select({ v: max(deedVersions.version) }).from(deedVersions).where(eq(deedVersions.deedId, deed.id));
    const version = Number(m?.v ?? 0) + 1;
    const [v] = await c.tx.insert(deedVersions).values({ deedId: deed.id, waqfId: w.id, version, body: d.body, changeNote: d.changeNote, createdBy: c.auth.user.id }).returning({ id: deedVersions.id });
    await c.tx.update(waqfDeeds).set({ currentVersion: version, status: version > 1 && deed.status === "documented" ? "amended" : deed.status, updatedBy: c.auth.user.id }).where(eq(waqfDeeds.id, deed.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.version_added", entityType: "deed_version", entityId: v.id, waqfId: w.id, ...meta(c), after: { version, changeNote: d.changeNote, length: d.body.length } });
    await addTimeline(c.tx, w, c.auth.user.id, "deed_version", `إصدار ${version} من وثيقة الوقف`, d.changeNote);
    return { ok: true, message: `حُفظ الإصدار ${version}.${version > 1 ? " تعديل شروط الوقف بعد انعقاده يحتاج حكمًا من المحكمة المختصة؛ تأكد من إرفاقه." : ""}` };
  }, "deed");
}

// ───────────── Conditions ─────────────
const conditionSchema = z.object({
  conditionId: optUuid,
  category: z.enum(CONDITION_CATEGORIES as [string, ...string[]], { error: "اختر فئة الشرط." }),
  clauseRef: optText(60),
  literalText: reqText(4000, "انسخ نص الشرط كما ورد في الوثيقة.", 5),
  position: z.coerce.number().int().min(0).max(999).default(0),
});

export async function saveCondition(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, conditionSchema, "deed.edit", async (c, d) => {
    const w = c.access.waqf;
    const { conditionId, ...vals } = d;
    const values = { ...vals, category: vals.category as (typeof conditions.$inferInsert)["category"] };
    if (conditionId) {
      const [cur] = await c.tx.select().from(conditions).where(and(eq(conditions.id, conditionId), eq(conditions.waqfId, w.id))).limit(1);
      assertFound(cur);
      const textChanged = cur!.literalText !== values.literalText;
      // A changed literal text invalidates any earlier Sharia review of it.
      await c.tx.update(conditions).set({ ...values, shariaReview: textChanged ? "not_reviewed" : cur!.shariaReview, updatedBy: c.auth.user.id }).where(eq(conditions.id, conditionId));
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.condition_updated", entityType: "condition", entityId: conditionId, waqfId: w.id, ...meta(c), before: { category: cur!.category, clauseRef: cur!.clauseRef, literalText: cur!.literalText }, after: values });
      return { ok: true, message: textChanged ? "حُفظ الشرط. تغيّر نصه فأُعيدت حالة مراجعته الشرعية إلى «لم يراجع»." : "حُفظ الشرط." };
    }
    const [n] = await c.tx.insert(conditions).values({ ...values, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: conditions.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.condition_added", entityType: "condition", entityId: n.id, waqfId: w.id, ...meta(c), after: values });
    return { ok: true, message: "أُضيف الشرط إلى الفهرس." };
  }, "deed");
}

const reviewSchema = z.object({
  conditionId: z.uuid(),
  shariaReview: z.enum(["not_reviewed", "approved", "needs_amendment", "possibly_void"]),
  reviewer: optText(200),
  reference: optText(200),
}).superRefine((d, ctx) => {
  if (d.shariaReview !== "not_reviewed" && !d.reviewer) ctx.addIssue({ code: "custom", path: ["reviewer"], message: "اكتب اسم المختص الشرعي الذي أصدر الرأي." });
});

/** Records the outcome of a Sharia review given by a qualified person. The platform never rules on a condition itself. */
export async function recordShariaReview(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, reviewSchema, "deed.edit", async (c, d) => {
    const w = c.access.waqf;
    const [cur] = await c.tx.select().from(conditions).where(and(eq(conditions.id, d.conditionId), eq(conditions.waqfId, w.id))).limit(1);
    assertFound(cur);
    await c.tx.update(conditions).set({ shariaReview: d.shariaReview, updatedBy: c.auth.user.id }).where(eq(conditions.id, d.conditionId));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.sharia_review_recorded", entityType: "condition", entityId: d.conditionId, waqfId: w.id, ...meta(c), before: { shariaReview: cur!.shariaReview }, after: d });
    return { ok: true, message: "سُجّلت نتيجة المراجعة الشرعية كما وردت من المختص." };
  }, "deed");
}

const interpSchema = z.object({
  conditionId: z.uuid(),
  text: reqText(4000, "اكتب نص التفسير.", 5),
  source: z.enum(["founder", "court", "advisor"], { error: "اختر مصدر التفسير." }),
  signedBy: reqText(200, "اكتب اسم من صدر عنه التفسير."),
  decidedOn: optDate,
  documentRef: optText(200),
});

export async function addInterpretation(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, interpSchema, "conditions.interpret", async (c, d) => {
    const w = c.access.waqf;
    const [cur] = await c.tx.select().from(conditions).where(and(eq(conditions.id, d.conditionId), eq(conditions.waqfId, w.id))).limit(1);
    assertFound(cur);
    const [i] = await c.tx
      .insert(conditionInterpretations)
      .values({ conditionId: d.conditionId, waqfId: w.id, text: d.documentRef ? `${d.text}\n(المرجع: ${d.documentRef})` : d.text, source: d.source, signedBy: d.signedBy, decidedOn: d.decidedOn, createdBy: c.auth.user.id })
      .returning({ id: conditionInterpretations.id });
    await c.tx.update(conditions).set({ interpretation: d.text, interpretationSource: d.source, updatedBy: c.auth.user.id }).where(eq(conditions.id, d.conditionId));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.interpretation_added", entityType: "condition_interpretation", entityId: i.id, waqfId: w.id, ...meta(c), after: d });
    return { ok: true, message: "سُجّل التفسير. يبقى معلّمًا بأنه يحتاج اعتماد مختص شرعي حتى تُسجّل نتيجة المراجعة." };
  }, "deed");
}

// ───────────── Exceptions (what the founder kept for himself) ─────────────
const exceptionSchema = z.object({
  beneficiaryName: reqText(200, "اكتب اسم المستثنى له."),
  kind: z.enum(["usufruct", "yield", "quantity"], { error: "اختر نوع الاستثناء." }),
  duration: z.enum(["life", "until_date"], { error: "اختر المدة." }),
  untilDate: optDate,
  quantity: optText(200),
  afterwards: optText(500),
}).superRefine((d, ctx) => {
  if (d.duration === "until_date" && !d.untilDate) ctx.addIssue({ code: "custom", path: ["untilDate"], message: "أدخل تاريخ نهاية الاستثناء." });
  if (d.kind === "quantity" && !d.quantity) ctx.addIssue({ code: "custom", path: ["quantity"], message: "حدّد المقدار المستثنى." });
});

export async function addException(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, exceptionSchema, "deed.edit", async (c, d) => {
    const [e] = await c.tx.insert(waqfExceptions).values({ ...d, waqfId: c.access.waqf.id, createdBy: c.auth.user.id }).returning({ id: waqfExceptions.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.exception_added", entityType: "waqf_exception", entityId: e.id, waqfId: c.access.waqf.id, ...meta(c), after: d });
    return { ok: true, message: "أُضيف الاستثناء." };
  }, "deed");
}

export async function removeException(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ exceptionId: z.uuid() }), "deed.edit", async (c, d) => {
    const [e] = await c.tx.delete(waqfExceptions).where(and(eq(waqfExceptions.id, d.exceptionId), eq(waqfExceptions.waqfId, c.access.waqf.id))).returning();
    assertFound(e);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.exception_removed", entityType: "waqf_exception", entityId: d.exceptionId, waqfId: c.access.waqf.id, ...meta(c), before: e });
    return { ok: true, message: "حُذف الاستثناء." };
  }, "deed");
}

// ───────────── Revenue allocation ─────────────
const allocSchema = z.object({
  maintenancePct: optPct, developmentPct: optPct, reinvestPct: optPct, reservePct: optPct, nazirFeePct: optPct, adminPct: optPct,
  nazirFeeFixed: optMoney, notes: optText(2000),
});

export async function saveAllocation(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, allocSchema, "deed.edit", async (c, d) => {
    const v = validateAllocation(d);
    if (!v.ok) return { error: v.error };
    const w = c.access.waqf;
    const [cur] = await c.tx.select().from(revenueAllocations).where(eq(revenueAllocations.waqfId, w.id)).limit(1);
    if (cur) await c.tx.update(revenueAllocations).set({ ...d, updatedBy: c.auth.user.id }).where(eq(revenueAllocations.waqfId, w.id));
    else await c.tx.insert(revenueAllocations).values({ ...d, waqfId: w.id, createdBy: c.auth.user.id, updatedBy: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.allocation_saved", entityType: "revenue_allocation", entityId: w.id, waqfId: w.id, ...meta(c), before: cur ?? null, after: d });
    return { ok: true, message: `حُفظ توزيع الغلة. نصيب المستفيدين ${v.beneficiariesPct}% من صافي الغلة.` };
  }, "deed");
}

// ───────────── Approvals from the competent authority / GAA / court ─────────────
const approvalSchema = z.object({
  approvalId: optUuid,
  kind: z.enum(["substitution", "mortgage", "condition_deviation", "interpretation", "nazir_fee", "donations", "merger", "long_lease", "other"], { error: "اختر نوع الإذن." }),
  authority: z.enum(["competent_authority", "gaa", "court", "cma", "fiu", "notary", "internal"], { error: "اختر الجهة." }),
  status: z.enum(["draft", "submitted", "granted", "rejected", "withdrawn"], { error: "اختر الحالة." }),
  subject: reqText(500, "اكتب موضوع الإذن."),
  refNo: optText(80),
  submittedOn: optDate,
  decidedOn: optDate,
  assetId: optUuid,
  notes: optText(2000),
}).superRefine((d, ctx) => {
  if ((d.status === "granted" || d.status === "rejected") && !d.decidedOn) ctx.addIssue({ code: "custom", path: ["decidedOn"], message: "أدخل تاريخ القرار." });
});

export async function saveApproval(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, approvalSchema, "deed.edit", async (c, d) => {
    const w = c.access.waqf;
    const { approvalId, ...values } = d;
    if (approvalId) {
      const [cur] = await c.tx.select().from(approvals).where(and(eq(approvals.id, approvalId), eq(approvals.waqfId, w.id))).limit(1);
      assertFound(cur);
      if (cur!.status === "granted" && d.status !== "granted") throw new UserError("الإذن الصادر لا يُعدّل؛ سجّل طلبًا جديدًا إن تغير شيء.");
      await c.tx.update(approvals).set({ ...values, updatedBy: c.auth.user.id }).where(eq(approvals.id, approvalId));
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.approval_updated", entityType: "approval", entityId: approvalId, waqfId: w.id, ...meta(c), before: { status: cur!.status }, after: values });
    } else {
      const [a] = await c.tx.insert(approvals).values({ ...values, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: approvals.id });
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "deed.approval_created", entityType: "approval", entityId: a.id, waqfId: w.id, ...meta(c), after: values });
    }
    if (d.status === "granted") await addTimeline(c.tx, w, c.auth.user.id, "note", `صدور إذن: ${d.subject}`, d.refNo ? `رقم ${d.refNo}` : null, d.decidedOn ?? undefined);
    return { ok: true, message: "حُفظ الإذن." };
  }, "deed");
}
