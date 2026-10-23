"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { contracts, invoices, notificationTemplates, paymentSchedule, payments, quotes, serviceRequests, users, waqfs } from "@/server/db/schema";
import { closeFinanceTask } from "./schedule";
import type { PaymentTerm } from "@/server/db/schema/commerce";
import { ForbiddenError } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { addDays, todayISO } from "@/server/engines/dates";
import { paymentProvider } from "@/server/adapters/payment";
import { notify } from "@/server/modules/notify";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { fmtSAR, type ActionState } from "@/lib/utils";
import { contractState, loadRequestCtx } from "@/server/modules/requests/access";
import { isFlagOn } from "@/server/modules/requests/catalog";
import { logEvent } from "@/server/modules/requests/engine";
import { invoiceBalance, invoicePolicy, INVOICE_KIND_LABEL, splitInstallments, statusAfterPayment, type CompanyProfile } from "@/server/modules/commerce/pure";
import { companyProfile, consistencyFor, ledgerOf, settingNumber, signaturesOf, signingState, vatRateSetting } from "@/server/modules/commerce/state";
import { canPayInvoice, loadInvoice } from "./access";
import { einvoiceState } from "./einvoice";
import { computeInvoice, round2 } from "./calc";

type Ctx = Parameters<Parameters<typeof userAction>[0]>[0];
const uuid = z.string().uuid("قيمة غير صالحة.");
const PAYABLE_KINDS = ["tax_invoice", "non_tax_invoice"];
const SELLER_KEYS: (keyof CompanyProfile)[] = ["nameAr", "nameEn", "legalForm", "crNumber", "unifiedNumber", "vatRegistration", "vatNumber", "nationalAddress", "bankName", "iban", "phone", "email"];

const sellerSnapshot = (c: CompanyProfile) => Object.fromEntries(SELLER_KEYS.map((k) => [k, (c[k] ?? "").trim()]).filter(([, v]) => v)) as Record<string, string>;

const issueSchema = z.object({ id: uuid, quoteId: z.string().optional().default(""), termKey: z.string().max(20).optional().default("") });

/**
 * Staff: issues the invoice of one installment of an accepted quote whose contract is executed. The document type
 * follows the company's VAT data (tax invoice / non-tax invoice / proforma) and the seller and buyer data are frozen
 * on the invoice. Legacy requests without versioned quotes keep the single invoice from the signed contract amount.
 */
