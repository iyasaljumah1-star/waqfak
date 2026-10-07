/**
 * Pure helpers for the assessment runtime (no DB, no server-only): fact derivation, confidence,
 * wave due dates, waqf-profile prefill and option rendering. Unit-tested in tests/assessment-runtime.test.ts.
 */
import { addBusinessDays, addDays, daysBetween, type ISODate } from "../../engines/dates";
import type { Answer, Option, Question } from "../../engines/assessment";
import type { Facts } from "../../engines/logic";

export const REGISTRATION_BUSINESS_DAYS = 30; // OB-REG-01 / لائحة تنظيم أعمال النظارة م8/1
export const CERT_EXPIRY_WARNING_DAYS = 60;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isISODate = (v: unknown): v is ISODate => typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

export type WaqfProfile = {
  name?: string | null;
  documentedOn?: string | null;
  registeredOn?: string | null;
  registrationExpiresOn?: string | null;
  sizeClass?: string | null;
  legalType?: string | null;
  nazirMode?: string | null;
  waqfakRole?: string | null;
  hasActiveLitigation?: boolean | null;
  collectsDonations?: boolean | null;
  hasForeignParty?: boolean | null;
  hasBeneficiariesAbroad?: boolean | null;
  founderAlive?: boolean | null;
  directBenefit?: boolean | null;
  status?: string | null;
  assetsEstimatedValue?: string | number | null;
};

export type DerivedFact = { key: string; value: unknown; source: "derived" | "waqf_profile" };

/**
 * Facts that do not come straight from an answer:
 *  - registration_overdue: documented + 30 business days (Fri/Sat and official holidays skipped) has passed and the waqf is not registered (OB-REG-01).
 *  - certificate_expiring / certificate_expired: from the answer A2-05 or the waqf profile.
 *  - waqf profile facts when a waqf is linked (waqfak_role, nazir mode, litigation…).
 */
export function deriveBaseFacts(input: {
  answers: Record<string, Answer>;
  waqf?: WaqfProfile | null;
  holidays: Set<string>;
  today: ISODate;
}): DerivedFact[] {
  const { answers, waqf, holidays, today } = input;
  const out: DerivedFact[] = [];
  const val = (code: string) => answers[code]?.value;

  // Documentation date: answer first, profile second.
  const documentedOn = isISODate(val("A2-02")) ? (val("A2-02") as ISODate) : isISODate(waqf?.documentedOn) ? (waqf!.documentedOn as ISODate) : null;
  const isDocumented = val("A2-01") === "yes" || (!!waqf?.documentedOn && val("A2-01") !== "no");
  const registeredAnswer = val("A2-03");
  const isRegistered = registeredAnswer === "yes" || (registeredAnswer === undefined && !!waqf?.registeredOn);
  if (documentedOn) {
    const deadline = addBusinessDays(documentedOn, REGISTRATION_BUSINESS_DAYS, holidays);
    out.push({ key: "registration_deadline", value: deadline, source: "derived" });
    out.push({ key: "registration_overdue", value: isDocumented && !isRegistered && deadline < today, source: "derived" });
  } else {
    out.push({ key: "registration_overdue", value: false, source: "derived" });
  }

  // Certificate expiry
  const expires = isISODate(val("A2-05")) ? (val("A2-05") as ISODate) : isISODate(waqf?.registrationExpiresOn) ? (waqf!.registrationExpiresOn as ISODate) : null;
  if (expires) {
    const left = daysBetween(today, expires);
    out.push({ key: "certificate_days_left", value: left, source: "derived" });
    out.push({ key: "certificate_expired", value: left < 0, source: "derived" });
    out.push({ key: "certificate_expiring", value: left >= 0 && left <= CERT_EXPIRY_WARNING_DAYS, source: "derived" });
  } else {
    out.push({ key: "certificate_expiring", value: false, source: "derived" });
    out.push({ key: "certificate_expired", value: false, source: "derived" });
  }

  if (waqf) {
    out.push({ key: "waqf_linked", value: true, source: "waqf_profile" });
    out.push({ key: "waqfak_role", value: waqf.waqfakRole ?? "none", source: "waqf_profile" });
    if (waqf.nazirMode) out.push({ key: "profile_nazir_mode", value: waqf.nazirMode, source: "waqf_profile" });
    if (waqf.sizeClass) out.push({ key: "profile_size_class", value: waqf.sizeClass, source: "waqf_profile" });
    if (waqf.legalType) out.push({ key: "profile_legal_type", value: waqf.legalType, source: "waqf_profile" });
    out.push({ key: "gaa_is_nazir", value: waqf.nazirMode === "gaa", source: "waqf_profile" });
    out.push({ key: "profile_litigation", value: !!waqf.hasActiveLitigation, source: "waqf_profile" });
  } else {
    out.push({ key: "waqfak_role", value: "none", source: "derived" });
  }
  return out;
}

