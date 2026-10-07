"use server";

import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { invoices, payments, serviceRequests, users, waqfs } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { addDays, todayISO } from "@/server/engines/dates";
import { paymentProvider } from "@/server/adapters/payment";
import { notify } from "@/server/modules/notify";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { fmtSAR, type ActionState } from "@/lib/utils";
import { contractState, loadRequestCtx } from "@/server/modules/requests/access";
import { isFlagOn, readSetting } from "@/server/modules/requests/catalog";
import { logEvent } from "@/server/modules/requests/engine";
import { canPayInvoice, loadInvoice } from "./access";
import { computeInvoice } from "./calc";

const uuid = z.string().uuid("قيمة غير صالحة.");

/** Staff: issues the tax invoice for a request (amount = agreed price / quote). */
export async function issueInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "طلب غير صالح." };
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, id, "staff");
    if (["draft", "submitted", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("لا تصدر فاتورة لطلب في هذه الحالة.");
    const existing = await c.tx.select({ id: invoices.id, number: invoices.number }).from(invoices).where(and(eq(invoices.requestId, id), inArray(invoices.status, ["issued", "paid", "overdue"])));
    if (existing.length) throw new UserError(`صدرت فاتورة لهذا الطلب مسبقًا (${existing[0].number}). ألغها من المالية أولًا إن لزم.`);
    const cs = await contractState(c.tx, id);
    if (cs.contract && !cs.clientSigned) throw new UserError("لم يوقّع العميل العقد بعد.");
    const amount = Number(cs.contract?.amount ?? rc.req.agreedPrice ?? rc.req.quoteAmount ?? 0);
    if (!(amount > 0)) throw new UserError("لا يوجد مبلغ متفق عليه. حدّد عرض السعر أولًا.");
    const vatRate = Number(await readSetting<number>(c.tx, "requests.default_vat_rate", 15)) || 15;
    const t = computeInvoice(amount, vatRate);
    const zatca = await isFlagOn(c.tx, "einvoice.zatca");
    const [client] = await c.tx.select({ name: users.fullName }).from(users).where(eq(users.id, rc.req.requesterUserId));
    const [w] = rc.req.waqfId ? await c.tx.select({ name: waqfs.name }).from(waqfs).where(eq(waqfs.id, rc.req.waqfId)) : [];
    const number = await nextNumber(c.tx, "INV");
    const today = todayISO();
    const [row] = await c.tx.insert(invoices).values({
      number, userId: rc.req.requesterUserId, waqfId: rc.req.waqfId, billedToName: w?.name ?? client?.name ?? "العميل", requestId: id, contractId: cs.contract?.id ?? null,
      subtotal: t.subtotal.toFixed(2), discount: "0", vatRate: String(vatRate), vat: t.vat.toFixed(2), total: t.total.toFixed(2), status: "issued",
      issuedOn: today, dueOn: addDays(today, 14), einvoiceStatus: zatca ? "queued" : "pending",
      lines: [{ description: `${rc.service.nameAr} (${rc.service.code}) — طلب ${rc.req.number}`, qty: 1, unit: t.subtotal, total: t.subtotal }], createdBy: c.auth.user.id,
    }).returning({ id: invoices.id });
    await logEvent(c.tx, rc.req, c.auth.user.id, `صدرت الفاتورة ${number} بإجمالي ${fmtSAR(t.total)}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.invoice_issue", entityType: "invoice", entityId: row.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, ...t, vatRate } });
    await notify(rc.req.requesterUserId, "request.awaiting_client", { number: rc.req.number, note: `صدرت الفاتورة ${number} بمبلغ ${fmtSAR(t.total)}` }, { waqfId: rc.req.waqfId, link: `/app/billing/${row.id}`, tx: c.tx });
    return { ok: true, message: `صدرت الفاتورة ${number}.` };
  }, { perm: "staff.requests.assigned", revalidate: [`/admin/requests/${id}`, `/app/requests/${id}`, "/app/billing", "/admin/finance"] });
}

/** Client: starts a checkout with the configured gateway and redirects to it. */
export async function startCheckout(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("invoiceId") ?? "");
  if (!uuid.safeParse(id).success) return { error: "فاتورة غير صالحة." };
  let url = "";
  const res = await userAction(async (c) => {
    const inv = await loadInvoice(c.tx, id);
    if (!inv || !(await canPayInvoice(c.tx, c.auth, inv))) throw new ForbiddenError("لا تملك صلاحية سداد هذه الفاتورة.");
    if (inv.status !== "issued") throw new UserError(inv.status === "paid" ? "الفاتورة مدفوعة." : "الفاتورة غير قابلة للسداد.");
    let provider;
    try {
      provider = paymentProvider(await isFlagOn(c.tx, "payments.live"));
    } catch {
      throw new UserError("الدفع الإلكتروني غير مفعّل بعد. سدّد بالتحويل البنكي وأرسل الإيصال عبر رسائل الطلب.");
    }
    const [p] = await c.tx.insert(payments).values({ invoiceId: inv.id, userId: c.auth.user.id, provider: provider.name, amount: inv.total, status: "initiated", createdBy: c.auth.user.id }).returning({ id: payments.id });
    const co = await provider.createCheckout({ invoiceId: inv.id, paymentId: p.id, amount: inv.total, currency: inv.currency, description: `فاتورة ${inv.number}` });
    await c.tx.update(payments).set({ providerRef: co.providerRef }).where(eq(payments.id, p.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.checkout", entityType: "payment", entityId: p.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, after: { invoice: inv.number, provider: provider.name, amount: inv.total } });
    url = co.url;
  });
  if (res.error) return res;
  redirect(url);
}

const confirmSchema = z.object({
  invoiceId: uuid,
  paymentId: uuid,
  card: z.string().trim().min(12, "أدخل رقم البطاقة التجريبية."),
  expiry: z.string().trim().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "الصيغة: شهر/سنة مثل 12/29"),
  cvc: z.string().trim().regex(/^\d{3}$/, "3 أرقام."),
});

/** Sandbox gateway confirmation: verifies the test card, then marks payment and invoice paid. */
export async function confirmSandboxPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(confirmSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let ok = false;
  const res = await userAction(async (c) => {
    const inv = await loadInvoice(c.tx, d.invoiceId);
    if (!inv || !(await canPayInvoice(c.tx, c.auth, inv))) throw new ForbiddenError("لا تملك صلاحية سداد هذه الفاتورة.");
    const [p] = await c.tx.select().from(payments).where(and(eq(payments.id, d.paymentId), eq(payments.invoiceId, inv.id))).limit(1);
    if (!p || p.provider !== "sandbox") throw new UserError("عملية الدفع غير موجودة. ابدأ السداد من صفحة الفاتورة.");
    if (p.status !== "initiated") throw new UserError("انتهت عملية الدفع هذه. ابدأ عملية جديدة.");
    if (inv.status !== "issued") throw new UserError("الفاتورة غير قابلة للسداد.");
    const provider = paymentProvider(false);
    const v = await provider.verify({ providerRef: p.providerRef ?? "", amount: p.amount, testCard: { number: d.card, expiry: d.expiry, cvc: d.cvc } });
    const now = new Date();
    if (v.status !== "paid") {
      await c.tx.update(payments).set({ status: "failed", raw: v.raw ?? null }).where(eq(payments.id, p.id));
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.payment_failed", entityType: "payment", entityId: p.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent });
      return { error: "رُفضت البطاقة التجريبية. استخدم إحدى البطاقات المعروضة في الصفحة ثم ابدأ عملية جديدة." };
    }
    await c.tx.update(payments).set({ status: "paid", paidAt: now, method: v.method, raw: v.raw ?? null }).where(eq(payments.id, p.id));
    await c.tx.update(invoices).set({ status: "paid", paidOn: todayISO(), updatedBy: c.auth.user.id }).where(eq(invoices.id, inv.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.payment", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: "issued" }, after: { status: "paid", provider: "sandbox", paymentId: p.id, amount: p.amount } });
    if (inv.requestId) {
      const [req] = await c.tx.select().from(serviceRequests).where(eq(serviceRequests.id, inv.requestId));
      if (req) {
        await logEvent(c.tx, req, c.auth.user.id, `سُددت الفاتورة ${inv.number} (${fmtSAR(inv.total)})`);
        if (req.assignedToUserId) await notify(req.assignedToUserId, "request.status", { number: req.number, status: `سُددت الفاتورة ${inv.number}` }, { waqfId: req.waqfId, link: `/admin/requests/${req.id}`, tx: c.tx });
      }
    }
    ok = true;
  }, { revalidate: ["/app/billing", `/app/billing/${d.invoiceId}`, "/admin/finance"] });
  if (res.error || !ok) return res;
  redirect(`/app/billing/${d.invoiceId}?paid=1`);
}

// ───────────────────────── Admin finance ─────────────────────────

const manualSchema = z.object({
  invoiceId: uuid,
  reference: z.string().trim().min(4, "أدخل مرجع التحويل البنكي.").max(120),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "أدخل تاريخ السداد."),
});
export async function markPaidManual(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(manualSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const inv = await loadInvoice(c.tx, d.invoiceId);
    if (!inv) throw new UserError("الفاتورة غير موجودة.");
    if (inv.status !== "issued") throw new UserError("تُسجل الدفعة على فاتورة مستحقة فقط.");
    if (d.paidOn > todayISO()) throw new UserError("تاريخ السداد لا يكون في المستقبل.");
    const [p] = await c.tx.insert(payments).values({
      invoiceId: inv.id, userId: inv.userId, provider: "bank_transfer", providerRef: d.reference, method: "transfer", amount: inv.total, status: "paid",
      paidAt: new Date(`${d.paidOn}T12:00:00+03:00`), raw: { recordedBy: c.auth.user.id }, createdBy: c.auth.user.id,
    }).returning({ id: payments.id });
    await c.tx.update(invoices).set({ status: "paid", paidOn: d.paidOn, updatedBy: c.auth.user.id }).where(eq(invoices.id, inv.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.mark_paid_manual", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: inv.status }, after: { status: "paid", reference: d.reference, paidOn: d.paidOn, paymentId: p.id } });
    return { ok: true, message: `سُجلت الفاتورة ${inv.number} مدفوعة.` };
  }, { perm: "admin.finance", revalidate: ["/admin/finance", `/admin/finance/${d.invoiceId}`, `/app/billing/${d.invoiceId}`, "/app/billing"] });
}

const voidSchema = z.object({
  invoiceId: uuid,
  reason: z.string().trim().min(5, "اكتب سبب الإلغاء.").max(500),
  mode: z.enum(["void", "credit"]),
});
/** Cancel an unpaid invoice, or cancel with a credit note (required for paid invoices). */
export async function cancelInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(voidSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const inv = await loadInvoice(c.tx, d.invoiceId);
    if (!inv) throw new UserError("الفاتورة غير موجودة.");
    if (!["issued", "paid"].includes(inv.status)) throw new UserError("الفاتورة ملغاة مسبقًا أو ليست فاتورة بيع.");
    if (inv.status === "paid" && d.mode !== "credit") throw new UserError("الفاتورة مدفوعة: أصدر إشعارًا دائنًا بدل الإلغاء المباشر.");
    let creditNumber: string | null = null;
    if (d.mode === "credit") {
      creditNumber = await nextNumber(c.tx, "INV");
      const neg = (v: string) => (-Number(v)).toFixed(2);
      await c.tx.insert(invoices).values({
        number: creditNumber, userId: inv.userId, waqfId: inv.waqfId, billedToName: inv.billedToName, requestId: inv.requestId, contractId: inv.contractId,
        subtotal: neg(inv.subtotal), discount: "0", vatRate: inv.vatRate, vat: neg(inv.vat), total: neg(inv.total), status: "credit_note", issuedOn: todayISO(),
        einvoiceStatus: inv.einvoiceStatus === "queued" ? "queued" : "pending",
        lines: [{ description: `إشعار دائن عن الفاتورة ${inv.number} — السبب: ${d.reason}`, qty: 1, unit: -Number(inv.subtotal), total: -Number(inv.subtotal) }], createdBy: c.auth.user.id,
      });
    }
    await c.tx.update(invoices).set({ status: "void", updatedBy: c.auth.user.id }).where(eq(invoices.id, inv.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: d.mode === "credit" ? "billing.credit_note" : "billing.void", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: inv.status }, after: { status: "void", reason: d.reason, creditNote: creditNumber } });
    return { ok: true, message: creditNumber ? `أُلغيت الفاتورة وصدر الإشعار الدائن ${creditNumber}.` : "أُلغيت الفاتورة." };
  }, { perm: "admin.finance", revalidate: ["/admin/finance", `/admin/finance/${d.invoiceId}`, "/app/billing"] });
}
