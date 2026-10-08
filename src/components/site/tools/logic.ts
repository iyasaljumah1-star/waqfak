/**
 * Indicative calculators for the public tools (pure, client-safe).
 * Sources: الدليل الاسترشادي لتصنيف أنواع الوقف؛ نظام الهيئة العامة للأوقاف (م1)؛
 * لائحة تنظيم أعمال النظارة (م1، م8، م9/4، م10/9، م14/1، م15)؛ أحكام الوصية (الثلث وإجازة الورثة).
 */
import { addBusinessDays, daysBetween, isBusinessDay, type ISODate } from "@/server/engines/dates";

// ───────────── 1) waqf type ─────────────
export type Recipients = "public" | "specific" | "both";
export type TypeInput = { recipients: Recipients | ""; qualifier: "yes" | "no" | ""; after: "charity" | "none" | "" };
export type TypeResult = { type: "public" | "private" | "joint"; label: string; reason: string; notes: string[] } | null;

export function classifyWaqf(i: TypeInput): TypeResult {
  const common = "أيًّا كان النوع، يجب تسجيل الوقف وأصوله لدى الهيئة العامة للأوقاف خلال 30 يوم عمل من توثيقه (لائحة تنظيم أعمال النظارة، المادة 8/1).";
  if (i.recipients === "public")
    return {
      type: "public",
      label: "وقف عام (خيري)",
      reason: "الريع مشروط على أوجه بر عامة، معيّنة بالذات أو بالوصف، فالوقف عام. ومثله الوقف على جهة معيّنة تقدم نفعًا عامًا، كمسجد بعينه أو جمعية خيرية.",
      notes: ["اكتب المصرف بوضوح يمنع الاجتهاد في الصرف، وحدد البديل إن تعذر المصرف.", common],
    };
  if (i.recipients === "both")
    return {
      type: "joint",
      label: "وقف مشترك",
      reason: "شرط الواقف يجمع بين جهة بر عامة وأشخاص معيّنين (كالذرية)، فالوقف مشترك.",
      notes: ["حدد نصيب كل جهة بنسبة أو مبلغ، وبيّن ما يحدث إن نقصت الغلة عن الأنصبة.", common],
    };
  if (i.recipients === "specific") {
    if (!i.qualifier) return null;
    if (i.qualifier === "yes")
      return {
        type: "public",
        label: "وقف عام (خيري)",
        reason: "الوقف على معيّنين مقيدًا بوصف خيري، كالفقراء أو المحتاجين من الذرية، يُصنَّف عامًا وفق الدليل الاسترشادي لتصنيف أنواع الوقف؛ لأن مناط الاستحقاق الحاجة لا القرابة وحدها.",
        notes: ["هذه حالة يختلف فيها التصنيف بحسب صياغة الشرط؛ يُستحسن تأكيدها مع مختص قبل التوثيق.", common],
      };
    if (!i.after) return null;
    return {
      type: "private",
      label: "وقف خاص (أهلي أو ذري)",
      reason:
        i.after === "charity"
          ? "الريع مشروط على أشخاص معيّنين بالذات أو بالوصف، فالوقف خاص ما بقي المستحقون، ويصير إلى جهة البر التي حددتها عند انقراضهم."
          : "الريع مشروط على أشخاص معيّنين بالذات أو بالوصف (ذرية أو أقارب أو أشخاص)، فالوقف خاص (أهلي).",
      notes: [
        "بيّن طبقات المستحقين وطريقة القسمة بينهم (للذكر والأنثى، والطبقة العليا والسفلى).",
        ...(i.after === "none" ? ["لم تحدد مآل الوقف عند انقراض المستحقين؛ حدده في الوثيقة حتى لا يبقى محل خلاف."] : []),
        common,
      ],
    };
  }
  return null;
}

