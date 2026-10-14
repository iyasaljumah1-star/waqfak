/**
 * Execution profile of a service (PURE): the family it belongs to and the parts of the shared request engine it uses.
 * The engine is one (status machine, guards, plan, tasks, outputs, billing); each service declares which capabilities
 * apply — commercial path, its own workflow stages, its outputs and review policy — so the plan shows only what applies.
 */
import { ACCEPTANCE_AR, CADENCE_AR, continuousSpec } from "./continuous-pure";
import { outputsFor, PROFILE_FORMAT, REVIEW_LABEL, type Profile } from "@/server/modules/outputs/catalog";

export type Family =
  | "drafting" | "opinion" | "study" | "finance" | "investment" | "governance" | "procedure" | "waqf_management" | "registration" | "self_assessment";

export const FAMILY_AR: Record<Family, string> = {
  drafting: "صياغة مستندات (وصية، وثيقة وقف)",
  opinion: "رأي واستشارة موقّعة",
  study: "دراسة وتصميم",
  finance: "مالية ومحاسبة",
  investment: "استثمار وأصول",
  governance: "حوكمة وامتثال",
  procedure: "إجراءات وتشغيل",
  waqf_management: "إدارة الوقف والنظارة (خدمة مستمرة أو تولي نظارة)",
  registration: "تسجيل وتوثيق لدى جهة مختصة",
  self_assessment: "تقييم مجاني",
};

const PROFILE_FAMILY: Record<Profile, Family> = {
  will_text: "drafting", deed_draft: "drafting",
  sharia_opinion: "opinion", finance_opinion: "opinion", investment_opinion: "opinion", legal_review: "opinion",
  sharia_memo: "study", investment_assets: "investment", investment_policy: "investment",
  finance_report: "finance", governance_package: "governance", aml_program: "governance",
  legal_package: "procedure", ops_package: "procedure", nazara_study: "waqf_management", periodic_report: "waqf_management", nazara_report: "waqf_management", delivery_record: "waqf_management",
};

export type ServiceLike = { code: string; nameAr?: string; outputs?: string | null; pricingModel: string; workflowTemplateCode?: string | null; workflow?: string | null };

export type ExecutionProfile = {
  family: Family;
  familyLabel: string;
  commercial: "none" | "quote_contract";
  commercialLabel: string;
  outputs: { title: string; format: string; review: string }[];
  delivery: string;
  notes: string[];
};

export function executionProfile(s: ServiceLike, stages: { key: string; name: string; role: string; clientApproval?: boolean }[]): ExecutionProfile {
  const wf = s.workflow ?? s.workflowTemplateCode ?? "standard";
  const spec = continuousSpec(s.code);
  const defs = spec && !spec.onboardingOutput ? [] : outputsFor(s);
  let family: Family = defs[0] ? PROFILE_FAMILY[defs[0].profile] : "procedure";
  if (s.pricingModel === "free") family = "self_assessment";
  else if (wf === "subscription") family = "waqf_management";
  else if (wf === "registration") family = "registration";
  const notes: string[] = [];
  if (s.pricingModel === "subscription") notes.push("تسعير اشتراك: يُفوتر وفق دفعات العقد، ولا تُنشئ دورات التسليم فواتير.");
  if (spec) notes.push(`خدمة مستمرة: يبقى الطلب مفتوحًا طوال مدة العقد. ${spec.cadence ? `دورية التسليم ${CADENCE_AR[spec.cadence]} (${spec.cadenceSource})` : "دورية التسليم غير محددة: تُحدد في العرض أو عند تفعيل المدة ضمن نطاق العقد، ولا تُنشأ دورات قبل ذلك"}. ${ACCEPTANCE_AR[spec.acceptance.mode]}${spec.acceptance.fixed ? "" : " (يجوز للعقد ضبطه بصلاحية مدير)"}.`);
  if (s.pricingModel === "hourly" || s.pricingModel === "percentage") notes.push(`تسعير ${s.pricingModel === "hourly" ? "بالساعة" : "بالنسبة"}: يُقدَّر في العرض ويُعدّل بملحق عند تغيّر النطاق.`);
  if (wf === "registration") notes.push("خطوة يقدمها العميل أو وكيله عبر بوابة الجهة المختصة؛ المنصة تجهّز الحزمة وتتابع ولا تدّعي التسجيل.");
  if (s.code === "N01") notes.push("القبول بقرار ملف النظارة، والمباشرة بقرار التعيين والترخيص الساري.");
  if (!defs.length && !spec) notes.push("لا قالب توليد: يُرفع المخرج المعدّ ويُسجَّل.");
  const client = stages.find((x) => x.clientApproval || x.role === "client");
  return {
    family, familyLabel: FAMILY_AR[family],
    commercial: s.pricingModel === "free" ? "none" : "quote_contract",
    commercialLabel: s.pricingModel === "free" ? "بلا عرض ولا عقد ولا فاتورة" : "عرض سعر ← عقد ← فواتير الدفعات (مسودة ← اعتماد ← إرسال)",
    outputs: [
      ...defs.map((d) => ({ title: spec ? `${d.title} (قبل التشغيل)` : d.title, format: PROFILE_FORMAT[d.profile], review: REVIEW_LABEL[d.review] })),
      ...(spec ? [{
        title: `${spec.delivery.title} (لكل دورة)`,
        format: spec.delivery.kind === "output" ? PROFILE_FORMAT[spec.delivery.profile] : spec.delivery.kind === "minutes" ? "محضر من وحدة الحوكمة" : "سجل متابعة بلا مستند مسلَّم",
        review: spec.delivery.kind === "output" ? REVIEW_LABEL[spec.delivery.review] : spec.delivery.kind === "minutes" ? "يعتمده المجلس في وحدة الحوكمة" : "تُقفل الدورة بملاحظة موثقة",
      }] : []),
      ...(spec?.closing ? [{ title: `${spec.closing.title} (عند الانتهاء)`, format: PROFILE_FORMAT[spec.closing.profile], review: REVIEW_LABEL.independent }] : []),
    ],
    delivery: spec
      ? `دورات تسليم ${spec.cadence ? CADENCE_AR[spec.cadence] : "بدورية يحددها العقد"}: إعداد ← مراجعة داخلية ← اعتماد ← إتاحة للعميل ← ${spec.acceptance.mode === "required" ? "اعتماد العميل" : "اطلاعه"} ← إقفال الدورة، والطلب مفتوح حتى نهاية المدة`
      : client ? `بعد مراجعة الجودة، ثم «${client.name}»` : "بعد مراجعة الجودة واعتماد العميل",
    notes,
  };
}
