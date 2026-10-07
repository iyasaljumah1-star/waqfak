/**
 * Service catalog v1 (Master Plan §كتالوج الخدمات). Prices are intentionally NULL ("اطلب عرضًا") until the
 * market test (Phase 0) — every price, package and discount is editable from Admin → الخدمات والأسعار.
 */
export const CATEGORIES = [
  { code: "T", nameAr: "التأسيس والتصميم", description: "قبل التوثيق: تصميم الوقف وصياغة وثيقته وتجهيز التوثيق والتسجيل", position: 1 },
  { code: "W", nameAr: "الوصايا", description: "الوصية والوصية بالوقف", position: 2 },
  { code: "N", nameAr: "النظارة والإدارة", description: "تولي النظارة ومساندة الناظر والإدارة المفوضة", position: 3 },
  { code: "G", nameAr: "الحوكمة والبناء المؤسسي", description: "اللوائح والسياسات والمجالس والمراجعة الداخلية", position: 4 },
  { code: "F", nameAr: "المالية والمحاسبة", description: "النظام المحاسبي والموازنة والقوائم والمراجعة", position: 5 },
  { code: "I", nameAr: "الاستثمار والأصول", description: "سياسات الاستثمار ودراسات الجدوى والاستبدال والأصول", position: 6 },
  { code: "C", nameAr: "الامتثال والتقارير والاستشارات", description: "التقييم والامتثال والتقارير والاستشارات المتخصصة", position: 7 },
];

export const WORKFLOWS = [
  { code: "standard", nameAr: "سير العمل القياسي", stages: [
    { key: "intake", name: "استلام البيانات والمستندات", slaDays: 3, role: "account_manager" },
    { key: "analysis", name: "الدراسة والتحليل", slaDays: 7, role: "consultant" },
    { key: "drafting", name: "إعداد المخرجات", slaDays: 7, role: "consultant" },
    { key: "qa", name: "مراجعة الجودة", slaDays: 2, role: "quality" },
    { key: "client_review", name: "اعتماد العميل", slaDays: 5, role: "client", clientApproval: true },
  ] },
  { code: "opinion", nameAr: "رأي متخصص موقّع", stages: [
    { key: "intake", name: "استلام السؤال والمستندات", slaDays: 2, role: "account_manager" },
    { key: "study", name: "دراسة المستشار", slaDays: 5, role: "consultant" },
    { key: "qa", name: "مراجعة ثانية", slaDays: 2, role: "quality" },
    { key: "delivery", name: "تسليم الرأي الموقّع", slaDays: 1, role: "consultant" },
  ] },
  { code: "registration", nameAr: "تجهيز التوثيق والتسجيل", stages: [
    { key: "checklist", name: "قائمة التحقق والمستندات", slaDays: 3, role: "employee" },
    { key: "package", name: "إعداد الحزمة بترتيب البوابة", slaDays: 3, role: "employee" },
    { key: "client_submit", name: "تقديم الناظر أو وكيله عبر البوابة", slaDays: 10, role: "client", clientApproval: true },
    { key: "follow_up", name: "المتابعة حتى صدور الشهادة", slaDays: 10, role: "employee" },
  ] },
  { code: "subscription", nameAr: "خدمة مستمرة", stages: [
    { key: "onboarding", name: "التهيئة وبناء ملف الوقف", slaDays: 10, role: "account_manager" },
    { key: "running", name: "التشغيل الدوري", slaDays: 365, role: "employee" },
  ] },
];

type S = {
  code: string; cat: string; nameAr: string; summary: string; outputs: string; pricingModel: "free" | "fixed" | "subscription" | "hourly" | "percentage" | "quote";
  slaDays?: number; dept: string; restriction?: string; conflictRule?: string; license?: string; workflow?: string; audiences: string[]; stage?: number;
  docs?: { docType: string; label: string; required: boolean }[];
};

const DEED = { docType: "waqf_deed", label: "صك الوقفية", required: true };
const NAZARA = { docType: "nazara_deed", label: "صك النظارة", required: true };
const CERT = { docType: "registration_certificate", label: "شهادة تسجيل الوقف", required: false };
const OWN = { docType: "ownership_deed", label: "صكوك ملكية الأصول", required: false };
const FIN = { docType: "financial_statement", label: "آخر قوائم أو بيان مالي", required: false };
const BANK = { docType: "bank_statement", label: "كشوف الحساب البنكي", required: false };

