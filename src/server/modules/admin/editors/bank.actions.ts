"use server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assessmentAxes, assessmentQuestions, assessments, criticalFlagDefs, questionBankVersions } from "@/server/db/schema";
import { parseForm, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import type { Tx } from "@/server/db";
import { log, staffAction } from "./guard";
import { code, formObj, optInt, optText, reqText, uuid } from "./form-utils";
import { bankPublishProblems, parseJson, parseLogic, validateOptions, weightSums } from "./pure";

const P = "/admin/question-bank";

async function draftVersion(tx: Tx, id: string) {
  const [v] = await tx.select().from(questionBankVersions).where(eq(questionBankVersions.id, id)).limit(1);
  if (!v) throw new UserError("نسخة بنك الأسئلة غير موجودة.");
  if (v.status !== "draft") throw new UserError(`النسخة ${v.version} ${v.status === "published" ? "منشورة" : "متقاعدة"} ولا تُعدّل. أنشئ نسخة جديدة منها ثم عدّلها.`);
  return v;
}

/** Clones a version (axes + questions) into a new draft with the next version number. */
export async function cloneBankVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const sourceId = String(fd.get("sourceId") ?? "");
  let newId: string | null = null;
  const res = await staffAction("admin.rules", async (c) => {
    const [src] = await c.tx.select().from(questionBankVersions).where(eq(questionBankVersions.id, sourceId)).limit(1);
    if (!src) throw new UserError("النسخة المصدر غير موجودة.");
    await c.tx.execute(sql`select pg_advisory_xact_lock(724611)`);
    const [mx] = await c.tx.select({ v: sql<number>`coalesce(max(${questionBankVersions.version}),0)::int` }).from(questionBankVersions);
    const version = (mx?.v ?? 0) + 1;
    const [nv] = await c.tx
      .insert(questionBankVersions)
      .values({ version, status: "draft", notes: `نسخة منقولة من الإصدار ${src.version}.`, createdBy: c.auth.user.id })
      .returning({ id: questionBankVersions.id });
    const axes = await c.tx.select().from(assessmentAxes).where(eq(assessmentAxes.bankVersionId, src.id));
    if (axes.length) await c.tx.insert(assessmentAxes).values(axes.map(({ id: _id, bankVersionId: _b, ...a }) => ({ ...a, bankVersionId: nv.id })));
    const qs = await c.tx.select().from(assessmentQuestions).where(eq(assessmentQuestions.bankVersionId, src.id));
    for (let i = 0; i < qs.length; i += 100) {
      await c.tx.insert(assessmentQuestions).values(qs.slice(i, i + 100).map(({ id: _id, bankVersionId: _b, ...q }) => ({ ...q, bankVersionId: nv.id })));
    }
    await log(c, "admin.bank.clone", "question_bank_version", nv.id, { from: src.version }, { version, axes: axes.length, questions: qs.length });
    newId = nv.id;
  }, { revalidate: P });
  if (newId) redirect(`${P}/${newId}?created=1`);
  return res;
}

export async function saveBankNotes(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("versionId") ?? "");
  const notes = String(fd.get("notes") ?? "").trim().slice(0, 2000) || null;
  return staffAction("admin.rules", async (c) => {
    const v = await draftVersion(c.tx, id);
    await c.tx.update(questionBankVersions).set({ notes, updatedBy: c.auth.user.id }).where(eq(questionBankVersions.id, id));
    await log(c, "admin.bank.notes", "question_bank_version", id, { notes: v.notes }, { notes });
    return { ok: true, message: "حُفظت الملاحظات." };
  }, { revalidate: `${P}/${id}` });
}

export async function deleteBankDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("versionId") ?? "");
  const res = await staffAction("admin.rules", async (c) => {
    const v = await draftVersion(c.tx, id);
    const [used] = await c.tx.select({ n: sql<number>`count(*)::int` }).from(assessments).where(eq(assessments.bankVersionId, id));
    if (used?.n) throw new UserError("هذه المسودة مستخدمة في تقييمات ولا تُحذف.");
    await c.tx.delete(questionBankVersions).where(eq(questionBankVersions.id, id));
    await log(c, "admin.bank.delete_draft", "question_bank_version", id, { version: v.version }, null);
  }, { revalidate: P });
  if (res.ok) redirect(`${P}?deleted=1`);
  return res;
}

