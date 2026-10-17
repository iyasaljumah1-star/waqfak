/**
 * Waqf-file context of a service request (PURE types and helpers).
 *
 * A request starts from what the platform already holds about the waqf: each context block reads one source of record
 * (the waqf file, the board register, meetings, the finance records, the document vault…) and reports what it found,
 * where it comes from, how recent it is, and what is missing or outdated. Nothing is invented: a block with no records
 * says so. Blocks are read live from their source; a request keeps a snapshot only when an output is drafted from it.
 */

export const CONTEXT_KEYS = [
  "waqf.identity", "waqf.terms", "waqf.nazara", "board.composition", "governance.rules", "board.meetings", "board.resolutions",
  "governance.policies", "governance.evaluations", "assets.register", "finance.records", "beneficiaries.register", "documents.key",
  "compliance.obligations", "risks.register", "history.requests",
] as const;
export type ContextKey = (typeof CONTEXT_KEYS)[number];

/**
 * recorded: present and current · partial: present but incomplete · stale: present but outdated (expired, overdue review,
 * old valuation…) · missing: nothing recorded.
 */
export type ContextStatus = "recorded" | "partial" | "stale" | "missing";

export type ContextRow = { label: string; value: string; status?: "ok" | "warn" | "stale" | "missing" };
export type ContextTable = { columns: string[]; rows: string[][] };

export type ContextBlock = {
  key: ContextKey;
  title: string;
  /** Source of record, in words (e.g. «سجل مجلس النظارة في ملف الوقف»). */
  source: string;
  /** Where the source is updated in the waqf file (relative to /app/w/{waqfId}); null when it is not edited there. */
  path: string | null;
  /** Latest update among the records read (ISO date-time), null when nothing is recorded. */
  asOf: string | null;
  status: ContextStatus;
  rows: ContextRow[];
  table?: ContextTable;
  /** What is missing or outdated, in plain words (each one can become a completion request or a task). */
  gaps: string[];
  /** Figures for the analysis (counts, dates, flags): read by the insight rules, never shown raw. */
  facts: Record<string, string | number | boolean | null>;
  /** Fingerprint of what the block shows: an approval made on an older fingerprint is shown as outdated. */
  fingerprint: string;
};

export type ContextParams = { from: string; to: string; year: number | null };

export const CONTEXT_STATUS_AR: Record<ContextStatus, string> = {
  recorded: "مسجلة ومحدّثة",
  partial: "مسجلة جزئيًا",
  stale: "مسجلة وتحتاج تحديثًا",
  missing: "غير مسجلة",
};

export const CONTEXT_TITLE_AR: Record<ContextKey, string> = {
  "waqf.identity": "هوية الوقف وتسجيله",
  "waqf.terms": "وثيقة الوقف وشروطه ومصارفه",
  "waqf.nazara": "النظارة",
  "board.composition": "مجلس النظارة وأعضاؤه",
  "governance.rules": "صلاحيات المجلس وآلية الإدارة",
  "board.meetings": "اجتماعات المجلس ومحاضرها",
  "board.resolutions": "القرارات والتكليفات وتنفيذها",
  "governance.policies": "اللوائح والسياسات",
  "governance.evaluations": "تقييمات الأداء السابقة",
  "assets.register": "سجل الأصول",
  "finance.records": "السجلات المالية",
  "beneficiaries.register": "المستفيدون والمستفيد الحقيقي",
  "documents.key": "الوثائق الأساسية",
  "compliance.obligations": "الالتزامات النظامية",
  "risks.register": "سجل المخاطر",
  "history.requests": "طلبات ومخرجات سابقة للخدمة نفسها",
};

/** Field key used for a context block in field states, notes and tasks. */
export const ctxField = (k: ContextKey) => `ctx:${k}`;
export const isCtxField = (k: string): k is `ctx:${ContextKey}` => k.startsWith("ctx:") && (CONTEXT_KEYS as readonly string[]).includes(k.slice(4));

/** Worst status of a set of row statuses (for blocks built from several records). */
export function blockStatus(present: boolean, rows: { status?: ContextRow["status"] }[], gaps: string[]): ContextStatus {
  if (!present) return "missing";
  if (rows.some((r) => r.status === "stale")) return "stale";
  if (gaps.length || rows.some((r) => r.status === "missing" || r.status === "warn")) return "partial";
  return "recorded";
}

/** Default period of a request: the year asked for, explicit dates, or the twelve months up to today. */
export function periodFor(answers: Record<string, unknown>, today: string, yearKeys: string[] = ["period", "fiscalYear", "year"]): ContextParams {
  const from = typeof answers.periodFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(answers.periodFrom) ? answers.periodFrom : null;
  const to = typeof answers.periodTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(answers.periodTo) ? answers.periodTo : null;
  if (from && to && from <= to) return { from, to, year: Number(to.slice(0, 4)) };
  for (const k of yearKeys) {
    const y = Number(answers[k]);
    if (Number.isInteger(y) && y >= 1990 && y <= 2100) return { from: `${y}-01-01`, to: `${y}-12-31`, year: y };
  }
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return { from: d.toISOString().slice(0, 10), to: today, year: null };
}
