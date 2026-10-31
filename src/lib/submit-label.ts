/**
 * The submit button's wording for a service (PURE): «طلب النتيجة» for assessments and checks whose output is a
 * result, «إرسال للاعتماد» for documents and policies the platform drafts for approval, «إرسال الطلب» otherwise.
 */
const RESULT = new Set(["C01", "C02", "C03", "C05", "T05", "I02", "G09", "F01", "F05"]);
const FOR_APPROVAL = new Set(["T03", "W01", "W04", "G01", "G02", "G03", "G05", "G06", "G07", "G10", "I01", "F02", "F04"]);

export function submitLabel(code: string): string {
  if (RESULT.has(code)) return "طلب النتيجة";
  if (FOR_APPROVAL.has(code)) return "إرسال للاعتماد";
  return "إرسال الطلب";
}
