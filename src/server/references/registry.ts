/**
 * The reference registry: one record per instrument, every fact tied to the official page it was read from.
 * Retrieval date of all evidence below: 2026-11-06 (relay scrape of the official host unless stated otherwise).
 *
 * Rules enforced by validateRegistry():
 *  - a fact is either evidenced or unknown with a reason; nothing is inferred silently;
 *  - binding instruments cite an official host for their text, publication and status;
 *  - computed values (date conversions, «90 days after publication») are flagged as computed;
 *  - «candidateServices» is a working hypothesis taken from the 2026-11-04 review, never an approved link.
 */
import { addDays, hijriToGregorian, parseHijri } from "./dates";
import { OFFICIAL_HOSTS, type BindingLevel, type Evidence, type Fact, type FetchAttempt, type RefKind, type RefStatus } from "./types";

export type Relation = { refId: string; from: string | null; evidence: Evidence[]; note?: string };

export type RegistryEntry = {
  id: string;
  officialName: string;
  kind: RefKind;
  binding: BindingLevel;
  issuer: Fact<string>;
  /** Number and date of the instrument that issued or approved the text. */
  instrument: Fact<{ number: string; dateHijri: string }>;
  publication: Fact<{ dateHijri: string | null; dateGregorian: string; url: string }>;
  /** «rule» is the text's own effectiveness clause, quoted. «from» is ISO; «computed» when derived (conversion, offset). */
  effective: Fact<{ rule: string; from: string | null; computed: boolean }>;
  /** Status recorded at the last check. Use statusAt() for any other date. */
  status: Fact<RefStatus>;
  amendedBy: Relation[];
  repealedBy: Relation[];
  repeals: string[];
  officialSources: { url: string; role: "text" | "decision" | "listing" | "amendment" | "file"; note?: string }[];
  /** Snapshot ids in data/references/manifest.json holding the verified source copy. */
  snapshots: string[];
  /** Knowledge-base copies to compare (paths under data/references/kb-candidates). */
  kbCandidates: { label: string; path: string; origin: string }[];
  candidateServices: { codes: string[]; basis: string };
  /** Structured extractions of the instrument (e.g. a table), under data/references/structured. */
  structuredData?: { path: string; sourceSha256: string; note: string }[];
  retrieval: FetchAttempt[];
  lastVerifiedAt: string | null;
  openQuestions: string[];
};

const AT = "2026-11-06T00:00:00Z";
const UQN = (p: string) => `https://www.uqn.gov.sa/details?p=${p}`;
const UQN_DR = (id: string) => `https://www.uqn.gov.sa/decisions-and-regulations/${id}`;
const ev = (url: string, quote: string): Evidence => ({ url, quote, retrievedAt: AT });
const relay = (refId: string, url: string): FetchAttempt => ({ refId, url, at: AT, ok: true, via: "relay_scrape" });
const failed = (refId: string, url: string, kind: NonNullable<FetchAttempt["failure"]>["kind"], detail: string): FetchAttempt => ({ refId, url, at: AT, ok: false, via: "relay_scrape", failure: { kind, detail } });
const unknown = (reason: string) => ({ value: null, unknownReason: reason }) as const;
const HYPOTHESIS = "فرضية عمل من مراجعة 2026-11-04 (مصفوفة الخدمات)؛ ليست ربطًا معتمدًا ولا تُستخدم في الحجب أو الاستشهاد";
const greg = (h: string) => {
  const p = parseHijri(h);
  return p ? hijriToGregorian(p) : null;
};

const AT2 = "2026-11-06T12:00:00Z";
const search = (refId: string, url: string, detail: string): FetchAttempt => ({ refId, url, at: AT2, ok: false, via: "relay_scrape", failure: { kind: "no_official_publication", detail } });
const BO_URL = "https://digitalcms.awqaf.gov.sa/sites/default/files/2025-12/%D9%85%D8%B9%D8%A7%D9%8A%D9%8A%D8%B1%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%81%D9%8A%D8%AF%20%D8%A7%D9%84%D8%AD%D9%82%D9%8A%D9%82%D9%8A%20--%20%D8%A7%D9%84%D9%86%D8%B3%D8%AE%D8%A9%20%D8%A7%D9%84%D9%85%D9%8F%D8%B9%D8%AA%D9%85%D8%AF%D8%A9.pdf";
const NZR_SERVICES = "C01 C02 C03 C04 C06 C11 F01 F02 F03 F04 F05 F06 F07 F09 G01 G02 G05 G06 G07 I01 I04 I08 I09 N01 N03 N04 N06 N07 N08 T03 T04 T06 W05".split(" ");

