/**
 * Intake forms for every service in the catalog (PURE).
 *
 * Each form = the shared applicant step + the service's own steps + its document slots. Questions rest on the
 * service definition in the catalog and, where noted in `sources`, on the project reference files. A form never
 * asks for something a service does not need; anything a specialist needs later is raised as a deficiency item.
 * Bump `version` of a form when its questions change; stored answers keep the version they were given under.
 */
import type { Cond, DocSlot, Field, ServiceForm, Step } from "./engine";
import { contextFor } from "../context/map";
import type { ContextKey } from "../context/types";
import { waqfModesFor } from "../waqf-mode";

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
/** A question an earlier version asked that the waqf file now answers: kept only on requests that already hold it. */
const legacy = (x: Field): Field => ({ ...x, required: false, requiredIf: undefined, showIf: { field: x.key, notEmpty: true } });
const hidden = (key: string): Field => ({ key, label: key, type: "hidden" });
const period = (o: { required?: boolean } = { required: true }): Field[] => [
  date("periodFrom", "بداية الفترة محل الخدمة", { ...o }),
  date("periodTo", "نهاية الفترة", { ...o, hint: "تُقرأ سجلات الوقف (الاجتماعات، القرارات، المالية) لهذه الفترة." }),
];

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

/**
 * Shared step for services that read the waqf file: the records are shown above (source, date, status), and the
 * client only confirms them or says what needs updating — never re-enters them. The update scope says whether a
 * correction is for this request only or should be made in the waqf file (by whoever may edit it, after review).
 */
const NEEDS_UPDATE = when("dataReview", "needs_update");
const WAQF_DATA: Step = {
  key: "waqfData",
  title: "بيانات الوقف المسجلة",
  intro: "هذه بيانات وقفك كما هي مسجلة في المنصة، مع مصدر كل منها وتاريخ آخر تحديث. لا حاجة لإعادة إدخالها؛ أكّدها أو أخبرنا بما يحتاج تحديثًا.",
  contextBlocks: true,
  showIf: when("waqfContext", "yes"),
  fields: [
    hidden("waqfContext"),
    radio("dataReview", "هل البيانات المسجلة صحيحة ومحدّثة؟", [["confirmed", "نعم، صحيحة ومحدّثة"], ["needs_update", "بعضها يحتاج تحديثًا أو تصحيحًا"]], R),
    area("dataCorrections", "ما الذي يحتاج تحديثًا؟", { showIf: NEEDS_UPDATE, requiredIf: NEEDS_UPDATE, minLength: 10, hint: "اذكر البيان والقيمة الصحيحة ومصدرها (مستند أو قرار)." }),
    radio("dataUpdateScope", "أين يُطبَّق التحديث؟", [["request", "لهذا الطلب فقط"], ["file", "في ملف الوقف أيضًا (بعد مراجعة الفريق ووفق الصلاحيات)"]], { showIf: NEEDS_UPDATE, requiredIf: NEEDS_UPDATE }),
  ],
};

// ───────────────────────── Waqf not registered in the platform ─────────────────────────

/**
 * Step for a waqf that exists but is not registered in «وقفك»: the minimum the service needs about the waqf, asked of
 * the client instead of read from a waqf file. Built from the same map of records each service reads (context/map.ts):
 * a governance service asks about the board, a financial one about the records, an asset one about the assets.
 * Answers are kept in the request only (source: the client, not verified); no waqf file is created from them.
 * «لا أعرف» is accepted where the client may not know; what work cannot start without is marked «start».
 */
const UNREG = when("waqfMode", "unregistered");
const UNKNOWN = ["unknown", "لا أعرف"] as const;
const BOARD_UW = when("uwNazirType", "board");
const GOVERNANCE_KEYS: ContextKey[] = ["waqf.nazara", "board.composition", "governance.rules", "board.meetings", "board.resolutions", "governance.policies", "governance.evaluations"];

