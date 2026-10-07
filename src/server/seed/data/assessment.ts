/**
 * Question bank v1 — derived from: لائحة تنظيم أعمال النظارة، جدول المخالفات، معايير المستفيد الحقيقي، مبادئ حوكمة الأوقاف،
 * الدليل الإرشادي لصياغة وثيقة الوقف، الدليل المختصر لمهمات الناظر، أدلة الاستثمار واختيار الأصول، مائة سؤال وجواب.
 * Editable from Admin → بنك الأسئلة (new versions are published; past assessments keep their version).
 */
import type { Option, Question } from "../../engines/assessment";

const U: Option = { value: "unknown", label: "لا أعلم", unknown: true };
const NA: Option = { value: "na", label: "لا ينطبق", na: true };
const YN: Option[] = [{ value: "yes", label: "نعم", score: 5 }, { value: "no", label: "لا", score: 0 }, U];
const YN_NA: Option[] = [...YN, NA];
const YPN: Option[] = [{ value: "yes", label: "نعم", score: 5 }, { value: "partial", label: "جزئيًا", score: 2.5 }, { value: "no", label: "لا", score: 0 }, U];
const YPN_NA: Option[] = [...YPN, NA];
/** "Yes" is the problem (e.g. related-party contracting). */
const INV: Option[] = [{ value: "no", label: "لا", score: 5 }, { value: "yes", label: "نعم", score: 0 }, U];
const PLAIN_YN: Option[] = [{ value: "yes", label: "نعم" }, { value: "no", label: "لا" }];

const any = (...rules: unknown[]) => ({ or: rules });
const eq = (k: string, v: unknown) => ({ "==": [{ var: k }, v] });
const has = (k: string, v: string) => ({ in: [v, { var: k }] });
const sizeIn = (...s: string[]) => ({ in: [{ var: "size_class" }, s] });
const answerIn = (...v: string[]) => ({ in: [{ var: "answer" }, v] });

export const AXES = [
  { code: "A1", nameAr: "الوضع الشرعي والالتزام بشرط الواقف", description: "صحة الأركان، وضوح الشرط وتنفيذه، الشروط محتملة البطلان، المصرف البديل", weightSmall: 16, weightMedium: 13, weightLarge: 11 },
  { code: "A2", nameAr: "الوضع النظامي والتسجيل", description: "التوثيق، التسجيل في المهلة، الشهادة، صك النظارة، الأذونات", weightSmall: 14, weightMedium: 11, weightLarge: 9 },
  { code: "A3", nameAr: "النظارة والإدارة", description: "أهلية الناظر، الاستخلاف، التفرغ، الأجر، التفويض، الإقامة", weightSmall: 12, weightMedium: 10, weightLarge: 9 },
  { code: "A4", nameAr: "الحوكمة", description: "المجلس، الاستقلال، الاجتماعات والقرارات، السياسات، تعارض المصالح", weightSmall: 6, weightMedium: 12, weightLarge: 14 },
  { code: "A5", nameAr: "الوضع المالي", description: "الحساب المستقل، عدم الخلط، القيود، الموازنة، القوائم، الصرف", weightSmall: 14, weightMedium: 12, weightLarge: 11 },
  { code: "A6", nameAr: "الوضع الاستثماري", description: "سياسة الاستثمار، العائد، التنويع، الترخيص، الاقتراض", weightSmall: 4, weightMedium: 8, weightLarge: 10 },
  { code: "A7", nameAr: "الأصول", description: "الملكية باسم الوقف، التقييم، التشغيل، الصيانة، الأصول المعطلة", weightSmall: 10, weightMedium: 9, weightLarge: 9 },
  { code: "A8", nameAr: "الوثائق والتوثيق", description: "اكتمال الوثائق، الحفظ عشر سنوات، السجلات، الأرشفة", weightSmall: 8, weightMedium: 7, weightLarge: 6 },
  { code: "A9", nameAr: "حقوق المستفيدين والإفصاح والتقارير", description: "سجل المستفيدين، الاطلاع، الشكاوى، التقارير", weightSmall: 8, weightMedium: 8, weightLarge: 9 },
  { code: "A10", nameAr: "المخاطر والامتثال الرقابي", description: "المستفيد الحقيقي، غسل الأموال، سجل المخاطر، ملاحظات الهيئة", weightSmall: 6, weightMedium: 7, weightLarge: 8 },
  { code: "A11", nameAr: "التحول الرقمي", description: "السجلات الرقمية والنظام المحاسبي والقنوات الإلكترونية", weightSmall: 2, weightMedium: 3, weightLarge: 4 },
];

type Q = Omit<Question, "depth"> & { depth?: "basic" | "deep"; helpAr?: string };

