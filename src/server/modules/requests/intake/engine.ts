/**
 * Service intake form engine (PURE: shared by the client wizard and the server validation).
 *
 * A service form is a list of steps; each step has fields; fields and document slots may be shown or required
 * conditionally on earlier answers. Answers are stored as strings (or string[] for multi-choice) in
 * service_requests.intake.answers, together with the form version they follow.
 */

export type Cond =
  /** `row`: the field is a table and the condition holds when any of its rows has that column matching. */
  | { field: string; eq?: string; in?: string[]; notEmpty?: boolean; not?: boolean; row?: string }
  | { all: Cond[] }
  | { any: Cond[] };

export type FieldType =
  | "text" | "textarea" | "number" | "money" | "percent" | "date" | "select" | "radio" | "checkboxes" | "yesno"
  | "phone" | "email" | "idnumber" | "ack"
  /** Set by the server (e.g. whether the request has waqf-file data to show); never rendered as an input. */
  | "hidden"
  /** Repeating rows (e.g. bequests, beneficiary classes, parties). Stored as a JSON string of row objects. */
  | "table";

/** A column of a table field. Cells are validated like fields of the same type. */
export type Column = {
  key: string;
  label: string;
  /** «hidden»: kept with the row, never shown or edited in the form (e.g. which waqf-file record a row came from). */
  type: "text" | "number" | "money" | "percent" | "select" | "date" | "idnumber" | "hidden";
  required?: boolean;
  options?: readonly (readonly [string, string])[];
  min?: number;
  max?: number;
  /** Shown only when another cell of the same row has a value (e.g. amount when kind = fixed). */
  showIf?: { col: string; in: string[] };
  /** Options that do not apply when a condition on the form holds (hidden in the form and refused on the server). */
  hideOptions?: { when: Cond; values: string[] };
};

/** The options of a table column that apply to the current answers. */
export function columnOptions(c: Column, a: Answers) {
  const hidden = c.hideOptions && evalCond(c.hideOptions.when, a) ? new Set(c.hideOptions.values) : null;
  return (c.options ?? []).filter(([k]) => !hidden?.has(k));
}

export type PrefillKey =
  | "user.fullName" | "user.phone" | "user.email" | "waqf.name" | "waqf.sizeClass" | "waqf.deedNo" | "waqf.registrationCertNo"
  | "waqf.fiscalYearEnd" | "waqf.nationalUnifiedNumber" | "waqf.domicile" | "waqf.hasForeignParty" | "waqf.hasBeneficiariesAbroad"
  | "waqf.collectsDonations";

/** Specialist whose opinion an answer needs before it is relied on (shown to the team, never decided by the system). */
export type ReviewKind = "sharia" | "legal" | "financial" | "technical";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Required only when the condition holds (otherwise optional). */
  requiredIf?: Cond;
  showIf?: Cond;
  hint?: string;
  options?: readonly (readonly [string, string])[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  prefill?: PrefillKey;
  /** The answer needs a specialist's review (sharia, legal, financial or technical) before it is relied on. */
  review?: ReviewKind;
  /**
   * Completeness level of an optional field: «start» — the request may be sent without it, but work does not start
   * until it is given (an answer «unknown» counts as missing); «support» — improves the result, never blocks.
   * Required fields (required / requiredIf) block sending; a required field marked «start» may be answered «لا أعرف»
   * to send the request, and work then waits for the real answer.
   */
  need?: Need;
  /** Why the answer is needed (shown to the client in the completeness summary). */
  why?: string;
  /** Spans the full width in the two-column layout. */
  wide?: boolean;
  /** Table fields: columns and row limits. */
  columns?: Column[];
  minRows?: number;
  maxRows?: number;
  /** Table fields filled from the waqf file when a request starts (each row keeps which record it came from). */
  prefillTable?: "waqf.assets" | "waqf.board";
  /** Table fields: the column `col` may not add up to more than `max` within one group of rows (`by`), or in all rows. */
  sumMax?: { col: string; by?: string; max: number };
};

export type TableRow = Record<string, string>;
const MAX_ROWS = 30;

/** Parses a table answer (JSON string) into rows; anything malformed becomes an empty list. */
export function tableRows(v: AnswerValue | undefined): TableRow[] {
  if (typeof v !== "string" || !v.trim().startsWith("[")) return [];
  try {
    const arr = JSON.parse(v) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, String(x ?? "").trim().slice(0, 1000)])));
  } catch {
    return [];
  }
}

export const cellVisible = (c: Column, row: TableRow) => !c.showIf || c.showIf.in.includes(row[c.showIf.col] ?? "");