export async function issueInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(issueSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps && !c.auth.perms.has("admin.finance")) throw new ForbiddenError();
    if (["draft", "submitted", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("لا تصدر فاتورة لطلب في هذه الحالة.");
    const company = await companyProfile(c.tx);
    const policy = invoicePolicy(company);
    const today = todayISO();
    const dueDays = await settingNumber(c.tx, "invoices.due_days", 14);
    const [client] = await c.tx.select({ name: users.fullName }).from(users).where(eq(users.id, rc.req.requesterUserId));
    const [w] = rc.req.waqfId ? await c.tx.select({ name: waqfs.name }).from(waqfs).where(eq(waqfs.id, rc.req.waqfId)) : [];
    const zatca = (await einvoiceState(c.tx)).active;

    let amountNet: number;
    let vatRate: number;
    let line: string;
    let quoteId: string | null = null;
    let termKey: string | null = null;
    let termLabel: string | null = null;
    let contractId: string | null = null;
    let buyer: Record<string, string> = { name: w?.name ?? client?.name ?? "العميل" };

    if (d.quoteId) {
      if (!uuid.safeParse(d.quoteId).success) throw new UserError("عرض غير صالح.");
      const [q] = await c.tx.select().from(quotes).where(and(eq(quotes.id, d.quoteId), eq(quotes.requestId, d.id))).limit(1);
      if (!q || q.status !== "accepted") throw new UserError("تصدر الفواتير على عرض مقبول.");
      const [k] = await c.tx.select().from(contracts).where(and(eq(contracts.quoteId, q.id), eq(contracts.status, "signed"))).limit(1);
      if (!k) throw new UserError("تصدر الفاتورة بعد نفاذ العقد المبني على هذا العرض (توقيع جميع الأطراف).");
      const st = signingState(k, await signaturesOf(c.tx, [k.id]));
      if (!st.executed) throw new UserError("لم يكتمل توقيع جميع أطراف العقد.");
      const parts = splitInstallments(Number(q.net), Number(q.vatRate), q.paymentTerms as PaymentTerm[]);
      const part = parts.find((t) => t.key === d.termKey);
      if (!part) throw new UserError("اختر الدفعة المراد فوترتها.");
      const { invoices: invs } = await ledgerOf(c.tx, d.id);
      if (invs.some((i) => i.quoteId === q.id && i.installmentKey === part.key && PAYABLE_KINDS.includes(i.kind) && i.status !== "void"))
        throw new UserError(`فُوترت دفعة «${part.label}» مسبقًا. ألغِ فاتورتها بإشعار دائن أولًا إن لزم التصحيح.`);
      if (policy.kind === "non_tax_invoice" && Number(q.vat) > 0) throw new UserError("العرض المقبول يتضمن ضريبة والشركة مسجلة في الإعدادات على أنها غير مسجلة. صحّح الإعداد قبل الفوترة.");
      amountNet = part.net;
      vatRate = policy.kind === "non_tax_invoice" ? 0 : Number(q.vatRate);
      quoteId = q.id;
      termKey = part.key;
      termLabel = part.label;
      contractId = k.id;
      const party = k.parties.find((p) => p.side === "client");
      if (party) buyer = { name: party.name, capacity: party.capacity, ...(party.idNumber ? { idLabel: party.idLabel ?? "", idNumber: party.idNumber } : {}) };
      line = `${rc.service.nameAr} — ${part.label} (${part.percent}٪) — العقد ${k.number}، العرض ${q.number}`;
      // Never invoice beyond what the executed contracts cover.
      const issues = await consistencyFor(c.tx, d.id);
      const contracted = (await c.tx.select({ amount: contracts.amount }).from(contracts).where(and(eq(contracts.requestId, d.id), eq(contracts.status, "signed")))).reduce((s, x) => s + Number(x.amount ?? 0), 0);
      const invoiced = invs.filter((i) => PAYABLE_KINDS.includes(i.kind) && i.status !== "void").reduce((s, i) => s + Number(i.subtotal) - Number(i.discount), 0);
      if (round2(invoiced + amountNet) - round2(contracted) > 0.009) throw new UserError("الفاتورة تتجاوز قيمة العقود النافذة.");
      if (issues.some((x) => x.level === "error")) throw new UserError(`عدم اتساق يمنع الفوترة: ${issues.filter((x) => x.level === "error").map((x) => x.text).join(" ")}`);
    } else {
      // Legacy: requests priced before versioned quotes.
      const hasQuotes = (await c.tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.requestId, d.id)).limit(1)).length > 0;
      if (hasQuotes) throw new UserError("اختر العرض والدفعة المراد فوترتها.");
      const existing = await c.tx.select({ id: invoices.id, number: invoices.number }).from(invoices).where(and(eq(invoices.requestId, d.id), inArray(invoices.status, ["draft", "approved", "issued", "partially_paid", "paid"]), inArray(invoices.kind, PAYABLE_KINDS)));
      if (existing.length) throw new UserError(`للطلب فاتورة قائمة (${existing[0].number}).`);
      const cs = await contractState(c.tx, d.id);
      if (cs.contract && !cs.clientSigned) throw new UserError("لم يوقّع العميل العقد بعد.");
      amountNet = Number(cs.contract?.amount ?? rc.req.agreedPrice ?? rc.req.quoteAmount ?? 0);
      if (!(amountNet > 0)) throw new UserError("لا يوجد مبلغ متفق عليه.");
      vatRate = policy.kind === "non_tax_invoice" ? 0 : await vatRateSetting(c.tx);
      contractId = cs.contract?.id ?? null;
      line = `${rc.service.nameAr} — طلب ${rc.req.number}`;
    }

    const t = computeInvoice(amountNet, vatRate);
    // A draft: numbered as a draft, invisible to the client (RLS), not sent, not reported. The legal number, the issue
    // date and the e-invoicing status are set when it is approved and sent (see approveInvoice / sendInvoice).
    const number = await nextNumber(c.tx, "DRF");
    const [row] = await c.tx.insert(invoices).values({
      number, userId: rc.req.requesterUserId, waqfId: rc.req.waqfId, billedToName: buyer.name, requestId: d.id, contractId, quoteId,
      installmentKey: termKey, installmentLabel: termLabel, kind: policy.kind,
      subtotal: t.subtotal.toFixed(2), discount: "0", vatRate: String(vatRate), vat: t.vat.toFixed(2), total: t.total.toFixed(2), status: "draft",
      issuedOn: today, dueOn: policy.kind === "proforma" ? null : addDays(today, dueDays),
      einvoiceStatus: "not_applicable",
      sellerSnapshot: sellerSnapshot(company), buyerSnapshot: buyer,
      lines: [{ description: line, qty: 1, unit: t.subtotal, total: t.subtotal }], createdBy: c.auth.user.id,
    }).returning({ id: invoices.id });
    const kindLabel = INVOICE_KIND_LABEL[policy.kind];
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.invoice_draft", entityType: "invoice", entityId: row.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { draft: number, kind: policy.kind, ...t, vatRate, quoteId, termKey, gaps: policy.gaps } });
    return {
      ok: true,
      message: `أُعدّت مسودة ${kindLabel} (${number}) بإجمالي ${fmtSAR(t.total)}. عاينها ثم تُعتمد وتُرسل؛ لا يراها العميل قبل الإرسال.${policy.kind === "proforma" ? ` الفاتورة الأولية لا تُسدد. ينقص في بيانات الشركة: ${policy.gaps.join("، ")}.` : ""}`,
      data: { invoiceId: row.id },
    };
  }, { revalidate: [`/admin/requests/${d.id}`, `/app/requests/${d.id}`, "/app/billing", "/admin/finance"] });
}

