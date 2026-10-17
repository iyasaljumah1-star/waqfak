/**
 * Processing phase of a request (PURE), derived from its records — the request status, the data review summary, open
 * completion requests and the outputs' review state — so that client and team see the same current phase, the next
 * step and who acts. The status machine itself is unchanged; a phase only applies when the service's workflow has it
 * (e.g. «بانتظار اعتماد المسؤول المخول» exists only once a service has an output under review).
 */
export type Phase =
  | "draft" | "submitted" | "completeness" | "awaiting_client" | "ready_to_assign" | "in_progress" | "specialist_review"
  | "authorized_approval" | "ready_to_deliver" | "client_approval" | "completed" | "on_hold" | "ended";

export const PHASE_AR: Record<Phase, string> = {
  draft: "مسودة لدى العميل",
  submitted: "مقدمة",
  completeness: "قيد فحص اكتمال البيانات",
  awaiting_client: "بانتظار استكمال العميل",
  ready_to_assign: "جاهزة للتوزيع على الفريق",
  in_progress: "قيد التنفيذ",
  specialist_review: "بانتظار مراجعة متخصصة",
  authorized_approval: "بانتظار اعتماد المسؤول المخول",
  ready_to_deliver: "جاهزة للتسليم",
  client_approval: "بانتظار اعتماد العميل",
  completed: "مكتملة",
  on_hold: "معلّقة",
  ended: "مغلقة",
};

export type PhaseInput = {
  status: string;
  assigned: boolean;
  /** Data review: required answers missing or invalid, open gaps and conflicts (from the field analysis). */
  data: { requiredMissing: number; gaps: number; conflicts: number } | null;
  openClientItems: number;
  outputs: { status: string; delivered: boolean }[];
};

export function processingPhase(p: PhaseInput): { phase: Phase; label: string; owner: "client" | "team" | "manager" | "none"; next: string } {
  const out = (phase: Phase, owner: "client" | "team" | "manager" | "none", next: string) => ({ phase, label: PHASE_AR[phase], owner, next });
  switch (p.status) {
    case "draft": return out("draft", "client", "إكمال النموذج وإرساله");
    case "on_hold": return out("on_hold", "team", "رفع التعليق عند زوال سببه");
    case "cancelled": case "rejected": case "closed": return out("ended", "none", "لا إجراء");
    case "completed": return out("completed", "none", "لا إجراء");
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
      return out("in_progress", "team", "تنفيذ مهام الخدمة");
    }
  }
}
