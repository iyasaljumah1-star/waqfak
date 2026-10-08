/**
 * Keyword-pattern intent classifier (pure; unit-tested). Waqf-context intents are answered from the user's own
 * data (RLS-scoped); everything else falls back to retrieval over the published knowledge base.
 */
import { normalizeArabic } from "./text";

export type Intent = "obligations" | "assessment" | "documents_missing" | "requests" | "greeting" | "help" | "knowledge";

/** Letter-level normalization of a pattern source (same folding as normalizeArabic, regex syntax untouched). */
const fold = (src: string) => src.replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه");
const re = (src: string) => new RegExp(fold(src).replace(/</g, "(?<![\\p{L}\\p{N}])").replace(/>/g, "(?![\\p{L}\\p{N}])"), "u");
const MY = "(وقفي|وقفنا|الوقف\\s+هذا|هذا\\s+الوقف|عندي|عندنا|لدي|لدينا|علي|علينا|لي|لنا|الخاصه\\s+بي|الخاصه\\s+بنا)";

const RULES: { intent: Intent; patterns: RegExp[] }[] = [
  {
    intent: "greeting",
    patterns: [re("^(السلام\\s+عليكم|مرحبا|اهلا|هلا|صباح\\s+الخير|مساء\\s+الخير|hi|hello)(\\s+.{0,15})?$")],
  },
  {
    intent: "help",
    patterns: [re("^(ماذا|وش|ايش|ما)\\s+(تستطيع|تقدر|يمكنك)\\s+(ان\\s+)?(تفعل|تسوي|تساعدني)"), re("^(مساعده|help)$")],
  },
  {
    intent: "obligations",
    patterns: [
      re("<(الالتزامات|التزاماتي|التزاماتنا|التزامات|الالتزام|المواعيد|مواعيدي|المهل|الاستحقاقات)>.{0,30}<(القادمه|القريبه|المقبله|المتاخره|المستحقه|القادم|الجايه|المتبقيه)>"),
      re("<(ما|وش|ايش|اعرض|ماهي|ما\\s+هي)>\\s+(الالتزامات|التزاماتي|التزاماتنا|المواعيد\\s+النظاميه|مواعيدي)>"),
      re("<(متي|ما)>\\s+(موعد|اخر\\s+موعد|مهله)>.{0,40}<(رفع|تقديم|تحديث|تسجيل|اعتماد)>.{0,30}" + MY),
      re("<(هل\\s+)?(علي|علينا|عندي|عندنا|لدينا)>\\s+(التزام|التزامات|مخالفات|متاخرات|شيء\\s+متاخر)>"),
      re("<(المتاخر|المتاخره|المتاخرات)>.{0,20}" + MY),
    ],
  },
  {
    intent: "assessment",
    patterns: [
      re("<(نتيجه|نتايج|درجه|تقرير|ملخص)>\\s+(اخر\\s+)?(التقييم|تقييم|تقييمي|تقييمنا|التشخيص)>"),
      re("<(اشرح|فسر|لخص|وضح)>\\s+(لي\\s+)?(نتيجه\\s+)?(التقييم|تقييمي|تقييم\\s+الوقف|نتيجتي)>"),
      re("<(كم|ما)>\\s+(درجه|درجتي|درجتنا|مستوي\\s+نضج)>"),
      re("<(توصيات|التوصيات)>\\s+(التقييم|تقييمي|الوقف)>"),
    ],
  },
  {
    intent: "documents_missing",
    patterns: [
      re("<(المستندات|الوثايق|المستند|الوثيقه|الاوراق|الملفات)>\\s+(الناقصه|الناقص|المطلوبه|المفقوده|المنتهيه|الناقصه\\s+عندي)>"),
      re("<(ما|ماذا|وش|ايش)>\\s+(ينقصني|ينقصنا|ينقص|الناقص)>.{0,25}<(مستندات|وثايق|اوراق|المستندات|الوثايق)>"),
      re("<(هل)>\\s+(وثايقي|مستنداتي|وثايقنا|مستنداتنا)\\s+(مكتمله|كامله)>"),
      re("<(قايمه|قائمه)>\\s+(المستندات|الوثايق)\\s+(المطلوبه|الالزاميه)>"),
    ],
  },
  {
    intent: "requests",
    patterns: [
      re("<(حاله|وضع|اين\\s+وصل|وين\\s+وصل|متابعه)>\\s+(طلبي|طلباتي|طلبنا|طلباتنا|الطلب|الطلبات)>"),
      re("<(طلباتي|طلباتنا)>"),
      re("<(ما|وش|ايش)>\\s+(حاله|اخبار)\\s+(طلب|الطلب)>"),
    ],
  },
];

export function classifyIntent(question: string): Intent {
  const q = normalizeArabic(question).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  for (const r of RULES) if (r.patterns.some((p) => p.test(q))) return r.intent;
  return "knowledge";
}

/** Suggested starter questions shown in the UI (each maps to a deterministic answer path). */
export const SUGGESTED_QUESTIONS = [
  "ما الالتزامات القادمة على وقفي؟",
  "ما نتيجة آخر تقييم؟",
  "ما المستندات الناقصة؟",
  "ما حالة طلباتي؟",
  "ما مهمات ناظر الوقف؟",
  "متى يجب تحديث سجل المستفيد الحقيقي؟",
] as const;
