import type { Tone } from "@/components/ui";

/** The waqf journey (stage 1..5). */
export const JOURNEY_STAGES = ["تأسيس", "توثيق وتسجيل", "تشغيل", "مأسسة", "استدامة"] as const;

export const STATUS_TONE: Record<string, Tone> = {
  idea: "neutral", draft: "neutral", documenting: "info", documented: "info", registered: "ink", active: "ok", suspended: "critical", ended: "neutral",
};

export const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  upcoming: "قادم", due_soon: "يقترب موعده", overdue: "متأخر", done: "منجز", waived: "معفى",
};
export const OBLIGATION_STATUS_TONE: Record<string, Tone> = {
  upcoming: "neutral", due_soon: "warn", overdue: "critical", done: "ok", waived: "neutral",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  draft: "مسودة", submitted: "مُرسل", triage: "قيد الفرز", awaiting_client: "بانتظارك", quote: "عرض سعر", awaiting_contract: "بانتظار العقد",
  in_progress: "قيد التنفيذ", quality_review: "مراجعة الجودة", awaiting_client_approval: "بانتظار اعتمادك", completed: "مكتمل", closed: "مغلق",
  on_hold: "معلّق", cancelled: "ملغى", rejected: "مرفوض",
};

export const RESULT_STATUS_LABEL: Record<string, string> = {
  critical: "حرج", needs_intervention: "يحتاج تدخلًا", stable: "مستقر", advanced: "متقدم",
};
export const RESULT_STATUS_TONE: Record<string, Tone> = {
  critical: "critical", needs_intervention: "fine", stable: "ok", advanced: "ok",
};

export const ASSET_BANDS = [
  { value: "lt5", label: "أقل من 5 ملايين ريال" },
  { value: "5to50", label: "من 5 إلى أقل من 50 مليون ريال" },
  { value: "50to200", label: "من 50 إلى أقل من 200 مليون ريال" },
  { value: "gte200", label: "200 مليون ريال فأكثر" },
] as const;
