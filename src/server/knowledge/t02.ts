/**
 * T02 «تحليل الاحتياج المجتمعي لاختيار المصرف» — the methodology's rules as code (PURE, unit-tested with the synthetic
 * cases TC1–TC12 of the T02 report). Owner's order 2026-11-06, §3 (T02):
 *  - every figure carries its source, date and geographic scope (R1, R2);
 *  - a country or region figure is never presented as local data for a smaller area (R4): only as a labelled estimate
 *    with its formula;
 *  - actual and estimated data are kept apart, and an estimate taints whatever is computed from it (R5);
 *  - an old figure is labelled with its year and cannot alone support a decisive recommendation (R3);
 *  - the waqif's condition comes first (R6): a specific condition admits only the purposes within it; an ambiguous one
 *    suspends the study;
 *  - with insufficient or conflicting data the output is «مؤشرات أولية — لا توصية حاسمة», the gaps, and how to fill
 *    them (an official data request or a field study) (R8, R11);
 *  - field cells under 10 persons are suppressed (R12); a human analyst and a sharia reviewer approve the study (R14).
 */

export const GEO_LEVELS = ["country", "region", "governorate", "city", "district"] as const;
export type GeoLevel = (typeof GEO_LEVELS)[number];
export const GEO_AR: Record<GeoLevel, string> = { country: "المملكة", region: "المنطقة", governorate: "المحافظة", city: "المدينة", district: "الحي" };

export type DataClass = "official_published" | "official_provided" | "academic" | "field" | "estimate_assumption";
export const DATA_CLASS_AR: Record<DataClass, string> = {
  official_published: "بيانات رسمية منشورة", official_provided: "بيانات رسمية مقدمة من جهة مختصة", academic: "بيانات بحثية أو أكاديمية",
  field: "بيانات ميدانية", estimate_assumption: "بيانات تقديرية أو افتراضات تحليلية",
};

export type Figure = {
  indicator: string;
  value: number | null;
  unit: string;
  dataClass: DataClass;
  /** Reference in the catalog or the request's reference; required for every class except an estimate. */
  sourceId?: string | null;
  sourceUrl?: string | null;
  /** Year (or period start) the figure describes. */
  refYear?: number | null;
  geoLevel?: GeoLevel | null;
  geoCode?: string | null;
  /** For an estimate: how it was computed, from which figures, and why. */
  formula?: string | null;
  rationale?: string | null;
  /** For field data: number of persons in the cell. */
  cellSize?: number | null;
  /** Freshness limit of the indicator (methodology table). */
  minFreshnessYears?: number;
  /** Purpose (masraf) the figure measures, or "supply" for existing services. */
  purpose: string;
  side: "need" | "supply";
};

export type FigureCheck = { figure: Figure; shown: boolean; label: string; issues: string[]; estimate: boolean; old: boolean; scopeOk: boolean; official: boolean };

const levelIdx = (l: GeoLevel) => GEO_LEVELS.indexOf(l);

/** R1–R5, R12: whether a figure may be shown, how it is labelled, and what it may support. */
export function checkFigure(f: Figure, study: { level: GeoLevel; year: number }): FigureCheck {
  const issues: string[] = [];
  const estimate = f.dataClass === "estimate_assumption";
  let shown = true;
  if (f.value === null) {
    shown = false;
    issues.push("غير متاح في المصادر التي تمت مراجعتها");
  }
  if (!estimate && !f.sourceId && !f.sourceUrl) {
    shown = false;
    issues.push("رقم بلا مصدر: لا يُعرض (R1، R2)");
  }
  if (!estimate && (!f.refYear || !f.geoLevel)) {
    shown = false;
    issues.push("ينقصه تاريخ البيان أو نطاقه الجغرافي: لا يُعرض (R1)");
  }
  if (estimate && (!f.formula || !f.rationale)) {
    shown = false;
    issues.push("تقدير بلا معادلة أو مبرر: لا يُعرض (R5)");
  }
  if (f.dataClass === "field" && (f.cellSize ?? 0) < 10) {
    shown = false;
    issues.push("خلية ميدانية دون 10 أشخاص: تُحجب (R12)");
  }
  // a wider figure for a smaller area is not local data (R4): allowed only as a labelled estimate
  let scopeOk = true;
  if (f.geoLevel && levelIdx(f.geoLevel) < levelIdx(study.level)) {
    scopeOk = false;
    if (!estimate) issues.push(`رقم على مستوى ${GEO_AR[f.geoLevel]} لا يُعرض على أنه بيان ${GEO_AR[study.level]}؛ يُذكر بنطاقه أو يُقدَّر بمعادلة موسومة (R4)`);
  }
  const old = !!f.refYear && study.year - f.refYear > (f.minFreshnessYears ?? 3);
  if (old) issues.push(`قديم – ${f.refYear} (R3)`);
  const official = f.dataClass === "official_published" || f.dataClass === "official_provided";
  const scope = f.geoLevel ? `${GEO_AR[f.geoLevel]}${f.geoCode ? ` ${f.geoCode}` : ""}` : "نطاق غير محدد";
  const label = `${DATA_CLASS_AR[f.dataClass]} — ${f.sourceId ?? f.sourceUrl ?? "تقدير"}، ${f.refYear ?? "تاريخ غير محدد"}، ${scope}${old ? ` — قديم (${f.refYear})` : ""}${estimate ? " — تقديري" : ""}`;
  return { figure: f, shown, label, issues, estimate, old, scopeOk, official };
}

