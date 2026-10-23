/**
 * Second round of the waqf-establishment acceptance fixes (ACC-10 … ACC-24 and the template checklist). Each block names
 * the finding it covers.
 */
import { describe, expect, it } from "vitest";
import { SERVICES } from "@/server/seed/data/services";
import { formFor } from "@/server/modules/requests/intake/forms";
import { sanitizeAnswers, tableRows, visibleDocs } from "@/server/modules/requests/intake/engine";
import { assetRowFromFile, boardRowFromFile } from "@/server/modules/requests/intake/file-rows";
import { draftDeed, noteParts, type DraftInput } from "@/server/modules/outputs/drafting";
import { detectConflicts } from "@/server/modules/outputs/conflicts";
import { checkBlockers } from "@/server/modules/outputs/checks";
import { fieldRelease, fieldReleaseBlock, isEssential } from "@/server/modules/requests/field-policy";
import { dueByEvent, unbilledInstallments } from "@/server/modules/billing/schedule-pure";
import { guardTransition, type GuardInput } from "@/server/modules/requests/workflow";
import { outputHtml, LEGAL_DRAFT_NOTICE } from "@/server/modules/outputs/render";
import { clientApprovalAck, isLegalDraftService, outputsFor } from "@/server/modules/outputs/catalog";
import type { RequestAnalysis } from "@/server/modules/requests/insights";

const t03 = () => { const s = SERVICES.find((x) => x.code === "T03")!; return formFor({ code: "T03", audiences: s.audiences, requiredDocuments: s.docs ?? [] }); };

const BUILDING = { kind: "real_estate", description: "عمارة سكنية في الرياض، حي النرجس، مساحتها 900 م²", docKind: "deed", docNo: "310123456789", docDate: "2019-05-14", owned: "yes", mortgaged: "no", share: "whole", src: "file:a1" };
const SHARES = { kind: "shares", description: "20,000 سهم في شركة النماء التجريبية", docKind: "securities_statement", docNo: "SA-778899", owned: "yes", mortgaged: "no", share: "whole", src: "file:a2" };
const KEYS = { waqifName: "عبدالله بن سالم بن محمد التجريبي", waqifId: "1012345678", waqfName: "وقف تجريبي", waqfKind: "mixed", appurtenances: "all", alternateMasraf: "الفقراء", reservePercent: "15", selfBenefit: "no", nazirType: "board", boardSize: "3", succession: "board", investmentAllowed: "yes", amendmentRight: "no" };
const MASARIF = [{ tier: "1", beneficiary: "أولادي ذكورًا وإناثًا", share: "60", division: "inheritance" }, { tier: "1", beneficiary: "طلاب العلم", share: "40", division: "na" }];
const BOARD = [{ name: "عبدالله بن سالم التجريبي", role: "chair", capacity: "الواقف", src: "file:m1" }, { name: "سالم بن عبدالله التجريبي", role: "member", capacity: "ممثل الذرية", src: "file:m2" }, { name: "د. خالد المستقل", role: "member", capacity: "خبير مالي", src: "file:m3" }];
const input = (o: Partial<DraftInput> = {}): DraftInput => ({ keys: KEYS, tables: { assets: [BUILDING, SHARES], masarif: MASARIF, boardMembers: BOARD }, attached: { ownership: 2 }, requesterName: "واقف", today: "2026-10-24", ...o });

