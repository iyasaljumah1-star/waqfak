/**
 * Contract text from its template, the accepted quote and the parties (PURE). Nothing is printed in place of missing
 * data: callers check the company and party data first (commerce/pure: contractCompanyGaps, validateParties).
 */
import type { ContractParty, PaymentTerm, QuoteLine } from "@/server/db/schema/commerce";
import { fillTemplate } from "@/server/modules/billing/calc";
import { AUTHORITY_LABEL, splitInstallments, TERM_DUE_LABEL, type CompanyProfile } from "@/server/modules/commerce/pure";

const sar = (n: number | string) => `${Number(n).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;

/** Template for a service: by workflow, with corporate nazara (N01) on its own; amendments use the amendment template. */
export function templateCodeFor(svc: { code: string; workflowTemplateCode: string }, amendment: boolean) {
  if (amendment) return "service_amendment";
  if (svc.code === "N01") return "nazara_service";
  return ({ opinion: "service_opinion", registration: "service_registration", subscription: "service_subscription" } as Record<string, string>)[svc.workflowTemplateCode] ?? "service_standard";
}

/** The company party, built only from the company profile (call contractCompanyGaps first). */
export function companyParty(c: CompanyProfile): ContractParty {
  const idNumber = c.crNumber?.trim() || c.unifiedNumber?.trim() || "";
  return {
    key: "company", side: "company", name: c.nameAr!.trim(), capacity: c.legalForm?.trim() || "شركة",
    idLabel: c.crNumber?.trim() ? "سجل تجاري رقم" : "الرقم الوطني الموحد", idNumber,
    signerName: c.signatoryName!.trim(), signerUserId: null, authorityType: "company_signatory", authorityRef: c.signatoryTitle?.trim() || null,
    authorityDocumentId: null, required: true,
  };
}

export function partiesBlock(parties: ContractParty[], company: CompanyProfile) {
  const client = parties.filter((p) => p.side === "client");
  const lines: string[] = [];
  for (const p of parties.filter((x) => x.side === "company"))
    lines.push(`**الطرف الأول:** ${p.name}، ${p.capacity}، ${p.idLabel} ${p.idNumber}${company.nationalAddress ? `، وعنوانها الوطني: ${company.nationalAddress}` : ""}، ويمثلها في التوقيع ${p.signerName} بصفته ${p.authorityRef ?? "المفوّض بالتوقيع"}.`);
  client.forEach((p, i) => {
    const label = client.length > 1 ? `**الطرف الثاني (${i + 1}):**` : "**الطرف الثاني:**";
    const id = p.idNumber ? `، ${p.idLabel ?? "رقم الهوية"} ${p.idNumber}` : "";
    const signer = p.authorityType === "self" ? `ويوقّع أصالة عن نفسه` : `ويوقّع عنه ${p.signerName} ${AUTHORITY_LABEL[p.authorityType]}${p.authorityRef ? ` (${p.authorityRef})` : ""}`;
    lines.push(`${label} ${p.name}، ${p.capacity}${id}، ${signer}.`);
  });
  return lines.join("\n");
}

export type QuoteForContract = {
  number: string; version: number; scope: string; deliverables: string | null; exclusions: string | null; assumptions: string | null; clientObligations: string | null;
  durationDays: number | null; lines: QuoteLine[]; subtotal: string; discount: string; net: string; vatRate: string; vat: string; total: string; paymentTerms: PaymentTerm[];
};

export function annexText(q: QuoteForContract) {
  const out: string[] = [];
  out.push("## نطاق العمل", q.scope);
  if (q.deliverables) out.push("## المخرجات", q.deliverables);
  if (q.exclusions) out.push("## ما لا يشمله النطاق", q.exclusions);
  if (q.assumptions) out.push("## الافتراضات", q.assumptions);
  if (q.durationDays) out.push("## المدة", `${q.durationDays} يومًا`);
  out.push("## البنود");
  for (const l of q.lines) out.push(`- ${l.description}: ${l.qty} × ${sar(l.unit)} = ${sar(l.total)}`);
  out.push(`المجموع ${sar(q.subtotal)}${Number(q.discount) ? `، الخصم ${sar(q.discount)}` : ""}، الصافي ${sar(q.net)}، ضريبة القيمة المضافة (${Number(q.vatRate)}٪) ${sar(q.vat)}، الإجمالي ${sar(q.total)}.`);
  return out.join("\n");
}

export function priceClause(q: QuoteForContract, company: CompanyProfile) {
  const vat = Number(q.vat);
  const base = `المقابل المالي ${sar(q.net)} قبل الضريبة`;
  if (vat > 0) return `${base}، وضريبة القيمة المضافة بنسبة ${Number(q.vatRate)}٪ قدرها ${sar(vat)}، فيكون الإجمالي ${sar(q.total)}. وتصدر الفواتير عبر المنصة وفق شروط الدفع الآتية.`;
  if (company.vatRegistration === "not_registered") return `${base}، ولا تُحتسب عليه ضريبة القيمة المضافة لعدم تسجيل الطرف الأول فيها، فيكون الإجمالي ${sar(q.total)}. وتصدر الفواتير عبر المنصة وفق شروط الدفع الآتية.`;
  return `${base}، فيكون الإجمالي ${sar(q.total)}. وتصدر الفواتير عبر المنصة وفق شروط الدفع الآتية.`;
}

export function paymentTermsText(q: QuoteForContract) {
  return splitInstallments(Number(q.net), Number(q.vatRate), q.paymentTerms)
    .map((t) => `- ${t.label} (${t.percent}٪): ${sar(t.total)} — ${TERM_DUE_LABEL[t.due]}${t.beforeStart ? "، ويُشترط سدادها قبل بدء التنفيذ" : ""}.`)
    .join("\n");
}

export function renderContract(tpl: string, x: {
  number: string; date: string; parties: ContractParty[]; company: CompanyProfile; service: { nameAr: string; code: string; regulatoryRestrictions: string | null };
  requestNumber: string; quote: QuoteForContract; parentContract?: string | null;
}) {
  const q = x.quote;
  return fillTemplate(tpl, {
    number: x.number,
    date: x.date,
    parties_block: partiesBlock(x.parties, x.company),
    service_name: x.service.nameAr,
    service_code: x.service.code,
    request_number: x.requestNumber,
    quote_ref: `${q.number} (نسخة ${q.version})`,
    duration_clause: q.durationDays
      ? `تُنفَّذ الخدمة خلال ${q.durationDays} يومًا من نفاذ العقد واكتمال ما يلزم من الطرف الثاني، وتمتد المدة بقدر ما يتأخر في تقديمه.`
      : "تُنفَّذ الخدمة وفق المراحل المبينة في المنصة.",
    price_clause: priceClause(q, x.company),
    payment_terms: paymentTermsText(q),
    client_obligations: q.clientObligations ?? "",
    restriction: x.service.regulatoryRestrictions || "لا قيود نظامية إضافية على هذه الخدمة غير ما ورد في هذا العقد.",
    annex: annexText(q),
    parent_contract: x.parentContract ?? "",
  });
}