function cleanTable(f: Field, v: unknown): string | undefined {
  const cols = f.columns ?? [];
  const rows = tableRows(typeof v === "string" ? v : JSON.stringify(v ?? []))
    .map((r) => Object.fromEntries(cols.filter((c) => cellVisible(c, r) && r[c.key]).map((c) => [c.key, r[c.key]])))
    .filter((r) => Object.keys(r).length)
    .slice(0, Math.min(f.maxRows ?? MAX_ROWS, MAX_ROWS));
  return rows.length ? JSON.stringify(rows) : undefined;
}

/** A row a table must contain when a condition holds (e.g. a will that includes a waqf has a «waqf» bequest row). */
export type RowRule = { field: string; col: string; value: string; when: Cond; message: string };
export type Step = {
  key: string; title: string; intro?: string; fields: Field[]; showIf?: Cond; requireRows?: RowRule[];
  /** The step shows the waqf-file records the service reads (with source, date and status) above its fields. */
  contextBlocks?: boolean;
};

export type DocSlot = {
  key: string;
  docType: string;
  label: string;
  required?: boolean;
  requiredIf?: Cond;
  showIf?: Cond;
  hint?: string;
  /** As for fields: «start» needed before work starts, «support» helpful only. */
  need?: Need;
  why?: string;
};

export type Need = "start" | "support";

export type ServiceForm = {
  code: string;
  version: number;
  steps: Step[];
  docs: DocSlot[];
  /** Where the questions come from (project reference files or the service definition). */
  sources: string[];
  /** Carries answers saved under an earlier version of the form into this one (applied before the form rules). */
  upgrade?: (a: Record<string, unknown>) => Record<string, unknown>;
};

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue | undefined>;
/** slot key → document ids attached to it. */
export type DocMap = Record<string, string[]>;

const MAX_TEXT = 4000;

const isEmpty = (v: AnswerValue | undefined) =>
  v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "" || String(v).trim() === "[]");

export function evalCond(c: Cond | undefined, a: Answers): boolean {
  if (!c) return true;
  if ("all" in c) return c.all.every((x) => evalCond(x, a));
  if ("any" in c) return c.any.some((x) => evalCond(x, a));
  const v = a[c.field];
  let r: boolean;
  if (c.row) {
    const cells = tableRows(v).map((x) => x[c.row!] ?? "");
    r = c.in ? cells.some((x) => c.in!.includes(x)) : c.eq !== undefined ? cells.includes(c.eq) : cells.some((x) => x !== "");
    return c.not ? !r : r;
  }
  if (c.notEmpty) r = !isEmpty(v);
  else if (c.in) r = Array.isArray(v) ? v.some((x) => c.in!.includes(x)) : c.in.includes(String(v ?? ""));
  else if (c.eq !== undefined) r = Array.isArray(v) ? v.includes(c.eq) : String(v ?? "") === c.eq;
  else r = !isEmpty(v);
  return c.not ? !r : r;
}

export const visibleSteps = (form: ServiceForm, a: Answers) => form.steps.filter((s) => evalCond(s.showIf, a));
export const visibleFields = (step: Step, a: Answers) => step.fields.filter((f) => evalCond(f.showIf, a));
export const fieldRequired = (f: Field, a: Answers) => !!f.required || (!!f.requiredIf && evalCond(f.requiredIf, a));
export const visibleDocs = (form: ServiceForm, a: Answers) => form.docs.filter((d) => evalCond(d.showIf, a));
export const docRequired = (d: DocSlot, a: Answers) => !!d.required || (!!d.requiredIf && evalCond(d.requiredIf, a));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^(?:\+?966|0)5\d{8}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NID = /^[12]\d{9}$/;

