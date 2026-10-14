import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import { withContext } from "@/server/db";
import { contracts, contractSignatures, invoices, payments, quotes, users } from "@/server/db/schema";
import type { ContractParty, PaymentTerm, QuoteLine } from "@/server/db/schema/commerce";
import { getAuth } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { pdfShell, renderPdf } from "@/server/modules/pdf/render";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { canSeeInvoice } from "@/server/modules/billing/access";
import { zatcaTlvBase64 } from "@/server/modules/billing/calc";
import { AUTHORITY_LABEL, CONTRACT_STATUS_LABEL, INVOICE_KIND_LABEL, invoiceBalance, splitInstallments, termWhen, type CompanyProfile } from "./pure";

/**
 * PDF documents of the commercial chain: quote, contract (with signature evidence), invoice and payment receipt.
 * Each is rendered from the stored record (never recomputed from current settings) and every download is audited.
 */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const sar = (n: number | string) => `${Number(n).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
const dt = (d: Date | string | null | undefined) => (d ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { dateStyle: "long", timeStyle: typeof d === "string" ? undefined : "short", timeZone: "Asia/Riyadh" }).format(typeof d === "string" ? new Date(`${d}T12:00:00+03:00`) : d) : "—");
const UUID = /^[0-9a-f-]{36}$/i;

export const fail = (status: number, msg: string) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function pdfResponse(title: string, html: string, name: string) {
  let body: Buffer;
  try {
    body = await renderPdf(pdfShell(title, html), { headerTitle: title });
  } catch (err) {
    console.error("[commerce.pdf] render failed", err);
    return fail(503, "تعذر إنشاء ملف PDF الآن. أعد المحاولة بعد قليل.");
  }
  return new Response(new Uint8Array(body), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}

/** Markdown subset used by contract bodies (#, ##, **bold**, ---, "- " lists). */
function mdToHtml(body: string) {
  const bold = (t: string) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return body.split("\n").map((line) => {
    if (line.startsWith("# ")) return `<h1 style="font-size:16pt;text-align:center">${bold(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h3>${bold(line.slice(3))}</h3>`;
    if (line.trim() === "---") return `<hr style="border:0;border-top:1px solid #dadfd6;margin:10px 0">`;
    if (line.startsWith("- ")) return `<p style="margin:0 0 .3em;padding-inline-start:1em">• ${bold(line.slice(2))}</p>`;
    if (!line.trim()) return "";
    return `<p>${bold(line)}</p>`;
  }).join("\n");
}

async function auth0() {
  const auth = await getAuth();
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified)) return null;
  return auth;
}

// ───────────────────────── Quote ─────────────────────────

export async function quotePdf(requestId: string, quoteId: string) {
  if (!UUID.test(requestId) || !UUID.test(quoteId)) return fail(404, "غير موجود");
  const auth = await auth0();
  if (!auth) return fail(401, "سجّل الدخول ثم أعد المحاولة.");
  const { ip, userAgent } = await requestInfo();
  const out = await withContext(auth.db, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, requestId, "any");
    } catch {
      return null;
    }
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.requestId, requestId))).limit(1);
    if (!q) return null;
    if (!rc.staffSide && ["draft", "approved"].includes(q.status)) return null;
    await audit(tx, { actorUserId: auth.user.id, action: "quotes.download", entityType: "quote", entityId: q.id, waqfId: q.waqfId, ip, userAgent, after: { number: q.number, version: q.version } });
    const lines = (q.lines as QuoteLine[]).map((l) => `<tr><td>${esc(l.description)}</td><td class="tabular">${l.qty}</td><td class="tabular">${sar(l.unit)}</td><td class="tabular">${sar(l.total)}</td></tr>`).join("");
    const terms = splitInstallments(Number(q.net), Number(q.vatRate), q.paymentTerms as PaymentTerm[]).map((t) => `<tr><td>${esc(t.label)}</td><td class="tabular">${t.percent}٪</td><td class="tabular">${sar(t.total)}</td><td>${esc(termWhen(t))}${t.beforeStart ? " — شرط للبدء" : ""}</td></tr>`).join("");
    const sec = (title: string, v: string | null) => (v ? `<h3>${title}</h3><p class="doc" style="white-space:pre-line">${esc(v)}</p>` : "");
    const html = `<div class="brandbar"></div>
<h1>${q.kind === "amendment" ? "ملحق تعديل" : "عرض سعر"} ${esc(q.number)}</h1>
<dl class="kv small"><dt>النسخة</dt><dd>${q.version}</dd><dt>الطلب</dt><dd>${esc(rc.req.number)} — ${esc(rc.service.nameAr)}</dd><dt>صالح حتى</dt><dd>${dt(q.validUntil)}</dd>${q.sentAt ? `<dt>أُرسل</dt><dd>${dt(q.sentAt)}</dd>` : ""}</dl>
${["draft", "approved"].includes(q.status) ? `<div class="box critical">مسودة داخلية — لم تُرسل للعميل.</div>` : ""}
${sec("نطاق العمل", q.scope)}${sec("المخرجات", q.deliverables)}${sec("ما لا يشمله النطاق", q.exclusions)}${sec("الافتراضات", q.assumptions)}${sec("التزامات العميل", q.clientObligations)}
${q.durationDays ? `<p><strong>المدة:</strong> ${q.durationDays} يومًا من نفاذ العقد واكتمال ما يلزم من العميل.</p>` : ""}
<h3>البنود</h3><table><thead><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>المبلغ</th></tr></thead><tbody>${lines}</tbody></table>
<dl class="kv"><dt>المجموع</dt><dd class="tabular">${sar(q.subtotal)}</dd>${Number(q.discount) ? `<dt>الخصم</dt><dd class="tabular">${sar(q.discount)}</dd>` : ""}<dt>الصافي</dt><dd class="tabular">${sar(q.net)}</dd><dt>ضريبة القيمة المضافة (${Number(q.vatRate)}٪)</dt><dd class="tabular">${sar(q.vat)}</dd><dt>الإجمالي</dt><dd class="tabular"><strong>${sar(q.total)}</strong></dd></dl>
<h3>شروط الدفع</h3><table><thead><tr><th>الدفعة</th><th>النسبة</th><th>المبلغ</th><th>الاستحقاق</th></tr></thead><tbody>${terms}</tbody></table>
<p class="small muted">العرض صالح حتى التاريخ المذكور، ولا يُقبل بعده. وطلب تعديله يُعد رفضًا له مع طلب عرض جديد. ولا يُعد العرض عقدًا؛ يُبرم العقد بعد قبوله ويوقّعه الأطراف.</p>
${q.contentHash ? `<p class="small muted" dir="ltr">SHA-256: ${esc(q.contentHash)}</p>` : ""}`;
    return { html, title: `${q.kind === "amendment" ? "ملحق تعديل" : "عرض سعر"} ${q.number}`, name: `${q.number}-v${q.version}.pdf` };
  });
  if (!out) return fail(404, "المستند غير موجود أو لا تملك صلاحية تنزيله.");
  return pdfResponse(out.title, out.html, out.name);
}

// ───────────────────────── Contract ─────────────────────────

export async function contractPdf(requestId: string, contractId: string) {
  if (!UUID.test(requestId) || !UUID.test(contractId)) return fail(404, "غير موجود");
  const auth = await auth0();
  if (!auth) return fail(401, "سجّل الدخول ثم أعد المحاولة.");
  const { ip, userAgent } = await requestInfo();
  const out = await withContext(auth.db, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, requestId, "any");
    } catch {
      return null;
    }
    const [k] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.requestId, requestId))).limit(1);
    if (!k) return null;
    if (!rc.staffSide && ["draft", "approved"].includes(k.status)) return null;
    const sigs = await tx.select().from(contractSignatures).where(eq(contractSignatures.contractId, k.id));
    const signerIds = [...new Set(sigs.map((s) => s.userId))];
    const people = signerIds.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, signerIds)) : [];
    const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "—";
    await audit(tx, { actorUserId: auth.user.id, action: "contracts.download", entityType: "contract", entityId: k.id, waqfId: k.waqfId, ip, userAgent, after: { number: k.number, status: k.status } });
    const parties = k.parties as ContractParty[];
    const rows = parties.length
      ? parties.map((p) => {
          const s = sigs.find((x) => x.partyKey === p.key);
          return `<tr><td>${esc(p.name)}<br><span class="muted small">${esc(p.capacity)}</span></td><td>${esc(p.signerName)}<br><span class="muted small">${esc(AUTHORITY_LABEL[p.authorityType])}${p.authorityRef ? ` (${esc(p.authorityRef)})` : ""}</span></td><td>${s ? `${esc(s.signerName ?? nameOf(s.userId))}<br><span class="small">${dt(s.signedAt)}</span><br><span class="small muted" dir="ltr">IP ${esc(s.ip ?? "—")} · OTP ${esc(s.otpChallengeId?.slice(0, 8) ?? "—")}</span>` : `<span class="tag fine">لم يوقّع</span>`}</td></tr>`;
        }).join("")
      : sigs.map((s) => `<tr><td>${s.method === "otp" ? "العميل" : "الشركة"}</td><td>${esc(nameOf(s.userId))}</td><td>${dt(s.signedAt)}<br><span class="small muted" dir="ltr">IP ${esc(s.ip ?? "—")}</span></td></tr>`).join("");
    const status = CONTRACT_STATUS_LABEL[k.status] ?? k.status;
    const html = `<div class="brandbar"></div>
${k.status !== "signed" ? `<div class="box ${k.status === "void" ? "critical" : "seal"}">حالة العقد: ${esc(status)}${k.voidReason ? ` — ${esc(k.voidReason)}` : ""}. ${k.status === "void" ? "لا يُعتد بهذه النسخة." : "لا ينفذ العقد قبل توقيع جميع أطرافه."}</div>` : ""}
<div class="doc">${mdToHtml(k.body)}</div>
<h2 class="page-break">سجل التوقيع الإلكتروني</h2>
<p class="small">يوقّع كل طرف برمز تحقق لمرة واحدة يُرسل إلى جواله المسجل، ويُربط التوقيع ببصمة نص العقد أدناه. ${k.executedAt ? `نفذ العقد بتوقيع جميع الأطراف في ${dt(k.executedAt)}.` : ""}</p>
<table><thead><tr><th>الطرف</th><th>الموقّع وصفته</th><th>التوقيع</th></tr></thead><tbody>${rows || `<tr><td colspan="3">لا توقيعات بعد.</td></tr>`}</tbody></table>
<p class="small muted" dir="ltr">Contract ${esc(k.number)} v${k.version} · SHA-256 ${esc(k.contentHash)}</p>`;
    return { html, title: `العقد ${k.number}`, name: `${k.number}${k.status === "signed" ? "-signed" : ""}.pdf` };
  });
  if (!out) return fail(404, "المستند غير موجود أو لا تملك صلاحية تنزيله.");
  return pdfResponse(out.title, out.html, out.name);
}

// ───────────────────────── Invoice & receipt ─────────────────────────

async function loadInvoiceFor(tx: Parameters<Parameters<typeof withContext>[1]>[0], auth: NonNullable<Awaited<ReturnType<typeof getAuth>>>, invoiceId: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv || !(await canSeeInvoice(tx, auth, inv))) return null;
  return inv;
}

export async function invoicePdf(invoiceId: string) {
  if (!UUID.test(invoiceId)) return fail(404, "غير موجود");
  const auth = await auth0();
  if (!auth) return fail(401, "سجّل الدخول ثم أعد المحاولة.");
  const { ip, userAgent } = await requestInfo();
  const out = await withContext(auth.db, async (tx) => {
    const inv = await loadInvoiceFor(tx, auth, invoiceId);
    if (!inv) return null;
    const pays = await tx.select().from(payments).where(eq(payments.invoiceId, inv.id));
    const bal = invoiceBalance(inv, pays);
    const seller = (inv.sellerSnapshot ?? {}) as CompanyProfile;
    const vatNumber = /^3\d{13}3$/.test(seller.vatNumber ?? "") ? seller.vatNumber! : "";
    const taxDoc = (inv.kind === "tax_invoice" || (inv.kind === "credit_note" && Number(inv.vat) !== 0)) && !!vatNumber;
    const title = inv.kind === "proforma" ? "فاتورة أولية — ليست فاتورة ضريبية" : inv.kind === "credit_note" ? "إشعار دائن" : taxDoc ? "فاتورة ضريبية" : "فاتورة";
    let qr = "";
    const unsent = inv.status === "draft" || inv.status === "approved";
    if (taxDoc && !unsent) {
      const tlv = zatcaTlvBase64({ sellerName: seller.nameAr ?? "", vatNumber, timestamp: inv.createdAt.toISOString().replace(/\.\d{3}Z$/, "Z"), total: Number(inv.total).toFixed(2), vat: Number(inv.vat).toFixed(2) });
      qr = await QRCode.toDataURL(tlv, { errorCorrectionLevel: "M", margin: 1, width: 160 });
    }
    await audit(tx, { actorUserId: auth.user.id, action: "billing.invoice_download", entityType: "invoice", entityId: inv.id, waqfId: inv.waqfId, ip, userAgent, after: { number: inv.number } });
    const buyer = (inv.buyerSnapshot ?? {}) as Record<string, string>;
    const lines = inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="tabular">${l.qty}</td><td class="tabular">${sar(l.total)}</td></tr>`).join("");
    const html = `<div class="brandbar"></div>${unsent ? `<div class="box critical">معاينة ${inv.status === "draft" ? "مسودة غير معتمدة" : "فاتورة معتمدة لم تُرسل"} — ليست فاتورة صادرة، ولا تُرسل ولا تُسدد.</div>` : ""}
<div class="grid2"><div><h1 style="font-size:16pt">${esc(seller.nameAr ?? "")}</h1><dl class="kv small">
${seller.legalForm ? `<dt>الشكل النظامي</dt><dd>${esc(seller.legalForm)}</dd>` : ""}${vatNumber ? `<dt>الرقم الضريبي</dt><dd dir="ltr">${esc(vatNumber)}</dd>` : ""}${seller.crNumber ? `<dt>السجل التجاري</dt><dd>${esc(seller.crNumber)}</dd>` : ""}${seller.unifiedNumber ? `<dt>الرقم الوطني الموحد</dt><dd>${esc(seller.unifiedNumber)}</dd>` : ""}${seller.nationalAddress ? `<dt>العنوان</dt><dd>${esc(seller.nationalAddress)}</dd>` : ""}
</dl></div><div style="text-align:end"><h2 style="border:0;margin-top:0">${esc(title)}</h2><dl class="kv small"><dt>الرقم</dt><dd dir="ltr">${esc(inv.number)}</dd><dt>التاريخ</dt><dd>${dt(inv.issuedOn)}</dd>${inv.dueOn ? `<dt>الاستحقاق</dt><dd>${dt(inv.dueOn)}</dd>` : ""}</dl>${qr ? `<img src="${qr}" width="120" height="120" alt="">` : ""}</div></div>
<div class="box stone"><strong>العميل:</strong> ${esc(inv.billedToName)}${buyer.capacity ? ` — ${esc(buyer.capacity)}` : ""}${buyer.idNumber ? ` — ${esc(buyer.idLabel ?? "")} ${esc(buyer.idNumber)}` : ""}${inv.installmentLabel ? `<br><strong>الدفعة:</strong> ${esc(inv.installmentLabel)}` : ""}</div>
${inv.kind === "proforma" ? `<div class="box critical">هذا المستند بيان بالمبلغ المستحق وليس فاتورة ضريبية، ولا يُسدد بموجبه.</div>` : ""}
<table><thead><tr><th>البيان</th><th>الكمية</th><th>المبلغ</th></tr></thead><tbody>${lines}</tbody></table>
<dl class="kv"><dt>المجموع قبل الضريبة</dt><dd class="tabular">${sar(Number(inv.subtotal) - Number(inv.discount))}</dd>${Number(inv.vat) !== 0 || taxDoc ? `<dt>ضريبة القيمة المضافة (${Number(inv.vatRate)}٪)</dt><dd class="tabular">${sar(inv.vat)}</dd>` : ""}<dt>الإجمالي</dt><dd class="tabular"><strong>${sar(inv.total)}</strong></dd>${bal.paid > 0 && inv.kind !== "credit_note" ? `<dt>المدفوع</dt><dd class="tabular">${sar(bal.paid)}</dd><dt>المتبقي</dt><dd class="tabular">${sar(bal.balance)}</dd>` : ""}</dl>
${seller.iban && ["tax_invoice", "non_tax_invoice"].includes(inv.kind) ? `<p class="small">السداد بالتحويل: ${esc(seller.bankName ?? "")} — <span dir="ltr">${esc(seller.iban)}</span> — اذكر رقم الفاتورة.</p>` : ""}
<p class="small muted">${taxDoc ? (inv.einvoiceStatus === "pending" || inv.einvoiceStatus === "pending_integration" ? "لم تُرسل هذه الفاتورة إلى منصة الفوترة الإلكترونية بعد؛ الربط غير مفعّل." : "") : "ليست فاتورة ضريبية ولا تُرسل إلى منصة الفوترة الإلكترونية."}</p>`;
    return { html, title: `${title} ${inv.number}`, name: `${inv.number}.pdf` };
  });
  if (!out) return fail(404, "المستند غير موجود أو لا تملك صلاحية تنزيله.");
  return pdfResponse(out.title, out.html, out.name);
}

