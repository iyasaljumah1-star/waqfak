"use server";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { facts as factsTable, needs, recommendationRules, services, settings } from "@/server/db/schema";
import { parseForm, UserError } from "@/server/modules/_shared";
import { activeLicenseKeys, loadActiveRules } from "@/server/modules/assessment/compute";
import { runRules, type RecContext, type Rule, type ServiceInfo } from "@/server/engines/recommendations";
import { evaluate, test as testLogic } from "@/server/engines/logic";
import { todayISO } from "@/server/engines/dates";
import type { ActionState } from "@/lib/utils";
import type { Tx } from "@/server/db";
import { log, staffAction } from "./guard";
import { formObj, optText, reqText } from "./form-utils";
import { parseJson, parseLogic } from "./pure";

const P = "/admin/rules";
const ruleCode = z.string().trim().toUpperCase().regex(/^R-[A-Z]{2,5}-\d{3}$/, "رمز القاعدة بالصيغة R-FIN-012.");

const ruleSchema = z.object({
  ruleId: z.string().optional(),
  code: ruleCode,
  titleAr: reqText(3, "اكتب عنوان التوصية.", 200),
  condition: z.string().optional(),
  needCode: z.string().trim().min(1, "اختر الاحتياج."),
  severity: z.enum(["critical", "high", "medium", "low"], { error: "اختر الخطورة." }),
  urgencyDays: z.string().trim().transform(Number).refine((n) => Number.isInteger(n) && n >= 0 && n <= 3650, "الاستعجال عدد أيام بين 0 و3650."),
  leverage: z.string().trim().transform(Number).refine((n) => Number.isFinite(n) && n >= 0.1 && n <= 5, "الرافعة رقم بين 0.1 و5."),
  reasonAr: reqText(5, "اكتب سبب التوصية كما يراه العميل.", 1000),
  whyItMattersAr: optText(1000),
  reference: optText(500),
  serviceCodes: z.array(z.string()),
  suppressIf: z.string().optional(),
  selfServiceHintAr: optText(1000),
});

function parseRuleForm(fd: FormData) {
  const r = parseForm(ruleSchema, formObj(fd, ["serviceCodes"]));
  if ("state" in r) return r;
  const fe: Record<string, string> = {};
  const cond = parseLogic(r.data.condition, { label: "شرط القاعدة" });
  if (!cond.ok) fe.condition = cond.error;
  const sup = parseLogic(r.data.suppressIf, { optional: true, label: "شرط الكتم" });
  if (!sup.ok) fe.suppressIf = sup.error;
  if (Object.keys(fe).length) return { state: { error: Object.values(fe)[0], fieldErrors: fe } as ActionState };
  return { data: { ...r.data, condition: cond.ok ? cond.value : null, suppressIf: sup.ok ? sup.value : null } };
}

async function checkRefs(tx: Tx, needCode: string, serviceCodes: string[]) {
  const [n] = await tx.select({ code: needs.code }).from(needs).where(eq(needs.code, needCode)).limit(1);
  if (!n) throw new UserError(`الاحتياج ${needCode} غير معرّف.`);
  if (serviceCodes.length) {
    const found = await tx.select({ code: services.code }).from(services).where(inArray(services.code, serviceCodes));
    const missing = serviceCodes.filter((c) => !found.some((f) => f.code === c));
    if (missing.length) throw new UserError(`خدمات غير موجودة: ${missing.join("، ")}.`);
  }
}

