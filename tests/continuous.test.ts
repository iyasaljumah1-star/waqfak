import { describe, expect, it } from "vitest";
import {
  CONTINUOUS, CONTINUOUS_CODES, cycleCounts, cycleOutputKey, cyclePhase, endBlockers, isLate, nextPeriodic, parseCycleKey, periodOf, requestOutputs,
  schedule, suggestedCadence, termState, type ContinuousSnap, type CycleLike, type TermLike,
} from "@/server/modules/operations/continuous-pure";
import { guardTransition, appliesTo, findTransition } from "@/server/modules/requests/workflow";
import { planRequest, type Snapshot } from "@/server/modules/operations/next-step";
import { SERVICES } from "@/server/seed/data/services";

const term = (p: Partial<TermLike> = {}): TermLike => ({ cadence: "monthly", startOn: "2026-01-01", endOn: "2026-12-31", dueOffsetDays: 10, status: "active", terminatedOn: null, ...p });
const cyc = (seq: number, p: Partial<CycleLike> = {}): CycleLike => ({ id: `c${seq}`, seq, kind: "periodic", label: `p${seq}`, periodStart: null, periodEnd: null, dueOn: "2026-02-10", status: "open", outputKey: cycleOutputKey("F03", seq), ...p });

describe("continuous services registry", () => {
  it("covers exactly the 12 services whose workflow is «subscription»", () => {
    const subs = SERVICES.filter((s) => s.workflow === "subscription").map((s) => s.code).sort();
    expect(subs).toHaveLength(12);
    expect([...CONTINUOUS_CODES].sort()).toEqual(subs);
  });

  it("does not impose one monthly cycle on all services", () => {
    const cadences = new Set(CONTINUOUS_CODES.map((c) => CONTINUOUS[c].cadence));
    expect(cadences.size).toBeGreaterThanOrEqual(4);
    expect(CONTINUOUS.F03.cadence).toBe("monthly"); // catalog: «قيود شهرية»
    expect(CONTINUOUS.I07.cadence).toBe("quarterly"); // catalog: «تقرير ربعي»
    expect(suggestedCadence(CONTINUOUS.I07, {})).toBe("quarterly");
    expect(suggestedCadence(CONTINUOUS.N07, { frequency: "irregular" })).toBe("event");
    expect(suggestedCadence(CONTINUOUS.F03, { frequency: "annual" })).toBe("monthly"); // not allowed → the service default
  });

  it("a service with no periodic document gets a follow-up record, not a fabricated report", () => {
    expect(CONTINUOUS.N02.delivery.kind).toBe("followup");
    expect(CONTINUOUS.N05.delivery.kind).toBe("minutes");
  });

  it("only N01 keeps its one-off onboarding output; existing outputs of a request are never hidden", () => {
    expect(requestOutputs({ code: "N01", outputs: "x" })).toHaveLength(1);
    expect(requestOutputs({ code: "F03", outputs: "دفاتر" })).toHaveLength(0);
    expect(requestOutputs({ code: "F03", outputs: "دفاتر" }, ["F03.main"])).toHaveLength(1);
    expect(requestOutputs({ code: "W01", outputs: "وصية" })).toHaveLength(1);
  });

  it("cycle output keys round-trip", () => {
    expect(parseCycleKey(cycleOutputKey("I07", 3))).toEqual({ code: "I07", closing: false, seq: 3 });
    expect(parseCycleKey(cycleOutputKey("N01", 9, "closing"))).toEqual({ code: "N01", closing: true, seq: 9 });
    expect(parseCycleKey("F03.main")).toBeNull();
  });
});

describe("schedule", () => {
  it("monthly periods are calendar months with a due offset", () => {
    const p = periodOf(term(), 1)!;
    expect(p).toMatchObject({ from: "2026-01-01", to: "2026-01-31", due: "2026-02-10", label: "يناير 2026" });
    expect(schedule(term())).toHaveLength(12);
  });

  it("quarterly periods, and the last one is clipped to the term", () => {
    const t = term({ cadence: "quarterly", startOn: "2026-02-15", endOn: "2026-09-30" });
    const s = schedule(t);
    expect(s.map((x) => [x.from, x.to])).toEqual([["2026-02-15", "2026-05-14"], ["2026-05-15", "2026-08-14"], ["2026-08-15", "2026-09-30"]]);
  });

  it("termination cuts the schedule at the effective date", () => {
    const t = term({ status: "terminated", terminatedOn: "2026-03-20" });
    expect(schedule(t).map((x) => x.to)).toEqual(["2026-01-31", "2026-02-28", "2026-03-20"]);
  });

  it("next periodic follows the cycles already opened; events have no schedule", () => {
    expect(nextPeriodic(term(), [cyc(1), cyc(2)])?.n).toBe(3);
    expect(nextPeriodic(term({ cadence: "event" }), [])).toBeNull();
  });
});