describe("ACC-10: several assets, each with its own ownership document", () => {
  it("the form asks assets row by row, prefilled from the waqf file with each row's source", () => {
    const f = t03();
    expect(f.version).toBe(3);
    const assets = f.steps.flatMap((s) => s.fields).find((x) => x.key === "assets")!;
    expect(assets.type).toBe("table");
    expect(assets.prefillTable).toBe("waqf.assets");
    const re = assetRowFromFile({ id: "a1", category: "real_estate", title: "عمارة سكنية", ownershipDocNo: "310123456789", sharePct: null, inWaqfName: true, details: { areaSqm: "900", deedDate: "2019-05-14" }, city: "الرياض", district: "حي النرجس" });
    expect(re).toMatchObject({ kind: "real_estate", docKind: "deed", docNo: "310123456789", docDate: "2019-05-14", owned: "yes", share: "whole", src: "file:a1" });
    expect(re.description).toContain("حي النرجس");
    const sh = assetRowFromFile({ id: "a2", category: "shares", title: "أسهم", ownershipDocNo: null, sharePct: null, inWaqfName: null, details: { quantity: "20000", issuer: "شركة النماء" } });
    expect(sh).toMatchObject({ kind: "shares", docKind: "securities_statement", src: "file:a2" });
    expect(sh.docNo).toBeUndefined(); // never borrowed from another asset
    expect(sh.description).toBe("20,000 سهم في شركة النماء");
  });

  it("the deed has one clause per asset, each naming its own document, in the plural", () => {
    const d = draftDeed(input());
    const assets = d.clauses.filter((c) => c.key.startsWith("asset"));
    expect(assets.map((c) => c.key)).toEqual(["asset:1", "asset:2"]);
    expect(assets[0].text).toContain("بموجب صك الملكية رقم 310123456789");
    expect(assets[1].text).toContain("بموجب كشف حساب الأوراق المالية (إفادة الإيداع) رقم SA-778899");
    expect(assets[1].text).not.toContain("310123456789");
    expect(d.clauses[0].text).toContain("أوقفت الأصول المبيّنة");
    expect(assets[1].text).toContain("ويشمل الوقف كامل الأصل، بجميع حقوقه وما يلحق به وما فيه.");
    expect(d.gaps.filter((g) => g.key.startsWith("asset:"))).toEqual([]);
  });

  it("a share proven by a real-estate deed, a missing document number, or too few documents block", () => {
    const d = draftDeed(input({ tables: { assets: [BUILDING, { ...SHARES, docKind: "deed", docNo: "" }], masarif: MASARIF }, attached: { ownership: 1 } }));
    expect(d.gaps.map((g) => g.key)).toEqual(expect.arrayContaining(["asset:2:doc_kind", "asset:2:doc_no", "doc:ownership_count"]));
    expect(d.checks.find((c) => c.key === "ownership")?.status).toBe("failed");
  });

  it("v2 answers (one asset in separate fields) become one row of the table", () => {
    const a = sanitizeAnswers(t03(), { assetType: "securities", assetDescription: "أسهم في شركة تجريبية كثيرة", ownershipDeedNo: "X1", registeredToWaqif: "yes", mortgaged: "no", share: "whole" });
    expect(tableRows(a.assets)[0]).toMatchObject({ kind: "shares", docNo: "X1", owned: "yes" });
  });

  it("the mortgagee's consent is asked when any asset is mortgaged", () => {
    const f = t03();
    expect(visibleDocs(f, { assets: JSON.stringify([BUILDING, SHARES]) }).some((x) => x.key === "mortgagee")).toBe(false);
    expect(visibleDocs(f, { assets: JSON.stringify([BUILDING, { ...SHARES, mortgaged: "yes" }]) }).some((x) => x.key === "mortgagee")).toBe(true);
  });
});

const conflictInput = (tables: Record<string, Record<string, string>[]>) => ({
  serviceCode: "T03", keys: KEYS, tables, labels: {}, options: {}, requester: { name: "x", capacityKey: "waqif" }, docs: [], waqf: null, prefills: {},
  fileRows: { assets: [BUILDING, SHARES], boardMembers: BOARD },
});

