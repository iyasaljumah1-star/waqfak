import { describe, expect, it } from "vitest";
import { detectConflicts, type ConflictInput } from "@/server/modules/outputs/conflicts";
import { draftWill, type DraftInput } from "@/server/modules/outputs/drafting";
import { checkBlockers } from "@/server/modules/outputs/checks";
import { requirementBlockers, requirementsOf } from "@/server/modules/outputs/requirements";
import { outputStage } from "@/server/modules/outputs/stages";
import { regenSummary, wordDiff } from "@/server/modules/outputs/pure";
import { outputHtml } from "@/server/modules/outputs/render";
import { citationOf, CITATIONS } from "@/server/modules/outputs/citations";
import type { OutputSection } from "@/server/db/schema/operations";

/**
 * Output quality order (W01 OUT-000004 case): the client answered «no waqf after death» while the bequests table holds
 * «waqf 10% of the estate after death». Synthetic data only.
 */

const OPTS = { includesWaqf: { yes: "نعم", no: "لا" }, "bequests.kind": { waqf: "وقف بعد الوفاة", charity: "صدقة", person: "لشخص" }, hasPreviousWill: { yes: "نعم", no: "لا" } };
const base = (keys: Record<string, string>, tables: ConflictInput["tables"], extra: Partial<ConflictInput> = {}): ConflictInput => ({
  serviceCode: "W01", keys, tables, labels: { includesWaqf: "هل في وصاياك وقف بعد الوفاة؟", testatorName: "اسم الموصي" }, options: OPTS,
  requester: { name: "موصٍ تجريبي", capacityKey: "waqif" }, docs: [], waqf: null, prefills: {}, ...extra,
});
const KEYS = { testatorName: "عبدالله التجريبي", testatorId: "1000000001", hasPreviousWill: "no", includesWaqf: "no", executorName: "منفذ تجريبي", executorRelation: "heir", documentation: "witnesses" };
const BEQ = { bequests: [{ kind: "waqf", recipient: "الفقراء والمساكين", relation: "entity", basis: "share", percent: "10" }], witnesses: [{ name: "شاهد تجريبي أول", id: "1000000002" }, { name: "شاهد تجريبي ثان", id: "1000000003" }] };
const will = (keys: Record<string, string>, tables: DraftInput["tables"], conflicts = detectConflicts(base(keys, tables))) =>
  draftWill({ keys, tables, attached: {}, requesterName: "موصٍ تجريبي", conflicts, today: "2026-10-15" });

describe("conflicts (OUT-000004 case)", () => {
  it("finds the answer «no waqf» against a waqf row, with both values and their source, and picks neither", () => {
    const cs = detectConflicts(base(KEYS, BEQ));
    const c = cs.find((x) => x.key === "will:waqf_answer_vs_bequests")!;
    expect(c.severity).toBe("material");
    expect(c.sides.map((s) => s.value)).toEqual(["لا", "وقف بعد الوفاة بنسبة 10٪ من التركة — الفقراء والمساكين"]);
    expect(c.sides.every((s) => s.source)).toBe(true);
    expect(c.action).toContain("لا تُختار قيمة نيابة عنه");
    expect(c.fields).toEqual(["includesWaqf", "bequests"]);
  });

  it("the drafted will neither states the waqf nor denies it while the conflict is open", () => {
    const d = will(KEYS, BEQ);
    const t = d.clauses.map((c) => c.text).join("\n");
    expect(t).not.toContain("وقفًا بعد وفاتي");
    expect(t).toContain("[تعارض يُحسم:");
    expect(d.checks.find((c) => c.key === "waqf_consistency")?.status).toBe("failed");
    const cl = d.clauses.find((c) => c.key === "bequest:1")!;
    expect(cl.data?.some((x) => x.field === "includesWaqf" && x.status === "conflict")).toBe(true);
  });

  it("disappears once the answer is corrected at its source, and comes back if the wrong value is entered again", () => {
    const fixed = { ...KEYS, includesWaqf: "yes" };
    expect(detectConflicts(base(fixed, BEQ)).some((c) => c.key.startsWith("will:waqf"))).toBe(false);
    expect(detectConflicts(base(KEYS, BEQ)).some((c) => c.key === "will:waqf_answer_vs_bequests")).toBe(true);
    // the reverse: «yes» without any waqf row
    const noRow = { ...BEQ, bequests: [{ ...BEQ.bequests[0], kind: "charity" }] };
    expect(detectConflicts(base(fixed, noRow)).some((c) => c.key === "will:waqf_answer_without_row")).toBe(true);
  });

  it("common rules: an answer prefilled from the waqf file and changed; a waqif applying under another name; a document number", () => {
    const x = base({ ...KEYS, deedNo: "123" }, BEQ, { waqf: { "waqf.deedNo": "999" }, prefills: { deedNo: "waqf.deedNo" }, requester: { name: "x", capacityKey: "waqif" } });
    x.keys.contactName = "شخص آخر";
    const keys = detectConflicts(x).map((c) => c.key);
    expect(keys).toContain("waqf_file:deedNo");
    expect(keys).toContain("applicant:self_vs_subject");
    const d = detectConflicts(base(KEYS, BEQ, { docs: [{ slot: "testatorId", title: "هوية الموصي", number: "1000000099", issuedOn: null }] }));
    expect(d.some((c) => c.key === "doc_number:testatorId:testatorId")).toBe(true);
  });

  it("the testator listed as his own witness is a conflict", () => {
    const t = { ...BEQ, witnesses: [{ name: "عبدالله التجريبي", id: "1000000001" }] };
    expect(detectConflicts(base(KEYS, t)).some((c) => c.key === "will:testator_as_witness")).toBe(true);
  });
});

