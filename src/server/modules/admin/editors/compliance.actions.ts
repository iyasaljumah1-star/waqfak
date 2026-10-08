"use server";
import { and, eq, ne, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  complianceSettingsAudit, obligations, penaltySchedule, regulatoryReferences, regulatoryRequirements,
} from "@/server/db/schema";
import { parseForm, UserError } from "@/server/modules/_shared";
import { resyncAllWaqfs } from "@/server/modules/compliance/engine";
import type { ObligationRow } from "@/server/modules/compliance/pure";
import type { ActionState } from "@/lib/utils";
import { log, staffAction, type StaffCtx } from "./guard";
import { code, formObj, optDate, optInt, optText, reqText } from "./form-utils";
import { diffFields, IMPL_KINDS, nextReqCode, parseIntList, parseJson, parseLogic, TRIGGER_EVENTS, unknownVars, WAQF_BOOL_FLAGS, WAQF_FACT_KEYS } from "./pure";
import { applicabilityAcrossWaqfs, instanceCounts } from "./compliance.queries";

const P = "/admin/compliance";
const PORTAL = ["/app/calendar", "/app"];

async function changeLog(c: StaffCtx, entityType: string, entityId: string, change: Record<string, unknown>) {
  await c.tx.insert(complianceSettingsAudit).values({ entityType, entityId, change, actorUserId: c.auth.user.id });
}

// ───────────── Obligations ─────────────

const SIZE = ["large", "medium", "small", "direct_benefit"] as const;
const LEGAL = ["public", "private", "joint"] as const;
const SCOPES = ["all_open", "other_periods", "earliest_open"] as const;

const obligationSchema = z.object({
  id: z.string().optional(),
  code: code("رمز الالتزام بحروف إنجليزية كبيرة وأرقام وشرطات، مثل OB-GOV-03."),
  titleAr: reqText(5, "اكتب عنوان الالتزام.", 300),
  description: optText(3000),
  requirementId: z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^[0-9a-f-]{36}$/.test(v), "اختر المتطلب من القائمة."),
  referenceText: reqText(3, "اكتب المرجع النظامي (المصدر والمادة).", 500),
  authority: z.enum(["competent_authority", "gaa", "court", "cma", "fiu", "notary", "internal"], { error: "اختر الجهة." }),
  obligationType: z.enum(["registration", "update", "notification", "financial", "disclosure", "retention", "governance", "response", "distribution", "other"], { error: "اختر الفئة." }),
  triggerEvent: z.enum(TRIGGER_EVENTS, { error: "اختر الحدث المنشئ." }),
  recurrence: z.enum(["none", "annual"]),
  offsetValue: optInt(0, 3650, "قيمة المهلة عدد صحيح بين 0 و3650."),
  offsetUnit: z.enum(["business_days", "days", "months", "years", "immediate", "before_expiry_business_days", "none"], { error: "اختر وحدة المهلة." }),
  sizeClasses: z.array(z.enum(SIZE)),
  legalTypes: z.array(z.enum(LEGAL)),
  requiresFlags: z.array(z.enum(WAQF_BOOL_FLAGS)),
  excludesFlags: z.array(z.enum(WAQF_BOOL_FLAGS)),
  rule: z.string().optional(),
  satisfiedWhen: z.string().optional(),
  closesOn: z.string().optional(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  requiredAction: reqText(5, "اكتب الإجراء المطلوب من الناظر.", 2000),
  evidenceRequired: optText(500),
  penaltyCode: optText(20),
  defaultAssigneeRole: z.string().trim().min(1, "اختر الدور المسؤول."),
  reminderOffsetsDays: z.string().optional(),
  status: z.enum(["draft", "published", "retired"]),
  verificationStatus: z.enum(["verified", "pending_verification"]),
  notes: optText(2000),
});

type ParsedObligation = z.infer<typeof obligationSchema> & { appliesTo: Record<string, unknown>; reminders: number[] };

