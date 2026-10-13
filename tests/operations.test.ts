import { describe, expect, it } from "vitest";
import { SERVICES, WORKFLOWS } from "@/server/seed/data/services";
import { executeRight, nextTaskStatus, planExecTasks, taskActions, workStages } from "@/server/modules/operations/exec-pure";
import { DEED_CLAUSES, OUTPUT_SERVICE_CODES, outputsFor, TEMPLATES, type Profile } from "@/server/modules/outputs/catalog";
import { buildDraft, type OutputContext } from "@/server/modules/outputs/build";
import { applyEdits, approvalCheck, diffVersions, emptySpecialist, mergeRegenerated, readiness } from "@/server/modules/outputs/pure";
import { guardTransition, type GuardInput } from "@/server/modules/requests/workflow";
import { lastFiscalPeriod } from "@/server/modules/outputs/fiscal";

const wf = (code: string) => WORKFLOWS.find((w) => w.code === code)!.stages;

describe("execution tasks", () => {
  it("work stages sit between intake and quality/client stages", () => {
    expect(workStages(wf("standard")).map((s) => s.key)).toEqual(["analysis", "drafting"]);
    expect(workStages(wf("opinion")).map((s) => s.key)).toEqual(["study"]);
    expect(workStages(wf("registration")).map((s) => s.key)).toEqual(["package"]);
    expect(workStages(wf("subscription")).map((s) => s.key)).toEqual(["running"]);
  });

  it("plans one task per work stage and a prepare/review pair per output", () => {
    const p = planExecTasks(wf("standard"), [{ key: "C02.main", title: "تقرير" }]);
    expect(p.map((t) => `${t.kind}:${t.stageKey ?? t.outputKey}`)).toEqual(["stage:analysis", "stage:drafting", "prepare_output:C02.main", "review_output:C02.main"]);
  });

  it("an authorized manager executes directly without assignment; others need to be the assignee", () => {
    const mgr = executeRight({ isStaff: true, perms: ["admin.requests.all"], userId: "m", taskAssignee: null, requestAssignee: null });
    expect(mgr).toEqual({ can: true, manager: true, direct: true });
    const emp = executeRight({ isStaff: true, perms: ["staff.requests.assigned"], userId: "e", taskAssignee: "x", requestAssignee: "e" });
    expect(emp.can).toBe(true);
    expect(emp.direct).toBe(true); // request assignee executing a task assigned to someone else
    const other = executeRight({ isStaff: true, perms: ["staff.requests.assigned"], userId: "o", taskAssignee: "x", requestAssignee: "e" });
    expect(other.can).toBe(false);
    const client = executeRight({ isStaff: false, perms: ["admin.requests.all"], userId: "c", taskAssignee: "c", requestAssignee: "c" });
    expect(client.can).toBe(false);
  });

  it("offers actions by state, kind and right; review tasks complete only through the output", () => {
    const right = { can: true, manager: true };
    expect(taskActions({ status: "todo", kind: "stage" }, right)).toEqual(["start", "complete", "cancel", "assign"]);
    expect(taskActions({ status: "todo", kind: "review_output" }, right)).not.toContain("complete");
    expect(taskActions({ status: "done", kind: "stage" }, right)).toEqual(["reopen"]);
    expect(taskActions({ status: "todo", kind: "stage" }, { can: true, manager: false })).toEqual(["start", "complete"]);
    expect(taskActions({ status: "todo", kind: "stage" }, { can: false, manager: false })).toEqual([]);
    expect(nextTaskStatus("todo", "start")).toBe("in_progress");
    expect(nextTaskStatus("done", "complete")).toBeNull();
    expect(nextTaskStatus("cancelled", "reopen")).toBe("todo");
  });
});

describe("output catalog", () => {
  it("every catalog service has exactly one output with a known template", () => {
    for (const s of SERVICES) {
      const o = outputsFor({ code: s.code, outputs: s.outputs, nameAr: s.nameAr });
      expect(o, s.code).toHaveLength(1);
      expect(TEMPLATES[o[0].profile], s.code).toBeTruthy();
      expect(o[0].title.length, s.code).toBeGreaterThan(3);
    }
    expect(new Set(OUTPUT_SERVICE_CODES)).toEqual(new Set(SERVICES.map((s) => s.code)));
  });

  it("opinions, deeds, wills, audits and feasibility studies require independent approval", () => {
    for (const code of ["C07", "C08", "C11", "T03", "W01", "F06", "G08", "I03", "N01"]) expect(outputsFor({ code })[0].review, code).toBe("independent");
    for (const code of ["G01", "F05", "I08", "T06", "G10"]) expect(outputsFor({ code })[0].review, code).toBe("self_allowed");
  });
});