// ───────────── 2) size class ─────────────
export type SizeKey = "large" | "medium" | "small" | "direct_benefit";
export const SIZE_NAMES: Record<SizeKey, string> = {
  large: "وقف كبير",
  medium: "وقف متوسط",
  small: "وقف صغير",
  direct_benefit: "وقف ذو انتفاع مباشر",
};
export const SIZE_RULES: { item: string; ref: string; applies: Record<SizeKey, "yes" | "no" | "na" | "cond" | "special"> }[] = [
  { item: "حساب بنكي مستقل باسم الوقف", ref: "م15/1", applies: { large: "yes", medium: "yes", small: "yes", direct_benefit: "yes" } },
  { item: "لوائح داخلية للوقف", ref: "م9/4", applies: { large: "yes", medium: "yes", small: "na", direct_benefit: "na" } },
  { item: "سياسات التحصيل والصرف والاستثمار ومراجعتها دوريًا", ref: "م14/1", applies: { large: "yes", medium: "yes", small: "na", direct_benefit: "na" } },
  { item: "موازنة تقديرية", ref: "م15/4", applies: { large: "yes", medium: "yes", small: "na", direct_benefit: "na" } },
  { item: "قوائم مالية مدققة من مراجع معتمد", ref: "م15/4", applies: { large: "yes", medium: "yes", small: "no", direct_benefit: "no" } },
  { item: "بيان مالي سنوي بالواردات والمصروفات", ref: "م15/5", applies: { large: "no", medium: "no", small: "yes", direct_benefit: "cond" } },
  { item: "اطلاع المستفيدين دوريًا على القوائم المالية", ref: "م10/9", applies: { large: "special", medium: "special", small: "yes", direct_benefit: "yes" } },
];
export const APPLIES_LABEL = { yes: "مطلوب", no: "غير مطلوب", na: "غير منصوص عليه", cond: "مطلوب إن وُجدت واردات ومصروفات", special: "مطلوب بشكل خاص" } as const;

export function sizeClass(totalValue: number | null, directBenefit: boolean): SizeKey | null {
  if (directBenefit) return "direct_benefit";
  if (totalValue === null || !Number.isFinite(totalValue) || totalValue < 0) return null;
  if (totalValue >= 200_000_000) return "large";
  if (totalValue >= 50_000_000) return "medium";
  return "small";
}

