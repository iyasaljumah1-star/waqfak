import "server-only";
import { and, desc, eq, gte, inArray, lte, or, type SQL } from "drizzle-orm";
import QRCode from "qrcode";
import { invoices, payments, serviceRequests, users, waqfs } from "@/server/db/schema";
import type { Auth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { todayISO } from "@/server/engines/dates";
import { memberWaqfIdsWith } from "@/server/modules/requests/access";
import { isFlagOn, readSetting } from "@/server/modules/requests/catalog";
import { canPayInvoice, canSeeInvoice, effectiveStatus, loadInvoice } from "./access";
import { AGING_LABEL, agingBucket, zatcaTlvBase64, type AgingBucket } from "./calc";
import { invoiceBalance } from "@/server/modules/commerce/pure";
export { AGING_LABEL, type AgingBucket };

const PAYABLE = ["tax_invoice", "non_tax_invoice"];

export type CompanyProfile = { nameAr?: string; nameEn?: string; legalForm?: string; crNumber?: string; unifiedNumber?: string; vatRegistration?: string; vatNumber?: string; nationalAddress?: string; bankName?: string; iban?: string; phone?: string; email?: string; website?: string };

/** Client: invoices billed to me or to waqfs where my membership grants requests.view, with their payments. */
export async function myInvoices(auth: Auth) {
  return read(auth, async (tx) => {
    const w = await memberWaqfIdsWith(tx, auth, "requests.view");
    const cond = w.length ? or(eq(invoices.userId, auth.user.id), inArray(invoices.waqfId, w))! : eq(invoices.userId, auth.user.id);
    const rows = await tx
      .select({ inv: invoices, reqNumber: serviceRequests.number, waqfName: waqfs.name })
      .from(invoices)
      .leftJoin(serviceRequests, eq(serviceRequests.id, invoices.requestId))
      .leftJoin(waqfs, eq(waqfs.id, invoices.waqfId))
      .where(cond)
      .orderBy(desc(invoices.issuedOn), desc(invoices.createdAt));
    const ids = rows.map((r) => r.inv.id);
    const pays = ids.length ? await tx.select().from(payments).where(inArray(payments.invoiceId, ids)).orderBy(desc(payments.createdAt)) : [];
    const today = todayISO();
    return { invoices: rows.map((r) => ({ ...r, status: effectiveStatus(r.inv, today) })), payments: pays, numbers: new Map(rows.map((r) => [r.inv.id, r.inv.number])) };
  });
}

/**
 * Single invoice with the seller data frozen on it (legacy invoices fall back to the current profile), its balance and
 * payments. The ZATCA phase-1 QR is produced only for a tax invoice whose seller VAT number is on file — never with a
 * placeholder number. Returns null when not visible to the caller.
 */
export async function invoiceView(auth: Auth, id: string) {
  return read(auth, async (tx) => {
    const inv = await loadInvoice(tx, id);
    if (!inv || !(await canSeeInvoice(tx, auth, inv))) return null;
    const current = await readSetting<CompanyProfile>(tx, "company.profile", {});
    const company: CompanyProfile = (inv.sellerSnapshot as CompanyProfile | null) ?? current;
    const einvoiceOn = await isFlagOn(tx, "einvoice.zatca");
    const liveOn = await isFlagOn(tx, "payments.live");
    const pays = await tx.select().from(payments).where(eq(payments.invoiceId, inv.id)).orderBy(desc(payments.createdAt));
    const [req] = inv.requestId ? await tx.select({ id: serviceRequests.id, number: serviceRequests.number }).from(serviceRequests).where(eq(serviceRequests.id, inv.requestId)) : [];
    const [waqf] = inv.waqfId ? await tx.select({ name: waqfs.name }).from(waqfs).where(eq(waqfs.id, inv.waqfId)) : [];
    const [billed] = await tx.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, inv.userId));
    const [credited] = inv.creditOfId ? await tx.select({ id: invoices.id, number: invoices.number }).from(invoices).where(eq(invoices.id, inv.creditOfId)) : [];
    const sellerName = company.nameAr || "وقفك";
    const vatNumber = company.vatNumber?.trim() || "";
    const validVat = /^3\d{13}3$/.test(vatNumber);
    // Legacy invoices (issued before invoice kinds) without a seller VAT number are shown as non-tax documents.
    const kind = inv.kind === "tax_invoice" && !validVat && !inv.sellerSnapshot ? "legacy_no_vat" : inv.kind;
    const taxDoc = (inv.kind === "tax_invoice" || (inv.kind === "credit_note" && Number(inv.vat) !== 0)) && validVat;
    let qr: string | null = null;
    if (taxDoc) {
      const tlv = zatcaTlvBase64({ sellerName, vatNumber, timestamp: inv.createdAt.toISOString().replace(/\.\d{3}Z$/, "Z"), total: Number(inv.total).toFixed(2), vat: Number(inv.vat).toFixed(2) });
      qr = await QRCode.toDataURL(tlv, { errorCorrectionLevel: "M", margin: 1, width: 180 });
    }
    const bal = invoiceBalance(inv, pays);
    return {
      inv, status: effectiveStatus(inv, todayISO()), company, sellerName, vatNumber: validVat ? vatNumber : "", kind, taxDoc, einvoiceOn, liveOn, payments: pays, request: req ?? null,
      waqfName: waqf?.name ?? null, billedEmail: billed?.email ?? null, qr, canPay: (await canPayInvoice(tx, auth, inv)) && ["tax_invoice", "non_tax_invoice"].includes(inv.kind),
      buyer: (inv.buyerSnapshot as Record<string, string> | null) ?? null, credited: credited ?? null, ...bal,
    };
  });
}

export type FinanceFilters = { status?: string; q?: string; from?: string; to?: string };

