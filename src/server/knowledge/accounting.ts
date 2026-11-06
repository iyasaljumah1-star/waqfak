/**
 * The accounting framework by entity (PURE, unit-tested). Owner's decision 2026-11-06 (accounting track, report
 * «تحديد المعايير المحاسبية المنطبقة على الأوقاف في المملكة العربية السعودية», §4 and §6):
 *  - default for a registered waqf with legal personality: SOCPA's standards for non-profit entities (updated version,
 *    in force from 2025-01-01) with IFRS for SMEs (or full IFRS by a documented choice);
 *  - waqf, non-profit company, waqf fund and commercial subsidiaries are separate entities with separate frameworks;
 *  - AAOIFI FAS 37 is never the mandatory framework: an optional supplementary reference where it does not conflict;
 *  - what needs the auditor's opinion or the competent authority's confirmation is never settled automatically: the
 *    result says so, and the engine only prepares.
 */
export type Entity =
  | "waqf_large_medium" // registered, assets ≥ 50m (لائحة النظارة م15/4: audited statements)
  | "waqf_small" // registered, < 50m (م15/5: annual financial statement on the authority's form)
  | "waqf_direct_benefit" // م15/5, when there are receipts and expenses
  | "family_waqf_commercial" // a family waqf trading under its own commercial registration
  | "nonprofit_company" // Companies Law, non-profit company
  | "association" // NGO under the associations law (NCNP)
  | "waqf_fund" // CMA waqf investment fund
  | "commercial_subsidiary" // commercial company owned by a waqf
  | "unregistered_waqf";

export type FrameworkResult = {
  entity: Entity;
  framework: string;
  basis: string[];
  /** FAS 37 may be used as a supplementary disclosure where it does not conflict; never as the framework. */
  fas37: "supplementary_optional" | "not_applicable";
  /** Questions this result does not settle, for a licensed auditor or the competent authority. */
  openQuestions: string[];
  /** True when an output may not state the framework as settled without a human decision. */
  needsHumanDecision: boolean;
};

const SOCPA_NPO = "معايير التقرير المالي المعتمدة في المملكة للمنشآت غير الهادفة للربح (معايير سوكبا المحدثة، سارية من 2025-01-01) مع المعيار الدولي للمنشآت الصغيرة والمتوسطة، أو النسخة الكاملة باختيار موثق";
const CONFIRM = "تأكيد مكتوب من الهيئة العامة للأوقاف أو سوكبا بالإطار المقبول للقوائم المدققة (لائحة النظارة م15/4 لا تسمّي إطارًا)";

export function frameworkFor(entity: Entity): FrameworkResult {
  switch (entity) {
    case "waqf_large_medium":
      return { entity, framework: SOCPA_NPO, basis: ["لائحة تنظيم أعمال النظارة م15/4", "توضيح سوكبا 1436/7/9هـ", "استفسارات سوكبا 120 و127"], fas37: "supplementary_optional", openQuestions: [CONFIRM, "قياس عين الوقف (تكلفة أو قيمة عادلة أو استثمار عقاري): سياسة يقرها الناظر ويقبلها المراجع"], needsHumanDecision: true };
    case "waqf_small":
      return { entity, framework: "بيان مالي سنوي بالواردات والمصروفات على نموذج الهيئة وعبر منصتها؛ لا يشترط النص إطارًا محاسبيًا ولا تدقيقًا، وإن أُعدت قوائم ذات غرض عام طوعًا فإطار سوكبا للمنشآت غير الهادفة للربح", basis: ["لائحة تنظيم أعمال النظارة م15/5", "الأسئلة الشائعة للهيئة"], fas37: "not_applicable", openQuestions: ["نموذج البيان المالي في منصة الهيئة لم يُفحص"], needsHumanDecision: false };
    case "waqf_direct_benefit":
      return { entity, framework: "بيان مالي سنوي في حال وجود واردات ومصروفات", basis: ["لائحة تنظيم أعمال النظارة م15/5"], fas37: "not_applicable", openQuestions: [], needsHumanDecision: false };
    case "family_waqf_commercial":
      return { entity, framework: `الوقف: ${SOCPA_NPO}؛ المنشآت التجارية التابعة: المعايير الدولية المعتمدة؛ وتوحيد عند الحاجة`, basis: ["توضيح سوكبا 2015", "استفسار سوكبا 127", "نظام الشركات م17/2"], fas37: "supplementary_optional", openQuestions: ["هل ينطبق تعريف المنشأة غير الهادفة للربح على وقف ذري مستفيدوه معيّنون؟ يقرره مراجع الحسابات المرخص"], needsHumanDecision: true };
    case "nonprofit_company":
      return { entity, framework: "المعيار الدولي للمنشآت الصغيرة والمتوسطة أو النسخة الكاملة — لا معايير المنشآت غير الهادفة للربح", basis: ["رأي سوكبا الفني 2025-09-21", "نظام الشركات م17/2 وم193"], fas37: "not_applicable", openQuestions: ["تقييم السيطرة على الوقف وتوحيده (IFRS 10 أو القسم 9)"], needsHumanDecision: true };
    case "association":
      return { entity, framework: "معايير سوكبا للمنشآت غير الهادفة للربح مع المعيار الدولي للمنشآت الصغيرة والمتوسطة", basis: ["تعميم سوكبا 22119/2019", "الدليل المحاسبي الموحد للمركز الوطني"], fas37: "not_applicable", openQuestions: ["النص الملزم من المركز الوطني لم يُفتح"], needsHumanDecision: false };
    case "waqf_fund":
      return { entity, framework: "المعايير المحاسبية المعتمدة من سوكبا (المعايير الدولية) وفق لائحة صناديق الاستثمار", basis: ["لائحة صناديق الاستثمار م11(د) (مصدر ثانوي، لم يُفتح النص الرسمي)"], fas37: "not_applicable", openQuestions: ["نص هيئة السوق المالية الرسمي لم يُفتح"], needsHumanDecision: true };
    case "commercial_subsidiary":
      return { entity, framework: "المعايير الدولية الكاملة أو للمنشآت الصغيرة والمتوسطة", basis: ["نظام الشركات م17/2"], fas37: "not_applicable", openQuestions: [], needsHumanDecision: false };
    case "unregistered_waqf":
      return { entity, framework: "لا متطلب نظامي قبل التوثيق والتسجيل؛ يُوجَّه إلى التوثيق أولًا", basis: [], fas37: "not_applicable", openQuestions: [], needsHumanDecision: false };
  }
}

/** FAS 37 may be named in an output as the basis of the statements only with the auditor's and the supervisor's written acceptance. */
export function mayStateFas37AsFramework(o: { auditorAcceptedInWriting: boolean; supervisorAcceptedInWriting: boolean }): boolean {
  return o.auditorAcceptedInWriting && o.supervisorAcceptedInWriting;
}
