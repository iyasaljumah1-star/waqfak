/** Public-site vocabulary (client-safe). */

export const AUDIENCES = [
  { key: "waqif", slug: "waqif", label: "الواقف", plural: "الواقفون", serviceKeys: ["waqif"], contentKeys: ["waqif"], faqKeys: ["waqif"] },
  { key: "nazir", slug: "nazir", label: "الناظر ومجلس النظارة", plural: "النظار والمجالس", serviceKeys: ["nazir", "board"], contentKeys: ["nazir", "board"], faqKeys: ["nazir", "board"] },
  { key: "beneficiary", slug: "beneficiary", label: "المستفيد", plural: "المستفيدون", serviceKeys: ["beneficiary"], contentKeys: ["beneficiary"], faqKeys: ["beneficiary"] },
  { key: "entities", slug: "entities", label: "الجهات", plural: "الجهات والمؤسسات", serviceKeys: ["entity"], contentKeys: ["entities"], faqKeys: ["entities"] },
] as const;
export type AudienceSlug = (typeof AUDIENCES)[number]["slug"];

/** Service audience keys (as stored on services.audiences). */
export const SERVICE_AUDIENCE_LABEL: Record<string, string> = {
  waqif: "الواقف", nazir: "الناظر", board: "مجلس النظارة", beneficiary: "المستفيد", entity: "الجهات",
};

/** Content audience keys (as stored on content_items.audience). */
export const CONTENT_AUDIENCE_LABEL: Record<string, string> = {
  waqif: "الواقف", nazir: "الناظر", board: "مجلس النظارة", beneficiary: "المستفيد", entities: "الجهات",
};

export const TOPIC_LABEL: Record<string, string> = {
  establishment: "التأسيس والإنشاء",
  registration: "التوثيق والتسجيل",
  wills: "الوصايا",
  nazara: "النظارة",
  governance: "الحوكمة",
  finance: "المالية والإفصاح",
  investment: "الاستثمار والأصول",
  beneficiaries: "المستفيدون",
  bo: "المستفيد الحقيقي",
  violations: "المخالفات والجزاءات",
  platform: "عن المنصة",
  privacy: "الخصوصية",
};
export const TOPIC_ORDER = Object.keys(TOPIC_LABEL);

export const KIND_LABEL: Record<string, string> = {
  article: "مقالة",
  guide: "دليل",
  regulation: "ملخص نظامي",
  study: "دراسة",
  template: "نموذج",
};
export const KIND_PLURAL: Record<string, string> = {
  article: "مقالات",
  guide: "أدلة",
  regulation: "ملخصات نظامية",
  study: "دراسات",
  template: "نماذج",
};

/** Waqf journey (services.stage 1..5). */
export const JOURNEY = [
  { stage: 1, name: "الفكرة", line: "تحديد الأصل والمصرف ونوع الوقف وشكله، أو كتابة الوصية بالوقف." },
  { stage: 2, name: "التوثيق", line: "صياغة الوثيقة بشروطها، وتوثيقها لدى الجهة المختصة." },
  { stage: 3, name: "التسجيل والبناء", line: "التسجيل لدى الهيئة خلال 30 يوم عمل، وبناء النظام الأساسي والمجلس." },
  { stage: 4, name: "الإدارة", line: "النظارة والصرف والمحاسبة والإفصاح والامتثال بمواعيده." },
  { stage: 5, name: "الاستدامة", line: "سياسة الاستثمار والعائد المستهدف وتنمية الأصول." },
] as const;

export const PRICING_LABEL: Record<string, string> = {
  free: "مجانية",
  fixed: "سعر محدد للخدمة",
  subscription: "اشتراك دوري",
  hourly: "بالساعة",
  percentage: "نسبة من الغلة أو الأصول",
  quote: "عرض سعر بعد دراسة الحالة",
};

const nf = new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 });

/** Price line for a service. Null price → quote after study. */
export function priceText(pricingModel: string, basePrice: string | null): string {
  if (pricingModel === "free") return "مجانًا";
  if (basePrice === null || basePrice === undefined || basePrice === "") return "عرض سعر بعد الدراسة";
  const v = `${nf.format(Number(basePrice))} ر.س`;
  if (pricingModel === "hourly") return `${v} للساعة`;
  if (pricingModel === "subscription") return `${v} سنويًا`;
  if (pricingModel === "percentage") return `${nf.format(Number(basePrice))}٪`;
  return `يبدأ من ${v}`;
}

export const CONFLICT_LABEL: Record<string, string | null> = {
  none: null,
  blocked_if_waqfak_nazir: "حرصًا على استقلالية التقييم، تُقدَّم هذه الخدمة للأوقاف التي لا تتولى وقفك نظارتها.",
  blocked_if_waqfak_controls_finance: "حرصًا على الاستقلالية، تُقدَّم هذه الخدمة للأوقاف التي لا تتولى وقفك نظارتها أو إدارتها المالية أو مسك دفاترها.",
  inside_nazara_only: "تُقدَّم وفق ضوابط الاستقلالية، فلا يجتمع لدينا مسك دفاتر الوقف ومراجعتها.",
};

/**
 * Display copy for a service that cannot be ordered yet. Wording only: whether a
 * service is orderable is decided server-side (`availability.available`).
 */
export function availabilityCopy(s: { isActive: boolean; requiresLicenseKey: string | null; availability: { available: boolean } }) {
  if (s.availability.available) return null;
  if (s.isActive && s.requiresLicenseKey)
    return {
      gated: true,
      label: "تُتاح بعد اعتماد الترخيص",
      reason:
        s.requiresLicenseKey === "gaa_nazara_license"
          ? "تُتاح هذه الخدمة بعد اعتماد ترخيص الهيئة العامة للأوقاف للناظر الاعتباري. سجّل اهتمامك، ونبلغك عند إتاحتها."
          : "تُتاح هذه الخدمة بعد اعتماد الترخيص النظامي الخاص بها. سجّل اهتمامك، ونبلغك عند إتاحتها.",
    };
  return { gated: false, label: "غير متاحة حاليًا", reason: "توقف استقبال طلبات هذه الخدمة مؤقتًا. تواصل معنا لنقترح عليك البديل المناسب." };
}

export const DEPARTMENT_LABEL: Record<string, string> = {
  sharia: "الفريق الشرعي",
  legal: "الفريق القانوني",
  finance: "الفريق المالي",
  investment: "فريق الاستثمار",
  governance: "فريق الحوكمة",
  operations: "فريق العمليات",
};

export const AUDIENCE_LINKS = [
  { href: "/for/waqif", label: "الواقف", hint: "من يريد أن يقف مالًا أو يوصي بوقف" },
  { href: "/for/nazir", label: "الناظر والمجلس", hint: "من يدير وقفًا قائمًا ويتحمّل مسؤوليته" },
  { href: "/for/beneficiary", label: "المستفيد", hint: "من له حق في غلة وقف" },
  { href: "/for/entities", label: "الجهات", hint: "الجمعيات والمؤسسات والشركات الوقفية" },
];

export const LEGAL_PAGES = [
  { key: "terms", label: "الشروط والأحكام" },
  { key: "privacy", label: "سياسة الخصوصية" },
  { key: "cookies", label: "ملفات تعريف الارتباط" },
  { key: "ai", label: "استخدام الذكاء الاصطناعي" },
  { key: "accessibility", label: "إمكانية الوصول" },
  { key: "disclaimer", label: "إخلاء المسؤولية" },
] as const;
