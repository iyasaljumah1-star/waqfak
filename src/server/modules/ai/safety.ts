/**
 * Safety layer for the assistant (pure; unit-tested).
 * - refusal classifier: fatwa / sharia rulings, binding legal opinions, final heir-share calculations,
 *   regulatory evasion, and attempts to override the assistant's instructions;
 * - PII minimization used before logging and before anything leaves the platform.
 */
import { normalizeArabic } from "./text";

export type RefusalCategory = "fatwa" | "legal_opinion" | "inheritance" | "evasion" | "injection";

export type Refusal = {
  category: RefusalCategory;
  title: string;
  message: string;
  /** Consultation service the user is routed to (codes from seed/data/services.ts). */
  serviceCode: string | null;
  serviceLabel: string | null;
};

// Patterns are written in normalized form (see normalizeArabic): ا for أ/إ/آ, ي for ى/ئ, ه for ة, و for ؤ.
// «<» / «>» mark word edges (Arabic letters are not \w, so \b cannot be used).
/** Letter-level normalization of a pattern source (same folding as normalizeArabic, regex syntax untouched). */
const fold = (src: string) => src.replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه");
const re = (src: string) => new RegExp(fold(src).replace(/</g, "(?<![\\p{L}\\p{N}])").replace(/>/g, "(?![\\p{L}\\p{N}])"), "u");
const INTENT = "<(كيف|طريقه|طرق|وسيله|ابي|ابغي|اريد|نريد|ودي|ساعدني|علمني|اقدر|نقدر|ممكن|افضل\\s+طريقه)>";
const EVADE = "(اتهرب|نتهرب|التهرب|تهرب|احتال|نحتال|التحايل|اتحايل|نتحايل|تحايل|اخفي|نخفي|اخفاء|ازور|نزور|تزوير|اتلاعب|نتلاعب|التلاعب|اتجاوز|نتجاوز|اتفادي|نتفادي|اتجنب|نتجنب)";

const RULES: { category: RefusalCategory; patterns: RegExp[] }[] = [
  {
    category: "injection",
    patterns: [
      re("<(تجاهل|انس|اهمل)>\\s+(كل\\s+|جميع\\s+)?(التعليمات|الاوامر|القواعد|ما\\s+سبق)"),
      re("<(اكشف|اعرض|اطبع)>\\s+(لي\\s+)?(تعليماتك|التعليمات\\s+المخفيه|موجه\\s+النظام)"),
      /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+(instructions|prompts?)/,
      /(system|developer)\s+prompt/,
      re("<(انت\\s+الان|من\\s+الان\\s+انت)>\\s+(مفتي|محامي|نموذج\\s+بلا\\s+قيود)"),
      /jailbreak|\bdan\s+mode\b/,
    ],
  },
  {
    category: "evasion",
    patterns: [
      re(`${INTENT}.{0,30}<${EVADE}>`),
      re("<(دون|بدون|من\\s+غير)>\\s+(علم|ان\\s+تعلم|ان\\s+تكتشف|ما\\s+تدري|ما\\s+تعرف)\\s+(الهيئه|الجهات|الجهه|المراجع|الزكاه)"),
      re("<(حتي\\s+)?(لا|ما)>\\s+(تكتشف|يكتشف|تكشف|يكشف|تعرف|يعرف)\\s+(الهيئه|المخالفه|الجهات|المراجع|المستفيدون|المستفيدين)"),
      re("<(احول|نحول|انقل|ننقل|اسحب|نسحب)>.{0,25}(اموال|ريع|غله|عوايد)\\s+الوقف.{0,25}(حسابي\\s+الشخصي|باسمي|لحسابي)"),
      re("<(ثغره|ثغرات)>\\s+(في\\s+)?(النظام|اللايحه|الانظمه|الهيئه)"),
    ],
  },
  {
    category: "inheritance",
    patterns: [
      re("<(احسب|حساب|قسمه|اقسم|توزيع|وزع)>\\s+(لي\\s+)?(الميراث|التركه|الورث|المواريث|انصبه\\s+الورثه)>"),
      re("<كم>\\s+(يرث|ترث|ارث|نرث|يورث)>"),
      re("<(نصيب|حصه|انصبه|حصص)>\\s+(كل\\s+)?(الورثه|وارث|الزوجه|الزوج|الابن|البنت|الام|الاب|الاخ|الاخت|الابناء|البنات|الاولاد)>"),
      re("<(نصيب|حصه|انصبه)>.{0,25}<من\\s+(الميراث|التركه|الورث)>"),
      re("<(علم\\s+الفرايض|مساله\\s+فرضيه)>"),
    ],
  },
  {
    category: "fatwa",
    patterns: [
      re("<(فتوي|فتاوي|افتني|افتوني|تفتيني|استفتاء|استفتي)>"),
      re("<(ما|وش|ايش)>\\s+(هو\\s+)?(حكم|الحكم\\s+الشرعي)>"),
      re("<(الحكم\\s+الشرعي|حكم\\s+الشرع|الحكم\\s+في)>"),
      re("<(يجوز|يجوزلي|لا\\s+يجوز|يحرم)>"),
      re("<(حلال|حرام|مكروه)>\\s*(ام|او|ولا)?"),
      re("<(يصح|يبطل|باطل)>\\s+(الوقف|وقفي|وقف)>\\s*(شرعا)?"),
      re("<شرعا>\\s*[؟?]?$"),
    ],
  },
  {
    category: "legal_opinion",
    patterns: [
      re("<(رايك|راي)>\\s+(القانوني|النظامي|الملزم)>"),
      re("<(راي\\s+قانوني|راي\\s+نظامي|فتوي\\s+قانونيه|استشاره\\s+قانونيه\\s+ملزمه)>"),
      re("<(هل|ما)>\\s+(موقفي|موقفنا)\\s+(القانوني|النظامي)>"),
      re("<(اكسب|اربح|نكسب|نربح|سنكسب|سنربح|ساكسب|سيكسب|نخسر|اخسر)>\\s+(القضيه|الدعوي|الدعوه)>"),
      re("<(العقد|الوكاله|الوثيقه|الصك)>\\s+(هذا\\s+|هذه\\s+)?(صحيح|صحيحه|باطل|باطله|نافذ|نافذه)\\s+(نظاما|قانونا)>"),
      re("<(يحق\\s+لي|استطيع|اقدر)>\\s+(مقاضاه|رفع\\s+دعوي|اقامه\\s+دعوي)>"),
      re("<(اكتب|صغ)>\\s+(لي\\s+)?(مذكره\\s+دفاع|لايحه\\s+اعتراضيه|صحيفه\\s+دعوي)>"),
      re("<(هل\\s+انا|هل\\s+نحن)>\\s+(ملزم|ملزمون|مسوول|مسوولون)\\s+(قانونا|نظاما|شخصيا)>"),
    ],
  },
];

