/**
 * Payment schedule (PURE): the state of each contractual installment and the alerts due to the finance team.
 *
 * Dates are kept apart: the due date (contract), the invoice's creation, approval, sending, and the payment. An
 * installment is paid only when its invoices are fully paid — issuing an invoice is not payment. No invoice is ever
 * created by the schedule: when an installment is due, the finance team is alerted to act.
 */
import { addDays, daysBetween } from "@/server/engines/dates";

export type DueAlertSettings = { beforeDays: number; overdueDays: number[] };
export const DEFAULT_DUE_ALERTS: DueAlertSettings = { beforeDays: 7, overdueDays: [1, 7, 30] };

/** Normalizes a stored setting (anything missing or invalid falls back to the defaults). */
export function dueAlertSettings(v: unknown): DueAlertSettings {
  const o = (v && typeof v === "object" ? v : {}) as Partial<DueAlertSettings>;
  const before = Number(o.beforeDays);
  const overdue = Array.isArray(o.overdueDays) ? o.overdueDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 365) : null;
  return {
    beforeDays: Number.isInteger(before) && before >= 0 && before <= 90 ? before : DEFAULT_DUE_ALERTS.beforeDays,
    overdueDays: overdue && overdue.length ? [...new Set(overdue)].sort((a, b) => a - b) : DEFAULT_DUE_ALERTS.overdueDays,
  };
}

export type InstallmentInvoice = {
  id: string; number: string; status: string; kind: string; total: number; paid: number;
  createdAt: Date | string; approvedAt: Date | string | null; sentAt: Date | string | null; paidOn: string | null;
};

export type InstallmentStage = "unscheduled" | "upcoming" | "due_soon" | "due" | "invoiced" | "overdue" | "paid";
export const STAGE_AR: Record<InstallmentStage, string> = {
  unscheduled: "لم يُحدد موعدها (مرتبطة بمرحلة)", upcoming: "قادمة", due_soon: "تستحق قريبًا", due: "حلّ موعدها ولم تُرسل فاتورتها",
  invoiced: "فوترت وبانتظار السداد", overdue: "متأخرة السداد", paid: "مدفوعة",
};
export const STAGE_TONE: Record<InstallmentStage, "neutral" | "info" | "warn" | "fine" | "critical" | "ok"> = {
  unscheduled: "neutral", upcoming: "info", due_soon: "warn", due: "fine", invoiced: "info", overdue: "critical", paid: "ok",
};

/**
 * Stage of an installment on `today`. «Sent» = an invoice was issued to the client (status issued/partially_paid/paid);
 * a draft or approved invoice is not sent. Paid = the sent invoices cover the installment's total.
 */
export function installmentStage(row: { dueOn: string | null; total: number }, invs: InstallmentInvoice[], today: string, cfg: DueAlertSettings): InstallmentStage {
  const live = invs.filter((i) => i.status !== "void" && i.kind !== "credit_note" && i.kind !== "proforma");
  const sent = live.filter((i) => ["issued", "partially_paid", "paid"].includes(i.status));
  const paid = sent.reduce((s, i) => s + i.paid, 0);
  if (sent.length && paid + 0.009 >= row.total) return "paid";
  if (!row.dueOn) return "unscheduled";
  if (row.dueOn < today) return "overdue";
  if (row.dueOn === today) return sent.length ? "invoiced" : "due";
  if (sent.length) return "invoiced";
  return addDays(today, cfg.beforeDays) >= row.dueOn ? "due_soon" : "upcoming";
}

/** Alerts owed to the finance team now, as keys not yet in `sent` (each alert is sent once). */
export function dueAlerts(row: { dueOn: string | null }, stage: InstallmentStage, today: string, cfg: DueAlertSettings, sent: string[]): { key: string; text: string }[] {
  if (!row.dueOn || stage === "paid" || stage === "unscheduled") return [];
  const out: { key: string; text: string }[] = [];
  if (stage === "due_soon") out.push({ key: "before", text: `تستحق خلال ${daysBetween(today, row.dueOn)} يومًا ولم تُرسل فاتورتها` });
  if (stage === "due") out.push({ key: "due", text: "حلّ موعد الاستحقاق اليوم ولم تُرسل فاتورتها" });
  if (stage === "overdue") {
    const late = daysBetween(row.dueOn, today);
    const step = [...cfg.overdueDays].reverse().find((d) => late >= d);
    if (step) out.push({ key: `overdue:${step}`, text: `متأخرة ${late} يومًا عن موعد الاستحقاق ولم تُسدد` });
  }
  return out.filter((a) => !sent.includes(a.key));
}

/** Due date of a new schedule row from its term: the set date, or the contract's execution for signing/start terms. */
export function initialDueOn(t: { due: string; dueOn?: string | null }, executedOn: string | null): string | null {
  if (t.due === "on_date") return t.dueOn ?? null;
  if (t.due === "on_contract" || t.due === "before_start") return executedOn;
  return null;
}
