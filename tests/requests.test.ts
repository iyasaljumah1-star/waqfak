import { describe, expect, it } from "vitest";
import {
  actorsFor, advanceStage, availableTransitions, canTransition, evaluateConflict, findTransition, guardTransition,
  planStages, TRANSITIONS, type GuardInput, type PlanStage, type RequestStatus,
} from "../src/server/modules/requests/workflow";
import { computeInvoice, decodeTlv, fillTemplate, zatcaTlvBase64 } from "../src/server/modules/billing/calc";

const ALL: RequestStatus[] = ["draft", "submitted", "triage", "awaiting_client", "quote", "awaiting_contract", "in_progress", "quality_review", "awaiting_client_approval", "completed", "closed", "on_hold", "cancelled", "rejected"];

describe("transition table", () => {
  it("follows the main happy path", () => {
    const path: [RequestStatus, RequestStatus, "client" | "assignee" | "reviewer" | "ops"][] = [
      ["draft", "submitted", "client"], ["submitted", "triage", "assignee"], ["triage", "quote", "assignee"],
      ["quote", "awaiting_contract", "client"], ["awaiting_contract", "in_progress", "assignee"], ["in_progress", "quality_review", "assignee"],
      ["quality_review", "awaiting_client_approval", "reviewer"], ["awaiting_client_approval", "completed", "client"], ["completed", "closed", "ops"],
    ];
    for (const [f, t, a] of path) expect(canTransition(f, t, [a]), `${f}→${t} by ${a}`).toBe(true);
  });

  it("terminal statuses have no exits", () => {
    for (const s of ["closed", "cancelled", "rejected"] as RequestStatus[]) expect(TRANSITIONS.filter((t) => t.from === s)).toHaveLength(0);
  });

  it("every transition uses known statuses and has at least one actor", () => {
    for (const t of TRANSITIONS) {
      expect(ALL).toContain(t.from);
      expect(ALL).toContain(t.to);
      expect(t.by.length).toBeGreaterThan(0);
    }
  });

  it("no duplicate transitions", () => {
    const keys = TRANSITIONS.map((t) => `${t.from}>${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("clients cannot do staff work and staff cannot approve on behalf of the client", () => {
    expect(canTransition("triage", "quote", ["client"])).toBe(false);
    expect(canTransition("in_progress", "quality_review", ["client"])).toBe(false);
    expect(canTransition("awaiting_client_approval", "completed", ["assignee", "ops"])).toBe(false);
    expect(canTransition("quote", "awaiting_contract", ["assignee"])).toBe(false);
  });

  it("quality review approval is reserved to a reviewer", () => {
    expect(canTransition("quality_review", "awaiting_client_approval", ["assignee"])).toBe(false);
    expect(canTransition("quality_review", "awaiting_client_approval", ["reviewer"])).toBe(true);
  });

  it("client may cancel only while early", () => {
    for (const s of ["submitted", "triage", "quote", "awaiting_contract", "awaiting_client"] as RequestStatus[]) expect(canTransition(s, "cancelled", ["client"])).toBe(true);
    for (const s of ["in_progress", "quality_review", "awaiting_client_approval", "completed"] as RequestStatus[]) expect(canTransition(s, "cancelled", ["client"])).toBe(false);
    expect(canTransition("in_progress", "cancelled", ["ops"])).toBe(true);
  });

  it("hold resumes only to the prior status", () => {
    const av = availableTransitions("on_hold", ["assignee"], { resumeTo: "in_progress" }).map((t) => t.to);
    expect(av).toEqual(["in_progress"]);
    expect(canTransition("in_progress", "on_hold", ["assignee"])).toBe(true);
    expect(canTransition("completed", "on_hold", ["ops"])).toBe(false);
  });

  it("notes are required for reject / hold / rework", () => {
    expect(findTransition("triage", "rejected")?.needsNote).toBe(true);
    expect(findTransition("in_progress", "on_hold")?.needsNote).toBe(true);
    expect(findTransition("awaiting_client_approval", "in_progress")?.needsNote).toBe(true);
  });
});

describe("guards", () => {
  const base: GuardInput = {
    from: "triage", to: "quote", actorUserId: "u1", conflictCheck: "passed", workflowCode: "standard", deliverers: [],
    submittedDeliverables: 0, unsignedOpinionDeliverables: 0, contractSignedByClient: false, hasContract: false, quoteAmount: 1000, pricingModel: "quote",
  };
  it("blocks work while conflict is blocked; allows after override", () => {
    expect(guardTransition({ ...base, conflictCheck: "blocked" })).toMatch(/تعارض/);
    expect(guardTransition({ ...base, conflictCheck: "override_approved" })).toBeNull();
  });
  it("needs a quote amount", () => expect(guardTransition({ ...base, quoteAmount: null })).toMatch(/عرض السعر/));
  it("needs a signed contract before work", () => {
    expect(guardTransition({ ...base, from: "awaiting_contract", to: "in_progress" })).toMatch(/توقيع/);
    expect(guardTransition({ ...base, from: "awaiting_contract", to: "in_progress", contractSignedByClient: true })).toBeNull();
  });
  it("four eyes: deliverer cannot pass QA", () => {
    const g = { ...base, from: "quality_review" as const, to: "awaiting_client_approval" as const, deliverers: ["u1"] };
    expect(guardTransition(g)).toMatch(/العينين/);
    expect(guardTransition({ ...g, actorUserId: "u2" })).toBeNull();
  });
  it("opinions must be signed", () => {
    const g = { ...base, from: "quality_review" as const, to: "awaiting_client_approval" as const, actorUserId: "u2", workflowCode: "opinion", unsignedOpinionDeliverables: 1 };
    expect(guardTransition(g)).toMatch(/موقّع/);
  });
  it("needs a deliverable before QA", () => expect(guardTransition({ ...base, from: "in_progress", to: "quality_review" })).toMatch(/مخرج/));
});

describe("actors", () => {
  it("deliverer is not a reviewer", () => {
    expect(actorsFor({ userId: "u1", isRequester: false, memberCanCreate: false, isAssignee: true, perms: ["staff.requests.assigned", "staff.quality_review"], deliverers: ["u1"] })).toEqual(["assignee"]);
    expect(actorsFor({ userId: "u2", isRequester: false, memberCanCreate: false, isAssignee: false, perms: ["staff.quality_review", "admin.requests.all"], deliverers: ["u1"] })).toEqual(["reviewer", "ops"]);
  });
  it("assignee needs the staff permission", () => {
    expect(actorsFor({ userId: "u1", isRequester: true, memberCanCreate: false, isAssignee: true, perms: [], deliverers: [] })).toEqual(["client"]);
  });
});

describe("stage planning", () => {
  const std: PlanStage[] = [
    { key: "intake", role: "account_manager", status: "pending" },
    { key: "analysis", role: "consultant", status: "pending" },
    { key: "drafting", role: "consultant", status: "pending" },
    { key: "qa", role: "quality", status: "pending" },
    { key: "client_review", role: "client", clientApproval: true, status: "pending" },
  ];
  const apply = (st: PlanStage[], s: string[]) => st.map((x, i) => ({ ...x, status: s[i] as PlanStage["status"] }));

  it("walks the standard workflow", () => {
    let s = apply(std, planStages(std, "draft", "submitted"));
    expect(s.map((x) => x.status)).toEqual(["active", "pending", "pending", "pending", "pending"]);
    s = apply(s, planStages(s, "triage", "in_progress"));
    expect(s.map((x) => x.status)).toEqual(["done", "active", "pending", "pending", "pending"]);
    s = apply(s, advanceStage(s)!);
    expect(s.map((x) => x.status)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(advanceStage(s)).toBeNull(); // cannot advance into QA manually
    s = apply(s, planStages(s, "in_progress", "quality_review"));
    expect(s.map((x) => x.status)).toEqual(["done", "done", "done", "active", "pending"]);
    const back = planStages(s, "quality_review", "in_progress");
    expect(back).toEqual(["done", "done", "active", "pending", "pending"]);
    s = apply(s, planStages(s, "quality_review", "awaiting_client_approval"));
    expect(s.map((x) => x.status)).toEqual(["done", "done", "done", "done", "active"]);
    expect(planStages(s, "awaiting_client_approval", "completed")).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("cancel skips unfinished stages", () => {
    const s = apply(std, ["done", "active", "pending", "pending", "pending"]);
    expect(planStages(s, "in_progress", "cancelled")).toEqual(["done", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("opinion workflow: delivery active after QA", () => {
    const op: PlanStage[] = [
      { key: "intake", role: "account_manager", status: "done" }, { key: "study", role: "consultant", status: "done" },
      { key: "qa", role: "quality", status: "active" }, { key: "delivery", role: "consultant", status: "pending" },
    ];
    expect(planStages(op, "quality_review", "awaiting_client_approval")).toEqual(["done", "done", "done", "active"]);
  });
});

describe("conflict of interest", () => {
  it("G09 is blocked when Waqfak is nazir", () => {
    expect(evaluateConflict({ rule: "blocked_if_waqfak_nazir", waqfakRole: "nazir", openServiceCodes: [], hasWaqf: true }).result).toBe("blocked");
    expect(evaluateConflict({ rule: "blocked_if_waqfak_nazir", waqfakRole: "none", openServiceCodes: ["N01"], hasWaqf: true }).result).toBe("blocked");
    expect(evaluateConflict({ rule: "blocked_if_waqfak_nazir", waqfakRole: "advisor", openServiceCodes: [], hasWaqf: true }).result).toBe("passed");
  });
  it("audit services are blocked when Waqfak controls finance", () => {
    for (const r of ["nazir", "delegated_manager", "bookkeeper"]) expect(evaluateConflict({ rule: "blocked_if_waqfak_controls_finance", waqfakRole: r, openServiceCodes: [], hasWaqf: true }).result).toBe("blocked");
    expect(evaluateConflict({ rule: "blocked_if_waqfak_controls_finance", waqfakRole: "none", openServiceCodes: ["F03"], hasWaqf: true }).result).toBe("blocked");
    const ok = evaluateConflict({ rule: "blocked_if_waqfak_controls_finance", waqfakRole: "advisor", openServiceCodes: ["G01"], hasWaqf: true });
    expect(ok).toEqual({ result: "passed", note: null });
  });
  it("bookkeeping only inside nazara", () => {
    expect(evaluateConflict({ rule: "inside_nazara_only", waqfakRole: "nazir", openServiceCodes: [], hasWaqf: true }).result).toBe("passed");
    expect(evaluateConflict({ rule: "inside_nazara_only", waqfakRole: "none", openServiceCodes: [], hasWaqf: true }).result).toBe("blocked");
  });
});

describe("billing", () => {
  it("computes VAT at 15%", () => {
    expect(computeInvoice(1000, 15)).toEqual({ subtotal: 1000, discount: 0, net: 1000, vat: 150, total: 1150 });
    expect(computeInvoice(333.33, 15).vat).toBe(50);
  });
  it("encodes ZATCA TLV and decodes back (Arabic seller name)", () => {
    const b64 = zatcaTlvBase64({ sellerName: "شركة وقفك", vatNumber: "300000000000003", timestamp: "2026-10-07T10:00:00Z", total: "1150.00", vat: "150.00" });
    expect(decodeTlv(b64)).toEqual(["شركة وقفك", "300000000000003", "2026-10-07T10:00:00Z", "1150.00", "150.00"]);
    const buf = Buffer.from(b64, "base64");
    expect(buf[0]).toBe(1);
    expect(buf[1]).toBe(Buffer.byteLength("شركة وقفك"));
  });
  it("fills contract placeholders", () => {
    expect(fillTemplate("عقد {{number}} مع {{ client_name }}{{missing}}", { number: "CTR-000001", client_name: "س" })).toBe("عقد CTR-000001 مع س");
  });
});