export const REGISTRY: RegistryEntry[] = [
  {
    id: "NZR",
    officialName: "لائحة تنظيم أعمال النظارة",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "مجلس إدارة الهيئة العامة للأوقاف", evidence: [ev(UQN("18936"), "قرار مجلس إدارة الهيئة العامة للأوقاف رقم (31 /1 /18 /43) وتاريخ 30 /05/ 1443هـ")], note: "بناءً على قرار مجلس الوزراء رقم 286 وتاريخ 21 /5/ 1442هـ (من نص القرار نفسه)" },
    instrument: { value: { number: "31/1/18/43", dateHijri: "1443/05/30" }, evidence: [ev(UQN("18936"), "قرار مجلس إدارة الهيئة العامة للأوقاف رقم (31 /1 /18 /43) وتاريخ 30 /05/ 1443هـ")] },
    publication: { value: { dateHijri: "1443/07/03", dateGregorian: "2022-02-04", url: UQN("18926") }, evidence: [ev(UQN("18926"), "1443-7-03 الموافق 04-02-2022")] },
    effective: { value: { rule: "تسري أحكام هذه اللائحة من تاريخ نشرها في الجريدة الرسمية. (المادة الثانية والثلاثون)", from: "2022-02-04", computed: false }, evidence: [ev(UQN("18926"), "المادة الثانية والثلاثون: النفاذ — تسري أحكام هذه اللائحة من تاريخ نشرها في الجريدة الرسمية.")] },
    status: { value: "in_force", evidence: [ev(UQN("18926"), "النص منشور دون إشارة إلى تعديل أو إلغاء"), ev("https://awqaf.gov.sa/ar/rules-and-regulations", "مدرجة ضمن «الأنظمة واللوائح» (ملف 2026-04)")], note: "لم يُعثر على قرار تعديل أو إلغاء منشور. المادة الثلاثون: «يجري تعديل اللائحة بالطريقة التي صدرت بها»." },
    amendedBy: [],
    repealedBy: [],
    repeals: [],
    officialSources: [
      { url: UQN("18926"), role: "text" },
      { url: UQN("18936"), role: "decision" },
      { url: "https://digitalcms.awqaf.gov.sa/sites/default/files/2026-04/%D8%AA%D9%86%D8%B8%D9%8A%D9%85%20%D8%A3%D8%B9%D9%85%D8%A7%D9%84%20%D8%A7%D9%84%D9%86%D8%B8%D8%A7%D8%B1%D8%A9.pdf", role: "file", note: "نسخة الهيئة (2026-04)؛ لم تُطابق في هذه المرحلة" },
    ],
    snapshots: ["NZR/uqn-p18926", "NZR/uqn-p18936"],
    kbCandidates: [
      { label: "قاعدة المعرفة (فرع engine-core: data/kb/nazara-reg)", path: "NZR/engine-core-nazara-reg.txt", origin: "مستخرج من ملف المشروع «تنظيم أعمال النظارة.pdf»" },
      { label: "النص المصحح (البوابة الميسرة، مصدر ثانوي)", path: "NZR/arbiter-sec05.txt", origin: "law.arbiter.sa كما حُفظ في مراجعة 2026-11-04" },
    ],
    candidateServices: { codes: NZR_SERVICES, basis: HYPOTHESIS },
    retrieval: [relay("NZR", UQN("18926")), relay("NZR", UQN("18936"))],
    lastVerifiedAt: AT,
    openQuestions: ["جدول المخالفات يذكر رقم قرار اللائحة (32/1/18/43)، والجريدة تثبت (31/1/18/43): خطأ في الجدول.", "نسخ الهيئة اللاحقة (2025-07 و2026-04) لم تُطابق بالجريدة لكشف أي تعديل غير منشور.", "المادة الحادية والثلاثون تمنح المخاطبين مهلة (سنة) من سريان اللائحة لتسوية أوضاعهم، وصفحة الأسئلة الشائعة للهيئة تذكر أن أحكامها «نافذة وملزمة بشكل كامل اعتبارًا من تاريخ 03/07/1444هـ (الموافق 25/01/2023م)». تاريخ السريان المسجل (2022-02-04) لا يتغير؛ أثر المهلة على وقائع السنة الأولى يحتاج مراجعة بشرية."],
  },
  {
    id: "PRD",
    officialName: "لائحة المنتجات الاستثمارية الوقفية",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "مجلس إدارة الهيئة العامة للأوقاف", evidence: [ev(UQN_DR("4001176"), "المعتمدة بقرار مجلس الإدارة رقم (21/1/47/ت) بتاريخ 26/11/1447هـ")] },
    instrument: { value: { number: "21/1/47/ت", dateHijri: "1447/11/26" }, evidence: [ev(UQN_DR("4001176"), "المعتمدة بقرار مجلس الإدارة رقم (21/1/47/ت) بتاريخ 26/11/1447هـ")] },
    publication: { value: { dateHijri: "1447/12/26", dateGregorian: "2026-06-12", url: UQN_DR("4001176") }, evidence: [ev(UQN_DR("4001176"), "1447-12-26 الموافق 12-06-2026")] },
    effective: {
      value: { rule: "تُنشر اللائحة في الجريدة الرسمية، ويُعمل بها بعد مضي (90) يومًا من تاريخ نشرها. (المادة السابعة والثلاثون)", from: addDays("2026-06-12", 90), computed: true },
      evidence: [ev(UQN_DR("4001176"), "المادة السابعة والثلاثون: النشر والنفاذ — ويُعمل بها بعد مضي (90) يومًا من تاريخ نشرها.")],
      note: "التاريخ محسوب: 2026-06-12 + 90 يومًا = 2026-09-10. لم يرد في المصدر تاريخ ميلادي صريح للنفاذ؛ اليوم الأول للعمل (10 أو 11 سبتمبر) بحسب طريقة احتساب المدة يحتاج تأكيدًا بشريًا. الحالة في 2026-11-06 لا تتأثر بهذا الفرق.",
    },
    status: { value: "in_force", evidence: [ev(UQN_DR("4001176"), "منشورة في 2026-06-12 ونافذة بعد 90 يومًا")], note: "سارية في تاريخ الفحص بناءً على تاريخ النفاذ المحسوب." },
    amendedBy: [],
    repealedBy: [],
    repeals: ["PRT", "FND"],
    officialSources: [{ url: UQN_DR("4001176"), role: "text" }, { url: "https://digitalcms.awqaf.gov.sa/sites/default/files/2026-06/List%20of%20Waqf%20Investment%20Products_1.pdf", role: "file", note: "نسخة الهيئة؛ لم تُطابق في هذه المرحلة" }],
    snapshots: ["PRD/uqn-4001176"],
    kbCandidates: [{ label: "النص المصحح (البوابة الميسرة، مصدر ثانوي)", path: "PRD/arbiter-sec09.txt", origin: "law.arbiter.sa كما حُفظ في مراجعة 2026-11-04" }],
    candidateServices: { codes: ["I05", "I06", "T07"], basis: HYPOTHESIS },
    retrieval: [relay("PRD", UQN_DR("4001176"))],
    lastVerifiedAt: AT,
    openQuestions: ["المادة السادسة والثلاثون: المنتجات القائمة عند النفاذ تعدّل أوضاعها خلال (12) شهرًا من تاريخ النفاذ (محسوبة حتى 2027-09-10 تقريبًا)."],
  },
  {
    id: "PRT",
    officialName: "لائحة إنشاء المحافظ الاستثمارية الوقفية",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "رئيس مجلس إدارة الهيئة العامة للأوقاف", evidence: [ev(UQN("20893"), "الصادرة بموجب قرار رئيس مجلس إدارة الهيئة العامة للأوقاف رقم (44/7/ر) وتاريخ 7 /3/ 1444هـ")] },
    instrument: { value: { number: "44/7/ر", dateHijri: "1444/03/07" }, evidence: [ev(UQN("20893"), "رقم (44/7/ر) وتاريخ 7 /3/ 1444هـ")] },
    publication: { value: { dateHijri: "1444/04/24", dateGregorian: "2022-11-18", url: UQN("20893") }, evidence: [ev(UQN("20893"), "1444-4-24 الموافق 18-11-2022")] },
    effective: { value: { rule: "تسري أحكام هذه اللائحة ويعمل بها من تاريخ نشرها. (المادة الثالثة عشرة)", from: "2022-11-18", computed: false }, evidence: [ev(UQN("20893"), "المادة الثالثة عشرة: النفاذ تسري أحكام هذه اللائحة ويعمل بها من تاريخ نشرها.")] },
    status: { value: "repealed", evidence: [ev(UQN_DR("4001176"), "المادة الخامسة والثلاثون: تحل هذه اللائحة محل لائحة إنشاء المحافظ الاستثمارية الوقفية وتعليمات الموافقة على إنشاء الصناديق الاستثمارية الوقفية.")], note: "ملغاة من تاريخ نفاذ لائحة المنتجات (محسوب 2026-09-10)، مع مهلة توفيق 12 شهرًا للمنتجات القائمة (المادة 36 من لائحة المنتجات)." },
    amendedBy: [],
    repealedBy: [{ refId: "PRD", from: addDays("2026-06-12", 90), evidence: [ev(UQN_DR("4001176"), "المادة الخامسة والثلاثون: الإلغاءات")], note: "تاريخ الإلغاء = تاريخ نفاذ لائحة المنتجات (محسوب)" }],
    repeals: [],
    officialSources: [{ url: UQN("20893"), role: "text" }],
    snapshots: [],
    kbCandidates: [],
    candidateServices: { codes: [], basis: "إصدار تاريخي؛ لا يُستند إليه لمخرج جديد" },
    retrieval: [relay("PRT", UQN("20893"))],
    lastVerifiedAt: AT,
    openQuestions: [],
  },
  {
    id: "FND",
    officialName: "تعليمات الموافقة على إنشاء الصناديق الاستثمارية الوقفية",
    kind: "decision",
    binding: "binding",
    issuer: unknown("لم يُسترجع نص التعليمات أو قرار إصدارها من مصدر رسمي في هذه المرحلة"),
    instrument: unknown("رقم القرار وتاريخه غير متاحين في المصادر التي روجعت"),
    publication: unknown("لم يُعثر على صفحة النشر"),
    effective: unknown("لم يُسترجع النص"),
    status: { value: "repealed", evidence: [ev(UQN_DR("4001176"), "المادة الخامسة والثلاثون: تحل هذه اللائحة محل … وتعليمات الموافقة على إنشاء الصناديق الاستثمارية الوقفية.")] },
    amendedBy: [],
    repealedBy: [{ refId: "PRD", from: addDays("2026-06-12", 90), evidence: [ev(UQN_DR("4001176"), "المادة الخامسة والثلاثون: الإلغاءات")] }],
    repeals: [],
    officialSources: [],
    snapshots: [],
    kbCandidates: [],
    candidateServices: { codes: [], basis: "إصدار تاريخي؛ لا يُستند إليه لمخرج جديد" },
    retrieval: [],
    lastVerifiedAt: AT,
    openQuestions: [],
  },
  {
    id: "DON",
    officialName: "لائحة إنشاء الأوقاف أو تمويلها من خلال جمع التبرعات",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "مجلس إدارة الهيئة العامة للأوقاف", evidence: [ev(UQN("27532"), "الصادرة بموجب قرار مجلس إدارة الهيئة رقم (6 /1 /47/ت) وتاريخ 23 /03/ 1447هـ")] },
    instrument: { value: { number: "6/1/47/ت", dateHijri: "1447/03/23" }, evidence: [ev(UQN("27532"), "رقم (6 /1 /47/ت) وتاريخ 23 /03/ 1447هـ")] },
    publication: { value: { dateHijri: "1447/04/25", dateGregorian: "2025-10-17", url: UQN("27532") }, evidence: [ev(UQN("27532"), "1447-4-25 الموافق 17-10-2025")] },
    effective: { value: { rule: "يُعمل بأحكام هذه اللائحة وتكون نافذة من تاريخ نشرها في الجريدة الرسمية. (المادة الثانية عشرة)", from: "2025-10-17", computed: false }, evidence: [ev(UQN("27532"), "المادة الثانية عشرة: يُعمل بأحكام هذه اللائحة وتكون نافذة من تاريخ نشرها في الجريدة الرسمية.")] },
    status: { value: "in_force", evidence: [ev(UQN("27532"), "منشورة ونافذة من تاريخ النشر")], note: "لم يُعثر على تعديل أو إلغاء." },
    amendedBy: [],
    repealedBy: [],
    repeals: [],
    officialSources: [{ url: UQN("27532"), role: "text" }],
    snapshots: ["DON/uqn-p27532"],
    kbCandidates: [{ label: "النص المصحح (البوابة الميسرة، مصدر ثانوي)", path: "DON/arbiter-sec06.txt", origin: "law.arbiter.sa كما حُفظ في مراجعة 2026-11-04" }],
    candidateServices: { codes: ["T08"], basis: HYPOTHESIS },
    retrieval: [relay("DON", UQN("27532"))],
    lastVerifiedAt: AT,
    openQuestions: [],
  },
  {
    id: "GAA-LAW",
    officialName: "نظام الهيئة العامة للأوقاف",
    kind: "statute",
    binding: "binding",
    issuer: { value: "مرسوم ملكي", evidence: [ev(UQN("19693"), "نظام الهيئة العامة للأوقاف، الصادر بالمرسوم الملكي رقم (م/11) وتاريخ 26 /2/ 1437هـ، وتعديلاته")] },
    instrument: { value: { number: "م/11", dateHijri: "1437/02/26" }, evidence: [ev(UQN("19693"), "الصادر بالمرسوم الملكي رقم (م/11) وتاريخ 26 /2/ 1437هـ")] },
    publication: unknown("صفحة النص في منصة هيئة الخبراء تعذر استرجاعها (3 محاولات)، ولم يُعثر على نشر النص الأصلي في أرشيف أم القرى الإلكتروني"),
    effective: unknown("لم يُسترجع نص النظام فلم يُقرأ حكم نفاذه"),
    status: { value: "in_force_amended", evidence: [ev(UQN("19693"), "قرار رقم (651) وتاريخ 22 /11/ 1443هـ — تعديل الفقرة (1) من المادة (السادسة)"), ev(UQN("21152"), "قرار رقم (363) وتاريخ 26 /05/ 1444هـ — إضافة الفقرة (2) إلى المادة (الحادية والعشرين)")], note: "ساري بتعديليه وفق صفحات التعديل؛ لم يُعثر على إلغاء." },
    amendedBy: [
      { refId: "GAA-LAW", from: "2022-07-01", evidence: [ev(UQN("19693"), "1443-12-02 الموافق 01-07-2022 — إحلال عبارة “يشكل من رئيس يعين بأمر من رئيس مجلس الوزراء” محل عبارة “برئاسة وزير الموارد البشرية والتنمية الاجتماعية” الواردة في صدر الفقرة (1) من المادة (السادسة)")], note: "قرار مجلس الوزراء (651) وتاريخ 1443/11/22؛ تاريخ النفاذ غير مذكور في الصفحة، والمسجل هو تاريخ النشر" },
      { refId: "GAA-LAW", from: "2022-12-30", evidence: [ev(UQN("21152"), "1444-6-06 الموافق 30-12-2022 — «2- يستثنى الوقف الخيري، والحصة الخيرية في الوقف المشترك، المسجلان لدى الهيئة، من أحكام نظام التكاليف القضائية»")], note: "قرار مجلس الوزراء (363) وتاريخ 1444/05/26، والمرسوم الملكي (م/72) وتاريخ 1444/06/01 (عنوان الصفحة p=21151)؛ المسجل هو تاريخ النشر" },
    ],
    repealedBy: [],
    repeals: [],
    officialSources: [
      { url: "https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/cabff788-438d-4003-be74-a9a700f2bcde/1", role: "text", note: "تعذر الاسترجاع في 2026-11-06" },
      { url: UQN("19693"), role: "amendment" },
      { url: UQN("21152"), role: "amendment" },
    ],
    snapshots: [],
    kbCandidates: [{ label: "النص المصحح (البوابة الميسرة، مصدر ثانوي)", path: "GAA-LAW/arbiter-sec12.txt", origin: "law.arbiter.sa كما حُفظ في مراجعة 2026-11-04" }],
    candidateServices: { codes: ["N01", "N09", "T01", "T03", "T04", "T06"], basis: HYPOTHESIS },
    retrieval: [
      failed("GAA-LAW", "https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/cabff788-438d-4003-be74-a9a700f2bcde/1", "access_blocked", "جميع محركات الاسترجاع فشلت (حجب آلي أو تعذر الوصول)"),
      failed("GAA-LAW", "https://laws.boe.gov.sa/boelaws/laws/lawdetails/cabff788-438d-4003-be74-a9a700f2bcde/1", "link", "ERR_TUNNEL_CONNECTION_FAILED"),
      failed("GAA-LAW", "https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/cabff788-438d-4003-be74-a9a700f2bcde/1?csrt=17858364789654791222", "link", "ERR_TUNNEL_CONNECTION_FAILED"),
    ],
    lastVerifiedAt: null,
    openQuestions: ["لم يُطابق نص النظام: يلزم استرجاعه من منصة هيئة الخبراء من بيئة تصل إليها."],
  },
  {
    id: "IHY",
    officialName: "لائحة إحياء الأوقاف المجهولة والمعطلة",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "مجلس إدارة الهيئة العامة للأوقاف", evidence: [ev(UQN_DR("4001990"), "المعتمدة بقرار مجلس إدارة الهيئة العامة للأوقاف رقم (1/1/48/ت) بتاريخ 12/03/1448هـ")] },
    instrument: { value: { number: "1/1/48/ت", dateHijri: "1448/03/12" }, evidence: [ev(UQN_DR("4001990"), "رقم (1/1/48/ت) بتاريخ 12/03/1448هـ")] },
    publication: { value: { dateHijri: "1448/04/21", dateGregorian: "2026-10-02", url: UQN_DR("4001990") }, evidence: [ev(UQN_DR("4001990"), "1448-4-21 الموافق 02-10-2026")] },
    effective: {
      value: { rule: "تكون هذه اللائحة نافذة من تاريخ إقرارها من المجلس، وتلغي ما يتعارض معها من أحكام. (المادة الثلاثون/1)", from: greg("1448/03/12"), computed: true },
      evidence: [ev(UQN_DR("4001990"), "المادة الثلاثون: نفاذ اللائحة 1- تكون هذه اللائحة نافذة من تاريخ إقرارها من المجلس")],
      note: "تاريخ الإقرار 1448/03/12هـ، وتحويله إلى الميلادي محسوب بتقويم أم القرى.",
    },
    status: { value: "in_force", evidence: [ev(UQN_DR("4001990"), "منشورة 2026-10-02؛ نافذة من تاريخ إقرارها")] },
    amendedBy: [],
    repealedBy: [],
    repeals: ["QWB"],
    officialSources: [{ url: UQN_DR("4001990"), role: "text" }, { url: "https://digitalcms.awqaf.gov.sa/sites/default/files/2026-09/%D9%84%D8%A7%D8%A6%D8%AD%D8%A9%20%D8%A5%D8%AD%D9%8A%D8%A7%D8%A1%20%D8%A7%D9%84%D8%A3%D9%88%D9%82%D8%A7%D9%81%20%D8%A7%D9%84%D9%85%D8%AC%D9%87%D9%88%D9%84%D8%A9%20%D9%88%D8%A7%D9%84%D9%85%D8%B9%D8%B7%D9%84%D8%A9.pdf", role: "file" }],
    snapshots: ["IHY/uqn-4001990"],
    kbCandidates: [],
    candidateServices: { codes: ["N09"], basis: "مرجع جديد لم يرد في مراجعة 2026-11-04؛ فرضية ارتباط بخدمة إحياء الوقف المعطل أو المجهول، غير معتمدة" },
    retrieval: [relay("IHY", UQN_DR("4001990"))],
    lastVerifiedAt: AT,
    openQuestions: [
      "مرجع جديد: غير موجود في ملفات المشروع ولا في قاعدة المعرفة؛ نصه الكامل لم يُحفظ لقطةً في هذه المرحلة.",
      "المادة 29: تصدر الهيئة دليلًا إجرائيًا لتنفيذ اللائحة (لم يُعثر عليه).",
      "استكمال 2026-11-06: حُفظ النص الكامل لقطةً (IHY/uqn-4001990): 8 فصول و30 مادة، ولا نسخة في قاعدة المعرفة لمقارنتها.",
      "النفاذ من تاريخ الإقرار (1448/03/12هـ) لا من تاريخ النشر (1448/04/21هـ): الوقائع بين التاريخين تحتاج مراجعة بشرية.",
      "المادة 3/2: تسري اللائحة على البلاغات المقدمة قبل نفاذها ما لم يصدر قرار برفضها أو حكم بإقامة ناظر.",
      "المادة 19: مهلة سنة من النفاذ لناظر الوقف المعطل (قابلة لسنة إضافية)، ولا تُستقبل بلاغات الأوقاف المعطلة خلالها.",
      "المادة 17/4: إعفاء المبلّغ المعتدي من المحاسبة إذا بادر بالإبلاغ خلال سنتين من النفاذ.",
    ],
  },
  {
    id: "QWB",
    officialName: "قواعد الإبلاغ عن الأوقاف المجهولة والمندثرة",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "مجلس إدارة الهيئة العامة للأوقاف", evidence: [ev(UQN_DR("4001990"), "قواعد الإبلاغ عن الأوقاف المجهولة والمندثرة الصادرة عن المجلس برقم 45/1/22/44 في 25/2/1444هـ")] },
    instrument: { value: { number: "45/1/22/44", dateHijri: "1444/02/25" }, evidence: [ev(UQN_DR("4001990"), "برقم 45/1/22/44 في 25/2/1444هـ")] },
    publication: unknown("لم يُعثر على صفحة نشر القواعد في أم القرى"),
    effective: unknown("لم يُسترجع نص القواعد الرسمي"),
    status: { value: "repealed", evidence: [ev(UQN_DR("4001990"), "المادة الثلاثون/2: تحل هذه اللائحة محل قواعد الإبلاغ عن الأوقاف المجهولة والمندثرة")], note: "تصحيح لمراجعة 2026-11-04 التي وصفت القواعد بأنها «مشروع»: صدرت بقرار مجلس الإدارة، وحلت محلها لائحة الإحياء." },
    amendedBy: [],
    repealedBy: [{ refId: "IHY", from: greg("1448/03/12"), evidence: [ev(UQN_DR("4001990"), "المادة الثلاثون/2")] }],
    repeals: [],
    officialSources: [],
    snapshots: [],
    kbCandidates: [],
    candidateServices: { codes: [], basis: "إصدار تاريخي" },
    retrieval: [],
    lastVerifiedAt: AT,
    openQuestions: [
      "سجل تاريخي: لا يُستند إليه لمخرج جديد. ملف المشروع «qwad_alablagh_n_alawqaf_almjhwlt_walmndthrt_1.pdf» نسخة من هذه القواعد الملغاة.",
      "أحكام القواعد التي يتعارض معها نص لائحة الإحياء ملغاة أيضًا بنص المادة 30/1 («وتلغي ما يتعارض معها من أحكام»).",
      "البلاغات المقدمة في ظل القواعد ولم يُبت فيها تخضع للائحة الإحياء (م3/2).",
    ],
  },
  {
    id: "BO-STD",
    officialName: "معايير المستفيد الحقيقي من الأوقاف",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "مجلس إدارة الهيئة العامة للأوقاف", evidence: [ev(BO_URL, "معتمدة بموجب قرار مجلس إدارة الهيئة رقم ت/47/1/14 وتاريخ 1447/6/13 هـ")] },
    instrument: { value: { number: "47/1/14/ت", dateHijri: "1447/06/13" }, evidence: [ev(BO_URL, "الغلاف: «ت/47/1/14 وتاريخ 1447/6/13 هـ» (الترتيب معكوس في الاستخراج؛ على نسق 31/1/18/43)")], note: "قراءة الرقم بعد عكس ترتيب الاستخراج؛ تحتاج تأكيدًا بصريًا من الملف. استكمال 2026-11-06: أُكد بصريًا من صورة غلاف الملف المرفوع (sha256 f7a51daf…): «47/1/14/ت وتاريخ 1447/6/13هـ»." },
    publication: unknown("المادة العاشرة: «تنشر المعايير في الجريدة الرسمية، ويعمل بها من تاريخ النشر»، ولم يُعثر على نشرها في أم القرى (بحث 2026-11-06)؛ وُجد فقط إعلان طرح مشروعها للاستطلاع (p=27457)"),
    effective: unknown("النفاذ معلق على النشر في الجريدة الرسمية، ولم يثبت النشر"),
    status: unknown("معتمدة بقرار حسب ملف الهيئة، لكن نفاذها معلق على نشر لم يثبت؛ لا تُعامل كسارية حتى يثبت النشر"),
    amendedBy: [],
    repealedBy: [],
    repeals: [],
    officialSources: [{ url: BO_URL, role: "file" }],
    snapshots: ["BO-STD/awqaf-2025-12", "BO-STD/upload-visual-f7a51daf"],
    kbCandidates: [{ label: "ملف المشروع (قراءة ضوئية)", path: "BO-STD/project-sec11.txt", origin: "«معايير المستفيد الحقيقي النسخة المُعتمدة.pdf» كما استُخرج في مراجعة 2026-11-04" }],
    candidateServices: { codes: ["C01", "C02", "G10", "N01", "N08"], basis: HYPOTHESIS },
    retrieval: [relay("BO-STD", BO_URL), failed("BO-STD", "https://www.uqn.gov.sa/", "no_official_publication", "بحث في أم القرى عن نشر المعايير: لا نتيجة"), search("BO-STD", "https://www.uqn.gov.sa/", "بحث ثانٍ «site:uqn.gov.sa معايير المستفيد الحقيقي من الأوقاف»: لا نشر للمعايير المعتمدة؛ النتيجة الوحيدة إعلان الاستطلاع (p=27457)")],
    lastVerifiedAt: AT,
    openQuestions: ["الاستخراج الرسمي لملف الهيئة نفسه مشوه في المادة السادسة (الفقرات 2–4 جدول مقلوب)؛ يلزم نص سليم لهذه الفقرات.", "المادة التاسعة تحيل إلى جدول المخالفات بتاريخ 1446/06/05هـ، والجدول نفسه يذكر 15 جمادى الآخرة 1446هـ: تعارض في التاريخ.",
      "استكمال 2026-11-06: المادة السادسة كاملة مقروءة من صور الصفحات (لقطة BO-STD/upload-visual-f7a51daf)، والفقرة 2 مطبوعة بخط عريض. لقطة القراءة البصرية مصدرها ملف مرفوع (manual_upload)، فلا تصلح للاستشهاد حتى يُجلب ملف الهيئة مباشرة وتُطابق بصمته.",
      "مطابقة اللقطتين: المواد 2–5 و7–9 متطابقة عدا حرفين من أخطاء الاستخراج (5/1/أ «كاملا»، 7/1/ب «ناظراً»)؛ المادة 1 اختلاف ترتيب جدول التعريفات فقط؛ المادة 6 مشوهة في طبقة نص ملف الهيئة؛ المادة 10 ابتلعت في استخراج الوسيط الفهرس والتمهيد.",
      "التمهيد يذكر قرار لائحة النظارة «(43/18/1/32ف)»، والمادة الأولى تذكره «(31/1/18/43)»، والجريدة تثبت 31/1/18/43: خطأ في التمهيد.",
      "المادة 8/1 («تكون نظارة الوقف من خلال نظار مقيمين في المملكة فقط») والمادة 4/2 (مستفيد حقيقي الناظر الاعتباري) تمسان النظارة الاعتبارية؛ لا تُطبقان قبل ثبوت النفاذ.",
    ],
  },
  {
    id: "PEN-TABLE",
    officialName: "جدول المخالفات والجزاءات للائحة تنظيم أعمال النظارة",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "مجلس إدارة الهيئة العامة للأوقاف", evidence: [ev("https://digitalcms.awqaf.gov.sa/sites/default/files/2025-07/jdwl_almkhalfat_waljzaat.pdf", "جدول المخالفات والجزاءات للائحة تنظيم أعمال النظارة الصادر بقرار مجلس الإدارة رقم (100/1/34/46) وتاريخ 15 جمادى الأخرة 1446هـ")] },
    instrument: { value: { number: "100/1/34/46", dateHijri: "1446/06/15" }, evidence: [ev("https://digitalcms.awqaf.gov.sa/sites/default/files/2025-07/jdwl_almkhalfat_waljzaat.pdf", "رقم (100/1/34/46) وتاريخ 15 جمادى الأخرة 1446هـ")] },
    publication: unknown("لم يُبحث عن نشر الجدول في أم القرى في هذه المرحلة؛ مصدره الوحيد المسترجع ملف الهيئة"),
    effective: unknown("لم يُقرأ حكم نفاذ في المقتطف المسترجع"),
    status: unknown("منشور على موقع الهيئة (أحدث ملف 2026-04 لم يُسترجع)؛ لم يثبت تاريخ نفاذه"),
    amendedBy: [],
    repealedBy: [],
    repeals: [],
    officialSources: [
      { url: "https://digitalcms.awqaf.gov.sa/sites/default/files/2025-07/jdwl_almkhalfat_waljzaat.pdf", role: "file" },
      { url: "https://digitalcms.awqaf.gov.sa/sites/default/files/2026-04/%D8%AC%D8%AF%D9%88%D9%84%20%D8%A7%D9%84%D9%85%D8%AE%D8%A7%D9%84%D9%81%D8%A7%D8%AA%20.pdf", role: "file", note: "أحدث نسخة مدرجة في صفحة الأنظمة؛ لم تُسترجع" },
      { url: "https://digitalcms.awqaf.gov.sa/sites/default/files/2025-01/jdwl_almkhalfat_waljzaat_llayht_tnzym_amal_alnzart_19-01-2025_0.pdf", role: "file", note: "نسخة 2025-01؛ لم تُسترجع" },
    ],
    snapshots: [],
    kbCandidates: [],
    candidateServices: { codes: ["C03", "C04"], basis: HYPOTHESIS },
    structuredData: [{ path: "structured/PEN-TABLE/upload-665344b8.json", sourceSha256: "665344b85565d474f95678b4d9e6cf17e9052153ba991ba7066fceb1b30a74ce", note: "34 مخالفة في 7 مجموعات × 9 خلايا جزاء، مستخرجة من الملف المرفوع «جدول المخالفات ..pdf» (10 صفحات) ومراجعة بصريًا للصفحات 3–9. لم تثبت مطابقة الملف لملف الهيئة المنشور." }],
    retrieval: [relay("PEN-TABLE", "https://digitalcms.awqaf.gov.sa/sites/default/files/2025-07/jdwl_almkhalfat_waljzaat.pdf")],
    lastVerifiedAt: AT,
    openQuestions: ["تمهيد الجدول يذكر قرار لائحة النظارة برقم (32/1/18/43)؛ الجريدة تثبت (31/1/18/43).", "ثلاث نسخ على موقع الهيئة (2025-01، 2025-07، 2026-04): يلزم تحديد الساري ومقارنة الخلايا.", "الجدول لم يُستخرج بيانات منظمة في هذه المرحلة.",
      "استكمال 2026-11-06: استُخرج الجدول بيانات منظمة (structuredData)؛ أعلى غرامة في الخلايا 200.000 ريال (5-3، كبيرة، الثالثة)، والحاشية تنص على مضاعفة الغرامة بعد ثلاث مرات بحد أقصى (500.000) ريال، موافقًا للمادة 24/1/ب من اللائحة.",
      "تمهيد الجدول يصف مراحل إيقاع الجزاء (فحص، خطة تصحيحية ومهلة، إحالة إلى «لجنة النظر في المخالفات»)؛ هذا وصف في تمهيد الجدول، لا يقوم مقام قواعد معالجة المخالفات (NZR-VIOL).",
    ],
  },
  {
    id: "NZR-VIOL",
    officialName: "قواعد معالجة المخالفات (لائحة تنظيم أعمال النظارة م23/2)",
    kind: "regulation",
    binding: "binding",
    issuer: { value: "الهيئة العامة للأوقاف", evidence: [ev(UQN("18926"), "المادة الثالثة والعشرون/2: تصدر الهيئة قواعد لمعالجة المخالفات؛ تحدد فيها إجراءات النظر في المخالفات، وآلية إصدار الجزاءات.")] },
    instrument: unknown("لم يُعثر على القواعد ولا على رقم قرارها"),
    publication: unknown("صفحة الأسئلة الشائعة للهيئة تقول إنها «منشورة ومتاحة للعموم عبر موقع الهيئة»، ولم تُدرج في صفحة الأنظمة واللوائح (فُحصت 2026-11-06)"),
    effective: unknown("لم يُسترجع النص"),
    status: unknown("ثبت صدورها بقول الهيئة؛ لم يُسترجع نصها"),
    amendedBy: [],
    repealedBy: [],
    repeals: [],
    officialSources: [{ url: "https://awqaf.gov.sa/ar/help/faq/109", role: "listing", note: "«نعم، القواعد منشورة ومتاحة للعموم عبر موقع الهيئة العامة للأوقاف.»" }],
    snapshots: ["NZR-LIC/awqaf-faq-109"],
    kbCandidates: [],
    candidateServices: { codes: ["C03", "C04"], basis: HYPOTHESIS },
    retrieval: [failed("NZR-VIOL", "https://awqaf.gov.sa/ar/rules-and-regulations", "link", "الهيئة تذكر أنها منشورة، ولا رابط لها في صفحة الأنظمة واللوائح"), search("NZR-VIOL", "https://awqaf.gov.sa/", "بحث «قواعد معالجة المخالفات» الهيئة العامة للأوقاف النظار: صفحة الأسئلة الشائعة فقط، ومقتطف تقرير سنوي على موقع غير رسمي يذكر أن الهيئة «أصدرت قواعد معالجة المخالفات»؛ لا نص")],
    lastVerifiedAt: null,
    openQuestions: ["يلزم الرابط الرسمي للقواعد أو نسختها.", "نتيجة بحث 2026-11-06: ثبت صدورها بقول الهيئة (الأسئلة الشائعة تذكر من ضماناتها «التواصل مع الناظر المخالف أثناء النظر في المخالفة والاجتماع معه، والاطلاع على قرار المخالفة وتقديم الاعتراض»)، ولم يُعثر على نصها. لا تُنشأ قواعد افتراضية، ولا يُستعمل وصف الأسئلة الشائعة أو تمهيد الجدول بديلًا عنها."],
  },
  {
    id: "NZR-LIC",
    officialName: "ضوابط ترخيص الناظر الاعتباري (لائحة تنظيم أعمال النظارة م5/2)",
    kind: "regulation",
    binding: "binding",
    issuer: unknown("اللائحة تشترط الترخيص من الهيئة، ولم يُعثر على وثيقة الضوابط"),
    instrument: unknown("لم يُعثر على الوثيقة"),
    publication: unknown("لم يُعثر على نشر في أم القرى ولا في موقع الهيئة (بحثان)"),
    effective: unknown("لم يُعثر على الوثيقة"),
    status: unknown("لم يثبت وجود ضوابط منشورة؛ والهيئة تذكر في أسئلتها الشائعة أنها «تعمل حاليًا على دراسة آلية نموذجية متكاملة لترخيص الأشخاص الاعترابيين لتولي أعمال النظارة» (لقطة 2026-11-06)"),
    amendedBy: [],
    repealedBy: [],
    repeals: [],
    officialSources: [{ url: UQN("18926"), role: "text", note: "المادة الخامسة/2: يُشترط لتعيين الشخص الاعتباري أن يكون مرخصاً من الهيئة." }],
    snapshots: ["NZR-LIC/awqaf-faq-109"],
    kbCandidates: [],
    candidateServices: { codes: ["N01"], basis: HYPOTHESIS },
    retrieval: [failed("NZR-LIC", "https://awqaf.gov.sa/ar/rules-and-regulations", "no_official_publication", "لا وثيقة ضوابط ترخيص منشورة")],
    lastVerifiedAt: null,
    openQuestions: [
      "يلزم نص الضوابط أو رابطها الرسمي.",
      "تصنيف 2026-11-06: مسألة تنظيمية تحتاج متابعة، لا مانع. النص (م5/2) يشترط الترخيص، وإجراءاته غير منشورة والهيئة تدرسها. لا تُفترض شروط لم تُنشر، ولا يُنسب إلى الهيئة قرار، ولا تُرفض طلبات النظارة الاعتبارية آليًا، ولا يُعطل حق الواقف في اختيار الناظر. ما يلزم بشأن الترخيص في طلب بعينه تقرره الجهة المختصة (src/server/references/nazir-appointment.ts).",
    ],
  },
  {
    id: "SOCPA-NPO",
    officialName: "المعايير المحاسبية للمنشآت غير الهادفة للربح (المحدث)",
    kind: "professional_standard",
    binding: "professional",
    issuer: { value: "الهيئة السعودية للمراجعين والمحاسبين", evidence: [ev("https://socpa.org.sa/Socpa/Professional-standards/Accounting-standards/2514.aspx", "اعتمد مجلس معايير المحاسبة في اجتماعه الثامن المنعقد في جمادى الأولى 1445هـ/ نوفمبر 2023م، تعديلاً على معيار العرض والإفصاح للمنشآت غير الهادفة …")], note: "من مقتطف نتيجة البحث؛ الصفحة نفسها لم تُسترجع" },
    instrument: unknown("لم يُسترجع قرار الاعتماد"),
    publication: { value: { dateHijri: null, dateGregorian: "2023-11-01", url: "https://socpa.org.sa/Socpa/Professional-standards/Accounting-standards/2514.aspx" }, evidence: [ev("https://socpa.org.sa/Socpa/Professional-standards/Accounting-standards/2514.aspx", "جمادى الأولى 1445هـ/ نوفمبر 2023م")], note: "الشهر فقط معروف؛ اليوم غير معروف (مسجل أول الشهر)" },
    effective: unknown("لم يُقرأ تاريخ سريان التعديل"),
    status: unknown("منشورة رسميًا؛ لم يُتحقق من نطاق انطباقها على الأوقاف: صفحة استفسارات للهيئة نفسها تذكر أن المعيار الدولي للمنشآت الصغيرة والمتوسطة هو المتعارف عليه للمنشآت غير الهادفة للربح"),
    amendedBy: [],
    repealedBy: [],
    repeals: [],
    officialSources: [
      { url: "https://socpa.org.sa/Socpa/Professional-standards/Accounting-standards/2514.aspx", role: "listing" },
      { url: "https://socpa.org.sa/getattachment/Socpa/Professional-standards/Accounting-standards/2514/2.pdf.aspx?lang=ar-SA", role: "file", note: "معيار العرض والإفصاح (المحدث)" },
      { url: "https://socpa.org.sa/Socpa/Professional-standards/Accounting-standards/3155/Non-profitable-organizations.aspx?lang=ar-sa", role: "listing", note: "المعايير المصدرة عام 2012م" },
    ],
    snapshots: [],
    kbCandidates: [],
    candidateServices: { codes: ["F02", "F03", "F06"], basis: HYPOTHESIS },
    retrieval: [],
    lastVerifiedAt: null,
    openQuestions: ["المعايير منشورة رسميًا: لا يلزم ملف من المستخدم. يلزم قرار مهني بالمعيار المنطبق على الأوقاف (معايير المنشآت غير الهادفة للربح أو المعيار الدولي للمنشآت الصغيرة والمتوسطة)."],
  },
  {
    id: "GOV-PRIN",
    officialName: "وثيقة مبادئ حوكمة الأوقاف",
    kind: "guide",
    binding: "guidance",
    issuer: unknown("لم يُسترجع نص الوثيقة المنشورة في هذه المرحلة"),
    instrument: unknown("لم يُسترجع"),
    publication: unknown("ملف منشور على موقع الهيئة (2026-02) لم يُسترجع"),
    effective: unknown("لم يُسترجع"),
    status: unknown("الوثيقة المنشورة موجودة على موقع الهيئة؛ ملف المشروع موسوم «Draft» ولم يُطابق بها"),
    amendedBy: [],
    repealedBy: [],
    repeals: [],
    officialSources: [{ url: "https://digitalcms.awqaf.gov.sa/sites/default/files/2026-02/Endowment-Governance-Document.pdf", role: "file" }],
    snapshots: [],
    kbCandidates: [],
    candidateServices: { codes: [], basis: "إرشادي؛ لا يحجب خدمة وحده" },
    retrieval: [],
    lastVerifiedAt: null,
    openQuestions: [],
  },
];