const baseCtx = (over: Partial<OutputContext> = {}): OutputContext => ({
  today: "2026-10-13",
  request: { id: "r", number: "REQ-1", status: "in_progress", submittedAt: "2026-10-01", priority: "normal" },
  service: { code: "F05", nameAr: "البيان المالي", outputs: "البيان المالي السنوي", summary: null, workflow: "standard" },
  requester: { name: "عميل تجريبي", capacity: "ناظر الوقف" },
  answers: [{ title: "الخدمة", rows: [{ key: "q1", label: "سؤال", value: "جواب" }] }],
  raw: { q1: { key: "q1", label: "سؤال", value: "جواب" } },
  formSources: ["لائحة تنظيم أعمال النظارة م15"],
  formDocs: [{ key: "bank", label: "كشف الحساب", required: true, attached: 1 }],
  documents: [{ id: "d1", title: "كشف", docType: "bank_statement", typeLabel: "كشف حساب", number: null, issuedOn: null, expiresOn: null, scope: "request", slot: "bank" }],
  waqf: { name: "وقف تجريبي", internalNumber: "WQF-1", registrationCertNo: "123", registrationExpiresOn: null, deedNo: "1", deedIssuer: "محكمة", deedDate: "1440", nationalUnifiedNumber: null, sizeClass: "small", legalType: null, status: "registered", fiscalYearEnd: "12-31", nazirMode: null, waqfakRole: "none", isDemo: false, assetsEstimatedValue: null },
  conditions: [{ category: "masarif", clauseRef: "البند 3", literal: "يصرف الريع على الفقراء", interpretation: null, source: null }],
  parties: [{ role: "مقدّم الطلب", name: "عميل", detail: null, prov: "client" }],
  beneficiaries: { active: 3, total: 4, abroad: 0, classes: [] },
  assets: [{ title: "عمارة", category: "real_estate", status: "active", bookValue: 1000, marketValue: 1200, lastValuationOn: "2026-05-01", annualIncome: 100, ownershipDocNo: "9" }],
  leases: { active: 1, arrears: 0, endingIn90: 0 },
  finance: { from: "2025-01-01", to: "2025-12-31", entries: 4, revenue: 500, expense: 200, net: 300, distributions: 100, debit: 800, credit: 800, byAccount: [{ code: "4100", label: "إيراد", amount: 500 }] },
  budget: null, distributions: [], governance: { bodies: [], policies: [{ type: "investment", label: "سياسة استثمار", status: "missing" }], meetingsHeld12m: 0, resolutions12m: 0 },
  compliance: { overdue: 0, dueSoon: 0, done: 2, overdueList: [] }, beneficialOwners: { total: 1, unverified: 0, dueVerification: 0 },
  investment: { policy: null, portfolios: [] }, quote: null, contract: null, stages: [], nazara: null,
  refs: [{ code: "NAZARA-REG", name: "لائحة تنظيم أعمال النظارة", binding: "binding", verification: "verified" }],
  ...over,
});

