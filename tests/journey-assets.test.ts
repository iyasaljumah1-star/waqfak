import { describe, expect, it } from "vitest";
import { ASSET_CATEGORIES, ASSET_TYPES, assetDetailRows, assetSummary, checkAsset } from "@/server/modules/assets/types";
import { journey, firstIncompleteWizardStep, type JourneyFacts } from "@/server/modules/establish/journey";
import { buildDeedDraft, emptyState, missingItems, normalizeState } from "@/server/modules/establish/pure";

/** Customer-journey order: establishment journey from saved records, and asset forms by type. Synthetic data only. */

const facts = (over: Partial<JourneyFacts> = {}): JourneyFacts => ({
  today: "2026-10-16",
  waqf: { id: "w1", status: "draft", updatedAt: "2026-10-16T10:00:00Z", deedNo: null, deedDate: null, documentedOn: null, registeredOn: null, nazirMode: "individual" },
  wizard: { finished: false, step: 3, completed: [1, 2], missing: [{ step: 3, text: "أضف أصلًا" }, { step: 4, text: "أضف مصرفًا" }], updatedAt: "2026-10-16T10:00:00Z", nazaraMode: "", assets: [], assetCount: 0, boardMembers: 0, boardChair: false },
  file: { assets: 0, assetGaps: [], ownershipDocs: 0, needsOwnershipDocs: false, classes: 0, conditions: 0, trustees: 0, board: null },
  docs: { deed: 0, registration: 0 },
  requests: [],
  ops: { bo: 0, budgetCurrent: false, policiesApproved: 0, policiesTotal: 12, meetings12m: 0 },
  ...over,
});
const finished = { finished: true, step: 7, completed: [1, 2, 3, 4, 5, 6, 7], missing: [], updatedAt: "2026-10-16T10:00:00Z", nazaraMode: "individual", assets: [], assetCount: 1, boardMembers: 0, boardChair: false };
const fileOk = { assets: 1, assetGaps: [], ownershipDocs: 1, needsOwnershipDocs: true, classes: 2, conditions: 1, trustees: 1, board: null };