describe("ACC-24 and ACC-10: values from the waqf file, changes against it, and the board", () => {
  it("board members come from the file; the clause names them and leaves the board's rules to the waqif", () => {
    expect(boardRowFromFile({ id: "m1", personName: "عبدالله", role: "chair", capacity: "الواقف" })).toEqual({ name: "عبدالله", role: "chair", capacity: "الواقف", src: "file:m1" });
    const board = draftDeed(input()).clauses.find((c) => c.key === "board")!;
    expect(board.text).toContain("عبدالله بن سالم التجريبي رئيسًا، وسالم بن عبدالله التجريبي عضوًا، ود. خالد المستقل عضوًا");
    expect(board.text).toContain("[يُستكمل: نصاب اجتماعات المجلس وآلية قراراته ومدد العضوية والعزل والمكافآت");
  });

  it("a changed name or document number is a conflict with both values; the platform picks neither", () => {
    const cs = detectConflicts(conflictInput({ assets: [{ ...BUILDING, docNo: "999" }, SHARES], boardMembers: [{ ...BOARD[0], name: "اسم آخر" }, BOARD[1], BOARD[2]] }));
    const doc = cs.find((c) => c.key === "file:assets:1:docNo")!;
    expect(doc.severity).toBe("material");
    expect(doc.sides.map((s) => s.value)).toEqual(["999", "310123456789"]);
    expect(cs.find((c) => c.key === "file:boardMembers:1:name")?.severity).toBe("material");
    const d = draftDeed(input({ conflicts: cs }));
    expect(d.clauses.find((c) => c.key === "asset:1")!.text).toContain("[تعارض يُحسم:");
    expect(d.clauses.find((c) => c.key === "board")!.text).toContain("[تعارض يُحسم:");
  });

  it("a row the client added has no file record and raises no conflict; a member count that differs is a gap", () => {
    const cs = detectConflicts(conflictInput({ assets: [BUILDING, { ...SHARES, src: "" }], boardMembers: BOARD }));
    expect(cs.filter((c) => c.key.startsWith("file:"))).toEqual([]);
    expect(draftDeed(input({ keys: { ...KEYS, boardSize: "5" } })).gaps.some((g) => g.key === "board_count")).toBe(true);
  });
});

describe("ACC-16 and the template checklist: decisions the specialist must settle", () => {
  it("each request in the client's free note becomes its own item", () => {
    expect(noteParts("أرغب أن تراعي الصياغة تقديم طلاب العلم من الذرية، وأن تُعرض المسودة عليّ قبل اعتمادها.")).toEqual(["أرغب أن تراعي الصياغة تقديم طلاب العلم من الذرية", "أن تُعرض المسودة عليّ قبل اعتمادها"]);
  });

  it("decisions appear where they apply and hold the approval until recorded", () => {
    const d = draftDeed(input({ keys: { ...KEYS, notes: "أرغب أن تراعي الصياغة تقديم طلاب العلم من الذرية، وأن تُعرض المسودة عليّ قبل اعتمادها.", clientPreview: "yes" } }));
    const dec = d.checks.filter((c) => c.kind === "decision").map((c) => c.key);
    expect(dec).toEqual(expect.arrayContaining(["dec:succession_vacancy", "dec:descendants", "dec:share_base", "dec:partial_extinction", "dec:conflict_of_interest", "dec:board_terms", "dec:added_clauses", "dec:client_note:1", "dec:client_note:2", "dec:client_preview"]));
    const b = checkBlockers(d.checks);
    expect(b.pendingSpecialist.map((c) => c.key)).toEqual(expect.arrayContaining(dec));
    // settled one by one; «needs the waqif» stays blocking (as a failure)
    const reviews = dec.map((key) => ({ key, status: key === "dec:client_note:1" ? ("failed" as const) : ("verified" as const), note: "قرار مسجل للاختبار", by: "u", at: "2026-10-24", version: 1 }));
    const after = checkBlockers(d.checks, reviews);
    expect(after.pendingSpecialist.filter((c) => c.kind === "decision")).toEqual([]);
    expect(after.failed.map((c) => c.key)).toContain("dec:client_note:1");
  });

  it("a waqf for the poor alone, with one nazir, raises no family or board questions", () => {
    const d = draftDeed(input({ keys: { ...KEYS, nazirType: "self", reservePercent: "" }, tables: { assets: [BUILDING], masarif: [{ tier: "1", beneficiary: "الفقراء", share: "100", division: "na" }] } }));
    const dec = d.checks.filter((c) => c.kind === "decision").map((c) => c.key);
    expect(dec).toEqual(["dec:added_clauses"]);
  });
});

const view = (fields: { key: string; state: string; outdated?: boolean; conflict?: boolean }[]): Pick<RequestAnalysis, "steps" | "blocks"> => ({
  steps: [{ key: "s", title: "s", fields: fields.map((f) => ({ key: f.key, label: f.key, stepKey: "s", stepTitle: "s", value: "v", raw: "v", origin: "client" as const, required: true, error: null, review: null, state: f.state as "approved", approvalOutdated: !!f.outdated, insights: f.conflict ? [{ kind: "conflict" as const, text: "x" }] : [] })) }],
  blocks: [],
});