/** Validates one value against its field. Returns an Arabic message or null. */
export function validateField(f: Field, v: AnswerValue | undefined, a: Answers): string | null {
  if (isEmpty(v)) return fieldRequired(f, a) ? (f.type === "ack" ? "يلزم الإقرار للمتابعة." : `«${f.label}» مطلوب.`) : null;
  const s = Array.isArray(v) ? "" : String(v).trim();
  switch (f.type) {
    case "number":
    case "money":
    case "percent": {
      const n = Number(s.replace(/[,٬]/g, ""));
      if (!Number.isFinite(n)) return `«${f.label}»: أدخل رقمًا.`;
      if (n < (f.min ?? 0)) return `«${f.label}»: القيمة أقل من ${f.min ?? 0}.`;
      const max = f.max ?? (f.type === "percent" ? 100 : undefined);
      if (max !== undefined && n > max) return `«${f.label}»: القيمة أكبر من ${max}.`;
      if (f.type === "number" && !Number.isInteger(n)) return `«${f.label}»: أدخل عددًا صحيحًا.`;
      return null;
    }
    case "date":
      return ISO.test(s) && !Number.isNaN(Date.parse(s)) ? null : `«${f.label}»: أدخل تاريخًا صحيحًا.`;
    case "phone":
      return PHONE.test(s.replace(/\s|-/g, "")) ? null : `«${f.label}»: رقم جوال سعودي مثل 05xxxxxxxx.`;
    case "email":
      return EMAIL.test(s) ? null : `«${f.label}»: بريد إلكتروني غير صحيح.`;
    case "idnumber":
      return NID.test(s) ? null : `«${f.label}»: 10 أرقام تبدأ بالرقم 1 (هوية) أو 2 (إقامة).`;
    case "select":
    case "radio":
      return f.options?.some(([k]) => k === s) ? null : `«${f.label}»: اختر من القائمة.`;
    case "yesno":
      return s === "yes" || s === "no" ? null : `«${f.label}»: اختر نعم أو لا.`;
    case "ack":
      return s === "yes" ? null : "يلزم الإقرار للمتابعة.";
    case "hidden":
      return null;
    case "checkboxes": {
      const arr = Array.isArray(v) ? v : [s];
      return arr.every((x) => f.options?.some(([k]) => k === x)) ? null : `«${f.label}»: اختيار غير صالح.`;
    }
    case "table": {
      const rows = tableRows(v);
      if (rows.length < (f.minRows ?? (fieldRequired(f, a) ? 1 : 0))) return `«${f.label}»: أضف ${f.minRows ?? 1} صفًا على الأقل.`;
      for (const [i, r] of rows.entries())
        for (const c of (f.columns ?? []).filter((c) => cellVisible(c, r))) {
          if (c.type === "hidden") continue;
          const cellField: Field = { key: c.key, label: `${f.label} — الصف ${i + 1}: ${c.label}`, type: c.type, required: c.required, options: columnOptions(c, a), min: c.min, max: c.max };
          const e = validateField(cellField, r[c.key], a);
          if (e) return e;
        }
      if (f.sumMax) {
        const { col, by, max } = f.sumMax;
        const sums = new Map<string, number>();
        for (const r of rows) {
          const n = Number(String(r[col] ?? "").replace(/[,٬]/g, ""));
          if (Number.isFinite(n) && r[col]) sums.set(by ? r[by] ?? "" : "", (sums.get(by ? r[by] ?? "" : "") ?? 0) + n);
        }
        const colLabel = f.columns?.find((c) => c.key === col)?.label ?? col;
        const byLabel = by ? f.columns?.find((c) => c.key === by)?.label ?? by : "";
        for (const [g, total] of sums)
          if (total > max + 1e-9) return `«${f.label}»: مجموع «${colLabel}»${by ? ` في الصفوف التي «${byLabel}» فيها ${g}` : ""} يبلغ ${+total.toFixed(2)}٪، والحد الأعلى ${max}٪.`;
      }
      return null;
    }
    default: {
      const min = f.minLength ?? 0;
      const max = Math.min(f.maxLength ?? MAX_TEXT, MAX_TEXT);
      if (s.length < min) return `«${f.label}»: ${min} أحرف على الأقل.`;
      if (s.length > max) return `«${f.label}»: النص أطول من ${max} حرف.`;
      return null;
    }
  }
}

export function validateStep(step: Step, a: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const r of step.requireRows ?? [])
    if (evalCond(r.when, a) && !tableRows(a[r.field]).some((row) => row[r.col] === r.value)) errors[r.field] = r.message;
  for (const f of visibleFields(step, a)) {
    const e = validateField(f, a[f.key], a);
    if (e) errors[f.key] = e;
  }
  return errors;
}

export type IntakeCheck = {
  errors: Record<string, string>;
  /** Key of the first step that has an error. */
  firstStep: string | null;
  missingDocs: DocSlot[];
  fieldsComplete: boolean;
  docsComplete: boolean;
};

/** Full check before submission: every visible required field valid, every visible required document slot filled. */
export function checkIntake(form: ServiceForm, a: Answers, docs: DocMap): IntakeCheck {
  const errors: Record<string, string> = {};
  let firstStep: string | null = null;
  for (const st of visibleSteps(form, a)) {
    const e = validateStep(st, a);
    if (Object.keys(e).length && !firstStep) firstStep = st.key;
    Object.assign(errors, e);
  }
  const missingDocs = visibleDocs(form, a).filter((d) => docRequired(d, a) && !(docs[d.key]?.length));
  return { errors, firstStep, missingDocs, fieldsComplete: !Object.keys(errors).length, docsComplete: !missingDocs.length };
}