export async function receiptPdf(invoiceId: string, paymentId: string) {
  if (!UUID.test(invoiceId) || !UUID.test(paymentId)) return fail(404, "غير موجود");
  const auth = await auth0();
  if (!auth) return fail(401, "سجّل الدخول ثم أعد المحاولة.");
  const { ip, userAgent } = await requestInfo();
  const out = await withContext(auth.db, async (tx) => {
    const inv = await loadInvoiceFor(tx, auth, invoiceId);
    if (!inv) return null;
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.invoiceId, inv.id), eq(payments.status, "paid"))).limit(1);
    if (!p?.receiptNumber) return null;
    const seller = (inv.sellerSnapshot ?? {}) as CompanyProfile;
    await audit(tx, { actorUserId: auth.user.id, action: "billing.receipt_download", entityType: "payment", entityId: p.id, waqfId: inv.waqfId, ip, userAgent, after: { receipt: p.receiptNumber } });
    const METHOD: Record<string, string> = { transfer: "تحويل بنكي", cash: "نقدًا", cheque: "شيك", mada: "مدى", card: "بطاقة", applepay: "Apple Pay" };
    const html = `<div class="brandbar"></div>
<h1>إيصال استلام ${esc(p.receiptNumber)}</h1>
<dl class="kv"><dt>المستلم</dt><dd>${esc(seller.nameAr ?? "")}</dd><dt>من</dt><dd>${esc(inv.billedToName)}</dd><dt>المبلغ</dt><dd class="tabular"><strong>${sar(p.amount)}</strong></dd>
<dt>عن</dt><dd>${esc(INVOICE_KIND_LABEL[inv.kind as keyof typeof INVOICE_KIND_LABEL] ?? "فاتورة")} <span dir="ltr">${esc(inv.number)}</span>${inv.installmentLabel ? ` — ${esc(inv.installmentLabel)}` : ""}</dd>
<dt>الطريقة</dt><dd>${esc(METHOD[p.method ?? ""] ?? p.provider)}${p.provider === "sandbox" ? " (بيئة تجريبية)" : ""}</dd>${p.providerRef ? `<dt>المرجع</dt><dd dir="ltr">${esc(p.providerRef)}</dd>` : ""}<dt>التاريخ</dt><dd>${dt(p.paidAt)}</dd></dl>
<p class="small muted">الإيصال إثبات لاستلام المبلغ المذكور، وليس فاتورة ضريبية.</p>`;
    return { html, title: `إيصال ${p.receiptNumber}`, name: `${p.receiptNumber}.pdf` };
  });
  if (!out) return fail(404, "الإيصال غير موجود أو لا تملك صلاحية تنزيله.");
  return pdfResponse(out.title, out.html, out.name);
}
