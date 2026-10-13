import { describe, expect, it } from "vitest";
import {
  buildQuote, checkConsistency, contractCompanyGaps, invoiceBalance, invoicePolicy, pendingParties, quoteCanonical, quoteDisplayStatus, quoteExpired,
  splitInstallments, statusAfterPayment, validateParties,
} from "@/server/modules/commerce/pure";
import { annexText, companyParty, partiesBlock, renderContract, templateCodeFor } from "@/server/modules/contracts/render";
import { businessDaysAr, clientJourney, nextAction, type NextActionInput } from "@/server/modules/requests/journey";
import { guardTransition, type GuardInput } from "@/server/modules/requests/workflow";
import { awaitingClient, blocking, itemCounts, itemStatusLabel } from "@/server/modules/requests/items-pure";
import type { ContractParty } from "@/server/db/schema/commerce";

const today = "2026-10-13";
const base = {
  lines: [{ description: "خدمة اختبار", qty: 1, unit: 1000 }],
  discount: 0,
  vatRate: 15,
  terms: [{ label: "عند التوقيع", percent: 50, due: "on_contract" as const, beforeStart: true }, { label: "عند التسليم", percent: 50, due: "on_delivery" as const, beforeStart: false }],
  validUntil: "2026-11-12",
  today,
};

