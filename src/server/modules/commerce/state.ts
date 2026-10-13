import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { contracts, contractSignatures, invoices, payments, quotes, serviceRequests, settings } from "@/server/db/schema";
import type { PaymentTerm } from "@/server/db/schema/commerce";
import { UserError } from "@/server/modules/_shared";
import { todayISO } from "@/server/engines/dates";
import { checkConsistency, invoiceBalance, pendingParties, quoteExpired, type CompanyProfile } from "./pure";

export async function companyProfile(tx: Tx): Promise<CompanyProfile> {
  const [r] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, "company.profile")).limit(1);
  return (r?.v as CompanyProfile) ?? {};
}

async function numSetting(tx: Tx, key: string): Promise<number | null> {
  const [r] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  const n = Number(r?.v);
  return r && Number.isFinite(n) ? n : null;
}

/** VAT rate from Admin → الإعدادات. No built-in default: a missing setting stops pricing instead of guessing. */
export async function vatRateSetting(tx: Tx): Promise<number> {
  const n = await numSetting(tx, "requests.default_vat_rate");
  if (n === null || n < 0 || n > 100) throw new UserError("نسبة ضريبة القيمة المضافة غير مضبوطة في إعدادات المنصة. يضبطها مسؤول النظام أولًا.");
  return n;
}

export async function settingNumber(tx: Tx, key: string, fallback: number) {
  return (await numSetting(tx, key)) ?? fallback;
}

// ───────────────────────── Quotes ─────────────────────────

export async function quotesOf(tx: Tx, requestId: string) {
  return tx.select().from(quotes).where(eq(quotes.requestId, requestId)).orderBy(asc(quotes.kind), desc(quotes.version), desc(quotes.createdAt));
}

export async function acceptedQuotes(tx: Tx, requestId: string) {
  return tx.select().from(quotes).where(and(eq(quotes.requestId, requestId), eq(quotes.status, "accepted"))).orderBy(asc(quotes.createdAt));
}

/** Marks sent quotes past their validity as expired (lazy, idempotent). */
export async function expireQuotes(tx: Tx, requestId: string) {
  const today = todayISO();
  const rows = await tx.select({ id: quotes.id, status: quotes.status, validUntil: quotes.validUntil }).from(quotes).where(and(eq(quotes.requestId, requestId), eq(quotes.status, "sent")));
  const ids = rows.filter((q) => quoteExpired(q, today)).map((q) => q.id);
  if (ids.length) await tx.update(quotes).set({ status: "expired" }).where(inArray(quotes.id, ids));
  return ids.length;
}

// ───────────────────────── Contracts ─────────────────────────

export async function contractsOf(tx: Tx, requestId: string) {
  return tx.select().from(contracts).where(eq(contracts.requestId, requestId)).orderBy(desc(contracts.createdAt));
}

export async function signaturesOf(tx: Tx, contractIds: string[]) {
  if (!contractIds.length) return [];
  return tx.select().from(contractSignatures).where(inArray(contractSignatures.contractId, contractIds)).orderBy(asc(contractSignatures.signedAt));
}

/** Signing state of one contract: legacy contracts (no parties) need the client's OTP; new ones need every required party. */
export function signingState(k: typeof contracts.$inferSelect, sigs: (typeof contractSignatures.$inferSelect)[]) {
  const mine = sigs.filter((s) => s.contractId === k.id);
  if (!k.parties.length) {
    const clientSigned = mine.some((s) => s.method === "otp");
    return { legacy: true, signedKeys: [] as string[], pending: [] as typeof k.parties, executed: clientSigned, clientSigned, companySigned: mine.some((s) => s.method === "company_countersign") };
  }
  const signedKeys = mine.map((s) => s.partyKey).filter((x): x is string => !!x);
  const pending = pendingParties(k.parties, signedKeys);
  const clientParties = k.parties.filter((p) => p.side === "client" && p.required);
  return {
    legacy: false, signedKeys, pending, executed: pending.length === 0,
    clientSigned: clientParties.every((p) => signedKeys.includes(p.key)),
    companySigned: k.parties.filter((p) => p.side === "company").every((p) => signedKeys.includes(p.key)),
  };
}

// ───────────────────────── Invoices & payments ─────────────────────────

export async function ledgerOf(tx: Tx, requestId: string) {
  const invs = await tx.select().from(invoices).where(eq(invoices.requestId, requestId)).orderBy(asc(invoices.createdAt));
  const pays = invs.length ? await tx.select().from(payments).where(inArray(payments.invoiceId, invs.map((i) => i.id))).orderBy(asc(payments.createdAt)) : [];
  return {
    invoices: invs.map((i) => ({ ...i, ...invoiceBalance(i, pays.filter((p) => p.invoiceId === i.id)) })),
    payments: pays,
  };
}

/** Installments the accepted initial quote requires before work starts, that are not fully paid (or not invoiced yet). */
export async function prestartUnpaid(tx: Tx, requestId: string) {
  const [q] = await tx.select().from(quotes).where(and(eq(quotes.requestId, requestId), eq(quotes.status, "accepted"), eq(quotes.kind, "initial"))).limit(1);
  if (!q) return 0;
  const due = (q.paymentTerms as PaymentTerm[]).filter((t) => t.beforeStart);
  if (!due.length) return 0;
  const { invoices: invs } = await ledgerOf(tx, requestId);
  return due.filter((t) => !invs.some((i) => i.quoteId === q.id && i.installmentKey === t.key && i.status === "paid")).length;
}

export async function consistencyFor(tx: Tx, requestId: string) {
  const [req] = await tx.select({ agreedPrice: serviceRequests.agreedPrice }).from(serviceRequests).where(eq(serviceRequests.id, requestId));
  const acc = await acceptedQuotes(tx, requestId);
  const ks = await tx.select().from(contracts).where(and(eq(contracts.requestId, requestId)));
  const { invoices: invs, payments: pays } = await ledgerOf(tx, requestId);
  return checkConsistency({
    acceptedQuotes: acc.map((q) => ({ id: q.id, number: q.number, version: q.version, kind: q.kind, net: Number(q.net), total: Number(q.total), vatRate: Number(q.vatRate), terms: q.paymentTerms })),
    contracts: ks.map((k) => ({ id: k.id, number: k.number, status: k.status, quoteId: k.quoteId, amount: Number(k.amount ?? 0), parentContractId: k.parentContractId })),
    invoices: invs.map((i) => ({ id: i.id, number: i.number, kind: i.kind, status: i.status, quoteId: i.quoteId, contractId: i.contractId, installmentKey: i.installmentKey, subtotal: Number(i.subtotal), discount: Number(i.discount), vat: Number(i.vat), total: Number(i.total), creditOfId: i.creditOfId })),
    payments: pays.map((p) => ({ invoiceId: p.invoiceId, amount: Number(p.amount), status: p.status })),
    agreedPrice: req?.agreedPrice ? Number(req.agreedPrice) : null,
  });
}

