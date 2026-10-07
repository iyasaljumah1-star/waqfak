/**
 * Compliance runtime — pure helpers (no DB, no "server-only") so they can be unit-tested.
 *
 * Obligation definitions live in the `obligations` table. The engine reads the structured
 * `applies_to` jsonb (sizeClasses / legalTypes / requiresFlags / excludesFlags) and these optional
 * extension keys stored in the same jsonb (admin-editable data, never code):
 *   - rule           JSON-logic (engines/logic.ts) evaluated against WaqfFactBag. All must pass.
 *   - closesOn       events that close open instances of this obligation, e.g.
 *                    ["registration"] or [{ "event": "cert_expiry", "scope": "other_periods" }].
 *   - satisfiedWhen  JSON-logic: when true for the waqf facts, an instance is created/kept as done
 *                    (e.g. OB-REG-01 is satisfied once the waqf is registered).
 */
import { fiscalYearEnd, lastFiscalYearEnd, addDays, daysBetween, type ISODate, type OffsetUnit } from "../../engines/dates";
import { isApplicable, penaltyBand, statusFor, type ObligationDef } from "../../engines/compliance";
import { test as testLogic, type Logic } from "../../engines/logic";

// ───────────── Types ─────────────

export type ClosureScope = "all_open" | "other_periods" | "earliest_open";
export type ClosesOnEntry = string | { event: string; scope?: ClosureScope };

export type ObligationConfig = {
  sizeClasses?: string[];
  legalTypes?: string[];
  requiresFlags?: string[];
  excludesFlags?: string[];
  rule?: Logic;
  closesOn?: ClosesOnEntry[];
  satisfiedWhen?: Logic;
};

/** The subset of an `obligations` row the runtime needs. */
export type ObligationRow = {
  id: string;
  code: string;
  titleAr: string;
  triggerEvent: string;
  offsetValue: number | null;
  offsetUnit: string;
  recurrence: string;
  appliesTo: unknown;
  severity: "critical" | "high" | "medium" | "low";
  reminderOffsetsDays: number[] | unknown;
  obligationType: string;
  status?: string;
};

export type WaqfProfile = {
  id: string;
  sizeClass: string | null;
  legalType: string | null;
  computedType: string | null;
  status: string;
  nazirMode: string | null;
  creationMode: string | null;
  waqfakRole: string | null;
  collectsDonations: boolean;
  hasForeignParty: boolean;
  hasBeneficiariesAbroad: boolean;
  hasActiveLitigation: boolean;
  directBenefit: boolean;
  founderAlive: boolean | null;
  fiscalYearEnd: string;
  documentedOn: string | null;
  registeredOn: string | null;
  registrationExpiresOn: string | null;
  stage: number;
};

export type FactExtras = {
  portfolioCount?: number;
  beneficiariesAbroad?: number;
  beneficiaryCount?: number;
  beneficialOwnerCount?: number;
  /** Latest assessment facts (key → value), exposed under `assessment.*` and used for a few flags. */
  assessmentFacts?: Record<string, unknown>;
};

/** Facts available to applicability rules (`{"var": "<key>"}`). Keep keys stable: admin rules reference them. */
export type WaqfFactBag = {
  sizeClass: string | null;
  legalType: string | null;
  computedType: string | null;
  status: string;
  nazirMode: string | null;
  creationMode: string | null;
  waqfakRole: string | null;
  collectsDonations: boolean;
  hasForeignParty: boolean;
  hasBeneficiariesAbroad: boolean;
  hasActiveLitigation: boolean;
  directBenefit: boolean;
  founderAlive: boolean | null;
  fiscalYearEnd: string;
  documented: boolean;
  registered: boolean;
  hasBoard: boolean;
  hasPortfolio: boolean;
  conditionSetsPayDate: boolean;
  documentedOn: string | null;
  registeredOn: string | null;
  registrationExpiresOn: string | null;
  stage: number;
  beneficiaryCount: number;
  beneficialOwnerCount: number;
  assessment: Record<string, unknown>;
};

const DOCUMENTED_STATUSES = new Set(["documented", "registered", "active", "suspended"]);
const REGISTERED_STATUSES = new Set(["registered", "active", "suspended"]);

