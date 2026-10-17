import { describe, expect, it } from "vitest";
import { SERVICES } from "@/server/seed/data/services";
import { formFor } from "@/server/modules/requests/intake/forms";
import { checkIntake, visibleSteps, type Answers } from "@/server/modules/requests/intake/engine";
import { contextFor, SERVICE_CONTEXT } from "@/server/modules/requests/context/map";
import { ctxField, periodFor, type ContextBlock } from "@/server/modules/requests/context/types";
import { analyzeRequest, type InsightInput } from "@/server/modules/requests/insights";
import { processingPhase } from "@/server/modules/requests/phase";
import { gapTasksFor } from "@/server/modules/requests/gap-tasks-pure";
import { snapshotChanges } from "@/server/modules/outputs/build";

const formOf = (code: string) => {
  const s = SERVICES.find((x) => x.code === code)!;
  return formFor({ code, audiences: s.audiences, requiredDocuments: s.docs ?? [] });
};

const block = (over: Partial<ContextBlock> & Pick<ContextBlock, "key">): ContextBlock => ({
  title: over.key, source: "سجل في ملف الوقف", path: null, asOf: "2026-01-01T00:00:00Z", status: "recorded", rows: [], gaps: [], facts: {}, fingerprint: "fp1", ...over,
});

const input = (code: string, answers: Answers, over: Partial<InsightInput> = {}): InsightInput => ({
  code, form: formOf(code), answers, docs: {}, fileValues: {}, blocks: [], states: {}, revisions: [], items: [], conflicts: [], ...over,
});
const field = (a: ReturnType<typeof analyzeRequest>, key: string) => a.steps.flatMap((s) => s.fields).find((f) => f.key === key)!;

describe("waqf data step in service forms", () => {
  it("is added after the applicant step only for services that read the waqf file", () => {
    const g09 = formOf("G09");
    const i = g09.steps.findIndex((s) => s.key === "waqfData");
    expect(i).toBeGreaterThan(0);
    expect(g09.steps[i].fields.find((f) => f.key === "waqfContext")?.type).toBe("hidden");
    expect(contextFor("G09").length).toBeGreaterThan(0);
    const without = SERVICES.find((s) => !SERVICE_CONTEXT[s.code]);
    if (without) expect(formOf(without.code).steps.some((s) => s.key === "waqfData")).toBe(false);
  });

  it("shows the step only when the server confirmed a waqf file (never asks the client to re-enter its records)", () => {
    const g09 = formOf("G09");
    expect(visibleSteps(g09, {}).some((s) => s.key === "waqfData")).toBe(false);
    expect(visibleSteps(g09, { waqfContext: "yes" }).some((s) => s.key === "waqfData")).toBe(true);
  });

  it("G09 asks for the evaluation scope, objectives and weighted criteria, not for the board records", () => {
    const keys = formOf("G09").steps.flatMap((s) => s.fields.map((f) => f.key));
    expect(keys).toEqual(expect.arrayContaining(["weights", "kpisRecorded", "hasPlan"]));
    expect(keys).not.toEqual(expect.arrayContaining(["boardMembers", "meetingsHeld"]));
  });

  it("an incomplete G09 cannot be submitted", () => {
    expect(checkIntake(formOf("G09"), { waqfContext: "yes" }, {}).fieldsComplete).toBe(false);
  });
});

describe("periodFor", () => {
  it("uses an explicit period when it runs forward", () => expect(periodFor({ periodFrom: "2025-01-01", periodTo: "2025-12-31" }, "2026-10-17")).toEqual({ from: "2025-01-01", to: "2025-12-31", year: 2025 }));
  it("ignores a reversed period and falls back to a year answer", () => expect(periodFor({ periodFrom: "2025-12-31", periodTo: "2025-01-01", fiscalYear: "2024" }, "2026-10-17")).toEqual({ from: "2024-01-01", to: "2024-12-31", year: 2024 }));
  it("defaults to the last twelve months", () => expect(periodFor({}, "2026-10-17")).toEqual({ from: "2025-10-18", to: "2026-10-17", year: null }));
});