/** Creates a new rule (v1 draft) or edits an existing draft version. Published versions are immutable. */
export async function saveRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseRuleForm(fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let created = false;
  const res = await staffAction("admin.rules", async (c) => {
    await checkRefs(c.tx, d.needCode, d.serviceCodes);
    const values = {
      titleAr: d.titleAr, condition: d.condition, needCode: d.needCode, severity: d.severity, urgencyDays: d.urgencyDays, leverage: String(d.leverage),
      reasonAr: d.reasonAr, whyItMattersAr: d.whyItMattersAr, reference: d.reference, serviceCodes: d.serviceCodes, suppressIf: d.suppressIf,
      selfServiceHintAr: d.selfServiceHintAr, updatedBy: c.auth.user.id,
    };
    if (d.ruleId) {
      const [before] = await c.tx.select().from(recommendationRules).where(eq(recommendationRules.id, d.ruleId)).limit(1);
      if (!before || before.code !== d.code) throw new UserError("القاعدة غير موجودة.");
      if (before.status !== "draft") throw new UserError("النسخة المنشورة لا تُعدّل. أنشئ مسودة تعديل جديدة.");
      await c.tx.update(recommendationRules).set(values).where(eq(recommendationRules.id, d.ruleId));
      await log(c, "admin.rule.update", "recommendation_rule", d.ruleId, before, values);
      return { ok: true, message: `حُفظت المسودة (الإصدار ${before.version}). انشرها لتعمل في التقييمات الجديدة.` };
    }
    const [exists] = await c.tx.select({ id: recommendationRules.id }).from(recommendationRules).where(eq(recommendationRules.code, d.code)).limit(1);
    if (exists) throw new UserError(`القاعدة ${d.code} موجودة. افتحها وأنشئ مسودة تعديل.`);
    const [row] = await c.tx.insert(recommendationRules).values({ ...values, code: d.code, version: 1, status: "draft", createdBy: c.auth.user.id }).returning({ id: recommendationRules.id });
    await log(c, "admin.rule.create", "recommendation_rule", row.id, null, { code: d.code, ...values });
    created = true;
  }, { revalidate: [P, `${P}/${d.code}`] });
  if (created) redirect(`${P}/${encodeURIComponent(d.code)}?created=1`);
  return res;
}

/** Starts a new draft version from the latest version of a rule. */
export async function newRuleDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const code = String(fd.get("code") ?? "");
  const res = await staffAction("admin.rules", async (c) => {
    const [latest] = await c.tx.select().from(recommendationRules).where(eq(recommendationRules.code, code)).orderBy(desc(recommendationRules.version)).limit(1);
    if (!latest) throw new UserError("القاعدة غير موجودة.");
    if (latest.status === "draft") throw new UserError("توجد مسودة مفتوحة لهذه القاعدة. عدّلها أو احذفها أولًا.");
    const { id: _id, createdAt: _c, updatedAt: _u, reviewedAt: _ra, reviewedBy: _rb, publishedAt: _pa, timesFired: _tf, timesConverted: _tc, ...rest } = latest;
    const [row] = await c.tx.insert(recommendationRules).values({ ...rest, version: latest.version + 1, status: "draft", createdBy: c.auth.user.id, updatedBy: c.auth.user.id }).returning({ id: recommendationRules.id });
    await log(c, "admin.rule.new_draft", "recommendation_rule", row.id, { from: latest.version }, { code, version: latest.version + 1 });
    return { ok: true, message: `أُنشئت مسودة الإصدار ${latest.version + 1}. عدّلها ثم انشرها.` };
  }, { revalidate: [P, `${P}/${code}`] });
  if (res.ok && res.message) redirect(`${P}/${encodeURIComponent(code)}?saved=${encodeURIComponent(res.message)}`);
  return res;
}