describe("quotes", () => {
  it("totals lines, discount and VAT", () => {
    const q = buildQuote({ ...base, lines: [{ description: "أ", qty: 2, unit: 300 }, { description: "ب", qty: 1, unit: 400 }], discount: 100 });
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect([q.subtotal, q.net, q.vat, q.total]).toEqual([1000, 900, 135, 1035]);
    expect(q.terms.map((t) => t.key)).toEqual(["t1", "t2"]);
    expect(q.terms[0].beforeStart).toBe(true);
  });

  it("rejects incomplete quotes with Arabic reasons", () => {
    const r = buildQuote({ ...base, lines: [], terms: [{ label: "x", percent: 60, due: "on_contract", beforeStart: false }], validUntil: "2026-01-01" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/بندًا واحدًا/);
    expect(r.errors.join(" ")).toMatch(/100٪/);
    expect(r.errors.join(" ")).toMatch(/صلاحية/);
    expect(buildQuote({ ...base, discount: 2000 }).ok).toBe(false);
    expect(buildQuote({ ...base, vatRate: NaN }).ok).toBe(false);
  });

  it("before_start installments are always a start condition", () => {
    const q = buildQuote({ ...base, terms: [{ label: "مقدم", percent: 100, due: "before_start", beforeStart: false }] });
    expect(q.ok && q.terms[0].beforeStart).toBe(true);
  });

  it("splits installments exactly (rounding goes to the last one)", () => {
    const parts = splitInstallments(1000, 15, [
      { key: "a", label: "أ", percent: 33.33, due: "on_contract", beforeStart: false },
      { key: "b", label: "ب", percent: 33.33, due: "on_delivery", beforeStart: false },
      { key: "c", label: "ج", percent: 33.34, due: "on_completion", beforeStart: false },
    ]);
    expect(parts.reduce((s, p) => s + p.net, 0)).toBeCloseTo(1000, 2);
    expect(parts.reduce((s, p) => s + p.vat, 0)).toBeCloseTo(150, 2);
    expect(parts.reduce((s, p) => s + p.total, 0)).toBeCloseTo(1150, 2);
  });

  it("an offer past its validity is expired and cannot be accepted", () => {
    expect(quoteExpired({ status: "sent", validUntil: "2026-10-12" }, today)).toBe(true);
    expect(quoteExpired({ status: "sent", validUntil: today }, today)).toBe(false);
    expect(quoteExpired({ status: "accepted", validUntil: "2026-01-01" }, today)).toBe(false);
    expect(quoteDisplayStatus({ status: "sent", validUntil: "2026-10-01" }, today)).toBe("expired");
  });

  it("the canonical text changes with any priced term", () => {
    const q = { number: "QUO-1", version: 1, scope: "نطاق", lines: [], subtotal: 1, discount: 0, net: 1, vatRate: 15, vat: 0.15, total: 1.15, paymentTerms: [], validUntil: today };
    expect(quoteCanonical(q)).not.toEqual(quoteCanonical({ ...q, total: 2 }));
    expect(quoteCanonical(q)).toEqual(quoteCanonical({ ...q, total: "1.15" }));
  });
});

describe("company data, invoice type", () => {
  const full = { nameAr: "شركة", crNumber: "0000000000", nationalAddress: "عنوان", signatoryName: "م", signatoryTitle: "مدير" };
  it("contracts need the legal name, registration, address and signatory", () => {
    expect(contractCompanyGaps(full)).toEqual([]);
    expect(contractCompanyGaps({ nameAr: "شركة" })).toEqual(["رقم السجل التجاري أو الرقم الوطني الموحد", "العنوان الوطني", "اسم المفوّض بالتوقيع", "صفة المفوّض بالتوقيع"]);
    expect(contractCompanyGaps({ ...full, crNumber: "", unifiedNumber: "7000000000" })).toEqual([]);
  });
  it("no tax invoice without a valid VAT number; proforma when anything is missing", () => {
    expect(invoicePolicy(full).kind).toBe("proforma");
    expect(invoicePolicy(full).gaps).toContain("حالة التسجيل في ضريبة القيمة المضافة");
    expect(invoicePolicy({ ...full, vatRegistration: "registered", vatNumber: "123" }).kind).toBe("proforma");
    expect(invoicePolicy({ ...full, vatRegistration: "registered", vatNumber: "300000000000003" }).kind).toBe("tax_invoice");
    expect(invoicePolicy({ ...full, vatRegistration: "not_registered" }).kind).toBe("non_tax_invoice");
    expect(invoicePolicy({ vatRegistration: "registered", vatNumber: "300000000000003" }).kind).toBe("proforma");
  });
  it("partial payments: balance and status", () => {
    expect(invoiceBalance({ total: "517.50", status: "issued" }, [{ amount: "200", status: "paid" }, { amount: "50", status: "failed" }])).toEqual({ total: 517.5, paid: 200, balance: 317.5 });
    expect(statusAfterPayment(517.5, 200)).toBe("partially_paid");
    expect(statusAfterPayment(517.5, 517.5)).toBe("paid");
  });
});

describe("contract parties and text", () => {
  const company = { nameAr: "شركة اختبار", legalForm: "ذات مسؤولية محدودة", crNumber: "0000000000", nationalAddress: "الرياض", signatoryName: "مفوّض", signatoryTitle: "المدير العام" };
  const client: ContractParty = { key: "client1", side: "client", name: "وقف اختبار", capacity: "وقف", signerName: "ناظر", signerUserId: "u1", authorityType: "nazir", authorityRef: "صك 1", authorityDocumentId: null, required: true };
  it("validates authority and signers", () => {
    expect(validateParties([companyParty(company), client])).toEqual([]);
    expect(validateParties([client]).join(" ")).toMatch(/طرف واحد عن/);
    expect(validateParties([companyParty(company), { ...client, authorityRef: null }]).join(" ")).toMatch(/سند صفة/);
    expect(validateParties([companyParty(company), { ...client, authorityType: "agent", authorityDocumentId: null }]).join(" ")).toMatch(/أرفق الوكالة/);
    expect(validateParties([companyParty(company), { ...client, signerUserId: null }]).join(" ")).toMatch(/حساب الموقّع/);
  });
  it("execution needs every required party", () => {
    const parties = [companyParty(company), client, { ...client, key: "client2", signerUserId: "u2" }];
    expect(pendingParties(parties, ["client1"]).map((p) => p.key)).toEqual(["company", "client2"]);
    expect(pendingParties(parties, ["client1", "client2", "company"])).toEqual([]);
  });
  it("renders parties, annex and price from the accepted quote, never placeholders", () => {
    const q = { number: "QUO-1", version: 2, scope: "نطاق اختبار", deliverables: "تقرير", exclusions: null, assumptions: null, clientObligations: "تقديم المستندات", durationDays: 10, lines: [{ description: "بند", qty: 1, unit: 900, total: 900 }], subtotal: "900", discount: "0", net: "900", vatRate: "15", vat: "135", total: "1035", paymentTerms: [{ key: "t1", label: "كامل", percent: 100, due: "on_contract" as const, beforeStart: true }] };
    const body = renderContract("{{parties_block}}\n{{price_clause}}\n{{payment_terms}}\n{{annex}}\n{{quote_ref}}", { number: "CTR-1", date: "اليوم", parties: [companyParty(company), client], company, service: { nameAr: "خدمة", code: "C02", regulatoryRestrictions: null }, requestNumber: "REQ-1", quote: q });
    expect(body).toContain("الطرف الأول:** شركة اختبار");
    expect(body).toContain("بصفته ناظر الوقف (صك 1)");
    expect(body).toContain("قبل بدء التنفيذ");
    expect(body).toContain("QUO-1 (نسخة 2)");
    expect(body).not.toMatch(/\{\{|قيد الإضافة|undefined/);
    expect(partiesBlock([companyParty(company), client, { ...client, key: "c2" }], company)).toContain("الطرف الثاني (2)");
    expect(annexText(q)).toContain("نطاق اختبار");
  });
  it("chooses the template by the nature of the service", () => {
    expect(templateCodeFor({ code: "C07", workflowTemplateCode: "opinion" }, false)).toBe("service_opinion");
    expect(templateCodeFor({ code: "T06", workflowTemplateCode: "registration" }, false)).toBe("service_registration");
    expect(templateCodeFor({ code: "N01", workflowTemplateCode: "subscription" }, false)).toBe("nazara_service");
    expect(templateCodeFor({ code: "G01", workflowTemplateCode: "standard" }, true)).toBe("service_amendment");
  });
});

describe("consistency across quote, contract, invoices and payments", () => {
  const accepted = [{ id: "q1", number: "QUO-1", version: 2, kind: "initial", net: 900, total: 1035, vatRate: 15, terms: [] }];
  const contracts = [{ id: "k1", number: "CTR-1", status: "signed", quoteId: "q1", amount: 900, parentContractId: null }];
  const inv = (o: Partial<{ id: string; number: string; kind: string; status: string; quoteId: string | null; contractId: string | null; installmentKey: string | null; subtotal: number; discount: number; vat: number; total: number; creditOfId: string | null }>) => ({
    id: "i1", number: "INV-1", kind: "tax_invoice", status: "issued", quoteId: "q1", contractId: "k1", installmentKey: "t1", subtotal: 450, discount: 0, vat: 67.5, total: 517.5, creditOfId: null, ...o,
  });
  it("is clean on a consistent chain", () => {
    expect(checkConsistency({ acceptedQuotes: accepted, contracts, invoices: [inv({})], payments: [{ invoiceId: "i1", amount: 517.5, status: "paid" }], agreedPrice: 900 })).toEqual([]);
  });
  it("flags amount mismatches, over-invoicing, duplicate installments, over-payment and payments on proformas", () => {
    const issues = checkConsistency({
      acceptedQuotes: accepted,
      contracts: [{ ...contracts[0], amount: 800 }],
      invoices: [inv({}), inv({ id: "i2", number: "INV-2" }), inv({ id: "p1", number: "PRF-1", kind: "proforma", installmentKey: "t2" })],
      payments: [{ invoiceId: "i1", amount: 600, status: "paid" }, { invoiceId: "p1", amount: 10, status: "paid" }],
      agreedPrice: 900,
    }).map((i) => i.text).join("\n");
    expect(issues).toMatch(/لا يطابق صافي العرض/);
    expect(issues).toMatch(/فُوترت أكثر من مرة/);
    expect(issues).toMatch(/يتجاوز قيمة العقود/);
    expect(issues).toMatch(/يتجاوز إجماليها/);
    expect(issues).toMatch(/الفاتورة الأولية/);
  });
});

describe("request journey and guards", () => {
  it("client journey comes from the workflow, not a fixed promise", () => {
    const j = clientJourney({ pricingModel: "fixed" }, [{ name: "استلام البيانات والمستندات", slaDays: 3, role: "x" }, { name: "الدراسة", slaDays: 7, role: "y" }]);
    expect(j[0]).toContain("3 أيام عمل");
    expect(j.join(" ")).not.toContain("5 أيام");
    expect(clientJourney({ pricingModel: "free" }, []).join(" ")).not.toMatch(/عرض السعر/);
    expect([businessDaysAr(1), businessDaysAr(2), businessDaysAr(11)]).toEqual(["يوم عمل واحد", "يوما عمل", "11 يوم عمل"]);
  });

  const nx = (o: Partial<NextActionInput>): NextActionInput => ({
    status: "triage", assigned: true, conflictBlocked: false, verified: false, accepted: false, clientItemsOpen: 0, itemsAwaitingReview: 0, quote: null, pricingModel: "fixed",
    contract: null, prestartUnpaid: 0, deliverablesSubmitted: 0, ...o,
  });
  it("names the next action and who owns it", () => {
    expect(nextAction(nx({ status: "submitted" })).who).toBe("ops");
    expect(nextAction(nx({ clientItemsOpen: 2 })).who).toBe("client");
    expect(nextAction(nx({ itemsAwaitingReview: 1 })).label).toMatch(/مراجعة ما استكمله/);
    expect(nextAction(nx({ verified: true })).label).toMatch(/قبول الطلب/);
    expect(nextAction(nx({ verified: true, accepted: true, quote: { status: "draft", expired: false } })).label).toMatch(/اعتماد عرض السعر/);
    expect(nextAction(nx({ status: "quote", quote: { status: "sent", expired: true } })).who).toBe("waqfak");
    expect(nextAction(nx({ status: "awaiting_contract", contract: { status: "sent", pendingClientSigners: ["فهد"], companyPending: true } })).detail).toContain("فهد");
    expect(nextAction(nx({ status: "awaiting_contract", contract: { status: "signed", pendingClientSigners: [], companyPending: false }, prestartUnpaid: 1 })).who).toBe("client");
    expect(nextAction(nx({ status: "closed" })).who).toBe("none");
  });

  const g = (o: Partial<GuardInput>): GuardInput => ({
    from: "triage", to: "quote", actorUserId: "u", conflictCheck: "passed", workflowCode: "standard", deliverers: [], submittedDeliverables: 0, unsignedOpinionDeliverables: 0,
    contractSignedByClient: false, hasContract: false, quoteAmount: 100, pricingModel: "fixed", ...o,
  });
  it("guards: verification, acceptance, accepted quote, full execution, pre-start payment, open items", () => {
    expect(guardTransition(g({ verified: false }))).toMatch(/تحقق/);
    expect(guardTransition(g({ verified: true, accepted: false }))).toMatch(/اقبل الطلب/);
    expect(guardTransition(g({ verified: true, accepted: true }))).toBeNull();
    expect(guardTransition(g({ from: "quote", to: "awaiting_contract", hasQuotes: true, quoteAccepted: false }))).toMatch(/لوحة «عرض السعر»/);
    expect(guardTransition(g({ from: "awaiting_contract", to: "in_progress", contractSignedByClient: true, contractExecuted: false }))).toMatch(/جميع أطراف العقد/);
    expect(guardTransition(g({ from: "awaiting_contract", to: "in_progress", contractSignedByClient: true, contractExecuted: true, prestartUnpaid: 1 }))).toMatch(/قبل البدء/);
    expect(guardTransition(g({ from: "awaiting_client_approval", to: "completed", blockingItems: 2 }))).toMatch(/2 من النواقص/);
    // legacy callers (no new fields) keep their behaviour
    expect(guardTransition(g({}))).toBeNull();
  });
});

describe("deficiency register rules", () => {
  const items = [
    { kind: "document", status: "open", visibility: "client", required: true },
    { kind: "question", status: "answered", visibility: "client", required: true },
    { kind: "internal", status: "open", visibility: "internal", required: true },
    { kind: "data", status: "accepted", visibility: "client", required: true },
    { kind: "question", status: "correction_requested", visibility: "client", required: false },
  ];
  it("counts what waits on whom", () => {
    expect(itemCounts(items)).toEqual({ clientOpen: 2, clientRequiredOpen: 1, awaitingReview: 1, blocking: 3, total: 5 });
    expect(awaitingClient(items[2])).toBe(false);
    expect(blocking(items[3])).toBe(false);
    expect(itemStatusLabel(items[2])).toBe("مفتوح لدى الفريق");
    expect(itemStatusLabel(items[0])).toBe("بانتظار العميل");
  });
});