describe("establishment journey", () => {
  it("an open draft: awaiting the client, resumes at the first incomplete step, every gap links to its wizard step", () => {
    const j = journey(facts());
    expect(j.status).toBe("awaiting_client");
    expect(j.stage).toBe(1);
    expect(j.resume).toEqual({ href: "/app/establish/w1?step=3", label: "استكمال تأسيس الوقف" });
    expect(j.gaps.find((g) => g.text === "أضف مصرفًا")?.href).toBe("/app/establish/w1?step=4");
    expect(j.gaps.find((g) => g.key === "assets:none")?.href).toBe("/app/establish/w1?step=3#assets");
    expect(j.gaps.every((g) => g.owner)).toBe(true);
  });

  it("a board needs at least three members and a chair before the step is done", () => {
    const j = journey(facts({ wizard: { ...finished, finished: false, nazaraMode: "board", boardMembers: 2, boardChair: false, missing: [] } }));
    expect(j.gaps.map((g) => g.key)).toContain("board:members");
    expect(j.steps.find((s) => s.key === "nazara")?.state).not.toBe("done");
  });

  it("an entered deed number is not documentation: the instrument must be in the vault", () => {
    const base = facts({ wizard: finished, file: fileOk, waqf: { ...facts().waqf, deedNo: "123", documentedOn: "2026-10-01", status: "documenting" } });
    const j = journey(base);
    expect(j.documented).toBe(false);
    expect(j.status).toBe("documenting");
    expect(j.steps.find((s) => s.key === "documentation")?.detail).toContain("لا يُعد الوقف موثقًا");
    const withDoc = journey({ ...base, docs: { deed: 1, registration: 0 } });
    expect(withDoc.documented).toBe(true);
    expect(withDoc.stage).toBe(2);
    const registered = journey({ ...base, docs: { deed: 1, registration: 1 }, waqf: { ...base.waqf, registeredOn: "2026-10-10", status: "registered" } });
    expect(registered.status).toBe("ready_ops");
    expect(registered.stage).toBe(3);
  });

  it("drafting request states drive the status: in review, returned, ready for the next stage", () => {
    const base = facts({ wizard: finished, file: fileOk });
    expect(journey(base).status).toBe("data_complete");
    expect(journey({ ...base, requests: [{ id: "r", number: "REQ-1", code: "T03", status: "in_progress" }] }).status).toBe("in_review");
    expect(journey({ ...base, requests: [{ id: "r", number: "REQ-1", code: "T03", status: "awaiting_client" }] }).status).toBe("returned");
    expect(journey({ ...base, requests: [{ id: "r", number: "REQ-1", code: "T03", status: "completed" }] }).status).toBe("ready_next");
  });

  it("editing earlier data reopens the step and brings the stage back", () => {
    const base = facts({ wizard: finished, file: fileOk, docs: { deed: 1, registration: 1 }, waqf: { ...facts().waqf, deedNo: "1", documentedOn: "2026-01-01", registeredOn: "2026-02-01", status: "registered" } });
    expect(journey(base).stage).toBe(3);
    const reopened = journey({ ...base, file: { ...fileOk, assetGaps: [{ id: "a1", title: "عمارة", missing: ["المدينة"] }] } });
    expect(reopened.stage).toBe(1);
    expect(reopened.gaps.find((g) => g.key === "assets:a1")?.href).toBe("/app/w/w1/assets/a1?edit=1#edit");
  });

  it("progress counts only steps proven by records", () => {
    const j = journey(facts({ wizard: finished, file: fileOk }));
    expect(j.progress.done).toBe(j.steps.filter((s) => s.state === "done").length);
    expect(j.progress.pct).toBeLessThan(100);
  });

  it("first incomplete wizard step", () => {
    expect(firstIncompleteWizardStep({ completed: [1, 2, 4], missing: [] })).toBe(3);
    expect(firstIncompleteWizardStep({ completed: [1, 2, 3, 4, 5, 6, 7], missing: [{ step: 3 }] })).toBe(3);
  });
});

describe("asset types", () => {
  it("every supported type has its own fields, labels and documents", () => {
    for (const c of ASSET_CATEGORIES) {
      const t = ASSET_TYPES[c];
      expect(t.fields.length).toBeGreaterThan(2);
      expect(t.docs.length).toBeGreaterThan(0);
    }
    expect(ASSET_TYPES.real_estate.ownershipDoc?.required).toBe(true);
    for (const c of ["cash", "shares", "fund_units", "portfolio", "sukuk", "movable"] as const) expect(ASSET_TYPES[c].ownershipDoc).toBeNull();
  });

  it("real estate: deed, city, area required; other types' data is dropped", () => {
    const r = checkAsset({ category: "real_estate", title: "عمارة", value: "1000000", ownershipDocNo: "", sharePct: "", held: "on", details: { city: "الرياض", quantity: "5", propertyType: "residential_building" } });
    expect(r.missing).toEqual(["المساحة (م²)", "رقم صك الملكية"]);
    expect(r.asset.details).toEqual({ propertyType: "residential_building", city: "الرياض" });
  });

  it("a portfolio keeps only the last four digits of its reference and never asks for a deed", () => {
    const bad = checkAsset({ category: "portfolio", title: "محفظة", value: "", ownershipDocNo: "999", sharePct: "50", held: "off", details: { institution: "شركة وساطة", portfolioRef: "1234567890", management: "discretionary" } });
    expect(bad.errors.join(" ")).toContain("آخر 4 أرقام");
    const ok = checkAsset({ category: "portfolio", title: "محفظة", value: "", ownershipDocNo: "999", sharePct: "50", held: "off", details: { institution: "شركة وساطة", portfolioRef: "7890", management: "discretionary" } });
    expect(ok.errors).toEqual([]);
    expect(ok.missing).toEqual([]);
    expect(ok.asset.ownershipDocNo).toBe("");
    expect(ok.asset.sharePct).toBe("");
    expect(assetDetailRows("portfolio", ok.asset.details).find((x) => x.label.includes("مرجع"))?.value).toBe("••••7890");
  });

  it("movable needs quantity, unit and location; cash needs the amount; formats are enforced", () => {
    expect(checkAsset({ category: "movable", title: "مكتبة", value: "", ownershipDocNo: "", sharePct: "", held: "off", details: { movableCategory: "books" } }).missing).toEqual(["الكمية", "الوحدة", "مكان المنقول"]);
    expect(checkAsset({ category: "cash", title: "مبلغ", value: "", ownershipDocNo: "", sharePct: "", held: "off", details: { currency: "SAR", holding: "bank_account" } }).missing).toEqual(["المبلغ"]);
    expect(checkAsset({ category: "shares", title: "أسهم", value: "", ownershipDocNo: "", sharePct: "", held: "off", details: { issuer: "x", market: "nasdaq", quantity: "-1" } }).errors.length).toBe(2);
    expect(checkAsset({ category: "usufruct", title: "منفعة", value: "", ownershipDocNo: "", sharePct: "", held: "off", details: { sourceAsset: "محل", assetOwner: "س", startsOn: "2027-01-01", endsOn: "2026-01-01" } }).errors).toContain("نهاية المنفعة قبل بدايتها.");
  });

  it("summaries describe each type by its own facts", () => {
    expect(assetSummary("real_estate", { propertyType: "land", city: "جدة", areaSqm: "500" })).toBe("أرض في جدة مساحته 500 م²");
    expect(assetSummary("shares", { quantity: "100", issuer: "شركة", market: "tadawul" })).toBe("100 سهمًا في شركة (السوق الرئيسية (تداول))");
  });
});

