/** Pure finance helpers (no I/O): IBAN handling, journal validation, fiscal-year math. */
import { ACCOUNTS } from "../waqf-file/labels";

export const normalizeIban = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

/** Saudi IBAN: SA + 2 check digits + 20 chars (2 bank code + 18 account), ISO 13616 mod-97 check. */
export function isValidSaudiIban(raw: string): boolean {
  const s = normalizeIban(raw);
  if (!/^SA\d{2}[0-9A-Z]{20}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

export const maskIban = (last4: string) => `SA•• •••• •••• •••• •••• ${last4}`;

export type JournalLine = { accountCode: string; debit: number; credit: number; description?: string };
const cents = (n: number) => Math.round(n * 100);

/** Simple double entry: ≥ 2 lines, each line is either a debit or a credit, and Σdebit = Σcredit. */
export function validateJournal(lines: JournalLine[]): { ok: true; total: number } | { ok: false; error: string } {
  if (lines.length < 2) return { ok: false, error: "القيد المزدوج يحتاج سطرين على الأقل: طرف مدين وطرف دائن." };
  const known = new Set(ACCOUNTS.map((a) => a.code));
  for (const [i, l] of lines.entries()) {
    if (!known.has(l.accountCode)) return { ok: false, error: `اختر حسابًا صحيحًا في السطر ${i + 1}.` };
    if (!Number.isFinite(l.debit) || !Number.isFinite(l.credit) || l.debit < 0 || l.credit < 0) return { ok: false, error: `المبالغ في السطر ${i + 1} غير صحيحة.` };
    if ((l.debit > 0) === (l.credit > 0)) return { ok: false, error: `السطر ${i + 1}: أدخل مبلغًا في المدين أو الدائن، لا في كليهما ولا تتركهما فارغين.` };
  }
  const d = lines.reduce((s, l) => s + cents(l.debit), 0);
  const c = lines.reduce((s, l) => s + cents(l.credit), 0);
  if (d !== c) return { ok: false, error: `القيد غير متوازن: مجموع المدين ${(d / 100).toFixed(2)} ومجموع الدائن ${(c / 100).toFixed(2)}. يجب أن يتساويا.` };
  if (d === 0) return { ok: false, error: "القيد بلا مبالغ." };
  return { ok: true, total: d / 100 };
}

/** Fiscal year that ends in `year` given the waqf fiscal-year end "MM-DD". */
export function fiscalYearRange(fyEnd: string, year: number): { from: string; to: string } {
  const m = /^(\d{2})-(\d{2})$/.exec(fyEnd) ?? ["", "12", "31"];
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const to = new Date(Date.UTC(year, mm - 1, dd));
  const from = new Date(Date.UTC(year - 1, mm - 1, dd + 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

/** The fiscal year (by its end year) that contains `date`. */
export function fiscalYearOf(fyEnd: string, date: string): number {
  const y = Number(date.slice(0, 4));
  const r = fiscalYearRange(fyEnd, y);
  return date > r.to ? y + 1 : y;
}

export type LedgerRow = { accountCode: string; debit: string | number; credit: string | number };

/** Aggregates ledger rows into revenue / expense / distributions / cash movement. */
export function summarize(rows: LedgerRow[]) {
  const kind = new Map(ACCOUNTS.map((a) => [a.code, a.kind]));
  let revenue = 0, expense = 0, distributions = 0, cashIn = 0, cashOut = 0;
  const byAccount = new Map<string, number>();
  for (const r of rows) {
    const d = cents(Number(r.debit));
    const c = cents(Number(r.credit));
    const k = kind.get(r.accountCode);
    if (k === "revenue") revenue += c - d;
    if (k === "expense") expense += d - c;
    if (r.accountCode === "5400") distributions += d - c;
    if (r.accountCode === "1100") {
      cashIn += d;
      cashOut += c;
    }
    const bal = k === "revenue" || k === "liability" || k === "equity" ? c - d : d - c;
    byAccount.set(r.accountCode, (byAccount.get(r.accountCode) ?? 0) + bal);
  }
  return {
    revenue: revenue / 100, expense: expense / 100, net: (revenue - expense) / 100, distributions: distributions / 100,
    cashIn: cashIn / 100, cashOut: cashOut / 100,
    byAccount: [...byAccount.entries()].map(([code, v]) => ({ code, amount: v / 100 })).sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/** Statement kind required by size class (nazara regulation art. 15/4–5). */
export const requiredStatementKind = (sizeClass: string | null) => (sizeClass === "large" || sizeClass === "medium" ? "audited" : "simple_statement");
