import { describe, expect, it } from "vitest";
import { evaluate, test, validateLogic } from "../src/server/engines/logic";
import { addBusinessDays, computeDue, fiscalYearEnd, isBusinessDay } from "../src/server/engines/dates";
import { computeAssessment, deriveType, type Axis, type Question } from "../src/server/engines/assessment";
import { runRules, urgencyFactor, type Rule, type ServiceInfo } from "../src/server/engines/recommendations";
import { isApplicable, remindersDue, statusFor, type ObligationDef } from "../src/server/engines/compliance";

describe("logic evaluator", () => {
  it("evaluates comparisons, boolean logic and vars", () => {
    expect(test({ "==": [{ var: "a" }, "no"] }, { a: "no" })).toBe(true);
    expect(test({ and: [{ ">": [{ var: "n" }, 5] }, { in: [{ var: "s" }, ["medium", "large"]] }] }, { n: 6, s: "large" })).toBe(true);
    expect(test({ or: [{ var: "x" }, { "!": { var: "y" } }] }, { x: false, y: false })).toBe(true);
    expect(evaluate({ var: ["missing.path", "dflt"] }, {})).toBe("dflt");
    expect(test(null, {})).toBe(true);
  });
  it("rejects unknown operators (rules are data, not code)", () => {
    expect(validateLogic({ eval: ["process.exit()"] })).toMatch(/unsupported/);
  });
});

describe("dates & business days", () => {
  const none = new Set<string>();
  it("skips Friday/Saturday", () => {
    // 2026-10-08 is a Thursday → +1 business day = Sunday 2026-10-11
    expect(isBusinessDay("2026-10-09", none)).toBe(false);
    expect(addBusinessDays("2026-10-08", 1, none)).toBe("2026-10-11");
  });
  it("30 business days after documentation", () => {
    expect(addBusinessDays("2026-10-01", 30, none)).toBe("2026-11-12");
  });
  it("respects holidays", () => {
    expect(addBusinessDays("2026-10-08", 1, new Set(["2026-10-11"]))).toBe("2026-10-12");
  });
  it("months and fiscal year", () => {
    expect(computeDue("2026-12-31", 3, "months", none).due).toBe("2027-03-31");
    expect(fiscalYearEnd("2026-10-07", "12-31")).toBe("2026-12-31");
    expect(computeDue("2026-10-07", null, "immediate", none).immediate).toBe(true);
  });
});

const axes: Axis[] = [
  { code: "A1", nameAr: "شرعي", weightSmall: 50, weightMedium: 50, weightLarge: 50 },
  { code: "A5", nameAr: "مالي", weightSmall: 50, weightMedium: 50, weightLarge: 50 },
];
const yn = [
  { value: "yes", label: "نعم", score: 5 },
  { value: "no", label: "لا", score: 0 },
  { value: "unknown", label: "لا أعلم", unknown: true },
];
const questions: Question[] = [
  { code: "P03", axisCode: "P", textAr: "قيمة الأصول", answerType: "band", weight: 1, factKey: "asset_band", options: [{ value: "lt50", label: "" }, { value: "50to200", label: "" }] },
  { code: "Q1", axisCode: "A1", textAr: "شرط واضح", answerType: "yes_no", weight: 2, options: yn },
  { code: "Q2", axisCode: "A5", textAr: "حساب مستقل", answerType: "yes_no", weight: 3, options: yn, criticalFlagCode: "R01", criticalWhen: { in: [{ var: "answer" }, ["no", "unknown"]] } },
  { code: "Q3", axisCode: "A5", textAr: "موازنة", answerType: "yes_no", weight: 2, options: yn, showIf: { "==": [{ var: "size_class" }, "medium"] } },
];

describe("assessment engine", () => {
  it("computes weighted axis scores and overall", () => {
    const r = computeAssessment({ axes, questions, flagDefs: [{ code: "R01", titleAr: "حساب", axisCode: "A5" }], answers: { P03: { value: "lt50" }, Q1: { value: "yes" }, Q2: { value: "yes" } } });
    expect(r.sizeClass).toBe("small");
    expect(r.applicableQuestions).not.toContain("Q3"); // conditional question hidden for small waqf
    expect(r.axisScores.find((a) => a.axisCode === "A5")!.score).toBe(100);
    expect(r.overallScore).toBe(100);
    expect(r.status).toBe("advanced");
  });
  it("critical flag caps axis at 39 and marks status critical; unknown is a knowledge gap", () => {
    const r = computeAssessment({ axes, questions, flagDefs: [{ code: "R01", titleAr: "حساب", axisCode: "A5" }], answers: { P03: { value: "50to200" }, Q1: { value: "yes" }, Q2: { value: "unknown" }, Q3: { value: "yes" } } });
    expect(r.flags.map((f) => f.code)).toEqual(["R01"]);
    expect(r.status).toBe("critical");
    expect(r.axisScores.find((a) => a.axisCode === "A5")!.score).toBeLessThanOrEqual(39);
    expect(r.knowledgeGaps).toContain("Q2");
  });
  it("is deterministic", () => {
    const input = { axes, questions, flagDefs: [], answers: { P03: { value: "lt50" }, Q1: { value: "no" }, Q2: { value: "yes" } } };
    expect(JSON.stringify(computeAssessment(input))).toBe(JSON.stringify(computeAssessment(input)));
  });
  it("classifies descendants with a charitable qualifier as public (GAA classification guide)", () => {
    expect(deriveType({ beneficiary_kind: "private", charitable_qualifier: "yes" }).type).toBe("public");
    expect(deriveType({ beneficiary_kind: "both" }).type).toBe("joint");
  });
});