/** Builds the fact bag the applicability rules are evaluated against. */
export function buildFacts(w: WaqfProfile, x: FactExtras = {}): WaqfFactBag {
  const a = x.assessmentFacts ?? {};
  const truthy = (v: unknown) => v === true || v === "yes" || v === "true" || v === 1;
  return {
    sizeClass: w.sizeClass,
    legalType: w.legalType ?? w.computedType,
    computedType: w.computedType ?? w.legalType,
    status: w.status,
    nazirMode: w.nazirMode,
    creationMode: w.creationMode,
    waqfakRole: w.waqfakRole,
    collectsDonations: !!w.collectsDonations,
    hasForeignParty: !!w.hasForeignParty,
    hasBeneficiariesAbroad: !!w.hasBeneficiariesAbroad || (x.beneficiariesAbroad ?? 0) > 0,
    hasActiveLitigation: !!w.hasActiveLitigation,
    directBenefit: !!w.directBenefit || w.sizeClass === "direct_benefit",
    founderAlive: w.founderAlive,
    fiscalYearEnd: w.fiscalYearEnd || "12-31",
    documented: !!w.documentedOn || DOCUMENTED_STATUSES.has(w.status),
    registered: !!w.registeredOn || REGISTERED_STATUSES.has(w.status),
    hasBoard: w.nazirMode === "board",
    hasPortfolio: (x.portfolioCount ?? 0) > 0 || truthy(a.hasPortfolio),
    conditionSetsPayDate: truthy(a.conditionSetsPayDate),
    documentedOn: w.documentedOn,
    registeredOn: w.registeredOn,
    registrationExpiresOn: w.registrationExpiresOn,
    stage: w.stage,
    beneficiaryCount: x.beneficiaryCount ?? 0,
    beneficialOwnerCount: x.beneficialOwnerCount ?? 0,
    assessment: a,
  };
}

/** Boolean facts exposed as `flags` for the structured requiresFlags/excludesFlags checks. */
export function flagsOf(f: WaqfFactBag): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(f)) if (typeof v === "boolean") out[k] = v;
  return out;
}

// ───────────── Definitions ─────────────

export function configOf(row: Pick<ObligationRow, "appliesTo" | "code">): ObligationConfig {
  const c = (row.appliesTo && typeof row.appliesTo === "object" ? row.appliesTo : {}) as ObligationConfig;
  const d = CODE_DEFAULTS[row.code];
  if (!d) return c;
  return { ...d, ...c }; // DB data always wins over the code fallback
}

/**
 * Fallback closure mapping used ONLY when the DB row has no closesOn/satisfiedWhen.
 * The canonical copy is data (scripts/jobs/patch-obligations.ts writes it into obligations.applies_to).
 */
export const CODE_DEFAULTS: Record<string, Partial<ObligationConfig>> = {
  "OB-REG-01": { closesOn: ["registration"], satisfiedWhen: { "!!": { var: "registered" } } },
};