/** Keeps only answers to known, visible fields; trims text; drops invalid option values. Used on every save. */
export function sanitizeAnswers(form: ServiceForm, raw: unknown): Answers {
  const input0 = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const input = form.upgrade ? form.upgrade(input0) : input0;
  const fields = new Map(form.steps.flatMap((s) => s.fields).map((f) => [f.key, f]));
  const out: Answers = {};
  for (const [k, v] of Object.entries(input)) {
    const f = fields.get(k);
    if (!f) continue;
    if (f.type === "table") {
      const t = cleanTable(f, v);
      if (t) out[k] = t;
      continue;
    }
    if (f.type === "checkboxes") {
      const arr = (Array.isArray(v) ? v : [v]).map((x) => String(x ?? "")).filter((x) => f.options?.some(([o]) => o === x));
      if (arr.length) out[k] = [...new Set(arr)];
      continue;
    }
    if (v === undefined || v === null || Array.isArray(v) || typeof v === "object") continue;
    const s = String(v).trim().slice(0, MAX_TEXT);
    if (s) out[k] = s;
  }
  // Hidden fields (conditions no longer hold) are dropped, so they are never submitted or shown.
  // Repeat until stable: dropping one answer can hide fields that depended on it.
  for (let changed = true; changed; ) {
    changed = false;
    for (const st of form.steps) {
      const stepVisible = evalCond(st.showIf, out);
      for (const f of st.fields)
        if (out[f.key] !== undefined && (!stepVisible || !evalCond(f.showIf, out))) {
          delete out[f.key];
          changed = true;
        }
    }
  }
  return out;
}

export function displayValue(f: Field, v: AnswerValue | undefined): string {
  if (v === undefined || isEmpty(v)) return "—";
  const label = (x: string) => f.options?.find(([k]) => k === x)?.[1] ?? x;
  if (Array.isArray(v)) return v.map(label).join("، ");
  if (f.type === "yesno") return v === "yes" ? "نعم" : "لا";
  if (f.type === "ack") return v === "yes" ? "أُقرّ" : "—";
  if (f.type === "select" || f.type === "radio") return label(v);
  if (f.type === "money") return `${Number(v).toLocaleString("ar-SA")} ر.س`;
  if (f.type === "percent") return `${v}٪`;
  if (f.type === "table") return tableText(f, tableRows(v)) || "—";
  return v;
}

/** One line per row: "label: value، …" (for summaries, documents and search). */
export function tableText(f: Field, rows: TableRow[]) {
  return rows.map((r, i) => `${i + 1}) ${(f.columns ?? []).filter((c) => c.type !== "hidden" && cellVisible(c, r) && r[c.key]).map((c) => `${c.label}: ${cellDisplay(c, r[c.key])}`).join("، ")}${r.src?.startsWith("file:") ? " (من ملف الوقف)" : ""}`).join("\n");
}

export function cellDisplay(c: Column, v: string | undefined) {
  if (!v) return "—";
  if (c.type === "select") return c.options?.find(([k]) => k === v)?.[1] ?? v;
  if (c.type === "money") return `${Number(v).toLocaleString("ar-SA")} ر.س`;
  if (c.type === "percent") return `${v}٪`;
  return v;
}

export type SummarySection = { key: string; title: string; rows: { key: string; label: string; value: string }[] };

export function summarize(form: ServiceForm, a: Answers): SummarySection[] {
  return visibleSteps(form, a).map((st) => ({
    key: st.key,
    title: st.title,
    rows: visibleFields(st, a).filter((f) => f.type !== "ack" && f.type !== "hidden").map((f) => ({ key: f.key, label: f.label, value: displayValue(f, a[f.key]) })),
  }));
}

/** Plain-text digest kept in service_requests.details (lists, search, legacy views). */
export function summaryText(form: ServiceForm, a: Answers) {
  return summarize(form, a)
    .map((s) => [`■ ${s.title}`, ...s.rows.filter((r) => r.value !== "—").map((r) => `${r.label}: ${r.value}`)].join("\n"))
    .join("\n\n")
    .slice(0, 8000);
}

/** Field lookup by key (for deficiency items that point to a field). */
export function findField(form: ServiceForm, key: string): { step: Step; field: Field } | null {
  for (const step of form.steps) for (const field of step.fields) if (field.key === key) return { step, field };
  return null;
}

