/**
 * Citations behind drafted clauses and checks (PURE). Each one names a reference of the registry
 * (regulatory_references.code), the place in it (page, question or principle — read from the project files), and what
 * it is cited for. Nothing is quoted or numbered that the file does not contain; the specialist records whether the
 * source supports the wording (output_reviews).
 */

export type Citation = { key: string; refCode: string; location: string; topic: string; page?: number };

export const CITATIONS: Record<string, Citation> = {
  draft1: { key: "draft1", refCode: "DRAFTING-GUIDE", location: "المبدأ الأول", topic: "بنود وثيقة الوقف" },
  draft2: { key: "draft2", refCode: "DRAFTING-GUIDE", location: "المبدأ الثاني (ص7)", page: 7, topic: "بيان حال الوصايا السابقة، والأفضل وصية واحدة، والنص على تاريخ المعدّلة أو إلغاء ما سبقها" },
  draft11: { key: "draft11", refCode: "DRAFTING-GUIDE", location: "المبادئ 11–14", topic: "وصف الأصل وملكيته وما يلحق به والمشاع" },
  draft26: { key: "draft26", refCode: "DRAFTING-GUIDE", location: "المبدآن 26–27", topic: "انتفاع الواقف، والتسوية بين المستحقين" },
  q16: { key: "q16", refCode: "Q100", location: "س16 (ص10)", page: 10, topic: "الوقف المعلق على الموت يأخذ حكم الوصية: يجوز الرجوع عنه قبل الموت، ولا يلزم إلا في حدود ثلث التركة إلا بإجازة الورثة" },
  q75: { key: "q75", refCode: "Q100", location: "س75 (ص30)", page: 30, topic: "الوقف في المرض المخوف يخضع لأحكام الوصية: ينفذ في الثلث، وما زاد بإجازة الورثة" },
  q77: { key: "q77", refCode: "Q100", location: "س77 البند 3 (ص30)", page: 30, topic: "الوقف المعلق بالموت الزائد على ثلث التركة لا ينفذ فيما زاد إذا لم يجزه الورثة" },
  q28: { key: "q28", refCode: "Q100", location: "س28", topic: "وقف المرهون" },
  q76: { key: "q76", refCode: "Q100", location: "س76 (ص30)", page: 30, topic: "تعديل شروط الوقف بعد انعقاده بالرجوع إلى المحكمة المختصة" },
  waqifsDoc: { key: "waqifsDoc", refCode: "WAQIF-GUIDE", location: "التوثيق لدى الجهة القضائية المختصة، إضاءة معرفية 02 (ص40)", page: 40, topic: "لا يشترط الشهود لإثبات الوقف أو الوصية بالوقف لدى الجهة المختصة، ويلزم الإشهاد على وقف أو وصية بوقف لم يوثق" },
  waqifsNajiz: { key: "waqifsNajiz", refCode: "WAQIF-GUIDE", location: "التوثيق عبر بوابة ناجز (ص40)", page: 40, topic: "طلب التوثيق إلكترونيًا عبر ناجز أصالة أو وكالة" },
  waqifsDeed: { key: "waqifsDeed", refCode: "WAQIF-GUIDE", location: "التوثيق الداخلي: صياغة صك الوقفية (ص38)", page: 38, topic: "محتوى صيغة الوقف: المصارف، والنظارة واستخلافها، والتوثيق والإشهاد" },
  nazara: { key: "nazara", refCode: "NAZARA-REG", location: "واجبات الناظر", topic: "واجبات الناظر" },
};

/** Old free-text reference labels (stored in earlier versions) → citation keys. */
const LEGACY: Record<string, string> = {
  "الدليل الإرشادي لصياغة وثيقة الوقف — المبدأ الأول (بنود الوثيقة)": "draft1",
  "الدليل الإرشادي لصياغة وثيقة الوقف — المبدأ الثاني (حال الوصايا السابقة)": "draft2",
  "الدليل الإرشادي لصياغة وثيقة الوقف — المبادئ 11–14 (وصف الأصل وملكيته وما يلحق به والمشاع)": "draft11",
  "الدليل الإرشادي لصياغة وثيقة الوقف — المبدآن 26–27 (انتفاع الواقف، والتسوية بين المستحقين)": "draft26",
  "100 سؤال وجواب — س16 وس75 وس77 (الوقف المعلق على الموت وحد الثلث)": "q16",
  "100 سؤال وجواب — س28 (وقف المرهون)": "q28",
  "100 سؤال وجواب — س76 (تعديل الشروط بعد الانعقاد)": "q76",
  "الدليل الإرشادي للواقفين (توثيق الوصية والإشهاد، وصياغة صك الوقفية)": "waqifsDoc",
  "لائحة تنظيم أعمال النظارة (واجبات الناظر)": "nazara",
};

/** A clause's reference → its citation (a key, or a legacy label). Unknown text stays as is, marked unverified. */
export function citationOf(ref: string): Citation | null {
  return CITATIONS[ref] ?? CITATIONS[LEGACY[ref] ?? ""] ?? null;
}

/** Display line: «source — location». */
export function citationLabel(c: Citation, refName?: string) {
  return `${refName ?? c.refCode} — ${c.location}`;
}

export type CitationReviewStatus = "supports" | "needs_more" | "unavailable" | "unverified";
export const CITATION_REVIEW_AR: Record<CitationReviewStatus, string> = {
  supports: "يؤيد الصياغة",
  needs_more: "يحتاج مصدرًا إضافيًا",
  unavailable: "المصدر غير متاح",
  unverified: "لم يُتحقق منه",
};
export const BINDING_AR: Record<string, string> = { binding: "مرجع رسمي ملزم", guidance: "إرشادي", reference: "مرجعي", draft: "مشروع غير نافذ", internal: "ملف داخلي" };
