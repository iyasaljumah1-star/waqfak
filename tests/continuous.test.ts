import { describe, expect, it } from "vitest";
import {
  CONTINUOUS, CONTINUOUS_CODES, cycleCounts, cycleOutputKey, cyclePhase, endBlockers, isLate, nextPeriodic, parseCycleKey, periodOf, requestOutputs,
  schedule, clientPreference, closeBlockers, customDeliveries, parseCustomDates, termState, type ContinuousSnap, type CycleLike, type TermLike,
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

  it("presets a cadence only where its source states it; every other service is unset until the contract fixes it", () => {
    expect(CONTINUOUS.F03.cadence).toBe("monthly"); // catalog: «قيود شهرية»
    expect(CONTINUOUS.I07.cadence).toBe("quarterly"); // catalog: «تقرير ربعي»
    expect(CONTINUOUS.N02.cadence).toBe("event");
    expect(CONTINUOUS.N05.cadence).toBe("event");
    for (const code of ["N01", "N03", "F08", "N04", "N06", "I09", "C06", "N07"]) {
      expect(CONTINUOUS[code].cadence, code).toBeNull();
      expect(CONTINUOUS[code].cadenceSource, code).toBeNull();
    }
    for (const code of CONTINUOUS_CODES.filter((c) => CONTINUOUS[c].cadence)) expect(CONTINUOUS[code].cadenceSource, code).toBeTruthy();
    // every service may be customized per contract, including contractual dates
    for (const code of ["N03", "F08", "C06"]) expect(CONTINUOUS[code].allowed).toEqual(expect.arrayContaining(["monthly", "quarterly", "semiannual", "annual", "custom"]));
    // the client's form answer is a hint, never applied by itself
    expect(clientPreference({ frequency: "irregular" })).toBe("event");
    expect(clientPreference({})).toBeNull();
  });

  it("client acceptance is set per service; fixed where the nature of the service sets it", () => {
    expect(CONTINUOUS.N01.acceptance).toEqual({ mode: "required", fixed: true });
    expect(CONTINUOUS.N05.acceptance).toEqual({ mode: "info", fixed: true });
    expect(CONTINUOUS.F08.acceptance.fixed).toBe(false);
    expect(CONTINUOUS.N01.deliveryRecord).toBe(true);
    expect(CONTINUOUS.N01.delivery).toMatchObject({ kind: "output", profile: "nazara_report", review: "independent" });
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
    expect(parseCycleKey(cycleOutputKey("I07", 3))).toEqual({ code: "I07", closing: false, record: false, seq: 3 });
    expect(parseCycleKey(cycleOutputKey("N01", 9, "closing"))).toEqual({ code: "N01", closing: true, record: false, seq: 9 });
    expect(parseCycleKey("N01.record@c2")).toEqual({ code: "N01", closing: false, record: true, seq: 2 });
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
    expect(cyclePhase({ status: "sent", outputKey: "k" }, { status: "approved" }, "output")).toBe("client_review");
    expect(cyclePhase({ status: "sent", outputKey: "k", clientDecision: "approved" }, { status: "approved" }, "output")).toBe("client_approved");
    expect(cyclePhase({ status: "open", outputKey: "k", clientDecision: "revision_requested" }, { status: "approved" }, "output")).toBe("client_revision");
    expect(cyclePhase({ status: "open", outputKey: "k", clientDecision: "revision_requested" }, { status: "draft" }, "output")).toBe("preparing");
    expect(cyclePhase({ status: "open", outputKey: "k", clientDecision: "revision_requested" }, { status: "approved", reapproved: true }, "output")).toBe("approved");
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
    expect(key(cs({ cycles: [cy({ outputId: "o1", phase: "client_approved", closeBlockers: [] })] }))).toBe("close_cycle");
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

describe("contractual dates, client acceptance and closing", () => {
  it("custom cadence: contractual dates in order, within the term, open from the term's start", () => {
    const t = term({ cadence: "custom", customDates: [{ label: "تقرير الخطة", due: "2026-06-30" }, { label: "تقرير التأسيس", due: "2026-02-15" }, { label: "بعد الإنهاء", due: "2027-03-01" }] });
    expect(customDeliveries(t).map((x) => x.label)).toEqual(["تقرير التأسيس", "تقرير الخطة"]);
    expect(periodOf(t, 1)).toMatchObject({ label: "تقرير التأسيس", from: "2026-01-01", due: "2026-02-15" });
    expect(nextPeriodic(t, [cyc(1)])?.label).toBe("تقرير الخطة");
    expect(schedule(t)).toHaveLength(2);
    const parsed = parseCustomDates("2026-03-31 | تسليم المرحلة الأولى\nخطأ\n2026-05-01 | ب");
    expect(parsed.dates).toEqual([{ label: "تسليم المرحلة الأولى", due: "2026-03-31" }]);
    expect(parsed.errors).toHaveLength(2);
  });

  it("an event-only term has no schedule: no fabricated dates", () => {
    expect(schedule(term({ cadence: "event" }))).toEqual([]);
  });

  it("a cycle never closes on the client's silence when acceptance is required", () => {
    const base = { status: "sent", clientDecision: null, checklist: [{ done: true, label: "x" }] };
    const opts = { acceptance: "required" as const, needsOutput: true, recordRequired: false, recordApproved: false };
    expect(closeBlockers(base, opts).join(" ")).toContain("لا يُعد سكوته اعتمادًا");
    expect(closeBlockers({ ...base, clientDecision: "revision_requested" }, opts).join(" ")).toContain("طلب العميل تعديل");
    expect(closeBlockers({ ...base, clientDecision: "approved" }, opts)).toEqual([]);
    expect(closeBlockers(base, { ...opts, acceptance: "info" })).toEqual([]);
    expect(closeBlockers({ ...base, clientDecision: "approved" }, { ...opts, recordRequired: true })).toEqual(["محضر التسليم لم يُعتمد داخليًا بعد."]);
    expect(closeBlockers({ ...base, status: "open" }, opts)[0]).toContain("لم يُتح");
  });

  it("plan: awaiting the client is the client's step; a revision request sends the work back to the specialist", () => {
    const ID = "00000000-0000-4000-8000-000000000003";
    const snap = (c: Partial<ContinuousSnap["cycles"][number]>): Snapshot => ({
      id: ID, status: "in_progress", resumeTo: null, holdParty: null, holdLabel: null, paid: false, conflictBlocked: false, assigneeName: null,
      viewer: { id: "u1", isOps: true, isAssignee: false, canDeliver: true, canQA: true, canApproveQuote: true, canApproveContract: true, isDeliverer: false },
      intake: { legacy: false, invalidFields: [], missingDocs: [], unverifiedDocs: [], verified: true, accepted: true }, items: { clientOpen: 0, awaitingReview: 0, internalOpen: 0 },
      quote: null, contract: null, prestart: [], stages: [{ key: "onboarding", name: "ت", status: "done" }, { key: "running", name: "ش", status: "active" }], canAdvanceStage: false,
      outputs: [], deliverables: { submitted: 0, unsignedOpinion: 0 }, opinion: false, selfQA: false, waqf: { linked: true, name: "و" },
      continuous: { hasTerm: true, termState: "active", termLabel: "سارية", cadence: "ربع سنوية", deliveryKind: "output", next: null, canOpenNext: false, closingDue: false, endBlockers: ["x"],
        cycles: [{ id: "c", seq: 1, label: "الربع 1", due: "2026-04-15", late: false, phase: "client_review", kind: "periodic", outputKey: "F08.cycle@c1", outputId: "o", outputStatus: "approved", returnedNote: null, blocking: [], unwritten: [], viewerCanApprove: false, inputsMissing: [], checklistOpen: 0, closeBlockers: ["لم يعتمد العميل التسليم بعد (لا يُعد سكوته اعتمادًا)."], ...c }] },
    });
    const waiting = planRequest(snap({}));
    expect(waiting.current?.owner).toBe("client");
    expect(waiting.primary).toBeNull();
    const back = planRequest(snap({ phase: "client_revision", clientNote: "أضف المقارنة" }));
    expect(back.current?.blockers[0].text).toContain("أضف المقارنة");
    expect(back.primary).toMatchObject({ kind: "link", href: `/admin/requests/${ID}/outputs/o` });
    const rec = planRequest(snap({ phase: "client_approved", closeBlockers: ["محضر التسليم لم يُعتمد داخليًا بعد."], record: { key: "N01.record@c1", outputId: null, status: null, viewerCanApprove: false, blocking: [], unwritten: [] } }));
    expect(rec.primary).toMatchObject({ kind: "run", key: "generate_output", args: { outputKey: "N01.record@c1" } });
  });
});
