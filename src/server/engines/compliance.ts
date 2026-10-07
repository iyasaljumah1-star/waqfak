/**
 * Compliance engine (pure part). Obligations are data (admin-configurable):
 *   Regulation → Requirement → Obligation(rule) → Instance(task) → Reminders → Evidence → Status
 */
import { computeDue, daysBetween, type ISODate, type OffsetUnit } from "./dates";

export type ObligationDef = {
  id: string;
  code: string;
  titleAr: string;
  triggerEvent: string;
  offsetValue: number | null;
  offsetUnit: OffsetUnit;
  recurrence: "none" | "annual";
  appliesTo: { sizeClasses?: string[]; legalTypes?: string[]; requiresFlags?: string[]; excludesFlags?: string[]; internal?: boolean };
  severity: "critical" | "high" | "medium" | "low";
  reminderOffsetsDays: number[];
};

export type WaqfFacts = {
  sizeClass: string | null;
  legalType: string | null;
  flags: Record<string, boolean>; // collectsDonations, hasPortfolio, hasBeneficiariesAbroad, conditionSetsPayDate...
};

export function isApplicable(def: ObligationDef, w: WaqfFacts): boolean {
  const a = def.appliesTo ?? {};
  if (a.internal) return false;
  if (a.sizeClasses?.length && (!w.sizeClass || !a.sizeClasses.includes(w.sizeClass))) return false;
  if (a.legalTypes?.length && (!w.legalType || !a.legalTypes.includes(w.legalType))) return false;
  if (a.requiresFlags?.some((f) => !w.flags[f])) return false;
  if (a.excludesFlags?.some((f) => w.flags[f])) return false;
  return true;
}

export function dueFor(def: ObligationDef, trigger: ISODate, holidays: Set<string>) {
  return computeDue(trigger, def.offsetValue, def.offsetUnit, holidays);
}

export const DUE_SOON_DAYS = 14;

export function statusFor(dueOn: ISODate | null, today: ISODate, done: boolean, waived = false): "upcoming" | "due_soon" | "overdue" | "done" | "waived" {
  if (waived) return "waived";
  if (done) return "done";
  if (!dueOn) return "upcoming";
  const d = daysBetween(today, dueOn);
  if (d < 0) return "overdue";
  if (d <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

/** Which reminder offsets are due today and not yet sent. */
export function remindersDue(dueOn: ISODate | null, today: ISODate, offsets: number[], alreadySent: number[]): number[] {
  if (!dueOn) return [];
  const left = daysBetween(today, dueOn);
  return offsets.filter((o) => left <= o && !alreadySent.includes(o)).sort((a, b) => b - a).slice(0, 1);
}

/** Severity-colored band used across the UI: dismissal risk (red) / fine (orange) / warning (yellow). */
export function penaltyBand(dismissalRisk: string | null | undefined, severity: string): "dismissal" | "fine" | "warning" {
  if (dismissalRisk && dismissalRisk !== "no") return "dismissal";
  if (severity === "critical" || severity === "high") return "fine";
  return "warning";
}