describe("checks never pass on an answer alone", () => {
  it("witness names are not proof of attestation; the arithmetic is not the ruling", () => {
    const d = will({ ...KEYS, includesWaqf: "yes", waqfNazir: "ناظر", waqfSuccession: "eldest" }, { ...BEQ, waqfMasarif: [{ beneficiary: "الفقراء", share: "100" }] });
    const att = d.checks.find((c) => c.key === "attestation")!;
    expect(att.status).toBe("specialist");
    expect(att.reason).toContain("إدخال الاسم لا يثبت حصول الإشهاد");
    const arith = d.checks.find((c) => c.key === "third_arith")!;
    expect(arith.status).toBe("verified");
    expect(arith.rule).toContain("لا تثبت وحدها نفاذ الوصايا");
    expect(d.checks.find((c) => c.key === "third_legal")?.status).toBe("specialist");
    for (const c of d.checks) { expect(c.reason).toBeTruthy(); expect(c.source).toBeTruthy(); expect(c.rule).toBeTruthy(); expect(["auto", "professional"]).toContain(c.mode); }
    // approval waits for the specialist's finding; a recorded finding lifts it
    expect(checkBlockers(d.checks).pendingSpecialist.map((c) => c.key).sort()).toEqual(["attestation", "third_legal"]);
    const after = checkBlockers(d.checks, [{ key: "attestation", status: "verified", note: "اطلعت على توقيع الشاهدين", by: "u", at: "2026-10-15", version: 1 }, { key: "third_legal", status: "verified", note: "دون الثلث", by: "u", at: "2026-10-15", version: 1 }]);
    expect(after.pendingSpecialist).toEqual([]);
  });

  it("form checks: an ID of the wrong form and a future date fail", () => {
    const d = will({ ...KEYS, testatorId: "123", hasPreviousWill: "yes", previousWillDate: "2030-01-01", previousWillAction: "revoke" }, BEQ);
    expect(d.checks.find((c) => c.key === "facts")?.status).toBe("failed");
    expect(d.gaps.some((g) => g.key === "invalid:testatorId")).toBe(true);
    expect(d.gaps.some((g) => g.key === "invalid:previousWillDate")).toBe(true);
  });

  it("an amended previous will is not called «the only valid will»", () => {
    const d = will({ ...KEYS, includesWaqf: "yes", hasPreviousWill: "yes", previousWillDate: "2020-01-01", previousWillAction: "amend" }, BEQ, []);
    const closing = d.clauses.find((c) => c.key === "closing")!.text;
    expect(closing).not.toContain("الوحيدة النافذة");
    expect(closing).toContain("تُقرأ مع وصيتي السابقة");
  });
});

describe("deficiency list (W01)", () => {
  const list = (keys: Record<string, string>, tables: DraftInput["tables"]) => {
    const d = will(keys, tables);
    const gaps = [...d.gaps, ...detectConflicts(base(keys, tables)).map((c) => ({ key: `conflict:${c.key}`, label: c.label, severity: "blocking" as const, kind: "conflict" as const }))];
    return requirementsOf({ serviceCode: "W01", keys, tables, gaps, checks: d.checks });
  };

  it("each item says why, importance, source, owner, status and effect; the conflict blocks", () => {
    const l = list(KEYS, BEQ);
    for (const r of l) for (const f of ["label", "why", "need", "source", "owner", "status"] as const) expect(r[f], `${r.key}.${f}`).toBeTruthy();
    expect(l.find((r) => r.key === "waqf_consistency")?.status).toBe("conflict");
    expect(l.find((r) => r.key === "attestation")?.status).toBe("pending_review");
    expect(l.find((r) => r.key === "waqf_terms")?.status).toBe("na");
    const b = requirementBlockers(l);
    expect(b.submit.some((r) => r.key === "waqf_consistency")).toBe(true);
    expect(b.approve.some((r) => r.key === "attestation")).toBe(true);
  });

  it("an optional gap alone blocks nothing", () => {
    const keys = { ...KEYS, includesWaqf: "yes", waqfNazir: "ناظر", waqfSuccession: "eldest", documentation: "najiz" };
    const tables = { bequests: BEQ.bequests, waqfMasarif: [{ beneficiary: "الفقراء", share: "100" }] };
    const l = list(keys, tables);
    const name = l.find((r) => r.key === "waqf_name")!;
    expect(name).toMatchObject({ need: "optional", status: "missing" });
    expect(name.effect).toContain("لا يمنع");
    expect(requirementBlockers(l).submit).toEqual([]);
  });

  it("a mandatory gap blocks submission and approval", () => {
    const l = list({ ...KEYS, testatorName: "" }, BEQ);
    expect(requirementBlockers(l).submit.some((r) => r.key === "testator")).toBe(true);
  });
});