describe("ACC-12: essential fields reviewed before release; secondary reviewed or waived with a reason", () => {
  it("the classification is explicit for T03", () => {
    expect(isEssential("T03", "assets")).toBe(true);
    expect(isEssential("T03", "masarif")).toBe(true);
    expect(isEssential("T03", "contactPhone")).toBe(false);
    expect(fieldRelease("X99", view([{ key: "a", state: "pending" }])).enforced).toBe(false);
  });
  it("an unreviewed essential field blocks; approving it releases", () => {
    const open = fieldRelease("T03", view([{ key: "waqifName", state: "pending" }, { key: "contactPhone", state: "approved" }]));
    expect(fieldReleaseBlock(open)).toContain("waqifName");
    expect(fieldReleaseBlock(fieldRelease("T03", view([{ key: "waqifName", state: "approved" }, { key: "contactPhone", state: "approved" }])))).toBeNull();
  });
  it("an essential field cannot be waived; a conflict or a changed value reopens a field", () => {
    expect(fieldRelease("T03", view([{ key: "waqifName", state: "waived" }])).essentialOpen[0].reason).toContain("لا يجوز");
    expect(fieldRelease("T03", view([{ key: "waqifName", state: "approved", conflict: true }])).essentialOpen.length).toBe(1);
    expect(fieldRelease("T03", view([{ key: "waqifName", state: "approved", outdated: true }])).essentialOpen.length).toBe(1);
  });
  it("a secondary field blocks until reviewed or waived; a waiver counts separately", () => {
    const pending = fieldRelease("T03", view([{ key: "contactPhone", state: "pending" }]));
    expect(fieldReleaseBlock(pending)).toContain("ثانوية");
    const waived = fieldRelease("T03", view([{ key: "contactPhone", state: "waived" }]));
    expect(fieldReleaseBlock(waived)).toBeNull();
    expect(waived.waived.map((x) => x.key)).toEqual(["contactPhone"]);
    expect(waived.approved).toBe(0);
  });
  it("the guard refuses release with the policy's reason", () => {
    const g: GuardInput = { from: "quality_review", to: "awaiting_client_approval", actorUserId: "qa", conflictCheck: "passed", workflowCode: "standard", deliverers: ["p"], submittedDeliverables: 1, unsignedOpinionDeliverables: 0, contractSignedByClient: true, hasContract: true, quoteAmount: 1, pricingModel: "fixed" };
    expect(guardTransition({ ...g, fieldReview: "لا تُرسل" })).toBe("لا تُرسل");
    expect(guardTransition({ ...g, fieldReview: null })).toBeNull();
  });
});

describe("ACC-14: billing before closing", () => {
  it("delivery makes «on delivery» due; completion makes delivery, completion and milestone installments due", () => {
    expect(dueByEvent("on_delivery", "delivery")).toBe(true);
    expect(dueByEvent("on_milestone", "delivery")).toBe(false);
    expect(["on_delivery", "on_completion", "on_milestone"].every((k) => dueByEvent(k, "completion"))).toBe(true);
    expect(dueByEvent("on_date", "completion")).toBe(false);
  });
  it("only an issued invoice counts; a draft, an approved-unsent or a void one does not; payment is not required", () => {
    const row = (invoices: { status: string; kind: string }[]) => ({ id: "r", label: "عند التسليم", total: 4312.5, invoices });
    expect(unbilledInstallments([row([])])[0].state).toBe("بلا فاتورة");
    expect(unbilledInstallments([row([{ status: "draft", kind: "tax_invoice" }])])[0].state).toContain("لم تُعتمد");
    expect(unbilledInstallments([row([{ status: "approved", kind: "tax_invoice" }])]).length).toBe(1);
    expect(unbilledInstallments([row([{ status: "void", kind: "tax_invoice" }, { status: "issued", kind: "tax_invoice" }])])).toEqual([]);
    expect(unbilledInstallments([row([{ status: "issued", kind: "proforma" }])]).length).toBe(1);
  });
  it("closing is refused with the amount and the next step", () => {
    const g: GuardInput = { from: "completed", to: "closed", actorUserId: "u", conflictCheck: "passed", workflowCode: "standard", deliverers: [], submittedDeliverables: 1, unsignedOpinionDeliverables: 0, contractSignedByClient: true, hasContract: true, quoteAmount: 1, pricingModel: "fixed" };
    const msg = guardTransition({ ...g, unbilled: [{ label: "عند تسليم الوثيقة المعتمدة", total: 4312.5, state: "بلا فاتورة" }] });
    expect(msg).toContain("4312.50 ر.س");
    expect(msg).toContain("لا يُشترط السداد");
    expect(guardTransition({ ...g, unbilled: [] })).toBeNull();
  });
});