describe("draft builder", () => {
  it("builds every profile from data without inventing content, leaving judgment to the specialist", () => {
    for (const p of Object.keys(TEMPLATES) as Profile[]) {
      const def = { key: "X.main", title: "مخرج", specialty: "finance" as const, profile: p, review: "self_allowed" as const };
      const d = buildDraft(baseCtx(), def);
      expect(d.sections.length, p).toBeGreaterThan(2);
      expect(emptySpecialist(d.sections).length, p).toBe(TEMPLATES[p].analysis.length + (p === "deed_draft" ? DEED_CLAUSES.length : 0));
      expect(d.sections.at(-1)!.key).toBe("references");
    }
  });

  it("finance figures come from the ledger; no ledger is a blocking gap, unbalanced entries too", () => {
    const def = outputsFor({ code: "F05", outputs: "البيان المالي السنوي" })[0];
    const ok = buildDraft(baseCtx(), def);
    const fin = ok.sections.find((s) => s.key === "finance")!;
    expect(JSON.stringify(fin)).toContain("500");
    expect(ok.gaps.some((g) => g.key === "ledger")).toBe(false);
    const empty = buildDraft(baseCtx({ finance: { ...baseCtx().finance!, entries: 0 } }), def);
    expect(empty.gaps.find((g) => g.key === "ledger")?.severity).toBe("blocking");
    const unbalanced = buildDraft(baseCtx({ finance: { ...baseCtx().finance!, credit: 700 } }), def);
    expect(unbalanced.gaps.find((g) => g.key === "unbalanced")?.severity).toBe("blocking");
  });

  it("missing required documents and missing waqf conditions are gaps (blocking for a sharia opinion)", () => {
    const def = outputsFor({ code: "C07" })[0];
    const d = buildDraft(baseCtx({ conditions: [], formDocs: [{ key: "x", label: "مستند لازم", required: true, attached: 0 }] }), def);
    expect(d.gaps.find((g) => g.key === "conditions")?.severity).toBe("blocking");
    expect(d.gaps.find((g) => g.key === "doc:x")?.severity).toBe("blocking");
    // conditions are quoted verbatim, labelled as from a document
    const withCond = buildDraft(baseCtx(), def);
    const cond = withCond.sections.find((s) => s.key === "conditions")!;
    expect(JSON.stringify(cond)).toContain("«يصرف الريع على الفقراء»");
  });

  it("deed draft maps the ten clauses and blocks on a mortgaged asset", () => {
    const def = outputsFor({ code: "T03" })[0];
    const raw = { waqifName: { key: "waqifName", label: "الواقف", value: "فلان" }, mortgaged: { key: "mortgaged", label: "مرهون", value: "نعم" } };
    const d = buildDraft(baseCtx({ raw }), def);
    expect(d.gaps.some((g) => g.key === "mortgaged" && g.severity === "blocking")).toBe(true);
    expect(d.gaps.some((g) => g.key === "clause:masarif")).toBe(true);
  });

  it("nazara study requires the linked nazara file and its received checklist", () => {
    const def = outputsFor({ code: "N01" })[0];
    expect(buildDraft(baseCtx(), def).gaps.find((g) => g.key === "nazara")?.severity).toBe("blocking");
    const d = buildDraft(baseCtx({ nazara: { number: "NZR-1", status: "under_review", statusLabel: "قيد الدراسة", checklist: [{ label: "صك", status: "لم يُستلم", required: true, source: "م1" }] } }), def);
    expect(d.gaps.find((g) => g.key === "nazara_checklist")?.severity).toBe("blocking");
  });

  it("a demo waqf is flagged and the inputs hash ignores the date", () => {
    const def = outputsFor({ code: "G01" })[0];
    const a = buildDraft(baseCtx({ waqf: { ...baseCtx().waqf!, isDemo: true } }), def);
    expect(a.gaps.some((g) => g.key === "demo")).toBe(true);
    expect(buildDraft(baseCtx({ today: "2027-01-01" }), def).inputsHash).toBe(buildDraft(baseCtx(), def).inputsHash);
  });
});

