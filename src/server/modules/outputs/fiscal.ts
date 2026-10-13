import { addDays } from "@/server/engines/dates";

/** The fiscal period that ended last (or the current one if none ended yet), from the waqf's fiscal-year end (MM-DD). */
export function lastFiscalPeriod(fiscalYearEnd: string, today: string): { from: string; to: string } {
  const [mm, dd] = (/^\d{2}-\d{2}$/.test(fiscalYearEnd) ? fiscalYearEnd : "12-31").split("-");
  const y = Number(today.slice(0, 4));
  let end = `${y}-${mm}-${dd}`;
  if (end > today) end = `${y - 1}-${mm}-${dd}`;
  const start = addDays(`${Number(end.slice(0, 4)) - 1}-${mm}-${dd}`, 1);
  return { from: start, to: end };
}
