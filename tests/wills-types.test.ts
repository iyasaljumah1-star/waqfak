import { describe, expect, it } from "vitest";
import { SERVICES } from "@/server/seed/data/services";
import { formFor } from "@/server/modules/requests/intake/forms";
import { checkIntake, columnOptions, sanitizeAnswers, validateStep, visibleSteps, type Answers } from "@/server/modules/requests/intake/engine";
import { detectConflicts } from "@/server/modules/outputs/conflicts";
import { draftWill } from "@/server/modules/outputs/drafting";
import { requirementsOf } from "@/server/modules/outputs/requirements";

/** W01 v3: a pure will and a will that includes a waqf after death are two paths. Synthetic data only. */

const s = SERVICES.find((x) => x.code === "W01")!;
const form = formFor({ code: "W01", audiences: s.audiences, requiredDocuments: s.docs ?? [] });
const step = (k: string) => form.steps.find((x) => x.key === k)!;
const bequest = (kind: string) => JSON.stringify([{ kind, recipient: "الفقراء", relation: "entity", basis: "share", percent: "10" }]);
const base = { testatorName: "موصٍ", testatorId: "1000000001", hasPreviousWill: "no", executorName: "منفذ", executorRelation: "heir", documentation: "najiz" };
const draft = (keys: Record<string, string>, tables: Record<string, Record<string, string>[]>) => {
  const conflicts = detectConflicts({ serviceCode: "W01", keys, tables, labels: {}, options: { willType: { pure: "خالصة", with_waqf: "تتضمن وقفًا" }, "bequests.kind": { waqf: "وقف بعد الوفاة", charity: "صدقة" } }, requester: { name: "x", capacityKey: null }, docs: [], waqf: null, prefills: {} });
  return { d: draftWill({ keys, tables, attached: {}, requesterName: "x", conflicts, today: "2026-10-16" }), conflicts };
};

describe("W01 form by type", () => {
  it("the type is asked first; the waqf step exists only for a will that includes a waqf", () => {
    expect(form.version).toBe(3);
    expect(visibleSteps(form, { willType: "pure", bequests: bequest("charity") }).map((x) => x.key)).not.toContain("waqf");
    expect(visibleSteps(form, { willType: "with_waqf", bequests: bequest("waqf") }).map((x) => x.key)).toContain("waqf");
    expect(visibleSteps(form, {})[0]?.key === "applicant" ? visibleSteps(form, {})[1].key : visibleSteps(form, {})[0].key).toBe("type");
  });

  it("a pure will does not offer «waqf after death» as a bequest, and refuses it on the server", () => {
    const col = step("bequests").fields.find((f) => f.key === "bequests")!.columns!.find((c) => c.key === "kind")!;
    expect(columnOptions(col, { willType: "pure" }).map(([k]) => k)).not.toContain("waqf");
    expect(columnOptions(col, { willType: "with_waqf" }).map(([k]) => k)).toContain("waqf");
    const e = validateStep(step("bequests"), { willType: "pure", bequests: bequest("waqf") });
    expect(e.bequests).toBeTruthy();
  });

  it("a will that includes a waqf needs a waqf row, its masarif, nazir and succession", () => {
    expect(validateStep(step("bequests"), { willType: "with_waqf", bequests: bequest("charity") }).bequests).toContain("أضف في الجدول صف «وقف بعد الوفاة»");
    const e = validateStep(step("waqf"), { willType: "with_waqf", bequests: bequest("waqf") });
    expect(Object.keys(e).sort()).toEqual(["waqfMasarif", "waqfNazir", "waqfSuccession"]);
  });

  it("switching to pure drops the waqf's answers (which the save records), nothing else", () => {
    const a: Answers = { willType: "with_waqf", ...base, bequests: bequest("charity"), waqfNazir: "ناظر", waqfName: "وقف" };
    const after = sanitizeAnswers(form, { ...a, willType: "pure" });
    expect(after.waqfNazir).toBeUndefined();
    expect(after.waqfName).toBeUndefined();
    expect(after.testatorName).toBe("موصٍ");
    expect(validateStep(step("bequests"), after)).toEqual({});
    expect(checkIntake(form, after, {}).errors.waqfNazir).toBeUndefined();
  });
});