function parseObligation(fd: FormData): { data: ParsedObligation } | { state: ActionState } {
  const r = parseForm(obligationSchema, formObj(fd, ["sizeClasses", "legalTypes", "requiresFlags", "excludesFlags"]));
  if ("state" in r) return r;
  const d = r.data;
  const fe: Record<string, string> = {};
  const rule = parseLogic(d.rule, { optional: true, label: "قاعدة الانطباق" });
  if (!rule.ok) fe.rule = rule.error;
  else if (rule.value !== null) {
    const unk = unknownVars(rule.value, WAQF_FACT_KEYS);
    if (unk.length) fe.rule = `قاعدة الانطباق: حقائق غير معروفة: ${unk.join("، ")}. الحقائق المتاحة: ${WAQF_FACT_KEYS.join("، ")}.`;
  }
  const sat = parseLogic(d.satisfiedWhen, { optional: true, label: "شرط الاستيفاء" });
  if (!sat.ok) fe.satisfiedWhen = sat.error;
  const rem = parseIntList(d.reminderOffsetsDays ?? "");
  if (!rem.ok) fe.reminderOffsetsDays = rem.error;
  let closesOn: (string | { event: string; scope: string })[] = [];
  if (d.closesOn && d.closesOn.trim() && d.closesOn.trim() !== "[]") {
    const j = parseJson<{ event?: string; scope?: string }[]>(d.closesOn, "أحداث الإغلاق");
    if (!j.ok) fe.closesOn = j.error;
    else if (!Array.isArray(j.value)) fe.closesOn = "أحداث الإغلاق قائمة.";
    else {
      for (const e of j.value) {
        const ev = String(e?.event ?? "").trim();
        const sc = String(e?.scope ?? "all_open").trim() || "all_open";
        if (!ev) continue;
        if (!(TRIGGER_EVENTS as readonly string[]).includes(ev)) fe.closesOn = `حدث الإغلاق «${ev}» غير معروف.`;
        else if (!(SCOPES as readonly string[]).includes(sc)) fe.closesOn = `نطاق الإغلاق «${sc}» غير معروف.`;
        else closesOn.push(sc === "all_open" ? ev : { event: ev, scope: sc });
      }
    }
  }
  closesOn = closesOn.filter((v, i, a) => a.findIndex((x) => JSON.stringify(x) === JSON.stringify(v)) === i);
  const timed = ["business_days", "days", "months", "years", "before_expiry_business_days"].includes(d.offsetUnit);
  if (timed && d.offsetValue === null) fe.offsetValue = "حدد قيمة المهلة لهذه الوحدة.";
  if (d.recurrence === "annual" && d.triggerEvent !== "fiscal_year_end") fe.recurrence = "التكرار السنوي يعمل مع حدث «نهاية السنة المالية» فقط.";
  if (d.triggerEvent === "standing" && timed) fe.offsetUnit = "الالتزام الدائم بلا موعد؛ اختر «بلا موعد محسوب».";
  const both = d.requiresFlags.filter((f) => d.excludesFlags.includes(f));
  if (both.length) fe.excludesFlags = `لا يكون الشرط لازمًا ومستثنى معًا: ${both.join("، ")}.`;
  if (Object.keys(fe).length) return { state: { error: Object.values(fe)[0], fieldErrors: fe } };
  const appliesTo: Record<string, unknown> = {};
  if (d.sizeClasses.length) appliesTo.sizeClasses = d.sizeClasses;
  if (d.legalTypes.length) appliesTo.legalTypes = d.legalTypes;
  if (d.requiresFlags.length) appliesTo.requiresFlags = d.requiresFlags;
  if (d.excludesFlags.length) appliesTo.excludesFlags = d.excludesFlags;
  if (rule.ok && rule.value !== null) appliesTo.rule = rule.value;
  if (sat.ok && sat.value !== null) appliesTo.satisfiedWhen = sat.value;
  if (closesOn.length) appliesTo.closesOn = closesOn;
  return { data: { ...d, appliesTo, reminders: rem.ok ? rem.value : [30, 7, 1] } };
}

function asRow(d: ParsedObligation, id = "preview"): ObligationRow {
  return {
    id, code: d.code, titleAr: d.titleAr, triggerEvent: d.triggerEvent, offsetValue: d.offsetValue, offsetUnit: d.offsetUnit, recurrence: d.recurrence,
    appliesTo: d.appliesTo, severity: d.severity, reminderOffsetsDays: d.reminders, obligationType: d.obligationType, status: d.status,
  };
}

/** Preview: which waqfs the obligation (as currently typed) would apply to — nothing is saved. */
export async function previewObligation(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseObligation(fd);
  if ("state" in r) return r.state;
  return staffAction("admin.compliance", async (c) => {
    const rows = await applicabilityAcrossWaqfs(c.tx, asRow(r.data));
    const n = rows.filter((x) => x.applies).length;
    return {
      ok: true,
      message: r.data.status === "published" ? `سينطبق على ${n} من ${rows.length} وقفًا عند الحفظ.` : `يطابق ${n} من ${rows.length} وقفًا، لكنه لن يُطبّق ما دام بحالة «${r.data.status === "draft" ? "مسودة" : "متقاعد"}».`,
      data: { preview: rows },
    };
  }, { global: true });
}