export const QUESTIONS: Q[] = [
  // ─────────── Profile (يحدد الأسئلة المنطبقة والأوزان) ───────────
  { code: "P01", axisCode: "P", textAr: "ما حالة الوقف؟", answerType: "select", weight: 1, factKey: "waqf_state",
    options: [{ value: "existing", label: "وقف قائم موثّق" }, { value: "establishing", label: "قيد التأسيس (لم يوثّق بعد)" }, { value: "bequest", label: "وصية بوقف" }] },
  { code: "P02", axisCode: "P", textAr: "على من يُصرف ريع الوقف؟", answerType: "select", weight: 1, factKey: "beneficiary_kind",
    helpAr: "هذا يحدد نوع الوقف: عام أو خاص (أهلي) أو مشترك.",
    options: [{ value: "public", label: "أوجه بر عامة (مسجد، تعليم، فقراء…)" }, { value: "private", label: "الذرية أو أشخاص معيّنون" }, { value: "both", label: "الاثنان معًا" }] },
  { code: "P02B", axisCode: "P", textAr: "هل الاستحقاق مقيّد بوصف خيري كالفقر أو الحاجة (مثل: الفقراء من الذرية)؟", answerType: "select", weight: 1, factKey: "charitable_qualifier",
    showIf: eq("beneficiary_kind", "private"), options: PLAIN_YN },
  { code: "P02C", axisCode: "P", textAr: "هل نصّت الوثيقة على أن الريع يؤول إلى جهة بر بعد انقراض المعيّنين؟", answerType: "select", weight: 1, factKey: "then_to_charity",
    showIf: eq("beneficiary_kind", "private"), options: PLAIN_YN },
  { code: "P03", axisCode: "P", textAr: "ما القيمة التقديرية لجميع أصول الوقف؟", answerType: "band", weight: 1, factKey: "asset_band",
    helpAr: "فئة الحجم تحدد الالتزامات: كبير 200 مليون فأكثر، متوسط 50 إلى أقل من 200، صغير أقل من 50 (لائحة تنظيم أعمال النظارة، م1).",
    options: [{ value: "lt5", label: "أقل من 5 ملايين ريال" }, { value: "5to50", label: "من 5 إلى أقل من 50 مليونًا" }, { value: "50to200", label: "من 50 إلى أقل من 200 مليون" }, { value: "gte200", label: "200 مليون فأكثر" }] },
  { code: "P04", axisCode: "P", textAr: "هل ينتفع الناس بعين الأصل مباشرة (مسجد، مدرسة، بئر، جهاز طبي) بدل ريعه؟", answerType: "select", weight: 1, factKey: "direct_benefit", options: PLAIN_YN },
  { code: "P05", axisCode: "P", textAr: "ما أنواع أصول الوقف؟ (اختر كل ما ينطبق)", answerType: "multiselect", weight: 1, factKey: "asset_types",
    options: [
      { value: "real_estate", label: "عقار" }, { value: "cash", label: "نقود" }, { value: "shares", label: "أسهم أو حصص" },
      { value: "fund_units", label: "وحدات صناديق" }, { value: "portfolio", label: "محفظة استثمارية" }, { value: "movable", label: "منقولات" },
      { value: "ip", label: "حقوق معنوية" }, { value: "usufruct", label: "منافع" },
    ] },
  { code: "P06", axisCode: "P", textAr: "من يتولى النظارة؟", answerType: "select", weight: 1, factKey: "nazir_kind",
    options: [
      { value: "founder", label: "الواقف نفسه" }, { value: "individual", label: "ناظر فرد" }, { value: "board", label: "مجلس نظارة" },
      { value: "legal_entity", label: "شخص اعتباري (شركة أو جهة)" }, { value: "gaa", label: "الهيئة العامة للأوقاف" }, { value: "vacant", label: "لا يوجد ناظر حاليًا" },
    ] },
  { code: "P07", axisCode: "P", textAr: "هل الواقف على قيد الحياة؟", answerType: "select", weight: 1, factKey: "founder_alive", options: PLAIN_YN },
  { code: "P08", axisCode: "P", textAr: "هل الواقف أو الناظر غير سعودي، أو مقيم خارج المملكة؟", answerType: "select", weight: 1, factKey: "foreign_party", options: PLAIN_YN },
  { code: "P09", axisCode: "P", textAr: "هل يوجد مستحقون أو مستفيدون خارج المملكة؟", answerType: "select", weight: 1, factKey: "beneficiaries_abroad", options: PLAIN_YN },
  { code: "P10", axisCode: "P", textAr: "هل يجمع الوقف تبرعات من الغير أو ينوي ذلك؟", answerType: "select", weight: 1, factKey: "collects_donations", options: PLAIN_YN },
  { code: "P11", axisCode: "P", textAr: "هل يوجد نزاع قضائي قائم يتعلق بالوقف؟", answerType: "select", weight: 1, factKey: "litigation", options: PLAIN_YN },
  { code: "P12", axisCode: "P", textAr: "ما دورك في هذا الوقف؟", answerType: "select", weight: 1, factKey: "respondent_role",
    options: [{ value: "founder", label: "واقف" }, { value: "nazir", label: "ناظر" }, { value: "board", label: "عضو مجلس نظارة" }, { value: "beneficiary", label: "مستفيد" }, { value: "agent", label: "وكيل أو ممثل" }, { value: "other", label: "أخرى" }] },

  // ─────────── A1 الوضع الشرعي والالتزام بشرط الواقف ───────────
  { code: "A1-01", axisCode: "A1", textAr: "هل الأصل الموقوف مملوك للواقف بصك سارٍ خالٍ من الموانع وقت الوقف؟", answerType: "yes_no", options: YN, weight: 3, factKey: "asset_owned_clear", referenceText: "الدليل الإرشادي لصياغة وثيقة الوقف، المبدأ 12" },
  { code: "A1-02", axisCode: "A1", textAr: "ما مدى وضوح شروط الواقف ومصارفه المكتوبة في الوثيقة؟", answerType: "maturity", weight: 2, factKey: "conditions_clarity", referenceText: "لائحة تنظيم أعمال النظارة، م9" },
  { code: "A1-03", axisCode: "A1", textAr: "هل في الوثيقة ألفاظ مجملة غير معرّفة (مثل: الذرية، الأولاد، الرشد)؟", answerType: "yes_no", options: INV, weight: 2, factKey: "ambiguous_terms", referenceText: "دليل الصياغة، المبدأ 3" },
  { code: "A1-04", axisCode: "A1", textAr: "هل نصّت الوثيقة على المصرف البديل عند الانقطاع وعلى المآل النهائي؟", answerType: "yes_no", options: YN, weight: 3, factKey: "has_alternate_masraf", referenceText: "دليل الصياغة، المبدأ 24؛ مائة سؤال وجواب، س25" },
  { code: "A1-05", axisCode: "A1", textAr: "هل يُصرف الريع على المصارف المحددة ويُوثَّق ذلك سنويًا مع أسباب أي تعذر؟", answerType: "maturity", weight: 3, factKey: "masraf_execution", referenceText: "مبادئ حوكمة الأوقاف، م1/ثانيًا/01" },
  { code: "A1-06", axisCode: "A1", textAr: "هل في الوثيقة شرط قد يكون باطلًا (استبدال دون إذن، منع العمارة، حق الرجوع، صلاحية مطلقة في الصرف)؟", answerType: "yes_no", options: INV, weight: 2, factKey: "possibly_void_condition", referenceText: "دليل الصياغة، المبدأ 5" },
  { code: "A1-07", axisCode: "A1", textAr: "هل عولجت الشروط الغامضة أو المتعارضة بالرجوع إلى الواقف أو الجهة المختصة كتابةً؟", answerType: "yes_no", options: YN_NA, weight: 2, factKey: "ambiguity_resolved", showIf: eq("ambiguous_terms", "yes"), referenceText: "لائحة تنظيم أعمال النظارة، م9" },
  { code: "A1-08", axisCode: "A1", textAr: "هل صُرف ريع لغير المستحقين، أو بأقل مما في الوثيقة، أو بالمخالفة للشرط خلال آخر سنتين؟", answerType: "yes_no", options: INV, weight: 3, factKey: "masraf_deviation", criticalFlagCode: "R04", criticalWhen: answerIn("yes"), referenceText: "جدول المخالفات، البنود 1-1 إلى 1-4" },
  { code: "A1-09", axisCode: "A1", textAr: "هل تخص الوثيقة بعض الأولاد دون بعض دون وصف معتبر؟", answerType: "yes_no", options: INV, weight: 2, factKey: "children_exclusion", showIf: any(eq("beneficiary_kind", "private"), eq("beneficiary_kind", "both")), depth: "deep", referenceText: "الدليل الإرشادي للواقفين؛ دليل الصياغة، المبدأ 27" },
  { code: "A1-10", axisCode: "A1", textAr: "هل تُقدَّم عمارة الأصل وصيانته على التوزيع؟", answerType: "maturity", weight: 2, factKey: "maintenance_priority", depth: "deep", referenceText: "لائحة تنظيم أعمال النظارة، م12/1" },

  // ─────────── A2 الوضع النظامي والتسجيل ───────────
  { code: "A2-01", axisCode: "A2", textAr: "هل الوقف موثّق لدى الجهة المختصة (كتابة العدل أو المحكمة)؟", answerType: "yes_no", options: YN, weight: 3, factKey: "is_documented", referenceText: "مائة سؤال وجواب، س21" },
  { code: "A2-02", axisCode: "A2", textAr: "ما تاريخ توثيق الوقف؟", answerType: "date", weight: 1, factKey: "documented_on", showIf: eq("is_documented", "yes") },
  { code: "A2-03", axisCode: "A2", textAr: "هل الوقف مسجّل لدى الهيئة العامة للأوقاف؟", answerType: "yes_no", options: YN, weight: 3, factKey: "is_registered", showIf: eq("is_documented", "yes"),
    criticalFlagCode: "R10", criticalWhen: { and: [{ in: [{ var: "answer" }, ["no", "unknown"]] }, { var: "registration_overdue" }] }, referenceText: "لائحة تنظيم أعمال النظارة، م8/1 (30 يوم عمل)" },
  { code: "A2-04", axisCode: "A2", textAr: "هل شهادة التسجيل سارية؟", answerType: "yes_no", options: YN, weight: 2, factKey: "cert_valid", showIf: eq("is_registered", "yes"), referenceText: "لائحة تنظيم أعمال النظارة، م8/2" },
  { code: "A2-05", axisCode: "A2", textAr: "تاريخ انتهاء شهادة التسجيل (إن وُجد)", answerType: "date", weight: 1, factKey: "cert_expires_on", showIf: eq("is_registered", "yes") },
  { code: "A2-06", axisCode: "A2", textAr: "هل لدى الناظر صك نظارة سارٍ؟", answerType: "yes_no", options: YN_NA, weight: 3, factKey: "has_nazara_deed", referenceText: "دليل المستخدم لخدمة تسجيل وقف" },
  { code: "A2-07", axisCode: "A2", textAr: "هل حدث تغيير جوهري (في الأصول أو الناظر أو المستفيدين) ولم يُحدَّث لدى الهيئة خلال 15 يوم عمل؟", answerType: "yes_no", options: INV, weight: 2, factKey: "unupdated_change", referenceText: "لائحة تنظيم أعمال النظارة، م8/2" },
  { code: "A2-08", axisCode: "A2", textAr: "هل جرى بيع أو استبدال أو رهن لأصل من أصول الوقف دون إذن الجهة المختصة؟", answerType: "select", weight: 3, factKey: "disposal_without_permission",
    options: [{ value: "no", label: "لا", score: 5 }, { value: "yes_benefit", label: "نعم، لمصلحة الوقف", score: 1 }, { value: "yes", label: "نعم", score: 0 }, U],
    criticalFlagCode: "R03", criticalWhen: answerIn("yes", "yes_benefit"), referenceText: "لائحة تنظيم أعمال النظارة، م12/3 وم19؛ جدول المخالفات 3-1 و3-3" },
  { code: "A2-09", axisCode: "A2", textAr: "هل تسمّي الوثيقة الناظر صراحةً؟", answerType: "yes_no", options: YN, weight: 2, factKey: "deed_names_nazir",
    criticalFlagCode: "R14", criticalWhen: answerIn("no"), referenceText: "نظام الهيئة العامة للأوقاف، م5/3/أ" },

  // ─────────── A3 النظارة والإدارة ───────────
  { code: "A3-01", axisCode: "A3", textAr: "هل يستوفي الناظر شروط النظارة (الأهلية، حسن السيرة، عدم الإدانة بجريمة مخلة بالأمانة، عدم العزل السابق)؟", answerType: "yes_no", options: YN, weight: 3, factKey: "nazir_eligible",
    showIf: { "!": { in: [{ var: "nazir_kind" }, ["gaa", "vacant"]] } }, criticalFlagCode: "R05", criticalWhen: answerIn("no"), referenceText: "لائحة تنظيم أعمال النظارة، م5؛ جدول المخالفات 5-1" },
  { code: "A3-02", axisCode: "A3", textAr: "هل الناظر الاعتباري مرخّص من الهيئة العامة للأوقاف؟", answerType: "yes_no", options: YN, weight: 3, factKey: "legal_nazir_licensed",
    showIf: eq("nazir_kind", "legal_entity"), criticalFlagCode: "R12", criticalWhen: answerIn("no"), referenceText: "لائحة تنظيم أعمال النظارة، م5/2" },
  { code: "A3-03", axisCode: "A3", textAr: "هل يحدد قرار تسمية الناظر صلاحياته وأتعابه ومسؤولياته؟", answerType: "yes_partial_no", options: YPN_NA, weight: 2, factKey: "appointment_defined", referenceText: "لائحة تنظيم أعمال النظارة، م4/6" },
  { code: "A3-04", axisCode: "A3", textAr: "هل توجد آلية واضحة لخلافة الناظر تمنع شغور النظارة؟", answerType: "maturity", weight: 3, factKey: "succession", referenceText: "لائحة تنظيم أعمال النظارة، م4؛ مبادئ الحوكمة م2/رابعًا" },
  { code: "A3-05", axisCode: "A3", textAr: "إذا اشترط الواقف تفرغ الناظر: هل يلتزم به؟", answerType: "yes_no", options: YN_NA, weight: 1, factKey: "fulltime_ok", referenceText: "لائحة تنظيم أعمال النظارة، م17" },
  { code: "A3-06", axisCode: "A3", textAr: "إن فوّض الناظر غيره بالإدارة: هل التفويض موثق والمفوَّض مستوفٍ لشروط الناظر؟", answerType: "yes_no", options: YN_NA, weight: 2, factKey: "delegation_ok", referenceText: "لائحة تنظيم أعمال النظارة، م11/4" },
  { code: "A3-07", axisCode: "A3", textAr: "هل أجرة الناظر محددة بالشرط أو بقرار الجهة المختصة؟", answerType: "yes_no", options: YN_NA, weight: 1, factKey: "nazir_fee_defined", referenceText: "لائحة تنظيم أعمال النظارة، م11/1" },
  { code: "A3-08", axisCode: "A3", textAr: "هل الناظر وكل من يتولى إدارة الوقف مقيمون في المملكة؟", answerType: "yes_no", options: YN, weight: 3, factKey: "nazir_resident",
    criticalFlagCode: "R06", criticalWhen: answerIn("no"), referenceText: "معايير المستفيد الحقيقي من الأوقاف، م8/1" },

  // ─────────── A4 الحوكمة ───────────
  { code: "A4-01", axisCode: "A4", textAr: "هل لمجلس النظارة ميثاق يحدد النصاب والاجتماعات والأغلبية؟", answerType: "maturity", weight: 2, factKey: "board_charter", showIf: eq("nazir_kind", "board"), referenceText: "دليل الصياغة، المبدأ 33" },
  { code: "A4-02", axisCode: "A4", textAr: "هل في المجلس أعضاء مستقلون بنسبة مؤثرة؟", answerType: "maturity", weight: 2, factKey: "independents", showIf: eq("nazir_kind", "board"), referenceText: "مبادئ حوكمة الأوقاف، م4/خامسًا/06" },
  { code: "A4-03", axisCode: "A4", textAr: "هل تُعقد الاجتماعات المقررة وتُعتمد محاضرها وتُتابع قراراتها؟", answerType: "maturity", weight: 2, factKey: "meetings_practice", showIf: eq("nazir_kind", "board"), referenceText: "مبادئ حوكمة الأوقاف، م4/ثانيًا/04" },
  { code: "A4-04", axisCode: "A4", textAr: "هل توجد سياسة تعارض مصالح وإقرارات سنوية من الناظر أو الأعضاء؟", answerType: "maturity", weight: 3, factKey: "coi_policy", referenceText: "لائحة تنظيم أعمال النظارة، م18؛ مبادئ الحوكمة م5" },
  { code: "A4-05", axisCode: "A4", textAr: "هل يتعاقد الوقف مع الناظر نفسه أو أحد أقاربه حتى الدرجة الثانية، مباشرة أو بطريق غير مباشر؟", answerType: "yes_no", options: INV, weight: 3, factKey: "related_party_contracts",
    criticalFlagCode: "R07", criticalWhen: answerIn("yes"), referenceText: "لائحة تنظيم أعمال النظارة، م18/2؛ جدول المخالفات 5-3" },
  { code: "A4-06", axisCode: "A4", textAr: "هل توجد مصفوفة صلاحيات وقائمة بالقرارات التي لا يجوز تفويضها؟", answerType: "maturity", weight: 2, factKey: "authority_matrix", showIf: any(eq("nazir_kind", "board"), sizeIn("medium", "large")), referenceText: "مبادئ حوكمة الأوقاف، م6/ثالثًا" },
  { code: "A4-07", axisCode: "A4", textAr: "كم عدد اللوائح والسياسات المعتمدة من المتطلبات الاثني عشر (لائحة حوكمة، مالية، صرف، استثمار، تعارض مصالح، صلاحيات، شكاوى، سجل مستفيدين، مخاطر، صيانة، سجل قرارات، أرشفة)؟", answerType: "band", weight: 2, factKey: "policies_band",
    options: [{ value: "0", label: "لا شيء", score: 0 }, { value: "1-3", label: "1 إلى 3", score: 1 }, { value: "4-7", label: "4 إلى 7", score: 2.5 }, { value: "8-11", label: "8 إلى 11", score: 4 }, { value: "12", label: "كلها", score: 5 }, U],
    referenceText: "لائحة تنظيم أعمال النظارة، م9/4 وم14/1؛ الدليل المختصر لمهمات الناظر" },
  { code: "A4-08", axisCode: "A4", textAr: "هل يُقيَّم أداء الناظر أو المجلس سنويًا؟", answerType: "maturity", weight: 1, factKey: "performance_review", referenceText: "مبادئ حوكمة الأوقاف، م4/ثانيًا/06" },
  { code: "A4-09", axisCode: "A4", textAr: "هل توجد لجان مفعّلة (استثمار، مراجعة، صرف)؟", answerType: "maturity", weight: 1, factKey: "committees", showIf: sizeIn("large"), referenceText: "مبادئ حوكمة الأوقاف، م4/ثالثًا/06" },
  { code: "A4-10", axisCode: "A4", textAr: "هل توجد سياسة للإبلاغ عن المخالفات داخل الوقف؟", answerType: "maturity", weight: 1, factKey: "whistleblowing", depth: "deep", referenceText: "مبادئ حوكمة الأوقاف، م6/رابعًا/04" },

  // ─────────── A5 الوضع المالي ───────────
  { code: "A5-01", axisCode: "A5", textAr: "هل للوقف حساب بنكي مستقل باسمه؟", answerType: "yes_no", options: YN, weight: 3, factKey: "has_bank_account",
    criticalFlagCode: "R01", criticalWhen: answerIn("no", "unknown"), referenceText: "لائحة تنظيم أعمال النظارة، م15/1؛ جدول المخالفات 5-2" },
  { code: "A5-02", axisCode: "A5", textAr: "هل تُحصَّل كل الإيرادات وتُصرف كل المصروفات من حساب الوقف فقط، دون خلطها بأموال أخرى؟", answerType: "yes_partial_no", options: YPN, weight: 3, factKey: "funds_separated",
    criticalFlagCode: "R02", criticalWhen: answerIn("no"), referenceText: "لائحة تنظيم أعمال النظارة، م15/1؛ جدول المخالفات 6-1" },
  { code: "A5-03", axisCode: "A5", textAr: "هل تُسجَّل العمليات المالية باللغة العربية وتُحفظ مستنداتها؟", answerType: "maturity", weight: 2, factKey: "bookkeeping", referenceText: "لائحة تنظيم أعمال النظارة، م15/2 و3" },
  { code: "A5-04", axisCode: "A5", textAr: "هل توجد موازنة تقديرية معتمدة للسنة الحالية؟", answerType: "yes_no", options: YN_NA, weight: 2, factKey: "has_budget", showIf: sizeIn("medium", "large"), referenceText: "لائحة تنظيم أعمال النظارة، م15/4؛ جدول المخالفات 6-4" },
  { code: "A5-05", axisCode: "A5", textAr: "هل صدرت قوائم مالية مدققة من مراجع معتمد لدى الهيئة السعودية للمراجعين والمحاسبين عن آخر سنة؟", answerType: "yes_no", options: YN, weight: 3, factKey: "has_audited_statements",
    showIf: sizeIn("medium", "large"), criticalFlagCode: "R11", criticalWhen: answerIn("no", "unknown"), referenceText: "لائحة تنظيم أعمال النظارة، م15/4؛ جدول المخالفات 6-5" },
  { code: "A5-06", axisCode: "A5", textAr: "هل صدر بيان مالي سنوي بالواردات والمصروفات عن آخر سنة؟", answerType: "yes_no", options: YN, weight: 3, factKey: "has_simple_statement",
    showIf: sizeIn("small", "direct_benefit"), referenceText: "لائحة تنظيم أعمال النظارة، م15/5؛ جدول المخالفات 6-6" },
  { code: "A5-07", axisCode: "A5", textAr: "هل صُرفت عوائد آخر سنة في موعدها (حسب الشرط، أو خلال 3 أشهر من نهاية السنة المالية)؟", answerType: "yes_no", options: YN_NA, weight: 3, factKey: "distribution_on_time",
    criticalFlagCode: "R09", criticalWhen: answerIn("no"), referenceText: "لائحة تنظيم أعمال النظارة، م13/1؛ جدول المخالفات 4-1 و4-4" },
  { code: "A5-08", axisCode: "A5", textAr: "هل توجد نسب محددة للصيانة والاحتياطي والتنمية من الريع؟", answerType: "yes_no", options: YN, weight: 2, factKey: "has_allocation", referenceText: "دليل الصياغة، المبادئ 16 و19 و20" },
  { code: "A5-09", axisCode: "A5", textAr: "هل تُصرف مستحقات المستفيدين من حسابات الوقف بأرقام مرجعية موثقة؟", answerType: "maturity", weight: 2, factKey: "distribution_traceable", depth: "deep", referenceText: "معايير المستفيد الحقيقي م5/4؛ جدول المخالفات 6-2" },

  // ─────────── A6 الوضع الاستثماري ───────────
  { code: "A6-01", axisCode: "A6", textAr: "هل للوقف سياسة استثمار مكتوبة معتمدة بعائد مستهدف وحدود للمخاطر؟", answerType: "maturity", weight: 3, factKey: "investment_policy", referenceText: "لائحة تنظيم أعمال النظارة، م16؛ الدليل الإرشادي لاستثمار الأوقاف" },
  { code: "A6-02", axisCode: "A6", textAr: "ما نسبة أكبر فئة أصول من إجمالي قيمة الوقف؟", answerType: "band", weight: 2, factKey: "concentration_band",
    options: [{ value: "lt40", label: "أقل من 40%", score: 5 }, { value: "40-60", label: "من 40% إلى 60%", score: 3.5 }, { value: "60-80", label: "من 60% إلى 80%", score: 2 }, { value: "gt80", label: "أكثر من 80%", score: 0.5 }, U],
    referenceText: "الدليل الإرشادي لاستثمار الأوقاف (التنويع)" },
  { code: "A6-03", axisCode: "A6", textAr: "إن أُسندت إدارة الاستثمارات: هل المدير مرخص من هيئة السوق المالية؟", answerType: "yes_no", options: YN_NA, weight: 3, factKey: "manager_licensed",
    showIf: any(has("asset_types", "portfolio"), has("asset_types", "fund_units"), has("asset_types", "shares")), referenceText: "لائحة المنتجات الاستثمارية الوقفية، م24/1" },
  { code: "A6-04", axisCode: "A6", textAr: "هل سُجّلت المحفظة الوقفية وقُيّد حسابها لدى الهيئة؟", answerType: "yes_no", options: YN_NA, weight: 2, factKey: "portfolio_registered",
    showIf: has("asset_types", "portfolio"), referenceText: "لائحة المنتجات الاستثمارية الوقفية، م21 إلى 23" },
  { code: "A6-05", axisCode: "A6", textAr: "هل يوجد اقتراض أو رفع مالي على الوقف؟", answerType: "select", weight: 3, factKey: "leverage",
    options: [{ value: "none", label: "لا يوجد", score: 5 }, { value: "authorized", label: "يوجد، ومأذون به في الشرط والسياسة", score: 4 }, { value: "unauthorized", label: "يوجد دون إذن صريح", score: 0 }, U],
    referenceText: "لائحة المنتجات م8/8؛ مائة سؤال وجواب س70 وس73" },
  { code: "A6-06", axisCode: "A6", textAr: "هل يُقارن أداء الاستثمار بمؤشر معياري سنويًا على الأقل؟", answerType: "maturity", weight: 1, factKey: "benchmarking", referenceText: "الدليل الإرشادي لاستثمار الأوقاف، سادسًا/3" },
  { code: "A6-07", axisCode: "A6", textAr: "هل لكل استثمار مباشر أو عقاري خطة تخارج موثقة؟", answerType: "maturity", weight: 1, factKey: "exit_plans", depth: "deep", referenceText: "دليل قواعد وضوابط الاستثمار" },

  // ─────────── A7 الأصول ───────────
  { code: "A7-01", axisCode: "A7", textAr: "هل جميع الأصول مسجلة باسم الوقف بمستندات ملكية سليمة؟", answerType: "yes_partial_no", options: YPN, weight: 3, factKey: "assets_in_name", referenceText: "مائة سؤال وجواب، س19" },
  { code: "A7-02", axisCode: "A7", textAr: "ما نسبة الأصول المعطلة أو غير المدرة من قيمة الوقف؟", answerType: "band", weight: 2, factKey: "idle_band",
    options: [{ value: "none", label: "لا يوجد", score: 5 }, { value: "lt10", label: "أقل من 10%", score: 4 }, { value: "10-20", label: "من 10% إلى 20%", score: 2.5 }, { value: "gt20", label: "أكثر من 20%", score: 0.5 }, U],
    referenceText: "مبادئ حوكمة الأوقاف، م2" },
  { code: "A7-03", axisCode: "A7", textAr: "متى كان آخر تقييم للعقارات؟", answerType: "band", weight: 1, factKey: "valuation_age", showIf: has("asset_types", "real_estate"),
    options: [{ value: "lt1", label: "خلال سنة", score: 5 }, { value: "1-3", label: "من سنة إلى ثلاث", score: 3 }, { value: "gt3", label: "أكثر من ثلاث سنوات", score: 1 }, { value: "never", label: "لم تُقيَّم", score: 0 }, U],
    referenceText: "دليل قواعد وضوابط الاستثمار (التقييم السنوي للعقار)" },
  { code: "A7-04", axisCode: "A7", textAr: "هل جميع عقود الإيجار موثقة في منصة إيجار؟", answerType: "yes_partial_no", options: YPN_NA, weight: 2, factKey: "ejar", showIf: has("asset_types", "real_estate"), referenceText: "الدليل الإرشادي لاستثمار الأوقاف، سابعًا/2" },
  { code: "A7-05", axisCode: "A7", textAr: "هل توجد خطة صيانة دورية واحتياطي للصيانة؟", answerType: "maturity", weight: 2, factKey: "maintenance", referenceText: "لائحة تنظيم أعمال النظارة، م12/1" },
  { code: "A7-06", axisCode: "A7", textAr: "هل على الأصول قيود أو حجوزات أو نزاعات أو تعديات قائمة؟", answerType: "yes_no", options: INV, weight: 2, factKey: "encumbrances", referenceText: "لائحة تنظيم أعمال النظارة، م12" },
  { code: "A7-07", axisCode: "A7", textAr: "ما نسبة إشغال الوحدات المؤجرة؟", answerType: "band", weight: 1, factKey: "occupancy_band", showIf: has("asset_types", "real_estate"), depth: "deep",
    options: [{ value: "gt90", label: "أكثر من 90%", score: 5 }, { value: "70-90", label: "70% إلى 90%", score: 3 }, { value: "lt70", label: "أقل من 70%", score: 1 }, NA, U] },

  // ─────────── A8 الوثائق والتوثيق ───────────
  { code: "A8-01", axisCode: "A8", textAr: "كم يتوفر لديك من الوثائق الأساسية: صك الوقفية، صك النظارة، شهادة التسجيل، صكوك الأصول، العقود؟", answerType: "band", weight: 3, factKey: "core_docs_band",
    options: [{ value: "all", label: "كلها", score: 5 }, { value: "most", label: "3 أو 4", score: 3 }, { value: "few", label: "1 أو 2", score: 1 }, { value: "none", label: "لا شيء", score: 0 }, U] },
  { code: "A8-02", axisCode: "A8", textAr: "هل تُحفظ السجلات والمستندات عشر سنوات على الأقل بطريقة آمنة قابلة للاسترجاع؟", answerType: "maturity", weight: 2, factKey: "retention", referenceText: "لائحة تنظيم أعمال النظارة، م20؛ جدول المخالفات 6-3" },
  { code: "A8-03", axisCode: "A8", textAr: "هل يوجد سجل للقرارات والعقود والدعاوى؟", answerType: "maturity", weight: 2, factKey: "registers", referenceText: "الدليل المختصر لمهمات الناظر" },
  { code: "A8-04", axisCode: "A8", textAr: "هل الأرشيف رقمي ومصنّف وبصلاحيات وصول؟", answerType: "maturity", weight: 1, factKey: "digital_archive", referenceText: "مبادئ حوكمة الأوقاف، م7/أولًا" },

  // ─────────── A9 حقوق المستفيدين والإفصاح ───────────
  { code: "A9-01", axisCode: "A9", textAr: "هل يوجد سجل محدّث للمستفيدين وطبقاتهم واستحقاقهم؟", answerType: "maturity", weight: 3, factKey: "beneficiary_register", referenceText: "لائحة تنظيم أعمال النظارة، م10؛ جدول المخالفات 4-2" },
  { code: "A9-02", axisCode: "A9", textAr: "هل توجد قناة لاستقبال استفسارات المستفيدين وشكاواهم مع توثيق الرد؟", answerType: "maturity", weight: 2, factKey: "complaints_channel", referenceText: "لائحة تنظيم أعمال النظارة، م10؛ جدول المخالفات 4-3" },
  { code: "A9-03", axisCode: "A9", textAr: "هل يطّلع المستفيدون دوريًا على القوائم المالية؟", answerType: "maturity", weight: 2, factKey: "statements_shared", referenceText: "لائحة تنظيم أعمال النظارة، م10" },
  { code: "A9-04", axisCode: "A9", textAr: "هل يُفصح عن معايير التوزيع والمفاضلة وتوقيت الصرف؟", answerType: "maturity", weight: 1, factKey: "distribution_disclosure", referenceText: "مبادئ حوكمة الأوقاف، م3/أولًا/05 إلى 07" },
  { code: "A9-05", axisCode: "A9", textAr: "هل يصدر تقرير سنوي يشمل الميزانية والمكافآت والالتزام والمخاطر؟", answerType: "maturity", weight: 2, factKey: "annual_report", referenceText: "مبادئ حوكمة الأوقاف، م7/رابعًا/02" },

  // ─────────── A10 المخاطر والامتثال الرقابي ───────────
  { code: "A10-01", axisCode: "A10", textAr: "هل يوجد سجل محدث للمستفيدين الحقيقيين بالبيانات المطلوبة، مع تحقق سنوي؟", answerType: "maturity", weight: 3, factKey: "bo_register", referenceText: "معايير المستفيد الحقيقي من الأوقاف، م5 وم6" },
  { code: "A10-02", axisCode: "A10", textAr: "هل يوجد سجل مخاطر مصنف حسب الأثر والاحتمال؟", answerType: "maturity", weight: 2, factKey: "risk_register", referenceText: "الدليل المختصر لمهمات الناظر" },
  { code: "A10-03", axisCode: "A10", textAr: "هل حضر الناظر أو العاملون تدريبًا في مكافحة غسل الأموال؟", answerType: "yes_no", options: YN, weight: 1, factKey: "aml_training", referenceText: "لائحة تنظيم أعمال النظارة، م14/4" },
  { code: "A10-04", axisCode: "A10", textAr: "هل توجد آلية موثقة للصرف للمستحقين خارج المملكة وفق قواعد الحوالات؟", answerType: "yes_no", options: YN_NA, weight: 2, factKey: "foreign_transfers_ok", showIf: eq("beneficiaries_abroad", "yes"), referenceText: "لائحة تنظيم أعمال النظارة، م10" },
  { code: "A10-05", axisCode: "A10", textAr: "هل تلقيتم ملاحظة أو إنذارًا أو غرامة من الهيئة؟", answerType: "select", weight: 3, factKey: "gaa_notice",
    options: [{ value: "none", label: "لا", score: 5 }, { value: "resolved", label: "نعم، وعولجت", score: 3.5 }, { value: "open", label: "نعم، ولم تُعالج بعد", score: 0 }, { value: "repeat", label: "تكررت أكثر من مرة", score: 0 }, U],
    criticalFlagCode: "R13", criticalWhen: answerIn("open", "repeat"), referenceText: "لائحة تنظيم أعمال النظارة، م23 إلى م26" },
  { code: "A10-06", axisCode: "A10", textAr: "هل لدى الوقف ترخيص ساري لجمع التبرعات وحساب بنكي مخصص لها؟", answerType: "yes_no", options: YN, weight: 3, factKey: "donation_license",
    showIf: eq("collects_donations", "yes"), criticalFlagCode: "R08", criticalWhen: answerIn("no", "unknown"), referenceText: "لائحة إنشاء الأوقاف أو تمويلها عبر جمع التبرعات، م7 وم8" },

  // ─────────── A11 التحول الرقمي ───────────
  { code: "A11-01", axisCode: "A11", textAr: "هل للوقف نظام محاسبي إلكتروني؟", answerType: "yes_no", options: YN, weight: 2, factKey: "e_accounting" },
  { code: "A11-02", axisCode: "A11", textAr: "هل الأصول والمستفيدون في سجل رقمي واحد محدّث؟", answerType: "maturity", weight: 2, factKey: "digital_register" },
  { code: "A11-03", axisCode: "A11", textAr: "هل يتواصل الوقف مع المستفيدين بقناة إلكترونية؟", answerType: "yes_no", options: YN, weight: 1, factKey: "e_channel" },
];

