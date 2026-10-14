/**
 * Quotes, contracts, invoices and payments: rules and arithmetic (PURE, client-safe, unit-tested).
 *
 * Contract formation follows نظام المعاملات المدنية: an offer lapses at the end of its stated period and an acceptance
 * after that does not form a contract (م36/1(د)، م36/2); an acceptance with a change is a rejection carrying a new offer
 * (م36/1(ب)); a valid contract is amended only by agreement (م94/1); a representative acts within the limits of the
 * instrument that grants the representation (م87–م90). E-invoicing and VAT handling here are operational safeguards
 * (no tax document without the seller's VAT data); they do not claim ZATCA certification.
 */
import { computeInvoice, round2 } from "@/server/modules/billing/calc";
import type { ContractParty, PaymentTerm, QuoteLine, QuoteStatus } from "@/server/db/schema/commerce";

// ───────────────────────── Quotes ─────────────────────────

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "مسودة (داخلية)",
  approved: "معتمد داخليًا — لم يُرسل",
  sent: "مرسل للعميل",
  accepted: "مقبول",
  rejected: "مرفوض",
  change_requested: "طلب العميل تعديله",
  expired: "انتهت صلاحيته",
  superseded: "استُبدل بنسخة أحدث",
  withdrawn: "سُحب",
};
export const QUOTE_STATUS_TONE: Record<QuoteStatus, "neutral" | "info" | "seal" | "ok" | "critical" | "fine" | "warn"> = {
  draft: "neutral", approved: "info", sent: "seal", accepted: "ok", rejected: "critical", change_requested: "fine", expired: "warn", superseded: "neutral", withdrawn: "neutral",
};

export const TERM_DUE_LABEL: Record<PaymentTerm["due"], string> = {
  on_contract: "عند توقيع العقد", before_start: "قبل بدء التنفيذ", on_delivery: "عند تسليم المخرجات", on_completion: "عند اكتمال الخدمة",
  on_date: "في تاريخ محدد", on_milestone: "عند إنجاز مرحلة أو فترة تعاقدية",
};

/** When an installment falls due, in words (shown to the client in the quote, the contract and the schedule). */
export function termWhen(t: Pick<PaymentTerm, "due" | "dueOn" | "milestone">) {
  if (t.due === "on_date" && t.dueOn) return `في ${t.dueOn}`;
  if (t.due === "on_milestone" && t.milestone) return `عند ${t.milestone}`;
  return TERM_DUE_LABEL[t.due] + (t.milestone ? ` (${t.milestone})` : "");
}

export type RecurringPlan = { count: number; every: "monthly" | "quarterly" | "semiannual" | "annual"; firstOn: string; percent: number; label: string };
const EVERY_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as const;
export const EVERY_AR = { monthly: "شهرية", quarterly: "ربع سنوية", semiannual: "نصف سنوية", annual: "سنوية" } as const;