export const factsObject = (list: DerivedFact[]): Facts => Object.fromEntries(list.map((f) => [f.key, f.value]));

/** Prefills profile answers from a linked waqf's file (the user reviews and can change them). */
export function prefillFromWaqf(w: WaqfProfile): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  if (w.status) a.P01 = ["idea", "draft", "documenting"].includes(w.status) ? "establishing" : "existing";
  if (w.legalType) a.P02 = w.legalType === "joint" ? "both" : w.legalType;
  if (w.sizeClass === "large") a.P03 = "gte200";
  else if (w.sizeClass === "medium") a.P03 = "50to200";
  else if (w.sizeClass === "small" || w.sizeClass === "direct_benefit") {
    const v = Number(w.assetsEstimatedValue ?? NaN);
    if (Number.isFinite(v)) a.P03 = v < 5_000_000 ? "lt5" : "5to50";
  }
  if (w.directBenefit !== null && w.directBenefit !== undefined) a.P04 = w.directBenefit || w.sizeClass === "direct_benefit" ? "yes" : "no";
  if (w.nazirMode) a.P06 = w.nazirMode;
  if (w.founderAlive !== null && w.founderAlive !== undefined) a.P07 = w.founderAlive ? "yes" : "no";
  if (w.hasForeignParty !== null && w.hasForeignParty !== undefined) a.P08 = w.hasForeignParty ? "yes" : "no";
  if (w.hasBeneficiariesAbroad !== null && w.hasBeneficiariesAbroad !== undefined) a.P09 = w.hasBeneficiariesAbroad ? "yes" : "no";
  if (w.collectsDonations !== null && w.collectsDonations !== undefined) a.P10 = w.collectsDonations ? "yes" : "no";
  if (w.hasActiveLitigation !== null && w.hasActiveLitigation !== undefined) a.P11 = w.hasActiveLitigation ? "yes" : "no";
  if (w.documentedOn) {
    a["A2-01"] = "yes";
    a["A2-02"] = w.documentedOn;
    a["A2-03"] = w.registeredOn ? "yes" : "no";
    if (w.registrationExpiresOn) a["A2-05"] = w.registrationExpiresOn;
  }
  return a;
}

export type ConfidenceLevel = "low" | "medium" | "high";
const RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
const FROM_RANK: ConfidenceLevel[] = ["low", "medium", "high"];

/**
 * Confidence shown to the user: the lower of
 *   completeness (share of applicable scored questions answered with a known answer) and
 *   evidence (declared answers without documents cap confidence at "medium").
 */
export function combinedConfidence(input: { engineConfidence: ConfidenceLevel; applicableScored: number; knownAnswered: number; unknownCount: number }): {
  level: ConfidenceLevel;
  completeness: number;
  reasons: string[];
} {
  const completeness = input.applicableScored ? Math.round((input.knownAnswered / input.applicableScored) * 100) / 100 : 0;
  const byCompleteness: ConfidenceLevel = completeness >= 0.9 ? "high" : completeness >= 0.7 ? "medium" : "low";
  const evidenceCap: ConfidenceLevel = input.engineConfidence === "low" ? "medium" : "high";
  const level = FROM_RANK[Math.min(RANK[byCompleteness], RANK[evidenceCap])];
  const reasons: string[] = [];
  if (input.unknownCount > 0) reasons.push(`أجبت «لا أعلم» في ${input.unknownCount} ${input.unknownCount === 1 ? "سؤال" : input.unknownCount <= 10 ? "أسئلة" : "سؤالًا"}، وتُحسب هذه الإجابات صفرًا فتخفض الدرجة والثقة معًا.`);
  const skipped = input.applicableScored - input.knownAnswered - input.unknownCount;
  if (skipped > 0) reasons.push(`تركت ${skipped} ${skipped === 1 ? "سؤالًا" : "أسئلة"} دون إجابة، فاستُبعدت من الحساب.`);
  if (input.engineConfidence === "low") reasons.push("الإجابات مُقرّة منك دون مستندات داعمة، لذلك لا تتجاوز الثقة «متوسطة». ترفع المراجعة المعمّقة مع المستندات الثقة.");
  return { level, completeness, reasons };
}

