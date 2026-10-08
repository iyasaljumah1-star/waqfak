import "server-only";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import { bankAccounts, budgets, distributions, financialStatements, ledgerEntries } from "../../db/schema";
import { fiscalYearRange, maskIban, summarize } from "./pure";

/** Aggregates only — safe for finance.summary users (no ledger lines, no account numbers). */
export async function financeSummary(tx: Tx, waqfId: string, fyEnd: string, fy: number) {
  const range = fiscalYearRange(fyEnd, fy);
  const [rows, budget, accts, stmt, dists] = await Promise.all([
    tx
      .select({ accountCode: ledgerEntries.accountCode, debit: sql<string>`sum(${ledgerEntries.debit})`, credit: sql<string>`sum(${ledgerEntries.credit})` })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.waqfId, waqfId), gte(ledgerEntries.entryDate, range.from), lte(ledgerEntries.entryDate, range.to)))
      .groupBy(ledgerEntries.accountCode),
    tx.select({ status: budgets.status, totalRevenue: budgets.totalRevenue, totalExpense: budgets.totalExpense, approvedOn: budgets.approvedOn }).from(budgets).where(and(eq(budgets.waqfId, waqfId), eq(budgets.fiscalYear, fy))).limit(1),
    tx.select({ inWaqfName: bankAccounts.inWaqfName }).from(bankAccounts).where(and(eq(bankAccounts.waqfId, waqfId), eq(bankAccounts.status, "active"))),
    tx.select({ status: financialStatements.status, kind: financialStatements.kind, submittedToGaaOn: financialStatements.submittedToGaaOn }).from(financialStatements).where(and(eq(financialStatements.waqfId, waqfId), eq(financialStatements.fiscalYear, fy))).limit(1),
    tx.select({ status: distributions.status, total: distributions.totalAmount }).from(distributions).where(eq(distributions.waqfId, waqfId)),
  ]);
  const s = summarize(rows.map((r) => ({ accountCode: r.accountCode, debit: r.debit ?? "0", credit: r.credit ?? "0" })));
  return {
    range, ...s,
    budget: budget[0] ?? null,
    accounts: { total: accts.length, notInName: accts.filter((a) => !a.inWaqfName).length },
    statement: stmt[0] ?? null,
    pendingDistributions: dists.filter((x) => x.status === "planned" || x.status === "approved").length,
  };
}

/** Full detail for finance.view users. IBANs are masked here; the encrypted value never leaves the server. */
export async function financeDetail(tx: Tx, waqfId: string, fyEnd: string, fy: number) {
  const range = fiscalYearRange(fyEnd, fy);
  const [accts, buds, entries, stmts] = await Promise.all([
    tx.select().from(bankAccounts).where(eq(bankAccounts.waqfId, waqfId)).orderBy(asc(bankAccounts.status), asc(bankAccounts.createdAt)),
    tx.select().from(budgets).where(eq(budgets.waqfId, waqfId)).orderBy(desc(budgets.fiscalYear)),
    tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.waqfId, waqfId), gte(ledgerEntries.entryDate, range.from), lte(ledgerEntries.entryDate, range.to))).orderBy(desc(ledgerEntries.entryDate), asc(ledgerEntries.referenceNo), desc(ledgerEntries.debit)).limit(400),
    tx.select().from(financialStatements).where(eq(financialStatements.waqfId, waqfId)).orderBy(desc(financialStatements.fiscalYear)),
  ]);
  return {
    accounts: accts.map(({ ibanEnc: _e, ...a }) => (void _e, { ...a, ibanMasked: maskIban(a.ibanLast4) })),
    budgets: buds,
    entries,
    statements: stmts,
  };
}
