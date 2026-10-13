/**
 * Service outputs: what each catalog service produces, in which specialty, from which template, and how it is approved.
 * PURE module (no DB). Titles follow the «المخرجات» of each service in the catalog (src/server/seed/data/services.ts).
 *
 * Approval policy (an operational decision of the platform — the project's quality policy file is the GAA's general
 * ISO 9001 policy and sets no rule for service providers' outputs; see docs/SERVICE-FLOWS-AUDIT.md §6):
 * - independent: signed opinions, deeds, wills, audits and feasibility studies are approved only by someone who did not
 *   prepare any version (four-eyes).
 * - self_allowed: packages, registers and operational reports may be approved by an authorized manager who prepared
 *   them; the approval is recorded as a self-approval.
 */
import type { OutputSpecialty, ReviewPolicy } from "@/server/db/schema/operations";

export type Profile =
  | "sharia_memo" | "sharia_opinion" | "will_text" | "deed_draft"
  | "legal_review" | "legal_package"
  | "finance_report" | "finance_opinion"
  | "investment_policy" | "investment_assets" | "investment_opinion"
  | "governance_package" | "ops_package" | "nazara_study" | "aml_program";

export type OutputDef = {
  key: string;
  title: string;
  specialty: OutputSpecialty;
  profile: Profile;
  review: ReviewPolicy;
};

export const SPECIALTY_LABEL: Record<OutputSpecialty, string> = {
  sharia: "شرعي ووقفي", legal: "قانوني وتعاقدي", finance: "مالي ومحاسبي", investment: "استثماري", governance: "حوكمة والتزام", operations: "إداري وتشغيلي",
};
export const REVIEW_LABEL: Record<ReviewPolicy, string> = {
  independent: "اعتماد مستقل (غير من أعدّه)",
  self_allowed: "يجوز للمدير المخوّل اعتماد ما أعدّه، ويُسجَّل اعتمادًا ذاتيًا",
};

/** Default review policy of each profile. */
const PROFILE_REVIEW: Record<Profile, ReviewPolicy> = {
  sharia_memo: "independent", sharia_opinion: "independent", will_text: "independent", deed_draft: "independent",
  legal_review: "independent", legal_package: "self_allowed",
  finance_report: "self_allowed", finance_opinion: "independent",
  investment_policy: "self_allowed", investment_assets: "self_allowed", investment_opinion: "independent",
  governance_package: "self_allowed", ops_package: "self_allowed", nazara_study: "independent", aml_program: "self_allowed",
};

const PROFILE_SPECIALTY: Record<Profile, OutputSpecialty> = {
  sharia_memo: "sharia", sharia_opinion: "sharia", will_text: "sharia", deed_draft: "legal",
  legal_review: "legal", legal_package: "legal",
  finance_report: "finance", finance_opinion: "finance",
  investment_policy: "investment", investment_assets: "investment", investment_opinion: "investment",
  governance_package: "governance", ops_package: "operations", nazara_study: "operations", aml_program: "legal",
};

/** service code → profile (one output per service, titled with the service's catalog output). */
const SERVICE_PROFILE: Record<string, Profile> = {
  T01: "sharia_memo", T02: "governance_package", T03: "deed_draft", T04: "legal_review", T05: "investment_assets", T06: "ops_package",
  T07: "investment_assets", T08: "legal_package", T09: "legal_package",
  W01: "will_text", W02: "ops_package", W03: "sharia_opinion", W04: "governance_package", W05: "legal_review",
  N01: "nazara_study", N02: "governance_package", N03: "governance_package", N04: "ops_package", N05: "governance_package", N06: "ops_package",
  N07: "finance_report", N08: "legal_package", N09: "legal_review",
  G01: "governance_package", G02: "governance_package", G03: "governance_package", G04: "governance_package", G05: "governance_package",
  G06: "governance_package", G07: "governance_package", G08: "finance_opinion", G09: "governance_package", G10: "aml_program",
  F01: "finance_report", F02: "finance_report", F03: "finance_report", F04: "finance_report", F05: "finance_report", F06: "finance_opinion",
  F07: "finance_report", F08: "finance_report", F09: "finance_report",
  I01: "investment_policy", I02: "investment_assets", I03: "investment_opinion", I04: "legal_package", I05: "investment_assets",
  I06: "ops_package", I07: "investment_assets", I08: "investment_assets", I09: "ops_package",
  C01: "ops_package", C02: "governance_package", C03: "legal_review", C04: "legal_review", C05: "governance_package", C06: "governance_package",
  C07: "sharia_opinion", C08: "legal_review", C09: "finance_opinion", C10: "investment_opinion", C11: "sharia_opinion", C12: "legal_review", C13: "legal_review",
};