/** Progress 0..100 across visible required fields and required document slots. */
export function intakeProgress(form: ServiceForm, a: Answers, docs: DocMap) {
  let total = 0;
  let done = 0;
  for (const st of visibleSteps(form, a))
    for (const f of visibleFields(st, a))
      if (fieldRequired(f, a)) {
        total++;
        if (!validateField(f, a[f.key], a)) done++;
      }
  for (const d of visibleDocs(form, a))
    if (docRequired(d, a)) {
      total++;
      if (docs[d.key]?.length) done++;
    }
  return total ? Math.round((done / total) * 100) : 100;
}

export type NeedItem = { key: string; label: string; kind: "field" | "doc"; step: string | null; why: string | null };
export type IntakeNeeds = {
  /** Blocks sending the request. */
  submit: NeedItem[];
  /** The request may be sent; work does not start until these are given. */
  start: NeedItem[];
  /** Helpful, never blocking. */
  support: NeedItem[];
  /** Given, but not relied on before a specialist reviews them. */
  specialist: (NeedItem & { review: ReviewKind })[];
  /** Share of the required and start-level items given (support items are listed, not counted). */
  percent: number;
};

/** Values that mean «I do not know» in option lists: they answer the question but do not supply the information. */
export const UNKNOWN_VALUES = new Set(["unknown", "dont_know"]);
const unknownAnswer = (v: AnswerValue | undefined) => (Array.isArray(v) ? v.length > 0 && v.every((x) => UNKNOWN_VALUES.has(x)) : UNKNOWN_VALUES.has(String(v ?? "")));

/**
 * Completeness of a request against its service's requirements (PURE): what blocks sending, what must be given before
 * work starts, what only helps, and what a specialist must review. Fields and documents that do not apply (hidden by
 * the answers) are left out entirely.
 */
export function intakeNeeds(form: ServiceForm, a: Answers, docs: DocMap): IntakeNeeds {
  const out: IntakeNeeds = { submit: [], start: [], support: [], specialist: [], percent: 100 };
  let total = 0;
  let done = 0;
  for (const st of visibleSteps(form, a))
    for (const f of visibleFields(st, a)) {
      if (f.type === "hidden" || f.type === "ack") continue;
      const v = a[f.key];
      const item: NeedItem = { key: f.key, label: f.label, kind: "field", step: st.key, why: f.why ?? null };
      if (fieldRequired(f, a)) {
        total++;
        if (validateField(f, v, a)) out.submit.push(item);
        // «لا أعرف» answers a required question (the request can be sent) but, for a start-level one, not the
        // information work needs
        else if (f.need === "start" && unknownAnswer(v)) out.start.push({ ...item, why: item.why ?? "أجبت «لا أعرف»: يلزم بيانها قبل بدء العمل." });
        else done++;
      } else if (f.need === "start") {
        total++;
        if (isEmpty(v) || unknownAnswer(v) || validateField(f, v, a)) out.start.push(item);
        else done++;
      } else if (f.need === "support" && (isEmpty(v) || unknownAnswer(v))) out.support.push(item);
      if (f.review && !isEmpty(v)) out.specialist.push({ ...item, review: f.review });
    }
  for (const d of visibleDocs(form, a)) {
    const has = !!docs[d.key]?.length;
    const item: NeedItem = { key: d.key, label: d.label, kind: "doc", step: null, why: d.why ?? null };
    if (docRequired(d, a)) {
      total++;
      if (has) done++;
      else out.submit.push(item);
    } else if (d.need === "start") {
      total++;
      if (has) done++;
      else out.start.push(item);
    } else if (d.need === "support" && !has) out.support.push(item);
  }
  out.percent = total ? Math.round((done / total) * 100) : 100;
  return out;
}

/** Team review of a form document («uploaded» is not «verified»). */
export type DocReviewEntry = { status: "verified" | "rejected"; slot: string; by: string; at: string; note: string | null; itemId?: string };

/**
 * Required document slots with no verified document. A slot also counts as verified when a rejected document in it was
 * replaced through the deficiencies register and the replacement item was accepted.
 */
export function unverifiedSlots(form: ServiceForm, a: Answers, docs: DocMap, review: Record<string, DocReviewEntry>, acceptedItemIds: Set<string>): DocSlot[] {
  return visibleDocs(form, a).filter((s) => docRequired(s, a)).filter((s) => {
    const ok = (docs[s.key] ?? []).some((id) => review[id]?.status === "verified")
      || Object.values(review).some((v) => v.slot === s.key && v.status === "rejected" && !!v.itemId && acceptedItemIds.has(v.itemId));
    return !ok;
  });
}