/**
 * Publishes a draft after validation (weights sum to 100 per size class, valid JSON-logic, options, flags).
 * The new version becomes the active bank for new assessments; earlier published versions are retired
 * (assessments already started keep the version they were taken on).
 */
export async function publishBankVersion(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("versionId") ?? "");
  const res = await staffAction("admin.rules", async (c) => {
    const v = await draftVersion(c.tx, id);
    const axes = await c.tx.select().from(assessmentAxes).where(eq(assessmentAxes.bankVersionId, id));
    const qs = await c.tx.select().from(assessmentQuestions).where(eq(assessmentQuestions.bankVersionId, id));
    const flags = await c.tx.select({ code: criticalFlagDefs.code }).from(criticalFlagDefs);
    const problems = bankPublishProblems(axes, qs, flags.map((f) => f.code));
    if (problems.length) throw new UserError(`أصلح ما يلي قبل النشر: ${problems.slice(0, 6).join(" — ")}${problems.length > 6 ? ` (و${problems.length - 6} أخرى)` : ""}`);
    const now = new Date();
    const prev = await c.tx.select({ id: questionBankVersions.id, version: questionBankVersions.version }).from(questionBankVersions).where(and(eq(questionBankVersions.status, "published"), ne(questionBankVersions.id, id)));
    await c.tx.update(questionBankVersions).set({ status: "retired", updatedBy: c.auth.user.id }).where(and(eq(questionBankVersions.status, "published"), ne(questionBankVersions.id, id)));
    // The active bank is the highest published version; make sure this one wins even if an older draft is published later.
    const [mx] = await c.tx.select({ v: questionBankVersions.version }).from(questionBankVersions).orderBy(desc(questionBankVersions.version)).limit(1);
    await c.tx.update(questionBankVersions).set({ status: "published", publishedAt: now, publishedBy: c.auth.user.id, updatedBy: c.auth.user.id }).where(eq(questionBankVersions.id, id));
    await log(c, "admin.bank.publish", "question_bank_version", id, { status: "draft", retired: prev.map((p) => p.version) }, { status: "published", version: v.version, highest: mx?.v });
    return { ok: true, message: `نُشرت النسخة ${v.version} وأصبحت المعتمدة للتقييمات الجديدة.` };
  }, { revalidate: [P, `${P}/${id}`] });
  if (res.ok && res.message) redirect(`${P}/${id}?saved=${encodeURIComponent(res.message)}`);
  return res;
}

// ───────────── Axes ─────────────

const weight = (label: string) => z.string().trim().min(1, `أدخل وزن ${label}.`).transform(Number).refine((n) => Number.isFinite(n) && n >= 0 && n <= 100, "الوزن بين 0 و100.");
const axisSchema = z.object({
  versionId: uuid,
  axisId: z.string().optional(),
  code: z.string().trim().toUpperCase().regex(/^A\d{1,2}$/, "رمز المحور مثل A12."),
  nameAr: reqText(3, "اكتب اسم المحور.", 200),
  description: optText(1000),
  weightSmall: weight("الصغير"),
  weightMedium: weight("المتوسط"),
  weightLarge: weight("الكبير"),
  position: optInt(0, 1000),
});