describe("wizard: typed assets and the board", () => {
  it("older drafts keep their assets, and what their type needs is listed (not invented)", () => {
    const st = normalizeState({ ...emptyState("واقف"), assets: [{ category: "real_estate", title: "أرض", ownershipDocNo: "1", value: "", inFounderName: "on", sharePct: "" }] });
    expect(st.assets[0].details).toEqual({});
    expect(missingItems(st).find((m) => m.step === 3)?.text).toContain("ينقص نوع العقار");
  });

  it("a board needs three members with one chair; the deed names them with their roles", () => {
    const st = emptyState("واقف");
    st.nazara.mode = "board";
    st.nazara.members = [{ name: "أ", role: "chair", independent: "off", capacity: "", email: "", phone: "" }, { name: "ب", role: "member", independent: "on", capacity: "", email: "", phone: "" }];
    expect(missingItems(st).some((m) => m.text.includes("2 من 3"))).toBe(true);
    st.nazara.members.push({ name: "ج", role: "secretary", independent: "off", capacity: "", email: "", phone: "" });
    expect(missingItems(st).some((m) => m.step === 5)).toBe(false);
    expect(buildDeedDraft(st, "2026-10-16")).toContain("مجلس نظارة من 3 أعضاء، هم: أ (رئيس المجلس)");
  });

  it("the deed cites a deed number only for real estate", () => {
    const st = emptyState("واقف");
    st.assets = [
      { category: "portfolio", title: "محفظة", ownershipDocNo: "", value: "100", inFounderName: "on", sharePct: "", details: { institution: "شركة", portfolioRef: "1234", management: "custody" } },
      { category: "real_estate", title: "أرض", ownershipDocNo: "4410", value: "", inFounderName: "on", sharePct: "", details: { propertyType: "land", city: "الرياض", areaSqm: "600" } },
    ];
    const t = buildDeedDraft(st, "2026-10-16");
    expect(t).toContain("محفظة استثمارية: محفظة، لدى شركة (مرجع ينتهي بـ 1234)");
    expect(t).toContain("بموجب صك الملكية رقم 4410");
    expect(t.match(/صك الملكية/g)?.length).toBe(1);
  });
});
