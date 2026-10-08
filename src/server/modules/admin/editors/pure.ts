/**
 * Admin editors — pure helpers (no DB, no "server-only") shared by server actions, pages and unit tests.
 * Everything an admin types that becomes executable configuration (JSON-logic rules, workflow stages,
 * question options, weights) is validated here before it is saved.
 */
import { evaluate } from "../../../engines/logic";

// ───────────── JSON-logic ─────────────

export const LOGIC_OPERATORS = [
  "var", "==", "!=", "===", "!==", ">", ">=", "<", "<=", "and", "or", "!", "!!", "in", "missing", "if", "+", "-", "*", "/", "max", "min", "some_true",
] as const;

/** Translates evaluator errors into plain Arabic with a hint on how to fix them. */
export function explainLogicError(msg: string): string {
  const op = /unsupported operator: (.+)$/.exec(msg);
  if (op) return `العامل «${op[1]}» غير مدعوم. استخدم أحد العوامل: ${LOGIC_OPERATORS.join(" ، ")}.`;
  if (/invalid logic node/.test(msg)) return "كل عقدة يجب أن تحوي عاملًا واحدًا فقط، مثل {\"==\": [{\"var\": \"sizeClass\"}, \"large\"]}.";
  return `تعذر تقييم القاعدة: ${msg}`;
}

/** Collects every `{"var": "x"}` path used in a rule (first segment), to warn about unknown facts. */
export function logicVars(rule: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(rule)) {
    for (const r of rule) logicVars(r, out);
  } else if (rule && typeof rule === "object") {
    for (const [k, v] of Object.entries(rule as Record<string, unknown>)) {
      if (k === "var") {
        const p = Array.isArray(v) ? v[0] : v;
        if (typeof p === "string" && p) out.add(p);
      } else logicVars(v, out);
    }
  }
  return out;
}

export type LogicParse = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Parses and validates a JSON-logic field typed in the admin panel.
 * Empty input → `null` (allowed when `optional`). Returns a user-facing Arabic message on failure.
 */
export function parseLogic(raw: unknown, opts: { optional?: boolean; label?: string } = {}): LogicParse {
  const label = opts.label ?? "القاعدة";
  const text = typeof raw === "string" ? raw.trim() : raw == null ? "" : JSON.stringify(raw);
  if (!text) return opts.optional ? { ok: true, value: null } : { ok: false, error: `${label}: الحقل مطلوب. اكتب قاعدة JSON-logic مثل {"==": [{"var": "sizeClass"}, "large"]}.` };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `${label}: ليست JSON صالحًا (${(e as Error).message}). تأكد من علامات التنصيص المزدوجة والأقواس.` };
  }
  if (value === null) return opts.optional ? { ok: true, value: null } : { ok: false, error: `${label}: الحقل مطلوب.` };
  if (typeof value !== "object" && typeof value !== "boolean") return { ok: false, error: `${label}: يجب أن تكون القاعدة كائن JSON مثل {"==": [...]}، أو true/false.` };
  if (Array.isArray(value)) return { ok: false, error: `${label}: القاعدة لا تبدأ بمصفوفة. ابدأ بعامل مثل {"and": [ ... ]}.` };
  if (typeof value === "object" && Object.keys(value as object).length === 0) return opts.optional ? { ok: true, value: null } : { ok: false, error: `${label}: القاعدة فارغة.` };
  try {
    evaluate(value, {});
  } catch (e) {
    return { ok: false, error: `${label}: ${explainLogicError((e as Error).message)}` };
  }
  return { ok: true, value };
}

/** Facts available to obligation applicability rules (keys of WaqfFactBag in compliance/pure.ts). */
export const WAQF_FACT_KEYS = [
  "sizeClass", "legalType", "computedType", "status", "nazirMode", "creationMode", "waqfakRole", "collectsDonations", "hasForeignParty",
  "hasBeneficiariesAbroad", "hasActiveLitigation", "directBenefit", "founderAlive", "fiscalYearEnd", "documented", "registered", "hasBoard",
  "hasPortfolio", "conditionSetsPayDate", "documentedOn", "registeredOn", "registrationExpiresOn", "stage", "beneficiaryCount",
  "beneficialOwnerCount", "assessment",
] as const;