/** Outputs other than the catalog title, where the service's output is better named for the platform's part of it. */
const TITLE_OVERRIDE: Record<string, string> = {
  N01: "تقرير دراسة ملف الوقف وتوصية القبول",
  C01: "تقرير التقييم التشخيصي",
};

export function outputsFor(svc: { code: string; outputs?: string | null; nameAr?: string }): OutputDef[] {
  const profile = SERVICE_PROFILE[svc.code];
  if (!profile) return [];
  const title = TITLE_OVERRIDE[svc.code] ?? (svc.outputs?.split(/،|,/)[0]?.trim() || svc.nameAr || svc.code);
  return [{ key: `${svc.code}.main`, title, specialty: PROFILE_SPECIALTY[profile], profile, review: PROFILE_REVIEW[profile] }];
}

export const OUTPUT_SERVICE_CODES = Object.keys(SERVICE_PROFILE);

// ───────────────────────── Template content per profile ─────────────────────────

export type SectionKind =
  | "meta" | "request" | "documents" | "waqf" | "conditions" | "parties" | "beneficiaries" | "assets" | "finance" | "budget"
  | "distributions" | "governance" | "compliance" | "beneficial_owners" | "investment" | "scope" | "deed_clauses"
  | "will_clauses" | "checklist" | "nazara" | "stages" | "references";

/** Specialist-written parts: the generator never writes judgment, it frames the question and leaves it to the specialist. */
export type AnalysisDef = { key: string; title: string; prompt: string };

export type ProfileTemplate = { sections: SectionKind[]; analysis: AnalysisDef[]; disclaimer?: string };

const NO_FATWA = "هذه المسودة لا تتضمن حكمًا شرعيًا آليًا. الرأي يكتبه المستشار الشرعي ويُعتمد من مراجع مستقل، ولا يُنسب قول إلى مصدر دون سند.";
const NO_LAW = "لا تتضمن المسودة نصًا نظاميًا أو سابقة غير واردة في المراجع المعتمدة في المنصة. ما لم يُتحقق منه موسوم بذلك.";
const NO_GUARANTEE = "التوقعات والسيناريوهات ليست نتائج مضمونة، والأرقام الفعلية مأخوذة من سجلات الوقف كما هي.";