describe("states", () => {
  it("a cycle's phase follows its output; approval is not sending", () => {
    expect(cyclePhase({ status: "open", outputKey: "k" }, null, "output")).toBe("preparing");
    expect(cyclePhase({ status: "open", outputKey: "k" }, { status: "returned" }, "output")).toBe("returned");
    expect(cyclePhase({ status: "open", outputKey: "k" }, { status: "approved" }, "output")).toBe("approved");
    expect(cyclePhase({ status: "sent", outputKey: "k" }, { status: "approved" }, "output")).toBe("sent");
    expect(cyclePhase({ status: "open", outputKey: null }, null, "followup")).toBe("followup");
  });

  it("lateness: open past due, not while suspended, not once sent", () => {
    expect(isLate({ status: "open", dueOn: "2026-02-10" }, "2026-02-11", "active")).toBe(true);
    expect(isLate({ status: "open", dueOn: "2026-02-10" }, "2026-02-11", "suspended")).toBe(false);
    expect(isLate({ status: "sent", dueOn: "2026-02-10" }, "2026-03-01", "active")).toBe(false);
    const counts = cycleCounts([{ c: { status: "open", dueOn: "2026-02-10" }, phase: "in_review" }, { c: { status: "closed", dueOn: "2026-01-10" }, phase: "closed" }], "2026-03-01", "active");
    expect(counts).toMatchObject({ done: 1, late: 1, pending: 1, awaitingReview: 1 });
  });

  it("term state: ended is derived from the end date", () => {
    expect(termState(term(), "2026-06-01")).toBe("active");
    expect(termState(term(), "2027-01-01")).toBe("ended");
    expect(termState(term({ status: "suspended" }), "2026-06-01")).toBe("suspended");
  });

  it("the service ends only when its term is over and every period is delivered or skipped", () => {
    const t = term({ cadence: "quarterly" });
    expect(endBlockers(CONTINUOUS.F08, t, [], "2026-06-01")[0]).toContain("سارية");
    const ended = endBlockers(CONTINUOUS.F08, t, [cyc(1, { status: "closed" })], "2027-01-05");
    expect(ended.join(" ")).toContain("فترات بلا دورة");
    const all = [1, 2, 3, 4].map((n) => cyc(n, { status: n === 4 ? "skipped" : "closed" }));
    expect(endBlockers(CONTINUOUS.F08, t, all, "2027-01-05")).toEqual([]);
    expect(endBlockers(CONTINUOUS.F08, t, [...all.slice(0, 3), cyc(4, { status: "sent" })], "2027-01-05").join(" ")).toContain("لم تُقفل");
  });

  it("N01 also needs its handover delivery before it ends", () => {
    const t = term({ cadence: "annual", status: "terminated", terminatedOn: "2026-05-01" });
    const one = [cyc(1, { status: "closed" })];
    expect(endBlockers(CONTINUOUS.N01, t, one, "2026-06-01").join(" ")).toContain("محضر تسليم");
    expect(endBlockers(CONTINUOUS.N01, t, [...one, cyc(2, { kind: "closing", status: "closed" })], "2026-06-01")).toEqual([]);
  });
});

describe("request workflow for continuous services", () => {
  const base = { from: "in_progress" as const, actorUserId: "u", conflictCheck: "passed", workflowCode: "subscription", deliverers: [], submittedDeliverables: 1, unsignedOpinionDeliverables: 0, contractSignedByClient: true, hasContract: true, quoteAmount: 1, pricingModel: "subscription" };
  it("approving a delivery never closes the request: the QA path is closed to continuous services", () => {
    expect(guardTransition({ ...base, to: "quality_review", continuous: { endBlockers: [] } })).toContain("خدمة مستمرة");
    expect(appliesTo({ from: "in_progress", to: "quality_review" }, true)).toBe(false);
  });
  it("the service ends with its term only", () => {
    expect(findTransition("in_progress", "completed")).toBeTruthy();
    expect(guardTransition({ ...base, to: "completed", continuous: { endBlockers: ["سارية"] } })).toContain("لا تُنهى");
    expect(guardTransition({ ...base, to: "completed", continuous: { endBlockers: [] } })).toBeNull();
    expect(guardTransition({ ...base, workflowCode: "standard", to: "completed", continuous: null })).toBeTruthy();
    expect(appliesTo({ from: "in_progress", to: "completed" }, false)).toBe(false);
  });
});

