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
  { code: "T01", cat: "T", nameAr: "جلسة تصميم الوقف", summary: "جلسة متخصصة تخرج منها بمذكرة تصميم متكاملة لوقفك: الأصول، والمصارف، ونوع الوقف، والشكل النظامي، والحوكمة المقترحة.", outputs: "مذكرة تصميم الوقف", pricingModel: "fixed", slaDays: 7, dept: "sharia", restriction: "مخرجات استرشادية.", audiences: ["waqif"], stage: 1 },
  { code: "T02", cat: "T", nameAr: "تحليل الاحتياج المجتمعي لاختيار المصرف", summary: "دراسة تحدد الفجوات الكمية والنوعية في المجال الذي تريد الوقف عليه، لتختار مصرفًا يحقق أثرًا فعليًا.", outputs: "دراسة الاحتياج المجتمعي وتوصيات المصرف", pricingModel: "quote", slaDays: 21, dept: "governance", audiences: ["waqif"], stage: 1 },
  { code: "T03", cat: "T", nameAr: "صياغة وثيقة الوقف", summary: "نصوغ مسودة وثيقة وقفك وفق البنود العشرة التي يقترحها دليل الهيئة، ويراجعها مختص قبل تسليمها إليك. المسودة لا تكون نافذة إلا بعد توثيقها لدى الجهة المختصة.", outputs: "مسودة وثيقة وقف للمراجعة قبل التوثيق، مع مذكرة المراجعة", pricingModel: "fixed", slaDays: 14, dept: "legal", restriction: "التوثيق من اختصاص الجهة المختصة (كتابة العدل أو المحكمة).", audiences: ["waqif"], stage: 2, docs: [OWN] },
  { code: "T04", cat: "T", nameAr: "مراجعة وثيقة وقف قائمة", summary: "مراجعة متخصصة لوثيقة وقفك القائمة، تحدد مواطن الغموض والمخاطر وتقترح الصياغات البديلة.", outputs: "تقرير مراجعة مع بنود التعديل المقترحة", pricingModel: "fixed", slaDays: 10, dept: "legal", restriction: "أي تعديل للشروط يحتاج إذن الجهة المختصة.", audiences: ["waqif", "nazir"], stage: 2, docs: [DEED] },
  { code: "T05", cat: "T", nameAr: "اختيار الأصل الموقوف", summary: "نقارن الأصول المتاحة لك بالمعايير الستة في دليل الهيئة، ونوصي بالأصل الأنسب لغاية وقفك واستدامته.", outputs: "مصفوفة اختيار الأصل وتوصية مسببة", pricingModel: "fixed", slaDays: 10, dept: "investment", audiences: ["waqif"], stage: 1 },
  { code: "T06", cat: "T", nameAr: "تجهيز ملف التوثيق والتسجيل", summary: "نجهّز حزمة التوثيق عبر «ناجز» وحزمة التسجيل لدى الهيئة بترتيب البوابة، ونرافقك حتى صدور شهادة التسجيل، أو ننفذ الإجراءات بوكالة خاصة.", outputs: "حزمة جاهزة للتقديم ومتابعة حتى صدور شهادة التسجيل", pricingModel: "fixed", slaDays: 20, dept: "operations", restriction: "التسجيل لدى الهيئة مجاني؛ الإقرار في البوابة بيد الناظر أو وكيله.", workflow: "registration", audiences: ["waqif", "nazir"], stage: 2, docs: [DEED, NAZARA, OWN] },
  { code: "T07", cat: "T", nameAr: "وقف أصل مالي (أسهم، وحدات، محفظة)", summary: "نعدّ الوثيقة أو الملحق الوقفي ببنوده الثمانية، وخطة نقل الأسهم أو الوحدات إلى حساب الوقف دون صفقات.", outputs: "ملحق وقفي وخطة نقل الأصول", pricingModel: "fixed", slaDays: 14, dept: "investment", restriction: "التنفيذ عبر مؤسسة سوق مالية مرخصة (لائحة المنتجات م24).", audiences: ["waqif"], stage: 2 },
  { code: "T08", cat: "T", nameAr: "ملف ترخيص جمع التبرعات", summary: "نعدّ ملف طلب ترخيص جمع التبرعات كاملًا وفق متطلبات اللائحة، ونتابع مهله حتى صدور الترخيص.", outputs: "ملف طلب الترخيص مكتمل المستندات", pricingModel: "quote", slaDays: 21, dept: "legal", restriction: "المتقدم شخص اعتباري؛ المنصة لا تستقبل التبرعات.", audiences: ["entity", "nazir"], stage: 2 },
  { code: "T09", cat: "T", nameAr: "تأسيس كيان وقفي", summary: "نصمم الهيكل النظامي للكيان الوقفي ونعدّ مستندات تأسيسه شركةً أو مؤسسة وقفية.", outputs: "الهيكل النظامي ومستندات التأسيس", pricingModel: "quote", slaDays: 30, dept: "legal", audiences: ["waqif", "entity"], stage: 3 },

  // ── W الوصايا
  { code: "W01", cat: "W", nameAr: "صياغة وصية شرعية ونظامية", summary: "نصوغ وصيتك في مستند واحد جامع، يشمل الوصية بالوقف إن أردت، وينص صراحة على إلغاء ما سبقه.", outputs: "نص الوصية", pricingModel: "fixed", slaDays: 10, dept: "sharia", restriction: "الوصية فيما زاد على الثلث أو لوارث تُراجع بشريًا وتحتاج إجازة الورثة.", workflow: "opinion", audiences: ["waqif"], stage: 1 },
  { code: "W02", cat: "W", nameAr: "توثيق الوصية", summary: "نجهّز حزمة توثيق الوصية عبر «ناجز»، أو ننفذ التوثيق بوكالة «إثبات وصية».", outputs: "حزمة توثيق الوصية", pricingModel: "fixed", slaDays: 14, dept: "operations", audiences: ["waqif"], stage: 2 },
  { code: "W03", cat: "W", nameAr: "دراسة وصية قائمة وتطويرها", summary: "دراسة متخصصة لوصيتك القائمة، تكشف مواطن الالتباس وتقترح الصياغات التي تحفظ مقصدك.", outputs: "تقرير دراسة مع بنود مقترحة", pricingModel: "fixed", slaDays: 7, dept: "sharia", workflow: "opinion", audiences: ["waqif"], stage: 2 },
  { code: "W04", cat: "W", nameAr: "لائحة مجلس الأوصياء", summary: "لائحة تنظم عمل مجلس الأوصياء: تشكيله، وصلاحياته، وآلية اتخاذ قراراته.", outputs: "لائحة مجلس الأوصياء", pricingModel: "fixed", slaDays: 10, dept: "governance", audiences: ["waqif"], stage: 3 },
  { code: "W05", cat: "W", nameAr: "تنفيذ وصية بوقف بعد الوفاة", summary: "نرافق الورثة والناظر في تنفيذ الوصية بالوقف: حصر ما يدخل فيها، وإثبات الوقف، ونقل الأصول، حتى التسجيل لدى الهيئة.", outputs: "وقف موثّق ومسجّل", pricingModel: "quote", slaDays: 45, dept: "legal", audiences: ["waqif", "nazir"], stage: 2 },

  // ── N النظارة
  { code: "N01", cat: "N", nameAr: "تولي النظارة (ناظر اعتباري)", summary: "تتولى «وقفك» نظارة وقفك بصفتها ناظرًا اعتباريًا: تستلم الوقف ومستنداته، وتنفذ شرط الواقف، وتدير أصوله وماليته ومستفيديه، وتفي بالتزامات الناظر النظامية بمواعيدها.", outputs: "محضر استلام الوقف، وتشغيل النظارة وفق شرط الواقف، وتقرير نظارة دوري معتمد، ومحضر تسليم عند انتهاء النظارة", pricingModel: "percentage", dept: "operations", license: "gaa_nazara_license", workflow: "subscription",
    restriction: "يُستقبل الطلب ويُدرس ملف الوقف الآن؛ ومباشرة النظارة بقرار تعيين من الجهة المختصة وبعد اعتماد ترخيص الهيئة للناظر الاعتباري (لائحة النظارة م4 وم5/2). والأجر بالشرط أو بقرار الجهة المختصة (م11/1).", audiences: ["waqif", "nazir", "board"], stage: 4, docs: [DEED, CERT, OWN, FIN, BANK] },
  { code: "N02", cat: "N", nameAr: "عضوية مستقلة في مجلس النظارة", summary: "عضو مستقل من «وقفك» في مجلس نظارة الوقف، يعزز موضوعية القرار وجودة الرقابة.", outputs: "مقعد مستقل في مجلس النظارة", pricingModel: "subscription", dept: "governance", workflow: "subscription", audiences: ["board"], stage: 3 },
  { code: "N03", cat: "N", nameAr: "مساندة الناظر (استشارية)", summary: "مستشار مخصص يرافق الناظر في قراراته والتزاماته، مع مراجعة دورية لوضع الوقف، ويبقى القرار للناظر.", outputs: "مساندة استشارية مستمرة وتقارير دورية", pricingModel: "subscription", dept: "governance", workflow: "subscription", audiences: ["nazir"], stage: 4 },
  { code: "N04", cat: "N", nameAr: "إدارة مفوّضة للوقف", summary: "إدارة الحفظ والتأجير والتنمية والإصلاح بتفويض مكتوب من الناظر، وفق شرط الواقف.", outputs: "إدارة تشغيلية مستمرة وتقارير للناظر", pricingModel: "subscription", dept: "operations", workflow: "subscription",
    restriction: "يُشترط في المفوَّض ما يُشترط في الناظر، والمسؤولية تضامنية (لائحة النظارة م11/4).", audiences: ["nazir"], stage: 4 },
  { code: "N05", cat: "N", nameAr: "أمانة مجلس النظارة", summary: "نتولى أمانة مجلس النظارة: جداول الأعمال، والدعوات، والمحاضر، ومتابعة تنفيذ القرارات.", outputs: "أمانة مجلس مستمرة ومحاضر معتمدة", pricingModel: "subscription", dept: "governance", workflow: "subscription", audiences: ["board"], stage: 3 },
  { code: "N06", cat: "N", nameAr: "تنسيق أعمال الوقف", summary: "تنسيق الأعمال اليومية للوقف ومتابعة إنجازها مع الأطراف المعنية.", outputs: "تشغيل يومي منتظم وتقارير متابعة", pricingModel: "subscription", dept: "operations", workflow: "subscription", audiences: ["nazir"], stage: 4 },
  { code: "N07", cat: "N", nameAr: "إدارة سجل المستفيدين والصرف", summary: "سجل مستفيدين محدّث، وكشوف صرف بأرقام مرجعية، وإثبات وصول كل دفعة من حساب الوقف.", outputs: "سجل المستفيدين وكشوف الصرف", pricingModel: "subscription", dept: "finance", restriction: "الصرف من حساب الوقف فقط.", workflow: "subscription", audiences: ["nazir"], stage: 4 },
  { code: "N08", cat: "N", nameAr: "تسليم واستلام النظارة", summary: "نعدّ محضر التسليم وجرد الأصول والمستندات، ونحدّث شهادة التسجيل لدى الهيئة في مهلتها.", outputs: "محضر تسليم موقّع وحزمة الوثائق", pricingModel: "fixed", slaDays: 7, dept: "legal", restriction: "التسليم فوري (معايير المستفيد الحقيقي م7/4).", audiences: ["nazir", "board"], stage: 4 },
  { code: "N09", cat: "N", nameAr: "إحياء وقف معطل أو مجهول", summary: "خطة لإحياء الوقف المعطل، وملف إثبات متكامل، وإعداد البلاغ لتقديمه عبر قناة الهيئة.", outputs: "خطة الإحياء وملف الإثبات", pricingModel: "quote", dept: "legal", restriction: "البلاغ عن وقف مجهول عبر موقع الهيئة فقط.", audiences: ["nazir", "waqif"], stage: 4 },

  // ── G الحوكمة
  { code: "G01", cat: "G", nameAr: "حزمة الحوكمة حسب الحجم", summary: "حزمة الحوكمة المناسبة لحجم وقفك: اللوائح والسياسات الاثنتا عشرة ومصفوفة الصلاحيات، جاهزة للاعتماد.", outputs: "حزمة لوائح وسياسات جاهزة للاعتماد", pricingModel: "fixed", slaDays: 30, dept: "governance", audiences: ["nazir", "board"], stage: 3 },
  { code: "G02", cat: "G", nameAr: "النظام الأساسي للوقف", summary: "نظام أساسي يحدد كيان الوقف ومقره وموارده ومجلسه وآليات الرقابة عليه.", outputs: "النظام الأساسي للوقف", pricingModel: "fixed", slaDays: 14, dept: "governance", audiences: ["nazir", "board"], stage: 3 },
  { code: "G03", cat: "G", nameAr: "تشكيل مجلس النظارة ولجانه", summary: "ميثاق مجلس النظارة ومواثيق لجانه ومعايير استقلال الأعضاء.", outputs: "مواثيق المجلس واللجان", pricingModel: "fixed", slaDays: 14, dept: "governance", audiences: ["board", "nazir"], stage: 3 },
  { code: "G04", cat: "G", nameAr: "الخطة الاستراتيجية والتشغيلية", summary: "خطة استراتيجية وتشغيلية للوقف بأهداف واضحة ومؤشرات أداء قابلة للقياس.", outputs: "الخطة الاستراتيجية والتشغيلية ومؤشرات الأداء", pricingModel: "quote", slaDays: 30, dept: "governance", audiences: ["board", "nazir"], stage: 3 },
  { code: "G05", cat: "G", nameAr: "الدليل الإجرائي للمصارف", summary: "دليل إجرائي للصرف على المصارف، بمعايير توزيع ومفاضلة عادلة ومعلنة.", outputs: "الدليل الإجرائي للمصارف", pricingModel: "fixed", slaDays: 14, dept: "governance", audiences: ["nazir", "board"], stage: 3 },
  { code: "G06", cat: "G", nameAr: "سياسة تعارض المصالح وسجل الإفصاح", summary: "سياسة تعارض المصالح ونماذج الإقرار السنوي وسجل الإفصاح.", outputs: "سياسة ونماذج إفصاح جاهزة", pricingModel: "fixed", slaDays: 7, dept: "governance", audiences: ["nazir", "board"], stage: 3 },
  { code: "G07", cat: "G", nameAr: "سياسة الاستخلاف في النظارة", summary: "سياسة استخلاف تضمن انتقال النظارة دون شغور أو تعطل.", outputs: "سياسة الاستخلاف في النظارة", pricingModel: "fixed", slaDays: 7, dept: "governance", audiences: ["waqif", "nazir", "board"], stage: 3 },
  { code: "G08", cat: "G", nameAr: "المراجعة الداخلية", summary: "مراجعة داخلية مستقلة للضوابط الرقابية والسجلات، مع توصيات معالجة مرتبة بالأولوية.", outputs: "تقرير المراجعة الداخلية", pricingModel: "quote", slaDays: 21, dept: "finance", conflictRule: "blocked_if_waqfak_controls_finance", audiences: ["board"], stage: 4 },
  { code: "G09", cat: "G", nameAr: "تقييم أداء المجلس والناظر", summary: "تقييم سنوي مستقل لفاعلية مجلس النظارة والناظر ومساهمة كل عضو.", outputs: "تقرير تقييم الأداء", pricingModel: "fixed", slaDays: 14, dept: "governance", conflictRule: "blocked_if_waqfak_nazir", audiences: ["board", "waqif"], stage: 4 },
  { code: "G10", cat: "G", nameAr: "برنامج مكافحة غسل الأموال والمستفيد الحقيقي", summary: "برنامج امتثال متكامل: سياسة مكافحة غسل الأموال، وسجل المستفيد الحقيقي، وتقييم المخاطر.", outputs: "برنامج امتثال وسجل المستفيد الحقيقي", pricingModel: "fixed", slaDays: 14, dept: "legal", audiences: ["nazir", "board"], stage: 4 },

  // ── F المالية
  { code: "F01", cat: "F", nameAr: "التحليل المالي لشرط الواقف", summary: "نحلل شرط الواقف ماليًا ونحدد نسب الصيانة والتنمية والاحتياطي والمصارف.", outputs: "مذكرة التحليل المالي للشرط", pricingModel: "fixed", slaDays: 7, dept: "finance", audiences: ["waqif", "nazir"], stage: 2, docs: [DEED] },
  { code: "F02", cat: "F", nameAr: "بناء النظام المحاسبي", summary: "نبني النظام المحاسبي للوقف ودليل حساباته وفق شجرة الحسابات الاسترشادية للهيئة.", outputs: "النظام المحاسبي ودليل الحسابات", pricingModel: "fixed", slaDays: 21, dept: "finance", audiences: ["nazir"], stage: 4, docs: [BANK] },
  { code: "F03", cat: "F", nameAr: "مسك الدفاتر", summary: "مسك منتظم لدفاتر الوقف بقيود شهرية.", outputs: "دفاتر محاسبية شهرية", pricingModel: "subscription", dept: "finance", workflow: "subscription", conflictRule: "inside_nazara_only", audiences: ["nazir"], stage: 4 },
  { code: "F04", cat: "F", nameAr: "الموازنة التقديرية", summary: "موازنة تقديرية سنوية جاهزة للاعتماد، وهي متطلب نظامي للأوقاف الكبيرة والمتوسطة.", outputs: "الموازنة التقديرية السنوية", pricingModel: "fixed", slaDays: 10, dept: "finance", audiences: ["nazir", "board"], stage: 4 },
  { code: "F05", cat: "F", nameAr: "البيان المالي السنوي المبسط", summary: "بيان مالي سنوي بالواردات والمصروفات للوقف الصغير والوقف ذي الانتفاع المباشر.", outputs: "البيان المالي السنوي", pricingModel: "fixed", slaDays: 10, dept: "finance", audiences: ["nazir"], stage: 4, docs: [BANK] },
  { code: "F06", cat: "F", nameAr: "المراجعة المالية (تدقيق القوائم)", summary: "تدقيق القوائم المالية للوقف وإصدار تقرير المراجع المستقل.", outputs: "قوائم مالية مدققة وتقرير المراجع المستقل", pricingModel: "quote", slaDays: 30, dept: "finance", conflictRule: "blocked_if_waqfak_controls_finance",
    restriction: "ممنوعة لوقف تنظره وقفك أو تديره أو تمسك دفاتره، حفاظًا على استقلال المراجعة.", audiences: ["nazir", "board"], stage: 4, docs: [FIN, BANK] },
  { code: "F07", cat: "F", nameAr: "تجهيز البيانات المالية للهيئة", summary: "حزمة البيانات المالية جاهزة للرفع عبر خدمة الهيئة.", outputs: "حزمة البيانات المالية للهيئة", pricingModel: "fixed", slaDays: 7, dept: "finance", restriction: "الرفع بيد الناظر عبر خدمة الهيئة.", audiences: ["nazir"], stage: 4, docs: [FIN] },
  { code: "F08", cat: "F", nameAr: "تقارير الأداء المالي", summary: "تقرير دوري يعرض الأداء المالي للوقف ومؤشراته.", outputs: "تقرير الأداء المالي الدوري", pricingModel: "subscription", dept: "finance", workflow: "subscription", audiences: ["nazir", "board", "waqif"], stage: 4 },
  { code: "F09", cat: "F", nameAr: "الفصل المالي وفتح الحساب", summary: "نفتح حسابًا مستقلًا باسم الوقف، وننقل أمواله إليه، ونسوّي القيود السابقة.", outputs: "حساب مستقل باسم الوقف وقيود مسوّاة", pricingModel: "fixed", slaDays: 10, dept: "finance", audiences: ["nazir"], stage: 4, docs: [DEED, NAZARA] },

  // ── I الاستثمار
  { code: "I01", cat: "I", nameAr: "سياسة الاستثمار الوقفية", summary: "سياسة استثمار بعائد مستهدف وحدود مخاطر وتوزيع على فئات الأصول، تُبنى على شرط الواقف واحتياجات المصارف.", outputs: "سياسة الاستثمار الوقفية", pricingModel: "fixed", slaDays: 14, dept: "investment",
    restriction: "على مستوى السياسات والفئات فقط؛ لا تسمية لأوراق مالية بعينها (وقفك ليست مؤسسة سوق مالية مرخصة).", audiences: ["nazir", "board"], stage: 5 },
  { code: "I02", cat: "I", nameAr: "تحديد العائد المستهدف", summary: "نحدد العائد السنوي المستهدف انطلاقًا من ميزانية المصارف ونسبة إعادة الاستثمار.", outputs: "مذكرة العائد المستهدف", pricingModel: "fixed", slaDays: 7, dept: "investment", audiences: ["nazir", "board"], stage: 5 },
  { code: "I03", cat: "I", nameAr: "دراسة جدوى أصل أو فرصة", summary: "دراسة جدوى لأصل أو فرصة استثمارية بعناصر دليل قواعد وضوابط الاستثمار.", outputs: "دراسة جدوى", pricingModel: "quote", slaDays: 21, dept: "investment", audiences: ["nazir", "board"], stage: 5 },
  { code: "I04", cat: "I", nameAr: "ملف إذن الاستبدال", summary: "نعدّ ملف طلب إذن الاستبدال: مذكرة الغبطة والمصلحة، والتقييمات، وصيغة الطلب.", outputs: "ملف طلب إذن الاستبدال", pricingModel: "quote", slaDays: 21, dept: "legal", restriction: "الإذن من اختصاص الجهة المختصة.", audiences: ["nazir", "board"], stage: 5, docs: [OWN] },
  { code: "I05", cat: "I", nameAr: "اختيار مدير مرخص وتقييمه", summary: "مقارنة محايدة بين مديري الاستثمار المرخصين، ومراجعة اتفاقية الإدارة قبل توقيعها.", outputs: "تقرير مقارنة وملاحظات على اتفاقية الإدارة", pricingModel: "fixed", slaDays: 14, dept: "investment", restriction: "المدير مرخص من هيئة السوق المالية؛ إفصاح عن أي علاقة، ولا عمولات إحالة.", audiences: ["nazir", "board"], stage: 5 },
  { code: "I06", cat: "I", nameAr: "تسجيل المحفظة الوقفية وقيدها", summary: "نجهّز حزمة تسجيل المحفظة الوقفية وقيدها، ونتابع مهلها النظامية (5 أيام عمل لكل مرحلة).", outputs: "تسجيل المحفظة وقيدها لدى الهيئة", pricingModel: "fixed", slaDays: 10, dept: "operations", workflow: "registration", audiences: ["nazir"], stage: 5 },
  { code: "I07", cat: "I", nameAr: "متابعة أداء الأصول والاستثمار", summary: "تقرير ربعي بمؤشرات أداء الأصول والاستثمارات مقارنة بالسياسة المعتمدة.", outputs: "تقرير أداء ربعي", pricingModel: "subscription", dept: "investment", workflow: "subscription", audiences: ["nazir", "board"], stage: 5 },
  { code: "I08", cat: "I", nameAr: "سجل الأصول وتقييمها", summary: "سجل أصول إلكتروني محدّث، مع ترتيب التقييم لدى مقيّم معتمد.", outputs: "سجل الأصول وتقييمها", pricingModel: "fixed", slaDays: 14, dept: "investment", restriction: "التقييم لمقيّم معتمد.", audiences: ["nazir"], stage: 4, docs: [OWN] },
  { code: "I09", cat: "I", nameAr: "خطة الصيانة والتشغيل العقاري", summary: "خطة صيانة وتشغيل للعقارات الموقوفة، مع توثيق العقود في منصة «إيجار».", outputs: "خطة الصيانة والتشغيل", pricingModel: "subscription", dept: "operations", workflow: "subscription", restriction: "إدارة الأملاك للغير قد تتطلب ترخيصًا عقاريًا (بانتظار التحقق).", audiences: ["nazir"], stage: 4 },

  // ── C الامتثال والاستشارات
  { code: "C01", cat: "C", nameAr: "التقييم الوقفي الأساسي", summary: "تقييم مجاني لوقفك على 11 محورًا، يحدد مستوى جاهزيته وأولويات العمل.", outputs: "تقرير تقييم تشخيصي فوري", pricingModel: "free", dept: "operations", audiences: ["waqif", "nazir", "board"], stage: 4 },
  { code: "C02", cat: "C", nameAr: "التقييم الوقفي المعمّق", summary: "تقييم شامل يقوده مستشار، يتضمن مقابلة ومراجعة وثائق الوقف، وينتهي بخطة عمل مرتبة بالأولوية.", outputs: "تقرير تقييم معمّق وخطة عمل", pricingModel: "fixed", slaDays: 10, dept: "governance", audiences: ["waqif", "nazir", "board"], stage: 4, docs: [DEED, NAZARA, CERT, FIN] },
  { code: "C03", cat: "C", nameAr: "تقرير جاهزية الفحص", summary: "محاكاة لفحص الهيئة على ملفات وقفك، مع خطة تصحيح محددة المسؤوليات والمواعيد.", outputs: "تقرير جاهزية وخطة تصحيح", pricingModel: "fixed", slaDays: 10, dept: "legal", audiences: ["nazir", "board"], stage: 4 },
  { code: "C04", cat: "C", nameAr: "تصحيح المخالفات", summary: "خطة تصحيحية لمعالجة المخالفات وآثارها، وتمثيلك أمام لجنة النظر في المخالفات.", outputs: "خطة تصحيحية وتمثيل أمام اللجنة", pricingModel: "quote", slaDays: 14, dept: "legal", audiences: ["nazir"], stage: 4 },
  { code: "C05", cat: "C", nameAr: "التقرير السنوي للوقف", summary: "تقرير سنوي للوقف بالمكونات التي توصي بها مبادئ حوكمة الأوقاف.", outputs: "التقرير السنوي للوقف", pricingModel: "fixed", slaDays: 21, dept: "governance", audiences: ["nazir", "board"], stage: 4 },
  { code: "C06", cat: "C", nameAr: "تقارير المستفيدين", summary: "تقارير دورية للمستفيدين وإتاحة القوائم المالية لهم، وفاءً بحقهم في الاطلاع.", outputs: "تقارير المستفيدين الدورية", pricingModel: "subscription", dept: "governance", workflow: "subscription", audiences: ["nazir"], stage: 4 },
  { code: "C07", cat: "C", nameAr: "استشارة شرعية", summary: "رأي شرعي مكتوب في مسألتك، موقّع باسم المستشار الشرعي وصفته.", outputs: "رأي شرعي موقّع", pricingModel: "hourly", slaDays: 7, dept: "sharia", workflow: "opinion", audiences: ["waqif", "nazir", "board", "beneficiary"], stage: 1 },
  { code: "C08", cat: "C", nameAr: "استشارة قانونية", summary: "رأي قانوني مكتوب في مسألتك، موقّع باسم المستشار القانوني وصفته، بموجب ترخيص الاستشارات القانونية.", outputs: "رأي قانوني موقّع", pricingModel: "hourly", slaDays: 7, dept: "legal", workflow: "opinion", audiences: ["waqif", "nazir", "board", "beneficiary"], stage: 1 },
  { code: "C09", cat: "C", nameAr: "استشارة مالية", summary: "رأي مالي متخصص في مسألتك، يصدره مستشار مالي.", outputs: "رأي مالي مكتوب", pricingModel: "hourly", slaDays: 7, dept: "finance", workflow: "opinion", audiences: ["nazir", "board"], stage: 4 },
  { code: "C10", cat: "C", nameAr: "استشارة استثمارية عامة", summary: "رأي استثماري على مستوى السياسات وفئات الأصول، يساعد الناظر على قرار مدروس.", outputs: "رأي استثماري مكتوب", pricingModel: "hourly", slaDays: 7, dept: "investment", workflow: "opinion", restriction: "لا مشورة في أوراق مالية بعينها.", audiences: ["nazir", "board"], stage: 5 },
  { code: "C11", cat: "C", nameAr: "طلب تفسير شرط الواقف", summary: "مذكرة تحلل الشرط الغامض، وطلب تفسير معدّ لتقديمه إلى الواقف أو الجهة المختصة.", outputs: "مذكرة تحليل وطلب تفسير", pricingModel: "fixed", slaDays: 10, dept: "sharia", workflow: "opinion", restriction: "التفسير الملزم من الواقف (حيًا) أو الجهة المختصة.", audiences: ["nazir", "board"], stage: 4, docs: [DEED] },
  { code: "C12", cat: "C", nameAr: "تسوية خلاف بين المستحقين أو النظار", summary: "وساطة متخصصة لتسوية الخلاف بين المستحقين أو النظار، أو إحالة إلى خدمة الصلح لدى الهيئة.", outputs: "اتفاق تسوية أو ملف إحالة", pricingModel: "quote", dept: "legal", audiences: ["nazir", "beneficiary", "board"], stage: 4 },
  { code: "C13", cat: "C", nameAr: "التمثيل القضائي في قضايا الأوقاف", summary: "تمثيل الوقف أو أطرافه أمام الجهات القضائية في قضايا الأوقاف.", outputs: "تمثيل قضائي ومذكرات", pricingModel: "quote", dept: "legal", audiences: ["nazir", "waqif", "board"], stage: 4 },
];