/**
 * Saves an obligation definition, re-syncs every waqf in the same transaction (global access, as the engine
 * requires) and writes the compliance change log. The result says how many waqfs it applies to now.
 */
export async function saveObligation(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseObligation(fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let newId: string | null = null;
  let summary = "";
  const res = await staffAction("admin.compliance", async (c) => {
    const [dup] = await c.tx.select({ id: obligations.id }).from(obligations).where(and(eq(obligations.code, d.code), d.id ? ne(obligations.id, d.id) : undefined)).limit(1);
    if (dup) throw new UserError(`الرمز ${d.code} مستخدم لالتزام آخر.`);
    if (d.requirementId) {
      const [req] = await c.tx.select({ id: regulatoryRequirements.id }).from(regulatoryRequirements).where(eq(regulatoryRequirements.id, d.requirementId)).limit(1);
      if (!req) throw new UserError("المتطلب المختار غير موجود.");
    }
    if (d.penaltyCode) {
      const [pen] = await c.tx.select({ code: penaltySchedule.code }).from(penaltySchedule).where(eq(penaltySchedule.code, d.penaltyCode)).limit(1);
      if (!pen) throw new UserError(`بند الجزاء ${d.penaltyCode} غير موجود في جدول المخالفات.`);
    }
    const values = {
      code: d.code, titleAr: d.titleAr, description: d.description, requirementId: d.requirementId, referenceText: d.referenceText, authority: d.authority,
      obligationType: d.obligationType, triggerEvent: d.triggerEvent, offsetValue: d.offsetValue, offsetUnit: d.offsetUnit, recurrence: d.recurrence,
      appliesTo: d.appliesTo as never, severity: d.severity, requiredAction: d.requiredAction, evidenceRequired: d.evidenceRequired, penaltyCode: d.penaltyCode,
      defaultAssigneeRole: d.defaultAssigneeRole, reminderOffsetsDays: d.reminders, status: d.status, verificationStatus: d.verificationStatus, notes: d.notes,
      updatedBy: c.auth.user.id,
    };
    let id = d.id ?? "";
    let before: typeof obligations.$inferSelect | null = null;
    let version = 1;
    if (d.id) {
      const [b] = await c.tx.select().from(obligations).where(eq(obligations.id, d.id)).limit(1);
      if (!b) throw new UserError("الالتزام غير موجود.");
      before = b;
      const changes = diffFields(b as never, values as never, Object.keys(values).filter((k) => k !== "updatedBy"));
      if (!changes.length) return { ok: true, message: "لا تغييرات للحفظ." };
      version = b.version + 1;
      await c.tx.update(obligations).set({ ...values, version }).where(eq(obligations.id, d.id));
    } else {
      const [row] = await c.tx.insert(obligations).values({ ...values, version, createdBy: c.auth.user.id }).returning({ id: obligations.id });
      id = row.id;
      newId = id;
    }
    const stats = await resyncAllWaqfs(c.tx, c.auth.user.id);
    const rows = await applicabilityAcrossWaqfs(c.tx, asRow(d, id));
    const appliesNow = d.status === "published" ? rows.filter((x) => x.applies).length : 0;
    const inst = await instanceCounts(c.tx, id);
    const diff = diffFields(before as never, values as never, Object.keys(values).filter((k) => k !== "updatedBy"));
    await changeLog(c, "obligation", id, {
      action: before ? "update" : "create", code: d.code, version, diff, appliesNow, waqfsChecked: rows.length,
      resync: stats, openInstances: inst.open,
    });
    await log(c, before ? "admin.obligation.update" : "admin.obligation.create", "obligation", id, before, { ...values, version, appliesNow });
    summary = `حُفظ الالتزام ${d.code} (الإصدار ${version}). ينطبق الآن على ${appliesNow} ${appliesNow === 1 ? "وقف" : "وقفًا"} من ${rows.length}؛ أُنشئ ${stats.created} استحقاقًا وأُغلق أو أُوقف ${stats.retired + stats.deleted + stats.closed}.`;
    return { ok: true, message: summary, data: { appliesNow, created: stats.created } };
  }, { global: true, revalidate: [P, ...PORTAL, ...(d.id ? [`${P}/obligations/${d.id}`] : [])] });
  if (newId && res.ok) redirect(`${P}/obligations/${newId}?saved=${encodeURIComponent(summary)}`);
  return res;
}

// ───────────── Requirements ─────────────

const requirementSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().toUpperCase().regex(/^REQ-\d{3,6}$/, "رمز المتطلب بالصيغة REQ-046."),
  referenceId: z.string().trim().optional().transform((v) => (v ? v : null)),
  article: optText(100),
  title: reqText(5, "اكتب نص المتطلب.", 500),
  description: optText(3000),
  implementedAs: z.string().optional(),
  featureArea: optText(40),
  status: z.enum(["implemented", "pending_verification", "planned", "excluded"]),
  verificationStatus: z.enum(["verified", "pending_verification"]),
  exclusionReason: optText(1000),
  notes: optText(2000),
});

