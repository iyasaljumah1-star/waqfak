/**
 * The nine stages of an output (PURE), read from records — never set by hand and never moved by a preview:
 *
 *  generated        مولدة            — drafted by the platform, not yet worked on, with open items
 *  completing       قيد الاستكمال     — open mandatory items, conflicts or failed checks
 *  ready            جاهزة للمراجعة    — a draft with nothing blocking submission
 *  in_review        قيد المراجعة      — sent for review (status in_review)
 *  returned         معادة             — returned by the reviewer with a note
 *  approved         معتمدة داخليًا     — approved by «وقفك» (internal; not official documentation)
 *  ready_delivery   جاهزة للتسليم     — approved, and the request is in its last quality review before release
 *  delivered        تم التسليم        — the approved PDF was released to the client
 *  documented       موثقة رسميًا      — an official documentation record with its instrument exists
 */

export type OutputStage = "generated" | "completing" | "ready" | "in_review" | "returned" | "approved" | "ready_delivery" | "delivered" | "documented";

export const STAGES: { key: OutputStage; label: string }[] = [
  { key: "generated", label: "مولدة" },
  { key: "completing", label: "قيد الاستكمال" },
  { key: "ready", label: "جاهزة للمراجعة" },
  { key: "in_review", label: "قيد المراجعة" },
  { key: "returned", label: "معادة" },
  { key: "approved", label: "معتمدة داخليًا" },
  { key: "ready_delivery", label: "جاهزة للتسليم" },
  { key: "delivered", label: "تم التسليم" },
  { key: "documented", label: "موثقة رسميًا" },
];
export const STAGE_AR = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<OutputStage, string>;

export type StageInput = {
  status: "draft" | "in_review" | "returned" | "approved";
  /** Current version's origin (generated / regenerated / edited). */
  origin: string | null;
  /** Items that block sending for review (mandatory gaps, conflicts, failed checks, unwritten parts). */
  submitBlockers: number;
  /** Items that block approval besides those (checks waiting for a specialist). */
  approveBlockers: number;
  requestStatus: string;
  released: boolean;
  officialRecords: number;
};

export function outputStage(x: StageInput): OutputStage {
  if (x.status === "approved") {
    if (x.officialRecords > 0) return "documented";
    if (x.released) return "delivered";
    if (x.requestStatus === "quality_review") return "ready_delivery";
    return "approved";
  }
  if (x.status === "in_review") return "in_review";
  if (x.status === "returned") return "returned";
  if (x.submitBlockers > 0) return x.origin === "generated" ? "generated" : "completing";
  return "ready";
}

/** What happens next, and who does it (shown with the stage). */
export function nextAction(stage: OutputStage, x: Pick<StageInput, "submitBlockers" | "approveBlockers">): string {
  switch (stage) {
    case "generated":
    case "completing": return `استكمال ${x.submitBlockers} من البنود الإلزامية أو التعارضات قبل الإرسال للمراجعة (معدّ المخرج والعميل).`;
    case "ready": return "إرسال المسودة للمراجعة (معدّ المخرج).";
    case "in_review": return x.approveBlockers ? `يسجّل المراجع رأيه في ${x.approveBlockers} من الفحوص ثم يعتمد أو يعيد (المراجع).` : "الاعتماد أو الإعادة للتعديل (المراجع).";
    case "returned": return "معالجة ملاحظة المراجع وإعادة الإرسال (معدّ المخرج).";
    case "approved": return "مراجعة الجودة على الطلب ثم إتاحة النسخة المعتمدة للعميل (مدير التشغيل).";
    case "ready_delivery": return "اعتماد مراجعة الجودة لإتاحة النسخة للعميل (مراجع الجودة).";
    case "delivered": return "عند التوثيق لدى الجهة المختصة: تسجيل التوثيق مع وثيقته الرسمية (المراجع).";
    case "documented": return "لا إجراء: سُجّل التوثيق الرسمي.";
  }
}