export const PACKAGES = [
  { code: "free", nameAr: "مجاني", description: "ملف وقف واحد، تقييم أساسي، تقويم الالتزامات، 1 جيجابايت.", audience: "أي وقف", targetSizeClasses: [], services: ["C01"], position: 0 },
  { code: "compliance", nameAr: "امتثال", description: "محرك الامتثال الكامل، البيان المبسط، المستفيد الحقيقي، حزم الهيئة، تقييم معمّق سنوي.", audience: "وقف صغير", targetSizeClasses: ["small", "direct_benefit"], services: ["C01", "C02", "F05", "F07", "G10", "N07"], position: 1 },
  { code: "governance", nameAr: "حوكمة", description: "ما في الامتثال مع أمانة المجلس، الموازنة والقوائم، التقرير السنوي، مستشار مخصص.", audience: "وقف متوسط", targetSizeClasses: ["medium"], services: ["C01", "C02", "F04", "F07", "G10", "N05", "N03", "C05", "G06"], position: 2 },
  { code: "institutional", nameAr: "مؤسسي", description: "ما في الحوكمة مع المراجعة الداخلية، متابعة الاستثمار، بوابة المستفيدين، برنامج مكافحة غسل الأموال.", audience: "وقف كبير أو متعدد الأصول", targetSizeClasses: ["large"], services: ["C01", "C02", "F04", "F07", "G10", "N05", "N03", "C05", "G08", "I07", "C06", "G06"], position: 3 },
  { code: "nazir", nameAr: "ناظر", description: "وقف تنظره وقفك: كل ما يلزم النظارة داخل أجرها، ولا خدمات منفصلة، ومراجع خارجي مستقل.", audience: "وقف تنظره وقفك", targetSizeClasses: [], services: ["N01"], position: 4, isClosed: true },
];