describe("ACC-17: sending to quality review never completes open work stages silently", () => {
  const g: GuardInput = { from: "in_progress", to: "quality_review", actorUserId: "u", conflictCheck: "passed", workflowCode: "standard", deliverers: [], submittedDeliverables: 1, unsignedOpinionDeliverables: 0, contractSignedByClient: true, hasContract: true, quoteAmount: 1, pricingModel: "fixed" };
  it("open stages block unless the sender confirms them explicitly", () => {
    expect(guardTransition({ ...g, openWorkStages: ["الدراسة والتحليل"] })).toContain("«الدراسة والتحليل»");
    expect(guardTransition({ ...g, openWorkStages: ["الدراسة والتحليل"], stagesConfirmed: true })).toBeNull();
    expect(guardTransition({ ...g, openWorkStages: [] })).toBeNull();
  });
});

describe("ACC-11, ACC-13, ACC-19, ACC-22, ACC-23: the document and its copies", () => {
  const meta = { number: "OUT-000150", title: "مسودة وثيقة وقف للمراجعة قبل التوثيق", specialty: "قانوني", serviceLine: "T03 — صياغة وثيقة الوقف", serviceName: "صياغة وثيقة الوقف", requestNumber: "REQ-000472", waqfName: "وقف", version: 5, status: "approved", preparedBy: "موظف أ", approvedBy: "مراجع ب", approvedAt: "2026-10-23", selfApproved: false, signedBy: null, isDemo: false, reviewRounds: ["أعاده للتعديل مراجع ب في 2026-10-23"], versionDate: "2026-10-23", workflowStatus: "approved" as const, legalDraft: true };
  const sections = [{ key: "deed_clauses", title: "نص وثيقة الوقف", required: true, blocks: [{ type: "clause" as const, key: "asset", n: 1, title: "الأصل", text: "بموجب صك رقم 1 وتاريخ 2019-05-14.", generated: "x", prov: "client" as const }] }, { key: "references", title: "المراجع", required: false, audience: "internal" as const, blocks: [{ type: "para" as const, text: "الدليل الإرشادي" }] }];

  it("the output is named a draft for review before documentation", () => {
    expect(outputsFor({ code: "T03", outputs: "وثيقة وقف نهائية جاهزة للتوثيق" })[0].title).toBe("مسودة وثيقة وقف للمراجعة قبل التوثيق");
    expect(SERVICES.find((s) => s.code === "T03")!.summary).not.toContain("موقّعة");
    expect(isLegalDraftService("T03")).toBe(true);
  });
  it("the client copy carries the notice and none of the internal record", () => {
    const html = outputHtml({ ...meta, audience: "client" }, sections);
    expect(html).toContain(LEGAL_DRAFT_NOTICE);
    for (const internal of ["أعاده للتعديل", "موظف أ", "مراجع ب", "OUT-000150", "v5", "T03", "الدليل الإرشادي"]) expect(html, internal).not.toContain(internal);
    expect(html).toContain("لم تُرفق بهذه النسخة مراجعة شرعية أو قانونية موقّعة");
    expect(html).toContain('<bdi dir="ltr" class="tabular">2019-05-14</bdi>');
  });
  it("the team's copy keeps the full record", () => {
    const html = outputHtml({ ...meta, audience: "internal" }, sections);
    for (const kept of ["أعاده للتعديل", "مراجع ب", "OUT-000150", "T03"]) expect(html, kept).toContain(kept);
  });
  it("the client's approval states what he approves and waives nothing", () => {
    expect(clientApprovalAck("T03")).toContain("مسودة لا تكون نافذة");
    expect(clientApprovalAck("T03")).toContain("لا يُعد هذا الإقرار تنازلًا");
    expect(clientApprovalAck("C01")).not.toContain("مسودة");
  });
});