describe("review, edits and regeneration", () => {
  const def = outputsFor({ code: "G01" })[0];
  const draft = buildDraft(baseCtx(), def);

  it("approval policy: independent needs a non-preparer; self-approval only for an authorized manager", () => {
    expect(approvalCheck({ policy: "independent", approverId: "a", preparers: ["a"], canReview: true, isManager: true })).toMatchObject({ ok: false });
    expect(approvalCheck({ policy: "independent", approverId: "b", preparers: ["a"], canReview: true, isManager: false })).toEqual({ ok: true, self: false });
    expect(approvalCheck({ policy: "self_allowed", approverId: "a", preparers: ["a"], canReview: true, isManager: true })).toEqual({ ok: true, self: true });
    expect(approvalCheck({ policy: "self_allowed", approverId: "a", preparers: ["a"], canReview: true, isManager: false })).toMatchObject({ ok: false });
    expect(approvalCheck({ policy: "self_allowed", approverId: "b", preparers: ["a"], canReview: false, isManager: false })).toMatchObject({ ok: false });
  });

  it("readiness blocks on unwritten specialist parts until they are written", () => {
    expect(readiness(draft.sections, draft.gaps).ready).toBe(false);
    const fields: Record<string, string> = {};
    for (const s of draft.sections) s.blocks.filter((b) => b.type === "specialist").forEach((_, i) => (fields[`spec:${s.key}:${i}`] = "نص المختص"));
    const e = applyEdits(draft.sections, fields);
    expect(e.changed).toBe(true);
    expect(readiness(e.sections, draft.gaps.filter((g) => g.severity !== "blocking")).ready).toBe(true);
  });

  it("edits: fact correction keeps the original, notes and manual sections are added, optional sections hidden", () => {
    const meta = draft.sections.find((s) => s.key === "meta")!;
    const factKey = `fact:meta:0:0`;
    const e = applyEdits(draft.sections, { [factKey]: "قيمة مصححة", "note:waqf": "ملاحظة المراجع", "drop:compliance": "on", new_title: "قسم إضافي", new_body: "نص" });
    const m2 = e.sections.find((s) => s.key === "meta")!;
    const row = (m2.blocks[0] as Extract<typeof m2.blocks[0], { type: "facts" }>).rows[0];
    expect(row).toMatchObject({ value: "قيمة مصححة", prov: "specialist", ref: (meta.blocks[0] as Extract<typeof meta.blocks[0], { type: "facts" }>).rows[0].value });
    expect(e.sections.find((s) => s.key === "compliance")!.removed).toBe(true);
    expect(e.sections.some((s) => s.manual && s.title === "قسم إضافي")).toBe(true);
    expect(JSON.stringify(e.sections.find((s) => s.key === "waqf"))).toContain("ملاحظة المراجع");
    // required sections cannot be dropped
    expect(applyEdits(draft.sections, { "drop:meta": "on" }).changed).toBe(false);
  });

  it("regeneration keeps human work and flags edited values that the data now contradicts", () => {
    const edited = applyEdits(draft.sections, { "spec:analysis:drafting:0": "نص كتبه المختص", "fact:meta:0:0": "مصحح", "drop:compliance": "on", new_title: "قسم يدوي", new_body: "نص" }).sections;
    const fresh = buildDraft(baseCtx({ service: { ...baseCtx().service, code: "G01", nameAr: "الحوكمة" } }), def);
    const m = mergeRegenerated(edited, fresh.sections, fresh.gaps);
    expect(JSON.stringify(m.sections)).toContain("نص كتبه المختص");
    expect(m.sections.find((s) => s.key === "compliance")!.removed).toBe(true);
    expect(m.sections.some((s) => s.manual)).toBe(true);
    expect(m.gaps.some((g) => g.key.startsWith("conflict:meta"))).toBe(true);
    expect(m.kept).toBeGreaterThanOrEqual(3);
  });

  it("diff lists changed, added and removed sections", () => {
    const b = applyEdits(draft.sections, { "note:waqf": "إضافة", new_title: "جديد", new_body: "نص", "drop:compliance": "on" }).sections;
    const d = diffVersions(draft.sections, b);
    expect(d.find((x) => x.key === "waqf")?.change).toBe("changed");
    expect(d.find((x) => x.title === "جديد")?.change).toBe("added");
    expect(d.find((x) => x.key === "compliance")?.change).toBe("removed");
  });
});

describe("request guards with outputs", () => {
  const g = (over: Partial<GuardInput>): GuardInput => ({
    from: "in_progress", to: "quality_review", actorUserId: "u", conflictCheck: "passed", workflowCode: "standard", deliverers: [], submittedDeliverables: 1,
    unsignedOpinionDeliverables: 0, contractSignedByClient: true, hasContract: true, quoteAmount: 100, pricingModel: "fixed", ...over,
  });
  it("cannot go to quality review with outputs still being drafted", () => {
    expect(guardTransition(g({ outputsUnfinished: 1 }))).toMatch(/قيد الإعداد/);
    expect(guardTransition(g({ outputsUnfinished: 0 }))).toBeNull();
  });
  it("cannot reach the client before every platform output is approved", () => {
    expect(guardTransition(g({ from: "quality_review", to: "awaiting_client_approval", outputsInReview: 1 }))).toMatch(/اعتماد كل المخرجات/);
  });
  it("four-eyes on quality review, waived only by the recorded self-approval policy", () => {
    expect(guardTransition(g({ from: "quality_review", to: "awaiting_client_approval", deliverers: ["u"] }))).toMatch(/العينين الأربع/);
    expect(guardTransition(g({ from: "quality_review", to: "awaiting_client_approval", deliverers: ["u"], selfApprovalCoversQA: true }))).toBeNull();
  });
});

describe("fiscal period", () => {
  it("takes the last fiscal year that ended", () => {
    expect(lastFiscalPeriod("12-31", "2026-10-13")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(lastFiscalPeriod("06-30", "2026-10-13")).toEqual({ from: "2025-07-01", to: "2026-06-30" });
  });
});