export async function saveAxis(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(axisSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return staffAction("admin.rules", async (c) => {
    await draftVersion(c.tx, d.versionId);
    const [dup] = await c.tx.select({ id: assessmentAxes.id }).from(assessmentAxes).where(and(eq(assessmentAxes.bankVersionId, d.versionId), eq(assessmentAxes.code, d.code), d.axisId ? ne(assessmentAxes.id, d.axisId) : undefined)).limit(1);
    if (dup) throw new UserError(`المحور ${d.code} موجود في هذه النسخة.`);
    const values = { code: d.code, nameAr: d.nameAr, description: d.description, weightSmall: String(d.weightSmall), weightMedium: String(d.weightMedium), weightLarge: String(d.weightLarge) };
    if (d.axisId) {
      const [before] = await c.tx.select().from(assessmentAxes).where(and(eq(assessmentAxes.id, d.axisId), eq(assessmentAxes.bankVersionId, d.versionId))).limit(1);
      if (!before) throw new UserError("المحور غير موجود.");
      if (before.code !== d.code) {
        const [usedBy] = await c.tx.select({ n: sql<number>`count(*)::int` }).from(assessmentQuestions).where(and(eq(assessmentQuestions.bankVersionId, d.versionId), eq(assessmentQuestions.axisCode, before.code)));
        if (usedBy?.n) throw new UserError(`لا يُغيّر رمز المحور ${before.code} لأن ${usedBy.n} سؤالًا مرتبطة به.`);
      }
      await c.tx.update(assessmentAxes).set({ ...values, position: d.position ?? before.position }).where(eq(assessmentAxes.id, d.axisId));
      await log(c, "admin.bank.axis_update", "assessment_axis", d.axisId, before, values);
    } else {
      const [mx] = await c.tx.select({ p: sql<number>`coalesce(max(${assessmentAxes.position}),0)::int` }).from(assessmentAxes).where(eq(assessmentAxes.bankVersionId, d.versionId));
      const [row] = await c.tx.insert(assessmentAxes).values({ ...values, bankVersionId: d.versionId, position: d.position ?? (mx?.p ?? 0) + 1 }).returning({ id: assessmentAxes.id });
      await log(c, "admin.bank.axis_create", "assessment_axis", row.id, null, values);
    }
    const all = await c.tx.select().from(assessmentAxes).where(eq(assessmentAxes.bankVersionId, d.versionId));
    const w = weightSums(all);
    return { ok: true, message: w.ok ? "حُفظ المحور. مجموع الأوزان 100 لكل فئة." : `حُفظ المحور. انتبه: مجموع الأوزان صغير ${w.small}، متوسط ${w.medium}، كبير ${w.large} — يجب أن يكون 100 قبل النشر.` };
  }, { revalidate: `${P}/${d.versionId}` });
}

export async function deleteAxis(_: ActionState, fd: FormData): Promise<ActionState> {
  const versionId = String(fd.get("versionId") ?? "");
  const axisId = String(fd.get("axisId") ?? "");
  return staffAction("admin.rules", async (c) => {
    await draftVersion(c.tx, versionId);
    const [a] = await c.tx.select().from(assessmentAxes).where(and(eq(assessmentAxes.id, axisId), eq(assessmentAxes.bankVersionId, versionId))).limit(1);
    if (!a) throw new UserError("المحور غير موجود.");
    const [usedBy] = await c.tx.select({ n: sql<number>`count(*)::int` }).from(assessmentQuestions).where(and(eq(assessmentQuestions.bankVersionId, versionId), eq(assessmentQuestions.axisCode, a.code)));
    if (usedBy?.n) throw new UserError(`انقل أسئلة المحور ${a.code} (${usedBy.n}) أو احذفها أولًا.`);
    await c.tx.delete(assessmentAxes).where(eq(assessmentAxes.id, axisId));
    await log(c, "admin.bank.axis_delete", "assessment_axis", axisId, a, null);
    return { ok: true, message: "حُذف المحور." };
  }, { revalidate: `${P}/${versionId}` });
}

// ───────────── Questions ─────────────

const questionSchema = z.object({
  versionId: uuid,
  questionId: z.string().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9-]{1,15}$/, "رمز السؤال مثل A5-07."),
  axisCode: z.string().trim().min(1, "اختر المحور."),
  textAr: reqText(5, "اكتب نص السؤال.", 500),
  helpAr: optText(1000),
  answerType: z.enum(["yes_no", "yes_partial_no", "maturity", "band", "date", "select", "multiselect", "number", "text"], { error: "اختر نوع الإجابة." }),
  options: z.string().optional(),
  weight: z.string().trim().transform(Number).refine((n) => Number.isInteger(n) && n >= 0 && n <= 10, "الوزن عدد صحيح بين 0 و10."),
  referenceText: optText(500),
  criticalFlagCode: optText(20),
  criticalWhen: z.string().optional(),
  showIf: z.string().optional(),
  factKey: z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^[a-z][a-z0-9_]{1,59}$/.test(v), "مفتاح الحقيقة بحروف إنجليزية صغيرة و_ مثل has_bank_account."),
  depth: z.enum(["basic", "deep"]),
  position: optInt(0, 100000),
});

