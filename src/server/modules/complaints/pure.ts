import { addBusinessDays, type ISODate } from "../../engines/dates";

export const COMPLAINT_KINDS = ["inquiry", "complaint", "info_request"] as const;
export type ComplaintKind = (typeof COMPLAINT_KINDS)[number];
export const COMPLAINT_KIND_AR: Record<string, string> = { inquiry: "استفسار", complaint: "شكوى", info_request: "طلب اطلاع" };
export const COMPLAINT_STATUS_AR: Record<string, string> = { open: "جديد", in_progress: "قيد المعالجة", answered: "تم الرد", closed: "مغلق" };
export const DEFAULT_SLA_DAYS = 10;

/** SLA due date: N business days (Sun–Thu, excluding official holidays) after the submission day. */
export function slaDueDate(submittedOn: ISODate, days: number, holidays: Set<string>): ISODate {
  return addBusinessDays(submittedOn, Math.max(1, Math.round(days)), holidays);
}

/** End of the due day in Riyadh time. */
export const slaDueTimestamp = (due: ISODate) => new Date(`${due}T23:59:59+03:00`);

export function slaState(slaDueAt: Date, status: string, now = new Date()): "met" | "overdue" | "due_soon" | "on_track" {
  if (status === "answered" || status === "closed") return "met";
  const ms = slaDueAt.getTime() - now.getTime();
  if (ms < 0) return "overdue";
  if (ms < 2 * 86_400_000) return "due_soon";
  return "on_track";
}