/** Instruments named in the 2026-11-04 review whose official text was not retrieved in this phase. */
export const PENDING_RETRIEVAL: { id: string; name: string; official: string; reason: string; services: string[] }[] = [
  { id: "PSL", name: "نظام الأحوال الشخصية (أحكام الوصية)", official: "https://laws.boe.gov.sa/boelaws/laws/lawdetails/4d72d829-947b-45d5-b9b5-ae5800d6bac2/1", reason: "منصة هيئة الخبراء تعذر الوصول إليها في 2026-11-06", services: ["W01", "W02", "W03", "W04", "W05"] },
  { id: "TAWTHEEQ", name: "نظام التوثيق ولائحته", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: ["T03", "T06", "W02", "W05"] },
  { id: "AML", name: "نظام مكافحة غسل الأموال ولائحته التنفيذية", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: ["G10"] },
  { id: "CMA-LAW", name: "نظام السوق المالية ولائحة الأشخاص المرخص لهم", official: "cma.gov.sa", reason: "لم يُحاول في هذه المرحلة", services: ["C10", "I05", "T07"] },
  { id: "MURAFAAT", name: "نظام المرافعات الشرعية", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: ["C12", "C13", "N09"] },
  { id: "MUHAMAH", name: "نظام المحاماة", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: ["C08", "C13"] },
  { id: "ITHBAT", name: "نظام الإثبات", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: [] },
  { id: "MUQAYYIMIN", name: "نظام المقيمين المعتمدين", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: ["I04", "I08"] },
  { id: "PDPL", name: "نظام حماية البيانات الشخصية ولوائحه", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: [] },
  { id: "JAMEYAT", name: "نظام الجمعيات والمؤسسات الأهلية ولائحته", official: "https://www.uqn.gov.sa/decisions-and-regulations/4000284", reason: "اللائحة التنفيذية منشورة في أم القرى؛ لم تُسترجع", services: ["T09"] },
  { id: "CIVIL-TX", name: "نظام المعاملات المدنية", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: ["N04"] },
  { id: "COMPANIES", name: "نظام الشركات", official: "https://www.uqn.gov.sa/details?p=19697", reason: "منشور في أم القرى؛ لم يُسترجع لحجمه", services: ["T09"] },
  { id: "CPA-LAW", name: "نظام المحاسبين القانونيين", official: "laws.boe.gov.sa", reason: "منصة هيئة الخبراء تعذر الوصول إليها", services: ["F06"] },
];