export async function saveQuestion(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(questionSchema, formObj(fd));
  if ("state" in r) return r.state;
  const d = r.data;
  const fe: Record<string, string> = {};
  const showIf = parseLogic(d.showIf, { optional: true, label: "شرط الظهور" });
  if (!showIf.ok) fe.showIf = showIf.error;
  const critWhen = parseLogic(d.criticalWhen, { optional: true, label: "شرط الإشارة الحرجة" });
  if (!critWhen.ok) fe.criticalWhen = critWhen.error;
  let options: unknown = null;
  if (d.options && d.options.trim() && d.options.trim() !== "[]") {
    const j = parseJson(d.options, "الخيارات");
    if (!j.ok) fe.options = j.error;
    else options = j.value;
  }
  const opt = validateOptions(d.answerType, options);
  if (!opt.ok) fe.options = opt.error;
  if (critWhen.ok && critWhen.value && !d.criticalFlagCode) fe.criticalFlagCode = "اختر الإشارة الحرجة التي يرفعها هذا الشرط.";
  if (Object.keys(fe).length) return { error: Object.values(fe)[0], fieldErrors: fe };
  let newId: string | null = null;
  const res = await staffAction("admin.rules", async (c) => {
    await draftVersion(c.tx, d.versionId);
    if (d.axisCode !== "P") {
      const [ax] = await c.tx.select({ id: assessmentAxes.id }).from(assessmentAxes).where(and(eq(assessmentAxes.bankVersionId, d.versionId), eq(assessmentAxes.code, d.axisCode))).limit(1);
      if (!ax) throw new UserError(`المحور ${d.axisCode} غير موجود في هذه النسخة.`);
    }
    if (d.criticalFlagCode) {
      const [f] = await c.tx.select({ code: criticalFlagDefs.code }).from(criticalFlagDefs).where(eq(criticalFlagDefs.code, d.criticalFlagCode)).limit(1);
      if (!f) throw new UserError(`الإشارة الحرجة ${d.criticalFlagCode} غير معرّفة. عرّفها أولًا في صفحة الإشارات الحرجة.`);
    }
    const [dup] = await c.tx.select({ id: assessmentQuestions.id }).from(assessmentQuestions).where(and(eq(assessmentQuestions.bankVersionId, d.versionId), eq(assessmentQuestions.code, d.code), d.questionId ? ne(assessmentQuestions.id, d.questionId) : undefined)).limit(1);
    if (dup) throw new UserError(`الرمز ${d.code} مستخدم لسؤال آخر في هذه النسخة.`);
    const values = {
      code: d.code, axisCode: d.axisCode, textAr: d.textAr, helpAr: d.helpAr, answerType: d.answerType, options: opt.ok ? opt.value : null, weight: d.weight,
      referenceText: d.referenceText, criticalFlagCode: d.criticalFlagCode, criticalWhen: critWhen.ok ? critWhen.value : null, showIf: showIf.ok ? showIf.value : null,
      factKey: d.factKey, depth: d.depth,
    };
    if (d.questionId) {
      const [before] = await c.tx.select().from(assessmentQuestions).where(and(eq(assessmentQuestions.id, d.questionId), eq(assessmentQuestions.bankVersionId, d.versionId))).limit(1);
      if (!before) throw new UserError("السؤال غير موجود.");
      await c.tx.update(assessmentQuestions).set({ ...values, position: d.position ?? before.position }).where(eq(assessmentQuestions.id, d.questionId));
      await log(c, "admin.bank.question_update", "assessment_question", d.questionId, before, values);
      return { ok: true, message: "حُفظ السؤال." };
    }
    const [mx] = await c.tx.select({ p: sql<number>`coalesce(max(${assessmentQuestions.position}),0)::int` }).from(assessmentQuestions).where(eq(assessmentQuestions.bankVersionId, d.versionId));
    const [row] = await c.tx.insert(assessmentQuestions).values({ ...values, bankVersionId: d.versionId, position: d.position ?? (mx?.p ?? 0) + 10 }).returning({ id: assessmentQuestions.id });
    await log(c, "admin.bank.question_create", "assessment_question", row.id, null, values);
    newId = row.id;
  }, { revalidate: [`${P}/${d.versionId}`, ...(d.questionId ? [`${P}/${d.versionId}/questions/${d.questionId}`] : [])] });
  if (newId) redirect(`${P}/${d.versionId}/questions/${newId}?created=1`);
  return res;
}

