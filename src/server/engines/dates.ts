/**
 * Date helpers for regulatory deadlines. Saudi weekend = Friday + Saturday.
 * Official holidays come from the `holidays` table (admin-maintained).
 * All calculations are on calendar dates (YYYY-MM-DD) in Asia/Riyadh.
 */

export type ISODate = string; // YYYY-MM-DD

export const toISO = (d: Date): ISODate => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts as ISODate;
};

export const todayISO = () => toISO(new Date());

const parse = (iso: ISODate) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const fmt = (d: Date): ISODate => d.toISOString().slice(0, 10);

export function addDays(iso: ISODate, n: number): ISODate {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export function addMonths(iso: ISODate, n: number): ISODate {
  const d = parse(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return fmt(d);
}

export const addYears = (iso: ISODate, n: number) => addMonths(iso, n * 12);

export function isBusinessDay(iso: ISODate, holidays: Set<string>): boolean {
  const dow = parse(iso).getUTCDay(); // 5 = Friday, 6 = Saturday
  return dow !== 5 && dow !== 6 && !holidays.has(iso);
}

/** Adds N business days after the trigger date (the trigger day itself is not counted). */
export function addBusinessDays(iso: ISODate, n: number, holidays: Set<string>): ISODate {
  let cur = iso;
  let left = n;
  const step = n >= 0 ? 1 : -1;
  while (left !== 0) {
    cur = addDays(cur, step);
    if (isBusinessDay(cur, holidays)) left -= step;
  }
  return cur;
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/** End of the fiscal year containing `date` for a waqf whose fiscal year ends on MM-DD. */
export function fiscalYearEnd(date: ISODate, fiscalYearEndMMDD: string): ISODate {
  const year = Number(date.slice(0, 4));
  const candidate = `${year}-${fiscalYearEndMMDD}` as ISODate;
  return candidate >= date ? candidate : (`${year + 1}-${fiscalYearEndMMDD}` as ISODate);
}

/** Most recent fiscal year end on or before `date`. */
export function lastFiscalYearEnd(date: ISODate, fiscalYearEndMMDD: string): ISODate {
  const year = Number(date.slice(0, 4));
  const candidate = `${year}-${fiscalYearEndMMDD}` as ISODate;
  return candidate <= date ? candidate : (`${year - 1}-${fiscalYearEndMMDD}` as ISODate);
}

export type OffsetUnit =
  | "business_days" | "days" | "months" | "years" | "immediate" | "before_expiry_business_days" | "none";

/** Computes a due date from a trigger date according to an obligation's configured offset. */
export function computeDue(trigger: ISODate, value: number | null, unit: OffsetUnit, holidays: Set<string>): { due: ISODate | null; immediate: boolean } {
  switch (unit) {
    case "immediate":
      return { due: trigger, immediate: true };
    case "business_days":
      return { due: addBusinessDays(trigger, value ?? 0, holidays), immediate: false };
    case "before_expiry_business_days":
      return { due: addBusinessDays(trigger, -(value ?? 0), holidays), immediate: false };
    case "days":
      return { due: addDays(trigger, value ?? 0), immediate: false };
    case "months":
      return { due: addMonths(trigger, value ?? 0), immediate: false };
    case "years":
      return { due: addYears(trigger, value ?? 0), immediate: false };
    default:
      return { due: null, immediate: false };
  }
}

// ───────────── Hijri display (Umm al-Qura via Intl) ─────────────
export function hijri(iso: ISODate | Date | null | undefined, numerals: "latn" | "arab" = "latn"): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? parse(iso) : iso;
  return new Intl.DateTimeFormat(`ar-SA-u-ca-islamic-umalqura-nu-${numerals}`, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(d);
}

export function gregorian(iso: ISODate | Date | null | undefined, numerals: "latn" | "arab" = "latn"): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? parse(iso) : iso;
  return new Intl.DateTimeFormat(`ar-SA-u-ca-gregory-nu-${numerals}`, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(d);
}