// ───────────────────────── Request invoices: draft → approve → send ─────────────────────────

const invIdSchema = z.object({ invoiceId: uuid, note: z.string().trim().max(500).optional().default("") });
const invRevalidate = (inv: { id: string; requestId: string | null }) => [`/admin/finance/${inv.id}`, "/admin/finance", `/app/billing/${inv.id}`, "/app/billing", ...(inv.requestId ? [`/admin/requests/${inv.requestId}`, `/app/requests/${inv.requestId}`] : [])];

async function requestWorker(c: Ctx, inv: typeof invoices.$inferSelect) {
  if (!inv.requestId) return false;
  const rc = await loadRequestCtx(c.tx, c.auth, inv.requestId, "staff").catch(() => null);
  return !!rc && (rc.isAssignee || rc.isOps);
}

/** Finance approval of a draft: assigns the legal number. The preparer may approve only as an authorized finance user (recorded). */
export async function approveInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(invIdSchema, fd);
  if ("state" in r) return r.state;
  let reval: string[] = [];
  const res = await userAction(async (c) => {
    if (!c.auth.isStaff || !c.auth.perms.has("admin.finance")) throw new ForbiddenError("اعتماد الفواتير لمن يملك صلاحية المالية.");
    const inv = await loadInvoice(c.tx, r.data.invoiceId);
    if (!inv) throw new UserError("الفاتورة غير موجودة.");
    reval = invRevalidate(inv);
    if (inv.status !== "draft") throw new UserError(inv.status === "approved" ? "الفاتورة معتمدة مسبقًا وبانتظار الإرسال." : "تُعتمد المسودة فقط.");
    // the company's statutory data is checked again when the legal number is assigned (it may have changed since the draft)
    if (inv.kind === "tax_invoice" || inv.kind === "non_tax_invoice") {
      const now = invoicePolicy(await companyProfile(c.tx));
      if (now.kind !== inv.kind) throw new UserError(`لا تُعتمد ${INVOICE_KIND_LABEL[inv.kind as "tax_invoice"]}: ${now.gaps.length ? `ينقص في بيانات الشركة: ${now.gaps.join("، ")}` : "تغيّرت حالة التسجيل الضريبي للشركة منذ إعداد المسودة"}. استكمل الإعدادات أو ألغِ المسودة وأعدّها من جديد.`);
    }
    const number = await nextNumber(c.tx, inv.kind === "proforma" ? "PRF" : "INV");
    const self = inv.createdBy === c.auth.user.id;
    await c.tx.update(invoices).set({ number, status: "approved", approvedAt: new Date(), approvedBy: c.auth.user.id, selfApproved: self, updatedBy: c.auth.user.id }).where(and(eq(invoices.id, inv.id), eq(invoices.status, "draft")));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.invoice_approve", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { number: inv.number, status: "draft" }, after: { number, status: "approved", selfApproved: self, note: r.data.note || undefined } });
    return { ok: true, message: `اعتُمدت الفاتورة برقم ${number}${self ? " (اعتماد ذاتي مسجل)" : ""}. لم تُرسل بعد.` };
  });
  for (const p of reval) revalidatePath(p);
  return res;
}

