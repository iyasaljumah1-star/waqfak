/**
 * Service intake form engine (PURE: shared by the client wizard and the server validation).
 *
 * A service form is a list of steps; each step has fields; fields and document slots may be shown or required
 * conditionally on earlier answers. Answers are stored as strings (or string[] for multi-choice) in
 * service_requests.intake.answers, together with the form version they follow.
 */

export type Cond =
  | { field: string; eq?: string; in?: string[]; notEmpty?: boolean; not?: boolean }
  | { all: Cond[] }
  | { any: Cond[] };

export type FieldType =
  | "text" | "textarea" | "number" | "money" | "percent" | "date" | "select" | "radio" | "checkboxes" | "yesno"
  | "phone" | "email" | "idnumber" | "ack"
  /** Repeating rows (e.g. bequests, beneficiary classes, parties). Stored as a JSON string of row objects. */
  | "table";

/** A column of a table field. Cells are validated like fields of the same type. */
export type Column = {
  key: string;
  label: string;
  type: "text" | "number" | "money" | "percent" | "select" | "date" | "idnumber";
  required?: boolean;
  options?: readonly (readonly [string, string])[];
  min?: number;
  max?: number;
  /** Shown only when another cell of the same row has a value (e.g. amount when kind = fixed). */
  showIf?: { col: string; in: string[] };
};

export type PrefillKey =
  | "user.fullName" | "user.phone" | "user.email" | "waqf.name" | "waqf.sizeClass" | "waqf.deedNo" | "waqf.registrationCertNo"
  | "waqf.fiscalYearEnd" | "waqf.nationalUnifiedNumber";

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
  /** Spans the full width in the two-column layout. */
  wide?: boolean;
  /** Table fields: columns and row limits. */
  columns?: Column[];
  minRows?: number;
  maxRows?: number;
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

export type Step = { key: string; title: string; intro?: string; fields: Field[]; showIf?: Cond };

export type DocSlot = {
  key: string;
  docType: string;
  label: string;
  required?: boolean;
  requiredIf?: Cond;
  showIf?: Cond;
  hint?: string;
};

export type ServiceForm = {
  code: string;
  version: number;
  steps: Step[];
  docs: DocSlot[];
  /** Where the questions come from (project reference files or the service definition). */
  sources: string[];
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
    case "checkboxes": {
      const arr = Array.isArray(v) ? v : [s];
      return arr.every((x) => f.options?.some(([k]) => k === x)) ? null : `«${f.label}»: اختيار غير صالح.`;
    }
    case "table": {
      const rows = tableRows(v);
      if (rows.length < (f.minRows ?? (fieldRequired(f, a) ? 1 : 0))) return `«${f.label}»: أضف ${f.minRows ?? 1} صفًا على الأقل.`;
      for (const [i, r] of rows.entries())
        for (const c of (f.columns ?? []).filter((c) => cellVisible(c, r))) {
          const cellField: Field = { key: c.key, label: `${f.label} — الصف ${i + 1}: ${c.label}`, type: c.type, required: c.required, options: c.options, min: c.min, max: c.max };
          const e = validateField(cellField, r[c.key], a);
          if (e) return e;
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
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
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
  return rows.map((r, i) => `${i + 1}) ${(f.columns ?? []).filter((c) => cellVisible(c, r) && r[c.key]).map((c) => `${c.label}: ${cellDisplay(c, r[c.key])}`).join("، ")}`).join("\n");
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
    rows: visibleFields(st, a).filter((f) => f.type !== "ack").map((f) => ({ key: f.key, label: f.label, value: displayValue(f, a[f.key]) })),
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