describe("W01 document and checks by type", () => {
  it("a pure will has no waqf clause and no waqf checks failing", () => {
    const { d } = draft({ ...base, willType: "pure" }, { bequests: [{ kind: "charity", recipient: "جمعية", relation: "entity", basis: "share", percent: "10" }] });
    expect(d.title).toBe("نص الوصية");
    expect(d.clauses.map((c) => c.text).join(" ")).not.toContain("وقف");
    expect(d.clauses.some((c) => c.key === "waqf")).toBe(false);
    expect(d.checks.find((c) => c.key === "waqf_consistency")?.status).toBe("verified");
    expect(d.checks.some((c) => c.key === "waqf_shares")).toBe(false);
    const req = requirementsOf({ serviceCode: "W01", keys: { ...base, willType: "pure" }, tables: {}, gaps: d.gaps, checks: d.checks });
    expect(req.find((r) => r.key === "waqf_terms")?.status).toBe("na");
  });

  it("a will with a waqf states the waqf, its masarif and conditions, and titles the document by its type", () => {
    const { d } = draft({ ...base, willType: "with_waqf", waqfNazir: "ناظر", waqfSuccession: "eldest", waqfConditions: "تقدم عمارة الأصل على الصرف", waqfFinal: "الفقراء" },
      { bequests: [{ kind: "waqf", recipient: "الفقراء", relation: "entity", basis: "share", percent: "10" }], waqfMasarif: [{ beneficiary: "طلبة العلم", share: "100" }] });
    expect(d.title).toBe("نص الوصية المتضمنة وقفًا بعد الوفاة");
    const t = d.clauses.map((c) => c.text).join("\n");
    expect(t).toContain("أوصي بنسبة 10٪ من تركتي وقفًا بعد وفاتي");
    expect(t).toContain("تُصرف غلته على: 1) طلبة العلم بنسبة 100٪ من الغلة، فإن انقطعت صُرفت على الفقراء");
    expect(t).toContain("ويشترط الموصي في الوقف: تقدم عمارة الأصل على الصرف");
    expect(d.gaps.find((g) => g.key === "waqf_conditions_review")?.owner).toBe("specialist");
  });

  it("a will with a waqf and contradictory data is not drafted either way and cannot be approved", () => {
    const { d, conflicts } = draft({ ...base, willType: "pure" }, { bequests: [{ kind: "waqf", recipient: "الفقراء", relation: "entity", basis: "share", percent: "10" }] });
    expect(conflicts.map((c) => c.key)).toContain("will:type_vs_bequests");
    expect(d.clauses.find((c) => c.key === "bequest:1")?.text).toContain("[تعارض يُحسم:");
    expect(d.checks.find((c) => c.key === "waqf_consistency")?.status).toBe("failed");
    const missingRow = draft({ ...base, willType: "with_waqf", waqfNazir: "ن", waqfSuccession: "eldest" }, { bequests: [{ kind: "charity", recipient: "جهة", relation: "entity", basis: "share", percent: "5" }], waqfMasarif: [{ beneficiary: "x" }] });
    expect(missingRow.conflicts.map((c) => c.key)).toContain("will:type_without_row");
    expect(missingRow.d.checks.find((c) => c.key === "waqf_consistency")?.status).toBe("failed");
  });

  it("requests made before the type question (v2) still draft from their answer", () => {
    const { d } = draft({ ...base, includesWaqf: "yes", waqfNazir: "ن", waqfSuccession: "eldest" }, { bequests: [{ kind: "waqf", recipient: "الفقراء", relation: "entity", basis: "share", percent: "10" }], waqfMasarif: [{ beneficiary: "x" }] });
    expect(d.title).toBe("نص الوصية المتضمنة وقفًا بعد الوفاة");
  });
});