export const WAQF_BOOL_FLAGS = [
  "collectsDonations", "hasForeignParty", "hasBeneficiariesAbroad", "hasActiveLitigation", "directBenefit", "documented", "registered",
  "hasBoard", "hasPortfolio", "conditionSetsPayDate",
] as const;

export function unknownVars(rule: unknown, known: readonly string[]): string[] {
  return [...logicVars(rule)].filter((v) => !known.includes(v.split(".")[0]));
}

// ───────────── Generic parsing ─────────────

/** Comma/Arabic-comma/newline separated list → trimmed unique values. */
export function splitList(raw: unknown): string[] {
  if (Array.isArray(raw)) return [...new Set(raw.map(String).map((s) => s.trim()).filter(Boolean))];
  return [...new Set(String(raw ?? "").split(/[,،\n]/).map((s) => s.trim()).filter(Boolean))];
}

export function parseIntList(raw: unknown): { ok: true; value: number[] } | { ok: false; error: string } {
  const parts = splitList(raw);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 3650)) return { ok: false, error: "أدخل أرقامًا صحيحة موجبة مفصولة بفواصل، مثل 30، 7، 1." };
  return { ok: true, value: [...new Set(nums)].sort((a, b) => b - a) };
}

export function parseJson<T = unknown>(raw: unknown, label: string): { ok: true; value: T } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: `${label}: الحقل مطلوب.` };
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (e) {
    return { ok: false, error: `${label}: ليست JSON صالحًا (${(e as Error).message}).` };
  }
}

// ───────────── Workflow stages ─────────────

export type StageInput = { key: string; name: string; slaDays: number; role: string; clientApproval?: boolean };

export function validateStages(value: unknown): { ok: true; value: StageInput[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "المراحل يجب أن تكون مصفوفة فيها مرحلة واحدة على الأقل." };
  const keys = new Set<string>();
  const out: StageInput[] = [];
  for (const [i, s] of value.entries()) {
    const n = i + 1;
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, error: `المرحلة ${n}: يجب أن تكون كائنًا فيه key وname وslaDays وrole.` };
    const st = s as Record<string, unknown>;
    const key = String(st.key ?? "").trim();
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) return { ok: false, error: `المرحلة ${n}: المفتاح key يكون بحروف إنجليزية صغيرة وأرقام و_ (مثل client_review).` };
    if (keys.has(key)) return { ok: false, error: `المرحلة ${n}: المفتاح «${key}» مكرر. لكل مرحلة مفتاح فريد.` };
    keys.add(key);
    const name = String(st.name ?? "").trim();
    if (name.length < 2) return { ok: false, error: `المرحلة ${n}: اكتب اسم المرحلة name.` };
    const sla = Number(st.slaDays);
    if (!Number.isInteger(sla) || sla < 0 || sla > 3650) return { ok: false, error: `المرحلة ${n}: مدة الإنجاز slaDays عدد أيام صحيح بين 0 و3650.` };
    const role = String(st.role ?? "").trim();
    if (!role) return { ok: false, error: `المرحلة ${n}: حدد الدور المسؤول role (مثل consultant أو client).` };
    const extra = Object.keys(st).filter((k) => !["key", "name", "slaDays", "role", "clientApproval"].includes(k));
    if (extra.length) return { ok: false, error: `المرحلة ${n}: حقول غير معروفة: ${extra.join("، ")}.` };
    if (st.clientApproval !== undefined && typeof st.clientApproval !== "boolean") return { ok: false, error: `المرحلة ${n}: clientApproval تكون true أو false.` };
    out.push({ key, name, slaDays: sla, role, ...(st.clientApproval ? { clientApproval: true } : {}) });
  }
  return { ok: true, value: out };
}

// ───────────── Question bank ─────────────

export type OptionInput = { value: string; label: string; score?: number | null; unknown?: boolean; na?: boolean };
export const CHOICE_TYPES = ["yes_no", "yes_partial_no", "maturity", "band", "select", "multiselect"] as const;

