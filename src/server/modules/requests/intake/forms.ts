/**
 * Intake forms for every service in the catalog (PURE).
 *
 * Each form = the shared applicant step + the service's own steps + its document slots. Questions rest on the
 * service definition in the catalog and, where noted in `sources`, on the project reference files. A form never
 * asks for something a service does not need; anything a specialist needs later is raised as a deficiency item.
 * Bump `version` of a form when its questions change; stored answers keep the version they were given under.
 */
import type { Cond, DocSlot, Field, ServiceForm, Step } from "./engine";

// ───────────────────────── Field helpers ─────────────────────────

type Opt = Partial<Omit<Field, "key" | "label" | "type">>;
const f = (type: Field["type"]) => (key: string, label: string, o: Opt = {}): Field => ({ key, label, type, ...o });
const text = f("text");
const area = (key: string, label: string, o: Opt = {}) => f("textarea")(key, label, { wide: true, maxLength: 4000, ...o });
const sel = (key: string, label: string, options: readonly (readonly [string, string])[], o: Opt = {}) => f("select")(key, label, { options, ...o });
const radio = (key: string, label: string, options: readonly (readonly [string, string])[], o: Opt = {}) => f("radio")(key, label, { options, wide: true, ...o });
const checks = (key: string, label: string, options: readonly (readonly [string, string])[], o: Opt = {}) => f("checkboxes")(key, label, { options, wide: true, ...o });
const yn = f("yesno");
const num = (key: string, label: string, o: Opt = {}) => f("number")(key, label, { min: 0, ...o });
const money = (key: string, label: string, o: Opt = {}) => f("money")(key, label, { min: 0, ...o });
const pct = f("percent");
const date = f("date");
const ack = (key: string, label: string) => f("ack")(key, label, { required: true, wide: true });
const R = { required: true } as const;
/** Repeating rows (bequests, beneficiary classes, assets, parties…). */
const table = (key: string, label: string, columns: NonNullable<Field["columns"]>, o: Opt = {}) => f("table")(key, label, { columns, wide: true, ...o });
const RELATION = [["no", "ليس وارثًا"], ["yes", "وارث"], ["entity", "جهة (ليست شخصًا)"]] as const;
const when = (field: string, eq: string): Cond => ({ field, eq });
const yes = (field: string): Cond => ({ field, eq: "yes" });

const doc = (key: string, docType: string, label: string, o: Partial<DocSlot> = {}): DocSlot => ({ key, docType, label, ...o });

// ───────────────────────── Shared option lists ─────────────────────────

const ASSET_TYPES = [
  ["real_estate", "عقار"], ["cash", "نقد"], ["securities", "أسهم أو وحدات صناديق أو محفظة"], ["business", "منشأة أو حصص في شركة"],
  ["movable", "منقولات"], ["intangible", "حقوق معنوية"], ["benefit", "منافع"], ["other", "أخرى"],
] as const;
const WAQF_KIND = [["general", "وقف عام (خيري)"], ["ahli", "وقف أهلي (ذري)"], ["mixed", "وقف مشترك"], ["undecided", "لم أحدد بعد"]] as const;
const SIZE = [["large", "كبير"], ["medium", "متوسط"], ["small", "صغير"], ["direct_benefit", "ذو انتفاع مباشر"], ["unknown", "لا أعرف"]] as const;
const FREQ = [["monthly", "شهري"], ["quarterly", "ربع سنوي"], ["semiannual", "نصف سنوي"], ["annual", "سنوي"]] as const;
const MEETING = [["in_person", "حضوري"], ["online", "عن بعد"], ["either", "أيهما أنسب"]] as const;
const FIELDS = [
  ["education", "التعليم"], ["health", "الصحة"], ["social", "الرعاية الاجتماعية"], ["religious", "الشؤون الدينية والمساجد"],
  ["housing", "الإسكان"], ["environment", "البيئة"], ["research", "البحث والمعرفة"], ["other", "مجال آخر"],
] as const;
const DEED_ISSUER = [["notary", "كتابة العدل"], ["court", "المحكمة"], ["other", "جهة أخرى"]] as const;
const YEAR = (key = "fiscalYear", label = "السنة المالية المعنية") => num(key, label, { required: true, min: 1990, max: 2100, hint: "مثل 2025" });

// ───────────────────────── Shared applicant step ─────────────────────────

const CAPACITY: Record<string, readonly [string, string]> = {
  waqif: ["waqif", "الواقف أو من يريد إنشاء الوقف"],
  nazir: ["nazir", "ناظر الوقف"],
  board_member: ["board_member", "عضو مجلس النظارة"],
  beneficiary: ["beneficiary", "مستفيد (موقوف عليه)"],
  entity_rep: ["entity_rep", "ممثل جهة اعتبارية"],
  heir: ["heir", "وارث أو ممثل الورثة"],
  agent: ["agent", "وكيل عن صاحب الشأن بموجب وكالة"],
};
const AUDIENCE_CAPACITY: Record<string, string[]> = {
  waqif: ["waqif"], nazir: ["nazir"], board: ["board_member"], beneficiary: ["beneficiary"], entity: ["entity_rep"],
};

/**
 * Who is asking and in what capacity. Representation follows نظام المعاملات المدنية م87–م90 (التعاقد بالنيابة في
 * حدود سند النيابة): an agent states the principal and the power of attorney, which is then attached.
 */
export function applicantStep(audiences: string[], extra: string[] = []): { step: Step; docs: DocSlot[] } {
  const keys = [...new Set([...audiences.flatMap((a) => AUDIENCE_CAPACITY[a] ?? []), ...extra, "agent"])];
  const options = keys.map((k) => CAPACITY[k]).filter(Boolean);
  const agent = when("capacity", "agent");
  const entity = when("capacity", "entity_rep");
  return {
    step: {
      key: "applicant",
      title: "مقدم الطلب وصفته",
      intro: "عبّأنا بيانات التواصل من حسابك. صحّحها إن لزم.",
      fields: [
        radio("capacity", "صفتك في هذا الطلب", options, R),
        text("principalName", "اسم صاحب الشأن الذي تنوب عنه", { requiredIf: agent, showIf: agent }),
        text("poaNumber", "رقم الوكالة", { requiredIf: agent, showIf: agent, hint: "الوكالة الصادرة من كتابة العدل أو عبر «ناجز»." }),
        date("poaDate", "تاريخ الوكالة", { showIf: agent }),
        text("entityName", "اسم الجهة", { requiredIf: entity, showIf: entity }),
        text("entityNumber", "رقم السجل أو الرقم الوطني الموحد للجهة", { showIf: entity }),
        text("entityPosition", "منصبك في الجهة", { requiredIf: entity, showIf: entity }),
        text("contactName", "الاسم الكامل", { ...R, prefill: "user.fullName" }),
        f("phone")("contactPhone", "رقم الجوال", { ...R, prefill: "user.phone" }),
        f("email")("contactEmail", "البريد الإلكتروني", { prefill: "user.email" }),
        sel("preferredContact", "وسيلة التواصل المفضلة", [["platform", "رسائل المنصة"], ["phone", "اتصال هاتفي"], ["email", "البريد الإلكتروني"], ["whatsapp", "واتساب"]], R),
        sel("priority", "الأولوية", [["normal", "عادية"], ["high", "مرتفعة"], ["urgent", "عاجل (موعد نظامي قريب)"], ["low", "منخفضة"]], R),
        date("deadline", "موعد يهمك (إن وجد)", { hint: "موعد نظامي أو اجتماع أو مهلة لدى جهة." }),
        text("deadlineReason", "سبب الموعد", { showIf: { field: "deadline", notEmpty: true }, requiredIf: { field: "deadline", notEmpty: true } }),
      ],
    },
    docs: [
      doc("poa", "power_of_attorney", "صورة الوكالة", { requiredIf: agent, showIf: agent }),
      doc("authorization", "resolution", "ما يثبت تفويضك بتمثيل الجهة (قرار أو خطاب تفويض)", { requiredIf: entity, showIf: entity }),
    ],
  };
}

const NOTES: Step = {
  key: "notes",
  title: "ملاحظات إضافية",
  fields: [area("notes", "ما الذي تريد أن يعرفه الفريق أيضًا؟ (اختياري)", { hint: "سياق أو تفضيلات أو أسئلة لم تشملها الخطوات السابقة." })],
};

// ───────────────────────── Reusable service blocks ─────────────────────────

const deedBlock = (required = true): Field[] => [
  text("deedNo", "رقم صك الوقف أو وثيقته", { ...(required ? R : {}), prefill: "waqf.deedNo" }),
  sel("deedIssuer", "جهة الإصدار", DEED_ISSUER),
  text("deedDate", "تاريخ الوثيقة (هجري أو ميلادي)"),
];