/**
 * Sends an approved invoice: it becomes visible to the client (issued), its issue and due dates are set to the sending
 * date, e-invoicing is queued for a tax invoice, and the client is notified. A failure to notify is recorded on the
 * invoice (sendResult) and the invoice stays approved and unsent, so sending can be retried — nothing is reported as sent
 * unless it was.
 */
export async function sendInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(invIdSchema, fd);
  if ("state" in r) return r.state;
  let reval: string[] = [];
  const res = await userAction(async (c) => {
    const inv = await loadInvoice(c.tx, r.data.invoiceId);
    if (!inv) throw new UserError("الفاتورة غير موجودة.");
    reval = invRevalidate(inv);
    if (!c.auth.isStaff || !(c.auth.perms.has("admin.finance") || (await requestWorker(c, inv)))) throw new ForbiddenError();
    if (inv.status !== "approved") throw new UserError(inv.status === "draft" ? "اعتمد الفاتورة قبل إرسالها." : "الفاتورة ليست بانتظار الإرسال.");
    const [tpl] = await c.tx.select({ key: notificationTemplates.key }).from(notificationTemplates).where(eq(notificationTemplates.key, "request.awaiting_client")).limit(1);
    const at = new Date().toISOString();
    if (!tpl) {
      await c.tx.update(invoices).set({ sendResult: { ok: false, at, error: "قالب الإشعار غير موجود في الإعدادات" }, updatedBy: c.auth.user.id }).where(eq(invoices.id, inv.id));
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.invoice_send_failed", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, after: { error: "template missing" } });
      return { error: "تعذر الإرسال: قالب إشعار الفواتير غير موجود في الإعدادات. بقيت الفاتورة معتمدة غير مرسلة؛ أعد المحاولة بعد ضبط القالب." };
    }
    const today = todayISO();
    const dueDays = await settingNumber(c.tx, "invoices.due_days", 14);
    const zatca = (await einvoiceState(c.tx)).active;
    const [client] = await c.tx.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, inv.userId));
    const kindLabel = INVOICE_KIND_LABEL[inv.kind as keyof typeof INVOICE_KIND_LABEL] ?? "فاتورة";
    await c.tx.update(invoices).set({
      status: "issued", issuedOn: today, dueOn: inv.kind === "proforma" ? null : addDays(today, dueDays), sentAt: new Date(), sentBy: c.auth.user.id,
      einvoiceStatus: inv.kind === "tax_invoice" ? (zatca ? "queued" : "pending") : "not_applicable",
      sendResult: { ok: true, at, channels: { in_app: "delivered", email: client?.email ? "according to preferences" : "no email", sms: client?.phone ? "according to preferences" : "no phone" } },
      updatedBy: c.auth.user.id,
    }).where(and(eq(invoices.id, inv.id), eq(invoices.status, "approved")));
    if (inv.requestId) {
      const [req] = await c.tx.select().from(serviceRequests).where(eq(serviceRequests.id, inv.requestId));
      if (req) await logEvent(c.tx, req, c.auth.user.id, `صدرت ${kindLabel} ${inv.number}${inv.installmentLabel ? ` لدفعة «${inv.installmentLabel}»` : ""} بإجمالي ${fmtSAR(inv.total)}`);
      // the installment's mandatory finance task is done once its invoice is sent
      if (inv.quoteId && inv.installmentKey) {
        const [row] = await c.tx.select({ id: paymentSchedule.id }).from(paymentSchedule).where(and(eq(paymentSchedule.quoteId, inv.quoteId), eq(paymentSchedule.termKey, inv.installmentKey))).limit(1);
        if (row) await closeFinanceTask(c.tx, inv.requestId, row.id, c.auth.user.id, inv.number);
      }
    }
    await notify(inv.userId, "request.awaiting_client", { number: inv.number, note: `صدرت ${kindLabel} ${inv.number} بمبلغ ${fmtSAR(inv.total)}` }, { waqfId: inv.waqfId, link: `/app/billing/${inv.id}`, tx: c.tx });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.invoice_issue", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: "approved" }, after: { number: inv.number, status: "issued", sent: true } });
    return { ok: true, message: `أُرسلت ${kindLabel} ${inv.number} إلى العميل.` };
  });
  for (const p of reval) revalidatePath(p);
  return res;
}