export function validateOptions(answerType: string, value: unknown): { ok: true; value: OptionInput[] | null } | { ok: false; error: string } {
  const needs = (CHOICE_TYPES as readonly string[]).includes(answerType);
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    if (needs && answerType !== "maturity") return { ok: false, error: "هذا النوع من الأسئلة يحتاج خيارين على الأقل." };
    return { ok: true, value: null };
  }
  if (!Array.isArray(value)) return { ok: false, error: "الخيارات يجب أن تكون قائمة." };
  if (!needs) return { ok: false, error: "هذا النوع من الأسئلة لا يأخذ خيارات. احذفها أو غيّر نوع السؤال." };
  if (value.length < 2) return { ok: false, error: "أضف خيارين على الأقل." };
  const seen = new Set<string>();
  const out: OptionInput[] = [];
  for (const [i, o] of value.entries()) {
    const n = i + 1;
    const r = (o ?? {}) as Record<string, unknown>;
    const v = String(r.value ?? "").trim();
    const label = String(r.label ?? "").trim();
    if (!v) return { ok: false, error: `الخيار ${n}: القيمة مطلوبة.` };
    if (seen.has(v)) return { ok: false, error: `الخيار ${n}: القيمة «${v}» مكررة.` };
    seen.add(v);
    if (!label) return { ok: false, error: `الخيار ${n}: النص الظاهر مطلوب.` };
    let score: number | null = null;
    if (r.score !== undefined && r.score !== null && r.score !== "") {
      score = Number(r.score);
      if (!Number.isFinite(score) || score < 0 || score > 5) return { ok: false, error: `الخيار ${n}: الدرجة بين 0 و5.` };
    }
    out.push({ value: v, label, score, ...(r.unknown ? { unknown: true } : {}), ...(r.na ? { na: true } : {}) });
  }
  return { ok: true, value: out };
}

export type AxisWeights = { code: string; weightSmall: number | string; weightMedium: number | string; weightLarge: number | string };

/** Axis weights must sum to 100 for every size class. */
export function weightSums(axes: AxisWeights[]) {
  const sum = (k: "weightSmall" | "weightMedium" | "weightLarge") => Math.round(axes.reduce((a, x) => a + Number(x[k] || 0), 0) * 100) / 100;
  const sums = { small: sum("weightSmall"), medium: sum("weightMedium"), large: sum("weightLarge") };
  const ok = Math.abs(sums.small - 100) < 0.01 && Math.abs(sums.medium - 100) < 0.01 && Math.abs(sums.large - 100) < 0.01;
  return { ...sums, ok };
}

export type BankCheckQuestion = { code: string; axisCode: string; answerType: string; options: unknown; showIf: unknown; criticalWhen: unknown; criticalFlagCode: string | null; factKey: string | null };

/** Everything that must hold before a question bank version can be published. */
export function bankPublishProblems(axes: AxisWeights[], questions: BankCheckQuestion[], flagCodes: string[]): string[] {
  const out: string[] = [];
  if (!axes.length) out.push("لا توجد محاور في هذه النسخة.");
  if (!questions.length) out.push("لا توجد أسئلة في هذه النسخة.");
  const w = weightSums(axes);
  if (axes.length && !w.ok) out.push(`مجموع أوزان المحاور يجب أن يساوي 100 لكل فئة (صغير ${w.small}، متوسط ${w.medium}، كبير ${w.large}).`);
  const axisCodes = new Set(["P", ...axes.map((a) => a.code)]);
  const facts = new Map<string, string>();
  for (const q of questions) {
    if (!axisCodes.has(q.axisCode)) out.push(`السؤال ${q.code}: المحور ${q.axisCode} غير موجود.`);
    const o = validateOptions(q.answerType, q.options);
    if (!o.ok) out.push(`السؤال ${q.code}: ${o.error}`);
    for (const [field, label] of [["showIf", "شرط الظهور"], ["criticalWhen", "شرط الإشارة الحرجة"]] as const) {
      const p = parseLogic(q[field], { optional: true, label });
      if (!p.ok) out.push(`السؤال ${q.code}: ${p.error}`);
    }
    if (q.criticalFlagCode && !flagCodes.includes(q.criticalFlagCode)) out.push(`السؤال ${q.code}: الإشارة الحرجة ${q.criticalFlagCode} غير معرّفة.`);
    if (q.criticalWhen && !q.criticalFlagCode) out.push(`السؤال ${q.code}: حُدد شرط إشارة حرجة دون رمز الإشارة.`);
    if (q.factKey) {
      if (facts.has(q.factKey)) out.push(`السؤال ${q.code}: مفتاح الحقيقة «${q.factKey}» مستخدم أيضًا في ${facts.get(q.factKey)}.`);
      facts.set(q.factKey, q.code);
    }
  }
  return out;
}