const MESSAGES: Record<RefusalCategory, Omit<Refusal, "category">> = {
  fatwa: {
    title: "هذا سؤال يحتاج فتوى أو حكمًا شرعيًا",
    message:
      "لا يصدر المساعد الآلي فتاوى ولا أحكامًا شرعية، لأن الحكم يختلف باختلاف تفاصيل الحالة ونص الوثيقة. اطلب استشارة شرعية ليصدر لك رأي موقّع باسم المستشار وصفته.",
    serviceCode: "C07",
    serviceLabel: "اطلب استشارة شرعية",
  },
  legal_opinion: {
    title: "هذا سؤال يحتاج رأيًا قانونيًا ملزمًا",
    message:
      "لا يقدم المساعد الآلي رأيًا قانونيًا ملزمًا ولا يقيّم فرص قضية أو صحة عقد بعينه. اطلب استشارة قانونية ليراجع مستشار مرخص مستنداتك ويصدر رأيًا موقّعًا.",
    serviceCode: "C08",
    serviceLabel: "اطلب استشارة قانونية",
  },
  inheritance: {
    title: "حساب أنصبة الورثة يحتاج مختصًا",
    message:
      "لا يحسب المساعد أنصبة الورثة حسابًا نهائيًا، لأن القسمة تتوقف على حصر الورثة وصك حصر الإرث والوصايا والديون. اطلب استشارة شرعية، والقسمة النهائية تثبت بصك من الجهة المختصة.",
    serviceCode: "C07",
    serviceLabel: "اطلب استشارة شرعية",
  },
  evasion: {
    title: "لا نساعد على تجاوز الأنظمة",
    message:
      "لا يقدم المساعد طرقًا للتهرب من الالتزامات النظامية أو إخفاء معلومات عن الهيئة أو المستفيدين. إن كان لديك تأخر أو مخالفة فالأسلم معالجتها نظاميًا، ويستطيع مستشار قانوني مساعدتك في خطة تصحيح.",
    serviceCode: "C04",
    serviceLabel: "اطلب خطة تصحيح المخالفات",
  },
  injection: {
    title: "لا يمكن تغيير تعليمات المساعد",
    message: "تعليمات المساعد ثابتة ولا تتغير من داخل المحادثة. اكتب سؤالك عن الوقف أو الأنظمة وسأجيبك من المصادر المتاحة.",
    serviceCode: null,
    serviceLabel: null,
  },
};

/** Returns a refusal when the question must be routed to a human specialist; null otherwise. */
export function classifyRefusal(question: string): Refusal | null {
  const q = normalizeArabic(question).replace(/[^\p{L}\p{N}\s?؟-]/gu, " ").replace(/\s+/g, " ").trim();
  for (const r of RULES) {
    if (r.patterns.some((p) => p.test(q))) return { category: r.category, ...MESSAGES[r.category] };
  }
  return null;
}

// ───────────── PII minimization ─────────────

/**
 * Masks personal identifiers before text is logged or sent to an external provider:
 * Saudi IBANs, national/iqama IDs (10 digits starting 1/2), mobile numbers, e-mails, card-like numbers,
 * and any other long digit run. Arabic-Indic digits are handled.
 */
export function maskPII(text: string): string {
  const ascii = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  return ascii
    .replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{2,4}){3,8}\b/gi, "[IBAN]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[بريد]")
    .replace(/(?<!\d)(?:\+?966[ -]?|00966[ -]?|0)?5\d(?:[ -]?\d){7}(?!\d)/g, "[جوال]")
    .replace(/(?<!\d)[12]\d{9}(?!\d)/g, "[هوية]")
    .replace(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, "[رقم]")
    .replace(/(?<!\d)\d{8,}(?!\d)/g, "[رقم]");
}