const draftEditSchema = z.object({
  invoiceId: uuid,
  billedToName: z.string().trim().min(2, "اكتب اسم المفوتر له.").max(200),
  description: z.string().trim().min(5, "اكتب وصف البند.").max(500),
  dueDays: z.coerce.number().int().min(0).max(120),
});

/** Corrects what may be corrected on a draft (buyer name, line wording, due period). Amounts come from the accepted quote. */
export async function updateInvoiceDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(draftEditSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let reval: string[] = [];
  const res = await userAction(async (c) => {
    const inv = await loadInvoice(c.tx, d.invoiceId);
    if (!inv) throw new UserError("الفاتورة غير موجودة.");
    reval = invRevalidate(inv);
    if (!c.auth.isStaff || !(c.auth.perms.has("admin.finance") || (await requestWorker(c, inv)))) throw new ForbiddenError();
    if (inv.status !== "draft") throw new UserError("تُعدّل المسودة فقط؛ الفاتورة المعتمدة أو المرسلة تُصحح بإلغائها أو بإشعار دائن.");
    const lines = inv.lines.map((l, i) => (i === 0 ? { ...l, description: d.description } : l));
    const buyer = { ...((inv.buyerSnapshot as Record<string, string> | null) ?? {}), name: d.billedToName };
    await c.tx.update(invoices).set({ billedToName: d.billedToName, buyerSnapshot: buyer, lines, dueOn: inv.kind === "proforma" ? null : addDays(todayISO(), d.dueDays), updatedBy: c.auth.user.id }).where(eq(invoices.id, inv.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.invoice_draft_edit", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { billedToName: inv.billedToName, description: inv.lines[0]?.description, dueOn: inv.dueOn }, after: { billedToName: d.billedToName, description: d.description, dueDays: d.dueDays } });
    return { ok: true, message: "حُفظ تصحيح المسودة." };
  });
  for (const p of reval) revalidatePath(p);
  return res;
}

/** Withdraws a draft or an approved, unsent invoice: kept as void with the reason (never deleted). */
export async function discardInvoiceDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(invIdSchema, fd);
  if ("state" in r) return r.state;
  if (r.data.note.length < 5) return { error: "اكتب سبب سحب المسودة.", fieldErrors: { note: "اكتب السبب (5 أحرف على الأقل)." } };
  let reval: string[] = [];
  const res = await userAction(async (c) => {
    const inv = await loadInvoice(c.tx, r.data.invoiceId);
    if (!inv) throw new UserError("الفاتورة غير موجودة.");
    reval = invRevalidate(inv);
    if (!c.auth.isStaff || !(c.auth.perms.has("admin.finance") || (await requestWorker(c, inv)))) throw new ForbiddenError();
    if (!["draft", "approved"].includes(inv.status)) throw new UserError("الفاتورة المرسلة تُلغى من صفحة المالية (إلغاء أو إشعار دائن).");
    await c.tx.update(invoices).set({ status: "void", updatedBy: c.auth.user.id }).where(eq(invoices.id, inv.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.invoice_withdraw", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: inv.status, number: inv.number }, after: { status: "void", reason: r.data.note } });
    return { ok: true, message: "سُحبت المسودة ولم تُرسل للعميل. بقيت في السجل ملغاة." };
  });
  for (const p of reval) revalidatePath(p);
  return res;
}

/** Client: starts a checkout for the remaining balance with the configured gateway and redirects to it. */
export async function startCheckout(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("invoiceId") ?? "");
  if (!uuid.safeParse(id).success) return { error: "فاتورة غير صالحة." };
  let url = "";
  const res = await userAction(async (c) => {
    const inv = await loadInvoice(c.tx, id);
    if (!inv || !(await canPayInvoice(c.tx, c.auth, inv))) throw new ForbiddenError("لا تملك صلاحية سداد هذه الفاتورة.");
    if (!PAYABLE_KINDS.includes(inv.kind)) throw new UserError("هذا المستند لا يُسدد (فاتورة أولية أو إشعار دائن).");
    if (!["issued", "partially_paid"].includes(inv.status)) throw new UserError(inv.status === "paid" ? "الفاتورة مدفوعة." : "الفاتورة غير قابلة للسداد.");
    const pays = await c.tx.select().from(payments).where(eq(payments.invoiceId, inv.id));
    const { balance } = invoiceBalance(inv, pays);
    if (!(balance > 0)) throw new UserError("لا رصيد مستحق على الفاتورة.");
    let provider;
    try {
      provider = paymentProvider(await isFlagOn(c.tx, "payments.live"));
    } catch {
      throw new UserError("السداد متاح حاليًا بالتحويل البنكي؛ أرسل الإيصال عبر رسائل الطلب.");
    }
    const amount = balance.toFixed(2);
    const [p] = await c.tx.insert(payments).values({ invoiceId: inv.id, userId: c.auth.user.id, provider: provider.name, amount, status: "initiated", createdBy: c.auth.user.id }).returning({ id: payments.id });
    const co = await provider.createCheckout({ invoiceId: inv.id, paymentId: p.id, amount, currency: inv.currency, description: `فاتورة ${inv.number}` });
    await c.tx.update(payments).set({ providerRef: co.providerRef }).where(eq(payments.id, p.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.checkout", entityType: "payment", entityId: p.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, after: { invoice: inv.number, provider: provider.name, amount } });
    url = co.url;
  });
  if (res.error) return res;
  redirect(url);
}

/** Applies a confirmed payment to its invoice: receipt number, partial or full status, request log. */
async function applyPayment(c: Ctx, inv: typeof invoices.$inferSelect, paymentId: string, paidOn: string, note: string) {
  const pays = await c.tx.select().from(payments).where(eq(payments.invoiceId, inv.id));
  const { total, paid } = invoiceBalance(inv, pays);
  const status = statusAfterPayment(total, paid);
  const receipt = await nextNumber(c.tx, "RCT");
  await c.tx.update(payments).set({ receiptNumber: receipt }).where(eq(payments.id, paymentId));
  await c.tx.update(invoices).set({ status, paidOn: status === "paid" ? paidOn : null, updatedBy: c.auth.user.id }).where(eq(invoices.id, inv.id));
  if (inv.requestId) {
    const [req] = await c.tx.select().from(serviceRequests).where(eq(serviceRequests.id, inv.requestId));
    if (req) {
      await logEvent(c.tx, req, c.auth.user.id, `${note} على الفاتورة ${inv.number} — الإيصال ${receipt}${status === "paid" ? " — سُددت كاملة" : ` — المتبقي ${fmtSAR(total - paid)}`}`);
      if (req.assignedToUserId) await notify(req.assignedToUserId, "request.status", { number: req.number, status: `${note} على الفاتورة ${inv.number}` }, { waqfId: req.waqfId, link: `/admin/requests/${req.id}`, tx: c.tx });
      if (req.requesterUserId !== c.auth.user.id) await notify(req.requesterUserId, "request.status", { number: req.number, status: `سُجّل سداد على الفاتورة ${inv.number} — الإيصال ${receipt}` }, { waqfId: req.waqfId, link: `/app/billing/${inv.id}`, tx: c.tx });
    }
  }
  return { status, receipt, remaining: round2(total - paid) };
}

const confirmSchema = z.object({
  invoiceId: uuid,
  paymentId: uuid,
  card: z.string().trim().min(12, "أدخل رقم البطاقة التجريبية."),
  expiry: z.string().trim().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, "الصيغة: شهر/سنة مثل 12/29"),
  cvc: z.string().trim().regex(/^\d{3}$/, "3 أرقام."),
});

/** Sandbox gateway confirmation: verifies the test card, then applies the payment. */
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
    if (!["issued", "partially_paid"].includes(inv.status) || !PAYABLE_KINDS.includes(inv.kind)) throw new UserError("الفاتورة غير قابلة للسداد.");
    const balance = invoiceBalance(inv, await c.tx.select().from(payments).where(eq(payments.invoiceId, inv.id))).balance;
    if (Number(p.amount) - balance > 0.009) throw new UserError("تغيّر الرصيد المستحق منذ بدء العملية. ابدأ عملية جديدة.");
    const provider = paymentProvider(false);
    const v = await provider.verify({ providerRef: p.providerRef ?? "", amount: p.amount, testCard: { number: d.card, expiry: d.expiry, cvc: d.cvc } });
    if (v.status !== "paid") {
      await c.tx.update(payments).set({ status: "failed", raw: v.raw ?? null }).where(eq(payments.id, p.id));
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.payment_failed", entityType: "payment", entityId: p.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent });
      return { error: "رُفضت البطاقة التجريبية. استخدم إحدى البطاقات المعروضة في الصفحة ثم ابدأ عملية جديدة." };
    }
    await c.tx.update(payments).set({ status: "paid", paidAt: new Date(), method: v.method, raw: v.raw ?? null }).where(eq(payments.id, p.id));
    const out = await applyPayment(c, inv, p.id, todayISO(), `سُدد ${fmtSAR(p.amount)} إلكترونيًا (بيئة تجريبية)`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.payment", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: inv.status }, after: { status: out.status, provider: "sandbox", paymentId: p.id, amount: p.amount, receipt: out.receipt } });
    ok = true;
  }, { revalidate: ["/app/billing", `/app/billing/${d.invoiceId}`, "/admin/finance"] });
  if (res.error || !ok) return res;
  redirect(`/app/billing/${d.invoiceId}?paid=1`);
}

// ───────────────────────── Admin finance ─────────────────────────

const paySchema = z.object({
  invoiceId: uuid,
  amount: z.coerce.number({ message: "أدخل المبلغ." }).positive("المبلغ أكبر من صفر."),
  method: z.enum(["transfer", "cash", "cheque"], { message: "اختر طريقة السداد." }).default("transfer"),
  reference: z.string().trim().min(4, "أدخل مرجع السداد (رقم التحويل أو الشيك أو سند القبض).").max(120),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "أدخل تاريخ السداد."),
});