/** A recurring plan as dated installments: `count` equal shares of `percent` (rounding goes to the last one). */
export function recurringTerms(p: RecurringPlan): { label: string; percent: number; due: "on_date"; dueOn: string; beforeStart: false; series: string }[] {
  if (!(p.count >= 1 && p.count <= 60) || !/^\d{4}-\d{2}-\d{2}$/.test(p.firstOn) || !(p.percent > 0 && p.percent <= 100)) return [];
  const each = Math.floor((p.percent / p.count) * 100) / 100;
  const out = [];
  for (let i = 0; i < p.count; i++) {
    const [y, m, d] = p.firstOn.split("-").map(Number);
    const total = m - 1 + i * EVERY_MONTHS[p.every];
    const yy = y + Math.floor(total / 12);
    const mm = (total % 12) + 1;
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const dueOn = `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
    const percent = i === p.count - 1 ? round2(p.percent - each * (p.count - 1)) : each;
    out.push({ label: `${p.label.trim() || "دفعة"} ${i + 1} من ${p.count}`, percent, due: "on_date" as const, dueOn, beforeStart: false as const, series: EVERY_AR[p.every] });
  }
  return out;
}

export type QuoteDraftInput = {
  lines: { description: string; qty: number; unit: number }[];
  discount: number;
  vatRate: number;
  terms: { label: string; percent: number; due: PaymentTerm["due"]; beforeStart: boolean; dueOn?: string | null; milestone?: string | null; series?: string | null }[];
  validUntil: string;
  today: string;
};

/** Validates and totals a quote. Returns errors (Arabic) or the computed lines, totals and terms. */
export function buildQuote(x: QuoteDraftInput):
  | { ok: false; errors: string[] }
  | { ok: true; lines: QuoteLine[]; subtotal: number; discount: number; net: number; vat: number; total: number; terms: PaymentTerm[] } {
  const errors: string[] = [];
  const lines = x.lines.filter((l) => l.description.trim() || l.unit);
  if (!lines.length) errors.push("أضف بندًا واحدًا على الأقل.");
  lines.forEach((l, i) => {
    if (!l.description.trim()) errors.push(`البند ${i + 1}: اكتب وصفه.`);
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) errors.push(`البند ${i + 1}: الكمية أكبر من صفر.`);
    if (!(l.unit >= 0) || !Number.isFinite(l.unit)) errors.push(`البند ${i + 1}: سعر الوحدة غير صالح.`);
  });
  const out: QuoteLine[] = lines.map((l) => ({ description: l.description.trim().slice(0, 300), qty: l.qty, unit: round2(l.unit), total: round2(l.qty * l.unit) }));
  const subtotal = round2(out.reduce((s, l) => s + l.total, 0));
  if (x.discount < 0 || x.discount > subtotal) errors.push("الخصم بين صفر ومجموع البنود.");
  if (!(x.vatRate >= 0 && x.vatRate <= 100)) errors.push("نسبة الضريبة غير مضبوطة في الإعدادات.");
  const t = computeInvoice(subtotal, x.vatRate, x.discount);
  if (!(t.net > 0)) errors.push("صافي العرض يجب أن يكون أكبر من صفر.");
  const terms = x.terms.filter((p) => p.label.trim() || p.percent);
  if (!terms.length) errors.push("حدّد شروط الدفع (دفعة واحدة على الأقل).");
  const sum = round2(terms.reduce((s, p) => s + p.percent, 0));
  if (terms.length && sum !== 100) errors.push(`مجموع نسب الدفعات ${sum}٪ ويجب أن يساوي 100٪.`);
  terms.forEach((p, i) => {
    if (!p.label.trim()) errors.push(`الدفعة ${i + 1}: اكتب وصفها.`);
    if (!(p.percent > 0)) errors.push(`الدفعة ${i + 1}: النسبة أكبر من صفر.`);
    if (p.due === "on_date" && !/^\d{4}-\d{2}-\d{2}$/.test(p.dueOn ?? "")) errors.push(`الدفعة ${i + 1}: حدّد تاريخ استحقاقها.`);
    else if (p.due === "on_date" && p.dueOn! < x.today) errors.push(`الدفعة ${i + 1}: تاريخ الاستحقاق لا يسبق اليوم.`);
    if (p.due === "on_milestone" && (p.milestone ?? "").trim().length < 3) errors.push(`الدفعة ${i + 1}: سمِّ المرحلة أو الفترة التي ترتبط بها.`);
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.validUntil) || x.validUntil < x.today) errors.push("تاريخ صلاحية العرض يجب ألا يسبق اليوم.");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true, lines: out, subtotal: t.subtotal, discount: t.discount, net: t.net, vat: t.vat, total: t.total,
    terms: terms.map((p, i) => ({
      key: `t${i + 1}`, label: p.label.trim().slice(0, 120), percent: p.percent, due: p.due, beforeStart: p.beforeStart || p.due === "before_start",
      ...(p.due === "on_date" ? { dueOn: p.dueOn } : {}),
      ...((p.milestone ?? "").trim() ? { milestone: p.milestone!.trim().slice(0, 160) } : {}),
      ...(p.series ? { series: p.series.slice(0, 40) } : {}),
    })),
  };
}

/** An offer whose validity ended can no longer be accepted (نظام المعاملات المدنية م36/1(د)، م36/2). */
export const quoteExpired = (q: { status: string; validUntil: string }, today: string) => q.status === "sent" && q.validUntil < today;

/** Display status: a sent quote past its validity shows as expired. */
export const quoteDisplayStatus = (q: { status: string; validUntil: string }, today: string): QuoteStatus => (quoteExpired(q, today) ? "expired" : (q.status as QuoteStatus));

/**
 * Splits a net amount into installments by percentage; VAT follows each installment. Rounding differences go to the
 * last installment so the installments always add up to the quote exactly.
 */
export function splitInstallments(net: number, vatRate: number, terms: PaymentTerm[]) {
  const totalVat = computeInvoice(net, vatRate).vat;
  let restNet = round2(net);
  let restVat = totalVat;
  return terms.map((t, i) => {
    const last = i === terms.length - 1;
    const n = last ? restNet : round2((net * t.percent) / 100);
    const v = last ? restVat : round2((n * vatRate) / 100);
    restNet = round2(restNet - n);
    restVat = round2(restVat - v);
    return { ...t, net: n, vat: v, total: round2(n + v) };
  });
}

/** Canonical text of a quote, hashed when it is sent (what the client saw and accepted). */
export type DeliverySchedule = { cadence: string; customDates?: { label: string; due: string }[] } | null;
const DELIVERY_AR: Record<string, string> = { monthly: "شهرية", quarterly: "ربع سنوية", semiannual: "نصف سنوية", annual: "سنوية", event: "بحسب الحدث (اجتماع أو دفعة)", custom: "تواريخ أو مراحل محددة" };
/** Delivery cadence agreed in a quote, in words (continuous services). */
export function deliveryScheduleText(d: DeliverySchedule) {
  if (!d?.cadence) return null;
  const base = `دورية التسليمات: ${DELIVERY_AR[d.cadence] ?? d.cadence}`;
  return d.cadence === "custom" && d.customDates?.length ? `${base} — ${d.customDates.map((x) => `${x.label} (${x.due})`).join("، ")}` : base;
}

export function quoteCanonical(q: { number: string; version: number; scope: string; deliverables?: string | null; exclusions?: string | null; assumptions?: string | null; clientObligations?: string | null; durationDays?: number | null; lines: QuoteLine[]; subtotal: string | number; discount: string | number; net: string | number; vatRate: string | number; vat: string | number; total: string | number; paymentTerms: PaymentTerm[]; validUntil: string; deliverySchedule?: DeliverySchedule }) {
  return JSON.stringify({
    // Present only when the quote fixes a delivery cadence (keeps the hash of earlier quotes unchanged).
    ...(q.deliverySchedule?.cadence ? { deliverySchedule: q.deliverySchedule } : {}),
    number: q.number, version: q.version, scope: q.scope, deliverables: q.deliverables ?? "", exclusions: q.exclusions ?? "", assumptions: q.assumptions ?? "",
    clientObligations: q.clientObligations ?? "", durationDays: q.durationDays ?? null, lines: q.lines, subtotal: Number(q.subtotal).toFixed(2),
    discount: Number(q.discount).toFixed(2), net: Number(q.net).toFixed(2), vatRate: Number(q.vatRate).toFixed(2), vat: Number(q.vat).toFixed(2),
    total: Number(q.total).toFixed(2), terms: q.paymentTerms, validUntil: q.validUntil,
  });
}

// ───────────────────────── Company & seller data ─────────────────────────

export type CompanyProfile = Partial<Record<
  "nameAr" | "nameEn" | "legalForm" | "crNumber" | "unifiedNumber" | "vatRegistration" | "vatNumber" | "nationalAddress" | "signatoryName" | "signatoryTitle" | "bankName" | "iban" | "phone" | "email" | "website",
  string
>>;

const has = (v?: string | null) => !!v && !!v.trim();

/** Company data a contract needs (no placeholders are ever printed in their place). */
export function contractCompanyGaps(c: CompanyProfile): string[] {
  const g: string[] = [];
  if (!has(c.nameAr)) g.push("الاسم التجاري");
  if (!has(c.crNumber) && !has(c.unifiedNumber)) g.push("رقم السجل التجاري أو الرقم الوطني الموحد");
  if (!has(c.nationalAddress)) g.push("العنوان الوطني");
  if (!has(c.signatoryName)) g.push("اسم المفوّض بالتوقيع");
  if (!has(c.signatoryTitle)) g.push("صفة المفوّض بالتوقيع");
  return g;
}

export type InvoiceKind = "tax_invoice" | "non_tax_invoice" | "proforma" | "credit_note";

/**
 * Which invoice the company may issue now:
 * - tax_invoice: registered for VAT with a valid VAT number, legal name, CR/unified number and national address.
 * - non_tax_invoice: the admin declared the company not VAT-registered (no VAT is charged).
 * - proforma: anything missing — a non-tax, non-payable document that says what is missing.
 */
export function invoicePolicy(c: CompanyProfile): { kind: Exclude<InvoiceKind, "credit_note">; gaps: string[] } {
  const base: string[] = [];
  if (!has(c.nameAr)) base.push("الاسم التجاري");
  if (!has(c.crNumber) && !has(c.unifiedNumber)) base.push("رقم السجل التجاري أو الرقم الوطني الموحد");
  if (!has(c.nationalAddress)) base.push("العنوان الوطني");
  if (c.vatRegistration === "registered") {
    const gaps = [...base];
    if (!/^3\d{13}3$/.test(c.vatNumber ?? "")) gaps.push("الرقم الضريبي الصحيح (15 رقمًا يبدأ وينتهي بالرقم 3)");
    return gaps.length ? { kind: "proforma", gaps } : { kind: "tax_invoice", gaps: [] };
  }
  if (c.vatRegistration === "not_registered") return base.length ? { kind: "proforma", gaps: base } : { kind: "non_tax_invoice", gaps: [] };
  return { kind: "proforma", gaps: [...base, "حالة التسجيل في ضريبة القيمة المضافة"] };
}

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  tax_invoice: "فاتورة ضريبية",
  non_tax_invoice: "فاتورة (المنشأة غير مسجلة في ضريبة القيمة المضافة)",
  proforma: "فاتورة أولية — ليست فاتورة ضريبية",
  credit_note: "إشعار دائن",
};

// ───────────────────────── Contract parties ─────────────────────────

export const AUTHORITY_LABEL: Record<ContractParty["authorityType"], string> = {
  self: "أصالة عن نفسه", agent: "وكيلًا بموجب وكالة", nazir: "بصفته ناظر الوقف", board: "بتفويض من مجلس النظارة", legal_rep: "ممثلًا نظاميًا للجهة", company_signatory: "المفوّض بالتوقيع عن الشركة",
};

/** Checks the parties of a contract before it is approved. */
export function validateParties(parties: ContractParty[]): string[] {
  const e: string[] = [];
  const client = parties.filter((p) => p.side === "client");
  const company = parties.filter((p) => p.side === "company");
  if (!client.length) e.push("أضف طرف العميل.");
  if (company.length !== 1) e.push("يلزم طرف واحد عن «وقفك».");
  for (const p of parties) {
    if (!has(p.name)) e.push("اسم الطرف مطلوب.");
    if (!has(p.signerName)) e.push(`اسم الموقّع عن «${p.name || "الطرف"}» مطلوب.`);
    if (p.side === "client" && p.required && !p.signerUserId) e.push(`حدّد حساب الموقّع عن «${p.name}» في المنصة.`);
    if (["agent", "board", "legal_rep", "nazir"].includes(p.authorityType) && !has(p.authorityRef)) e.push(`سند صفة «${p.signerName || p.name}» مطلوب (رقم الوكالة أو القرار أو صك النظارة).`);
    if (p.authorityType === "agent" && !p.authorityDocumentId) e.push(`أرفق الوكالة التي يوقّع بها «${p.signerName}».`);
  }
  const keys = parties.map((p) => p.key);
  if (new Set(keys).size !== keys.length) e.push("تكرر طرف في العقد.");
  return [...new Set(e)];
}

/** Required parties that have not signed yet. */
export function pendingParties(parties: ContractParty[], signedKeys: string[]) {
  return parties.filter((p) => p.required && !signedKeys.includes(p.key));
}

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "مسودة", approved: "معتمد داخليًا — لم يُرسل", sent: "مرسل للتوقيع", partially_signed: "وقّعه بعض الأطراف", signed: "نافذ — وقّعه جميع الأطراف", void: "ملغى",
};

// ───────────────────────── Payments ─────────────────────────

export function invoiceBalance(inv: { total: string | number; status: string }, payments: { amount: string | number; status: string }[]) {
  const paid = round2(payments.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0));
  const total = round2(Number(inv.total));
  return { total, paid, balance: round2(Math.max(0, total - paid)) };
}

/** Status after a payment: partially_paid until the balance reaches zero. */
export function statusAfterPayment(total: number, paidAfter: number): "paid" | "partially_paid" {
  return round2(paidAfter) >= round2(total) ? "paid" : "partially_paid";
}

// ───────────────────────── Consistency ─────────────────────────

export type ConsistencyInput = {
  acceptedQuotes: { id: string; number: string; version: number; kind: string; net: number; total: number; vatRate: number; terms: PaymentTerm[] }[];
  contracts: { id: string; number: string; status: string; quoteId: string | null; amount: number; parentContractId: string | null }[];
  invoices: { id: string; number: string; kind: string; status: string; quoteId: string | null; contractId: string | null; installmentKey: string | null; subtotal: number; discount: number; vat: number; total: number; creditOfId: string | null }[];
  payments: { invoiceId: string; amount: number; status: string }[];
  serviceCodeOfQuotes?: string;
  agreedPrice: number | null;
};

export type ConsistencyIssue = { level: "error" | "warn"; text: string };

/**
 * Cross-checks scope → quote → contract → invoices → payments. Returns issues; an empty list means consistent.
 * Used on the staff request page and before issuing an invoice.
 */
export function checkConsistency(x: ConsistencyInput): ConsistencyIssue[] {
  const out: ConsistencyIssue[] = [];
  const initial = x.acceptedQuotes.filter((q) => q.kind === "initial");
  if (initial.length > 1) out.push({ level: "error", text: "أكثر من عرض أولي مقبول للطلب نفسه." });
  const live = x.contracts.filter((c) => c.status === "signed");
  for (const c of live) {
    const q = x.acceptedQuotes.find((a) => a.id === c.quoteId);
    if (!q && c.quoteId) out.push({ level: "error", text: `العقد ${c.number} مبني على عرض غير مقبول.` });
    if (q && Math.abs(q.net - c.amount) > 0.009) out.push({ level: "error", text: `مبلغ العقد ${c.number} (${c.amount}) لا يطابق صافي العرض ${q.number} v${q.version} (${q.net}).` });
  }
  const contracted = round2(live.reduce((s, c) => s + c.amount, 0));
  const q0 = initial[0];
  if (q0 && x.agreedPrice !== null && Math.abs(x.agreedPrice - q0.net) > 0.009 && !x.acceptedQuotes.some((q) => q.kind === "amendment"))
    out.push({ level: "warn", text: `السعر المتفق عليه في الطلب (${x.agreedPrice}) يختلف عن صافي العرض المقبول (${q0.net}).` });
  const sales = x.invoices.filter((i) => i.kind !== "credit_note" && i.kind !== "proforma" && i.status !== "void");
  const credits = x.invoices.filter((i) => i.kind === "credit_note" || i.status === "credit_note");
  const invoicedNet = round2(sales.reduce((s, i) => s + (i.subtotal - i.discount), 0) + credits.filter((c) => !sales.some((s) => s.id === c.creditOfId)).reduce((s, c) => s + (c.subtotal - c.discount), 0));
  if (live.length && invoicedNet - contracted > 0.009) out.push({ level: "error", text: `المفوتر (${invoicedNet}) يتجاوز قيمة العقود النافذة (${contracted}).` });
  if (!live.length && sales.some((i) => i.contractId)) out.push({ level: "error", text: "فاتورة مرتبطة بعقد غير نافذ." });
  const keys = sales.map((i) => `${i.quoteId}:${i.installmentKey}`).filter((k) => !k.endsWith(":null"));
  if (new Set(keys).size !== keys.length) out.push({ level: "error", text: "دفعة واحدة من العرض فُوترت أكثر من مرة." });
  for (const inv of x.invoices) {
    const paid = round2(x.payments.filter((p) => p.invoiceId === inv.id && p.status === "paid").reduce((s, p) => s + p.amount, 0));
    if (paid - inv.total > 0.009 && inv.kind !== "credit_note") out.push({ level: "error", text: `المدفوع على ${inv.number} (${paid}) يتجاوز إجماليها (${inv.total}).` });
    if (inv.kind === "proforma" && paid > 0) out.push({ level: "error", text: `سُجلت دفعة على الفاتورة الأولية ${inv.number}.` });
  }
  return out;
}