export const TEMPLATES: Record<Profile, ProfileTemplate> = {
  sharia_memo: {
    sections: ["meta", "request", "waqf", "conditions", "documents", "references"],
    analysis: [
      { key: "issue", title: "المسألة محل الدراسة", prompt: "صِغ المسألة كما يفهمها المستشار من طلب العميل والنصوص الأصلية أعلاه." },
      { key: "analysis", title: "التحليل", prompt: "اكتب التحليل مميزًا بين النص الأصلي والاستنتاج، مع ذكر مستند كل استنتاج." },
      { key: "recommendation", title: "التوصية والتصميم المقترح", prompt: "اكتب التوصية التي يعتمدها المستشار الشرعي." },
    ],
    disclaimer: NO_FATWA,
  },
  sharia_opinion: {
    sections: ["meta", "request", "waqf", "conditions", "documents", "references"],
    analysis: [
      { key: "question", title: "السؤال", prompt: "صِغ السؤال المطلوب الإجابة عنه بدقة." },
      { key: "analysis", title: "الدراسة", prompt: "اكتب الدراسة مميزًا بين النص الأصلي لشرط الواقف والتحليل، وسمِّ مرجع كل قول." },
      { key: "opinion", title: "الرأي", prompt: "يكتب المستشار الشرعي رأيه ويوقّعه. وتفسير شرط الواقف الملزم يكون من الجهة المختصة (لائحة تنظيم أعمال النظارة م9/2)." },
    ],
    disclaimer: NO_FATWA,
  },
  will_text: {
    sections: ["meta", "request", "will_clauses", "documents", "references"],
    analysis: [
      { key: "wording", title: "نص الوصية المقترح", prompt: "صِغ نص الوصية من البيانات أعلاه، ويراجعه مستشار شرعي مستقل (حدود الثلث وغير الوارث)." },
    ],
    disclaimer: NO_FATWA,
  },
  deed_draft: {
    sections: ["meta", "request", "deed_clauses", "documents", "references"],
    analysis: [
      { key: "review_note", title: "مذكرة المراجعة الشرعية والقانونية", prompt: "اكتب ملاحظات المراجعة على البنود ومواطن الغموض قبل التوثيق." },
    ],
    disclaimer: NO_LAW,
  },
  legal_review: {
    sections: ["meta", "request", "parties", "waqf", "conditions", "documents", "compliance", "references"],
    analysis: [
      { key: "facts", title: "الوقائع كما تثبتها المستندات", prompt: "لخّص الوقائع الثابتة بالمستندات المذكورة أعلاه فقط، بأسمائها وأرقامها وتواريخها." },
      { key: "issues", title: "المسائل والمخاطر", prompt: "حدد المسائل القانونية والمخاطر، واذكر سند كل مسألة من المراجع المعتمدة." },
      { key: "recommendations", title: "التوصيات والإجراءات", prompt: "اكتب التوصيات والإجراءات المقترحة ومن يتولاها." },
    ],
    disclaimer: NO_LAW,
  },
  legal_package: {
    sections: ["meta", "request", "parties", "waqf", "checklist", "documents", "stages", "references"],
    analysis: [
      { key: "notes", title: "ملاحظات الإعداد", prompt: "اذكر ما يلزم استكماله قبل التقديم أو التسليم، إن وجد." },
    ],
    disclaimer: NO_LAW,
  },
  finance_report: {
    sections: ["meta", "request", "waqf", "finance", "budget", "distributions", "documents", "references"],
    analysis: [
      { key: "notes", title: "إيضاحات المحاسب", prompt: "اكتب الإيضاحات على الأرقام أعلاه: التصنيف، والفترات، وما يحتاج قيدًا أو تسوية." },
    ],
  },
  finance_opinion: {
    sections: ["meta", "request", "waqf", "finance", "budget", "distributions", "documents", "references"],
    analysis: [
      { key: "procedures", title: "الإجراءات المنفذة", prompt: "اذكر إجراءات المراجعة أو الدراسة التي نُفذت فعلًا على المستندات المؤيدة." },
      { key: "findings", title: "الملاحظات", prompt: "اكتب الملاحظات مع مرجع كل ملاحظة (قيد، مستند، فترة)." },
      { key: "opinion", title: "الرأي", prompt: "يكتب المختص رأيه ويوقّعه، ويعتمده مراجع مستقل." },
    ],
  },
  investment_policy: {
    sections: ["meta", "request", "waqf", "conditions", "investment", "assets", "references"],
    analysis: [
      { key: "strategy", title: "استراتيجية الاستثمار وسياساته", prompt: "صِغ الاستراتيجية بما لا يخالف شرط الواقف ويحفظ الأصل." },
      { key: "risk", title: "مستوى المخاطر", prompt: "حدد مستوى المخاطر المقبول بما يراعي الطبيعة الوقفية ومصارف الوقف." },
      { key: "distribution", title: "آليات توزيع العوائد وإعادة استثمارها والرسوم", prompt: "حدد آلية التوزيع ونسبة إعادة الاستثمار والرسوم." },
    ],
    disclaimer: NO_GUARANTEE,
  },
  investment_assets: {
    sections: ["meta", "request", "waqf", "assets", "investment", "documents", "references"],
    analysis: [
      { key: "assessment", title: "التقييم والتوصية", prompt: "اكتب التقييم مميزًا بين الأرقام الفعلية والافتراضات، وسبّب التوصية." },
    ],
    disclaimer: NO_GUARANTEE,
  },
  investment_opinion: {
    sections: ["meta", "request", "waqf", "assets", "investment", "documents", "references"],
    analysis: [
      { key: "assumptions", title: "الافتراضات المعلنة", prompt: "اذكر كل افتراض يُبنى عليه التحليل ومصدره." },
      { key: "scenarios", title: "التحليل والسيناريوهات", prompt: "اكتب التحليل والسيناريوهات، ولا تقدم التوقع على أنه نتيجة." },
      { key: "opinion", title: "الرأي والتوصية", prompt: "يكتب المختص رأيه، ويعتمده مراجع مستقل." },
    ],
    disclaimer: NO_GUARANTEE,
  },
  governance_package: {
    sections: ["meta", "request", "waqf", "governance", "compliance", "documents", "references"],
    analysis: [
      { key: "gaps", title: "الفجوات والأولويات", prompt: "رتب الفجوات الظاهرة أعلاه بحسب الأولوية، ومن يعالجها." },
      { key: "drafting", title: "النصوص المقترحة", prompt: "صِغ النصوص أو اللوائح المطلوبة لهذا المخرج لتُعرض على الناظر أو المجلس للاعتماد." },
    ],
  },
  ops_package: {
    sections: ["meta", "request", "waqf", "checklist", "documents", "stages", "compliance", "references"],
    analysis: [
      { key: "notes", title: "ملاحظات التنفيذ", prompt: "اذكر ما نُفذ وما ينتظر طرفًا آخر، إن وجد." },
    ],
  },
  nazara_study: {
    sections: ["meta", "request", "waqf", "nazara", "conditions", "assets", "beneficiaries", "finance", "compliance", "documents", "references"],
    analysis: [
      { key: "observations", title: "ملاحظات الدراسة", prompt: "اكتب ملاحظات الفريق على الملف: ما ثبت وما يحتاج استكمالًا أو إذنًا." },
      { key: "recommendation", title: "التوصية", prompt: "التوصية بالقبول أو الرفض أو الاستكمال. قرار القبول يتخذه مدير النظارة في ملف النظارة، ومباشرة النظارة مشروطة بقرار التعيين والترخيص." },
    ],
  },
  aml_program: {
    sections: ["meta", "request", "waqf", "beneficial_owners", "compliance", "documents", "references"],
    analysis: [
      { key: "program", title: "إجراءات البرنامج", prompt: "صِغ إجراءات التحقق والتحديث والإبلاغ المناسبة لمستوى المخاطر." },
    ],
  },
};