describe("execution plan of a continuous service", () => {
  const ID = "00000000-0000-4000-8000-000000000002";
  const cs = (p: Partial<ContinuousSnap> = {}): ContinuousSnap => ({
    hasTerm: true, termState: "active", termLabel: "سارية", cadence: "شهرية", deliveryKind: "output", next: null, canOpenNext: false, closingDue: false, cycles: [], endBlockers: ["سارية"], ...p,
  });
  const cy = (p: Partial<ContinuousSnap["cycles"][number]> = {}): ContinuousSnap["cycles"][number] => ({
    id: "cy1", seq: 1, label: "يناير 2026", due: "2026-02-10", late: false, phase: "preparing", kind: "periodic", outputKey: "F03.cycle@c1", outputId: null, outputStatus: null,
    returnedNote: null, blocking: [], unwritten: [], viewerCanApprove: true, inputsMissing: [], checklistOpen: 0, ...p,
  });
  const snap = (k: ContinuousSnap): Snapshot => ({
    id: ID, status: "in_progress", resumeTo: null, holdParty: null, holdLabel: null, paid: true, conflictBlocked: false, assigneeName: null,
    viewer: { id: "u1", isOps: true, isAssignee: false, canDeliver: true, canQA: true, canApproveQuote: true, canApproveContract: true, isDeliverer: false, canApproveInvoice: true },
    intake: { legacy: false, invalidFields: [], missingDocs: [], unverifiedDocs: [], verified: true, accepted: true },
    items: { clientOpen: 0, awaitingReview: 0, internalOpen: 0 }, quote: { id: "q", status: "accepted", preparedByViewer: false, expired: false },
    contract: { id: "k", status: "signed", byViewer: false, pendingClient: [], companyPending: false, executed: true, clientSigned: true }, prestart: [],
    stages: [{ key: "onboarding", name: "التهيئة", status: "done" }, { key: "running", name: "التشغيل", status: "active" }], canAdvanceStage: false,
    outputs: [], deliverables: { submitted: 0, unsignedOpinion: 0 }, opinion: false, selfQA: false, waqf: { linked: true, name: "و" }, continuous: k,
  });
  const key = (k: ContinuousSnap) => { const p = planRequest(snap(k)); return p.primary?.kind === "run" ? p.primary.key : p.primary?.kind === "link" ? "link" : null; };

  it("no term yet → set it from the contract", () => {
    const p = planRequest(snap(cs({ hasTerm: false })));
    expect(p.current?.key).toBe("term");
    expect(p.steps.some((s) => s.key === "quality")).toBe(false);
  });
  it("prepare → submit → approve → send → close, then the next cycle; the request never goes to QA", () => {
    expect(key(cs({ cycles: [cy()] }))).toBe("generate_output");
    expect(key(cs({ cycles: [cy({ outputId: "o1", outputStatus: "draft" })] }))).toBe("submit_output");
    expect(key(cs({ cycles: [cy({ outputId: "o1", phase: "in_review" })] }))).toBe("approve_output");
    expect(key(cs({ cycles: [cy({ outputId: "o1", phase: "approved" })] }))).toBe("send_cycle");
    expect(key(cs({ cycles: [cy({ outputId: "o1", phase: "sent" })] }))).toBe("close_cycle");
    expect(key(cs({ cycles: [cy({ phase: "closed" })], next: { label: "فبراير 2026", due: "2026-03-10" }, canOpenNext: true }))).toBe("open_cycle");
  });
  it("a returned draft shows the reviewer's note and links to the editor", () => {
    const p = planRequest(snap(cs({ cycles: [cy({ outputId: "o1", phase: "returned", returnedNote: "صحح الأرقام" })] })));
    expect(p.current?.blockers[0].text).toContain("صحح الأرقام");
    expect(p.primary?.kind).toBe("link");
  });
  it("the end-of-service step appears only when nothing blocks it", () => {
    expect(key(cs({ termState: "ended", endBlockers: [] }))).toBe("end_service");
    const p = planRequest(snap(cs({ termState: "ended", endBlockers: ["فترات بلا دورة: x"] })));
    expect(p.steps.find((s) => s.key === "end_service")?.state).toBe("blocked");
  });
});