const consultation = (code: string, topic: string, extra: Field[] = [], sources: string[] = []): ServiceForm => ({
  code, version: 1, sources: ["تعريف الخدمة في كتالوج «وقفك» (رأي مكتوب موقّع)", ...sources], docs: [doc("related", "other", "مستندات تتعلق بالمسألة")],
  steps: [{
    key: "question", title: `مسألتك (${topic})`,
    intro: "اكتب المسألة كما هي. يصدر الرأي مكتوبًا موقّعًا من المستشار المختص بعد دراستها.",
    fields: [
      area("question", "المسألة أو السؤال", { ...R, minLength: 30 }),
      area("background", "الوقائع والخلفية", { hint: "التواريخ والأطراف والمستندات ذات الصلة." }),
      yn("relatedToWaqf", "هل تتعلق المسألة بوقف محدد؟"),
      sel("urgency", "متى تحتاج الرأي؟", [["normal", "في المدة المعتادة"], ["soon", "خلال أسبوع"], ["urgent", "خلال أيام (موعد نظامي)"]]),
      ...extra,
    ],
  }],
});

// ───────────────────────── Service forms ─────────────────────────

const FORMS: Record<string, Omit<ServiceForm, "steps"> & { steps: Step[] }> = {
  // ── T التأسيس والتصميم
  T01: {
    code: "T01", version: 1,
    sources: ["الدليل الإرشادي لاختيار الأصول الوقفية: معايير مدة الوقف وحجمه ونوع الموقوف عليهم وقابلية النمو والاستدامة والإدارة"],
    docs: [],
    steps: [{
      key: "design", title: "فكرة وقفك",
      fields: [
        checks("assetTypes", "ما الأصول التي تفكر في وقفها؟", ASSET_TYPES, R),
        money("estimatedValue", "القيمة التقديرية للأصول (ر.س)", { hint: "تقدير تقريبي يكفي." }),
        area("purpose", "المصارف أو الجهات التي تريد أن ينفعها الوقف", R),
        sel("waqfKind", "نوع الوقف المبدئي", WAQF_KIND, R),
        sel("nazaraPreference", "من تفضّل أن يتولى النظارة؟", [["self", "أنا"], ["family", "من أسرتي"], ["board", "مجلس نظارة"], ["entity", "جهة اعتبارية"], ["undecided", "لم أحدد"]]),
        sel("sessionMode", "طريقة الجلسة", MEETING, R),
        text("preferredTimes", "الأوقات المناسبة للجلسة"),
      ],
    }],
  },
  T02: {
    code: "T02", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("studies", "other", "دراسات أو بيانات سابقة عن المجال")],
    steps: [{
      key: "need", title: "المجال والنطاق",
      fields: [
        sel("field", "المجال", FIELDS, R),
        text("fieldOther", "حدد المجال", { showIf: when("field", "other"), requiredIf: when("field", "other") }),
        text("geography", "النطاق الجغرافي", { ...R, hint: "مدينة أو منطقة أو المملكة كلها." }),
        text("targetGroup", "الفئة المستهدفة إن وجدت"),
        money("annualBudget", "الريع السنوي المتوقع للمصرف (ر.س)"),
        yn("hasStudies", "هل لديك دراسات أو بيانات سابقة؟"),
      ],
    }],
  },
  T03: {
    code: "T03", version: 2,
    sources: [
      "الدليل الإرشادي لصياغة وثيقة الوقف (المبدأ الأول): البنود العشرة — المقدمة وبيانات الواقف، الأصل، اسم الوقف، المصارف وطبقاتها والترتيب بينها وبدائلها، استثناء الانتفاع، النظارة، واجبات الناظر، المجلس، الخاتمة، التوقيع والشهود",
      "الدليل الإرشادي لصياغة وثيقة الوقف م11–م14: وصف الأصل بما يميزه وصك ملكيته الساري وما يلحق به وحصة المشاع",
      "الدليل الإرشادي للواقفين (صياغة صك الوقفية): مصارف مصلحة الوقف من صيانة واستثمار، وآلية استخلاف الناظر",
      "100 سؤال وجواب س28: لا يوقف العقار المرهون إلا بعد سداد الرهن أو موافقة المرتهن",
    ],
    docs: [
      doc("ownership", "ownership_deed", "صك ملكية الأصل الموقوف أو مستند ملكيته", { required: true, hint: "يشترط أن يكون الأصل مملوكًا للواقف ومسجلًا باسمه بصك ساري." }),
      doc("waqifId", "id_document", "هوية الواقف"),
      doc("mortgagee", "official_letter", "موافقة المرتهن", { showIf: yes("mortgaged"), requiredIf: yes("mortgaged") }),
    ],
    steps: [
      {
        key: "waqif", title: "الواقف واسم الوقف",
        fields: [
          text("waqifName", "اسم الواقف كما في الهوية", { ...R, prefill: "user.fullName" }),
          f("idnumber")("waqifId", "رقم هوية الواقف", R),
          text("waqfName", "الاسم المقترح للوقف", R),
          sel("waqfKind", "نوع الوقف", WAQF_KIND, R),
        ],
      },
      {
        key: "asset", title: "الأصل الموقوف",
        fields: [
          sel("assetType", "نوع الأصل", ASSET_TYPES, R),
          area("assetDescription", "وصف الأصل بما يميزه", { ...R, minLength: 15, hint: "للعقار: المدينة والحي ورقم القطعة والحدود والمساحة. للأسهم: الشركة وعدد الأسهم." }),
          text("ownershipDeedNo", "رقم صك الملكية أو مستندها", R),
          date("ownershipDeedDate", "تاريخ الصك"),
          yn("registeredToWaqif", "هل الأصل مملوك ومسجل باسم الواقف بصك ساري؟", R),
          yn("mortgaged", "هل الأصل مرهون؟", R),
          radio("share", "هل الوقف على كامل الأصل أم على حصة منه؟", [["whole", "كامل الأصل"], ["share", "حصة مشاعة"]], R),
          pct("sharePercent", "نسبة الحصة", { showIf: when("share", "share"), requiredIf: when("share", "share") }),
          radio("appurtenances", "ما يلحق بالأصل", [["all", "يشمل الوقف الأصل بجميع حقوقه وما فيه"], ["except", "يُستثنى منه جزء محدد"]], R),
          text("exceptionPart", "الجزء المستثنى", { showIf: when("appurtenances", "except"), requiredIf: when("appurtenances", "except") }),
        ],
      },
      {
        key: "masarif", title: "المصارف والمستحقون",
        fields: [
          table("masarif", "المصارف وطبقات المستحقين", [
            { key: "tier", label: "الطبقة (الترتيب)", type: "number", required: true, min: 1, max: 20 },
            { key: "beneficiary", label: "المصرف أو المستحق (اسمًا أو وصفًا)", type: "text", required: true },
            { key: "share", label: "النصيب من الريع", type: "percent" },
            { key: "division", label: "القسمة بين أهل الطبقة", type: "select", options: [["equal", "بالتساوي"], ["inheritance", "للذكر مثل حظ الأنثيين"], ["na", "لا ينطبق (جهة)"]] },
          ], { ...R, minRows: 1, hint: "الطبقة 1 تستحق أولًا، ثم من بعدها عند انقطاعها. الواو بين المستحقين تقتضي التسوية (الدليل الاسترشادي لتصنيف الوقف)." }),
          text("alternateMasraf", "المصرف البديل إذا انقطع المستحقون", { ...R, hint: "الدليل الإرشادي لصياغة وثيقة الوقف: بيان بدائل المصارف." }),
          pct("reservePercent", "نسبة تُستقطع من الريع لعمارة الوقف وصيانته وتنميته", { hint: "اتركها فارغة إن تُركت لتقدير الناظر." }),
          yn("selfBenefit", "هل تستثني لنفسك الانتفاع بالوقف في حياتك؟", R),
          radio("selfBenefitScope", "مقدار الانتفاع", [["all", "كامل الريع"], ["part", "جزء من الريع"], ["use", "السكنى أو الانتفاع بالعين"]], { showIf: yes("selfBenefit"), requiredIf: yes("selfBenefit") }),
        ],
      },
      {
        key: "nazara", title: "النظارة",
        fields: [
          radio("nazirType", "من يتولى النظارة", [["self", "الواقف نفسه حال حياته"], ["named", "شخص يُسمّى"], ["board", "مجلس نظارة"], ["entity", "جهة اعتبارية (مثل شركة نظارة مرخصة)"]], R),
          text("nazirName", "اسم الناظر أو الجهة", { showIf: { field: "nazirType", in: ["named", "entity"] }, requiredIf: { field: "nazirType", in: ["named", "entity"] } }),
          num("boardSize", "عدد أعضاء المجلس", { showIf: when("nazirType", "board"), requiredIf: when("nazirType", "board"), min: 3, max: 15 }),
          radio("succession", "استخلاف الناظر بعد خلو النظارة", [["eldest", "الأصلح فالأصلح من الموقوف عليهم"], ["named", "من يسميه الناظر قبله كتابةً"], ["board", "ينتخبه المجلس"], ["authority", "تعيّنه الجهة المختصة"]], R),
          yn("investmentAllowed", "هل تجيز للناظر استثمار الوقف وتنميته؟", R),
          yn("amendmentRight", "هل تشترط لنفسك حق تعديل بعض الشروط؟", { hint: "التعديل بعد الثبوت لا يتم إلا بموافقة الجهة المختصة (100 سؤال، س76)." }),
        ],
      },
    ],
  },
  T04: {
    code: "T04", version: 1, sources: ["تعريف الخدمة في الكتالوج", "لائحة تنظيم أعمال النظارة م9/2–3: التحقق من شرط الواقف، وعدم مخالفته إلا بإذن الجهة المختصة"],
    docs: [doc("deed", "waqf_deed", "وثيقة الوقف أو صكه", { required: true })],
    steps: [{
      key: "deed", title: "الوثيقة القائمة",
      fields: [
        ...deedBlock(),
        yn("waqifAlive", "هل الواقف على قيد الحياة؟", R),
        area("concerns", "ما الذي يقلقك في الوثيقة أو تريد مراجعته؟", { ...R, minLength: 15 }),
        radio("outcome", "ما المطلوب؟", [["review", "تقرير مراجعة فقط"], ["amend", "تقرير مع صياغات بديلة مقترحة"]], R),
      ],
    }],
  },
  T05: {
    code: "T05", version: 2, sources: ["الدليل الإرشادي لاختيار الأصول الوقفية: المعايير الستة لاختيار الأصل"],
    docs: [doc("assets", "ownership_deed", "مستندات الأصول المرشحة")],
    steps: [{
      key: "assets", title: "الأصول المرشحة والمعايير",
      fields: [
        table("candidates", "الأصول المتاحة لك للوقف", [
          { key: "type", label: "نوع الأصل", type: "select", required: true, options: ASSET_TYPES },
          { key: "description", label: "الوصف والموقع", type: "text", required: true },
          { key: "value", label: "القيمة التقريبية (ر.س)", type: "money" },
          { key: "income", label: "الدخل السنوي الحالي إن وجد (ر.س)", type: "money" },
          { key: "owned", label: "مملوك ومسجل باسمك بصك ساري؟", type: "select", options: [["yes", "نعم"], ["no", "لا"], ["partial", "حصة مشاعة"]] },
        ], { ...R, minRows: 1, hint: "صف كل أصل في صف: يُقارن بالمعايير الستة في الدليل." }),
        radio("duration", "مدة الوقف", [["perpetual", "مؤبد"], ["temporary", "مؤقت"], ["undecided", "لم أحدد"]], R),
        sel("sizeEstimate", "الحجم المتوقع للوقف", SIZE, R),
        sel("beneficiaryKind", "نوع الموقوف عليهم", WAQF_KIND, R),
        sel("management", "من سيدير الأصل؟", [["self", "الناظر بنفسه"], ["professional", "جهة احترافية مختصة"], ["undecided", "لم أحدد"]]),
        area("goals", "غاية الوقف التي تريد أن يخدمها الأصل"),
      ],
    }],
  },
  T06: {
    code: "T06", version: 1,
    sources: [
      "الدليل الإرشادي للواقفين 2.2–2.3: التوثيق عبر «ناجز» أصالة أو وكالة، وإرفاق المستندات",
      "دليل خدمة وقف جديد في بوابة الهيئة (8589_1): إرفاق صك الوقفية وصك النظارة",
      "لائحة تنظيم أعمال النظارة م8: تسجيل الوقف لدى الهيئة",
    ],
    docs: [
      doc("deed", "waqf_deed", "صك الوقفية أو وثيقة الوقف", { requiredIf: { field: "stage", in: ["documented", "registered"] }, showIf: { field: "stage", in: ["documented", "registered"] } }),
      doc("nazara", "nazara_deed", "صك النظارة", { requiredIf: { field: "stage", in: ["documented", "registered"] }, showIf: { field: "stage", in: ["documented", "registered"] } }),
      doc("ownership", "ownership_deed", "صكوك ملكية الأصول", { requiredIf: when("stage", "not_documented") }),
      doc("specialPoa", "power_of_attorney", "الوكالة الخاصة لـ«وقفك» بتنفيذ الإجراءات", { showIf: when("mode", "poa") }),
    ],
    steps: [{
      key: "stage", title: "أين وصل وقفك؟",
      fields: [
        radio("stage", "المرحلة الحالية", [["not_documented", "لم يُوثّق بعد"], ["documented", "موثّق ولم يُسجَّل لدى الهيئة"], ["registered", "مسجّل ويحتاج تحديثًا"]], R),
        sel("channel", "قناة التوثيق", [["najiz", "«ناجز» (كتابة العدل)"], ["court", "المحكمة المختصة"], ["unknown", "لا أعرف"]], { showIf: when("stage", "not_documented"), requiredIf: when("stage", "not_documented") }),
        radio("mode", "كيف تريد التنفيذ؟", [["support", "تجهّزون الحزمة وأقدّمها بنفسي"], ["poa", "تنفذون الإجراءات بوكالة خاصة"]], R),
        text("registrationNo", "رقم شهادة التسجيل الحالية", { showIf: when("stage", "registered"), prefill: "waqf.registrationCertNo" }),
        area("changes", "ما الذي تغيّر ويحتاج تحديثًا؟", { showIf: when("stage", "registered"), requiredIf: when("stage", "registered") }),
      ],
    }],
  },
  T07: {
    code: "T07", version: 1,
    sources: ["لائحة المنتجات الاستثمارية الوقفية م20–م23: بيانات الوثيقة، وتسجيل الوقف خلال 5 أيام عمل، وفتح الحساب الاستثماري ونقل الأصول دون صفقات"],
    docs: [doc("holdings", "financial_statement", "كشف بالأسهم أو الوحدات المراد وقفها", { required: true })],
    steps: [{
      key: "asset", title: "الأصل المالي",
      fields: [
        sel("assetKind", "نوع الأصل", [["shares", "أسهم"], ["fund_units", "وحدات صناديق"], ["portfolio", "محفظة استثمارية"], ["cash", "نقد للاستثمار"]], R),
        money("value", "القيمة التقريبية (ر.س)", R),
        text("custodian", "مؤسسة السوق المالية التي يُحفظ لديها الأصل", R),
        yn("existingWaqfPortfolio", "هل للوقف محفظة استثمارية وقفية قائمة؟"),
        area("terms", "شروطك في الريع والتوزيع وإعادة الاستثمار"),
      ],
    }],
  },
  T08: {
    code: "T08", version: 1, sources: ["تعريف الخدمة في الكتالوج: المتقدم شخص اعتباري، والمنصة لا تستقبل التبرعات", "100 سؤال وجواب س43: موافقة الهيئة على الأوقاف الممولة بجمع التبرعات"],
    docs: [
      doc("entityCert", "other", "شهادة تسجيل الجهة المتقدمة", { required: true }),
      doc("boardResolution", "resolution", "قرار الجهة بالتقدم بطلب الترخيص", { required: true }),
    ],
    steps: [{
      key: "entity", title: "الجهة والوقف المراد إنشاؤه",
      fields: [
        text("entityLegalName", "الاسم الرسمي للجهة المتقدمة", R),
        sel("entityType", "نوع الجهة", [["association", "جمعية أهلية"], ["foundation", "مؤسسة أهلية"], ["company", "شركة"], ["government", "جهة حكومية"], ["other", "أخرى"]], R),
        text("entityUnifiedNo", "الرقم الوطني الموحد أو رقم التسجيل", R),
        area("waqfPurpose", "غرض الوقف ومصارفه", R),
        money("targetAmount", "المبلغ المستهدف جمعه (ر.س)", R),
        area("channels", "قنوات جمع التبرعات المقترحة", R),
        num("durationMonths", "مدة الحملة (بالأشهر)", { min: 1, max: 120 }),
      ],
    }],
  },
  T09: {
    code: "T09", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("assets", "ownership_deed", "مستندات الأصول المراد نقلها للكيان")],
    steps: [{
      key: "entity", title: "الكيان المطلوب",
      fields: [
        sel("form", "الشكل المفضل", [["waqf_company", "شركة وقفية"], ["foundation", "مؤسسة وقفية"], ["undecided", "أحتاج توصية"]], R),
        num("founders", "عدد المؤسسين", { min: 1 }),
        money("capital", "رأس المال أو قيمة الأصول التقريبية (ر.س)"),
        area("purpose", "غرض الكيان ونشاطه", R),
        yn("existingWaqf", "هل يرتبط الكيان بوقف قائم؟"),
      ],
    }],
  },

  // ── W الوصايا
  W01: {
    // v3: the type of will is chosen first — a pure will (no waqf after death) or a will that includes a waqf after
    // death — and decides the questions, the checks and the document (replaces the v2 «includesWaqf» question).
    code: "W01", version: 3,
    sources: [
      "الدليل الإرشادي لصياغة وثيقة الوقف (المبدأ الثاني): بيان حال ما قبلها من وصايا، والأفضل وصية واحدة، والنص على تاريخ المعدّلة أو إلغاء ما سبقها",
      "100 سؤال وجواب س16 وس75: الوقف المعلق على الموت يأخذ حكم الوصية؛ يجوز الرجوع عنه قبل الموت، ولا يلزم إلا في حدود ثلث التركة إلا بإجازة الورثة",
      "الدليل الإرشادي للواقفين: توثيق الوصية بالوقف عبر «ناجز» أصالة أو وكالة، ويلزم الإشهاد على الوصية غير الموثقة",
    ],
    docs: [
      doc("previousWill", "other", "الوصية السابقة", { showIf: yes("hasPreviousWill"), requiredIf: yes("hasPreviousWill") }),
      doc("testatorId", "id_document", "هوية الموصي"),
      doc("assetDocs", "ownership_deed", "مستندات ملكية الأعيان الموصى بها (إن وُجدت)"),
    ],
    steps: [
      {
        key: "type", title: "نوع الوصية",
        intro: "الوصية الخالصة لا تتضمن وقفًا بعد الوفاة. والوصية المتضمنة وقفًا تُجمع فيها بيانات الوقف (المال الموقوف، والمصارف، والناظر، والشروط)، ولا يُعد الوقف قائمًا أو موثقًا بمجرد إعداد الوصية.",
        fields: [
          radio("willType", "ما نوع الوصية المطلوبة؟", [["pure", "وصية خالصة لا تتضمن وقفًا بعد الوفاة"], ["with_waqf", "وصية تتضمن وقفًا بعد الوفاة"]], R),
        ],
      },
      {
        key: "testator", title: "الموصي",
        fields: [
          text("testatorName", "اسم الموصي كما في الهوية", { ...R, prefill: "user.fullName" }),
          f("idnumber")("testatorId", "رقم هوية الموصي", R),
        ],
      },
      {
        key: "previous", title: "الوصايا السابقة",
        fields: [
          yn("hasPreviousWill", "هل لك وصية سابقة؟", R),
          date("previousWillDate", "تاريخ الوصية السابقة", { showIf: yes("hasPreviousWill"), requiredIf: yes("hasPreviousWill") }),
          radio("previousWillAction", "ما حكم الوصية السابقة في هذه الوصية؟", [["revoke", "تُلغى الوصايا السابقة كلها وتحل هذه محلها"], ["amend", "تُعدَّل بما في هذه الوصية ويبقى ما لم يُعدَّل"]], { showIf: yes("hasPreviousWill"), requiredIf: yes("hasPreviousWill") }),
        ],
      },
      {
        key: "bequests", title: "الوصايا",
        requireRows: [{ field: "bequests", col: "kind", value: "waqf", when: when("willType", "with_waqf"), message: "اخترت وصية تتضمن وقفًا بعد الوفاة: أضف في الجدول صف «وقف بعد الوفاة» بمقداره." }],
        fields: [
          table("bequests", "ما توصي به", [
            { key: "kind", label: "نوع الوصية", type: "select", required: true, options: [["waqf", "وقف بعد الوفاة"], ["charity", "صدقة أو تبرع لجهة"], ["person", "لشخص معيّن"], ["other", "أخرى"]], hideOptions: { when: when("willType", "pure"), values: ["waqf"] } },
            { key: "recipient", label: "الموصى له (الجهة أو الشخص أو المصرف)", type: "text", required: true },
            { key: "relation", label: "صفة الموصى له", type: "select", required: true, options: RELATION },
            { key: "basis", label: "مقدار الوصية", type: "select", required: true, options: [["share", "نسبة من التركة"], ["amount", "مبلغ محدد"], ["asset", "عين محددة"]] },
            { key: "percent", label: "النسبة من التركة", type: "percent", required: true, showIf: { col: "basis", in: ["share"] } },
            { key: "amount", label: "المبلغ (ر.س)", type: "money", required: true, showIf: { col: "basis", in: ["amount"] } },
            { key: "asset", label: "وصف العين", type: "text", required: true, showIf: { col: "basis", in: ["asset"] } },
          ], { ...R, minRows: 1, hint: "الوقف المعلق على الموت لا يلزم فيما زاد على ثلث التركة إلا بإجازة الورثة (100 سؤال، س16 وس75). والوصية لأحد الورثة يراجع المستشار الشرعي حكمها." }),
          money("estimatedEstate", "تقدير إجمالي التركة (اختياري)", { hint: "يساعد على التحقق من حد الثلث في الوصايا بالمبالغ. لا يُطبع في الوصية." }),
        ],
      },
      {
        key: "waqf", title: "الوقف بعد الوفاة",
        showIf: when("willType", "with_waqf"),
        intro: "حدّد في جدول الوصايا صف «وقف بعد الوفاة» بمقداره (نسبة أو مبلغ أو عين)، ثم بيّن هنا على من تُصرف غلته ومن يتولاه وشروطه. لا يُنشأ ملف وقف من الوصية؛ يُنشأ عند تنفيذها بعد الوفاة.",
        fields: [
          text("waqfName", "الاسم المقترح للوقف"),
          table("waqfMasarif", "مصارف الوقف", [
            { key: "beneficiary", label: "المصرف", type: "text", required: true },
            { key: "share", label: "النصيب من الريع", type: "percent" },
          ], { ...R, minRows: 1 }),
          text("waqfNazir", "ناظر الوقف بعد الوفاة", R),
          radio("waqfSuccession", "استخلاف الناظر", [["eldest", "الأصلح فالأصلح من الموقوف عليهم"], ["named", "من يسميه الناظر قبله كتابةً"], ["authority", "تعيّنه الجهة المختصة"]], R),
          area("waqfConditions", "شروط الوقف المقترحة (اختياري)", { hint: "مثال: تقديم عمارة الأصل على الصرف، أو استثمار جزء من الغلة. يراجعها المختص قبل اعتمادها في النص." }),
          text("waqfFinal", "المآل إذا انقطعت المصارف (اختياري)"),
        ],
      },
      {
        key: "executor", title: "منفذ الوصية والتوثيق",
        fields: [
          text("executorName", "الوصي (منفذ الوصية)", R),
          sel("executorRelation", "صفة الوصي", [["heir", "أحد الورثة"], ["relative", "قريب ليس وارثًا"], ["other", "شخص آخر"], ["entity", "جهة"]], R),
          text("alternateExecutor", "وصي بديل إن تعذّر الأول"),
          radio("documentation", "كيف ستوثّق الوصية؟", [["najiz", "لدى الجهة المختصة عبر «ناجز»"], ["witnesses", "بالإشهاد عليها الآن، والتوثيق لاحقًا"]], R),
          table("witnesses", "الشهود", [
            { key: "name", label: "اسم الشاهد", type: "text", required: true },
            { key: "id", label: "رقم الهوية", type: "idnumber" },
          ], { showIf: when("documentation", "witnesses"), requiredIf: when("documentation", "witnesses"), minRows: 1, hint: "يلزم الإشهاد على الوصية التي لم توثق لدى الجهة المختصة (الدليل الإرشادي للواقفين)." }),
        ],
      },
    ],
  },
  W02: {
    code: "W02", version: 1, sources: ["الدليل الإرشادي للواقفين: التوثيق عبر «ناجز»، ويقدّم الوكيل بوكالة «إثبات وصية»"],
    docs: [doc("willText", "other", "نص الوصية المراد توثيقها", { required: true }), doc("specialPoa", "power_of_attorney", "وكالة «إثبات وصية»", { showIf: when("mode", "poa") })],
    steps: [{
      key: "mode", title: "التوثيق",
      fields: [
        yn("textReady", "هل نص الوصية جاهز ومراجع؟", R),
        radio("mode", "كيف تريد التنفيذ؟", [["support", "تجهّزون الحزمة وأقدّمها بنفسي"], ["poa", "تنفذون التوثيق بوكالة"]], R),
      ],
    }],
  },
  W03: {
    code: "W03", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("will", "other", "الوصية القائمة", { required: true })],
    steps: [{
      key: "will", title: "الوصية القائمة",
      fields: [date("willDate", "تاريخ الوصية"), yn("documented", "هل الوصية موثقة؟", R), area("concerns", "ما الذي تريد دراسته أو تطويره؟", { ...R, minLength: 15 })],
    }],
  },
  W04: {
    code: "W04", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [],
    steps: [{
      key: "council", title: "مجلس الأوصياء",
      fields: [
        num("members", "عدد الأعضاء المقترح", { ...R, min: 2, max: 25 }),
        sel("decisionRule", "آلية اتخاذ القرار", [["majority", "الأغلبية"], ["two_thirds", "الثلثان"], ["unanimous", "الإجماع"], ["undecided", "أحتاج توصية"]], R),
        area("powers", "الصلاحيات المطلوبة للمجلس", R),
      ],
    }],
  },
  W05: {
    code: "W05", version: 1, sources: ["تعريف الخدمة في الكتالوج", "100 سؤال وجواب س19: إثبات الوقف ونقل ملكية الأصل إلى الوقف"],
    docs: [
      doc("will", "other", "الوصية أو ما يثبتها", { required: true }),
      doc("heirs", "official_letter", "صك حصر الورثة", { required: true }),
      doc("assets", "ownership_deed", "مستندات الأصول التي تدخل في الوصية"),
    ],
    steps: [{
      key: "estate", title: "الوصية والتركة",
      fields: [
        text("deceasedName", "اسم الموصي المتوفى", R),
        date("deathDate", "تاريخ الوفاة", R),
        yn("willDocumented", "هل الوصية موثقة؟", R),
        num("heirsCount", "عدد الورثة", { min: 1 }),
        sel("heirsAgree", "موقف الورثة من تنفيذ الوصية", [["all", "متفقون"], ["some", "بعضهم معترض"], ["unknown", "غير معروف"]], R),
        area("assets", "الأصول التي تدخل في الوصية بالوقف", R),
      ],
    }],
  },

  // ── N النظارة والإدارة
  N01: {
    code: "N01", version: 2,
    sources: ["لائحة تنظيم أعمال النظارة م4–م7، م8، م15 (قائمة استلام ملف النظارة)", "الدليل المختصر لمهمات الناظر: حماية أصول الوقف وعقوده"],
    docs: [],
    steps: [{
      key: "nazara", title: "حال النظارة اليوم",
      fields: [
        radio("currentState", "حال النظارة", [["vacant", "شاغرة"], ["resigning", "الناظر الحالي يرغب في التخلي عنها"], ["waqif_appoints", "الواقف يريد تعيين «وقفك»"], ["authority", "بقرار من الجهة المختصة"], ["other", "حال أخرى"]], R),
        text("currentNazir", "اسم الناظر الحالي أو السابق", { showIf: { field: "currentState", in: ["resigning", "other"] } }),
        checks("reasons", "أسباب طلب تولي «وقفك» النظارة", [["no_nazir", "لا يوجد ناظر قادر على القيام بها"], ["dispute", "خلاف بين المستحقين أو النظار"], ["professional", "الرغبة في إدارة مهنية مستقلة"], ["waqif_choice", "اختيار الواقف"], ["compliance", "تصحيح وضع نظامي متأخر"], ["other", "سبب آخر"]], R),
        area("reason", "تفاصيل إضافية عن السبب (اختياري)", { maxLength: 1500 }),
      ],
    }, {
      key: "assets", title: "أصول الوقف وعقوده",
      fields: [
        table("assets", "الأصول القائمة", [
          { key: "type", label: "نوع الأصل", type: "select", required: true, options: ASSET_TYPES },
          { key: "description", label: "الوصف", type: "text", required: true },
          { key: "deedNo", label: "رقم الصك أو المستند", type: "text" },
          { key: "value", label: "القيمة التقديرية (ر.س)", type: "money" },
          { key: "leased", label: "عليه عقد إيجار أو استثمار؟", type: "select", options: [["yes", "نعم"], ["no", "لا"]] },
        ], { ...R, minRows: 1 }),
        num("beneficiariesCount", "عدد المستفيدين التقريبي", { min: 0 }),
        yn("bankAccount", "هل للوقف حساب بنكي باسمه؟", R),
        yn("statements", "هل للوقف قوائم أو بيانات مالية لآخر سنة؟", R),
        yn("litigation", "هل على الوقف دعاوى أو مطالبات قائمة؟", R),
        table("cases", "الدعاوى والمطالبات", [
          { key: "subject", label: "الموضوع", type: "text", required: true },
          { key: "party", label: "الطرف الآخر", type: "text" },
          { key: "stage", label: "المرحلة", type: "select", options: [["pre", "قبل رفع الدعوى"], ["filed", "منظورة"], ["judged", "صدر فيها حكم"]] },
        ], { showIf: yes("litigation"), requiredIf: yes("litigation"), minRows: 1 }),
      ],
    }],
  },
  N02: {
    code: "N02", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("charter", "regulation", "ميثاق المجلس أو لائحته إن وجدت")],
    steps: [{ key: "board", title: "المجلس", fields: [num("boardSize", "عدد أعضاء المجلس الحالي", { ...R, min: 1 }), num("meetings", "عدد الاجتماعات في السنة", { min: 0 }), text("committees", "اللجان القائمة"), num("termMonths", "مدة العضوية المطلوبة (بالأشهر)", { min: 1 })] }],
  },
  N03: {
    code: "N03", version: 1, sources: ["تعريف الخدمة في الكتالوج: القرار للناظر"], docs: [],
    steps: [{
      key: "support", title: "المساندة المطلوبة",
      fields: [
        radio("nazirForm", "شكل النظارة", [["individual", "ناظر فرد"], ["board", "مجلس نظارة"], ["entity", "جهة اعتبارية"]], R),
        checks("focus", "مجالات المساندة", [["compliance", "الالتزامات النظامية"], ["finance", "المالية"], ["investment", "الاستثمار"], ["governance", "الحوكمة"], ["beneficiaries", "المستفيدون"]], R),
        sel("frequency", "دورية اللقاءات", FREQ, R),
      ],
    }],
  },
  N04: {
    code: "N04", version: 1, sources: ["لائحة تنظيم أعمال النظارة م11/4: يُشترط في المفوَّض ما يُشترط في الناظر، والمسؤولية تضامنية"],
    docs: [doc("nazara", "nazara_deed", "صك النظارة", { required: true }), doc("ownership", "ownership_deed", "صكوك الأصول المشمولة بالإدارة")],
    steps: [{
      key: "scope", title: "نطاق التفويض",
      fields: [
        checks("scope", "الأعمال المراد تفويضها", [["custody", "الحفظ"], ["leasing", "التأجير"], ["development", "التنمية"], ["repair", "الإصلاح والصيانة"], ["collection", "تحصيل الإيرادات"]], R),
        num("assetsCount", "عدد الأصول المشمولة", { ...R, min: 1 }),
        text("locations", "مواقع الأصول"),
        yn("existingManager", "هل يوجد مدير حالي للأصول؟"),
      ],
    }],
  },
  N05: {
    code: "N05", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("charter", "regulation", "ميثاق المجلس إن وجد")],
    steps: [{ key: "board", title: "المجلس", fields: [num("boardSize", "عدد الأعضاء", { ...R, min: 1 }), num("meetings", "الاجتماعات المتوقعة في السنة", { ...R, min: 1 }), yn("hasCharter", "هل للمجلس ميثاق معتمد؟")] }],
  },
  N06: {
    code: "N06", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [],
    steps: [{ key: "ops", title: "الأعمال المطلوب تنسيقها", fields: [area("tasks", "الأعمال اليومية المطلوبة", R), num("parties", "عدد الأطراف المعنية تقريبًا", { min: 0 })] }],
  },
  N07: {
    code: "N07", version: 1, sources: ["لائحة تنظيم أعمال النظارة م13/1–2: الصرف من حسابات الوقف البنكية وتوثيقه"],
    docs: [doc("bank", "bank_statement", "كشف حساب الوقف لآخر 3 أشهر"), doc("register", "other", "سجل المستفيدين الحالي إن وجد")],
    steps: [{
      key: "beneficiaries", title: "المستفيدون والصرف",
      fields: [
        num("count", "عدد المستفيدين التقريبي", { ...R, min: 1 }),
        sel("frequency", "دورية الصرف", [...FREQ, ["irregular", "غير منتظم"]], R),
        yn("fromWaqfAccount", "هل يتم الصرف من حساب بنكي باسم الوقف؟", { ...R, hint: "الصرف يكون من حساب الوقف فقط." }),
        yn("hasRegister", "هل لديك سجل مستفيدين محدث؟"),
      ],
    }],
  },
  N08: {
    code: "N08", version: 1, sources: ["لائحة تنظيم أعمال النظارة م7، م27/3: التسليم للناظر البديل وتحديث شهادة التسجيل", "معايير المستفيد الحقيقي م7/4: التسليم الفوري للمستندات الأصلية"],
    docs: [doc("nazara", "nazara_deed", "صك النظارة الحالي", { required: true }), doc("deed", "waqf_deed", "صك الوقف")],
    steps: [{
      key: "handover", title: "التسليم أو الاستلام",
      fields: [
        radio("direction", "أنت", [["receiving", "تستلم النظارة"], ["handing", "تسلّم النظارة"]], R),
        text("counterpart", "الطرف الآخر (الناظر السابق أو البديل)", R),
        sel("reason", "سبب انتقال النظارة", [["resignation", "استقالة مقبولة"], ["dismissal", "قرار أو حكم بالعزل"], ["death", "وفاة الناظر"], ["deed_term", "وفق وثيقة الوقف"], ["other", "سبب آخر"]], R),
        date("targetDate", "الموعد المستهدف للتسليم"),
      ],
    }],
  },
  N09: {
    code: "N09", version: 1, sources: ["مشروع قواعد الإبلاغ عن الأوقاف المجهولة: الوقف المجهول ما تعطلت مصارفه ولا يعرف له ناظر، والإبلاغ عبر قناة الهيئة"],
    docs: [doc("evidence", "other", "ما لديك من إثباتات (صك، صور، خطابات)")],
    steps: [{
      key: "waqf", title: "ما تعرفه عن الوقف",
      fields: [
        area("known", "المعلومات المتاحة: الموقع، اسم الواقف، الصك، الحال", { ...R, minLength: 20 }),
        sel("relation", "صلتك بالوقف", [["descendant", "من ذرية الواقف"], ["beneficiary", "مستحق"], ["neighbor", "مطّلع على الوقف"], ["other", "أخرى"]], R),
        checks("evidence", "الإثباتات المتاحة", [["deed", "صك أو وثيقة"], ["witnesses", "شهود أو استفاضة"], ["records", "سجلات رسمية"], ["none", "لا شيء بعد"]], R),
        ack("reportAck", "أفهم أن البلاغ عن الوقف المجهول يقدَّم عبر قناة الهيئة العامة للأوقاف، وأن «وقفك» تعدّ الملف ولا تقدّم البلاغ نيابة عن الهيئة."),
      ],
    }],
  },

  // ── G الحوكمة
  G01: {
    code: "G01", version: 1, sources: ["لائحة تنظيم أعمال النظارة م9/4، م14/1: اللوائح الداخلية للأوقاف الكبيرة والمتوسطة"], docs: [doc("policies", "policy", "اللوائح والسياسات القائمة")],
    steps: [{ key: "gov", title: "وضع الحوكمة الحالي", fields: [sel("size", "حجم الوقف", SIZE, { ...R, prefill: "waqf.sizeClass" }), yn("hasBoard", "هل للوقف مجلس نظارة؟", R), checks("existing", "ما الموجود من لوائح وسياسات؟", [["bylaws", "نظام أساسي"], ["delegation", "مصفوفة صلاحيات"], ["coi", "تعارض المصالح"], ["investment", "سياسة الاستثمار"], ["masarif", "دليل المصارف"], ["none", "لا شيء"]])] }],
  },
  G02: {
    code: "G02", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("deed", "waqf_deed", "وثيقة الوقف", { required: true })],
    steps: [{ key: "bylaws", title: "عناصر النظام الأساسي", fields: [yn("hasBoard", "هل للوقف مجلس؟", R), yn("hasExecutive", "هل للوقف إدارة تنفيذية؟", R), text("domicile", "مقر الوقف")] }],
  },
  G03: {
    code: "G03", version: 1, sources: ["مبادئ حوكمة الأوقاف (مسودة): مجلس النظارة", "تعريف الخدمة في الكتالوج: المواثيق ومعايير الاستقلال"], docs: [],
    steps: [{ key: "board", title: "المجلس واللجان", fields: [num("boardSize", "عدد الأعضاء المقترح", { ...R, min: 3, max: 25 }), checks("committees", "اللجان المطلوبة", [["audit", "المراجعة"], ["investment", "الاستثمار"], ["nominations", "الترشيحات والمكافآت"], ["other", "أخرى"]]), num("independent", "عدد الأعضاء المستقلين المستهدف", { min: 0 })] }],
  },
  G04: {
    code: "G04", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("plan", "policy", "الخطة الحالية إن وجدت")],
    steps: [{ key: "plan", title: "الخطة", fields: [sel("horizon", "أفق الخطة", [["3", "3 سنوات"], ["5", "5 سنوات"]], R), area("priorities", "أولوياتك للوقف", R), yn("existingPlan", "هل للوقف خطة سابقة؟")] }],
  },
  G05: {
    code: "G05", version: 1, sources: ["لائحة تنظيم أعمال النظارة م13: صرف العوائد وفق المصارف المحددة وتوثيقه"], docs: [doc("deed", "waqf_deed", "وثيقة الوقف", { required: true })],
    steps: [{ key: "masarif", title: "المصارف", fields: [area("masarif", "المصارف كما في وثيقة الوقف", R), num("beneficiaries", "عدد المستفيدين التقريبي", { min: 0 }), yn("criteria", "هل توجد معايير مفاضلة معمول بها؟")] }],
  },
  G06: {
    code: "G06", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [],
    steps: [{ key: "coi", title: "النطاق", fields: [num("people", "عدد المشمولين (المجلس والإدارة)", { ...R, min: 1 }), yn("existingPolicy", "هل توجد سياسة قائمة؟")] }],
  },
  G07: {
    code: "G07", version: 1, sources: ["الدليل الإرشادي لصياغة وثيقة الوقف (البند السادس: النظارة وأحكامها)"], docs: [doc("deed", "waqf_deed", "وثيقة الوقف")],
    steps: [{ key: "succession", title: "النظارة الحالية", fields: [radio("form", "شكل النظارة", [["individual", "ناظر فرد"], ["board", "مجلس"], ["entity", "جهة اعتبارية"]], R), yn("deedCovers", "هل تنص وثيقة الوقف على آلية الاستخلاف؟", R)] }],
  },
  G08: {
    code: "G08", version: 1, sources: ["تعريف الخدمة وقاعدة الاستقلال في الكتالوج"], docs: [doc("fin", "financial_statement", "آخر قوائم أو بيان مالي"), doc("bank", "bank_statement", "كشوف الحساب البنكي")],
    steps: [{ key: "audit", title: "نطاق المراجعة", fields: [YEAR("period", "السنة محل المراجعة"), checks("scope", "مجالات المراجعة", [["financial", "مالية"], ["operational", "تشغيلية"], ["compliance", "امتثال"], ["it", "تقنية المعلومات"]], R), date("lastAudit", "تاريخ آخر مراجعة")] }],
  },
  G09: {
    code: "G09", version: 1, sources: ["تعريف الخدمة وقاعدة الاستقلال في الكتالوج"], docs: [],
    steps: [{ key: "eval", title: "التقييم", fields: [num("boardSize", "عدد أعضاء المجلس", { ...R, min: 1 }), YEAR("period", "سنة التقييم")] }],
  },
  G10: {
    code: "G10", version: 1, sources: ["معايير المستفيد الحقيقي: بيانات المستفيد الحقيقي وتحديثها خلال 15 يومًا من التغيير (م6/1)"], docs: [doc("bo", "bo_register", "سجل المستفيد الحقيقي الحالي إن وجد")],
    steps: [{ key: "aml", title: "الوضع الحالي", fields: [yn("boKnown", "هل بيانات المستفيدين الحقيقيين مكتملة؟", R), yn("foreignParty", "هل في الوقف طرف أجنبي؟", R), yn("beneficiariesAbroad", "هل يوجد مستفيدون خارج المملكة؟", R)] }],
  },

  // ── F المالية
  F01: {
    code: "F01", version: 1, sources: ["لائحة تنظيم أعمال النظارة م12/2: استقطاع ما يلزم للصيانة والتشغيل قبل الصرف"], docs: [doc("deed", "waqf_deed", "وثيقة الوقف", { required: true })],
    steps: [{ key: "fin", title: "البيانات المالية", fields: [money("revenue", "الإيراد السنوي التقريبي (ر.س)", R), area("termsSummary", "ما ورد في الشرط عن الريع والصيانة والمصارف")] }],
  },
  F02: {
    code: "F02", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("bank", "bank_statement", "كشوف الحساب البنكي")],
    steps: [{ key: "acc", title: "الوضع المحاسبي", fields: [sel("system", "النظام الحالي", [["none", "لا يوجد"], ["spreadsheet", "جداول"], ["software", "برنامج محاسبي"]], R), num("monthlyTx", "عدد العمليات الشهرية التقريبي", { ...R, min: 0 }), text("fiscalYearEnd", "نهاية السنة المالية (شهر-يوم)", { prefill: "waqf.fiscalYearEnd" })] }],
  },
  F03: {
    code: "F03", version: 1, sources: ["تعريف الخدمة وقاعدة الاستقلال في الكتالوج"], docs: [],
    steps: [{ key: "books", title: "الدفاتر", fields: [num("monthlyTx", "عدد العمليات الشهرية", { ...R, min: 0 }), num("accounts", "عدد الحسابات البنكية", { ...R, min: 1 }), date("startOn", "تاريخ بدء مسك الدفاتر المطلوب")] }],
  },
  F04: {
    code: "F04", version: 1, sources: ["تعريف الخدمة: الموازنة متطلب للأوقاف الكبيرة والمتوسطة"], docs: [doc("fin", "financial_statement", "قوائم السنة السابقة")],
    steps: [{ key: "budget", title: "الموازنة", fields: [YEAR("fiscalYear", "سنة الموازنة"), money("revenue", "الإيراد المتوقع (ر.س)"), area("plans", "المصروفات والمشاريع المخطط لها")] }],
  },
  F05: {
    code: "F05", version: 1, sources: ["لائحة تنظيم أعمال النظارة م15: البيان المالي للأوقاف الصغيرة وذات الانتفاع المباشر"], docs: [doc("bank", "bank_statement", "كشوف الحساب البنكي للسنة", { required: true })],
    steps: [{ key: "year", title: "السنة", fields: [YEAR(), area("revenueSources", "مصادر الإيراد")] }],
  },
  F06: {
    code: "F06", version: 1, sources: ["تعريف الخدمة وقاعدة الاستقلال في الكتالوج"], docs: [doc("fin", "financial_statement", "القوائم المالية", { required: true }), doc("bank", "bank_statement", "كشوف الحساب البنكي", { required: true })],
    steps: [{ key: "audit", title: "المراجعة", fields: [YEAR(), yn("statementsReady", "هل القوائم المالية جاهزة؟", R), yn("previousAuditor", "هل رُوجعت قوائم سابقة؟")] }],
  },
  F07: {
    code: "F07", version: 1, sources: ["تعريف الخدمة: الرفع بيد الناظر عبر خدمة الهيئة"], docs: [doc("fin", "financial_statement", "القوائم أو البيان المالي", { required: true })],
    steps: [{ key: "year", title: "البيانات", fields: [YEAR(), sel("type", "نوع البيانات", [["audited", "قوائم مدققة"], ["simplified", "بيان مالي مبسط"]], R)] }],
  },
  F08: {
    code: "F08", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [],
    steps: [{ key: "rep", title: "التقرير", fields: [sel("frequency", "الدورية", FREQ, R), text("recipients", "من يستلم التقرير؟")] }],
  },
  F09: {
    code: "F09", version: 1, sources: ["لائحة تنظيم أعمال النظارة م15/1: حساب بنكي مستقل باسم الوقف"],
    docs: [doc("deed", "waqf_deed", "صك الوقف", { required: true }), doc("nazara", "nazara_deed", "صك النظارة", { required: true })],
    steps: [{ key: "acc", title: "الحساب الحالي", fields: [sel("holder", "أموال الوقف حاليًا في حساب", [["waqif", "الواقف الشخصي"], ["nazir", "الناظر الشخصي"], ["entity", "جهة أخرى"], ["none", "لا توجد أموال نقدية"]], R), text("bank", "البنك المفضل"), yn("mixed", "هل اختلطت أموال الوقف بأموال أخرى؟", R)] }],
  },

  // ── I الاستثمار والأصول
  I01: {
    code: "I01", version: 1, sources: ["الدليل الإرشادي لاستثمار الأوقاف ودليل قواعد وضوابط الاستثمار", "تعريف الخدمة: على مستوى السياسات والفئات دون تسمية أوراق مالية"],
    docs: [doc("deed", "waqf_deed", "وثيقة الوقف")],
    steps: [{ key: "inv", title: "الاستثمار", fields: [money("investable", "المبلغ القابل للاستثمار (ر.س)", R), area("current", "الأصول والاستثمارات الحالية"), sel("risk", "تحمل المخاطر", [["low", "منخفض"], ["medium", "متوسط"], ["high", "مرتفع"]], R), yn("deedAllows", "هل تجيز وثيقة الوقف الاستثمار؟", R), ack("scopeAck", "أفهم أن السياسة على مستوى الفئات ولا تسمي أوراقًا مالية بعينها.")] }],
  },
  I02: {
    code: "I02", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [],
    steps: [{ key: "ret", title: "المعطيات", fields: [money("spending", "ميزانية المصارف السنوية (ر.س)", R), pct("reinvest", "نسبة إعادة الاستثمار", R), pct("currentReturn", "العائد الحالي إن عُرف")] }],
  },
  I03: {
    code: "I03", version: 1, sources: ["دليل قواعد وضوابط الاستثمار: عناصر دراسة الجدوى"], docs: [doc("studies", "other", "عروض أو دراسات سابقة")],
    steps: [{ key: "opp", title: "الفرصة", fields: [sel("type", "نوع الفرصة", [["real_estate", "تطوير أو شراء عقار"], ["fund", "صندوق استثماري"], ["business", "مشروع تجاري"], ["other", "أخرى"]], R), area("description", "وصف الفرصة", { ...R, minLength: 20 }), money("cost", "التكلفة التقديرية (ر.س)"), text("location", "الموقع")] }],
  },
  I04: {
    code: "I04", version: 2, sources: ["لائحة تنظيم أعمال النظارة م12/3: لا استبدال إلا بإذن الجهة المختصة، وإشعار الهيئة خلال 10 أيام عمل من إتمامه"],
    docs: [doc("ownership", "ownership_deed", "صك الأصل المراد استبداله", { required: true }), doc("valuation", "valuation", "تقييمات الأصل", { showIf: yes("valuations") })],
    steps: [{ key: "swap", title: "الأصل والاستبدال", fields: [sel("assetType", "نوع الأصل المراد استبداله", ASSET_TYPES, R), area("asset", "وصف الأصل وموقعه", { ...R, minLength: 10 }), text("assetDeedNo", "رقم صك الأصل", R), money("assetValue", "القيمة التقديرية الحالية (ر.س)"), sel("reason", "سبب الاستبدال", [["ruin", "خراب الأصل أو تعطله"], ["benefit", "الغبطة والمصلحة"], ["expropriation", "نزع ملكية"], ["other", "سبب آخر"]], R), area("replacement", "البديل المقترح"), yn("valuations", "هل لديك تقييمات للأصل؟", R)] }],
  },
  I05: {
    code: "I05", version: 1, sources: ["لائحة المنتجات الاستثمارية الوقفية م24/2: محتوى اتفاقية الإدارة مع مؤسسة السوق المالية"], docs: [doc("draft", "contract", "مسودة اتفاقية الإدارة", { showIf: yes("hasDraft") })],
    steps: [{ key: "mgr", title: "التفويض", fields: [money("amount", "المبلغ المراد إسناد إدارته (ر.س)", R), sel("mandate", "نوع التفويض", [["discretionary", "إدارة تقديرية"], ["advisory", "استشاري"]], R), area("shortlist", "مديرون مرشحون إن وجدوا"), yn("hasDraft", "هل لديك مسودة اتفاقية؟", R)] }],
  },
  I06: {
    code: "I06", version: 1, sources: ["لائحة المنتجات الاستثمارية الوقفية م21–م23: تسجيل الوقف، وفتح الحساب الاستثماري، وقيده لدى الهيئة خلال 5 أيام عمل لكل مرحلة", "لائحة إنشاء المحافظ الاستثمارية الوقفية م5"],
    docs: [doc("accountAgreement", "contract", "اتفاقية فتح الحساب الاستثماري", { requiredIf: when("stage", "record") }), doc("mgmtAgreement", "contract", "اتفاقية الإدارة مع مؤسسة السوق المالية", { showIf: yes("delegated") })],
    steps: [{ key: "pf", title: "المحفظة", fields: [radio("stage", "المرحلة", [["register", "تسجيل محفظة جديدة"], ["record", "قيد حساب ومحفظة قائمين"]], R), text("custodian", "مؤسسة السوق المالية", R), yn("delegated", "هل أُسندت الإدارة لمؤسسة مرخصة؟", R), date("accountOpenedOn", "تاريخ فتح الحساب", { showIf: when("stage", "record") })] }],
  },
  I07: {
    code: "I07", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("policy", "policy", "سياسة الاستثمار المعتمدة")],
    steps: [{ key: "perf", title: "المتابعة", fields: [yn("policyExists", "هل للوقف سياسة استثمار معتمدة؟", R), sel("frequency", "الدورية", FREQ, R)] }],
  },
  I08: {
    code: "I08", version: 1, sources: ["تعريف الخدمة: التقييم لمقيّم معتمد"], docs: [doc("ownership", "ownership_deed", "صكوك الأصول")],
    steps: [{ key: "assets", title: "الأصول", fields: [num("count", "عدد الأصول", { ...R, min: 1 }), checks("types", "أنواع الأصول", ASSET_TYPES, R), yn("valuation", "هل تحتاج تقييمًا من مقيّم معتمد؟", R)] }],
  },
  I09: {
    code: "I09", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("leases", "lease", "عقود الإيجار القائمة")],
    steps: [{ key: "props", title: "العقارات", fields: [num("count", "عدد العقارات", { ...R, min: 1 }), text("types", "أنواعها (سكني، تجاري…)"), num("leases", "عدد عقود الإيجار القائمة", { min: 0 }), yn("ejar", "هل العقود موثقة في «إيجار»؟")] }],
  },

  // ── C الامتثال والتقارير والاستشارات
  C01: {
    code: "C01", version: 2, sources: ["تعريف الخدمة في الكتالوج"], docs: [],
    steps: [{ key: "basic", title: "التقييم الأساسي", fields: [
      checks("focus", "ما الذي تريد أن يركز عليه التقييم؟", [["governance", "الحوكمة والنظارة"], ["finance", "المالية والصرف"], ["compliance", "الالتزامات النظامية"], ["assets", "الأصول والاستثمار"], ["beneficiaries", "المستفيدون"], ["documents", "الوثائق والتسجيل"]], R),
      area("goal", "ملاحظة إضافية (اختياري)", { maxLength: 1500 }),
    ] }],
  },
  C02: {
    code: "C02", version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [],
    steps: [{ key: "deep", title: "التقييم المعمّق", fields: [yn("basicDone", "هل أجريت التقييم الأساسي في المنصة؟", R), sel("interviewMode", "طريقة المقابلة", MEETING, R), text("contactPerson", "من نقابل من جهة الوقف؟")] }],
  },
  C03: {
    code: "C03", version: 1, sources: ["جدول المخالفات: المخالفات والجزاءات بحسب حجم الوقف"], docs: [doc("notice", "official_letter", "خطاب الإشعار بالفحص", { showIf: yes("notified") })],
    steps: [{ key: "inspection", title: "الفحص", fields: [yn("notified", "هل وصلك إشعار بفحص؟", R), date("inspectionDate", "موعد الفحص", { showIf: yes("notified"), requiredIf: yes("notified") }), checks("areas", "مجالات تريد التركيز عليها", [["registration", "التسجيل والبيانات"], ["finance", "المالية والقوائم"], ["distributions", "الصرف"], ["bo", "المستفيد الحقيقي"], ["governance", "الحوكمة"]])] }],
  },
  C04: {
    code: "C04", version: 1, sources: ["جدول المخالفات"], docs: [doc("notice", "official_letter", "إشعار المخالفة", { requiredIf: yes("hasNotice"), showIf: yes("hasNotice") })],
    steps: [{ key: "violation", title: "المخالفة", fields: [yn("hasNotice", "هل وصلك إشعار مخالفة؟", R), text("noticeNo", "رقم الإشعار", { showIf: yes("hasNotice") }), date("noticeDate", "تاريخ الإشعار", { showIf: yes("hasNotice"), requiredIf: yes("hasNotice") }), area("description", "وصف المخالفة", { ...R, minLength: 15 }), date("hearing", "موعد جلسة اللجنة إن حُدد")] }],
  },
  C05: {
    code: "C05", version: 1, sources: ["مبادئ حوكمة الأوقاف (مسودة): مكونات التقرير السنوي"], docs: [doc("fin", "financial_statement", "القوائم المالية للسنة")],
    steps: [{ key: "report", title: "التقرير", fields: [YEAR(), checks("audience", "الجمهور", [["beneficiaries", "المستفيدون"], ["board", "المجلس"], ["public", "العموم"]], R), yn("financials", "هل يتضمن القوائم المالية؟", R)] }],
  },
  C06: {
    code: "C06", version: 1, sources: ["لائحة تنظيم أعمال النظارة م10/3: إتاحة المعلومات للموقوف عليهم"], docs: [],
    steps: [{ key: "rep", title: "التقارير", fields: [num("count", "عدد المستفيدين", { ...R, min: 1 }), sel("frequency", "الدورية", FREQ, R)] }],
  },
  C07: consultation("C07", "شرعية"),
  C08: consultation("C08", "قانونية"),
  C09: consultation("C09", "مالية"),
  C10: consultation("C10", "استثمارية", [ack("scopeAck", "أفهم أن الرأي على مستوى السياسات وفئات الأصول، ولا يتضمن مشورة في أوراق مالية بعينها.")]),
  C11: {
    code: "C11", version: 1, sources: ["لائحة تنظيم أعمال النظارة م9/2: يتقدم الناظر بطلب التفسير محررًا إلى الواقف حال حياته أو الجهة المختصة"],
    docs: [doc("deed", "waqf_deed", "وثيقة الوقف", { required: true })],
    steps: [{ key: "condition", title: "الشرط", fields: [area("conditionText", "نص الشرط كما ورد في الوثيقة", { ...R, minLength: 10 }), area("issue", "وجه الغموض أو الإشكال", { ...R, minLength: 15 }), yn("waqifAlive", "هل الواقف على قيد الحياة؟", R)] }],
  },
  C12: {
    code: "C12", version: 2, sources: ["100 سؤال وجواب س47: اختصاص دوائر الأوقاف في محاكم الأحوال الشخصية"], docs: [doc("related", "other", "مستندات الخلاف")],
    steps: [{ key: "dispute", title: "الخلاف", fields: [
      table("parties", "أطراف الخلاف", [
        { key: "name", label: "الاسم", type: "text", required: true },
        { key: "capacity", label: "الصفة", type: "select", required: true, options: [["beneficiary", "مستحق"], ["nazir", "ناظر"], ["board", "عضو مجلس نظارة"], ["heir", "من ورثة الواقف"], ["other", "أخرى"]] },
      ], { ...R, minRows: 2 }),
      sel("disputeType", "نوع الخلاف", [["distribution", "قسمة الريع والاستحقاق"], ["nazara", "النظارة وتصرفات الناظر"], ["condition", "فهم شرط الواقف"], ["assets", "الأصول والعقود"], ["other", "أخرى"]], R),
      area("subject", "موضوع الخلاف", { ...R, minLength: 15 }),
      yn("courtCase", "هل رُفعت دعوى؟", R),
      area("attempts", "محاولات التسوية السابقة"),
    ] }],
  },
  C13: {
    code: "C13", version: 1, sources: ["100 سؤال وجواب س44، س47"], docs: [doc("caseDocs", "judgment", "صحيفة الدعوى أو الأحكام أو الخطابات")],
    steps: [{ key: "case", title: "القضية", fields: [radio("stage", "المرحلة", [["pre", "قبل رفع الدعوى"], ["filed", "منظورة"], ["appeal", "استئناف"]], R), text("court", "المحكمة", { showIf: { field: "stage", in: ["filed", "appeal"] } }), text("caseNo", "رقم القضية", { showIf: { field: "stage", in: ["filed", "appeal"] } }), text("opponent", "الطرف الآخر", R), area("subject", "موضوع القضية", { ...R, minLength: 15 })] }],
  },
};

