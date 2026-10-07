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
import { zatcaTlvBase64 } from "./calc";

export type CompanyProfile = { nameAr?: string; nameEn?: string; legalForm?: string; crNumber?: string; vatNumber?: string; nationalAddress?: string; phone?: string; email?: string; website?: string };

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

/** Single invoice with seller data and the ZATCA phase-1 QR. Returns null when not visible to the caller. */
export async function invoiceView(auth: Auth, id: string) {
  return read(auth, async (tx) => {
    const inv = await loadInvoice(tx, id);
    if (!inv || !(await canSeeInvoice(tx, auth, inv))) return null;
    const company = await readSetting<CompanyProfile>(tx, "company.profile", {});
    const einvoiceOn = await isFlagOn(tx, "einvoice.zatca");
    const liveOn = await isFlagOn(tx, "payments.live");
    const pays = await tx.select().from(payments).where(eq(payments.invoiceId, inv.id)).orderBy(desc(payments.createdAt));
    const [req] = inv.requestId ? await tx.select({ id: serviceRequests.id, number: serviceRequests.number }).from(serviceRequests).where(eq(serviceRequests.id, inv.requestId)) : [];
    const [waqf] = inv.waqfId ? await tx.select({ name: waqfs.name }).from(waqfs).where(eq(waqfs.id, inv.waqfId)) : [];
    const [billed] = await tx.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, inv.userId));
    const sellerName = company.nameAr || "وقفك";
    const vatNumber = company.vatNumber?.trim() || "";
    const tlv = zatcaTlvBase64({
      sellerName,
      vatNumber: vatNumber || "000000000000000",
      timestamp: inv.createdAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      total: Number(inv.total).toFixed(2),
      vat: Number(inv.vat).toFixed(2),
    });
    const qr = await QRCode.toDataURL(tlv, { errorCorrectionLevel: "M", margin: 1, width: 180 });
    return {
      inv, status: effectiveStatus(inv, todayISO()), company, sellerName, vatNumber, einvoiceOn, liveOn, payments: pays, request: req ?? null,
      waqfName: waqf?.name ?? null, billedEmail: billed?.email ?? null, qr, tlv, canPay: await canPayInvoice(tx, auth, inv),
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
    let list = rows.map((r) => ({ ...r, status: effectiveStatus(r.inv, today) }));
    const totals = {
      issued: list.filter((r) => r.inv.status !== "void" && r.inv.status !== "credit_note").reduce((s, r) => s + Number(r.inv.total), 0),
      paid: list.filter((r) => r.inv.status === "paid").reduce((s, r) => s + Number(r.inv.total), 0),
      outstanding: list.filter((r) => r.inv.status === "issued").reduce((s, r) => s + Number(r.inv.total), 0),
      overdue: list.filter((r) => r.status === "overdue").reduce((s, r) => s + Number(r.inv.total), 0),
      credits: list.filter((r) => r.inv.status === "credit_note").reduce((s, r) => s + Number(r.inv.total), 0),
      vatCollected: list.filter((r) => r.inv.status === "paid").reduce((s, r) => s + Number(r.inv.vat), 0),
    };
    if (f.status) list = list.filter((r) => r.status === f.status);
    if (f.q?.trim()) {
      const s = f.q.trim().toLowerCase();
      list = list.filter((r) => [r.inv.number, r.inv.billedToName, r.reqNumber, r.waqfName].some((x) => x?.toLowerCase().includes(s)));
    }
    return { rows: list, totals };
  });
}
