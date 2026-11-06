/**
 * Hijri (Umm al-Qura) ↔ Gregorian conversion via the runtime's Intl calendar. The conversion is checked in tests
 * against date pairs printed side by side in the official gazette; a converted date is always marked as computed.
 */

export type HijriDate = { year: number; month: number; day: number };

const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });

export function gregorianToHijri(iso: string): HijriDate {
  const parts = fmt.formatToParts(new Date(`${iso}T00:00:00Z`));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Parses «1443/05/30», «30 /05/ 1443هـ», «1443-7-03». Year is the four-digit part. */
export function parseHijri(s: string): HijriDate | null {
  const nums = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).match(/[0-9]+/g);
  if (!nums || nums.length !== 3) return null;
  const n = nums.map(Number);
  const yi = n.findIndex((x) => x > 1300 && x < 1600);
  if (yi === 0) return { year: n[0]!, month: n[1]!, day: n[2]! };
  if (yi === 2) return { year: n[2]!, month: n[1]!, day: n[0]! };
  return null;
}

export function hijriToGregorian(h: HijriDate): string | null {
  if (h.month < 1 || h.month > 12 || h.day < 1 || h.day > 30) return null;
  // Hijri years are ~354.37 days; start near the estimate and scan.
  const approx = Date.UTC(622, 6, 16) + ((h.year - 1) * 354.367 + (h.month - 1) * 29.53 + (h.day - 1)) * 86_400_000;
  for (let off = -40; off <= 40; off++) {
    const d = new Date(approx + off * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    const g = gregorianToHijri(iso);
    if (g.year === h.year && g.month === h.month && g.day === h.day) return iso;
  }
  return null;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function formatHijri(h: HijriDate): string {
  return `${h.year}/${String(h.month).padStart(2, "0")}/${String(h.day).padStart(2, "0")}هـ`;
}