/** Finance: records a received payment (full or partial) after checking the money arrived. */
export async function recordPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(paySchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const inv = await loadInvoice(c.tx, d.invoiceId);
    if (!inv) throw new UserError("الفاتورة غير موجودة.");
    if (!PAYABLE_KINDS.includes(inv.kind)) throw new UserError("لا تُسجل دفعات على فاتورة أولية أو إشعار دائن.");
    if (!["issued", "partially_paid"].includes(inv.status)) throw new UserError("تُسجل الدفعة على فاتورة مستحقة فقط.");
    if (d.paidOn > todayISO()) throw new UserError("تاريخ السداد لا يكون في المستقبل.");
    const { balance } = invoiceBalance(inv, await c.tx.select().from(payments).where(eq(payments.invoiceId, inv.id)));
    if (round2(d.amount) - balance > 0.009) throw new UserError(`المبلغ أكبر من الرصيد المستحق (${fmtSAR(balance)}).`);
    const [p] = await c.tx.insert(payments).values({
      invoiceId: inv.id, userId: inv.userId, provider: d.method === "transfer" ? "bank_transfer" : d.method, providerRef: d.reference, method: d.method, amount: round2(d.amount).toFixed(2), status: "paid",
      paidAt: new Date(`${d.paidOn}T12:00:00+03:00`), raw: { recordedBy: c.auth.user.id }, createdBy: c.auth.user.id,
    }).returning({ id: payments.id });
    const out = await applyPayment(c, inv, p.id, d.paidOn, `سُجّل سداد ${fmtSAR(d.amount)}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "billing.payment_recorded", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: inv.status }, after: { status: out.status, amount: d.amount, method: d.method, reference: d.reference, paidOn: d.paidOn, paymentId: p.id, receipt: out.receipt } });
    return { ok: true, message: out.status === "paid" ? `سُجّل السداد (الإيصال ${out.receipt}) وسُددت الفاتورة كاملة.` : `سُجّل السداد (الإيصال ${out.receipt}). المتبقي ${fmtSAR(out.remaining)}.` };
  }, { perm: "admin.finance", revalidate: ["/admin/finance", `/admin/finance/${d.invoiceId}`, `/app/billing/${d.invoiceId}`, "/app/billing"] });
}

const voidSchema = z.object({
  invoiceId: uuid,
  reason: z.string().trim().min(5, "اكتب سبب الإلغاء.").max(500),
  mode: z.enum(["void", "credit"]),
});

/**
 * Cancels an invoice: directly when nothing was paid on it, otherwise only with a credit note (the invoice itself is
 * never edited). Refunds of received money are recorded outside the platform and noted in the reason.
 */
export async function cancelInvoice(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(voidSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const inv = await loadInvoice(c.tx, d.invoiceId);
    if (!inv) throw new UserError("الفاتورة غير موجودة.");
    if (!["issued", "partially_paid", "paid"].includes(inv.status) || inv.kind === "credit_note") throw new UserError("الفاتورة ملغاة مسبقًا أو ليست فاتورة بيع.");
    const pays = await c.tx.select().from(payments).where(and(eq(payments.invoiceId, inv.id), eq(payments.status, "paid")));
    if (inv.kind === "proforma" && d.mode === "credit") throw new UserError("الفاتورة الأولية تُلغى مباشرة.");
    if (pays.length && d.mode !== "credit") throw new UserError("على الفاتورة دفعات: أصدر إشعارًا دائنًا بدل الإلغاء المباشر.");
    if (inv.kind === "tax_invoice" && d.mode !== "credit" && inv.einvoiceStatus !== "pending" && inv.einvoiceStatus !== "pending_integration")
      throw new UserError("أُرسلت الفاتورة إلى منصة الفوترة: تُلغى بإشعار دائن.");
    let creditNumber: string | null = null;
    if (d.mode === "credit") {
      creditNumber = await nextNumber(c.tx, "CRN");
      const neg = (v: string) => (-Number(v)).toFixed(2);
      await c.tx.insert(invoices).values({
        number: creditNumber, userId: inv.userId, waqfId: inv.waqfId, billedToName: inv.billedToName, requestId: inv.requestId, contractId: inv.contractId, quoteId: inv.quoteId,
        installmentKey: inv.installmentKey, installmentLabel: inv.installmentLabel, kind: "credit_note", creditOfId: inv.id,
        subtotal: neg(inv.subtotal), discount: "0", vatRate: inv.vatRate, vat: neg(inv.vat), total: neg(inv.total), status: "credit_note", issuedOn: todayISO(),
        einvoiceStatus: inv.kind === "tax_invoice" ? (inv.einvoiceStatus === "queued" ? "queued" : "pending") : "not_applicable",
        sellerSnapshot: inv.sellerSnapshot, buyerSnapshot: inv.buyerSnapshot,
        lines: [{ description: `إشعار دائن عن ${inv.number} — السبب: ${d.reason}`, qty: 1, unit: -Number(inv.subtotal), total: -Number(inv.subtotal) }], createdBy: c.auth.user.id,
      });
    }
    await c.tx.update(invoices).set({ status: "void", updatedBy: c.auth.user.id }).where(eq(invoices.id, inv.id));
    if (inv.requestId) {
      const [req] = await c.tx.select().from(serviceRequests).where(eq(serviceRequests.id, inv.requestId));
      if (req) await logEvent(c.tx, req, c.auth.user.id, `أُلغيت الفاتورة ${inv.number}${creditNumber ? ` بالإشعار الدائن ${creditNumber}` : ""}: ${d.reason}`);
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: d.mode === "credit" ? "billing.credit_note" : "billing.void", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: inv.status }, after: { status: "void", reason: d.reason, creditNote: creditNumber, paidBefore: pays.reduce((s, p) => s + Number(p.amount), 0) } });
    return { ok: true, message: creditNumber ? `أُلغيت الفاتورة وصدر الإشعار الدائن ${creditNumber}.${pays.length ? " سجّل رد المبلغ المدفوع خارج المنصة واذكره في سجل الطلب." : ""}` : "أُلغيت الفاتورة." };
  }, { perm: "admin.finance", revalidate: ["/admin/finance", `/admin/finance/${d.invoiceId}`, "/app/billing"] });
}