/** Reference codes (regulatory_references) each profile rests on, in addition to the service form's own sources. */
export const PROFILE_REFS: Record<Profile, string[]> = {
  sharia_memo: ["DRAFTING-GUIDE", "WAQIF-GUIDE", "Q100"],
  sharia_opinion: ["NAZARA-REG", "Q100"],
  will_text: ["Q100", "WAQIF-GUIDE"],
  deed_draft: ["DRAFTING-GUIDE", "Q100", "CIVIL-TX"],
  legal_review: ["NAZARA-REG", "Q100", "CIVIL-TX"],
  legal_package: ["NAZARA-REG", "REG-USER-GUIDE"],
  finance_report: ["NAZARA-REG", "NAZIR-GUIDE", "GOV-PRINCIPLES"],
  finance_opinion: ["NAZARA-REG", "GOV-PRINCIPLES"],
  investment_policy: ["PORTFOLIO-REG", "INVEST-GUIDE", "INVEST-RULES", "WAQIF-GUIDE"],
  investment_assets: ["ASSETS-GUIDE", "INVEST-GUIDE", "PRODUCTS-REG"],
  investment_opinion: ["INVEST-GUIDE", "INVEST-RULES", "ASSETS-GUIDE"],
  governance_package: ["GOV-PRINCIPLES", "NAZIR-GUIDE", "NAZARA-REG"],
  ops_package: ["NAZARA-REG", "REG-USER-GUIDE", "NAZIR-GUIDE"],
  nazara_study: ["NAZARA-REG", "NAZIR-GUIDE", "BO-STD", "PENALTIES"],
  aml_program: ["BO-STD", "AML-LAW"],
};

/** The ten clauses of a waqf deed (الدليل الإرشادي لصياغة وثيقة الوقف) with the intake answers that feed each one. */
export const DEED_CLAUSES: { key: string; title: string; fields: string[] }[] = [
  { key: "waqif", title: "الواقف", fields: ["waqifName", "waqifId"] },
  { key: "asset", title: "الأصل الموقوف", fields: ["assetType", "assetDescription", "ownershipDeedNo", "registeredToWaqif", "mortgaged", "mortgageNote", "share", "sharePercent"] },
  { key: "name", title: "اسم الوقف", fields: ["waqfName"] },
  { key: "masarif", title: "المصارف", fields: ["beneficiaries"] },
  { key: "exception", title: "الاستثناء", fields: ["selfBenefit"] },
  { key: "nazara", title: "النظارة", fields: ["nazara"] },
  { key: "duties", title: "واجبات الناظر", fields: ["investmentAllowed"] },
  { key: "board", title: "المجلس", fields: ["board"] },
  { key: "closing", title: "الخاتمة", fields: ["amendmentRight"] },
  { key: "signature", title: "التوقيع", fields: [] },
];