// ───────────── Pricing ─────────────

export type PriceRange = { id?: string; sizeClass: string | null; validFrom: string | null; validTo: string | null };

/** Two price rows for the same size class may not have overlapping validity periods. */
export function overlappingPrice(rows: PriceRange[], candidate: PriceRange): PriceRange | null {
  const lo = (d: string | null) => d ?? "0000-01-01";
  const hi = (d: string | null) => d ?? "9999-12-31";
  for (const r of rows) {
    if (candidate.id && r.id === candidate.id) continue;
    if ((r.sizeClass ?? null) !== (candidate.sizeClass ?? null)) continue;
    if (lo(r.validFrom) <= hi(candidate.validTo) && lo(candidate.validFrom) <= hi(r.validTo)) return r;
  }
  return null;
}

/** Field-level diff for price_change_log / compliance_change_log. */
export function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown>, fields?: string[]): { field: string; oldValue: string | null; newValue: string | null }[] {
  const keys = fields ?? Object.keys(after);
  const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
  const out: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  for (const k of keys) {
    const a = norm(before?.[k]);
    const b = norm(after[k]);
    if (a !== b && !(a !== null && b !== null && !Number.isNaN(Number(a)) && Number(a) === Number(b))) out.push({ field: k, oldValue: a, newValue: b });
  }
  return out;
}

// ───────────── Requirement codes ─────────────