export function getEntry(id: string): RegistryEntry | undefined {
  return REGISTRY.find((e) => e.id === id);
}

/**
 * Status of an instrument on a date, from its own effectiveness clause and any evidenced repeal or amendment.
 * When the effective date is unknown, a published amendment proves the text was in force from that amendment on;
 * before that the status is unknown.
 */
export function statusAt(e: RegistryEntry, isoDate: string): RefStatus {
  if (e.repealedBy.some((r) => r.from !== null && isoDate >= r.from)) return "repealed";
  const amendedSince = e.amendedBy.map((a) => a.from).filter((x): x is string => x !== null).sort()[0] ?? null;
  const eff = e.effective.value?.from ?? null;
  if (eff === null) {
    if (e.status.value === "repealed" && e.repealedBy.length === 0) return "repealed";
    if (amendedSince && isoDate >= amendedSince && (e.status.value === "in_force" || e.status.value === "in_force_amended")) return "in_force_amended";
    return "unknown";
  }
  if (isoDate < eff) return "not_yet_in_force";
  return amendedSince && isoDate >= amendedSince ? "in_force_amended" : "in_force";
}

const isOfficial = (url: string) => {
  try {
    return (OFFICIAL_HOSTS as readonly string[]).includes(new URL(url).host);
  } catch {
    return false;
  }
};