/** Admin finance list (perm admin.finance, checked by the page). */
export async function financeList(auth: Auth, f: FinanceFilters) {
  return read(auth, async (tx) => {
    const conds: SQL[] = [];
    if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(invoices.issuedOn, f.from));
    if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(invoices.issuedOn, f.to));
    const rows = await tx
      .select({ inv: invoices, reqNumber: serviceRequests.number, reqId: serviceRequests.id, waqfName: waqfs.name })
      .from(invoices)
      .leftJoin(serviceRequests, eq(serviceRequests.id, invoices.requestId))
      .leftJoin(waqfs, eq(waqfs.id, invoices.waqfId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(invoices.issuedOn), desc(invoices.createdAt))
      .limit(500);
    const today = todayISO();
    const pays = rows.length ? await tx.select({ invoiceId: payments.invoiceId, amount: payments.amount, status: payments.status }).from(payments).where(inArray(payments.invoiceId, rows.map((r) => r.inv.id))) : [];
    let list = rows.map((r) => ({ ...r, status: effectiveStatus(r.inv, today), ...invoiceBalance(r.inv, pays.filter((p) => p.invoiceId === r.inv.id)) }));
    // Proformas are not sales documents; credit notes are reported apart.
    const sales = list.filter((r) => PAYABLE.includes(r.inv.kind));
    const open = sales.filter((r) => ["issued", "partially_paid"].includes(r.inv.status));
    const totals = {
      issued: sales.filter((r) => r.inv.status !== "void").reduce((s, r) => s + Number(r.inv.total), 0),
      paid: sales.reduce((s, r) => s + r.paid, 0),
      outstanding: open.reduce((s, r) => s + r.balance, 0),
      overdue: open.filter((r) => r.status === "overdue").reduce((s, r) => s + r.balance, 0),
      credits: list.filter((r) => r.inv.kind === "credit_note" || r.inv.status === "credit_note").reduce((s, r) => s + Number(r.inv.total), 0),
      vatCollected: sales.reduce((s, r) => s + (Number(r.inv.total) ? (r.paid * Number(r.inv.vat)) / Number(r.inv.total) : 0), 0),
    };
    if (f.status) list = list.filter((r) => r.status === f.status);
    if (f.q?.trim()) {
      const s = f.q.trim().toLowerCase();
      list = list.filter((r) => [r.inv.number, r.inv.billedToName, r.reqNumber, r.waqfName].some((x) => x?.toLowerCase().includes(s)));
    }
    return { rows: list, totals };
  });
}

/** Admin finance: payments ledger (all providers) with invoice numbers. */
export async function financePayments(auth: Auth, f: { status?: string; from?: string; to?: string } = {}) {
  return read(auth, async (tx) => {
    const conds: SQL[] = [];
    if (f.status) conds.push(eq(payments.status, f.status));
    if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(payments.createdAt, new Date(`${f.from}T00:00:00+03:00`)));
    if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(payments.createdAt, new Date(`${f.to}T23:59:59+03:00`)));
    const rows = await tx
      .select({ p: payments, invNumber: invoices.number, billedTo: invoices.billedToName })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(500);
    const paid = rows.filter((r) => r.p.status === "paid");
    return {
      rows,
      totals: {
        paid: paid.reduce((s, r) => s + Number(r.p.amount), 0),
        sandbox: paid.filter((r) => r.p.provider === "sandbox").reduce((s, r) => s + Number(r.p.amount), 0),
        failed: rows.filter((r) => r.p.status === "failed").length,
      },
    };
  });
}

/** Admin finance: receivables (unpaid issued invoices) with aging buckets and per-client totals. */
export async function receivables(auth: Auth) {
  return read(auth, async (tx) => {
    const rows = await tx
      .select({ inv: invoices, reqNumber: serviceRequests.number, reqId: serviceRequests.id, waqfName: waqfs.name })
      .from(invoices)
      .leftJoin(serviceRequests, eq(serviceRequests.id, invoices.requestId))
      .leftJoin(waqfs, eq(waqfs.id, invoices.waqfId))
      .where(and(inArray(invoices.status, ["issued", "partially_paid"]), inArray(invoices.kind, PAYABLE)))
      .orderBy(invoices.dueOn);
    const today = todayISO();
    const pays = rows.length ? await tx.select({ invoiceId: payments.invoiceId, amount: payments.amount, status: payments.status }).from(payments).where(inArray(payments.invoiceId, rows.map((r) => r.inv.id))) : [];
    // Receivables are the remaining balances (partial payments deducted).
    const list = rows.map((r) => {
      const bal = invoiceBalance(r.inv, pays.filter((p) => p.invoiceId === r.inv.id)).balance;
      return { ...r, inv: { ...r.inv, total: bal.toFixed(2) }, bucket: agingBucket(r.inv.dueOn, today), daysLate: r.inv.dueOn && r.inv.dueOn < today ? Math.round((Date.parse(today) - Date.parse(r.inv.dueOn)) / 86_400_000) : 0 };
    });
    const buckets = Object.fromEntries((Object.keys(AGING_LABEL) as AgingBucket[]).map((b) => [b, list.filter((r) => r.bucket === b).reduce((s, r) => s + Number(r.inv.total), 0)])) as Record<AgingBucket, number>;
    const byClient = new Map<string, { name: string; total: number; count: number }>();
    for (const r of list) {
      const e = byClient.get(r.inv.billedToName) ?? { name: r.inv.billedToName, total: 0, count: 0 };
      e.total += Number(r.inv.total);
      e.count += 1;
      byClient.set(r.inv.billedToName, e);
    }
    return { rows: list, buckets, total: list.reduce((s, r) => s + Number(r.inv.total), 0), clients: [...byClient.values()].sort((a, b) => b.total - a.total) };
  });
}