export async function saveRequirement(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(requirementSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let impl: { kind: (typeof IMPL_KINDS)[number]; ref: string }[] = [];
  if (d.implementedAs && d.implementedAs.trim() && d.implementedAs.trim() !== "[]") {
    const j = parseJson<{ kind?: string; ref?: string }[]>(d.implementedAs, "التنفيذ");
    if (!j.ok || !Array.isArray(j.value)) return { error: "قائمة التنفيذ غير صالحة.", fieldErrors: { implementedAs: "قائمة التنفيذ غير صالحة." } };
    for (const [i, x] of j.value.entries()) {
      const kind = String(x?.kind ?? "");
      const ref = String(x?.ref ?? "").trim();
      if (!kind && !ref) continue;
      if (!(IMPL_KINDS as string[]).includes(kind)) return { error: `بند التنفيذ ${i + 1}: اختر النوع.`, fieldErrors: { implementedAs: `بند التنفيذ ${i + 1}: اختر النوع.` } };
      if (!ref) return { error: `بند التنفيذ ${i + 1}: اكتب المرجع (رمز الالتزام أو القاعدة أو وصف الميزة).`, fieldErrors: { implementedAs: `بند التنفيذ ${i + 1}: المرجع مطلوب.` } };
      impl.push({ kind: kind as (typeof IMPL_KINDS)[number], ref: ref.slice(0, 300) });
    }
  }
  impl = impl.filter((v, i, a) => a.findIndex((x) => x.kind === v.kind && x.ref === v.ref) === i);
  if (d.status === "excluded" && !d.exclusionReason) return { error: "راجع الحقول المظللة.", fieldErrors: { exclusionReason: "اكتب سبب الاستبعاد." } };
  if (d.status === "implemented" && !impl.length) return { error: "راجع الحقول المظللة.", fieldErrors: { implementedAs: "المتطلب «منفّذ» يحتاج بند تنفيذ واحدًا على الأقل، أو غيّر حالته إلى «مخطط»." } };
  let newId: string | null = null;
  const res = await staffAction("admin.compliance", async (c) => {
    const [dup] = await c.tx.select({ id: regulatoryRequirements.id }).from(regulatoryRequirements).where(and(eq(regulatoryRequirements.code, d.code), d.id ? ne(regulatoryRequirements.id, d.id) : undefined)).limit(1);
    if (dup) {
      const all = await c.tx.select({ code: regulatoryRequirements.code }).from(regulatoryRequirements);
      throw new UserError(`الرمز ${d.code} مستخدم. الرمز المتاح التالي: ${nextReqCode(all.map((x) => x.code))}.`);
    }
    if (d.referenceId) {
      const [ref] = await c.tx.select({ id: regulatoryReferences.id }).from(regulatoryReferences).where(eq(regulatoryReferences.id, d.referenceId)).limit(1);
      if (!ref) throw new UserError("المصدر المختار غير موجود.");
    }
    const values = {
      code: d.code, referenceId: d.referenceId, article: d.article, title: d.title, description: d.description, implementedAs: impl, featureArea: d.featureArea,
      status: d.status, verificationStatus: d.verificationStatus, exclusionReason: d.status === "excluded" ? d.exclusionReason : null, notes: d.notes, updatedBy: c.auth.user.id,
    };
    if (d.id) {
      const [before] = await c.tx.select().from(regulatoryRequirements).where(eq(regulatoryRequirements.id, d.id)).limit(1);
      if (!before) throw new UserError("المتطلب غير موجود.");
      await c.tx.update(regulatoryRequirements).set(values).where(eq(regulatoryRequirements.id, d.id));
      await changeLog(c, "requirement", d.id, { action: "update", code: d.code, diff: diffFields(before as never, values as never, Object.keys(values).filter((k) => k !== "updatedBy")) });
      await log(c, "admin.requirement.update", "regulatory_requirement", d.id, before, values);
      return { ok: true, message: `حُفظ المتطلب ${d.code}.` };
    }
    const [row] = await c.tx.insert(regulatoryRequirements).values({ ...values, createdBy: c.auth.user.id }).returning({ id: regulatoryRequirements.id });
    await changeLog(c, "requirement", row.id, { action: "create", code: d.code, after: values });
    await log(c, "admin.requirement.create", "regulatory_requirement", row.id, null, values);
    newId = row.id;
  }, { revalidate: [P, "/admin/traceability", ...(d.id ? [`${P}/requirements/${d.id}`] : [])] });
  if (newId) redirect(`${P}/requirements/${newId}?created=1`);
  return res;
}

export async function deleteRequirement(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  const res = await staffAction("admin.compliance", async (c) => {
    const [before] = await c.tx.select().from(regulatoryRequirements).where(eq(regulatoryRequirements.id, id)).limit(1);
    if (!before) throw new UserError("المتطلب غير موجود.");
    const [used] = await c.tx.select({ n: sql<number>`count(*)::int` }).from(obligations).where(eq(obligations.requirementId, id));
    if (used?.n) throw new UserError(`المتطلب مرتبط بـ ${used.n} التزام. افصلها أولًا، أو غيّر حالته إلى «مستبعد» بدل الحذف.`);
    await c.tx.delete(regulatoryRequirements).where(eq(regulatoryRequirements.id, id));
    await changeLog(c, "requirement", id, { action: "delete", code: before.code, before });
    await log(c, "admin.requirement.delete", "regulatory_requirement", id, before, null);
  }, { revalidate: [P, "/admin/traceability"] });
  if (res.ok) redirect(`${P}?tab=requirements&deleted=1`);
  return res;
}

// ───────────── References ─────────────

const referenceSchema = z.object({
  id: z.string().optional(),
  code: code("رمز المصدر بحروف إنجليزية كبيرة، مثل NAZARA-REG."),
  sourceName: reqText(3, "اكتب اسم المصدر.", 300),
  issuer: optText(300),
  decisionRef: optText(300),
  bindingLevel: z.enum(["binding", "guidance", "draft", "reference"]),
  sourceUrl: z.string().trim().optional().transform((v) => (v ? v : null)).refine((v) => v === null || /^https:\/\/[^\s]+$/.test(v), "الرابط يبدأ بـ https://"),
  verificationStatus: z.enum(["verified", "pending_verification"]),
  lastVerifiedOn: optDate,
  supersededBy: optText(40),
  notes: optText(2000),
});

export async function saveReference(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(referenceSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.verificationStatus === "verified" && !d.lastVerifiedOn) return { error: "راجع الحقول المظللة.", fieldErrors: { lastVerifiedOn: "حدد تاريخ آخر تحقق من المصدر الرسمي." } };
  let newId: string | null = null;
  const res = await staffAction("admin.compliance", async (c) => {
    const [dup] = await c.tx.select({ id: regulatoryReferences.id }).from(regulatoryReferences).where(and(eq(regulatoryReferences.code, d.code), d.id ? ne(regulatoryReferences.id, d.id) : undefined)).limit(1);
    if (dup) throw new UserError(`الرمز ${d.code} مستخدم لمصدر آخر.`);
    if (d.supersededBy) {
      if (d.supersededBy === d.code) throw new UserError("لا يحل المصدر محل نفسه.");
      const [s] = await c.tx.select({ id: regulatoryReferences.id }).from(regulatoryReferences).where(eq(regulatoryReferences.code, d.supersededBy)).limit(1);
      if (!s) throw new UserError(`المصدر البديل ${d.supersededBy} غير موجود.`);
    }
    const { id: _id, ...rest } = d;
    const values = { ...rest, updatedBy: c.auth.user.id };
    if (d.id) {
      const [before] = await c.tx.select().from(regulatoryReferences).where(eq(regulatoryReferences.id, d.id)).limit(1);
      if (!before) throw new UserError("المصدر غير موجود.");
      await c.tx.update(regulatoryReferences).set(values).where(eq(regulatoryReferences.id, d.id));
      await changeLog(c, "reference", d.id, { action: "update", code: d.code, diff: diffFields(before as never, values as never, Object.keys(values).filter((k) => k !== "updatedBy")) });
      await log(c, "admin.reference.update", "regulatory_reference", d.id, before, values);
      return { ok: true, message: `حُفظ المصدر ${d.code}.` };
    }
    const [row] = await c.tx.insert(regulatoryReferences).values({ ...values, createdBy: c.auth.user.id }).returning({ id: regulatoryReferences.id });
    await changeLog(c, "reference", row.id, { action: "create", code: d.code, after: values });
    await log(c, "admin.reference.create", "regulatory_reference", row.id, null, values);
    newId = row.id;
  }, { revalidate: [P, "/admin/traceability", "/regulations", ...(d.id ? [`${P}/references/${d.id}`] : [])] });
  if (newId) redirect(`${P}/references/${newId}?created=1`);
  return res;
}

export async function deleteReference(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  const res = await staffAction("admin.compliance", async (c) => {
    const [before] = await c.tx.select().from(regulatoryReferences).where(eq(regulatoryReferences.id, id)).limit(1);
    if (!before) throw new UserError("المصدر غير موجود.");
    const [used] = await c.tx.select({ n: sql<number>`count(*)::int` }).from(regulatoryRequirements).where(eq(regulatoryRequirements.referenceId, id));
    if (used?.n) throw new UserError(`المصدر مرتبط بـ ${used.n} متطلبًا. انقلها إلى مصدر آخر أولًا، أو سجّل المصدر البديل في «حلّ محله».`);
    await c.tx.delete(regulatoryReferences).where(eq(regulatoryReferences.id, id));
    await changeLog(c, "reference", id, { action: "delete", code: before.code, before });
    await log(c, "admin.reference.delete", "regulatory_reference", id, before, null);
  }, { revalidate: [P, "/admin/traceability"] });
  if (res.ok) redirect(`${P}?tab=references&deleted=1`);
  return res;
}

// ───────────── Penalty schedule ─────────────

const penaltySchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().regex(/^\d{1,2}-\d{1,2}$/, "رمز البند مثل 7-2."),
  category: reqText(2, "اكتب فئة المخالفة.", 200),
  titleAr: reqText(5, "اكتب وصف المخالفة.", 500),
  largeText: optText(500),
  mediumText: optText(500),
  smallText: optText(500),
  dismissalRisk: z.enum(["immediate", "after_notice", "escalation", "no"]),
  maxFine: optInt(0, 1e9, "أعلى غرامة عدد صحيح بالريال."),
  verificationStatus: z.enum(["verified", "pending_verification"]),
  notes: optText(2000),
});