export async function publishRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("ruleId") ?? "");
  let code = "";
  const res = await staffAction("admin.rules", async (c) => {
    const [r] = await c.tx.select().from(recommendationRules).where(eq(recommendationRules.id, id)).limit(1);
    if (!r) throw new UserError("القاعدة غير موجودة.");
    code = r.code;
    if (r.status !== "draft") throw new UserError("تُنشر المسودات فقط.");
    const cond = parseLogic(r.condition, { label: "شرط القاعدة" });
    if (!cond.ok) throw new UserError(cond.error);
    const sup = parseLogic(r.suppressIf, { optional: true, label: "شرط الكتم" });
    if (!sup.ok) throw new UserError(sup.error);
    await checkRefs(c.tx, r.needCode, r.serviceCodes ?? []);
    const now = new Date();
    const retired = await c.tx
      .update(recommendationRules)
      .set({ status: "retired", updatedBy: c.auth.user.id })
      .where(and(eq(recommendationRules.code, r.code), eq(recommendationRules.status, "published"), ne(recommendationRules.id, id)))
      .returning({ version: recommendationRules.version });
    await c.tx.update(recommendationRules).set({ status: "published", publishedAt: now, reviewedAt: now, reviewedBy: c.auth.user.id, updatedBy: c.auth.user.id }).where(eq(recommendationRules.id, id));
    await log(c, "admin.rule.publish", "recommendation_rule", id, { status: "draft", retired: retired.map((x) => x.version) }, { code: r.code, version: r.version, status: "published" });
    return { ok: true, message: `نُشر الإصدار ${r.version} من ${r.code}. يُطبّق على التقييمات التي تُحسب من الآن.` };
  }, { revalidate: [P, `${P}/${code}`] });
  if (res.ok && res.message) redirect(`${P}/${encodeURIComponent(code)}?saved=${encodeURIComponent(res.message)}`);
  return res;
}

export async function retireRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("ruleId") ?? "");
  let code = "";
  const res = await staffAction("admin.rules", async (c) => {
    const [r] = await c.tx.select().from(recommendationRules).where(eq(recommendationRules.id, id)).limit(1);
    if (!r || r.status !== "published") throw new UserError("يُوقف الإصدار المنشور فقط.");
    code = r.code;
    await c.tx.update(recommendationRules).set({ status: "retired", updatedBy: c.auth.user.id }).where(eq(recommendationRules.id, id));
    await log(c, "admin.rule.retire", "recommendation_rule", id, { status: "published" }, { status: "retired" });
    return { ok: true, message: `أُوقفت القاعدة ${r.code}؛ لن تظهر في التقييمات الجديدة.` };
  }, { revalidate: P });
  if (res.ok && res.message) redirect(`${P}/${encodeURIComponent(code)}?saved=${encodeURIComponent(res.message)}`);
  return res;
}

export async function deleteRuleDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("ruleId") ?? "");
  let code = "";
  let remaining = 0;
  const res = await staffAction("admin.rules", async (c) => {
    const [r] = await c.tx.select().from(recommendationRules).where(eq(recommendationRules.id, id)).limit(1);
    if (!r || r.status !== "draft") throw new UserError("تُحذف المسودات فقط.");
    code = r.code;
    await c.tx.delete(recommendationRules).where(eq(recommendationRules.id, id));
    const [n] = await c.tx.select({ n: sql<number>`count(*)::int` }).from(recommendationRules).where(eq(recommendationRules.code, r.code));
    remaining = n?.n ?? 0;
    await log(c, "admin.rule.delete_draft", "recommendation_rule", id, r, null);
  }, { revalidate: P });
  if (res.ok) redirect(remaining ? `${P}/${encodeURIComponent(code)}` : `${P}?deleted=1`);
  return res;
}

// ───────────── Test panel ─────────────

export type RuleTestResult = {
  match: boolean;
  conditionValue: string;
  suppressed: boolean;
  factsCount: number;
  source: string;
  thisRule: { titleAr: string; severity: string; priority: number; wave: number; status: string; serviceCodes: string[]; removed: { code: string; why: string }[]; suppressedNote: string | null; reasonAr: string } | null;
  recs: { ruleCode: string; titleAr: string; severity: string; priority: number; wave: number; status: string; serviceCodes: string[] }[];
  missingVars: string[];
};

/**
 * Evaluates the rule currently in the editor against facts (typed JSON, or the facts of a computed assessment)
 * and runs the whole published rule set with this version substituted, to show the resulting recommendations.
 */