describe("recommendation engine", () => {
  const services: ServiceInfo[] = [
    { code: "F09", nameAr: "فصل مالي", conflictRule: "none", isActive: true },
    { code: "F06", nameAr: "مراجعة", conflictRule: "blocked_if_waqfak_controls_finance", isActive: true },
    { code: "N01", nameAr: "نظارة", conflictRule: "none", requiresLicenseKey: "gaa_nazara_license", isActive: true },
  ];
  const rules: Rule[] = [
    { id: "1", code: "R-FIN-001", version: 1, titleAr: "حساب", condition: { "==": [{ var: "has_bank_account" }, "no"] }, needCode: "NEED.FIN.ACCOUNT", severity: "critical", urgencyDays: 7, leverage: 1, reasonAr: "", serviceCodes: ["F09"] },
    { id: "2", code: "R-FIN-003", version: 1, titleAr: "قوائم", condition: { "==": [{ var: "audited" }, "no"] }, needCode: "NEED.FIN.AUDIT", severity: "critical", urgencyDays: 60, leverage: 1, reasonAr: "", serviceCodes: ["F06"] },
    { id: "3", code: "R-NAZ-001", version: 1, titleAr: "خلافة", condition: { "==": [{ var: "succession" }, "no"] }, needCode: "NEED.NAZ.SUCC", severity: "high", urgencyDays: 90, leverage: 1.5, reasonAr: "", serviceCodes: ["N01"] },
  ];
  const ctx = { waqfakRole: "none" as const, activeLicenses: [], hasActiveLitigation: false, gaaIsNazir: false, openServiceCodes: [] };
  it("fires, prioritizes and waves", () => {
    const r = runRules(rules, { has_bank_account: "no", audited: "no", succession: "no" }, services, ctx);
    expect(r.map((x) => x.ruleCode)).toEqual(["R-FIN-001", "R-FIN-003", "R-NAZ-001"]);
    expect(r[0].wave).toBe(1);
    expect(r[0].priority).toBe(30);
    expect(urgencyFactor(60)).toBe(2);
  });
  it("blocks audit service when Waqfak is the nazir (separation of duties)", () => {
    const r = runRules(rules, { audited: "no" }, services, { ...ctx, waqfakRole: "nazir" });
    expect(r[0].serviceCodes).toEqual([]);
    expect(r[0].removedServices[0].why).toMatch(/م18/);
  });
  it("hides nazara service until the license is registered", () => {
    const r = runRules(rules, { succession: "no" }, services, ctx);
    expect(r[0].serviceCodes).toEqual([]);
    const r2 = runRules(rules, { succession: "no" }, services, { ...ctx, activeLicenses: ["gaa_nazara_license"] });
    expect(r2[0].serviceCodes).toEqual(["N01"]);
  });
});

describe("compliance engine", () => {
  const def: ObligationDef = { id: "o", code: "O", titleAr: "", triggerEvent: "x", offsetValue: 3, offsetUnit: "months", recurrence: "none", appliesTo: { sizeClasses: ["large", "medium"] }, severity: "high", reminderOffsetsDays: [30, 7, 1] };
  it("applicability by size", () => {
    expect(isApplicable(def, { sizeClass: "small", legalType: "private", flags: {} })).toBe(false);
    expect(isApplicable(def, { sizeClass: "medium", legalType: "private", flags: {} })).toBe(true);
  });
  it("status & reminders", () => {
    expect(statusFor("2026-10-01", "2026-10-07", false)).toBe("overdue");
    expect(statusFor("2026-10-15", "2026-10-07", false)).toBe("due_soon");
    expect(remindersDue("2026-10-14", "2026-10-07", [30, 7, 1], [30])).toEqual([7]);
  });
});
