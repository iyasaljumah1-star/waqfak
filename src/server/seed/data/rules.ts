/**
 * Recommendation rules v1 (data — editable and versioned from Admin → محرك التوصيات).
 * Conditions are JSON-logic over assessment facts:
 *   <factKey>       raw answer value (e.g. has_bank_account = "no")
 *   score_<code>    0..5 score of a question (unknown = 0)
 *   axis_<A1..A11>  axis score 0..100
 *   flag_<R01..>    critical flag raised
 *   size_class, computed_type, nazir_kind, waqf_state, waqfak_role
 */
const v = (k: string) => ({ var: k });
const eq = (k: string, val: unknown) => ({ "==": [v(k), val] });
const isIn = (k: string, vals: unknown[]) => ({ in: [v(k), vals] });
const lte = (k: string, n: number) => ({ and: [{ "!=": [v(k), null] }, { "<=": [v(k), n] }] });
const all = (...r: unknown[]) => ({ and: r });
const any = (...r: unknown[]) => ({ or: r });
const flag = (c: string) => v(`flag_${c}`);
const sizeIn = (...s: string[]) => isIn("size_class", s);
const waqfakIsNazir = { in: [v("waqfak_role"), ["nazir"]] };

export const NEEDS: { code: string; groupCode: string; titleAr: string }[] = [
  ["NEED.FIN.SEPARATE_ACCOUNT", "FIN", "فتح حساب بنكي مستقل باسم الوقف"],
  ["NEED.FIN.SEGREGATION", "FIN", "فصل أموال الوقف وتسوية القيود"],
  ["NEED.FIN.AUDITED_STATEMENTS", "FIN", "قوائم مالية مدققة من مراجع مستقل"],
  ["NEED.FIN.SIMPLE_STATEMENT", "FIN", "بيان مالي سنوي مبسط"],
  ["NEED.FIN.BUDGET", "FIN", "موازنة تقديرية معتمدة"],
  ["NEED.FIN.DISTRIBUTION_SCHEDULE", "FIN", "جدولة صرف العوائد وتوثيقه"],
  ["NEED.FIN.BOOKKEEPING", "FIN", "تنظيم القيود والسجلات المالية"],
  ["NEED.FIN.ALLOCATION_POLICY", "FIN", "سياسة توزيع الريع (صيانة، احتياطي، تنمية)"],
  ["NEED.FIN.GAA_FINANCIAL_PACKAGE", "FIN", "تجهيز البيانات المالية للهيئة"],
  ["NEED.REG.REGISTRATION", "REG", "تسجيل الوقف لدى الهيئة"],
  ["NEED.REG.RENEWAL", "REG", "تجديد شهادة التسجيل أو تحديث البيانات"],
  ["NEED.REG.DOCUMENTATION", "REG", "توثيق الوقف أو إثباته"],
  ["NEED.REG.NAZIR_IN_DEED", "REG", "ضبط النظارة في الوثيقة"],
  ["NEED.REG.DISPOSAL_REMEDY", "REG", "تصحيح تصرف في أصل دون إذن"],
  ["NEED.REG.NAZARA_DEED", "REG", "استخراج صك نظارة"],
  ["NEED.SHR.DEED_AMENDMENT", "SHR", "تعديل الوثيقة: المصرف البديل والمآل"],
  ["NEED.SHR.INTERPRETATION", "SHR", "تفسير الشرط عبر الجهة المختصة"],
  ["NEED.SHR.VOID_CONDITION_REVIEW", "SHR", "مراجعة شرعية لشرط محتمل البطلان"],
  ["NEED.SHR.DEFINITIONS", "SHR", "تعريف الألفاظ المجملة"],
  ["NEED.SHR.MASRAF_CORRECTION", "SHR", "تصحيح الصرف وفق شرط الواقف"],
  ["NEED.NAZ.SUCCESSION", "NAZ", "سياسة استخلاف تمنع شغور النظارة"],
  ["NEED.NAZ.ELIGIBILITY", "NAZ", "تصحيح أهلية الناظر"],
  ["NEED.NAZ.LICENSE", "NAZ", "ترخيص الناظر الاعتباري"],
  ["NEED.NAZ.RESIDENCY", "NAZ", "نظارة أو إدارة مقيمة في المملكة"],
  ["NEED.NAZ.SUPPORT", "NAZ", "مساندة الناظر الفرد"],
  ["NEED.NAZ.APPOINTMENT_TERMS", "NAZ", "تحديد صلاحيات الناظر وأتعابه ومسؤولياته"],
  ["NEED.NAZ.VACANT", "NAZ", "نظارة لوقف شاغر"],
  ["NEED.GOV.CONFLICT_POLICY", "GOV", "سياسة تعارض المصالح وإقرارات سنوية"],
  ["NEED.GOV.RELATED_PARTY", "GOV", "معالجة تعاقد مع أطراف ذات علاقة"],
  ["NEED.GOV.POLICY_PACKAGE", "GOV", "حزمة اللوائح والسياسات حسب الحجم"],
  ["NEED.GOV.BOARD_CHARTER", "GOV", "ميثاق المجلس وأمانة السر"],
  ["NEED.GOV.AUTHORITY_MATRIX", "GOV", "مصفوفة الصلاحيات"],
  ["NEED.GOV.INDEPENDENCE", "GOV", "أعضاء مستقلون ولجان"],
  ["NEED.GOV.PERFORMANCE", "GOV", "تقييم أداء الناظر والمجلس"],
  ["NEED.INV.POLICY", "INV", "سياسة استثمار وقفية"],
  ["NEED.INV.DIVERSIFICATION", "INV", "دراسة تنويع الأصول"],
  ["NEED.INV.LICENSED_MANAGER", "INV", "مدير استثمار مرخص"],
  ["NEED.INV.PORTFOLIO_REGISTRATION", "INV", "تسجيل المحفظة الوقفية وقيدها"],
  ["NEED.INV.LEVERAGE", "INV", "معالجة اقتراض غير مأذون"],
  ["NEED.INV.PERFORMANCE", "INV", "متابعة أداء الاستثمار"],
  ["NEED.AST.TITLE", "AST", "إفراغ الأصول وتسجيلها باسم الوقف"],
  ["NEED.AST.IDLE", "AST", "دراسة جدوى للأصول المعطلة أو استبدالها"],
  ["NEED.AST.VALUATION", "AST", "تقييم الأصول من مقيّم معتمد"],
  ["NEED.AST.EJAR", "AST", "توثيق العقود وتشغيل العقارات"],
  ["NEED.AST.MAINTENANCE", "AST", "خطة صيانة واحتياطي"],
  ["NEED.AST.ENCUMBRANCE", "AST", "معالجة قيود أو نزاعات على الأصول"],
  ["NEED.DOC.CORE_DOCS", "DOC", "استكمال الوثائق الأساسية"],
  ["NEED.DOC.RETENTION", "DOC", "أرشفة آمنة لعشر سنوات"],
  ["NEED.DOC.REGISTERS", "DOC", "سجل القرارات والعقود والدعاوى"],
  ["NEED.BEN.REGISTER", "BEN", "سجل المستفيدين"],
  ["NEED.BEN.CHANNEL", "BEN", "قناة شكاوى واطلاع للمستفيدين"],
  ["NEED.BEN.REPORTING", "BEN", "تقارير المستفيدين والتقرير السنوي"],
  ["NEED.RSK.BENEFICIAL_OWNER", "RSK", "امتثال المستفيد الحقيقي"],
  ["NEED.RSK.RISK_REGISTER", "RSK", "سجل المخاطر"],
  ["NEED.RSK.GAA_REMEDIATION", "RSK", "خطة تصحيحية لملاحظات الهيئة"],
  ["NEED.RSK.DONATIONS_LICENSE", "RSK", "إيقاف الجمع وترخيصه"],
  ["NEED.RSK.FOREIGN_TRANSFERS", "RSK", "آلية الحوالات الخارجية"],
  ["NEED.RSK.AML_TRAINING", "RSK", "تدريب مكافحة غسل الأموال"],
  ["NEED.DGT.DIGITIZE", "DGT", "رقمنة السجلات والمحاسبة"],
  ["NEED.EST.ESTABLISH", "EST", "تأسيس الوقف وصياغة وثيقته"],
  ["NEED.EST.BEQUEST", "EST", "صياغة الوصية بالوقف"],
  ["NEED.LEG.LITIGATION", "LEG", "خدمة قانونية للنزاع القائم"],
].map(([code, groupCode, titleAr]) => ({ code, groupCode, titleAr }));

