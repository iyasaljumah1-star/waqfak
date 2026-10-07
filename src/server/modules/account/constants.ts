/** Version tag recorded with consent changes made from the privacy page. */
export const PRIVACY_VERSION = "2026-10";

/** Data subject request kinds offered to users (PDPL rights). */
export const DSR_KINDS = ["access", "correct", "delete", "object"] as const;
export const DSR_LABEL: Record<string, string> = {
  access: "الاطلاع على بياناتي ونسخة منها",
  export: "نسخة من بياناتي",
  correct: "تصحيح بياناتي",
  delete: "حذف بياناتي",
  object: "الاعتراض على معالجة",
};
export const DSR_STATUS_LABEL: Record<string, string> = {
  received: "مستلم", in_progress: "قيد المعالجة", completed: "مكتمل", rejected: "مرفوض", cancelled: "ملغى",
};
export const CONSENT_LABEL: Record<string, string> = {
  terms: "الشروط والأحكام", privacy: "سياسة الخصوصية", marketing: "الرسائل التسويقية والتحديثات", analytics: "التحليلات", ai_processing: "المعالجة بالمساعد الذكي",
};
