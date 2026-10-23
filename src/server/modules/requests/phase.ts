/**
 * Processing phase of a request (PURE), derived from its records — the request status, the data review summary, open
 * completion requests and the outputs' review state — so that client and team see the same current phase, the next
 * step and who acts. The status machine itself is unchanged; a phase only applies when the service's workflow has it
 * (e.g. «بانتظار اعتماد المسؤول المخول» exists only once a service has an output under review).
 */
export type Phase =
  | "draft" | "submitted" | "completeness" | "awaiting_client" | "ready_to_assign" | "quote" | "contract" | "in_progress" | "specialist_review"
  | "authorized_approval" | "ready_to_deliver" | "client_approval" | "completed" | "on_hold" | "ended";

export const PHASE_AR: Record<Phase, string> = {
  draft: "مسودة لدى العميل",
  submitted: "مقدمة",
  completeness: "قيد فحص اكتمال البيانات",
  awaiting_client: "بانتظار استكمال العميل",
  ready_to_assign: "جاهزة للتوزيع على الفريق",
  quote: "بانتظار قبول عرض السعر",
  contract: "بانتظار توقيع العقد",
  in_progress: "قيد التنفيذ",
  specialist_review: "بانتظار مراجعة متخصصة",
  authorized_approval: "بانتظار اعتماد المسؤول المخول",
  ready_to_deliver: "جاهزة للتسليم",
  client_approval: "بانتظار اعتماد العميل",
  completed: "مكتملة",
  on_hold: "معلّقة",
  ended: "مغلقة",
};

/**
 * The same phases in the client's words where the team's wording names an internal step: the client learns that the
 * outputs are under review, not who reviews them or what was noted.
 */
export const PHASE_CLIENT_AR: Partial<Record<Phase, { label: string; next: string }>> = {
  specialist_review: { label: "المخرجات قيد المراجعة لدى فريق وقفك", next: "إتمام المراجعة الداخلية للمخرجات" },
  authorized_approval: { label: "المخرجات قيد المراجعة والاعتماد لدى فريق وقفك", next: "اعتماد المخرجات داخليًا ثم إرسالها إليك" },
  ready_to_deliver: { label: "المخرجات معتمدة وتُجهَّز لتسليمها إليك", next: "تسليم المخرجات إليك للاطلاع والاعتماد" },
  completeness: { label: "قيد فحص اكتمال البيانات لدى الفريق", next: "فحص البيانات، وقد يطلب الفريق منك استكمال شيء" },
  ready_to_assign: { label: "قيد الإسناد والبدء لدى الفريق", next: "إسناد الطلب إلى مختص وبدء العمل" },
};

/** The phase as shown to the client (PURE). */
export function clientPhase(p: PhaseInput) {
  const x = processingPhase(p);
  const c = PHASE_CLIENT_AR[x.phase];
  return c ? { ...x, ...c } : x;
}

export type PhaseInput = {
  status: string;
  assigned: boolean;
  /** Data review: required answers missing or invalid, open gaps and conflicts (from the field analysis). */
  data: { requiredMissing: number; gaps: number; conflicts: number } | null;
  openClientItems: number;
  outputs: { status: string; delivered: boolean }[];
  /** Name of the active stage of the service's own workflow template (configured per service by the admin). */
  activeStage?: string | null;
};

export function processingPhase(p: PhaseInput): { phase: Phase; label: string; owner: "client" | "team" | "manager" | "none"; next: string } {
  const out = (phase: Phase, owner: "client" | "team" | "manager" | "none", next: string) => ({ phase, label: PHASE_AR[phase], owner, next });
  switch (p.status) {
    case "draft": return out("draft", "client", "إكمال النموذج وإرساله");
    case "on_hold": return out("on_hold", "team", "رفع التعليق عند زوال سببه");
    case "cancelled": case "rejected": case "closed": return out("ended", "none", "لا إجراء");
    case "completed": return out("completed", "team", "إغلاق الطلب وأرشفة المخرجات");
    // before work starts: the client decides on the quote, then signs the contract (and pays what the quote requires first)
    case "quote": return out("quote", "client", "مراجعة عرض السعر وقبوله أو طلب تعديله");
    case "awaiting_contract": return out("contract", "client", "توقيع العقد وسداد الدفعة المشروطة قبل البدء إن وُجدت");
    case "awaiting_client": return out("awaiting_client", "client", "استكمال ما طلبه الفريق");
    case "awaiting_client_approval": return out("client_approval", "client", "مراجعة المخرجات واعتمادها أو طلب تعديل");
    case "submitted": case "triage": {
      if (p.openClientItems) return out("awaiting_client", "client", "استكمال ما طلبه الفريق");
      const dataDone = !!p.data && !p.data.requiredMissing && !p.data.conflicts;
      if (!dataDone) return out("completeness", "team", "فحص البيانات واعتمادها أو طلب استكمال ما ينقص");
      return p.assigned ? out("ready_to_assign", "team", "قبول الطلب وبدء التنفيذ") : out("ready_to_assign", "manager", "إسناد الطلب إلى مختص");
    }
    case "quality_review": return out("specialist_review", "team", "مراجعة المختص للمخرجات");
    default: {
      if (p.outputs.some((o) => o.status === "in_review")) return out("authorized_approval", "manager", "اعتماد المخرجات من المسؤول المخول");
      if (p.outputs.length && p.outputs.every((o) => o.status === "approved") && p.outputs.some((o) => !o.delivered)) return out("ready_to_deliver", "team", "تسليم المخرجات المعتمدة للعميل");
      if (p.activeStage) return { ...out("in_progress", "team", `إنجاز مرحلة «${p.activeStage}»`), label: `${PHASE_AR.in_progress} — مرحلة «${p.activeStage}»` };
      return out("in_progress", "team", "تنفيذ مهام الخدمة");
    }
  }
}