type R = {
  code: string; titleAr: string; condition: unknown; needCode: string;
  severity: "critical" | "high" | "medium" | "low"; urgencyDays: number; leverage?: number;
  reasonAr: string; whyItMattersAr?: string; reference?: string; serviceCodes: string[]; suppressIf?: unknown; selfServiceHintAr?: string;
};

export const RULES: R[] = [
  // ── FIN
  { code: "R-FIN-001", titleAr: "حساب بنكي مستقل باسم الوقف", condition: isIn("has_bank_account", ["no", "unknown"]), needCode: "NEED.FIN.SEPARATE_ACCOUNT", severity: "critical", urgencyDays: 7,
    reasonAr: "لا يوجد حساب بنكي مستقل باسم الوقف، أو لا تعرف إن كان موجودًا.", whyItMattersAr: "الامتناع عن فتح حساب للوقف من أسباب العزل.", reference: "لائحة تنظيم أعمال النظارة م15/1؛ جدول المخالفات 5-2", serviceCodes: ["F09"],
    selfServiceHintAr: "يمكنك فتح الحساب بنفسك لدى أي بنك بصك الوقفية وصك النظارة وشهادة التسجيل.", suppressIf: waqfakIsNazir },
  { code: "R-FIN-002", titleAr: "فصل أموال الوقف", condition: eq("funds_separated", "no"), needCode: "NEED.FIN.SEGREGATION", severity: "critical", urgencyDays: 14,
    reasonAr: "أموال الوقف تختلط بأموال أخرى.", whyItMattersAr: "خلط الأموال من أسباب العزل.", reference: "لائحة تنظيم أعمال النظارة م15/1؛ جدول المخالفات 6-1", serviceCodes: ["F09", "F02"] },
  { code: "R-FIN-003", titleAr: "قوائم مالية مدققة", condition: all(sizeIn("medium", "large"), isIn("has_audited_statements", ["no", "unknown"])), needCode: "NEED.FIN.AUDITED_STATEMENTS", severity: "critical", urgencyDays: 60,
    reasonAr: "الوقف متوسط أو كبير ولا توجد قوائم مالية مدققة لآخر سنة.", whyItMattersAr: "القوائم المدققة من مراجع معتمد إلزامية لهذه الفئة.", reference: "لائحة تنظيم أعمال النظارة م15/4؛ جدول المخالفات 6-5", serviceCodes: ["F02", "F06"] },
  { code: "R-FIN-004", titleAr: "بيان مالي سنوي", condition: all(sizeIn("small", "direct_benefit"), isIn("has_simple_statement", ["no", "unknown"])), needCode: "NEED.FIN.SIMPLE_STATEMENT", severity: "high", urgencyDays: 60,
    reasonAr: "لا يوجد بيان مالي سنوي بالواردات والمصروفات.", reference: "لائحة تنظيم أعمال النظارة م15/5؛ جدول المخالفات 6-6", serviceCodes: ["F05"], selfServiceHintAr: "استخدم قالب البيان المبسط في المكتبة.", suppressIf: waqfakIsNazir },
  { code: "R-FIN-005", titleAr: "موازنة تقديرية", condition: all(sizeIn("medium", "large"), isIn("has_budget", ["no", "unknown"])), needCode: "NEED.FIN.BUDGET", severity: "high", urgencyDays: 90,
    reasonAr: "لا توجد موازنة تقديرية معتمدة للسنة الحالية.", reference: "لائحة تنظيم أعمال النظارة م15/4؛ جدول المخالفات 6-4", serviceCodes: ["F04"], suppressIf: waqfakIsNazir },
  { code: "R-FIN-006", titleAr: "جدولة صرف العوائد", condition: eq("distribution_on_time", "no"), needCode: "NEED.FIN.DISTRIBUTION_SCHEDULE", severity: "critical", urgencyDays: 14,
    reasonAr: "لم تُصرف عوائد آخر سنة في موعدها.", whyItMattersAr: "الامتناع عن الصرف أو تأخيره قد يصل إلى العزل بعد الإشعار.", reference: "لائحة تنظيم أعمال النظارة م13/1؛ جدول المخالفات 4-1 و4-4", serviceCodes: ["N07"], suppressIf: waqfakIsNazir },
  { code: "R-FIN-007", titleAr: "تنظيم القيود", condition: lte("score_A5-03", 2), needCode: "NEED.FIN.BOOKKEEPING", severity: "medium", urgencyDays: 120,
    reasonAr: "تسجيل العمليات المالية ومستنداتها غير منتظم.", reference: "لائحة تنظيم أعمال النظارة م15/2 و3", serviceCodes: ["F02", "F03"], suppressIf: waqfakIsNazir },
  { code: "R-FIN-008", titleAr: "سياسة توزيع الريع", condition: isIn("has_allocation", ["no", "unknown"]), needCode: "NEED.FIN.ALLOCATION_POLICY", severity: "medium", urgencyDays: 120,
    reasonAr: "لا توجد نسب محددة للصيانة والاحتياطي والتنمية.", whyItMattersAr: "الحجز من الريع للتنمية لا يجوز إلا بشرط أو موافقة أو إذن، فتحديد النسب يحمي الناظر والمستحقين.", reference: "دليل الصياغة، المبادئ 16 و19 و20", serviceCodes: ["F01"] },

  // ── REG
  { code: "R-REG-001", titleAr: "تسجيل الوقف لدى الهيئة", condition: flag("R10"), needCode: "NEED.REG.REGISTRATION", severity: "critical", urgencyDays: 7,
    reasonAr: "الوقف موثّق ولم يُسجّل لدى الهيئة وقد تجاوز مهلة 30 يوم عمل.", reference: "لائحة تنظيم أعمال النظارة م8/1؛ جدول المخالفات 7-2", serviceCodes: ["T06"],
    selfServiceHintAr: "التسجيل مجاني عبر بوابة الهيئة؛ يمكنك تنزيل حزمة التسجيل من ملف الوقف وإدخالها بنفسك." },
  { code: "R-REG-002", titleAr: "تسجيل الوقف (ضمن المهلة)", condition: all(eq("is_documented", "yes"), isIn("is_registered", ["no", "unknown"]), { "!": flag("R10") }), needCode: "NEED.REG.REGISTRATION", severity: "high", urgencyDays: 30,
    reasonAr: "الوقف موثّق ولم يُسجّل بعد لدى الهيئة.", reference: "لائحة تنظيم أعمال النظارة م8/1", serviceCodes: ["T06"], selfServiceHintAr: "التسجيل مجاني عبر بوابة الهيئة." },
  { code: "R-REG-003", titleAr: "تجديد الشهادة", condition: eq("cert_valid", "no"), needCode: "NEED.REG.RENEWAL", severity: "high", urgencyDays: 21,
    reasonAr: "شهادة تسجيل الوقف غير سارية.", reference: "لائحة تنظيم أعمال النظارة م8/2", serviceCodes: ["T06"], selfServiceHintAr: "التجديد متاح في بوابة الهيئة." },
  { code: "R-REG-004", titleAr: "تحديث البيانات بعد تغيير جوهري", condition: eq("unupdated_change", "yes"), needCode: "NEED.REG.RENEWAL", severity: "high", urgencyDays: 15,
    reasonAr: "حدث تغيير جوهري لم يُحدَّث لدى الهيئة.", reference: "لائحة تنظيم أعمال النظارة م8/2", serviceCodes: ["T06"] },
  { code: "R-REG-005", titleAr: "توثيق الوقف", condition: eq("is_documented", "no"), needCode: "NEED.REG.DOCUMENTATION", severity: "high", urgencyDays: 60,
    reasonAr: "الوقف غير موثّق لدى الجهة المختصة.", whyItMattersAr: "الوقف غير الموثّق معرّض للضياع والنزاع.", reference: "مائة سؤال وجواب، س19 وس21", serviceCodes: ["T06", "T03"] },
  { code: "R-REG-006", titleAr: "ضبط النظارة في الوثيقة", condition: flag("R14"), needCode: "NEED.REG.NAZIR_IN_DEED", severity: "high", urgencyDays: 90,
    reasonAr: "الوثيقة لا تسمّي ناظرًا.", whyItMattersAr: "الهيئة ناظرة على الأوقاف ما لم يشترط الواقف غيرها.", reference: "نظام الهيئة العامة للأوقاف م5/3/أ", serviceCodes: ["C08", "T04"] },
  { code: "R-REG-007", titleAr: "تصحيح تصرف دون إذن", condition: flag("R03"), needCode: "NEED.REG.DISPOSAL_REMEDY", severity: "critical", urgencyDays: 7,
    reasonAr: "جرى تصرف في أصل دون إذن الجهة المختصة.", reference: "لائحة تنظيم أعمال النظارة م12/3 وم19؛ جدول المخالفات 3-1", serviceCodes: ["C08", "C04"] },
  { code: "R-REG-008", titleAr: "صك النظارة", condition: isIn("has_nazara_deed", ["no", "unknown"]), needCode: "NEED.REG.NAZARA_DEED", severity: "high", urgencyDays: 60,
    reasonAr: "لا يتوفر صك نظارة سارٍ.", whyItMattersAr: "صك النظارة مطلوب للتسجيل وفتح الحسابات وتمثيل الوقف.", reference: "دليل المستخدم لخدمة تسجيل وقف", serviceCodes: ["T06", "C08"] },

  // ── SHR
  { code: "R-SHR-001", titleAr: "المصرف البديل والمآل (الواقف حي)", condition: all(isIn("has_alternate_masraf", ["no", "unknown"]), eq("founder_alive", "yes")), needCode: "NEED.SHR.DEED_AMENDMENT", severity: "high", urgencyDays: 120,
    reasonAr: "الوثيقة لا تنص على المصرف البديل عند الانقطاع أو المآل النهائي، والواقف على قيد الحياة.", reference: "دليل الصياغة، المبدأ 24", serviceCodes: ["T04"] },
  { code: "R-SHR-002", titleAr: "المصرف البديل (الواقف متوفى)", condition: all(isIn("has_alternate_masraf", ["no", "unknown"]), eq("founder_alive", "no")), needCode: "NEED.SHR.INTERPRETATION", severity: "medium", urgencyDays: 180,
    reasonAr: "لا يوجد مصرف بديل والواقف متوفى؛ يُرجع عند الانقطاع إلى الجهة المختصة.", reference: "لائحة تنظيم أعمال النظارة م13/4", serviceCodes: ["C07", "C11"] },
  { code: "R-SHR-003", titleAr: "شرط محتمل البطلان", condition: isIn("possibly_void_condition", ["yes", "unknown"]), needCode: "NEED.SHR.VOID_CONDITION_REVIEW", severity: "high", urgencyDays: 90,
    reasonAr: "قد تتضمن الوثيقة شرطًا محتمل البطلان.", reference: "دليل الصياغة، المبدأ 5", serviceCodes: ["C07"] },
  { code: "R-SHR-004", titleAr: "تعريف الألفاظ المجملة", condition: all(eq("ambiguous_terms", "yes"), { "!=": [v("ambiguity_resolved"), "yes"] }), needCode: "NEED.SHR.DEFINITIONS", severity: "medium", urgencyDays: 180,
    reasonAr: "في الوثيقة ألفاظ مجملة لم تُعالج.", reference: "دليل الصياغة، المبدأ 3؛ لائحة تنظيم أعمال النظارة م9", serviceCodes: ["C11"] },
  { code: "R-SHR-005", titleAr: "تصحيح الصرف", condition: flag("R04"), needCode: "NEED.SHR.MASRAF_CORRECTION", severity: "critical", urgencyDays: 14,
    reasonAr: "صُرف ريع بالمخالفة لشرط الواقف.", reference: "جدول المخالفات 1-1 إلى 1-4", serviceCodes: ["C07", "C04"] },

  // ── NAZ
  { code: "R-NAZ-001", titleAr: "خلافة الناظر", condition: lte("score_A3-04", 1), needCode: "NEED.NAZ.SUCCESSION", severity: "high", urgencyDays: 90, leverage: 1.5,
    reasonAr: "لا توجد آلية واضحة لخلافة الناظر.", whyItMattersAr: "شغور النظارة يعطّل الوقف ويحيله إلى الجهة المختصة للتعيين.", reference: "لائحة تنظيم أعمال النظارة م4", serviceCodes: ["G07", "N01"] },
  { code: "R-NAZ-002", titleAr: "أهلية الناظر", condition: flag("R05"), needCode: "NEED.NAZ.ELIGIBILITY", severity: "critical", urgencyDays: 14,
    reasonAr: "الناظر فقد شرطًا من شروط النظارة.", reference: "لائحة تنظيم أعمال النظارة م5 وم7/3", serviceCodes: ["C08", "N08"] },
  { code: "R-NAZ-003", titleAr: "ترخيص الناظر الاعتباري", condition: flag("R12"), needCode: "NEED.NAZ.LICENSE", severity: "critical", urgencyDays: 30,
    reasonAr: "الناظر شخص اعتباري غير مرخص من الهيئة.", reference: "لائحة تنظيم أعمال النظارة م5/2", serviceCodes: ["C08"] },
  { code: "R-NAZ-004", titleAr: "إقامة الناظر", condition: flag("R06"), needCode: "NEED.NAZ.RESIDENCY", severity: "critical", urgencyDays: 30,
    reasonAr: "الناظر أو مدير الوقف مقيم خارج المملكة.", reference: "معايير المستفيد الحقيقي م8/1", serviceCodes: ["C08", "N01", "N04"] },
  { code: "R-NAZ-005", titleAr: "مساندة الناظر الفرد", condition: all(eq("nazir_kind", "individual"), sizeIn("medium", "large")), needCode: "NEED.NAZ.SUPPORT", severity: "medium", urgencyDays: 180,
    reasonAr: "ناظر فرد يدير وقفًا متوسطًا أو كبيرًا دون لجان مساندة.", reference: "مبادئ حوكمة الأوقاف م4/خامسًا/07", serviceCodes: ["N03", "G03"] },
  { code: "R-NAZ-006", titleAr: "شروط تعيين الناظر", condition: isIn("appointment_defined", ["no", "partial", "unknown"]), needCode: "NEED.NAZ.APPOINTMENT_TERMS", severity: "medium", urgencyDays: 120,
    reasonAr: "قرار تسمية الناظر لا يحدد صلاحياته وأتعابه ومسؤولياته كاملة.", reference: "لائحة تنظيم أعمال النظارة م4/6", serviceCodes: ["C08"] },
  { code: "R-NAZ-007", titleAr: "وقف بلا ناظر", condition: eq("nazir_kind", "vacant"), needCode: "NEED.NAZ.VACANT", severity: "critical", urgencyDays: 30,
    reasonAr: "لا يوجد ناظر حاليًا للوقف.", reference: "لائحة تنظيم أعمال النظارة م4/5", serviceCodes: ["N01", "C08", "N09"] },

  // ── GOV
  { code: "R-GOV-001", titleAr: "سياسة تعارض المصالح", condition: lte("score_A4-04", 2), needCode: "NEED.GOV.CONFLICT_POLICY", severity: "high", urgencyDays: 90,
    reasonAr: "لا توجد سياسة تعارض مصالح مطبقة أو إقرارات سنوية.", reference: "لائحة تنظيم أعمال النظارة م18؛ مبادئ الحوكمة م5", serviceCodes: ["G06"] },
  { code: "R-GOV-002", titleAr: "تعاقد مع أطراف ذات علاقة", condition: flag("R07"), needCode: "NEED.GOV.RELATED_PARTY", severity: "critical", urgencyDays: 7,
    reasonAr: "يتعاقد الوقف مع الناظر أو أحد أقاربه حتى الدرجة الثانية.", whyItMattersAr: "من أعلى غرامات جدول المخالفات.", reference: "لائحة تنظيم أعمال النظارة م18/2؛ جدول المخالفات 5-3", serviceCodes: ["C08", "G06"] },
  { code: "R-GOV-003", titleAr: "حزمة اللوائح والسياسات", condition: any(all(sizeIn("medium", "large"), isIn("policies_band", ["0", "1-3", "4-7", "unknown"])), isIn("policies_band", ["0", "unknown"])), needCode: "NEED.GOV.POLICY_PACKAGE", severity: "high", urgencyDays: 120, leverage: 1.5,
    reasonAr: "اللوائح والسياسات المعتمدة أقل من المطلوب لفئة الوقف.", reference: "لائحة تنظيم أعمال النظارة م9/4 وم14/1؛ جدول المخالفات 5-4 إلى 5-7", serviceCodes: ["G01", "G02"] },
  { code: "R-GOV-004", titleAr: "ميثاق المجلس وأمانة السر", condition: all(eq("nazir_kind", "board"), any(lte("score_A4-01", 2), lte("score_A4-03", 2))), needCode: "NEED.GOV.BOARD_CHARTER", severity: "medium", urgencyDays: 120,
    reasonAr: "مجلس النظارة بلا ميثاق أو بلا محاضر معتمدة ومتابعة قرارات.", reference: "مبادئ حوكمة الأوقاف م4", serviceCodes: ["G03", "N05"] },
  { code: "R-GOV-005", titleAr: "مصفوفة الصلاحيات", condition: lte("score_A4-06", 1), needCode: "NEED.GOV.AUTHORITY_MATRIX", severity: "medium", urgencyDays: 150,
    reasonAr: "لا توجد مصفوفة صلاحيات ولا قائمة بالقرارات غير القابلة للتفويض.", reference: "مبادئ حوكمة الأوقاف م6/ثالثًا", serviceCodes: ["G01"] },
  { code: "R-GOV-006", titleAr: "أعضاء مستقلون ولجان", condition: all(eq("nazir_kind", "board"), sizeIn("medium", "large"), lte("score_A4-02", 1)), needCode: "NEED.GOV.INDEPENDENCE", severity: "medium", urgencyDays: 180,
    reasonAr: "لا يوجد أعضاء مستقلون بنسبة مؤثرة في المجلس.", reference: "مبادئ حوكمة الأوقاف م4/خامسًا/06", serviceCodes: ["G03", "N02"] },
  { code: "R-GOV-007", titleAr: "تقييم الأداء", condition: lte("score_A4-08", 1), needCode: "NEED.GOV.PERFORMANCE", severity: "low", urgencyDays: 365,
    reasonAr: "لا يُقيَّم أداء الناظر أو المجلس.", reference: "مبادئ حوكمة الأوقاف م4/ثانيًا/06", serviceCodes: ["G09"] },

  // ── INV
  { code: "R-INV-001", titleAr: "سياسة الاستثمار", condition: lte("score_A6-01", 1), needCode: "NEED.INV.POLICY", severity: "high", urgencyDays: 120,
    reasonAr: "لا توجد سياسة استثمار مكتوبة معتمدة.", reference: "لائحة تنظيم أعمال النظارة م16", serviceCodes: ["I01", "I02"] },
  { code: "R-INV-002", titleAr: "تنويع الأصول", condition: eq("concentration_band", "gt80"), needCode: "NEED.INV.DIVERSIFICATION", severity: "medium", urgencyDays: 365,
    reasonAr: "أكثر من 80% من قيمة الوقف في فئة أصول واحدة.", whyItMattersAr: "التركّز يرفع مخاطر الريع، والتنويع لا يتم إلا بالإذن النظامي عند الحاجة للاستبدال.", reference: "الدليل الإرشادي لاستثمار الأوقاف", serviceCodes: ["I03"] },
  { code: "R-INV-003", titleAr: "مدير استثمار مرخص", condition: isIn("manager_licensed", ["no", "unknown"]), needCode: "NEED.INV.LICENSED_MANAGER", severity: "critical", urgencyDays: 30,
    reasonAr: "مدير الاستثمار غير مرخص من هيئة السوق المالية أو غير معروف ترخيصه.", reference: "لائحة المنتجات الاستثمارية الوقفية م24/1؛ جدول المخالفات 2-7", serviceCodes: ["C08", "I05"] },
  { code: "R-INV-004", titleAr: "تسجيل المحفظة الوقفية", condition: isIn("portfolio_registered", ["no", "unknown"]), needCode: "NEED.INV.PORTFOLIO_REGISTRATION", severity: "high", urgencyDays: 30,
    reasonAr: "المحفظة الوقفية غير مسجلة أو حسابها غير مقيد لدى الهيئة.", reference: "لائحة المنتجات الاستثمارية الوقفية م21 إلى 23", serviceCodes: ["I06"] },
  { code: "R-INV-005", titleAr: "اقتراض غير مأذون", condition: eq("leverage", "unauthorized"), needCode: "NEED.INV.LEVERAGE", severity: "critical", urgencyDays: 14,
    reasonAr: "يوجد اقتراض أو رفع مالي دون إذن صريح.", reference: "لائحة المنتجات م8/8؛ مائة سؤال وجواب س70 وس73", serviceCodes: ["C08"] },
  { code: "R-INV-006", titleAr: "متابعة الأداء", condition: lte("score_A6-06", 1), needCode: "NEED.INV.PERFORMANCE", severity: "low", urgencyDays: 365,
    reasonAr: "لا يُقارن أداء الاستثمار بمؤشر معياري.", reference: "الدليل الإرشادي لاستثمار الأوقاف سادسًا/3", serviceCodes: ["I07"] },

  // ── AST
  { code: "R-AST-001", titleAr: "تسجيل الأصول باسم الوقف", condition: isIn("assets_in_name", ["no", "partial", "unknown"]), needCode: "NEED.AST.TITLE", severity: "high", urgencyDays: 90,
    reasonAr: "بعض الأصول ليست مسجلة باسم الوقف.", reference: "مائة سؤال وجواب، س19", serviceCodes: ["T06", "I08"] },
  { code: "R-AST-002", titleAr: "الأصول المعطلة", condition: eq("idle_band", "gt20"), needCode: "NEED.AST.IDLE", severity: "high", urgencyDays: 180,
    reasonAr: "أكثر من 20% من قيمة الوقف معطلة أو غير مدرة.", reference: "لائحة تنظيم أعمال النظارة م12 وم16", serviceCodes: ["I03", "I04"] },
  { code: "R-AST-003", titleAr: "تقييم العقارات", condition: isIn("valuation_age", ["gt3", "never"]), needCode: "NEED.AST.VALUATION", severity: "medium", urgencyDays: 180,
    reasonAr: "لم تُقيَّم العقارات منذ أكثر من ثلاث سنوات.", reference: "دليل قواعد وضوابط الاستثمار", serviceCodes: ["I08"] },
  { code: "R-AST-004", titleAr: "توثيق العقود في إيجار", condition: isIn("ejar", ["no", "partial"]), needCode: "NEED.AST.EJAR", severity: "medium", urgencyDays: 120,
    reasonAr: "بعض عقود الإيجار غير موثقة في منصة إيجار.", reference: "الدليل الإرشادي لاستثمار الأوقاف سابعًا/2", serviceCodes: ["I09"] },
  { code: "R-AST-005", titleAr: "خطة الصيانة", condition: lte("score_A7-05", 1), needCode: "NEED.AST.MAINTENANCE", severity: "medium", urgencyDays: 180,
    reasonAr: "لا توجد خطة صيانة أو احتياطي لها.", reference: "لائحة تنظيم أعمال النظارة م12/1", serviceCodes: ["I09"] },
  { code: "R-AST-006", titleAr: "قيود ونزاعات على الأصول", condition: eq("encumbrances", "yes"), needCode: "NEED.AST.ENCUMBRANCE", severity: "high", urgencyDays: 60,
    reasonAr: "توجد قيود أو حجوزات أو نزاعات أو تعديات على الأصول.", reference: "لائحة تنظيم أعمال النظارة م12", serviceCodes: ["C08", "C13"] },

  // ── DOC
  { code: "R-DOC-001", titleAr: "الوثائق الأساسية", condition: isIn("core_docs_band", ["few", "none", "unknown"]), needCode: "NEED.DOC.CORE_DOCS", severity: "high", urgencyDays: 60,
    reasonAr: "الوثائق الأساسية للوقف غير مكتملة.", reference: "دليل المستخدم لخدمة تسجيل وقف", serviceCodes: ["T06"], selfServiceHintAr: "ارفع ما لديك إلى ملف الوقف لنحدد الناقص بدقة." },
  { code: "R-DOC-002", titleAr: "الحفظ عشر سنوات", condition: lte("score_A8-02", 2), needCode: "NEED.DOC.RETENTION", severity: "medium", urgencyDays: 120,
    reasonAr: "لا تُحفظ السجلات بطريقة آمنة لعشر سنوات.", reference: "لائحة تنظيم أعمال النظارة م20؛ جدول المخالفات 6-3", serviceCodes: [], selfServiceHintAr: "ملف الوقف في المنصة يحفظ وثائقك مشفرة مع سجل وصول لعشر سنوات." },
  { code: "R-DOC-003", titleAr: "سجل القرارات والعقود", condition: lte("score_A8-03", 1), needCode: "NEED.DOC.REGISTERS", severity: "low", urgencyDays: 180,
    reasonAr: "لا يوجد سجل للقرارات والعقود والدعاوى.", reference: "الدليل المختصر لمهمات الناظر", serviceCodes: ["N05"] },

  // ── BEN
  { code: "R-BEN-001", titleAr: "سجل المستفيدين", condition: lte("score_A9-01", 2), needCode: "NEED.BEN.REGISTER", severity: "high", urgencyDays: 90,
    reasonAr: "لا يوجد سجل محدث للمستفيدين وطبقاتهم.", reference: "لائحة تنظيم أعمال النظارة م10؛ جدول المخالفات 4-2", serviceCodes: ["N07"], selfServiceHintAr: "يمكنك بناء سجل المستفيدين في ملف الوقف ودعوتهم إلى بوابة المستفيد." },
  { code: "R-BEN-002", titleAr: "قناة الشكاوى والاطلاع", condition: any(lte("score_A9-02", 1), lte("score_A9-03", 1)), needCode: "NEED.BEN.CHANNEL", severity: "medium", urgencyDays: 90,
    reasonAr: "لا توجد قناة موثقة لشكاوى المستفيدين واطلاعهم على القوائم.", reference: "لائحة تنظيم أعمال النظارة م10؛ جدول المخالفات 4-3", serviceCodes: ["C06"], selfServiceHintAr: "فعّل بوابة المستفيد في ملف الوقف." },
  { code: "R-BEN-003", titleAr: "التقرير السنوي", condition: lte("score_A9-05", 1), needCode: "NEED.BEN.REPORTING", severity: "medium", urgencyDays: 180,
    reasonAr: "لا يصدر تقرير سنوي للوقف.", reference: "مبادئ حوكمة الأوقاف م7/رابعًا/02", serviceCodes: ["C05"] },

  // ── RSK
  { code: "R-RSK-001", titleAr: "المستفيد الحقيقي", condition: lte("score_A10-01", 2), needCode: "NEED.RSK.BENEFICIAL_OWNER", severity: "high", urgencyDays: 60,
    reasonAr: "سجل المستفيدين الحقيقيين غير مكتمل أو لم يُتحقق منه منذ سنة.", reference: "معايير المستفيد الحقيقي من الأوقاف م5 وم6", serviceCodes: ["G10"] },
  { code: "R-RSK-002", titleAr: "سجل المخاطر", condition: lte("score_A10-02", 1), needCode: "NEED.RSK.RISK_REGISTER", severity: "medium", urgencyDays: 180,
    reasonAr: "لا يوجد سجل مخاطر.", reference: "الدليل المختصر لمهمات الناظر", serviceCodes: ["G08"], selfServiceHintAr: "سجل المخاطر متاح في ملف الوقف." },
  { code: "R-RSK-003", titleAr: "ملاحظات الهيئة", condition: flag("R13"), needCode: "NEED.RSK.GAA_REMEDIATION", severity: "critical", urgencyDays: 14,
    reasonAr: "توجد ملاحظة أو إنذار من الهيئة لم يُعالج.", reference: "لائحة تنظيم أعمال النظارة م23 إلى م26", serviceCodes: ["C04", "C03"] },
  { code: "R-RSK-004", titleAr: "ترخيص جمع التبرعات", condition: flag("R08"), needCode: "NEED.RSK.DONATIONS_LICENSE", severity: "critical", urgencyDays: 7,
    reasonAr: "يجمع الوقف تبرعات دون ترخيص أو حساب مخصص.", reference: "لائحة جمع التبرعات م7 وم8؛ جدول المخالفات 2-4", serviceCodes: ["C08", "T08"] },
  { code: "R-RSK-005", titleAr: "الحوالات الخارجية", condition: eq("foreign_transfers_ok", "no"), needCode: "NEED.RSK.FOREIGN_TRANSFERS", severity: "high", urgencyDays: 60,
    reasonAr: "لا توجد آلية موثقة للصرف للمستحقين خارج المملكة.", reference: "لائحة تنظيم أعمال النظارة م10؛ جدول المخالفات 2-5", serviceCodes: ["G10"] },
  { code: "R-RSK-006", titleAr: "تدريب مكافحة غسل الأموال", condition: eq("aml_training", "no"), needCode: "NEED.RSK.AML_TRAINING", severity: "low", urgencyDays: 365,
    reasonAr: "لم يحضر الناظر أو العاملون تدريبًا في مكافحة غسل الأموال.", reference: "لائحة تنظيم أعمال النظارة م14/4", serviceCodes: ["G10"] },

  // ── DGT / EST / LEG
  { code: "R-DGT-001", titleAr: "الرقمنة", condition: all(eq("e_accounting", "no"), lte("score_A11-02", 1)), needCode: "NEED.DGT.DIGITIZE", severity: "low", urgencyDays: 365,
    reasonAr: "سجلات الوقف ومحاسبته غير رقمية.", serviceCodes: ["F02"], selfServiceHintAr: "ملف الوقف في المنصة يجمع الأصول والمستفيدين والوثائق في سجل واحد." },
  { code: "R-EST-001", titleAr: "تأسيس الوقف", condition: eq("waqf_state", "establishing"), needCode: "NEED.EST.ESTABLISH", severity: "medium", urgencyDays: 90,
    reasonAr: "الوقف قيد التأسيس.", serviceCodes: ["T01", "T03", "T06"], selfServiceHintAr: "ابدأ معالج تأسيس الوقف لإعداد مسودة الوثيقة." },
  { code: "R-EST-002", titleAr: "الوصية بالوقف", condition: eq("waqf_state", "bequest"), needCode: "NEED.EST.BEQUEST", severity: "medium", urgencyDays: 90,
    reasonAr: "الوقف وصية لم تُنفَّذ بعد أو قيد الإعداد.", reference: "دليل الصياغة، المبدأ 2", serviceCodes: ["W01", "W02", "W05"] },
  { code: "R-LEG-001", titleAr: "النزاع القائم", condition: eq("litigation", "yes"), needCode: "NEED.LEG.LITIGATION", severity: "high", urgencyDays: 30,
    reasonAr: "يوجد نزاع قضائي قائم يتعلق بالوقف.", serviceCodes: ["C08", "C13"] },
];