export const FLAG_DEFS = [
  { code: "R01", titleAr: "لا يوجد حساب بنكي مستقل باسم الوقف", referenceText: "لائحة تنظيم أعمال النظارة م15/1؛ جدول المخالفات 5-2", penaltyText: "من أسباب العزل", penaltyCode: "5-2", axisCode: "A5", actionAr: "افتح حسابًا بنكيًا باسم الوقف وانقل إليه جميع أمواله فورًا.", severity: "critical" },
  { code: "R02", titleAr: "أموال الوقف مختلطة بأموال أخرى", referenceText: "لائحة تنظيم أعمال النظارة م15/1؛ جدول المخالفات 6-1", penaltyText: "من أسباب العزل", penaltyCode: "6-1", axisCode: "A5", actionAr: "افصل أموال الوقف وسوِّ القيود بإشراف محاسب.", severity: "critical" },
  { code: "R03", titleAr: "تصرف في أصل دون إذن الجهة المختصة", referenceText: "لائحة تنظيم أعمال النظارة م12/3 وم19؛ جدول المخالفات 3-1 و3-3", penaltyText: "العزل إن لم يكن لمصلحة الوقف، وإلا غرامة متدرجة", penaltyCode: "3-1", axisCode: "A2", actionAr: "استشر مختصًا قانونيًا فورًا لتصحيح الوضع وطلب الإذن.", severity: "critical" },
  { code: "R04", titleAr: "صرف لغير المستحقين أو بالمخالفة لشرط الواقف", referenceText: "لائحة تنظيم أعمال النظارة م9؛ جدول المخالفات 1-1 إلى 1-4", penaltyText: "تدرج يصل إلى العزل عند عدم التجاوب", penaltyCode: "1-3", axisCode: "A1", actionAr: "أوقف الصرف المخالف وأعد ضبطه وفق الشرط مع مستشار شرعي.", severity: "critical" },
  { code: "R05", titleAr: "الناظر فقد شرطًا من شروط النظارة", referenceText: "لائحة تنظيم أعمال النظارة م5 وم7/3؛ جدول المخالفات 5-1", penaltyText: "العزل", penaltyCode: "5-1", axisCode: "A3", actionAr: "رتّب انتقال النظارة وفق الوثيقة أو عبر الجهة المختصة.", severity: "critical" },
  { code: "R06", titleAr: "الناظر أو مدير الوقف مقيم خارج المملكة", referenceText: "معايير المستفيد الحقيقي من الأوقاف م8/1", penaltyText: "مخالفة تستوجب التصحيح", penaltyCode: null, axisCode: "A3", actionAr: "انقل الإدارة إلى مقيم في المملكة أو عيّن ناظرًا مقيمًا.", severity: "critical" },
  { code: "R07", titleAr: "تعاقد الناظر مع نفسه أو قريب حتى الدرجة الثانية", referenceText: "لائحة تنظيم أعمال النظارة م18/2؛ جدول المخالفات 5-3", penaltyText: "أعلى غرامات الجدول", penaltyCode: "5-3", axisCode: "A4", actionAr: "أوقف التعاقد وأفصح للهيئة واطلب رأيًا قانونيًا.", severity: "critical" },
  { code: "R08", titleAr: "جمع تبرعات دون ترخيص", referenceText: "لائحة تنظيم أعمال النظارة م10/2؛ لائحة جمع التبرعات م7؛ جدول المخالفات 2-4", penaltyText: "غرامة متدرجة", penaltyCode: "2-4", axisCode: "A10", actionAr: "أوقف جمع التبرعات حتى صدور الترخيص.", severity: "critical" },
  { code: "R09", titleAr: "تأخر صرف العوائد أو الامتناع عنه", referenceText: "لائحة تنظيم أعمال النظارة م13/1؛ جدول المخالفات 4-1 و4-4", penaltyText: "تدرج يصل إلى العزل عند الامتناع", penaltyCode: "4-4", axisCode: "A5", actionAr: "جدول الصرف فورًا ووثّقه بأرقام مرجعية.", severity: "critical" },
  { code: "R10", titleAr: "الوقف غير مسجل وقد تجاوز 30 يوم عمل من التوثيق", referenceText: "لائحة تنظيم أعمال النظارة م8/1؛ جدول المخالفات 7-2", penaltyText: "إنذار ثم غرامة", penaltyCode: "7-2", axisCode: "A2", actionAr: "سجّل الوقف لدى الهيئة عبر بوابتها الآن.", severity: "critical" },
  { code: "R11", titleAr: "وقف كبير أو متوسط بلا قوائم مالية مدققة", referenceText: "لائحة تنظيم أعمال النظارة م15/4؛ جدول المخالفات 6-5", penaltyText: "غرامة", penaltyCode: "6-5", axisCode: "A5", actionAr: "عيّن مراجعًا مستقلًا معتمدًا وأعدّ القوائم.", severity: "critical" },
  { code: "R12", titleAr: "ناظر اعتباري غير مرخص من الهيئة", referenceText: "لائحة تنظيم أعمال النظارة م5/2", penaltyText: "يفقد شرط النظارة", penaltyCode: null, axisCode: "A3", actionAr: "حصّل الترخيص أو رتّب نظارة بديلة.", severity: "critical" },
  { code: "R13", titleAr: "ملاحظة أو إنذار من الهيئة لم يُعالج", referenceText: "لائحة تنظيم أعمال النظارة م23 إلى م26", penaltyText: "التكرار يضاعف الغرامة", penaltyCode: null, axisCode: "A10", actionAr: "أعدّ خطة تصحيحية والتزم بمهلة الهيئة.", severity: "critical" },
  { code: "R14", titleAr: "الوثيقة لا تسمّي ناظرًا", referenceText: "نظام الهيئة العامة للأوقاف م5/3/أ", penaltyText: "تنبيه: قد تؤول النظارة إلى الهيئة", penaltyCode: null, axisCode: null, actionAr: "راجع الوثيقة مع مختص لضبط النظارة.", severity: "high" },
] as const;