export async function savePenalty(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(penaltySchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let newId: string | null = null;
  const res = await staffAction("admin.compliance", async (c) => {
    const [dup] = await c.tx.select({ id: penaltySchedule.id }).from(penaltySchedule).where(and(eq(penaltySchedule.code, d.code), d.id ? ne(penaltySchedule.id, d.id) : undefined)).limit(1);
    if (dup) throw new UserError(`البند ${d.code} موجود.`);
    const { id: _id, ...rest } = d;
    const values = { ...rest, updatedBy: c.auth.user.id };
    if (d.id) {
      const [before] = await c.tx.select().from(penaltySchedule).where(eq(penaltySchedule.id, d.id)).limit(1);
      if (!before) throw new UserError("البند غير موجود.");
      if (before.code !== d.code) {
        const [used] = await c.tx.select({ n: sql<number>`count(*)::int` }).from(obligations).where(eq(obligations.penaltyCode, before.code));
        if (used?.n) throw new UserError(`لا يُغيّر رمز البند ${before.code} لأنه مرتبط بـ ${used.n} التزام.`);
      }
      await c.tx.update(penaltySchedule).set(values).where(eq(penaltySchedule.id, d.id));
      await changeLog(c, "penalty", d.id, { action: "update", code: d.code, diff: diffFields(before as never, values as never, Object.keys(values).filter((k) => k !== "updatedBy")) });
      await log(c, "admin.penalty.update", "penalty_schedule", d.id, before, values);
      return { ok: true, message: `حُفظ البند ${d.code}. يظهر النص الجديد في التذكيرات القادمة.` };
    }
    const [row] = await c.tx.insert(penaltySchedule).values({ ...values, createdBy: c.auth.user.id }).returning({ id: penaltySchedule.id });
    await changeLog(c, "penalty", row.id, { action: "create", code: d.code, after: values });
    await log(c, "admin.penalty.create", "penalty_schedule", row.id, null, values);
    newId = row.id;
  }, { revalidate: [P, ...(d.id ? [`${P}/penalties/${d.id}`] : [])] });
  if (newId) redirect(`${P}/penalties/${newId}?created=1`);
  return res;
}