export const INTAKE_FORM_CODES = Object.keys(FORMS);

/**
 * The full form for a service: applicant step + the service's steps + notes, and the document slots of the form
 * merged with the documents configured on the service in Admin (services.required_documents).
 */
export function formFor(svc: { code: string; audiences: string[]; requiredDocuments?: { docType: string; label: string; required: boolean }[] }): ServiceForm {
  const base = FORMS[svc.code] ?? { code: svc.code, version: 1, sources: ["تعريف الخدمة في الكتالوج"], docs: [], steps: [{ key: "details", title: "تفاصيل الطلب", fields: [area("details", "ما المطلوب؟", { ...R, minLength: 10 })] }] };
  const extra = svc.code === "W05" ? ["heir"] : [];
  const ap = applicantStep(svc.audiences, extra);
  const docs: DocSlot[] = base.docs.map((d) => ({ ...d }));
  for (const d of svc.requiredDocuments ?? []) {
    const same = docs.find((x) => x.docType === d.docType);
    if (same) {
      if (d.required && !same.required && !same.requiredIf && !same.showIf) same.required = true;
    } else docs.push(doc(`svc_${d.docType}`, d.docType, d.label, { required: d.required }));
  }
  return { code: svc.code, version: base.version, sources: base.sources, steps: [ap.step, ...base.steps, NOTES], docs: [...docs, ...ap.docs] };
}