describe("stages, versions, client copy", () => {
  it("nine stages read from records; official only with a record", () => {
    const s = (x: Partial<Parameters<typeof outputStage>[0]>) => outputStage({ status: "draft", origin: "generated", submitBlockers: 0, approveBlockers: 0, requestStatus: "in_progress", released: false, officialRecords: 0, ...x });
    expect(s({ submitBlockers: 2 })).toBe("generated");
    expect(s({ submitBlockers: 2, origin: "edited" })).toBe("completing");
    expect(s({})).toBe("ready");
    expect(s({ status: "in_review" })).toBe("in_review");
    expect(s({ status: "returned" })).toBe("returned");
    expect(s({ status: "approved" })).toBe("approved");
    expect(s({ status: "approved", requestStatus: "quality_review" })).toBe("ready_delivery");
    expect(s({ status: "approved", released: true })).toBe("delivered");
    expect(s({ status: "approved", released: true, officialRecords: 1 })).toBe("documented");
  });

  it("word diff and regeneration summary", () => {
    const d = wordDiff("أوصي بنسبة 10٪ صدقة", "أوصي بنسبة 10٪ وقفًا");
    expect(d.filter((x) => x.t === "del").map((x) => x.s).join("")).toContain("صدقة");
    expect(d.filter((x) => x.t === "add").map((x) => x.s).join("")).toContain("وقفًا");
    const sec = (t: string): OutputSection[] => [{ key: "w", title: "w", required: true, blocks: [{ type: "clause", key: "a", n: 1, title: "a", text: t, generated: t, prov: "client" }, { type: "clause", key: "b", n: 2, title: "b", text: "ثابت", generated: "ثابت", prov: "client" }] }];
    const r = regenSummary(sec("قديم"), sec("جديد"), [{ key: "conflict:will:x", label: "تعارض قديم", severity: "blocking", kind: "conflict" }], [{ key: "conflict:will:y", label: "تعارض جديد", severity: "blocking", kind: "conflict" }]);
    expect(r).toMatchObject({ changed: 1, unchanged: 1, newConflicts: ["تعارض جديد"], resolvedConflicts: ["تعارض قديم"] });
  });

  it("the approved copy carries no internal checks, gap report or provenance", () => {
    const d = will({ ...KEYS, includesWaqf: "yes" }, BEQ, []);
    const sections: OutputSection[] = [
      { key: "will_clauses", title: "نص الوصية", required: true, blocks: d.clauses },
      { key: "will_clauses:checks", title: "فحوص الصياغة (داخلية)", required: false, audience: "internal", blocks: [{ type: "checks", items: d.checks }] },
    ];
    const meta = { number: "OUT-1", title: "نص الوصية", specialty: "شرعي", serviceLine: "W01", requestNumber: "REQ-1", waqfName: null, version: 2, preparedBy: null, approvedBy: "مراجع", approvedAt: "2026-10-15", selfApproved: false, signedBy: null, isDemo: false, gaps: d.gaps };
    const approved = outputHtml({ ...meta, status: "approved", workflowStatus: "approved" }, sections);
    expect(approved).not.toContain("فحوص الصياغة");
    expect(approved).not.toContain("تقرير النواقص");
    expect(approved).not.toContain("1000000002"); // witness IDs are internal data
    expect(approved).not.toContain('class="prov"');
    const draft = outputHtml({ ...meta, status: "draft", workflowStatus: "draft" }, sections);
    expect(draft).toContain("فحوص الصياغة");
    expect(draft).toContain("تقرير النواقص والتعارضات");
  });

  it("every citation names a registry code and a location; no article number is invented", () => {
    for (const c of Object.values(CITATIONS)) { expect(c.refCode).toMatch(/^[A-Z0-9-]+$/); expect(c.location).toBeTruthy(); }
    expect(citationOf("not-a-key")).toBeNull();
  });
});
