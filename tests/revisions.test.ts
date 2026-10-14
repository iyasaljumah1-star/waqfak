import { describe, expect, it } from "vitest";
import { reopenStagePlan, revisionImpact, rollbackOptions } from "@/server/modules/operations/revisions-pure";
import { planRequest, type Snapshot } from "@/server/modules/operations/next-step";

describe("going back to an earlier point", () => {
  it("offers only the points the status allows", () => {
    expect(rollbackOptions({ status: "triage", hasSentQuote: false, workStages: [] }).map((o) => o.target)).toEqual(["intake"]);
    expect(rollbackOptions({ status: "triage", hasSentQuote: true, workStages: [] })).toEqual([]);
    expect(rollbackOptions({ status: "quote", hasSentQuote: true, workStages: [] }).map((o) => o.target)).toEqual(["scope"]);
    const qa = rollbackOptions({ status: "awaiting_client_approval", hasSentQuote: true, workStages: [] });
    expect(qa).toMatchObject([{ target: "execution", opsOnly: true }]);
    expect(rollbackOptions({ status: "quality_review", hasSentQuote: false, workStages: [] })[0].opsOnly).toBe(false);
    const st = rollbackOptions({ status: "in_progress", hasSentQuote: false, workStages: [{ key: "analysis", name: "الدراسة", status: "done" }, { key: "drafting", name: "الإعداد", status: "active" }] });
    expect(st.map((o) => o.target)).toEqual(["stage:analysis"]);
    expect(rollbackOptions({ status: "closed", hasSentQuote: false, workStages: [] })).toEqual([]);
  });

  it("reopens a done stage: target active, those after it back to pending, earlier untouched", () => {
    const stages = [{ key: "intake", status: "done" }, { key: "analysis", status: "done" }, { key: "drafting", status: "active" }, { key: "qa", status: "pending" }];
    expect(reopenStagePlan(stages, "analysis")).toEqual(["done", "active", "pending", "pending"]);
    expect(reopenStagePlan(stages, "drafting")).toBeNull();
    expect(reopenStagePlan(stages, "qa")).toBeNull();
  });

  it("never erases: the impact names a correction path for each affected record", () => {
    const imp = revisionImpact({
      outputs: [{ id: "o1", title: "نص الوصية", status: "approved" }, { id: "o2", title: "مذكرة", status: "draft" }],
      quotes: [{ id: "q", number: "QUO-1", status: "accepted", kind: "initial" }],
      contracts: [{ id: "k", number: "CTR-1", status: "signed" }],
      invoices: [{ id: "i", number: "INV-1", status: "issued", kind: "tax_invoice" }, { id: "d", number: "DRF-1", status: "draft", kind: "tax_invoice" }, { id: "v", number: "INV-0", status: "void", kind: "tax_invoice" }],
      verified: true, accepted: true,
    }, "intake_edit");
    const by = (k: string) => imp.filter((x) => x.kind === k);
    expect(by("output")[0].action).toContain("مراجعة جديدة");
    expect(by("quote")[0].action).toContain("ملحق تعديل");
    expect(by("contract")[0].action).toContain("ملحق تعديل");
    expect(by("invoice").map((x) => x.action)).toEqual([expect.stringContaining("إشعار دائن"), expect.stringContaining("قبل الإرسال")]);
    expect(by("verification")).toHaveLength(1);
  });
});

describe("plan after the answers are corrected", () => {
  const base = (o: Partial<Snapshot["outputs"][number]>): Snapshot => ({
    id: "r", status: "in_progress", resumeTo: null, holdParty: null, holdLabel: null, paid: false, conflictBlocked: false, assigneeName: null,
    viewer: { id: "u", isOps: true, isAssignee: false, canDeliver: true, canQA: true, canApproveQuote: true, canApproveContract: true, isDeliverer: false },
    intake: { legacy: false, invalidFields: [], missingDocs: [], unverifiedDocs: [], verified: true, accepted: true },
    items: { clientOpen: 0, awaitingReview: 0, internalOpen: 0 }, quote: null, contract: null, prestart: [], stages: [], canAdvanceStage: false,
    outputs: [{ key: "X.main", title: "المخرج", specialty: "إداري", id: "o1", status: "draft", blocking: [], unwritten: [], viewerCanApprove: false, needsSignature: false, needsRevision: false, ...o }],
    deliverables: { submitted: 0, unsignedOpinion: 0 }, opinion: false, selfQA: false, waqf: { linked: true, name: "و" },
  });
  it("a stale draft is regenerated (human edits kept)", () => {
    const p = planRequest(base({ stale: true }));
    expect(p.primary).toEqual({ kind: "run", key: "generate_output", label: expect.stringContaining("أعد توليد"), args: { outputKey: "X.main", confirm: "on" } });
  });
  it("a stale approved output must be reopened before quality review", () => {
    const p = planRequest(base({ status: "approved", stale: true }));
    expect(p.current?.key).toBe("prep:X.main");
    expect(p.primary).toMatchObject({ kind: "link", href: "/admin/requests/r/outputs/o1" });
  });
});