/** Next REQ-xxx code (3-digit minimum, matching the register's convention). */
export function nextReqCode(existing: string[]): string {
  let max = 0;
  for (const c of existing) {
    const m = /^REQ-(\d+)$/.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `REQ-${String(max + 1).padStart(3, "0")}`;
}

// ───────────── Traceability (RTM) ─────────────

export type ImplKind = "obligation" | "rule" | "flag" | "permission" | "validation" | "field" | "workflow" | "disclosure" | "report" | "feature";
export const IMPL_KINDS: ImplKind[] = ["obligation", "rule", "flag", "permission", "validation", "field", "workflow", "disclosure", "report", "feature"];
export const IMPL_KIND_AR: Record<string, string> = {
  obligation: "التزام", rule: "قاعدة توصية", flag: "إشارة حرجة", permission: "صلاحية", validation: "تحقق", field: "حقل بيانات",
  workflow: "سير عمل", disclosure: "إفصاح", report: "تقرير أو حزمة", feature: "ميزة",
};

export type RtmInput = {
  requirements: { id: string; code: string; title: string; article: string | null; featureArea: string | null; status: string; verificationStatus: string; referenceId: string | null; implementedAs: { kind: string; ref: string }[] }[];
  references: { id: string; code: string; sourceName: string; verificationStatus: string }[];
  obligations: { id: string; code: string; titleAr: string; requirementId: string | null; status: string }[];
  rules: { code: string; titleAr: string; reference: string | null; status: string }[];
  flags: { code: string; titleAr: string; active: boolean }[];
};

export type RtmLink = {
  kind: string;
  ref: string;
  label: string;
  page: string | null;
  api: string | null;
  db: string | null;
  linkStatus: "ok" | "missing" | "inactive" | "text";
  derived: boolean;
};

export type RtmRow = {
  reqId: string;
  reqCode: string;
  title: string;
  article: string | null;
  featureArea: string | null;
  status: string;
  verificationStatus: string;
  sourceCode: string | null;
  sourceName: string | null;
  sourceVerification: string | null;
  links: RtmLink[];
};

/** True when `text` cites `article` (e.g. "م8/1") as a whole token, not as part of "م18/1". */
export function citesArticle(text: string, article: string): boolean {
  const esc = article.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\d/])${esc}(?![\\d/])`).test(text);
}

/** Article tokens of a requirement ("م15/4 و5" → ["م15/4"], "م23/7 وم25" → ["م23/7","م25"]). */
export function articleTokens(article: string | null): string[] {
  if (!article) return [];
  return [...article.matchAll(/م\s?\d+(?:\/\d+)?/g)].map((m) => m[0].replace(/\s/g, ""));
}

const PAGE_FOR_FEATURE: Record<string, string> = {
  compliance: "/app/w/[id]/compliance", assessment: "/assessment", documents: "/app/w/[id]/documents", finance: "/app/w/[id]/finance",
  governance: "/app/w/[id]/governance", beneficiaries: "/app/w/[id]/beneficiaries", waqf: "/app/w/[id]/identity", requests: "/app/requests",
  reports: "/app/w/[id]/reports", establish: "/app/establish", privacy: "/app/privacy", contracts: "/app/requests/[id]", billing: "/app/billing",
  authz: "/app/w/[id]/settings", settings: "/admin/settings", security: "/admin/mlro", investment: "/app/w/[id]/assets",
};

export function buildRtm(input: RtmInput): RtmRow[] {
  const refById = new Map(input.references.map((r) => [r.id, r]));
  const oblByCode = new Map(input.obligations.map((o) => [o.code, o]));
  const ruleByCode = new Map<string, RtmInput["rules"][number]>();
  for (const r of input.rules) if (!ruleByCode.has(r.code) || r.status === "published") ruleByCode.set(r.code, r);
  const flagByCode = new Map(input.flags.map((f) => [f.code, f]));

  return input.requirements.map((req) => {
    const ref = req.referenceId ? refById.get(req.referenceId) ?? null : null;
    const links: RtmLink[] = [];
    const seen = new Set<string>();
    const add = (l: RtmLink) => {
      const k = `${l.kind}:${l.ref}`;
      if (seen.has(k)) return;
      seen.add(k);
      links.push(l);
    };
    const featurePage = req.featureArea ? PAGE_FOR_FEATURE[req.featureArea] ?? null : null;
    const linkFor = (kind: string, refCode: string, derived: boolean): RtmLink => {
      if (kind === "obligation") {
        const o = oblByCode.get(refCode);
        return {
          kind, ref: refCode, label: o?.titleAr ?? refCode, derived,
          page: o ? `/admin/compliance/obligations/${o.id}` : null, api: "/app/w/[id]/compliance", db: `obligations (code=${refCode})`,
          linkStatus: !o ? "missing" : o.status === "published" ? "ok" : "inactive",
        };
      }
      if (kind === "rule") {
        const r = ruleByCode.get(refCode);
        return {
          kind, ref: refCode, label: r?.titleAr ?? refCode, derived,
          page: r ? `/admin/rules/${encodeURIComponent(refCode)}` : null, api: "/assessment/[id]/result", db: `recommendation_rules (code=${refCode})`,
          linkStatus: !r ? "missing" : r.status === "published" ? "ok" : "inactive",
        };
      }
      if (kind === "flag") {
        const f = flagByCode.get(refCode);
        return {
          kind, ref: refCode, label: f?.titleAr ?? refCode, derived,
          page: f ? `/admin/question-bank/flags/${encodeURIComponent(refCode)}` : null, api: "/assessment/[id]/result", db: `critical_flag_defs (code=${refCode})`,
          linkStatus: !f ? "missing" : f.active ? "ok" : "inactive",
        };
      }
      if (kind === "field") {
        const db = /^[a-z_]+(\.[a-z_]+)?/.test(refCode) ? refCode : null;
        return { kind, ref: refCode, label: refCode, derived, page: featurePage, api: null, db, linkStatus: "text" };
      }
      return { kind, ref: refCode, label: refCode, derived, page: featurePage, api: null, db: null, linkStatus: "text" };
    };

    for (const impl of req.implementedAs ?? []) add(linkFor(impl.kind, impl.ref, false));
    // Obligations that point at this requirement (requirementId) even if not listed in implementedAs.
    for (const o of input.obligations) if (o.requirementId === req.id) add(linkFor("obligation", o.code, true));
    // Rules whose reference cites this requirement's source + article.
    const tokens = articleTokens(req.article);
    if (ref && tokens.length) {
      for (const r of ruleByCode.values()) {
        if (!r.reference || !r.reference.includes(ref.sourceName)) continue;
        if (tokens.some((t) => citesArticle(r.reference!, t))) add(linkFor("rule", r.code, true));
      }
    }
    return {
      reqId: req.id, reqCode: req.code, title: req.title, article: req.article, featureArea: req.featureArea, status: req.status,
      verificationStatus: req.verificationStatus, sourceCode: ref?.code ?? null, sourceName: ref?.sourceName ?? null,
      sourceVerification: ref?.verificationStatus ?? null, links,
    };
  });
}

export function filterRtm(rows: RtmRow[], f: { q?: string; source?: string; status?: string; area?: string; kind?: string; gaps?: boolean }): RtmRow[] {
  const q = f.q?.trim();
  return rows.filter((r) => {
    if (f.source && r.sourceCode !== f.source) return false;
    if (f.status && r.status !== f.status && r.verificationStatus !== f.status) return false;
    if (f.area && r.featureArea !== f.area) return false;
    if (f.kind && !r.links.some((l) => l.kind === f.kind)) return false;
    if (f.gaps && !(r.links.length === 0 || r.links.some((l) => l.linkStatus === "missing" || l.linkStatus === "inactive")) && r.status !== "pending_verification") return false;
    if (q) {
      const hay = [r.reqCode, r.title, r.article, r.sourceName, r.sourceCode, ...r.links.flatMap((l) => [l.ref, l.label])].join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export const REQ_STATUS_AR: Record<string, string> = { implemented: "منفّذ", pending_verification: "بانتظار التحقق", planned: "مخطط", excluded: "مستبعد", verified: "متحقق منه" };
export const LINK_STATUS_AR: Record<string, string> = { ok: "مفعّل", missing: "مفقود", inactive: "غير منشور", text: "وصفي" };

/** RTM as CSV rows: one line per requirement × link (requirements without links still get one line). */
export function rtmCsvRows(rows: RtmRow[]): unknown[][] {
  const out: unknown[][] = [];
  for (const r of rows) {
    const base = [r.sourceCode ?? "", r.sourceName ?? "", r.article ?? "", r.reqCode, r.title, r.featureArea ?? "", REQ_STATUS_AR[r.status] ?? r.status, REQ_STATUS_AR[r.verificationStatus] ?? r.verificationStatus];
    if (!r.links.length) out.push([...base, "", "", "", "", "", "", "لا يوجد تنفيذ"]);
    for (const l of r.links) out.push([...base, IMPL_KIND_AR[l.kind] ?? l.kind, l.ref, l.label, l.page ?? "", l.api ?? "", l.db ?? "", `${LINK_STATUS_AR[l.linkStatus]}${l.derived ? " (مستنتج)" : ""}`]);
  }
  return out;
}

export const RTM_CSV_HEADER = ["رمز المصدر", "المصدر", "المادة", "رمز المتطلب", "المتطلب", "المجال", "حالة التنفيذ", "حالة التحقق", "نوع التنفيذ", "المرجع", "الوصف", "الصفحة", "الواجهة/API", "قاعدة البيانات", "حالة الربط"];

// ───────────── Labels shared by editors ─────────────

export const AUDIENCES = [
  { value: "waqif", label: "واقف" }, { value: "nazir", label: "ناظر" }, { value: "board", label: "مجلس نظارة" },
  { value: "beneficiary", label: "مستفيد" }, { value: "entity", label: "جهة" },
];
export const CONFLICT_RULES = [
  { value: "none", label: "لا قيد" },
  { value: "blocked_if_waqfak_nazir", label: "محجوبة إن كانت وقفك ناظرًا" },
  { value: "blocked_if_waqfak_controls_finance", label: "محجوبة إن كانت وقفك تدير المالية (استقلال المراجعة)" },
  { value: "inside_nazara_only", label: "داخل النظارة فقط" },
];
export const PRICING_MODELS = [
  { value: "free", label: "مجانية" }, { value: "fixed", label: "سعر ثابت" }, { value: "subscription", label: "اشتراك" },
  { value: "hourly", label: "بالساعة" }, { value: "percentage", label: "نسبة" }, { value: "quote", label: "عرض سعر" },
];
export const SIZE_OPTIONS = [
  { value: "large", label: "كبير" }, { value: "medium", label: "متوسط" }, { value: "small", label: "صغير" }, { value: "direct_benefit", label: "ذو انتفاع مباشر" },
];
export const LEGAL_TYPE_OPTIONS = [{ value: "public", label: "عام" }, { value: "private", label: "خاص" }, { value: "joint", label: "مشترك" }];
export const SEVERITY_OPTIONS = [{ value: "critical", label: "حرج" }, { value: "high", label: "مرتفع" }, { value: "medium", label: "متوسط" }, { value: "low", label: "منخفض" }];
export const SEVERITY_TONE: Record<string, "critical" | "fine" | "warn" | "info"> = { critical: "critical", high: "fine", medium: "warn", low: "info" };
export const PUBLISH_STATUS_AR: Record<string, string> = { draft: "مسودة", in_review: "قيد المراجعة", published: "منشور", retired: "متقاعد" };
export const PUBLISH_STATUS_TONE: Record<string, "neutral" | "warn" | "ok" | "info"> = { draft: "neutral", in_review: "warn", published: "ok", retired: "info" };
export const VERIFICATION_AR: Record<string, string> = { verified: "متحقق منه", pending_verification: "بانتظار التحقق" };
export const ANSWER_TYPES = [
  { value: "yes_no", label: "نعم / لا" }, { value: "yes_partial_no", label: "نعم / جزئيًا / لا" }, { value: "maturity", label: "مستوى نضج (0–5)" },
  { value: "band", label: "شرائح" }, { value: "select", label: "اختيار واحد" }, { value: "multiselect", label: "اختيار متعدد" },
  { value: "number", label: "رقم" }, { value: "date", label: "تاريخ" }, { value: "text", label: "نص" },
];
export const TRIGGER_EVENTS = [
  "standing", "documentation", "registration", "material_change", "cert_expiry", "asset_substitution", "mortgage", "fiscal_year_end", "bo_change", "nazara_end",
  "conflict_declared", "gaa_request", "violation_decision", "suspension_decision", "statements_final", "portfolio_deed", "portfolio_certificate",
  "portfolio_created", "product_change", "donation_license_expiry", "donation_collection_end",
] as const;
export const OFFSET_UNITS = [
  { value: "business_days", label: "أيام عمل" }, { value: "days", label: "أيام" }, { value: "months", label: "أشهر" }, { value: "years", label: "سنوات" },
  { value: "immediate", label: "فورًا" }, { value: "before_expiry_business_days", label: "أيام عمل قبل الانتهاء" }, { value: "none", label: "بلا موعد محسوب" },
];
export const OBLIGATION_TYPES = ["registration", "update", "notification", "financial", "disclosure", "retention", "governance", "response", "distribution", "other"] as const;
export const AUTHORITIES = ["gaa", "internal", "court", "competent_authority", "cma", "fiu", "notary"] as const;
export const CONTENT_KINDS = [
  { value: "article", label: "مقال" }, { value: "guide", label: "دليل" }, { value: "regulation", label: "نظام أو لائحة" },
  { value: "study", label: "دراسة" }, { value: "template", label: "نموذج" }, { value: "page", label: "صفحة" },
];
/** Kinds whose publication requires an approved specialist review record. */
export const REVIEW_REQUIRED_KINDS = ["regulation", "guide"];
export const SPECIALTIES = [{ value: "sharia", label: "شرعي" }, { value: "legal", label: "قانوني" }, { value: "finance", label: "مالي" }];

export function slugOk(s: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}