describe("analyzeRequest", () => {
  it("tells a value taken from the waqf file from one the client changed", () => {
    const form = formOf("G09");
    const pre = form.steps.flatMap((s) => s.fields).find((f) => f.prefill && f.type !== "hidden");
    expect(pre).toBeTruthy();
    const same = analyzeRequest(input("G09", { [pre!.key]: "قيمة الملف" }, { fileValues: { [pre!.key]: "قيمة الملف" } }));
    expect(field(same, pre!.key).origin).toBe("file");
    const changed = analyzeRequest(input("G09", { [pre!.key]: "قيمة أخرى" }, { fileValues: { [pre!.key]: "قيمة الملف" } }));
    expect(field(changed, pre!.key).origin).toBe("file_changed");
  });

  it("an approval covers only its field, and lapses when the value changes after it", () => {
    const st = { status: "approved" as const, approvedValue: "no", decidedAt: "2026-10-01", decidedBy: "u1", note: null };
    const a = analyzeRequest(input("G09", { hasPlan: "no", kpisRecorded: "none" }, { states: { hasPlan: st } }));
    expect(field(a, "hasPlan").state).toBe("approved");
    expect(field(a, "kpisRecorded").state).toBe("pending");
    expect(a.summary.approved).toBe(1);
    const b = analyzeRequest(input("G09", { hasPlan: "yes" }, { states: { hasPlan: st } }));
    expect(field(b, "hasPlan").state).toBe("needs_review");
    expect(field(b, "hasPlan").approvalOutdated).toBe(true);
  });

  it("a waqf-file block approval lapses when the record changes", () => {
    const k = "board.meetings" as const;
    const st = { status: "approved" as const, approvedValue: "fp1", decidedAt: null, decidedBy: null, note: null };
    const ok = analyzeRequest(input("G09", {}, { blocks: [block({ key: k })], states: { [ctxField(k)]: st } }));
    expect(ok.blocks[0].state).toBe("approved");
    const moved = analyzeRequest(input("G09", {}, { blocks: [block({ key: k, fingerprint: "fp2" })], states: { [ctxField(k)]: st } }));
    expect(moved.blocks[0].state).toBe("needs_review");
  });

  it("states an inference from recorded meetings, with its evidence, and leaves missing records as gaps", () => {
    const a = analyzeRequest(input("G09", {}, { blocks: [block({ key: "board.meetings", facts: { held: 2, target: 4 } }), block({ key: "governance.evaluations", status: "missing", gaps: ["لا تقييم سابق مسجل"], asOf: null })] }));
    const inf = a.blocks[0].insights.find((x) => x.kind === "inference");
    expect(inf?.text).toContain("2 من 4");
    expect(inf?.evidence?.length).toBeGreaterThan(0);
    expect(a.blocks[1].insights.some((x) => x.kind === "gap")).toBe(true);
    expect(a.summary.gaps).toBeGreaterThan(0);
  });

  it("custom weights that do not total 100 are a gap with a suggested task", () => {
    const a = analyzeRequest(input("G09", { weighting: "custom", weights: JSON.stringify([{ criterion: "competence", weight: "60" }, { criterion: "diligence", weight: "30" }]) }));
    const g = field(a, "weights").insights.find((x) => x.kind === "gap" && x.text.includes("مجموع"));
    expect(g?.text).toContain("90");
    expect(g?.task).toBeTruthy();
  });

  it("F04: a planned deficit is an inference; no prior statements is a gap", () => {
    const rev = JSON.stringify([{ source: "إيجار", amount: "100000" }]);
    const exp = JSON.stringify([{ category: "maintenance", item: "صيانة", amount: "150000" }]);
    const a = analyzeRequest(input("F04", { revenues: rev, expenses: exp }, { blocks: [block({ key: "finance.records", facts: {} })] }));
    const ins = field(a, "expenses").insights;
    expect(ins.find((x) => x.kind === "inference")?.text).toContain("50,000");
    expect(ins.some((x) => x.kind === "gap")).toBe(true);
  });

  it("C08: a missing deed is a gap for a legal opinion", () => {
    const a = analyzeRequest(input("C08", {}, { blocks: [block({ key: "documents.key", facts: { waqf_deed: 0 } })] }));
    expect(a.blocks[0].insights.some((x) => x.kind === "gap" && x.text.includes("صك"))).toBe(true);
  });
});

describe("processingPhase", () => {
  const base = { assigned: false, data: { requiredMissing: 0, gaps: 0, conflicts: 0 }, openClientItems: 0, outputs: [] };
  it("submitted with open client items waits for the client", () => expect(processingPhase({ ...base, status: "submitted", openClientItems: 1 })).toMatchObject({ phase: "awaiting_client", owner: "client" }));
  it("submitted with a conflict stays in the completeness check", () => expect(processingPhase({ ...base, status: "triage", data: { requiredMissing: 0, gaps: 0, conflicts: 1 } })).toMatchObject({ phase: "completeness", owner: "team" }));
  it("complete data and no assignee goes to the manager", () => expect(processingPhase({ ...base, status: "submitted" })).toMatchObject({ phase: "ready_to_assign", owner: "manager" }));
  it("an output in review waits for the authorized approver", () => expect(processingPhase({ ...base, status: "in_progress", outputs: [{ status: "in_review", delivered: false }] })).toMatchObject({ phase: "authorized_approval" }));
  it("approved outputs not yet delivered are ready to deliver", () => expect(processingPhase({ ...base, status: "in_progress", outputs: [{ status: "approved", delivered: false }] })).toMatchObject({ phase: "ready_to_deliver" }));
  it("closed requests need no action", () => expect(processingPhase({ ...base, status: "closed" })).toMatchObject({ phase: "ended", owner: "none" }));
});

describe("gap tasks at submission", () => {
  it("creates tasks only for missing or stale records", () => {
    const t = gapTasksFor([
      { key: "board.meetings", title: "اجتماعات المجلس", status: "missing", gaps: [] },
      { key: "assets.register", title: "سجل الأصول", status: "stale", gaps: ["تقييم أقدم من سنتين"] },
      { key: "waqf.identity", title: "بيانات الوقف", status: "recorded", gaps: [] },
      { key: "board.composition", title: "تشكيل المجلس", status: "partial", gaps: ["عضو بلا تاريخ تعيين"] },
    ]);
    expect(t.map((x) => x.fieldKey)).toEqual([ctxField("board.meetings"), ctxField("assets.register")]);
    expect(t[1].title).toContain("تحديث");
    expect(t[1].description).toContain("سنتين");
  });
});

describe("output data snapshot", () => {
  it("lists exactly the values that changed since the version was drafted", () => {
    const then = { "answer:hasPlan": "no", "waqf:name": "وقف أ", "doc:deed": "123" };
    const now = { "answer:hasPlan": "yes", "waqf:name": "وقف أ", "answer:scope": "board" };
    expect(snapshotChanges(then, now)).toEqual([
      { key: "answer:hasPlan", before: "no", after: "yes" },
      { key: "answer:scope", before: null, after: "board" },
      { key: "doc:deed", before: "123", after: null },
    ]);
  });
  it("a version without a snapshot (older versions) reports nothing rather than guessing", () => expect(snapshotChanges(null, { a: "1" })).toEqual([]));
});
