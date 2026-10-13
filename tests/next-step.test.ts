import { describe, expect, it } from "vitest";
import { planRequest, type Snapshot } from "@/server/modules/operations/next-step";

const ID = "00000000-0000-4000-8000-000000000001";

function snap(p: Partial<Snapshot> = {}): Snapshot {
  return {
    id: ID, status: "triage", resumeTo: null, holdParty: null, holdLabel: null, paid: false, conflictBlocked: false, assigneeName: null,
    viewer: { id: "u1", isOps: true, isAssignee: false, canDeliver: true, canQA: true, canApproveQuote: true, canApproveContract: true, isDeliverer: false },
    intake: { legacy: false, invalidFields: [], missingDocs: [], unverifiedDocs: [], verified: false, accepted: false },
    items: { clientOpen: 0, awaitingReview: 0, internalOpen: 0 },
    quote: null, contract: null, prestart: [],
    stages: [{ key: "intake", name: "الاستلام", status: "done" }, { key: "draft", name: "الصياغة", status: "pending" }, { key: "qa", name: "الجودة", status: "pending" }],
    canAdvanceStage: false,
    outputs: [{ key: "W01.main", title: "مسودة الوصية", specialty: "شرعي ووقفي", id: null, status: null, blocking: [], unwritten: [], viewerCanApprove: false, needsSignature: true, needsRevision: false }],
    deliverables: { submitted: 0, unsignedOpinion: 0 }, opinion: false, selfQA: false, waqf: { linked: false, name: null },
    ...p,
  };
}
const run = (s: Snapshot) => { const p = planRequest(s); return { ...p, key: p.primary?.kind === "run" ? p.primary.key : p.primary?.kind === "link" ? `link:${p.primary.href}` : null }; };