export const SERVICES: S[] = [
  // ── T التأسيس
  { code: "T01", cat: "T", nameAr: "جلسة تصميم الوقف", summary: "مذكرة تحدد الأصول والمصارف والنوع والشكل النظامي والحوكمة المقترحة لوقفك.", outputs: "مذكرة تصميم الوقف", pricingModel: "fixed", slaDays: 7, dept: "sharia", restriction: "مخرجات استرشادية.", audiences: ["waqif"], stage: 1 },
  { code: "T02", cat: "T", nameAr: "تحليل الاحتياج المجتمعي لاختيار المصرف", summary: "دراسة الفجوات الكمية والنوعية في المجال الذي تريد الوقف عليه.", outputs: "دراسة احتياج", pricingModel: "quote", slaDays: 21, dept: "governance", audiences: ["waqif"], stage: 1 },
  { code: "T03", cat: "T", nameAr: "صياغة وثيقة الوقف", summary: "وثيقة بالبنود العشرة مع مراجعة شرعية وقانونية موقّعة.", outputs: "مسودة وثيقة نهائية جاهزة للتوثيق", pricingModel: "fixed", slaDays: 14, dept: "legal", restriction: "التوثيق من اختصاص الجهة المختصة (كتابة العدل أو المحكمة).", audiences: ["waqif"], stage: 2, docs: [OWN] },
  { code: "T04", cat: "T", nameAr: "مراجعة وثيقة وقف قائمة", summary: "تقرير ملاحظات على الوثيقة وبنود مقترحة للتعديل.", outputs: "تقرير مراجعة", pricingModel: "fixed", slaDays: 10, dept: "legal", restriction: "أي تعديل للشروط يحتاج إذن الجهة المختصة.", audiences: ["waqif", "nazir"], stage: 2, docs: [DEED] },
  { code: "T05", cat: "T", nameAr: "اختيار الأصل الموقوف", summary: "مصفوفة اختيار الأصل بالمعايير الستة من دليل الهيئة.", outputs: "مصفوفة اختيار وتوصية", pricingModel: "fixed", slaDays: 10, dept: "investment", audiences: ["waqif"], stage: 1 },
  { code: "T06", cat: "T", nameAr: "تجهيز ملف التوثيق والتسجيل", summary: "حزمة ناجز وحزمة الهيئة بترتيب البوابة، والمتابعة حتى صدور الشهادة، أو تنفيذها بوكالة خاصة.", outputs: "حزمة جاهزة للتقديم وشهادة التسجيل", pricingModel: "fixed", slaDays: 20, dept: "operations", restriction: "التسجيل لدى الهيئة مجاني؛ الإقرار في البوابة بيد الناظر أو وكيله.", workflow: "registration", audiences: ["waqif", "nazir"], stage: 2, docs: [DEED, NAZARA, OWN] },
  { code: "T07", cat: "T", nameAr: "وقف أصل مالي (أسهم، وحدات، محفظة)", summary: "وثيقة أو ملحق وقفي بالبنود الثمانية وخطة نقل الأصول دون صفقات.", outputs: "ملحق وقفي وخطة نقل", pricingModel: "fixed", slaDays: 14, dept: "investment", restriction: "التنفيذ عبر مؤسسة سوق مالية مرخصة (لائحة المنتجات م24).", audiences: ["waqif"], stage: 2 },
  { code: "T08", cat: "T", nameAr: "ملف ترخيص جمع التبرعات", summary: "الحزمة الكاملة لمستندات المادة الثالثة من لائحة جمع التبرعات.", outputs: "ملف طلب ترخيص", pricingModel: "quote", slaDays: 21, dept: "legal", restriction: "المتقدم شخص اعتباري؛ المنصة لا تستقبل التبرعات.", audiences: ["entity", "nazir"], stage: 2 },
  { code: "T09", cat: "T", nameAr: "تأسيس كيان وقفي", summary: "هيكل نظامي ومستندات تأسيس شركة أو مؤسسة وقفية.", outputs: "مستندات التأسيس", pricingModel: "quote", slaDays: 30, dept: "legal", audiences: ["waqif", "entity"], stage: 3 },

  // ── W الوصايا
  { code: "W01", cat: "W", nameAr: "صياغة وصية شرعية ونظامية", summary: "وصية جامعة واحدة (ومنها الوصية بالوقف) تلغي ما سبقها صراحة.", outputs: "نص الوصية", pricingModel: "fixed", slaDays: 10, dept: "sharia", restriction: "الوصية فيما زاد على الثلث أو لوارث تُراجع بشريًا وتحتاج إجازة الورثة.", workflow: "opinion", audiences: ["waqif"], stage: 1 },
  { code: "W02", cat: "W", nameAr: "توثيق الوصية", summary: "حزمة ناجز أو التنفيذ بوكالة «إثبات وصية».", outputs: "حزمة التوثيق", pricingModel: "fixed", slaDays: 14, dept: "operations", audiences: ["waqif"], stage: 2 },
  { code: "W03", cat: "W", nameAr: "دراسة وصية قائمة وتطويرها", summary: "تقرير ملاحظات على الوصية وبنود مقترحة.", outputs: "تقرير مراجعة", pricingModel: "fixed", slaDays: 7, dept: "sharia", workflow: "opinion", audiences: ["waqif"], stage: 2 },
  { code: "W04", cat: "W", nameAr: "لائحة مجلس الأوصياء", summary: "لائحة تنظم عمل الأوصياء وقراراتهم.", outputs: "لائحة", pricingModel: "fixed", slaDays: 10, dept: "governance", audiences: ["waqif"], stage: 3 },
  { code: "W05", cat: "W", nameAr: "تنفيذ وصية بوقف بعد الوفاة", summary: "إدخال الورثة والإثبات وإنشاء الوقف.", outputs: "وقف موثّق ومسجّل", pricingModel: "quote", slaDays: 45, dept: "legal", audiences: ["waqif", "nazir"], stage: 2 },

  // ── N النظارة
  { code: "N01", cat: "N", nameAr: "تولي النظارة (ناظر اعتباري)", summary: "تتولى وقفك النظارة الكاملة بكل التزاماتها.", outputs: "النظارة المستمرة", pricingModel: "percentage", dept: "operations", license: "gaa_nazara_license", workflow: "subscription",
    restriction: "يتطلب ترخيص الهيئة للناظر الاعتباري (لائحة النظارة م5/2)، والأجر بالشرط أو بقرار الجهة المختصة (م11/1).", audiences: ["waqif", "nazir", "board"], stage: 4 },
  { code: "N02", cat: "N", nameAr: "عضوية مستقلة في مجلس النظارة", summary: "عضو مستقل من وقفك في مجلس الوقف.", outputs: "مقعد مستقل", pricingModel: "subscription", dept: "governance", workflow: "subscription", audiences: ["board"], stage: 3 },
  { code: "N03", cat: "N", nameAr: "مساندة الناظر (استشارية)", summary: "مستشار مخصص ومراجعة دورية دون تفويض بالإدارة.", outputs: "مساندة مستمرة", pricingModel: "subscription", dept: "governance", workflow: "subscription", audiences: ["nazir"], stage: 4 },
  { code: "N04", cat: "N", nameAr: "إدارة مفوّضة للوقف", summary: "إدارة الحفظ والإيجار والتنمية والإصلاح بتفويض من الناظر.", outputs: "إدارة مستمرة", pricingModel: "subscription", dept: "operations", workflow: "subscription",
    restriction: "يُشترط في المفوَّض ما يُشترط في الناظر، والمسؤولية تضامنية (لائحة النظارة م11/4).", audiences: ["nazir"], stage: 4 },
  { code: "N05", cat: "N", nameAr: "أمانة مجلس النظارة", summary: "جداول الأعمال والدعوات والمحاضر ومتابعة القرارات.", outputs: "أمانة مستمرة", pricingModel: "subscription", dept: "governance", workflow: "subscription", audiences: ["board"], stage: 3 },
  { code: "N06", cat: "N", nameAr: "تنسيق أعمال الوقف", summary: "تشغيل يومي ومتابعة الأعمال.", outputs: "تشغيل مستمر", pricingModel: "subscription", dept: "operations", workflow: "subscription", audiences: ["nazir"], stage: 4 },
  { code: "N07", cat: "N", nameAr: "إدارة سجل المستفيدين والصرف", summary: "سجل محدث وكشوف صرف وإثبات وصول من حساب الوقف.", outputs: "سجل وكشوف", pricingModel: "subscription", dept: "finance", restriction: "الصرف من حساب الوقف فقط.", workflow: "subscription", audiences: ["nazir"], stage: 4 },
  { code: "N08", cat: "N", nameAr: "تسليم واستلام النظارة", summary: "محضر تسليم وجرد الأصول والمستندات وتحديث الشهادة.", outputs: "محضر تسليم", pricingModel: "fixed", slaDays: 7, dept: "legal", restriction: "التسليم فوري (معايير المستفيد الحقيقي م7/4).", audiences: ["nazir", "board"], stage: 4 },
  { code: "N09", cat: "N", nameAr: "إحياء وقف معطل أو مجهول", summary: "خطة إحياء وملف إثبات وإعداد البلاغ.", outputs: "خطة وملف إثبات", pricingModel: "quote", dept: "legal", restriction: "البلاغ عن وقف مجهول عبر موقع الهيئة فقط.", audiences: ["nazir", "waqif"], stage: 4 },

  // ── G الحوكمة
  { code: "G01", cat: "G", nameAr: "حزمة الحوكمة حسب الحجم", summary: "اللوائح والسياسات الاثنتا عشرة ومصفوفة الصلاحيات.", outputs: "حزمة لوائح معتمدة", pricingModel: "fixed", slaDays: 30, dept: "governance", audiences: ["nazir", "board"], stage: 3 },
  { code: "G02", cat: "G", nameAr: "النظام الأساسي للوقف", summary: "نظام أساسي يحدد الكيان والمقر والموارد والمجلس والرقابة.", outputs: "نظام أساسي", pricingModel: "fixed", slaDays: 14, dept: "governance", audiences: ["nazir", "board"], stage: 3 },
  { code: "G03", cat: "G", nameAr: "تشكيل مجلس النظارة ولجانه", summary: "ميثاق المجلس واللجان ومعايير الاستقلال.", outputs: "مواثيق", pricingModel: "fixed", slaDays: 14, dept: "governance", audiences: ["board", "nazir"], stage: 3 },
  { code: "G04", cat: "G", nameAr: "الخطة الاستراتيجية والتشغيلية", summary: "خطة ومؤشرات أداء.", outputs: "خطة", pricingModel: "quote", slaDays: 30, dept: "governance", audiences: ["board", "nazir"], stage: 3 },
  { code: "G05", cat: "G", nameAr: "الدليل الإجرائي للمصارف", summary: "دليل صرف ومعايير توزيع ومفاضلة.", outputs: "دليل إجرائي", pricingModel: "fixed", slaDays: 14, dept: "governance", audiences: ["nazir", "board"], stage: 3 },
  { code: "G06", cat: "G", nameAr: "سياسة تعارض المصالح وسجل الإفصاح", summary: "سياسة ونماذج إقرار سنوية.", outputs: "سياسة ونماذج", pricingModel: "fixed", slaDays: 7, dept: "governance", audiences: ["nazir", "board"], stage: 3 },
  { code: "G07", cat: "G", nameAr: "سياسة الاستخلاف في النظارة", summary: "سياسة تمنع شغور النظارة.", outputs: "سياسة", pricingModel: "fixed", slaDays: 7, dept: "governance", audiences: ["waqif", "nazir", "board"], stage: 3 },
  { code: "G08", cat: "G", nameAr: "المراجعة الداخلية", summary: "تقرير مراجعة داخلية للضوابط والسجل.", outputs: "تقرير مراجعة داخلية", pricingModel: "quote", slaDays: 21, dept: "finance", conflictRule: "blocked_if_waqfak_controls_finance", audiences: ["board"], stage: 4 },
  { code: "G09", cat: "G", nameAr: "تقييم أداء المجلس والناظر", summary: "تقرير تقييم سنوي.", outputs: "تقرير تقييم", pricingModel: "fixed", slaDays: 14, dept: "governance", conflictRule: "blocked_if_waqfak_nazir", audiences: ["board", "waqif"], stage: 4 },
  { code: "G10", cat: "G", nameAr: "برنامج مكافحة غسل الأموال والمستفيد الحقيقي", summary: "سياسة وسجل المستفيد الحقيقي وتقييم المخاطر.", outputs: "برنامج امتثال", pricingModel: "fixed", slaDays: 14, dept: "legal", audiences: ["nazir", "board"], stage: 4 },

  // ── F المالية
  { code: "F01", cat: "F", nameAr: "التحليل المالي لشرط الواقف", summary: "نسب الصيانة والتنمية والاحتياطي والمصارف.", outputs: "مذكرة مالية", pricingModel: "fixed", slaDays: 7, dept: "finance", audiences: ["waqif", "nazir"], stage: 2, docs: [DEED] },
  { code: "F02", cat: "F", nameAr: "بناء النظام المحاسبي", summary: "دليل حسابات وفق شجرة الحسابات الاسترشادية للهيئة.", outputs: "نظام محاسبي", pricingModel: "fixed", slaDays: 21, dept: "finance", audiences: ["nazir"], stage: 4, docs: [BANK] },
  { code: "F03", cat: "F", nameAr: "مسك الدفاتر", summary: "قيود شهرية منتظمة.", outputs: "دفاتر شهرية", pricingModel: "subscription", dept: "finance", workflow: "subscription", conflictRule: "inside_nazara_only", audiences: ["nazir"], stage: 4 },
  { code: "F04", cat: "F", nameAr: "الموازنة التقديرية", summary: "موازنة سنوية معتمدة (إلزامية للمتوسط والكبير).", outputs: "موازنة", pricingModel: "fixed", slaDays: 10, dept: "finance", audiences: ["nazir", "board"], stage: 4 },
  { code: "F05", cat: "F", nameAr: "البيان المالي السنوي المبسط", summary: "بيان بالواردات والمصروفات للوقف الصغير وذات الانتفاع المباشر.", outputs: "بيان مالي", pricingModel: "fixed", slaDays: 10, dept: "finance", audiences: ["nazir"], stage: 4, docs: [BANK] },
  { code: "F06", cat: "F", nameAr: "المراجعة المالية (تدقيق القوائم)", summary: "قوائم مالية مدققة من مراجع معتمد.", outputs: "قوائم مدققة", pricingModel: "quote", slaDays: 30, dept: "finance", conflictRule: "blocked_if_waqfak_controls_finance",
    restriction: "ممنوعة لوقف تنظره وقفك أو تديره أو تمسك دفاتره، حفاظًا على استقلال المراجعة.", audiences: ["nazir", "board"], stage: 4, docs: [FIN, BANK] },
  { code: "F07", cat: "F", nameAr: "تجهيز البيانات المالية للهيئة", summary: "حزمة جاهزة لخدمة تقديم البيانات المالية لدى الهيئة.", outputs: "حزمة الهيئة", pricingModel: "fixed", slaDays: 7, dept: "finance", restriction: "الرفع بيد الناظر عبر خدمة الهيئة.", audiences: ["nazir"], stage: 4, docs: [FIN] },
  { code: "F08", cat: "F", nameAr: "تقارير الأداء المالي", summary: "تقرير دوري بالأداء المالي.", outputs: "تقرير دوري", pricingModel: "subscription", dept: "finance", workflow: "subscription", audiences: ["nazir", "board", "waqif"], stage: 4 },
  { code: "F09", cat: "F", nameAr: "الفصل المالي وفتح الحساب", summary: "حساب مستقل باسم الوقف ونقل الأموال وتسوية القيود.", outputs: "حساب مستقل وقيود مسوّاة", pricingModel: "fixed", slaDays: 10, dept: "finance", audiences: ["nazir"], stage: 4, docs: [DEED, NAZARA] },

  // ── I الاستثمار
  { code: "I01", cat: "I", nameAr: "سياسة الاستثمار الوقفية", summary: "سياسة بعائد مستهدف وحدود مخاطر وتوزيع على مستوى فئات الأصول.", outputs: "سياسة استثمار", pricingModel: "fixed", slaDays: 14, dept: "investment",
    restriction: "على مستوى السياسات والفئات فقط؛ لا تسمية لأوراق مالية بعينها (وقفك ليست مؤسسة سوق مالية مرخصة).", audiences: ["nazir", "board"], stage: 5 },
  { code: "I02", cat: "I", nameAr: "تحديد العائد المستهدف", summary: "دراسة من ميزانية المصارف ونسبة إعادة الاستثمار.", outputs: "مذكرة العائد المستهدف", pricingModel: "fixed", slaDays: 7, dept: "investment", audiences: ["nazir", "board"], stage: 5 },
  { code: "I03", cat: "I", nameAr: "دراسة جدوى أصل أو فرصة", summary: "دراسة بعناصر دليل قواعد وضوابط الاستثمار.", outputs: "دراسة جدوى", pricingModel: "quote", slaDays: 21, dept: "investment", audiences: ["nazir", "board"], stage: 5 },
  { code: "I04", cat: "I", nameAr: "ملف إذن الاستبدال", summary: "مذكرة الغبطة والتقييمات وطلب الإذن.", outputs: "ملف طلب الإذن", pricingModel: "quote", slaDays: 21, dept: "legal", restriction: "الإذن من اختصاص الجهة المختصة.", audiences: ["nazir", "board"], stage: 5, docs: [OWN] },
  { code: "I05", cat: "I", nameAr: "اختيار مدير مرخص وتقييمه", summary: "مقارنة محايدة ومراجعة اتفاقية الإدارة.", outputs: "تقرير مقارنة", pricingModel: "fixed", slaDays: 14, dept: "investment", restriction: "المدير مرخص من هيئة السوق المالية؛ إفصاح عن أي علاقة، ولا عمولات إحالة.", audiences: ["nazir", "board"], stage: 5 },
  { code: "I06", cat: "I", nameAr: "تسجيل المحفظة الوقفية وقيدها", summary: "حزمة التسجيل والقيد وإدارة المهل (5 أيام عمل).", outputs: "تسجيل وقيد", pricingModel: "fixed", slaDays: 10, dept: "operations", workflow: "registration", audiences: ["nazir"], stage: 5 },
  { code: "I07", cat: "I", nameAr: "متابعة أداء الأصول والاستثمار", summary: "تقرير ربعي بالمؤشرات.", outputs: "تقرير ربعي", pricingModel: "subscription", dept: "investment", workflow: "subscription", audiences: ["nazir", "board"], stage: 5 },
  { code: "I08", cat: "I", nameAr: "سجل الأصول وتقييمها", summary: "سجل أصول إلكتروني وربط بمقيّم معتمد.", outputs: "سجل أصول", pricingModel: "fixed", slaDays: 14, dept: "investment", restriction: "التقييم لمقيّم معتمد.", audiences: ["nazir"], stage: 4, docs: [OWN] },
  { code: "I09", cat: "I", nameAr: "خطة الصيانة والتشغيل العقاري", summary: "خطة صيانة وتوثيق العقود في منصة إيجار.", outputs: "خطة تشغيل", pricingModel: "subscription", dept: "operations", workflow: "subscription", restriction: "إدارة الأملاك للغير قد تتطلب ترخيصًا عقاريًا (بانتظار التحقق).", audiences: ["nazir"], stage: 4 },

  // ── C الامتثال والاستشارات
  { code: "C01", cat: "C", nameAr: "التقييم الوقفي الأساسي", summary: "تقرير تشخيصي آلي على 11 محورًا.", outputs: "تقرير تقييم", pricingModel: "free", dept: "operations", audiences: ["waqif", "nazir", "board"], stage: 4 },
  { code: "C02", cat: "C", nameAr: "التقييم الوقفي المعمّق", summary: "تقييم يراجعه مستشار مع مقابلة ومراجعة الوثائق.", outputs: "تقرير تقييم معمّق", pricingModel: "fixed", slaDays: 10, dept: "governance", audiences: ["waqif", "nazir", "board"], stage: 4, docs: [DEED, NAZARA, CERT, FIN] },
  { code: "C03", cat: "C", nameAr: "تقرير جاهزية الفحص", summary: "محاكاة فحص الهيئة وخطة تصحيح.", outputs: "تقرير جاهزية", pricingModel: "fixed", slaDays: 10, dept: "legal", audiences: ["nazir", "board"], stage: 4 },
  { code: "C04", cat: "C", nameAr: "تصحيح المخالفات", summary: "خطة تصحيحية وتمثيل أمام لجنة المخالفات.", outputs: "خطة تصحيحية", pricingModel: "quote", slaDays: 14, dept: "legal", audiences: ["nazir"], stage: 4 },
  { code: "C05", cat: "C", nameAr: "التقرير السنوي للوقف", summary: "تقرير بالمكونات المطلوبة في مبادئ الحوكمة.", outputs: "تقرير سنوي", pricingModel: "fixed", slaDays: 21, dept: "governance", audiences: ["nazir", "board"], stage: 4 },
  { code: "C06", cat: "C", nameAr: "تقارير المستفيدين", summary: "تقارير دورية وإتاحة القوائم للمستفيدين.", outputs: "تقارير", pricingModel: "subscription", dept: "governance", workflow: "subscription", audiences: ["nazir"], stage: 4 },
  { code: "C07", cat: "C", nameAr: "استشارة شرعية", summary: "رأي شرعي موقّع باسم المستشار وصفته.", outputs: "رأي شرعي موقّع", pricingModel: "hourly", slaDays: 7, dept: "sharia", workflow: "opinion", audiences: ["waqif", "nazir", "board", "beneficiary"], stage: 1 },
  { code: "C08", cat: "C", nameAr: "استشارة قانونية", summary: "رأي قانوني موقّع (بترخيص الاستشارات القانونية).", outputs: "رأي قانوني موقّع", pricingModel: "hourly", slaDays: 7, dept: "legal", workflow: "opinion", audiences: ["waqif", "nazir", "board", "beneficiary"], stage: 1 },
  { code: "C09", cat: "C", nameAr: "استشارة مالية", summary: "رأي مالي متخصص.", outputs: "رأي مالي", pricingModel: "hourly", slaDays: 7, dept: "finance", workflow: "opinion", audiences: ["nazir", "board"], stage: 4 },
  { code: "C10", cat: "C", nameAr: "استشارة استثمارية عامة", summary: "رأي على مستوى السياسات وفئات الأصول.", outputs: "رأي استثماري عام", pricingModel: "hourly", slaDays: 7, dept: "investment", workflow: "opinion", restriction: "لا مشورة في أوراق مالية بعينها.", audiences: ["nazir", "board"], stage: 5 },
  { code: "C11", cat: "C", nameAr: "طلب تفسير شرط الواقف", summary: "مذكرة وطلب إلى الواقف أو الجهة المختصة.", outputs: "مذكرة وطلب تفسير", pricingModel: "fixed", slaDays: 10, dept: "sharia", workflow: "opinion", restriction: "التفسير الملزم من الواقف (حيًا) أو الجهة المختصة.", audiences: ["nazir", "board"], stage: 4, docs: [DEED] },
  { code: "C12", cat: "C", nameAr: "تسوية خلاف بين المستحقين أو النظار", summary: "وساطة أو إحالة إلى خدمة الصلح لدى الهيئة.", outputs: "اتفاق تسوية أو إحالة", pricingModel: "quote", dept: "legal", audiences: ["nazir", "beneficiary", "board"], stage: 4 },
  { code: "C13", cat: "C", nameAr: "التمثيل القضائي في قضايا الأوقاف", summary: "ترافع بترخيص المحاماة.", outputs: "تمثيل", pricingModel: "quote", dept: "legal", audiences: ["nazir", "waqif", "board"], stage: 4 },
];