export function rowToDef(row: ObligationRow): ObligationDef {
  const c = configOf(row);
  const rem = Array.isArray(row.reminderOffsetsDays) ? (row.reminderOffsetsDays as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : [30, 7, 1];
  return {
    id: row.id,
    code: row.code,
    titleAr: row.titleAr,
    triggerEvent: row.triggerEvent,
    offsetValue: row.offsetValue,
    offsetUnit: (row.offsetUnit as OffsetUnit) ?? "none",
    recurrence: row.recurrence === "annual" ? "annual" : "none",
    appliesTo: { sizeClasses: c.sizeClasses, legalTypes: c.legalTypes, requiresFlags: c.requiresFlags, excludesFlags: c.excludesFlags },
    severity: row.severity,
    reminderOffsetsDays: rem,
  };
}

/** Structured checks (engines/compliance.isApplicable) AND the optional JSON-logic rule. */
export function applicable(row: ObligationRow, facts: WaqfFactBag): boolean {
  if (row.obligationType === "manual") return false;
  const def = rowToDef(row);
  if (!isApplicable(def, { sizeClass: facts.sizeClass, legalType: facts.legalType, flags: flagsOf(facts) })) return false;
  const c = configOf(row);
  try {
    return testLogic(c.rule ?? null, facts as unknown as Record<string, unknown>);
  } catch {
    return false; // an invalid rule never creates obligations silently; admin validation catches it on save
  }
}

export function isSatisfied(row: ObligationRow, facts: WaqfFactBag): boolean {
  const c = configOf(row);
  if (c.satisfiedWhen === undefined || c.satisfiedWhen === null) return false;
  try {
    return testLogic(c.satisfiedWhen, facts as unknown as Record<string, unknown>);
  } catch {
    return false;
  }
}

/** Returns the closure scope if `event` closes this obligation, else null. */
export function closureFor(row: ObligationRow, event: string): ClosureScope | null {
  const c = configOf(row);
  for (const e of c.closesOn ?? []) {
    if (typeof e === "string" && e === event) return "all_open";
    if (typeof e === "object" && e && e.event === event) return e.scope ?? "all_open";
  }
  return null;
}

// ───────────── Periods ─────────────

/**
 * Events whose date alone identifies the period (a waqf is documented once; a certificate has one expiry date).
 * They are keyed by date even when a refId is given, so profile-derived triggers and explicit emits dedupe.
 */
export const DATE_KEYED_EVENTS = new Set(["documentation", "registration", "cert_expiry", "donation_license_expiry", "fiscal_year_end"]);

/** Dedupe key for an instance: one per waqf + obligation + period. */
export function periodKeyFor(row: Pick<ObligationRow, "recurrence" | "triggerEvent">, e: { event: string; date: string; refId?: string | null }): string {
  if (row.triggerEvent === "standing") return "standing";
  if (row.recurrence === "annual" && e.event === "fiscal_year_end") return `FY${e.date.slice(0, 4)}`;
  if (e.refId && !DATE_KEYED_EVENTS.has(e.event)) return `ref:${e.refId}`;
  return `${e.event}:${e.date}`;
}

/**
 * Fiscal-year-end dates to materialise for annual obligations: the current period (latest FYE on/before today)
 * and the next one. Periods ending before the waqf was documented are skipped.
 */
export function annualPeriods(fyeMMDD: string, today: ISODate, documentedOn: string | null): ISODate[] {
  if (!/^\d{2}-\d{2}$/.test(fyeMMDD)) fyeMMDD = "12-31";
  const last = lastFiscalYearEnd(today, fyeMMDD);
  const next = fiscalYearEnd(addDays(today, 1), fyeMMDD);
  return [last, next].filter((d, i, a) => a.indexOf(d) === i).filter((d) => !documentedOn || d >= documentedOn);
}

/** Profile fields that act as event triggers during sync (so a profile edit alone keeps instances right). */
export const PROFILE_TRIGGERS: Record<string, (f: WaqfFactBag) => string | null> = {
  documentation: (f) => f.documentedOn,
  cert_expiry: (f) => f.registrationExpiresOn,
};

// ───────────── Status helpers ─────────────

export const OPEN_STATUSES = ["upcoming", "due_soon", "overdue"] as const;
export const isOpen = (s: string) => (OPEN_STATUSES as readonly string[]).includes(s);

/** Marker prefix on waived_reason for instances closed because the obligation no longer applies. */
export const NA_MARK = "[غير منطبق] ";
export const isNotApplicable = (status: string, waivedReason: string | null | undefined) => status === "waived" && !!waivedReason?.startsWith(NA_MARK);

export function nextStatus(dueOn: string | null, today: ISODate) {
  return statusFor(dueOn, today, false) as "upcoming" | "due_soon" | "overdue";
}

/** Overdue reminders are sent once at each of these "days late" marks (stored as negative offsets). */
export const OVERDUE_MARKS = [1, 7, 30];

/**
 * Which reminder to send today. Returns the offset to record (positive = before due, negative = days late)
 * plus every offset that becomes "covered" so skipped earlier offsets are not sent afterwards.
 */
export function pickReminder(dueOn: string | null, today: ISODate, offsets: number[], sent: number[]): { kind: "reminder" | "overdue"; offset: number; covered: number[] } | null {
  if (!dueOn) return null;
  const left = daysBetween(today, dueOn);
  if (left < 0) {
    const late = -left;
    const due = OVERDUE_MARKS.filter((m) => late >= m && !sent.includes(-m));
    if (!due.length) return null;
    const m = Math.max(...due);
    return { kind: "overdue", offset: -m, covered: due.map((x) => -x) };
  }
  const due = offsets.filter((o) => left <= o && !sent.includes(o));
  if (!due.length) return null;
  return { kind: "reminder", offset: Math.min(...due), covered: due };
}

/** Readiness = instances completed on/before their due date ÷ instances that have fallen due (waived excluded). */
export function readiness(items: { status: string; dueOn: string | null; completedOn: string | null; waivedReason?: string | null }[], today: ISODate) {
  let due = 0;
  let onTime = 0;
  for (const i of items) {
    if (i.status === "waived" || !i.dueOn) continue; // waived and undated items do not count
    if (i.dueOn <= today) {
      due++;
      if (i.status === "done" && i.completedOn && i.completedOn <= i.dueOn) onTime++;
    } else if (i.status === "done") {
      due++; // done ahead of time
      onTime++;
    }
  }
  return { due, onTime, pct: due ? Math.round((onTime / due) * 100) : null };
}

// ───────────── Penalties ─────────────

export type PenaltyRow = {
  code: string;
  titleAr: string;
  category: string;
  dismissalRisk: string;
  largeText: string | null;
  mediumText: string | null;
  smallText: string | null;
  verificationStatus: string;
};

export const PENDING_SUFFIX = "(تقديري — بانتظار التحقق)";
export const BAND_LABEL = { dismissal: "قد تصل إلى العزل", fine: "غرامة مالية", warning: "إنذار" } as const;

export function penaltyInfo(p: PenaltyRow | null | undefined, severity: string, sizeClass: string | null) {
  if (!p) return null;
  const band = penaltyBand(p.dismissalRisk, severity);
  const sizeText = sizeClass === "large" ? p.largeText : sizeClass === "medium" ? p.mediumText : p.smallText;
  const pending = p.verificationStatus !== "verified";
  const text = `${p.titleAr} (بند ${p.code}) — ${sizeText || BAND_LABEL[band]}${pending ? ` ${PENDING_SUFFIX}` : ""}`;
  return { band, text, pending, code: p.code };
}

// ───────────── Explanations ("لماذا ينطبق علي؟") ─────────────

const SIZE_AR: Record<string, string> = { large: "كبير", medium: "متوسط", small: "صغير", direct_benefit: "ذو انتفاع مباشر" };
const TYPE_AR: Record<string, string> = { public: "عام", private: "خاص", joint: "مشترك" };
export const FACT_LABEL: Record<string, string> = {
  sizeClass: "فئة الحجم",
  legalType: "النوع النظامي",
  status: "حالة الوقف",
  nazirMode: "نمط النظارة",
  collectsDonations: "يجمع تبرعات",
  hasForeignParty: "طرف أجنبي",
  hasBeneficiariesAbroad: "مستفيدون خارج المملكة",
  founderAlive: "الواقف على قيد الحياة",
  fiscalYearEnd: "نهاية السنة المالية",
  documented: "موثّق",
  registered: "مسجّل لدى الهيئة",
  hasBoard: "مجلس نظارة",
  hasPortfolio: "محفظة استثمارية وقفية",
  conditionSetsPayDate: "الشرط يحدد موعد الصرف",
  directBenefit: "ذو انتفاع مباشر",
  registrationExpiresOn: "انتهاء شهادة التسجيل",
};

export function factValueAr(k: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "غير محدد";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (k === "sizeClass") return SIZE_AR[String(v)] ?? String(v);
  if (k === "legalType") return TYPE_AR[String(v)] ?? String(v);
  return String(v);
}

/** Human-readable reasons an obligation applies to this waqf (or not). */
export function explain(row: ObligationRow, facts: WaqfFactBag): string[] {
  const c = configOf(row);
  const out: string[] = [];
  if (c.sizeClasses?.length) out.push(`فئة الحجم «${factValueAr("sizeClass", facts.sizeClass)}» ضمن: ${c.sizeClasses.map((s) => SIZE_AR[s] ?? s).join("، ")}`);
  if (c.legalTypes?.length) out.push(`النوع «${factValueAr("legalType", facts.legalType)}» ضمن: ${c.legalTypes.map((s) => TYPE_AR[s] ?? s).join("، ")}`);
  for (const f of c.requiresFlags ?? []) out.push(`${FACT_LABEL[f] ?? f}: ${factValueAr(f, (facts as Record<string, unknown>)[f])} (شرط لازم)`);
  for (const f of c.excludesFlags ?? []) out.push(`${FACT_LABEL[f] ?? f}: ${factValueAr(f, (facts as Record<string, unknown>)[f])} (يستثنى إن كان نعم)`);
  if (c.rule !== undefined && c.rule !== null) out.push(`قاعدة إضافية من إعدادات الامتثال: ${JSON.stringify(c.rule)}`);
  if (!out.length) out.push("ينطبق على جميع الأوقاف عند وقوع الحدث المنشئ.");
  return out;
}

// ───────────── Labels ─────────────

export const STATUS_AR: Record<string, string> = { upcoming: "قادم", due_soon: "يحين قريبًا", overdue: "متأخر", done: "منجز", waived: "معفى", not_applicable: "غير منطبق" };
export const STATUS_TONE: Record<string, "critical" | "warn" | "info" | "ok" | "neutral"> = { overdue: "critical", due_soon: "warn", upcoming: "info", done: "ok", waived: "neutral", not_applicable: "neutral" };
export const CATEGORY_AR: Record<string, string> = {
  registration: "تسجيل", update: "تحديث", notification: "إشعار", financial: "مالي", disclosure: "إفصاح", retention: "حفظ السجلات",
  governance: "حوكمة", response: "رد وتظلم", distribution: "صرف", manual: "يدوي", other: "أخرى",
};
export const AUTHORITY_AR: Record<string, string> = { gaa: "الهيئة العامة للأوقاف", internal: "داخلي", court: "المحكمة المختصة", competent_authority: "الجهة المختصة", cma: "هيئة السوق المالية", fiu: "الإدارة العامة للتحريات المالية", notary: "كتابة العدل" };
export const EVENT_ACTION_AR: Record<string, string> = {
  created: "أُنشئ", updated: "عُدّل الموعد", status: "تغيّرت الحالة", reminder: "أُرسل تذكير", completed: "أُنجز", reopened: "أُعيد فتحه",
  waived: "أُعفي", not_applicable: "لم يعد منطبقًا", evidence: "أُرفق دليل", closed_by_event: "أُغلق بحدث",
};

// ───────────── Export formats ─────────────

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds lines to 75 octets as RFC 5545 requires (UTF-8 aware). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const l = Buffer.byteLength(ch, "utf8");
    if (len + l > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += l;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildIcs(events: { uid: string; date: string; title: string; description?: string; url?: string }[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Waqfak//Compliance//AR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:التزامات أوقافي — وقفك", "X-WR-TIMEZONE:Asia/Riyadh"];
  for (const e of events) {
    const d = e.date.replace(/-/g, "");
    const end = addDays(e.date, 1).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@waqfak`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${icsEscape(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-P7D", `DESCRIPTION:${icsEscape(e.title)}`, "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** CSV cell: quoted, and neutralises spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildCsv(header: string[], rows: unknown[][]): string {
  return "\uFEFF" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Weeks (Sunday-start, as in KSA) covering a month: [{ start, days: ISO[] }]. */
export function monthWeeks(month: string): { start: string; days: string[] }[] {
  const [y, m] = month.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
  let cur = addDays(first, -dow);
  const weeks: { start: string; days: string[] }[] = [];
  while (cur <= last) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(cur, i));
    weeks.push({ start: cur, days });
    cur = addDays(cur, 7);
  }
  return weeks;
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Parses the manual obligation payload stored on the "created" event note. */
export function parseManual(note: string | null | undefined): { title: string; details?: string; reference?: string } | null {
  if (!note) return null;
  try {
    const v = JSON.parse(note);
    if (v && typeof v.title === "string") return v;
  } catch {}
  return null;
}
export const MANUAL_CODE = "OB-MAN-00";