export async function testRule(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseRuleForm(fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const assessmentId = String(fd.get("testAssessmentId") ?? "").trim();
  const factsRaw = String(fd.get("testFacts") ?? "").trim();
  if (!assessmentId && !factsRaw) return { error: "أدخل الحقائق بصيغة JSON أو اختر تقييمًا تجريبيًا.", fieldErrors: { testFacts: "مطلوب أحدهما." } };
  let typed: Record<string, unknown> = {};
  if (factsRaw) {
    const j = parseJson<Record<string, unknown>>(factsRaw, "الحقائق");
    if (!j.ok) return { error: j.error, fieldErrors: { testFacts: j.error } };
    if (!j.value || typeof j.value !== "object" || Array.isArray(j.value)) return { error: "الحقائق كائن JSON مثل {\"size_class\": \"large\"}.", fieldErrors: { testFacts: "الحقائق كائن JSON." } };
    typed = j.value;
  }
  return staffAction("admin.rules", async (c) => {
    let base: Record<string, unknown> = {};
    let source = "حقائق مُدخلة يدويًا";
    if (assessmentId) {
      const rows = await c.tx.select({ key: factsTable.key, value: factsTable.value }).from(factsTable).where(eq(factsTable.assessmentId, assessmentId));
      if (!rows.length) throw new UserError("لا توجد حقائق محسوبة لهذا التقييم، أو ليس لك وصول إليه.");
      base = Object.fromEntries(rows.map((x) => [x.key, x.value]));
      source = factsRaw ? "حقائق التقييم مع تعديلاتك" : "حقائق التقييم المختار";
    }
    const facts: Record<string, unknown> = { ...base, ...typed };
    const today = todayISO();
    const [lic] = await c.tx.select({ value: settings.value }).from(settings).where(eq(settings.key, "company.licenses")).limit(1);
    const saved = (facts["meta.rec_context"] ?? null) as Partial<RecContext> | null;
    const waqfakRole = (facts.waqfak_role ?? facts["meta.waqfak_role"] ?? saved?.waqfakRole ?? "none") as RecContext["waqfakRole"];
    const ctx: RecContext = {
      waqfakRole,
      activeLicenses: saved?.activeLicenses ?? activeLicenseKeys(lic?.value, today),
      hasActiveLitigation: saved?.hasActiveLitigation ?? facts.litigation === "yes",
      gaaIsNazir: saved?.gaaIsNazir ?? facts.nazir_kind === "gaa",
      openServiceCodes: saved?.openServiceCodes ?? [],
    };
    const svcRows = await c.tx.select().from(services);
    const svc: ServiceInfo[] = svcRows.map((s) => ({ code: s.code, nameAr: s.nameAr, conflictRule: s.conflictRule, requiresLicenseKey: s.requiresLicenseKey, isActive: s.isActive }));
    const { rules } = await loadActiveRules(c.tx);
    const candidate: Rule = {
      id: d.ruleId || "candidate", code: d.code, version: 0, titleAr: d.titleAr, condition: d.condition, needCode: d.needCode, severity: d.severity,
      urgencyDays: d.urgencyDays, leverage: d.leverage, reasonAr: d.reasonAr, whyItMattersAr: d.whyItMattersAr, reference: d.reference,
      serviceCodes: d.serviceCodes, suppressIf: d.suppressIf, selfServiceHintAr: d.selfServiceHintAr,
    };
    const set = [...rules.filter((x) => x.code !== d.code), candidate].sort((a, b) => a.code.localeCompare(b.code, "en"));
    const withRole = { ...facts, waqfak_role: waqfakRole };
    let condValue: unknown;
    try {
      condValue = evaluate(d.condition, withRole);
    } catch (e) {
      throw new UserError(`تعذر تقييم الشرط: ${(e as Error).message}`);
    }
    const match = testLogic(d.condition, withRole);
    const recs = runRules(set, withRole, svc, ctx);
    const mine = recs.find((x) => x.ruleCode === d.code) ?? null;
    const vars = [...new Set(JSON.stringify(d.condition).match(/"var":\s*"([^"]+)"/g)?.map((m) => m.replace(/"var":\s*"/, "").replace(/"$/, "")) ?? [])];
    const result: RuleTestResult = {
      match,
      conditionValue: JSON.stringify(condValue),
      suppressed: mine?.status === "suppressed",
      factsCount: Object.keys(facts).length,
      source,
      thisRule: mine ? { titleAr: mine.titleAr, severity: mine.severity, priority: mine.priority, wave: mine.wave, status: mine.status, serviceCodes: mine.serviceCodes, removed: mine.removedServices, suppressedNote: mine.suppressedNote, reasonAr: mine.reasonAr } : null,
      recs: recs.slice(0, 25).map((x) => ({ ruleCode: x.ruleCode, titleAr: x.titleAr, severity: x.severity, priority: x.priority, wave: x.wave, status: x.status, serviceCodes: x.serviceCodes })),
      missingVars: vars.filter((v) => !(v in withRole)),
    };
    // Matched but shadowed: an earlier rule (by code) already claimed the same need.
    const shadowedBy = match && !mine ? recs.find((x) => x.needCode === d.needCode)?.ruleCode ?? null : null;
    return {
      ok: true,
      message: match ? (mine ? "الشرط ينطبق على هذه الحقائق." : `الشرط ينطبق، لكن الاحتياج نفسه غطته قاعدة سابقة (${shadowedBy}).`) : "الشرط لا ينطبق على هذه الحقائق.",
      data: { result },
    };
  });
}

// ───────────── Needs ─────────────

const needSchema = z.object({
  isNew: z.string().optional(),
  code: z.string().trim().toUpperCase().regex(/^NEED\.[A-Z]{2,5}(\.[A-Z0-9_]{2,40})+$/, "رمز الاحتياج بالصيغة NEED.FIN.BUDGET."),
  groupCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "رمز المجموعة حروف إنجليزية كبيرة مثل FIN."),
  titleAr: reqText(3, "اكتب عنوان الاحتياج.", 200),
  description: optText(1000),
});

export async function saveNeed(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(needSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (!d.code.startsWith(`NEED.${d.groupCode}.`)) return { error: "راجع الحقول المظللة.", fieldErrors: { code: `يبدأ الرمز بـ NEED.${d.groupCode}.` } };
  return staffAction("admin.rules", async (c) => {
    const [before] = await c.tx.select().from(needs).where(eq(needs.code, d.code)).limit(1);
    if (d.isNew && before) throw new UserError(`الاحتياج ${d.code} موجود.`);
    const values = { groupCode: d.groupCode, titleAr: d.titleAr, description: d.description };
    if (before) {
      await c.tx.update(needs).set(values).where(eq(needs.code, d.code));
      await log(c, "admin.need.update", "need", d.code, before, values);
      return { ok: true, message: "حُفظ الاحتياج." };
    }
    await c.tx.insert(needs).values({ code: d.code, ...values });
    await log(c, "admin.need.create", "need", d.code, null, values);
    return { ok: true, message: `أُضيف الاحتياج ${d.code}.` };
  }, { revalidate: `${P}/needs` });
}

export async function deleteNeed(_: ActionState, fd: FormData): Promise<ActionState> {
  const code = String(fd.get("code") ?? "");
  return staffAction("admin.rules", async (c) => {
    const [used] = await c.tx.select({ n: sql<number>`count(*)::int` }).from(recommendationRules).where(eq(recommendationRules.needCode, code));
    if (used?.n) throw new UserError("الاحتياج مرتبط بقواعد. انقلها لاحتياج آخر أولًا.");
    const [before] = await c.tx.select().from(needs).where(eq(needs.code, code)).limit(1);
    if (!before) throw new UserError("الاحتياج غير موجود.");
    await c.tx.delete(needs).where(eq(needs.code, code));
    await log(c, "admin.need.delete", "need", code, before, null);
    return { ok: true, message: "حُذف الاحتياج." };
  }, { revalidate: `${P}/needs` });
}