function unregisteredWaqf(code: string, base: Step[], baseDocs: DocSlot[]): { step: Step; docs: DocSlot[] } | null {
  if (!waqfModesFor(code).unregistered) return null;
  const keys = new Set(contextFor(code));
  const asked = new Set(base.flatMap((st) => st.fields.flatMap((x) => [x.key, ...(x.prefill ? [x.prefill] : [])])));
  const has = (...k: ContextKey[]) => k.some((x) => keys.has(x));
  const fields: Field[] = [
    text("uwName", "اسم الوقف أو الاسم المتعارف عليه", { ...R, hint: "كما في الصك إن وجد." }),
    radio("uwType", "نوع الوقف", [["general", "خيري (عام)"], ["ahli", "أهلي (ذري)"], ["mixed", "مشترك"], UNKNOWN], { ...R, hint: "بحسب الموقوف عليهم: جهات بر عامة، أو ذرية وأشخاص معينون، أو الاثنان." }),
    radio("uwStatus", "حالة الوقف", [["registered_gaa", "موثّق ومسجّل لدى الهيئة العامة للأوقاف"], ["documented", "موثّق بصك ولم يُسجَّل لدى الهيئة"], ["undocumented", "قائم دون توثيق، أو صكه مفقود"], ["other", "غير ذلك"]], R),
    text("uwGaaNumber", "رقم التسجيل لدى الهيئة أو الرقم الوطني الموحد", { showIf: when("uwStatus", "registered_gaa"), need: "support" }),
    sel("uwCountry", "مقر الوقف", [["sa", "المملكة العربية السعودية"], ["other", "خارج المملكة"]], R),
    text("uwCity", "المدينة أو المنطقة", { need: "support" }),
    radio("uwHasDeed", "هل لدى الوقف صك أو وثيقة وقف؟", [["yes", "نعم"], ["no", "لا"], UNKNOWN], { ...R, need: "start", why: "يُعرف به مرجع شرط الواقف قبل بدء العمل." }),
    ...(asked.has("waqf.deedNo") || asked.has("deedNo") ? [] : [
      text("uwDeedNo", "رقم الصك أو الوثيقة", { showIf: yes("uwHasDeed"), need: "start", why: "يُطابق به الفريق الوقف ومستنداته قبل بدء العمل." }),
      sel("uwDeedIssuer", "جهة إصدار الصك", DEED_ISSUER, { showIf: yes("uwHasDeed") }),
    ]),
    radio("uwWaqif", "الواقف", [["alive", "على قيد الحياة"], ["deceased", "متوفى"], ["entity", "جهة اعتبارية"], UNKNOWN], { need: "support" }),
    text("uwWaqifName", "اسم الواقف", { showIf: { field: "uwWaqif", in: ["alive", "deceased", "entity"] }, need: "support" }),
  ];
  if (has(...GOVERNANCE_KEYS, "assets.register", "finance.records", "beneficiaries.register", "compliance.obligations") && !asked.has("nazirType")) {
    fields.push(
      radio("uwNazirType", "من يتولى نظارة الوقف؟", [["waqif", "الواقف نفسه"], ["individual", "ناظر فرد"], ["board", "مجلس نظارة"], ["entity", "جهة اعتبارية"], ["none", "لا يوجد ناظر معيّن"], UNKNOWN],
        { need: "start", why: "تُحدَّد به الجهة التي يتعامل معها الفريق وصلاحياتها." }),
      text("uwNazirName", "اسم الناظر أو الجهة", { showIf: { field: "uwNazirType", in: ["individual", "entity"] }, need: "support" }),
    );
  }
  if (has("board.composition", "governance.rules", "board.meetings", "board.resolutions")) {
    fields.push(num("uwBoardSize", "عدد أعضاء المجلس", { min: 1, showIf: BOARD_UW, need: "start", why: "يُبنى عليه نطاق العمل مع المجلس." }));
    if (has("board.meetings", "board.resolutions")) fields.push(
      num("uwMeetings", "عدد اجتماعات المجلس في آخر 12 شهرًا", { showIf: BOARD_UW, need: "support" }),
      radio("uwMinutes", "محاضر الاجتماعات والقرارات", [["documented", "موثقة ومتاحة"], ["partial", "بعضها"], ["none", "لا توجد محاضر"], UNKNOWN],
        { showIf: BOARD_UW, need: "start", why: "يقوم العمل على قرارات المجلس ومحاضره؛ فيُعرف ما يتاح منها قبل البدء." }),
    );
  }
  if (has("governance.policies")) fields.push(checks("uwPolicies", "اللوائح والسياسات المعتمدة", [["bylaws", "نظام أساسي أو لائحة داخلية"], ["delegation", "مصفوفة صلاحيات"], ["coi", "سياسة تعارض المصالح"], ["distribution", "سياسة الصرف"], ["investment", "سياسة الاستثمار"], ["none", "لا يوجد شيء معتمد"], UNKNOWN], { need: "support" }));
  if (has("governance.evaluations")) fields.push(radio("uwPrevEval", "هل أُجري تقييم أداء سابق للمجلس أو الناظر؟", [["yes", "نعم"], ["no", "لا"], UNKNOWN], { need: "support" }));
  if (has("waqf.terms") && !asked.has("masarif")) fields.push(area("uwTerms", "مصارف الوقف وأهم شروط الواقف كما في الوثيقة", { need: "start", why: "شرط الواقف هو مرجع العمل، فيُقرأ قبل البدء.", review: "sharia" }));
  if (has("assets.register") && !asked.has("candidates")) fields.push(table("uwAssets", "أصول الوقف", [
    { key: "type", label: "نوع الأصل", type: "select", required: true, options: ASSET_TYPES },
    { key: "description", label: "الوصف والموقع", type: "text", required: true },
    { key: "value", label: "القيمة التقديرية (ر.س)", type: "money" },
    { key: "ownership", label: "صك الملكية باسم الوقف؟", type: "select", options: [["yes", "نعم"], ["no", "لا"], ["unknown", "لا أعرف"]] },
  ], { need: "start", maxRows: 20, why: "يُبنى عليه نطاق العمل، ويُطابق بمستندات الملكية." }));
  if (has("finance.records")) fields.push(
    radio("uwFinance", "السجلات المالية المتاحة", [["audited", "قوائم مالية مراجعة"], ["unaudited", "قوائم مالية غير مراجعة"], ["records", "سجلات وكشوف حسابات فقط"], ["none", "لا توجد سجلات مالية"], UNKNOWN],
      { need: "start", why: "تحدد ما يُبنى عليه العمل المالي، وما يلزم إعداده أولًا." }),
    text("uwFiscalYearEnd", "نهاية السنة المالية للوقف (الشهر-اليوم)", { need: "support", hint: "مثل 12-31" }),
  );
  if (has("beneficiaries.register")) fields.push(
    num("uwBeneficiaryCount", "عدد المستفيدين تقريبًا", { need: "support" }),
    area("uwBeneficiaryClasses", "فئات المستفيدين", { need: "support" }),
  );
  if (has("compliance.obligations")) fields.push(radio("uwGaaFilings", "تقديم إفصاحات الوقف وتقاريره للهيئة", [["regular", "منتظم"], ["partial", "بعضها"], ["none", "لم يُقدَّم شيء"], UNKNOWN], { need: "support" }));
  if (has("risks.register")) fields.push(area("uwRisks", "مخاطر أو نزاعات معروفة على الوقف (إن وجدت)", { need: "support" }));

  const taken = new Set(baseDocs.map((d) => d.docType));
  const unreg = (c: Cond): Cond => ({ all: [UNREG, c] });
  const docs: DocSlot[] = [
    doc("uw_deed", "waqf_deed", "صك الوقف أو وثيقته", { showIf: unreg(yes("uwHasDeed")), need: "start", why: "مرجع شرط الواقف ومصارفه وناظره." }),
    ...(fields.some((x) => x.key === "uwNazirType") ? [doc("uw_nazara", "nazara_deed", "صك النظارة أو قرار تعيين الناظر", { showIf: unreg({ field: "uwNazirType", in: ["individual", "board", "entity"] }), need: "support" })] : []),
    ...(fields.some((x) => x.key === "uwMinutes") ? [doc("uw_minutes", "minutes", "محاضر اجتماعات المجلس وقراراته", { showIf: unreg({ field: "uwMinutes", in: ["documented", "partial"] }), need: "support" })] : []),
    ...(fields.some((x) => x.key === "uwFinance") ? [doc("uw_fin", "financial_statement", "القوائم المالية الأخيرة", { showIf: unreg({ field: "uwFinance", in: ["audited", "unaudited"] }), need: "start", why: "يقوم عليها العمل المالي." })] : []),
    ...(fields.some((x) => x.key === "uwAssets") ? [doc("uw_assets", "ownership_deed", "صكوك ملكية الأصول", { showIf: unreg({ field: "uwAssets", notEmpty: true }), need: "support" })] : []),
  ].filter((d) => !taken.has(d.docType));
  return {
    step: {
      key: "unregisteredWaqf",
      title: "بيانات الوقف",
      intro: "وقفك غير مسجل في المنصة، فنحتاج بياناته الأساسية التي تلزم هذه الخدمة. تُحفظ ضمن هذا الطلب فقط، ولا يُنشأ منها ملف وقف. ما لا تعرفه اختر فيه «لا أعرف»، وسنبيّن لك قبل الإرسال ما يلزم قبل بدء العمل.",
      showIf: UNREG,
      fields,
    },
    docs,
  };
}

// ───────────────────────── Reusable service blocks ─────────────────────────

const deedBlock = (required = true): Field[] => [
  text("deedNo", "رقم صك الوقف أو وثيقته", { ...(required ? R : {}), prefill: "waqf.deedNo" }),
  sel("deedIssuer", "جهة الإصدار", DEED_ISSUER),
  text("deedDate", "تاريخ الوثيقة (هجري أو ميلادي)"),
];

