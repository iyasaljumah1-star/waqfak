/**
 * Waqf assessment engine (pure). Deterministic: the same bank version + answers always yield the same result.
 * Method (Master Plan §التقييم الوقفي):
 *   Axis_k = 100 × Σ(w·s) / (5·Σw)   over applicable, scored answers
 *   Overall = Σ Axis_k × weight_k(sizeClass) / Σ weight_k   (re-normalized over axes that apply)
 *   Maturity = 0.30·A4 + 0.20·A3 + 0.20·A5 + 0.15·A8 + 0.15·A11
 *   Critical flags override the score: the flagged axis is capped at 39 and the waqf status becomes "critical".
 */
import { evaluate, test, type Facts, type Logic } from "./logic";

export type Option = { value: string; label: string; score?: number | null; unknown?: boolean; na?: boolean };
export type Question = {
  code: string;
  axisCode: string;
  textAr: string;
  answerType: "yes_no" | "yes_partial_no" | "maturity" | "band" | "date" | "select" | "multiselect" | "number" | "text";
  options?: Option[] | null;
  weight: number;
  referenceText?: string | null;
  criticalFlagCode?: string | null;
  criticalWhen?: Logic | null;
  showIf?: Logic | null;
  factKey?: string | null;
  depth?: string;
};
export type Axis = { code: string; nameAr: string; weightSmall: number; weightMedium: number; weightLarge: number };
export type Answer = { value: unknown; evidenceLevel?: "declared" | "document" | "verified" };
export type FlagDef = { code: string; titleAr: string; axisCode?: string | null; severity?: "critical" | "high" | "medium" | "low" };

export type SizeClass = "large" | "medium" | "small" | "direct_benefit";

export type MaturityBand = { min: number; level: string };
export const DEFAULT_MATURITY_BANDS: MaturityBand[] = [
  { min: 90, level: "رائد" },
  { min: 75, level: "متقدم" },
  { min: 60, level: "مُدار" },
  { min: 40, level: "ناشئ" },
  { min: 0, level: "تأسيسي" },
];
export const MATURITY_WEIGHTS: Record<string, number> = { A4: 0.3, A3: 0.2, A5: 0.2, A8: 0.15, A11: 0.15 };

export type ScoredAnswer = { code: string; axisCode: string; score: number | null; unknown: boolean; na: boolean; weight: number; evidence: string };

export type AssessmentOutput = {
  sizeClass: SizeClass | null;
  computedType: { type: "public" | "private" | "joint" | null; reason: string | null };
  axisScores: { axisCode: string; score: number | null; capped: boolean; applicableCount: number; answeredCount: number }[];
  overallScore: number;
  maturityScore: number;
  maturityLevel: string;
  status: "critical" | "needs_intervention" | "stable" | "advanced";
  confidence: "low" | "medium" | "high";
  evidenceRatio: number;
  knowledgeGaps: string[];
  flags: { code: string; questionCode: string | null; titleAr: string; severity: string }[];
  strengths: { code: string; text: string; axis: string }[];
  weaknesses: { code: string; text: string; axis: string; reference?: string }[];
  facts: Facts;
  weightsUsed: Record<string, number>;
  applicableQuestions: string[];
  unansweredRequired: string[];
};

/** Derives the size class from the profile answers (P03 asset band, P04 direct benefit). */
export function deriveSizeClass(facts: Facts): SizeClass | null {
  if (facts.direct_benefit === "yes") return "direct_benefit";
  switch (facts.asset_band) {
    case "gte200":
      return "large";
    case "50to200":
      return "medium";
    case "lt5":
    case "5to50":
    case "lt50":
      return "small";
    default:
      return null;
  }
}

/** Classification per the GAA type guide: charitable condition on descendants (e.g. "the poor among them") makes it public. */
export function deriveType(facts: Facts): { type: "public" | "private" | "joint" | null; reason: string | null } {
  const b = facts.beneficiary_kind;
  if (b === "public") return { type: "public", reason: "الريع مشروط على أوجه بر عامة، فالوقف عام (نظام الهيئة، المادة الأولى)." };
  if (b === "both") return { type: "joint", reason: "شرط الواقف يجمع بين البر العام والذرية أو أشخاص معينين، فالوقف مشترك." };
  if (b === "private") {
    if (facts.charitable_qualifier === "yes")
      return { type: "public", reason: "الوقف على الذرية مقيد بوصف خيري (كالفقر أو الحاجة)، فيُصنَّف عامًا وفق الدليل الاسترشادي لتصنيف أنواع الوقف. يُستحسن تأكيد التصنيف مع مختص." };
    if (facts.then_to_charity === "yes")
      return { type: "private", reason: "الوقف على معينين ثم على جهة بر: يبقى خاصًا ما بقي المعيَّنون، ويتحول عامًا عند انقراضهم." };
    return { type: "private", reason: "الريع مشروط على معينين بالذات أو بالوصف (ذرية أو أقارب أو أشخاص)، فالوقف خاص (أهلي)." };
  }
  return { type: null, reason: null };
}