export async function deleteQuestion(_: ActionState, fd: FormData): Promise<ActionState> {
  const versionId = String(fd.get("versionId") ?? "");
  const questionId = String(fd.get("questionId") ?? "");
  const res = await staffAction("admin.rules", async (c) => {
    await draftVersion(c.tx, versionId);
    const [q] = await c.tx.select().from(assessmentQuestions).where(and(eq(assessmentQuestions.id, questionId), eq(assessmentQuestions.bankVersionId, versionId))).limit(1);
    if (!q) throw new UserError("السؤال غير موجود.");
    await c.tx.delete(assessmentQuestions).where(eq(assessmentQuestions.id, questionId));
    await log(c, "admin.bank.question_delete", "assessment_question", questionId, q, null);
  }, { revalidate: `${P}/${versionId}` });
  if (res.ok) redirect(`${P}/${versionId}?deleted=1`);
  return res;
}

// ───────────── Critical flags ─────────────

const flagSchema = z.object({
  isNew: z.string().optional(),
  code: code("رمز الإشارة مثل R15."),
  titleAr: reqText(5, "اكتب عنوان الإشارة.", 300),
  referenceText: reqText(3, "اكتب المرجع النظامي.", 500),
  penaltyText: optText(500),
  penaltyCode: optText(20),
  axisCode: optText(5),
  actionAr: optText(1000),
  severity: z.enum(["critical", "high", "medium", "low"]),
  active: z.string().optional().transform((v) => v === "on"),
});

export async function saveFlagDef(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(flagSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let created = false;
  const res = await staffAction("admin.rules", async (c) => {
    const [before] = await c.tx.select().from(criticalFlagDefs).where(eq(criticalFlagDefs.code, d.code)).limit(1);
    if (d.isNew && before) throw new UserError(`الإشارة ${d.code} موجودة.`);
    const values = { titleAr: d.titleAr, referenceText: d.referenceText, penaltyText: d.penaltyText, penaltyCode: d.penaltyCode, axisCode: d.axisCode, actionAr: d.actionAr, severity: d.severity, active: d.active };
    if (before) {
      await c.tx.update(criticalFlagDefs).set(values).where(eq(criticalFlagDefs.code, d.code));
      await log(c, "admin.flag.update", "critical_flag_def", d.code, before, values);
      return { ok: true, message: "حُفظت الإشارة. تُطبّق في الحساب التالي لأي تقييم." };
    }
    await c.tx.insert(criticalFlagDefs).values({ code: d.code, ...values });
    await log(c, "admin.flag.create", "critical_flag_def", d.code, null, values);
    created = true;
  }, { revalidate: [`${P}/flags`, `${P}/flags/${d.code}`] });
  if (created) redirect(`${P}/flags/${encodeURIComponent(d.code)}?created=1`);
  return res;
}