export type WaqifCondition = { kind: "specific" | "general" | "ambiguous"; permittedPurposes: string[] };

export type StudyInput = {
  level: GeoLevel;
  year: number;
  /** The domain the client asks about (for the report). */
  requestedDomain: string;
  /** Candidate purposes in the domain. */
  candidates: string[];
  condition: WaqifCondition;
  figures: Figure[];
  /** Ranking stability from the sensitivity analysis (R10); false lowers confidence one step. */
  rankingStable?: boolean;
};

export type StudyOutcome = {
  status: "suspended" | "out_of_condition" | "preliminary" | "recommendation";
  confidence: "high" | "medium" | "low";
  candidates: string[];
  excluded: { purpose: string; why: string }[];
  figures: FigureCheck[];
  gaps: string[];
  dataRequests: string[];
  statement: string;
  /** Always required before delivery (R14). */
  approvals: ["محلل", "مراجع شرعي"];
};

/** R6, R8, R10, R11: what the study may conclude. */
export function assessStudy(x: StudyInput): StudyOutcome {
  const base = { figures: x.figures.map((f) => checkFigure(f, x)), approvals: ["محلل", "مراجع شرعي"] as ["محلل", "مراجع شرعي"] };
  if (x.condition.kind === "ambiguous") {
    return { ...base, status: "suspended", confidence: "low", candidates: [], excluded: [], gaps: ["شرط الواقف غامض"], dataRequests: ["طلب تفسير الشرط من الواقف أو الجهة المختصة (لائحة تنظيم أعمال النظارة م9/2)"], statement: "تُعلّق الدراسة: شرط الواقف غامض، ولا تُرتب المصارف قبل تفسيره." };
  }
  const allowed = x.condition.kind === "specific" ? x.candidates.filter((c) => x.condition.permittedPurposes.includes(c)) : x.candidates;
  const excluded = x.candidates.filter((c) => !allowed.includes(c)).map((purpose) => ({ purpose, why: "خارج المصارف التي يسمح بها شرط الواقف (لائحة تنظيم أعمال النظارة م9/1، م9/3)" }));
  if (!allowed.length) {
    return { ...base, status: "out_of_condition", confidence: "low", candidates: [], excluded, gaps: [], dataRequests: [], statement: `لا توصية: المجال المطلوب «${x.requestedDomain}» خارج المصارف التي يسمح بها شرط الواقف. المصارف المسموحة: ${x.condition.permittedPurposes.join("، ") || "—"}.` };
  }
  const gaps: string[] = [];
  const requests = new Set<string>();
  let sufficientAll = true;
  let degraded = 0;
  for (const p of allowed) {
    const mine = base.figures.filter((c) => c.figure.purpose === p || (c.figure.side === "supply" && c.figure.purpose === p));
    // R8: ≥ 2 need and ≥ 1 supply figures, official, recent, at the study's level or one level wider
    const usable = mine.filter((c) => c.shown && c.official && !c.old && !c.estimate && c.figure.geoLevel && levelIdx(x.level) - levelIdx(c.figure.geoLevel) <= 1);
    const need = usable.filter((c) => c.figure.side === "need").length;
    const supply = usable.filter((c) => c.figure.side === "supply").length;
    if (need < 2 || supply < 1) {
      sufficientAll = false;
      gaps.push(`${p}: مؤشرات احتياج رسمية حديثة بالنطاق ${need}/2، ومؤشرات عرض ${supply}/1`);
      requests.add(levelIdx(x.level) >= levelIdx("city") ? `دراسة ميدانية للنطاق (${GEO_AR[x.level]}) للمصرف «${p}»` : `طلب بيانات رسمي من الجهة المختصة للمصرف «${p}» على مستوى ${GEO_AR[x.level]}`);
    }
    if (usable.some((c) => c.figure.geoLevel !== x.level)) degraded++;
    if (mine.some((c) => c.old)) degraded++;
  }
  for (const c of base.figures) for (const i of c.issues) if (/R4|R1|R2/.test(i)) gaps.push(`${c.figure.indicator}: ${i}`);
  let confidence: StudyOutcome["confidence"] = !sufficientAll ? "low" : degraded === 0 ? "high" : degraded === 1 ? "medium" : "low";
  if (x.rankingStable === false) confidence = confidence === "high" ? "medium" : "low";
  if (confidence === "low") {
    return { ...base, status: "preliminary", confidence, candidates: allowed, excluded, gaps, dataRequests: [...requests], statement: "مؤشرات أولية — لا توصية حاسمة: البيانات غير كافية أو غير مستقرة، والبيانات الناقصة وطريقة الحصول عليها مبينة." };
  }
  return { ...base, status: "recommendation", confidence, candidates: allowed, excluded, gaps, dataRequests: [...requests], statement: "توصية مرجّحة مسببة، بالمعايير والأوزان المعلنة وتحليل الحساسية، تُسلَّم بعد اعتماد المحلل والمراجع الشرعي." };
}