/** Parses Arabic/Latin digits with separators: "١٢٠٬٠٠٠٬٠٠٠" → 120000000. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,\s٬_]/g, "").replace(/٫/g, ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ───────────── 3) registration deadline ─────────────
export type DeadlineKind = "register" | "update";
export const DEADLINE_RULES: Record<DeadlineKind, { days: number; label: string; trigger: string; ref: string }> = {
  register: { days: 30, label: "تسجيل الوقف وأصوله لدى الهيئة", trigger: "تاريخ توثيق الوقف لدى الجهة المختصة", ref: "لائحة تنظيم أعمال النظارة، المادة 8/1" },
  update: { days: 15, label: "تحديث بيانات الوقف لدى الهيئة", trigger: "تاريخ التغير الجوهري أو انتهاء شهادة التسجيل", ref: "لائحة تنظيم أعمال النظارة، المادة 8/2" },
};

export function registrationDeadline(trigger: ISODate, kind: DeadlineKind, holidays: { day: string; name: string }[], today: ISODate) {
  const set = new Set(holidays.map((h) => h.day));
  const rule = DEADLINE_RULES[kind];
  const due = addBusinessDays(trigger, rule.days, set);
  // Official holidays inside the window that fell on a working weekday (so they pushed the deadline).
  const skippedHolidays = holidays.filter((h) => h.day > trigger && h.day <= due && isBusinessDay(h.day, new Set()));
  const calendarDays = daysBetween(trigger, due);
  const remaining = daysBetween(today, due);
  let businessLeft = 0;
  for (let d = nextDay(today); remaining > 0 && d <= due; d = nextDay(d)) if (isBusinessDay(d, set)) businessLeft++;
  return { due, rule, calendarDays, remaining, businessLeft, skippedHolidays };
}

function nextDay(iso: ISODate): ISODate {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10);
}

// ───────────── 4) one-third of a will ─────────────
export type ThirdInput = { estate: number; debts: number; expenses: number; waqf: number; other: number; toHeir: boolean };
export function willThird(i: ThirdInput) {
  const net = Math.max(0, i.estate - i.debts - i.expenses);
  const third = net / 3;
  const total = Math.max(0, i.waqf) + Math.max(0, i.other);
  const excess = Math.max(0, total - third);
  const ratio = net > 0 ? total / net : total > 0 ? Infinity : 0;
  const status: "within" | "exceeds" | "no_estate" = net <= 0 ? "no_estate" : total <= third + 0.005 ? "within" : "exceeds";
  return { net, third, total, excess, ratio, status, needsConsent: status === "exceeds" || i.toHeir };
}

// ───────────── 5) nazir readiness ─────────────
export type ReadinessItem = { key: string; text: string; ref: string; weight: 1 | 2 | 3; sizes?: ("large" | "medium" | "small")[]; service?: string };
export const READINESS: ReadinessItem[] = [
  { key: "registered", text: "الوقف وأصوله مسجلة لدى الهيئة، وشهادة التسجيل سارية", ref: "م8/1", weight: 3, service: "T06" },
  { key: "updates", text: "أحدّث بيانات الوقف لدى الهيئة خلال 15 يوم عمل من أي تغير جوهري", ref: "م8/2", weight: 2 },
  { key: "bank", text: "للوقف حساب بنكي مستقل باسمه، ولا تختلط أمواله بأموالي", ref: "م15/1", weight: 3, service: "F09" },
  { key: "condition", text: "أعرف شرط الواقف وأنفذه، ولدي نسخة من صك الوقفية وصك النظارة", ref: "م9", weight: 3, service: "T04" },
  { key: "beneficiaries", text: "لدي سجل محدث بالمستفيدين واستحقاق كل منهم", ref: "م10/3، م10/5", weight: 2, service: "N07" },
  { key: "distribution", text: "أصرف الغلة في مواعيدها وفق الشرط، وأحتفظ بإثبات كل صرف", ref: "م13", weight: 2 },
  { key: "records", text: "أحفظ سجلات الوقف وعملياته المالية عشر سنوات على الأقل", ref: "م20", weight: 2 },
  { key: "bo", text: "لدي سجل بالمستفيد الحقيقي، وأحدّثه عند أي تغيير", ref: "م10/8؛ معايير المستفيد الحقيقي م5–6", weight: 2, service: "G10" },
  { key: "conflict", text: "أفصح عن أي تعارض مصالح، ولا أتعامل مع الوقف لمصلحتي", ref: "م18", weight: 2, service: "G06" },
  { key: "assets", text: "لدي سجل بأصول الوقف وتقييم حديث لها", ref: "م8/1؛ الدليل المختصر", weight: 1, service: "I08" },
  { key: "maintenance", text: "أحافظ على الأصول بصيانة دورية مخطط لها", ref: "م12", weight: 1, service: "I09" },
  { key: "statement", text: "أعد بيانًا ماليًا سنويًا بالواردات والمصروفات", ref: "م15/5", weight: 2, sizes: ["small"], service: "F05" },
  { key: "budget", text: "أعد موازنة تقديرية معتمدة لكل سنة", ref: "م15/4", weight: 2, sizes: ["large", "medium"], service: "F04" },
  { key: "audit", text: "لدي قوائم مالية مدققة من مراجع معتمد", ref: "م15/4", weight: 3, sizes: ["large", "medium"], service: "F06" },
  { key: "policies", text: "للوقف لوائح داخلية وسياسات تحصيل وصرف واستثمار معتمدة", ref: "م9/4، م14", weight: 2, sizes: ["large", "medium"], service: "G01" },
  { key: "disclosure", text: "أُطلع المستفيدين دوريًا على القوائم المالية", ref: "م10/9", weight: 1 },
];

export function readinessScore(size: "large" | "medium" | "small", checked: Set<string>) {
  const items = READINESS.filter((i) => !i.sizes || i.sizes.includes(size));
  const total = items.reduce((n, i) => n + i.weight, 0);
  const got = items.filter((i) => checked.has(i.key)).reduce((n, i) => n + i.weight, 0);
  const score = total ? Math.round((got / total) * 100) : 0;
  const missing = items.filter((i) => !checked.has(i.key)).sort((a, b) => b.weight - a.weight);
  const band = score >= 85 ? { label: "جاهزية عالية", tone: "ok" as const } : score >= 60 ? { label: "يحتاج استكمالًا", tone: "warn" as const } : { label: "فجوات جوهرية", tone: "critical" as const };
  return { items, score, missing, band, criticalMissing: missing.filter((m) => m.weight === 3) };
}