describe("execution plan", () => {
  it("a manager starts triage directly, with no assignment", () => {
    const p = run(snap({ status: "submitted" }));
    expect(p.current?.key).toBe("receive");
    expect(p.key).toBe("start_triage");
  });

  it("a staff member with no right on the request gets no action", () => {
    const p = run(snap({ status: "submitted", viewer: { ...snap().viewer, isOps: false, isAssignee: false } }));
    expect(p.primary).toBeNull();
  });

  it("uploaded but unverified documents block verification and point to the review", () => {
    const p = run(snap({ intake: { ...snap().intake, unverifiedDocs: ["صك الملكية"] } }));
    expect(p.current?.key).toBe("verify");
    expect(p.current?.state).toBe("blocked");
    expect(p.current?.blockers[0].text).toContain("صك الملكية");
    expect(p.key).toBe(`link:/admin/requests/${ID}#doc-review`);
  });

  it("missing client data means waiting on the client, not a team action", () => {
    const p = run(snap({ items: { clientOpen: 2, awaitingReview: 0, internalOpen: 0 } }));
    expect(p.current?.state).toBe("waiting");
    expect(p.current?.owner).toBe("client");
    expect(p.primary).toBeNull();
  });

  it("verify → accept → start (free service)", () => {
    expect(run(snap()).key).toBe("verify_intake");
    expect(run(snap({ intake: { ...snap().intake, verified: true } })).key).toBe("accept");
    expect(run(snap({ intake: { ...snap().intake, verified: true, accepted: true } })).key).toBe("start_work");
  });

  it("paid path: quote must be written by a human, then approved by someone else, then sent", () => {
    const base = { paid: true, intake: { ...snap().intake, verified: true, accepted: true } };
    expect(run(snap(base)).key).toBe(`link:/admin/requests/${ID}#quote`);
    const own = run(snap({ ...base, quote: { id: "q", status: "draft", preparedByViewer: true, expired: false } }));
    expect(own.primary).toBeNull();
    expect(own.current?.state).toBe("waiting");
    expect(run(snap({ ...base, quote: { id: "q", status: "draft", preparedByViewer: false, expired: false } })).key).toBe("approve_quote");
    expect(run(snap({ ...base, quote: { id: "q", status: "approved", preparedByViewer: true, expired: false } })).key).toBe("send_quote");
    expect(run(snap({ ...base, status: "quote", quote: { id: "q", status: "sent", preparedByViewer: true, expired: false } })).current?.owner).toBe("client");
  });

  it("paid path: contract, pre-start invoice and payment gate the start", () => {
    const base: Partial<Snapshot> = { paid: true, status: "awaiting_contract", intake: { ...snap().intake, verified: true, accepted: true }, quote: { id: "q", status: "accepted", preparedByViewer: false, expired: false } };
    expect(run(snap({ ...base, contract: { id: "k", status: "approved", byViewer: true, pendingClient: [], companyPending: false, executed: false, clientSigned: false } })).key).toBe("send_contract");
    const signed = { id: "k", status: "signed", byViewer: false, pendingClient: [], companyPending: false, executed: true, clientSigned: true };
    expect(run(snap({ ...base, contract: signed, prestart: [{ quoteId: "q", key: "t1", label: "دفعة مقدمة", invoiced: false, paid: false }] })).key).toBe("issue_invoice");
    const waiting = run(snap({ ...base, contract: signed, prestart: [{ quoteId: "q", key: "t1", label: "دفعة مقدمة", invoiced: true, paid: false }] }));
    expect(waiting.primary).toBeNull();
    expect(waiting.current?.owner).toBe("client");
    expect(run(snap({ ...base, contract: signed, prestart: [{ quoteId: "q", key: "t1", label: "دفعة مقدمة", invoiced: true, paid: true }] })).key).toBe("start_work");
  });

  const working: Partial<Snapshot> = { status: "in_progress", intake: { legacy: false, invalidFields: [], missingDocs: [], unverifiedDocs: [], verified: true, accepted: true } };

  it("in execution: generate the draft, then specialist gaps block submission with links", () => {
    expect(run(snap(working)).key).toBe("generate_output");
    const o = { ...snap().outputs[0], id: "o1", status: "draft" as const, blocking: [{ label: "اسم الموصي ناقص" }], unwritten: ["الرأي الشرعي"] };
    const p = run(snap({ ...working, outputs: [o] }));
    expect(p.current?.state).toBe("blocked");
    expect(p.current?.blockers.map((b) => b.who)).toEqual(["client", "specialist"]);
    expect(p.key).toBe(`link:/admin/requests/${ID}/outputs/o1`);
    expect(run(snap({ ...working, outputs: [{ ...o, blocking: [], unwritten: [] }] })).key).toBe("submit_output");
  });

  it("approval follows the output policy; a signed opinion is approved in the editor", () => {
    const o = { ...snap().outputs[0], id: "o1", status: "in_review" as const };
    const blocked = run(snap({ ...working, outputs: [{ ...o, viewerCanApprove: false, approveBlockedReason: "اعتماد مستقل" }] }));
    expect(blocked.primary).toBeNull();
    expect(blocked.current?.blockers[0].text).toBe("اعتماد مستقل");
    expect(run(snap({ ...working, outputs: [{ ...o, viewerCanApprove: true }] })).key).toBe(`link:/admin/requests/${ID}/outputs/o1`);
    expect(run(snap({ ...working, outputs: [{ ...o, viewerCanApprove: true, needsSignature: false }] })).key).toBe("approve_output");
  });

  it("after outputs: complete remaining stages, then send to quality review", () => {
    const o = { ...snap().outputs[0], id: "o1", status: "approved" as const };
    expect(run(snap({ ...working, outputs: [o], canAdvanceStage: true, stages: [{ key: "a", name: "الدراسة", status: "active" }, { key: "b", name: "الصياغة", status: "pending" }] })).key).toBe("complete_stage");
    expect(run(snap({ ...working, outputs: [o], deliverables: { submitted: 1, unsignedOpinion: 0 } })).key).toBe("to_quality");
  });

  it("four-eyes: the preparer cannot pass quality review unless self-approval covers it", () => {
    const qa: Partial<Snapshot> = { ...working, status: "quality_review", outputs: [{ ...snap().outputs[0], id: "o1", status: "approved" }], deliverables: { submitted: 1, unsignedOpinion: 0 } };
    const me = { ...snap().viewer, isDeliverer: true };
    expect(run(snap({ ...qa, viewer: me })).primary).toBeNull();
    expect(run(snap({ ...qa, viewer: me, selfQA: true })).key).toBe("pass_quality");
    expect(run(snap(qa)).key).toBe("pass_quality");
  });

  it("client revision reopens the output step", () => {
    const o = { ...snap().outputs[0], id: "o1", status: "approved" as const, needsRevision: true };
    const p = run(snap({ ...working, outputs: [o] }));
    expect(p.current?.key).toBe("prep:W01.main");
    expect(p.key).toBe(`link:/admin/requests/${ID}/outputs/o1`);
  });

  it("client approval waits on the client; completed closes; terminal has no action", () => {
    expect(run(snap({ ...working, status: "awaiting_client_approval" })).current?.owner).toBe("client");
    expect(run(snap({ ...working, status: "completed" })).key).toBe("close");
    const t = run(snap({ ...working, status: "cancelled" }));
    expect(t.primary).toBeNull();
    expect(t.terminal).toBe(true);
  });

  it("on hold: the only action is to resume", () => {
    const p = run(snap({ ...working, status: "on_hold", resumeTo: "in_progress", holdParty: "court", holdLabel: "المحكمة" }));
    expect(p.key).toBe("resume");
    expect(p.held?.text).toContain("المحكمة");
  });
});
