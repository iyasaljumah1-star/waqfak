/**
 * What the client can expect, and what happens next on a request (PURE).
 * Everything here is derived from the service's workflow template and the request's real state — no fixed promises.
 */
import type { RequestStatus } from "./workflow";

/** Arabic count of business days with the right noun form. */
export function businessDaysAr(n: number) {
  if (n === 1) return "يوم عمل واحد";
  if (n === 2) return "يوما عمل";
  if (n >= 3 && n <= 10) return `${n} أيام عمل`;
  return `${n} يوم عمل`;
}

export type JourneyStage = { name: string; slaDays: number; role: string; clientApproval?: boolean };

/** Steps shown before submission. Durations come from the workflow template (business days, standard targets). */
export function clientJourney(svc: { pricingModel: string; workflowName?: string | null }, stages: JourneyStage[]): string[] {
  const first = stages[0];
  const paid = svc.pricingModel !== "free";
  const out: string[] = [];
  out.push(
    first
      ? `يُسند الطلب لمختص يتحقق من بياناته ومستنداته. المدة المعيارية لمرحلة «${first.name}» ${businessDaysAr(first.slaDays)} من إرسال الطلب مكتملًا.`
      : "يُسند الطلب لمختص يتحقق من بياناته ومستنداته.",
  );
  out.push("إن نقص شيء نسجله في «النواقص والاستفسارات» ونبلغك به، ولا يتقدم الطلب في تلك النقطة حتى تستكمله.");
  if (paid) {
    out.push("يصلك نطاق العمل وعرض السعر مفصلًا: البنود والضريبة وشروط الدفع ومدة صلاحية العرض. لك أن تقبله أو ترفضه أو تطلب تعديله.");
    out.push("بعد قبولك يُعدّ العقد ويُعتمد، ثم توقّعه إلكترونيًا برمز يصل جوالك ويوقّعه المفوّض عن «وقفك». يبدأ التنفيذ بعد اكتمال توقيع جميع الأطراف وسداد ما يشترط العرض سداده قبل البدء.");
  }
  if (stages.length > 1) out.push(`تتابع مراحل الخدمة (${stages.map((s) => s.name).join("، ")}) والمراسلات والمخرجات من صفحة الطلب.`);
  else out.push("تتابع المراحل والمراسلات والمخرجات من صفحة الطلب.");
  return out;
}

export type NextActionInput = {
  status: RequestStatus;
  assigned: boolean;
  conflictBlocked: boolean;
  verified: boolean;
  accepted: boolean;
  /** Open client-visible items (open or correction requested) and those the client answered (awaiting review). */
  clientItemsOpen: number;
  itemsAwaitingReview: number;
  quote: { status: string; expired: boolean } | null;
  pricingModel: string;
  contract: { status: string; pendingClientSigners: string[]; companyPending: boolean } | null;
  prestartUnpaid: number;
  holdParty?: string | null;
  holdLabel?: string | null;
  deliverablesSubmitted: number;
};

export type NextAction = { who: "client" | "waqfak" | "ops" | "external" | "none"; label: string; detail?: string };

export const WHO_LABEL: Record<NextAction["who"], string> = { client: "أنت (العميل)", waqfak: "فريق «وقفك»", ops: "مدير التشغيل", external: "جهة خارجية", none: "—" };

/** The single next step of a request and who owns it. */
export function nextAction(x: NextActionInput): NextAction {
  const paid = x.pricingModel !== "free";
  switch (x.status) {
    case "draft":
      return { who: "client", label: "أكمل نموذج الطلب وأرسله" };
    case "submitted":
      if (x.conflictBlocked) return { who: "ops", label: "قرار الاستقلالية: اعتماد استثناء مسبب أو رفض الطلب" };
      return { who: "ops", label: "إسناد الطلب إلى مختص" };
    case "triage":
    case "awaiting_client":
      if (x.conflictBlocked) return { who: "ops", label: "قرار الاستقلالية: اعتماد استثناء مسبب أو رفض الطلب" };
      if (x.clientItemsOpen) return { who: "client", label: `استكمال النواقص والاستفسارات (${x.clientItemsOpen})` };
      if (x.itemsAwaitingReview) return { who: "waqfak", label: `مراجعة ما استكمله العميل (${x.itemsAwaitingReview})` };
      if (!x.verified) return { who: "waqfak", label: "التحقق من البيانات والمستندات" };
      if (!x.accepted) return { who: "waqfak", label: "قبول الطلب للخدمة" };
      if (!paid) return { who: "waqfak", label: "بدء التنفيذ" };
      if (x.quote && ["draft"].includes(x.quote.status)) return { who: "waqfak", label: "اعتماد عرض السعر داخليًا" };
      if (x.quote && x.quote.status === "approved") return { who: "waqfak", label: "إرسال عرض السعر للعميل" };
      if (x.quote && x.quote.status === "change_requested") return { who: "waqfak", label: "إعداد نسخة معدلة من عرض السعر" };
      return { who: "waqfak", label: "إعداد نطاق العمل وعرض السعر" };
    case "quote":
      if (x.quote?.expired) return { who: "waqfak", label: "انتهت صلاحية العرض: إصدار نسخة جديدة" };
      if (x.quote?.status === "change_requested") return { who: "waqfak", label: "إعداد نسخة معدلة من عرض السعر" };
      return { who: "client", label: "مراجعة عرض السعر: قبوله أو رفضه أو طلب تعديله" };
    case "awaiting_contract":
      if (!x.contract) return { who: "waqfak", label: "إعداد العقد من عرض السعر المقبول" };
      if (x.contract.status === "draft") return { who: "waqfak", label: "اعتماد العقد داخليًا" };
      if (x.contract.status === "approved") return { who: "waqfak", label: "إرسال العقد للتوقيع" };
      if (x.contract.pendingClientSigners.length) return { who: "client", label: "توقيع العقد", detail: `بانتظار: ${x.contract.pendingClientSigners.join("، ")}` };
      if (x.contract.companyPending) return { who: "waqfak", label: "توقيع العقد عن «وقفك»" };
      if (x.prestartUnpaid) return { who: "client", label: "سداد الدفعة المستحقة قبل البدء" };
      return { who: "waqfak", label: "بدء التنفيذ" };
    case "in_progress":
      if (x.clientItemsOpen) return { who: "client", label: `استكمال النواقص والاستفسارات (${x.clientItemsOpen})` };
      return { who: "waqfak", label: "تنفيذ الخدمة وإعداد المخرجات" };
    case "quality_review":
      return { who: "waqfak", label: "مراجعة الجودة من زميل غير معدّ العمل" };
    case "awaiting_client_approval":
      return { who: "client", label: "مراجعة المخرجات: اعتمادها أو طلب تعديلات" };
    case "completed":
      return { who: "waqfak", label: "إغلاق الطلب" };
    case "on_hold":
      return { who: x.holdParty === "client" ? "client" : x.holdParty ? "external" : "waqfak", label: `الطلب معلّق بانتظار ${x.holdLabel ?? "طرف آخر"}` };
    default:
      return { who: "none", label: "لا إجراء: الطلب منتهٍ" };
  }
}