/** Due date for a recommendation wave: 1 → 30 days, 2 → 90 days, 3 → 12 months. */
export function waveDueDate(wave: number, from: ISODate): ISODate {
  return addDays(from, wave === 1 ? 30 : wave === 2 ? 90 : 365);
}

export const WAVE_LABEL: Record<number, string> = { 1: "الآن", 2: "خلال 90 يومًا", 3: "خلال سنة" };
export const WAVE_HINT: Record<number, string> = {
  1: "كل ما هو حرج أو موعده خلال 30 يومًا",
  2: "أولويات عالية خلال ثلاثة أشهر",
  3: "تحسينات تبني النضج خلال السنة",
};

export const STATUS_VIEW: Record<string, { label: string; tone: "critical" | "fine" | "info" | "ok"; summary: string }> = {
  critical: { label: "حرج", tone: "critical", summary: "توجد مخالفة جوهرية واحدة على الأقل تستوجب معالجة فورية، مهما كانت الدرجة الكلية." },
  needs_intervention: { label: "يحتاج تدخلًا", tone: "fine", summary: "لا توجد علامات حرجة، لكن الدرجة الكلية أقل من 50 وتحتاج خطة تحسين واضحة." },
  stable: { label: "مستقر", tone: "info", summary: "الأساسيات قائمة، وأمامك فرص تحسين محددة لرفع النضج." },
  advanced: { label: "متقدم", tone: "ok", summary: "الوقف في وضع جيد؛ حافظ على الممارسات وراجعها دوريًا." },
};

export const CONFIDENCE_LABEL: Record<string, string> = { low: "منخفضة", medium: "متوسطة", high: "عالية" };

/** Default option sets for answer types that do not carry options in the bank. */
export const MATURITY_OPTIONS: Option[] = [
  { value: "0", label: "غير موجود", score: 0 },
  { value: "1", label: "فكرة أو ممارسة شفهية", score: 1 },
  { value: "2", label: "موجود جزئيًا", score: 2 },
  { value: "3", label: "مكتوب ومعتمد", score: 3 },
  { value: "4", label: "مكتوب ومطبق بانتظام", score: 4 },
  { value: "5", label: "مطبق ويُراجع دوريًا", score: 5 },
  { value: "unknown", label: "لا أعلم", unknown: true },
];

export function optionsFor(q: Pick<Question, "answerType" | "options">): Option[] {
  if (q.answerType === "maturity") return MATURITY_OPTIONS;
  return q.options ?? [];
}

/** Whether a question accepts "لا أعلم". */
export const allowsUnknown = (q: Pick<Question, "answerType" | "options">) =>
  q.answerType === "maturity" || q.answerType === "date" || !!q.options?.some((o) => o.unknown);

export const isAnswered = (v: unknown) => !(v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0));

/** Human-readable answer label (for the review admin and the share-free result). */
export function answerLabel(q: Pick<Question, "answerType" | "options">, v: unknown): string {
  if (!isAnswered(v)) return "—";
  if (v === "unknown") return "لا أعلم";
  const opts = optionsFor(q);
  if (Array.isArray(v)) return v.map((x) => opts.find((o) => o.value === x)?.label ?? String(x)).join("، ");
  return opts.find((o) => o.value === String(v))?.label ?? String(v);
}

/** Display steps: profile first, then each axis that has at least one visible question. */
export function stepsFor(visible: Pick<Question, "axisCode">[], axisOrder: string[]): string[] {
  const present = new Set(visible.map((q) => q.axisCode));
  return ["P", ...axisOrder.filter((a) => present.has(a))];
}