const consultation = (code: string, topic: string, extra: Field[] = [], sources: string[] = [], review?: Field["review"]): ServiceForm => ({
  code, version: extra.length || review ? 2 : 1, sources: ["تعريف الخدمة في كتالوج «وقفك» (رأي مكتوب موقّع)", ...sources], docs: [doc("related", "other", "مستندات تتعلق بالمسألة")],
  steps: [{
    key: "question", title: `مسألتك (${topic})`,
    intro: "اكتب المسألة كما هي. يصدر الرأي مكتوبًا موقّعًا من المستشار المختص بعد دراستها.",
    fields: [
      area("question", "المسألة أو السؤال", { ...R, minLength: 30, review }),
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
    code: "T05", version: 3, sources: ["الدليل الإرشادي لاختيار الأصول الوقفية: المعايير الستة لاختيار الأصل"],
    docs: [
      doc("assets", "ownership_deed", "مستند ملكية الأصل (صك، سجل تجاري، شهادة أسهم)", { showIf: { field: "assetType", in: ["real_estate", "land", "business", "securities", "other"] }, need: "start", why: "تُبنى الدراسة على ملكية ثابتة للأصل." }),
      doc("portfolio", "bank_statement", "كشف المحفظة أو الحساب", { showIf: { field: "assetType", in: ["securities", "cash"] }, need: "support" }),
      doc("valuation", "valuation", "تقرير التقييم", { showIf: when("valuationSource", "accredited"), need: "support" }),
    ],
    steps: [
      {
        key: "asset", title: "الأصل المراد وقفه",
        intro: "تظهر الأسئلة بحسب نوع الأصل. ما لا تعرفه اختر فيه «لا أعرف»، وسنبيّن قبل الإرسال ما يلزم قبل بدء الدراسة.",
        fields: [
          radio("assetType", "نوع الأصل", [["real_estate", "عقار مبني"], ["land", "أرض"], ["securities", "أسهم أو وحدات صناديق أو محفظة"], ["cash", "نقد"], ["business", "حصص في منشأة أو شركة"], ["other", "أصل آخر"]], R),
          // real estate and land
          sel("propertyUse", "استخدام العقار", [["residential", "سكني"], ["commercial", "تجاري"], ["mixed", "مختلط"], ["agricultural", "زراعي"], ["industrial", "صناعي"], ["vacant", "أرض بيضاء"]], { showIf: { field: "assetType", in: ["real_estate", "land"] }, requiredIf: { field: "assetType", in: ["real_estate", "land"] } }),
          text("propertyCity", "المدينة", { showIf: { field: "assetType", in: ["real_estate", "land"] }, requiredIf: { field: "assetType", in: ["real_estate", "land"] } }),
          text("propertyDistrict", "الحي أو الموقع", { showIf: { field: "assetType", in: ["real_estate", "land"] }, need: "support" }),
          num("propertyArea", "المساحة (م²)", { showIf: { field: "assetType", in: ["real_estate", "land"] }, need: "support" }),
          text("propertyDeedNo", "رقم صك الملكية", { showIf: { field: "assetType", in: ["real_estate", "land"] }, need: "start", why: "يُتحقق به من الملكية وخلو الأصل من الموانع." }),
          radio("occupancy", "حالة العقار", [["leased", "مؤجر"], ["vacant", "شاغر"], ["owner_used", "يستخدمه المالك"], UNKNOWN], { showIf: when("assetType", "real_estate"), need: "support" }),
          money("currentIncome", "الدخل السنوي الحالي (ر.س)", { showIf: when("occupancy", "leased"), need: "support" }),
          // securities
          sel("securityKind", "نوع الأوراق المالية", [["listed", "أسهم مدرجة"], ["unlisted", "أسهم غير مدرجة"], ["fund", "وحدات صندوق استثماري"], ["portfolio", "محفظة مدارة"]], { showIf: when("assetType", "securities"), requiredIf: when("assetType", "securities") }),
          text("securityIssuer", "الشركة أو الصندوق أو مدير المحفظة", { showIf: when("assetType", "securities"), requiredIf: when("assetType", "securities") }),
          num("securityQty", "عدد الأسهم أو الوحدات", { showIf: when("assetType", "securities"), need: "start", why: "يُحدَّد به مقدار الموقوف." }),
          text("custodian", "أمين الحفظ أو الوسيط", { showIf: when("assetType", "securities"), need: "support" }),
          // cash
          money("cashAmount", "المبلغ (ر.س)", { showIf: when("assetType", "cash"), requiredIf: when("assetType", "cash") }),
          radio("cashPlan", "كيف تريد أن يُستعمل النقد؟", [["invest", "يُستثمر ويُصرف ريعه"], ["buy", "يُشترى به أصل يُوقف"], ["undecided", "لم أحدد"]], { showIf: when("assetType", "cash"), need: "support" }),
          // business
          text("businessName", "اسم المنشأة أو الشركة", { showIf: when("assetType", "business"), requiredIf: when("assetType", "business") }),
          pct("businessShare", "نسبة الحصة", { showIf: when("assetType", "business"), need: "start", why: "يُحدَّد بها مقدار الموقوف." }),
          text("businessCr", "رقم السجل التجاري", { showIf: when("assetType", "business"), need: "support" }),
          area("otherDescription", "صف الأصل", { showIf: when("assetType", "other"), requiredIf: when("assetType", "other"), minLength: 10 }),
          // ownership and value (every type)
          radio("ownership", "الملكية الحالية", [["self", "مملوك لي بالكامل"], ["share", "حصة مشاعة مع آخرين"], ["heirs", "ملك ورثة لم يُقسم"], ["entity", "مملوك لجهة أمثلها"], UNKNOWN], { ...R, need: "start", why: "لا يُدرس وقف أصل لم تُعرف ملكيته." }),
          radio("disposal", "صاحب الصفة في التصرف بالأصل", [["self", "أنا"], ["agent", "أنا بوكالة عن المالك"], ["consent", "يلزم موافقة شركاء أو ورثة"], UNKNOWN], { ...R, need: "start", review: "legal", why: "يُعرف به من يملك قرار الوقف." }),
          money("value", "القيمة التقديرية (ر.س)", { need: "support" }),
          sel("valuationSource", "مصدر التقدير", [["accredited", "تقييم من مقيّم معتمد"], ["market", "أسعار السوق"], ["estimate", "تقدير شخصي"], UNKNOWN], { showIf: { field: "value", notEmpty: true } }),
          checks("encumbrances", "قيود أو التزامات على الأصل", [["mortgage", "رهن أو تمويل"], ["lease", "عقد إيجار قائم"], ["dispute", "نزاع قضائي"], ["partners", "حقوق شركاء"], ["none", "لا يوجد"], UNKNOWN], { need: "start", why: "قد تمنع الوقف أو تقيّده، فتُعرف قبل الدراسة." }),
        ],
      },
      {
        key: "assets", title: "الغرض من الوقف والمعايير",
        fields: [
          area("goals", "الغرض من الوقف والأهداف التي تريد أن يحققها الأصل", { ...R, minLength: 10 }),
          radio("duration", "مدة الوقف", [["perpetual", "مؤبد"], ["temporary", "مؤقت"], ["undecided", "لم أحدد"]], R),
          sel("sizeEstimate", "الحجم المتوقع للوقف", SIZE, R),
          sel("beneficiaryKind", "نوع الموقوف عليهم", WAQF_KIND, R),
          sel("management", "من سيدير الأصل؟", [["self", "الناظر بنفسه"], ["professional", "جهة احترافية مختصة"], ["undecided", "لم أحدد"]]),
          table("candidates", "أصول أخرى مرشحة للمقارنة (اختياري)", [
            { key: "type", label: "نوع الأصل", type: "select", required: true, options: ASSET_TYPES },
            { key: "description", label: "الوصف والموقع", type: "text", required: true },
            { key: "value", label: "القيمة التقريبية (ر.س)", type: "money" },
            { key: "income", label: "الدخل السنوي الحالي إن وجد (ر.س)", type: "money" },
            { key: "owned", label: "مملوك ومسجل باسمك بصك ساري؟", type: "select", options: [["yes", "نعم"], ["no", "لا"], ["partial", "حصة مشاعة"]] },
          ], { hint: "إن كان لديك أكثر من أصل: يُقارن كل منها بالمعايير الستة في الدليل." }),
        ],
      },
    ],
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
    code: "N02", version: 2, sources: ["تعريف الخدمة في الكتالوج", "مبادئ حوكمة الأوقاف (مسودة): الأعضاء المستقلون"], docs: [doc("charter", "regulation", "ميثاق المجلس أو لائحته (إن لم تكن في ملف الوقف)")],
    steps: [{
      key: "board", title: "العضوية المطلوبة",
      intro: "تشكيل المجلس وقواعده واجتماعاته مقروءة من ملف الوقف أعلاه.",
      fields: [
        legacy(num("boardSize", "عدد أعضاء المجلس الحالي", { min: 1 })), legacy(num("meetings", "عدد الاجتماعات في السنة", { min: 0 })), legacy(text("committees", "اللجان القائمة")),
        checks("expertise", "الخبرة المطلوبة في العضو المستقل", [["sharia", "شرعية"], ["legal", "قانونية"], ["finance", "مالية"], ["investment", "استثمارية"], ["real_estate", "عقارية"], ["governance", "حوكمة"]], R),
        checks("committeeRoles", "عضوية اللجان المطلوبة", [["audit", "لجنة المراجعة"], ["investment", "لجنة الاستثمار"], ["nominations", "الترشيحات والمكافآت"]]),
        num("termMonths", "مدة العضوية المطلوبة (بالأشهر)", { ...R, min: 1 }),
      ],
    }],
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
    code: "N05", version: 2, sources: ["تعريف الخدمة في الكتالوج"], docs: [doc("charter", "regulation", "ميثاق المجلس (إن لم يكن في ملف الوقف)")],
    steps: [{
      key: "board", title: "الأمانة المطلوبة",
      intro: "تشكيل المجلس وقواعده واجتماعاته وقراراته مقروءة من ملف الوقف أعلاه.",
      fields: [
        legacy(num("boardSize", "عدد الأعضاء", { min: 1 })), legacy(num("meetings", "الاجتماعات المتوقعة في السنة", { min: 1 })), legacy(yn("hasCharter", "هل للمجلس ميثاق معتمد؟")),
        checks("services", "أعمال الأمانة المطلوبة", [["agenda", "إعداد جداول الأعمال"], ["invitations", "الدعوات"], ["minutes", "المحاضر وتوقيعها"], ["followUp", "متابعة تنفيذ القرارات"], ["archive", "حفظ السجلات"]], R),
        sel("meetingMode", "طريقة انعقاد الاجتماعات", MEETING, R),
      ],
    }],
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
  // Every governance service reads the board, rules, meetings, resolutions and policies from the waqf file (see
  // context/map.ts); the forms ask only what the file cannot know: the client's choices, plans and known issues.
  G01: {
    code: "G01", version: 2, sources: ["لائحة تنظيم أعمال النظارة م9/4، م14/1: اللوائح الداخلية للأوقاف الكبيرة والمتوسطة", "مبادئ حوكمة الأوقاف (مسودة)"],
    docs: [doc("policies", "policy", "لوائح وسياسات قائمة غير مرفوعة في ملف الوقف")],
    steps: [{
      key: "gov", title: "أولويات الحوكمة",
      intro: "حجم الوقف وتشكيل المجلس واللوائح المعتمدة مقروءة من ملف الوقف أعلاه.",
      fields: [
        legacy(sel("size", "حجم الوقف", SIZE)), legacy(yn("hasBoard", "هل للوقف مجلس نظارة؟")),
        legacy(checks("existing", "ما الموجود من لوائح وسياسات؟", [["bylaws", "نظام أساسي"], ["delegation", "مصفوفة صلاحيات"], ["coi", "تعارض المصالح"]])),
        checks("priorities", "ما الذي تريد إعداده أو تحديثه؟", [["bylaw", "لائحة الحوكمة الداخلية"], ["authority", "مصفوفة الصلاحيات"], ["coi", "سياسة تعارض المصالح"], ["distribution", "سياسة الصرف"], ["investment", "سياسة الاستثمار"], ["financial", "اللائحة المالية"], ["complaints", "آلية الشكاوى"], ["records", "حفظ الوثائق والأرشفة"], ["risk", "سجل المخاطر"]], R),
        radio("boardPlan", "ما خطتك لمجلس النظارة؟", [["keep", "الإبقاء على التشكيل الحالي"], ["form", "تشكيل مجلس جديد"], ["restructure", "إعادة هيكلة المجلس ولجانه"], ["none", "لا مجلس (ناظر فرد)"]], R),
        yn("adoptionSupport", "هل تحتاج مساندة في اعتماد اللوائح وتطبيقها بعد إعدادها؟"),
        area("deedConstraints", "ما ورد في وثيقة الوقف ويقيّد الحوكمة (إن وجد)", { review: "legal", hint: "مثل: من يعيّن الناظر، أو حدود صلاحياته." }),
      ],
    }],
  },
  G02: {
    code: "G02", version: 2, sources: ["تعريف الخدمة في الكتالوج", "الدليل الإرشادي لصياغة وثيقة الوقف (البند السادس: النظارة وأحكامها)"],
    docs: [doc("deed", "waqf_deed", "وثيقة الوقف", { required: true })],
    steps: [{
      key: "bylaws", title: "عناصر النظام الأساسي",
      fields: [
        legacy(yn("hasBoard", "هل للوقف مجلس؟")),
        yn("hasExecutive", "هل للوقف إدارة تنفيذية؟", R),
        checks("executiveRoles", "المناصب التنفيذية", [["ceo", "مدير تنفيذي"], ["finance", "مسؤول مالي"], ["assets", "مدير أملاك"], ["programs", "مسؤول المصارف والبرامج"]], { showIf: yes("hasExecutive"), requiredIf: yes("hasExecutive") }),
        text("domicile", "مقر الوقف", { prefill: "waqf.domicile" }),
        radio("amendmentRule", "من يعدّل النظام الأساسي؟", [["board", "مجلس النظارة بأغلبية خاصة"], ["nazir", "الناظر"], ["not_set", "لم يُحدد بعد"]], R),
        area("deedConstraints", "نصوص وثيقة الوقف التي يجب أن يلتزم بها النظام", { review: "legal" }),
      ],
    }],
  },
  G03: {
    code: "G03", version: 2, sources: ["مبادئ حوكمة الأوقاف (مسودة): مجلس النظارة والأعضاء المستقلون", "تعريف الخدمة في الكتالوج: المواثيق ومعايير الاستقلال"], docs: [],
    steps: [{
      key: "board", title: "المجلس واللجان",
      intro: "التشكيل الحالي للمجلس مقروء من ملف الوقف أعلاه.",
      fields: [
        radio("formationType", "المطلوب", [["new", "تشكيل مجلس جديد"], ["restructure", "إعادة تشكيل مجلس قائم"]], R),
        num("boardSize", "عدد الأعضاء المقترح", { ...R, min: 3, max: 25 }),
        num("independent", "عدد الأعضاء المستقلين المقترح", { min: 0, max: 25, hint: "يُراعى أن يشكل المستقلون نسبة مؤثرة، ولا سيما في الأوقاف الكبيرة والأهلية." }),
        checks("committees", "اللجان المطلوبة", [["audit", "المراجعة"], ["investment", "الاستثمار"], ["nominations", "الترشيحات والمكافآت"], ["other", "أخرى"]]),
        checks("competencies", "الخبرات المطلوبة في المجلس", [["sharia", "شرعية"], ["legal", "قانونية"], ["finance", "مالية ومحاسبية"], ["investment", "استثمارية"], ["real_estate", "عقارية"], ["family", "تمثيل ذرية الواقف"]], R),
        num("termYears", "مدة العضوية (بالسنوات)", { min: 1, max: 10 }),
        yn("remuneration", "هل تُصرف مكافآت لأعضاء المجلس؟"),
        area("deedRequirements", "ما تشترطه وثيقة الوقف في المجلس أو أعضائه", { review: "legal" }),
      ],
    }],
  },
  G04: {
    code: "G04", version: 2, sources: ["تعريف الخدمة في الكتالوج", "الدليل الإرشادي للواقفين (الرقابة والتقييم): مقاييس أداء مالية وتشغيلية وللمصارف والالتزام"],
    docs: [doc("plan", "policy", "الخطة الحالية", { requiredIf: yes("existingPlan"), showIf: yes("existingPlan") })],
    steps: [{
      key: "plan", title: "الخطة",
      fields: [
        sel("horizon", "أفق الخطة", [["3", "3 سنوات"], ["5", "5 سنوات"]], R),
        yn("existingPlan", "هل للوقف خطة سابقة؟", R),
        area("priorities", "أولوياتك للوقف", R),
        table("goals", "أهداف تريدها في الخطة (اختياري)", [
          { key: "goal", label: "الهدف", type: "text", required: true },
          { key: "indicator", label: "مؤشر قياسه", type: "text" },
          { key: "target", label: "المستهدف", type: "text" },
        ], { maxRows: 12 }),
        checks("indicatorTypes", "أنواع المؤشرات المطلوبة", [["financial", "مالية"], ["operational", "تشغيلية"], ["masarif", "تحقيق المصارف"], ["compliance", "الالتزام"], ["quality", "الجودة"]], R),
      ],
    }],
  },
  G05: {
    code: "G05", version: 2, sources: ["لائحة تنظيم أعمال النظارة م13: صرف العوائد وفق المصارف المحددة وتوثيقه"], docs: [doc("deed", "waqf_deed", "وثيقة الوقف", { required: true })],
    steps: [{
      key: "masarif", title: "المصارف والصرف",
      intro: "المصارف وفئات المستحقين المسجلة في ملف الوقف معروضة أعلاه؛ لا حاجة لإعادة كتابتها.",
      fields: [
        area("masarif", "المصارف كما وردت في الوثيقة (إن لم تكن مسجلة في ملف الوقف)", { review: "sharia" }),
        num("beneficiaries", "عدد المستفيدين التقريبي", { min: 0 }),
        sel("frequency", "دورية الصرف المعمول بها", [...FREQ, ["irregular", "غير منتظم"]], R),
        radio("selection", "كيف يُحدد المستحقون؟", [["deed", "بالأسماء أو الصفات في الوثيقة"], ["application", "بطلب يتقدم به المستحق"], ["survey", "بدراسة يجريها الناظر"]], R),
        yn("criteria", "هل توجد معايير مفاضلة معمول بها؟", R),
        area("criteriaText", "معايير المفاضلة الحالية", { showIf: yes("criteria"), requiredIf: yes("criteria"), review: "sharia" }),
        yn("disputes", "هل وقعت خلافات بين المستحقين حول الصرف؟"),
      ],
    }],
  },
  G06: {
    code: "G06", version: 2, sources: ["تعريف الخدمة في الكتالوج", "لائحة تنظيم أعمال النظارة م18: تعارض المصالح"], docs: [],
    steps: [{
      key: "coi", title: "النطاق",
      fields: [
        legacy(num("people", "عدد المشمولين (المجلس والإدارة)", { min: 1 })),
        checks("scope", "من تشملهم السياسة؟", [["board", "أعضاء المجلس"], ["executives", "الإدارة التنفيذية"], ["committees", "أعضاء اللجان"], ["staff", "الموظفون"], ["contractors", "المتعاقدون ومقدمو الخدمات"]], R),
        yn("existingPolicy", "هل توجد سياسة قائمة؟", R),
        yn("knownConflicts", "هل توجد حالات تعارض معروفة الآن؟", R),
        table("conflicts", "حالات التعارض المعروفة", [
          { key: "person", label: "الشخص أو الجهة", type: "text", required: true },
          { key: "nature", label: "طبيعة التعارض", type: "text", required: true },
        ], { showIf: yes("knownConflicts"), requiredIf: yes("knownConflicts"), minRows: 1 }),
        sel("disclosureFrequency", "دورية الإفصاح المطلوبة", [["annual", "سنوية"], ["per_meeting", "قبل كل اجتماع"], ["on_change", "عند كل تغيير"]], R),
      ],
    }],
  },
  G07: {
    code: "G07", version: 2, sources: ["الدليل الإرشادي لصياغة وثيقة الوقف (البند السادس: النظارة وأحكامها)", "لائحة تنظيم أعمال النظارة م7: انتهاء النظارة"],
    docs: [doc("deed", "waqf_deed", "وثيقة الوقف")],
    steps: [{
      key: "succession", title: "الاستخلاف",
      intro: "صيغة النظارة الحالية ونظّار الوقف مقروءة من ملف الوقف أعلاه.",
      fields: [
        legacy(radio("form", "شكل النظارة", [["individual", "ناظر فرد"], ["board", "مجلس"], ["entity", "جهة اعتبارية"]])),
        yn("deedCovers", "هل تنص وثيقة الوقف على آلية الاستخلاف؟", R),
        area("deedText", "نص الوثيقة في الاستخلاف", { showIf: yes("deedCovers"), requiredIf: yes("deedCovers"), review: "sharia" }),
        radio("preferredModel", "الآلية التي تفضّلها (فيما لم تنص عليه الوثيقة)", [["eldest", "الأرشد فالأرشد من الذرية"], ["board_elects", "يختار المجلس من يخلف"], ["nominated", "ترشيح مسبق من الناظر"], ["entity", "جهة اعتبارية"]]),
        yn("candidatesKnown", "هل يوجد مرشحون معروفون للخلافة؟"),
        area("interim", "من يتولى الأعمال مؤقتًا عند شغور النظارة؟"),
      ],
    }],
  },
  G08: {
    code: "G08", version: 2, sources: ["تعريف الخدمة وقاعدة الاستقلال في الكتالوج", "الدليل الإرشادي للواقفين (الرقابة والتقييم)"],
    docs: [doc("fin", "financial_statement", "آخر قوائم أو بيان مالي (إن لم يكن في ملف الوقف)"), doc("bank", "bank_statement", "كشوف الحساب البنكي للفترة"), doc("prev", "other", "تقرير المراجعة السابقة", { showIf: yes("previousFindings") })],
    steps: [{
      key: "audit", title: "نطاق المراجعة",
      intro: "القيود والموازنة والقرارات والالتزامات والمخاطر المسجلة في ملف الوقف تُقرأ للفترة المحددة.",
      fields: [
        legacy(YEAR("period", "السنة محل المراجعة")),
        ...period(),
        checks("scope", "مجالات المراجعة", [["financial", "مالية"], ["operational", "تشغيلية"], ["compliance", "امتثال"], ["distribution", "الصرف للمستحقين"], ["it", "تقنية المعلومات"]], R),
        radio("auditFunction", "وظيفة المراجعة الحالية", [["none", "لا توجد"], ["internal", "موظف أو لجنة داخلية"], ["outsourced", "جهة خارجية"]], R),
        date("lastAudit", "تاريخ آخر مراجعة"),
        yn("previousFindings", "هل توجد ملاحظات سابقة لم تُعالج؟"),
        area("focusRisks", "مخاطر أو مواضع تريد التركيز عليها", { review: "financial" }),
      ],
    }],
  },
  G09: {
    code: "G09", version: 2,
    sources: [
      "مبادئ حوكمة الأوقاف (مسودة)، المبدأ الرابع «فاعلية النظارة»: الأهلية والكفاءة، أداء المهام بعناية، رشد القرارات، آليات تنفيذ القرارات وقياس أثرها، تكامل المجلس",
      "مبادئ حوكمة الأوقاف: «تبني الوسائل التي تكفل إجراء تقييم دوري لفاعلية الناظر أو أعضاء مجلس النظارة… على أن تشمل عملية التقييم الإجراءات اللازمة لمعالجة أوجه القصور»",
      "الدليل الإرشادي للواقفين (الرقابة والتقييم، ص59): مؤشرات مالية وتشغيلية وجودة ومصارف والتزام",
      "تعريف الخدمة وقاعدة الاستقلال في الكتالوج",
    ],
    docs: [
      doc("plan", "policy", "الخطة الاستراتيجية أو التشغيلية للفترة", { requiredIf: yes("hasPlan"), showIf: yes("hasPlan") }),
      doc("kpi", "other", "تقرير مؤشرات الأداء للفترة", { requiredIf: when("kpisRecorded", "document"), showIf: when("kpisRecorded", "document") }),
      doc("selfEval", "other", "نماذج التقييم الذاتي المعبأة (إن وجدت)", { showIf: { field: "method", in: ["self", "peer"] } }),
      doc("minutes", "minutes", "محاضر اجتماعات غير مرفوعة في ملف الوقف"),
    ],
    steps: [
      {
        key: "scope", title: "نطاق التقييم",
        intro: "أعضاء المجلس وصفاتهم ومدد عضويتهم، والاجتماعات والقرارات وتنفيذها، والسياسات والالتزامات والمخاطر مقروءة من ملف الوقف للفترة التي تحددها.",
        fields: [
          legacy(num("boardSize", "عدد أعضاء المجلس", { min: 1 })), legacy(YEAR("period", "سنة التقييم")),
          checks("evaluatee", "من يشمله التقييم؟", [["board", "مجلس النظارة مجتمعًا"], ["members", "أعضاء المجلس فرادى"], ["nazir", "الناظر"], ["committees", "لجان المجلس"]], R),
          ...period(),
        ],
      },
      {
        key: "objectives", title: "الأهداف والمؤشرات",
        fields: [
          yn("hasPlan", "هل للوقف خطة معتمدة تغطي الفترة؟", R),
          radio("kpisRecorded", "هل تُقاس مؤشرات أداء للوقف؟", [["document", "نعم، في تقرير أرفقه"], ["partial", "بعضها، دون تقرير منتظم"], ["none", "لا تُقاس مؤشرات"]], R),
          table("objectives", "أهداف الفترة ومؤشراتها (إن وجدت)", [
            { key: "objective", label: "الهدف", type: "text", required: true },
            { key: "indicator", label: "المؤشر", type: "text" },
            { key: "target", label: "المستهدف", type: "text" },
            { key: "actual", label: "المتحقق", type: "text" },
          ], { maxRows: 15 }),
        ],
      },
      {
        key: "criteria", title: "معايير التقييم",
        fields: [
          checks("criteria", "محاور التقييم", [
            ["competence", "الأهلية والقدرة والكفاءة"], ["diligence", "أداء المهام بعناية وحرص"], ["decisions", "رشد القرارات واستنادها إلى المعلومات"],
            ["execution", "تنفيذ القرارات وقياس أثرها"], ["cohesion", "تكامل المجلس وفاعلية اجتماعاته"], ["compliance", "الالتزام بشرط الواقف والأنظمة"],
            ["financial", "الأداء المالي وحماية الأصول"], ["masarif", "تحقيق المصارف"],
          ], R),
          radio("weighting", "أوزان المحاور", [["equal", "أوزان متساوية"], ["custom", "أوزان أحددها"]], R),
          table("weights", "الأوزان (مجموعها 100٪)", [
            { key: "criterion", label: "المحور", type: "select", required: true, options: [["competence", "الأهلية والكفاءة"], ["diligence", "العناية والحرص"], ["decisions", "رشد القرارات"], ["execution", "تنفيذ القرارات"], ["cohesion", "تكامل المجلس"], ["compliance", "الالتزام"], ["financial", "الأداء المالي"], ["masarif", "تحقيق المصارف"]] },
            { key: "weight", label: "الوزن", type: "percent", required: true, min: 1 },
          ], { showIf: when("weighting", "custom"), requiredIf: when("weighting", "custom"), minRows: 2, maxRows: 8 }),
          checks("method", "طريقة جمع الأدلة", [["documents", "مراجعة السجلات والمستندات"], ["self", "تقييم ذاتي للأعضاء"], ["peer", "تقييم متبادل بين الأعضاء"], ["interviews", "مقابلات"], ["beneficiaries", "استطلاع المستفيدين"]], R),
        ],
      },
      {
        key: "deliverable", title: "الملاحظات والمخرجات",
        fields: [
          area("knownIssues", "تحديات أو ملاحظات معروفة تريد أن يتناولها التقييم"),
          checks("outputs", "المخرجات المطلوبة", [["report", "تقرير التقييم"], ["scorecard", "بطاقة أداء بالدرجات"], ["plan", "خطة معالجة أوجه القصور"], ["members", "ملاحظات فردية لكل عضو"]], R),
        ],
      },
    ],
  },
  G10: {
    code: "G10", version: 2, sources: ["معايير المستفيد الحقيقي: بيانات المستفيد الحقيقي وتحديثها خلال 15 يومًا من التغيير (م6/1)"],
    docs: [doc("bo", "bo_register", "سجل المستفيد الحقيقي (إن لم يكن في ملف الوقف)")],
    steps: [{
      key: "aml", title: "الوضع الحالي",
      intro: "سجل المستفيد الحقيقي وتواريخ التحقق منه مقروءة من ملف الوقف أعلاه.",
      fields: [
        legacy(yn("boKnown", "هل بيانات المستفيدين الحقيقيين مكتملة؟")),
        yn("foreignParty", "هل في الوقف طرف أجنبي؟", { ...R, prefill: "waqf.hasForeignParty" }),
        yn("beneficiariesAbroad", "هل يوجد مستفيدون خارج المملكة؟", { ...R, prefill: "waqf.hasBeneficiariesAbroad" }),
        yn("collectsDonations", "هل يجمع الوقف تبرعات من الغير؟", { ...R, prefill: "waqf.collectsDonations" }),
        yn("cashTransactions", "هل يتعامل الوقف بالنقد خارج الحساب البنكي؟", R),
        yn("existingProgram", "هل توجد إجراءات معتمدة لمكافحة غسل الأموال؟", R),
      ],
    }],
  },

  // ── F المالية
  // Budgets, statements, ledger entries, distributions and bank statements are read from the waqf file for the year or
  // period asked; the forms ask for what is specific to the task.
  F01: {
    code: "F01", version: 2, sources: ["لائحة تنظيم أعمال النظارة م12/2: استقطاع ما يلزم للصيانة والتشغيل قبل الصرف"], docs: [doc("deed", "waqf_deed", "وثيقة الوقف", { required: true })],
    steps: [{
      key: "fin", title: "موضوع التحليل",
      intro: "شروط الواقف والمصارف والأصول ودخلها والسجلات المالية مقروءة من ملف الوقف أعلاه.",
      fields: [
        YEAR("fiscalYear", "السنة المالية محل التحليل"),
        checks("questions", "ما الذي تريد تحليله؟", [["maintenance", "استقطاع الصيانة والتشغيل قبل الصرف"], ["nazirFee", "أجرة الناظر"], ["split", "قسمة الريع بين المصارف"], ["reinvest", "إعادة استثمار جزء من الريع"], ["reserve", "الاحتياطي"], ["debt", "الديون والالتزامات على الوقف"]], R),
        money("revenue", "الإيراد السنوي (إن لم يكن مسجلًا في ملف الوقف)"),
        area("issue", "المسألة أو الإشكال المالي", { ...R, minLength: 15, review: "financial" }),
        legacy(area("termsSummary", "ما ورد في الشرط عن الريع والصيانة والمصارف")),
      ],
    }],
  },
  F02: {
    code: "F02", version: 2, sources: ["تعريف الخدمة في الكتالوج", "لائحة تنظيم أعمال النظارة م15: الإدارة المالية"], docs: [doc("bank", "bank_statement", "كشوف الحساب البنكي (آخر 3 أشهر)")],
    steps: [{
      key: "acc", title: "الوضع المحاسبي",
      fields: [
        sel("system", "النظام الحالي", [["none", "لا يوجد"], ["spreadsheet", "جداول"], ["software", "برنامج محاسبي"]], R),
        text("software", "اسم البرنامج المحاسبي", { showIf: when("system", "software") }),
        num("monthlyTx", "عدد العمليات الشهرية التقريبي", { ...R, min: 0 }),
        num("bankAccounts", "عدد الحسابات البنكية باسم الوقف", { ...R, min: 0 }),
        text("fiscalYearEnd", "نهاية السنة المالية (شهر-يوم)", { prefill: "waqf.fiscalYearEnd" }),
        yn("costCenters", "هل تحتاج مراكز تكلفة (لكل أصل أو مشروع أو مصرف)؟", R),
        checks("reporting", "التقارير التي يجب أن يخدمها النظام", [["gaa", "متطلبات الهيئة العامة للأوقاف"], ["board", "تقارير المجلس"], ["beneficiaries", "تقارير المستفيدين"], ["audit", "متطلبات المراجع الخارجي"]], R),
        radio("vat", "التسجيل في ضريبة القيمة المضافة", [["registered", "مسجل"], ["not_registered", "غير مسجل"], ["unknown", "لا أعرف"]], { ...R, review: "financial" }),
      ],
    }],
  },
  F03: {
    code: "F03", version: 2, sources: ["تعريف الخدمة وقاعدة الاستقلال في الكتالوج"], docs: [doc("bank", "bank_statement", "كشوف الحساب البنكي للفترة غير المقيدة")],
    steps: [{
      key: "books", title: "الدفاتر",
      intro: "القيود المسجلة في ملف الوقف وآخر تاريخ قيد معروضة أعلاه.",
      fields: [
        num("monthlyTx", "عدد العمليات الشهرية", { ...R, min: 0 }),
        num("accounts", "عدد الحسابات البنكية", { ...R, min: 1 }),
        date("startOn", "تاريخ بدء مسك الدفاتر المطلوب", R),
        date("backlogFrom", "إن وُجدت فترة غير مقيدة: من تاريخ"),
        checks("documents", "المستندات المتاحة للقيد", [["invoices", "فواتير"], ["receipts", "سندات قبض وصرف"], ["bank", "كشوف بنكية"], ["contracts", "عقود الإيجار والخدمات"]], R),
      ],
    }],
  },
  F04: {
    code: "F04", version: 2, sources: ["تعريف الخدمة: الموازنة متطلب للأوقاف الكبيرة والمتوسطة", "لائحة تنظيم أعمال النظارة م12/2، م15"],
    docs: [doc("fin", "financial_statement", "قوائم السنة السابقة (إن لم تكن في ملف الوقف)")],
    steps: [
      {
        key: "budget", title: "سنة الموازنة",
        intro: "موازنات السنوات السابقة وقوائمها والأصول ودخلها المسجل مقروءة من ملف الوقف أعلاه.",
        fields: [
          YEAR("fiscalYear", "سنة الموازنة"),
          radio("approvalBy", "من يعتمد الموازنة؟", [["board", "مجلس النظارة"], ["nazir", "الناظر"]], R),
          legacy(money("revenue", "الإيراد المتوقع (ر.س)")),
        ],
      },
      {
        key: "lines", title: "الإيرادات والمصروفات المتوقعة",
        fields: [
          table("revenues", "الإيرادات المتوقعة", [
            { key: "source", label: "المصدر", type: "select", required: true, options: [["rent", "إيجارات"], ["investment", "عوائد استثمار"], ["donations", "تبرعات"], ["other", "أخرى"]] },
            { key: "description", label: "البيان", type: "text" },
            { key: "amount", label: "المبلغ", type: "money", required: true },
          ], { ...R, minRows: 1 }),
          table("expenses", "المصروفات المخطط لها", [
            { key: "category", label: "البند", type: "select", required: true, options: [["maintenance", "صيانة وتشغيل"], ["distribution", "صرف على المستحقين"], ["nazirFee", "أجرة الناظر"], ["admin", "مصاريف إدارية"], ["development", "تنمية وإعادة استثمار"], ["reserve", "احتياطي"], ["other", "أخرى"]] },
            { key: "description", label: "البيان", type: "text" },
            { key: "amount", label: "المبلغ", type: "money", required: true },
          ], { ...R, minRows: 1 }),
          legacy(area("plans", "المصروفات والمشاريع المخطط لها")),
          area("assumptions", "افتراضات الموازنة (نسب الإشغال، زيادات الإيجار…)", { review: "financial" }),
        ],
      },
    ],
  },
  F05: {
    code: "F05", version: 2, sources: ["لائحة تنظيم أعمال النظارة م15: البيان المالي للأوقاف الصغيرة وذات الانتفاع المباشر"], docs: [doc("bank", "bank_statement", "كشوف الحساب البنكي للسنة", { required: true })],
    steps: [{
      key: "year", title: "السنة",
      fields: [
        YEAR(),
        num("bankAccounts", "عدد الحسابات البنكية للوقف", { ...R, min: 0 }),
        checks("revenueTypes", "أنواع الإيراد في السنة", [["rent", "إيجارات"], ["investment", "عوائد استثمار"], ["donations", "تبرعات"], ["other", "أخرى"]], R),
        yn("distributed", "هل صُرف للمستحقين خلال السنة؟", R),
        yn("receiptsKept", "هل تتوفر مستندات المصروفات (فواتير وسندات)؟", R),
        legacy(area("revenueSources", "مصادر الإيراد")),
      ],
    }],
  },
  F06: {
    code: "F06", version: 2, sources: ["تعريف الخدمة وقاعدة الاستقلال في الكتالوج"], docs: [doc("fin", "financial_statement", "القوائم المالية", { required: true }), doc("bank", "bank_statement", "كشوف الحساب البنكي", { required: true })],
    steps: [{
      key: "audit", title: "المراجعة",
      fields: [
        YEAR(),
        yn("statementsReady", "هل القوائم المالية جاهزة؟", R),
        radio("basis", "أساس إعداد القوائم", [["accrual", "أساس الاستحقاق"], ["cash", "أساس نقدي"], ["unknown", "لا أعرف"]], { ...R, review: "financial" }),
        yn("previousAuditor", "هل رُوجعت قوائم سابقة؟"),
        date("gaaDeadline", "الموعد النظامي لرفع القوائم (إن عُرف)"),
      ],
    }],
  },
  F07: {
    code: "F07", version: 2, sources: ["تعريف الخدمة: الرفع بيد الناظر عبر خدمة الهيئة"], docs: [doc("fin", "financial_statement", "القوائم أو البيان المالي", { required: true })],
    steps: [{
      key: "year", title: "البيانات",
      fields: [
        YEAR(),
        sel("type", "نوع البيانات", [["audited", "قوائم مدققة"], ["simplified", "بيان مالي مبسط"]], R),
        yn("portalAccess", "هل للناظر صلاحية الدخول إلى خدمة الهيئة؟", R),
        yn("submittedBefore", "هل رُفعت بيانات سنوات سابقة؟"),
      ],
    }],
  },
  F08: {
    code: "F08", version: 2, sources: ["تعريف الخدمة في الكتالوج", "الدليل الإرشادي للواقفين (الرقابة والتقييم): مؤشرات مالية وتشغيلية"], docs: [],
    steps: [{
      key: "rep", title: "التقرير",
      fields: [
        sel("frequency", "الدورية", FREQ, R),
        checks("indicators", "المؤشرات المطلوبة", [["revenue", "نمو الإيرادات"], ["occupancy", "نسب الإشغال"], ["expenseRatio", "نسبة المصروفات إلى الإيرادات"], ["distributionRatio", "نسبة الصرف إلى صافي الريع"], ["returnOnAssets", "العائد على الأصول"], ["budgetVariance", "الانحراف عن الموازنة"]], R),
        text("recipients", "من يستلم التقرير؟"),
      ],
    }],
  },
  F09: {
    code: "F09", version: 1, sources: ["لائحة تنظيم أعمال النظارة م15/1: حساب بنكي مستقل باسم الوقف"],
    docs: [doc("deed", "waqf_deed", "صك الوقف", { required: true }), doc("nazara", "nazara_deed", "صك النظارة", { required: true })],
    steps: [{ key: "acc", title: "الحساب الحالي", fields: [sel("holder", "أموال الوقف حاليًا في حساب", [["waqif", "الواقف الشخصي"], ["nazir", "الناظر الشخصي"], ["entity", "جهة أخرى"], ["none", "لا توجد أموال نقدية"]], R), text("bank", "البنك المفضل"), yn("mixed", "هل اختلطت أموال الوقف بأموال أخرى؟", R)] }],
  },

  // ── I الاستثمار والأصول
  I01: {
    code: "I01", version: 2, sources: ["الدليل الإرشادي لاستثمار الأوقاف ودليل قواعد وضوابط الاستثمار", "تعريف الخدمة: على مستوى السياسات والفئات دون تسمية أوراق مالية"],
    docs: [doc("deed", "waqf_deed", "وثيقة الوقف")],
    steps: [{
      key: "inv", title: "الاستثمار",
      intro: "الأصول وقيمها ودخلها والسياسات المعتمدة مقروءة من ملف الوقف أعلاه.",
      fields: [
        money("investable", "المبلغ القابل للاستثمار (ر.س)", R),
        legacy(area("current", "الأصول والاستثمارات الحالية")),
        money("annualNeeds", "احتياج الصرف السنوي من العوائد (ر.س)", { hint: "ما يلزم للمصارف والصيانة سنويًا." }),
        sel("risk", "تحمل المخاطر", [["low", "منخفض"], ["medium", "متوسط"], ["high", "مرتفع"]], R),
        sel("horizon", "الأفق الاستثماري", [["short", "أقل من 3 سنوات"], ["medium", "3–7 سنوات"], ["long", "أكثر من 7 سنوات"]], R),
        yn("deedAllows", "هل تجيز وثيقة الوقف الاستثمار؟", { ...R, review: "sharia" }),
        area("exclusions", "استثناءات أو قيود تريدها (قطاعات، أدوات)", { review: "sharia" }),
        yn("existingPolicy", "هل توجد سياسة استثمار سابقة؟"),
      ],
    }],
  },
  I02: {
    code: "I02", version: 2, sources: ["تعريف الخدمة في الكتالوج", "الدليل الإرشادي لاستثمار الأوقاف"], docs: [],
    steps: [{
      key: "ret", title: "المعطيات",
      intro: "الأصول ودخلها المسجل والسجلات المالية مقروءة من ملف الوقف أعلاه.",
      fields: [
        money("spending", "ميزانية المصارف السنوية (ر.س)", R),
        pct("reinvest", "نسبة إعادة الاستثمار", R),
        pct("currentReturn", "العائد الحالي إن عُرف"),
        num("horizonYears", "أفق المحافظة على القيمة الحقيقية (بالسنوات)", { min: 1, max: 50 }),
        pct("inflation", "افتراض التضخم السنوي (إن رغبت)", { review: "financial" }),
      ],
    }],
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
    code: "I05", version: 2, sources: ["لائحة المنتجات الاستثمارية الوقفية م24/2: محتوى اتفاقية الإدارة مع مؤسسة السوق المالية"], docs: [doc("draft", "contract", "مسودة اتفاقية الإدارة", { showIf: yes("hasDraft") })],
    steps: [{
      key: "mgr", title: "التفويض",
      fields: [
        money("amount", "المبلغ المراد إسناد إدارته (ر.س)", R),
        sel("mandate", "نوع التفويض", [["discretionary", "إدارة تقديرية"], ["advisory", "استشاري"]], R),
        checks("criteria", "معايير المفاضلة بين المديرين", [["track", "سجل الأداء"], ["fees", "الرسوم"], ["sharia", "الرقابة الشرعية"], ["reporting", "التقارير والإفصاح"], ["waqfExperience", "الخبرة مع الأوقاف"]], R),
        area("shortlist", "مديرون مرشحون إن وجدوا"),
        yn("hasDraft", "هل لديك مسودة اتفاقية؟", R),
      ],
    }],
  },
  I06: {
    code: "I06", version: 1, sources: ["لائحة المنتجات الاستثمارية الوقفية م21–م23: تسجيل الوقف، وفتح الحساب الاستثماري، وقيده لدى الهيئة خلال 5 أيام عمل لكل مرحلة", "لائحة إنشاء المحافظ الاستثمارية الوقفية م5"],
    docs: [doc("accountAgreement", "contract", "اتفاقية فتح الحساب الاستثماري", { requiredIf: when("stage", "record") }), doc("mgmtAgreement", "contract", "اتفاقية الإدارة مع مؤسسة السوق المالية", { showIf: yes("delegated") })],
    steps: [{ key: "pf", title: "المحفظة", fields: [radio("stage", "المرحلة", [["register", "تسجيل محفظة جديدة"], ["record", "قيد حساب ومحفظة قائمين"]], R), text("custodian", "مؤسسة السوق المالية", R), yn("delegated", "هل أُسندت الإدارة لمؤسسة مرخصة؟", R), date("accountOpenedOn", "تاريخ فتح الحساب", { showIf: when("stage", "record") })] }],
  },
  I07: {
    code: "I07", version: 2, sources: ["تعريف الخدمة في الكتالوج", "الدليل الإرشادي لاستثمار الأوقاف (حوكمة الاستثمار ومتابعة الأداء)"], docs: [doc("policy", "policy", "سياسة الاستثمار المعتمدة (إن لم تكن في ملف الوقف)")],
    steps: [{
      key: "perf", title: "المتابعة",
      fields: [
        yn("policyExists", "هل للوقف سياسة استثمار معتمدة؟", R),
        sel("frequency", "الدورية", FREQ, R),
        checks("scope", "الأصول المشمولة بالمتابعة", ASSET_TYPES, R),
        area("benchmarks", "المؤشرات المرجعية للمقارنة (إن وجدت)"),
      ],
    }],
  },
  I08: {
    code: "I08", version: 2, sources: ["تعريف الخدمة: التقييم لمقيّم معتمد", "الدليل الإرشادي لاختيار الأصول الوقفية"], docs: [doc("ownership", "ownership_deed", "صكوك أصول غير مرفوعة في ملف الوقف")],
    steps: [{
      key: "assets", title: "الأصول",
      intro: "الأصول المسجلة وقيمها وتواريخ تقييمها مقروءة من ملف الوقف أعلاه.",
      fields: [
        legacy(num("count", "عدد الأصول", { min: 1 })),
        checks("types", "أنواع الأصول", ASSET_TYPES, R),
        yn("valuation", "هل تحتاج تقييمًا من مقيّم معتمد؟", R),
        yn("unregistered", "هل للوقف أصول غير مسجلة في ملف الوقف؟", R),
        table("newAssets", "الأصول غير المسجلة", [
          { key: "title", label: "الأصل", type: "text", required: true },
          { key: "type", label: "النوع", type: "select", options: ASSET_TYPES },
          { key: "deedNo", label: "رقم الصك أو المستند", type: "text" },
          { key: "value", label: "القيمة التقديرية", type: "money" },
        ], { showIf: yes("unregistered"), requiredIf: yes("unregistered"), minRows: 1 }),
      ],
    }],
  },
  I09: {
    code: "I09", version: 2, sources: ["تعريف الخدمة في الكتالوج", "لائحة تنظيم أعمال النظارة م12/2: الصيانة والتشغيل"], docs: [doc("leases", "lease", "عقود الإيجار القائمة")],
    steps: [{
      key: "props", title: "العقارات",
      intro: "العقارات المسجلة وحالتها ودخلها مقروءة من ملف الوقف أعلاه.",
      fields: [
        legacy(num("count", "عدد العقارات", { min: 1 })), legacy(text("types", "أنواعها (سكني، تجاري…)")),
        num("leases", "عدد عقود الإيجار القائمة", { min: 0 }),
        yn("ejar", "هل العقود موثقة في «إيجار»؟"),
        date("lastMaintenance", "تاريخ آخر صيانة شاملة"),
        area("knownIssues", "أعطال أو ملاحظات معروفة"),
        money("budget", "الميزانية المتاحة للصيانة سنويًا (ر.س)"),
      ],
    }],
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
    code: "C02", version: 2, sources: ["تعريف الخدمة في الكتالوج"], docs: [],
    steps: [{
      key: "deep", title: "التقييم المعمّق",
      intro: "سجلات الوقف (الحوكمة والمالية والأصول والالتزامات) مقروءة من ملف الوقف أعلاه.",
      fields: [
        yn("basicDone", "هل أجريت التقييم الأساسي في المنصة؟", R),
        checks("focus", "محاور التركيز", [["governance", "الحوكمة والنظارة"], ["finance", "المالية والصرف"], ["compliance", "الالتزامات النظامية"], ["assets", "الأصول والاستثمار"], ["beneficiaries", "المستفيدون"], ["documents", "الوثائق والتسجيل"]], R),
        sel("interviewMode", "طريقة المقابلة", MEETING, R),
        text("contactPerson", "من نقابل من جهة الوقف؟"),
      ],
    }],
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
    code: "C05", version: 2, sources: ["مبادئ حوكمة الأوقاف (مسودة): مكونات التقرير السنوي"], docs: [doc("fin", "financial_statement", "القوائم المالية للسنة (إن لم تكن في ملف الوقف)")],
    steps: [{
      key: "report", title: "التقرير",
      fields: [
        YEAR(),
        checks("audience", "الجمهور", [["beneficiaries", "المستفيدون"], ["board", "المجلس"], ["public", "العموم"]], R),
        yn("financials", "هل يتضمن القوائم المالية؟", R),
        area("highlights", "أبرز ما تحقق في السنة (برامج، مشاريع، أثر)"),
      ],
    }],
  },
  C06: {
    code: "C06", version: 2, sources: ["لائحة تنظيم أعمال النظارة م10/3: إتاحة المعلومات للموقوف عليهم"], docs: [],
    steps: [{
      key: "rep", title: "التقارير",
      fields: [
        num("count", "عدد المستفيدين", { ...R, min: 1 }),
        sel("frequency", "الدورية", FREQ, R),
        checks("contents", "ما يتضمنه التقرير", [["distributions", "ما صُرف لكل فئة"], ["revenue", "ملخص الإيرادات"], ["assets", "حالة الأصول"], ["decisions", "القرارات المؤثرة في المستحقين"]], R),
        checks("channels", "طريقة الإتاحة", [["platform", "حساب المستفيد في المنصة"], ["email", "البريد"], ["print", "نسخة مطبوعة"]], R),
      ],
    }],
  },
  C07: consultation("C07", "شرعية", [], [], "sharia"),
  C08: consultation("C08", "قانونية", [
    sel("legalArea", "مجال المسألة", [["nazara", "النظارة وصلاحيات الناظر"], ["contracts", "العقود (إيجار، استثمار، خدمات)"], ["disputes", "نزاع أو مطالبة"], ["regulatory", "التزامات نظامية لدى الهيئة"], ["real_estate", "العقارات والصكوك"], ["labor", "العمل والتوظيف"], ["other", "أخرى"]], R),
    table("parties", "أطراف المسألة (إن وجدوا)", [
      { key: "name", label: "الاسم أو الجهة", type: "text", required: true },
      { key: "role", label: "الصفة", type: "text" },
    ], { maxRows: 10 }),
    yn("priorProceedings", "هل اتُّخذ إجراء نظامي أو قضائي في المسألة؟"),
    yn("hasDeadline", "هل توجد مهلة نظامية أو موعد جلسة؟"),
    date("legalDeadline", "تاريخ المهلة أو الجلسة", { showIf: yes("hasDeadline"), requiredIf: yes("hasDeadline") }),
    area("desiredOutcome", "النتيجة التي تسعى إليها"),
  ], ["نظام المعاملات المدنية (عند المسائل التعاقدية)"], "legal"),
  C09: consultation("C09", "مالية", [], [], "financial"),
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
  const ctx = contextFor(svc.code).length ? [WAQF_DATA] : [];
  // which waqf the request concerns (registered / unregistered / none): set by the server from the request's start
  const applicant: Step = { ...ap.step, fields: [...ap.step.fields, hidden("waqfMode")] };
  const uw = unregisteredWaqf(svc.code, base.steps, docs);
  return {
    code: svc.code, version: base.version, sources: base.sources,
    steps: [applicant, ...ctx, ...(uw ? [uw.step] : []), ...base.steps, NOTES],
    docs: [...docs, ...(uw?.docs ?? []), ...ap.docs],
  };
}