export const PACKAGES = [
  { code: "free", nameAr: "مجاني", description: "ملف وقف واحد، تقييم أساسي، تقويم الالتزامات، 1 جيجابايت.", audience: "أي وقف", targetSizeClasses: [], services: ["C01"], position: 0 },
  { code: "compliance", nameAr: "امتثال", description: "محرك الامتثال الكامل، البيان المبسط، المستفيد الحقيقي، حزم الهيئة، تقييم معمّق سنوي.", audience: "وقف صغير", targetSizeClasses: ["small", "direct_benefit"], services: ["C01", "C02", "F05", "F07", "G10", "N07"], position: 1 },
  { code: "governance", nameAr: "حوكمة", description: "ما في الامتثال مع أمانة المجلس، الموازنة والقوائم، التقرير السنوي، مستشار مخصص.", audience: "وقف متوسط", targetSizeClasses: ["medium"], services: ["C01", "C02", "F04", "F07", "G10", "N05", "N03", "C05", "G06"], position: 2 },
  { code: "institutional", nameAr: "مؤسسي", description: "ما في الحوكمة مع المراجعة الداخلية، متابعة الاستثمار، بوابة المستفيدين، برنامج مكافحة غسل الأموال.", audience: "وقف كبير أو متعدد الأصول", targetSizeClasses: ["large"], services: ["C01", "C02", "F04", "F07", "G10", "N05", "N03", "C05", "G08", "I07", "C06", "G06"], position: 3 },
  { code: "nazir", nameAr: "ناظر", description: "وقف تنظره وقفك: كل ما يلزم النظارة داخل أجرها، ولا خدمات منفصلة، ومراجع خارجي مستقل.", audience: "وقف تنظره وقفك", targetSizeClasses: [], services: ["N01"], position: 4, isClosed: true },
];