/** Integrity rules of the registry. Returns a list of violations (empty = valid). */
export function validateRegistry(entries: RegistryEntry[] = REGISTRY): string[] {
  const v: string[] = [];
  const ids = new Set<string>();
  for (const e of entries) {
    if (ids.has(e.id)) v.push(`${e.id}: معرف مكرر`);
    ids.add(e.id);
    const facts = { issuer: e.issuer, instrument: e.instrument, publication: e.publication, effective: e.effective, status: e.status } as Record<string, Fact<unknown>>;
    for (const [k, f] of Object.entries(facts)) {
      if (f.value === null) {
        if (!("unknownReason" in f) || !f.unknownReason) v.push(`${e.id}.${k}: قيمة مجهولة بلا سبب`);
      } else {
        const evs = (f as { evidence: Evidence[] }).evidence;
        if (!evs?.length) v.push(`${e.id}.${k}: قيمة بلا دليل`);
        if (e.binding === "binding" && evs?.some((x) => !isOfficial(x.url))) v.push(`${e.id}.${k}: دليل من مصدر غير رسمي`);
      }
    }
    if (e.binding === "binding" && e.status.value !== null && e.status.value !== "unknown" && e.officialSources.length === 0 && e.repealedBy.length === 0) v.push(`${e.id}: حالة مسجلة بلا مصدر رسمي`);
    for (const s of e.officialSources) if (!isOfficial(s.url)) v.push(`${e.id}: مصدر «رسمي» على نطاق غير رسمي ${s.url}`);
    for (const r of [...e.repealedBy, ...e.amendedBy]) if (!r.evidence.length) v.push(`${e.id}: علاقة تعديل أو إلغاء بلا دليل`);
    if (e.effective.value?.computed && !("note" in e.effective && e.effective.note)) v.push(`${e.id}: تاريخ نفاذ محسوب بلا بيان طريقة الحساب`);
    if (!e.candidateServices.basis) v.push(`${e.id}: خدمات محتملة بلا بيان أساسها`);
  }
  for (const e of entries) for (const r of e.repeals) if (!ids.has(r)) v.push(`${e.id}: يلغي مرجعًا غير مسجل ${r}`);
  return v;
}