export function scoreAnswer(q: Question, a: Answer | undefined): { score: number | null; unknown: boolean; na: boolean } {
  if (!a || a.value === undefined || a.value === null || a.value === "") return { score: null, unknown: false, na: false };
  const v = a.value;
  if (q.answerType === "maturity") {
    if (v === "unknown") return { score: 0, unknown: true, na: false };
    if (v === "na") return { score: null, unknown: false, na: true };
    const n = Number(v);
    return Number.isFinite(n) ? { score: Math.max(0, Math.min(5, n)), unknown: false, na: false } : { score: null, unknown: false, na: false };
  }
  if (q.options && q.options.length) {
    const opt = q.options.find((o) => o.value === String(v));
    if (!opt) return { score: null, unknown: false, na: false };
    if (opt.na) return { score: null, unknown: false, na: true };
    if (opt.unknown) return { score: 0, unknown: true, na: false };
    return { score: opt.score ?? null, unknown: false, na: false };
  }
  return { score: null, unknown: false, na: false };
}

export function computeAssessment(input: {
  axes: Axis[];
  questions: Question[];
  answers: Record<string, Answer>;
  flagDefs: FlagDef[];
  baseFacts?: Facts; // facts from the waqf profile / derived dates (e.g. registration_overdue)
  depth?: "basic" | "deep";
  maturityBands?: MaturityBand[];
}): AssessmentOutput {
  const depth = input.depth ?? "basic";
  const facts: Facts = { ...(input.baseFacts ?? {}) };

  // 1) facts from answers (profile first so conditional questions resolve)
  const ordered = [...input.questions].sort((a, b) => (a.axisCode === "P" ? -1 : 0) - (b.axisCode === "P" ? -1 : 0));
  for (const q of ordered) {
    const a = input.answers[q.code];
    if (q.factKey && a && a.value !== undefined && a.value !== null && a.value !== "") facts[q.factKey] = a.value;
  }
  const sizeClass = deriveSizeClass(facts);
  facts.size_class = sizeClass;
  const computedType = deriveType(facts);
  facts.computed_type = computedType.type;

  // 2) applicable questions
  const applicable = input.questions.filter(
    (q) => (depth === "deep" || (q.depth ?? "basic") === "basic") && test(q.showIf ?? null, facts),
  );
  const applicableCodes = new Set(applicable.map((q) => q.code));

  // 3) score
  const scored: ScoredAnswer[] = [];
  const knowledgeGaps: string[] = [];
  const unansweredRequired: string[] = [];
  let withEvidence = 0;
  for (const q of applicable) {
    const a = input.answers[q.code];
    const s = scoreAnswer(q, a);
    if (!a || a.value === undefined || a.value === null || a.value === "") {
      if (q.answerType !== "text") unansweredRequired.push(q.code);
      continue;
    }
    if (s.unknown) {
      knowledgeGaps.push(q.code);
      facts[`unknown_${q.code}`] = true;
    }
    if (q.axisCode !== "P" && (s.score !== null || s.na)) {
      scored.push({ code: q.code, axisCode: q.axisCode, score: s.score, unknown: s.unknown, na: s.na, weight: q.weight, evidence: a.evidenceLevel ?? "declared" });
      if (s.score !== null && a.evidenceLevel && a.evidenceLevel !== "declared") withEvidence++;
    }
    facts[`ans_${q.code}`] = a.value;
    if (s.score !== null) facts[`score_${q.code}`] = s.score;
  }

  // 4) critical flags
  const flags: AssessmentOutput["flags"] = [];
  const flagSeen = new Set<string>();
  const defs = new Map(input.flagDefs.map((f) => [f.code, f]));
  for (const q of applicable) {
    if (!q.criticalFlagCode || !q.criticalWhen) continue;
    const a = input.answers[q.code];
    if (!a || a.value === undefined || a.value === null || a.value === "") continue;
    if (test(q.criticalWhen, { ...facts, answer: a.value }) && !flagSeen.has(q.criticalFlagCode)) {
      flagSeen.add(q.criticalFlagCode);
      flags.push({ code: q.criticalFlagCode, questionCode: q.code, titleAr: defs.get(q.criticalFlagCode)?.titleAr ?? q.criticalFlagCode, severity: defs.get(q.criticalFlagCode)?.severity ?? "critical" });
    }
  }
  // derived flags passed in as facts: flag_<CODE> = true
  for (const [k, v] of Object.entries(facts)) {
    if (k.startsWith("flag_") && v === true) {
      const code = k.slice(5);
      if (!flagSeen.has(code) && defs.has(code)) {
        flagSeen.add(code);
        flags.push({ code, questionCode: null, titleAr: defs.get(code)!.titleAr, severity: defs.get(code)!.severity ?? "critical" });
      }
    }
  }
  for (const f of flags) facts[`flag_${f.code}`] = true;
  const criticalFlags = flags.filter((f) => f.severity === "critical");
  const cappedAxes = new Set(criticalFlags.map((f) => defs.get(f.code)?.axisCode).filter(Boolean) as string[]);

  // 5) axis scores
  const axisScores = input.axes.map((ax) => {
    const items = scored.filter((s) => s.axisCode === ax.code && s.score !== null);
    const applicableCount = applicable.filter((q) => q.axisCode === ax.code).length;
    const answeredCount = scored.filter((s) => s.axisCode === ax.code).length;
    if (!items.length) return { axisCode: ax.code, score: null as number | null, capped: false, applicableCount, answeredCount };
    const wsum = items.reduce((a, s) => a + s.weight, 0);
    let score = (100 * items.reduce((a, s) => a + s.weight * (s.score ?? 0), 0)) / (5 * wsum);
    let capped = false;
    if (cappedAxes.has(ax.code) && score > 39) {
      score = 39;
      capped = true;
    }
    return { axisCode: ax.code, score: Math.round(score * 10) / 10, capped, applicableCount, answeredCount };
  });
  for (const a of axisScores) facts[`axis_${a.axisCode}`] = a.score;

  // 6) overall (size-weighted, re-normalized)
  const wKey = sizeClass === "large" ? "weightLarge" : sizeClass === "medium" ? "weightMedium" : "weightSmall";
  const weightsUsed: Record<string, number> = {};
  let wTotal = 0;
  let acc = 0;
  for (const ax of input.axes) {
    const s = axisScores.find((x) => x.axisCode === ax.code)?.score;
    if (s === null || s === undefined) continue;
    const w = Number(ax[wKey]);
    weightsUsed[ax.code] = w;
    wTotal += w;
    acc += s * w;
  }
  const overallScore = wTotal ? Math.round((acc / wTotal) * 10) / 10 : 0;

  // 7) maturity (composite, re-normalized)
  let mT = 0;
  let mA = 0;
  for (const [code, w] of Object.entries(MATURITY_WEIGHTS)) {
    const s = axisScores.find((x) => x.axisCode === code)?.score;
    if (s === null || s === undefined) continue;
    mT += w;
    mA += s * w;
  }
  const maturityScore = mT ? Math.round((mA / mT) * 10) / 10 : 0;
  const bands = [...(input.maturityBands ?? DEFAULT_MATURITY_BANDS)].sort((a, b) => b.min - a.min);
  const maturityLevel = bands.find((b) => maturityScore >= b.min)?.level ?? bands[bands.length - 1].level;

  // 8) status & confidence
  const status: AssessmentOutput["status"] = criticalFlags.length
    ? "critical"
    : overallScore < 50
      ? "needs_intervention"
      : overallScore < 75
        ? "stable"
        : "advanced";
  const scoredCount = scored.filter((s) => s.score !== null).length || 1;
  const evidenceRatio = Math.round((withEvidence / scoredCount) * 100) / 100;
  const confidence = evidenceRatio > 0.7 ? "high" : evidenceRatio >= 0.3 ? "medium" : "low";

  // 9) strengths / weaknesses
  const byCode = new Map(input.questions.map((q) => [q.code, q]));
  const strengths = scored
    .filter((s) => (s.score ?? 0) >= 4)
    .map((s) => ({ code: s.code, text: byCode.get(s.code)!.textAr, axis: s.axisCode }));
  const weaknesses = scored
    .filter((s) => s.score !== null && s.score <= 2)
    .map((s) => ({ code: s.code, text: byCode.get(s.code)!.textAr, axis: s.axisCode, reference: byCode.get(s.code)!.referenceText ?? undefined }));

  facts.overall_score = overallScore;
  facts.maturity_score = maturityScore;
  facts.critical_count = criticalFlags.length;
  facts.knowledge_gaps = knowledgeGaps.length;

  return {
    sizeClass,
    computedType,
    axisScores,
    overallScore,
    maturityScore,
    maturityLevel,
    status,
    confidence,
    evidenceRatio,
    knowledgeGaps,
    flags,
    strengths,
    weaknesses,
    facts,
    weightsUsed,
    applicableQuestions: [...applicableCodes],
    unansweredRequired,
  };
}

/** Questions to display for the current answers (dynamic transitions / conditional questions). */
export function visibleQuestions(questions: Question[], answers: Record<string, Answer>, baseFacts: Facts = {}, depth: "basic" | "deep" = "basic") {
  const facts: Facts = { ...baseFacts };
  for (const q of questions) {
    const a = answers[q.code];
    if (q.factKey && a && a.value !== undefined && a.value !== null && a.value !== "") facts[q.factKey] = a.value;
  }
  facts.size_class = deriveSizeClass(facts);
  facts.computed_type = deriveType(facts).type;
  return questions.filter((q) => (depth === "deep" || (q.depth ?? "basic") === "basic") && test(q.showIf ?? null, facts));
}

export { evaluate };
