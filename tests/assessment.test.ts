import { describe, expect, it } from "vitest";
import {
  answerLabel, combinedConfidence, deriveBaseFacts, factsObject, prefillFromWaqf, stepsFor, waveDueDate,
} from "../src/server/modules/assessment/facts";
import { radarSvg, sparklineSvg } from "../src/components/assessment/radar";
import { computeAssessment } from "../src/server/engines/assessment";
import { AXES, QUESTIONS } from "../src/server/seed/data/assessment";

const none = new Set<string>();

describe("derived facts", () => {
  it("registration deadline is 30 business days (Fri/Sat and holidays skipped)", () => {
    const f = factsObject(deriveBaseFacts({ answers: { "A2-01": { value: "yes" }, "A2-02": { value: "2026-01-04" }, "A2-03": { value: "no" } }, holidays: none, today: "2026-02-16" }));
    expect(f.registration_deadline).toBe("2026-02-15");
    expect(f.registration_overdue).toBe(true);
    // one official holiday in the window pushes the deadline by one business day
    const g = factsObject(deriveBaseFacts({ answers: { "A2-01": { value: "yes" }, "A2-02": { value: "2026-01-04" }, "A2-03": { value: "no" } }, holidays: new Set(["2026-01-05"]), today: "2026-02-16" }));
    expect(g.registration_deadline).toBe("2026-02-16");
    expect(g.registration_overdue).toBe(false);
  });

  it("is not overdue once registered or within the window", () => {
    const reg = factsObject(deriveBaseFacts({ answers: { "A2-01": { value: "yes" }, "A2-02": { value: "2020-01-01" }, "A2-03": { value: "yes" } }, holidays: none, today: "2026-02-16" }));
    expect(reg.registration_overdue).toBe(false);
    const early = factsObject(deriveBaseFacts({ answers: { "A2-01": { value: "yes" }, "A2-02": { value: "2026-02-10" }, "A2-03": { value: "no" } }, holidays: none, today: "2026-02-16" }));
    expect(early.registration_overdue).toBe(false);
  });

  it("falls back to the waqf profile and exposes Waqfak role and GAA nazara", () => {
    const f = factsObject(deriveBaseFacts({
      answers: {}, holidays: none, today: "2026-10-07",
      waqf: { documentedOn: "2025-01-01", registeredOn: null, registrationExpiresOn: "2026-11-01", waqfakRole: "nazir", nazirMode: "gaa" },
    }));
    expect(f.registration_overdue).toBe(true);
    expect(f.certificate_expiring).toBe(true);
    expect(f.waqfak_role).toBe("nazir");
    expect(f.gaa_is_nazir).toBe(true);
  });
});

describe("prefill and helpers", () => {
  it("maps the waqf file to profile answers", () => {
    const a = prefillFromWaqf({ status: "active", legalType: "joint", sizeClass: "medium", nazirMode: "board", founderAlive: true, hasActiveLitigation: false, documentedOn: "2024-01-01", registeredOn: "2024-02-01" });
    expect(a).toMatchObject({ P01: "existing", P02: "both", P03: "50to200", P06: "board", P07: "yes", P11: "no", "A2-01": "yes", "A2-03": "yes" });
  });

  it("wave due dates are 30 / 90 / 365 days", () => {
    expect(waveDueDate(1, "2026-01-01")).toBe("2026-01-31");
    expect(waveDueDate(2, "2026-01-01")).toBe("2026-04-01");
    expect(waveDueDate(3, "2026-01-01")).toBe("2027-01-01");
  });

  it("confidence is the lower of completeness and evidence", () => {
    expect(combinedConfidence({ engineConfidence: "high", applicableScored: 10, knownAnswered: 10, unknownCount: 0 }).level).toBe("high");
    expect(combinedConfidence({ engineConfidence: "low", applicableScored: 10, knownAnswered: 10, unknownCount: 0 }).level).toBe("medium");
    const c = combinedConfidence({ engineConfidence: "high", applicableScored: 10, knownAnswered: 5, unknownCount: 3 });
    expect(c.level).toBe("low");
    expect(c.reasons.length).toBe(2);
  });

  it("labels answers and orders steps", () => {
    expect(answerLabel({ answerType: "maturity", options: null }, "3")).toBe("مكتوب ومعتمد");
    expect(answerLabel({ answerType: "select", options: [{ value: "a", label: "أ" }, { value: "b", label: "ب" }] }, ["a", "b"])).toBe("أ، ب");
    expect(stepsFor([{ axisCode: "A3" }, { axisCode: "A1" }], ["A1", "A2", "A3"])).toEqual(["P", "A1", "A3"]);
  });
});

describe("radar", () => {
  it("is an accessible SVG that escapes labels", () => {
    const svg = radarSvg([{ code: "A1", name: "<x>", score: 50 }, { code: "A2", name: "ب", score: null }]);
    expect(svg).toContain('role="img"');
    expect(svg).toContain("&lt;x&gt; 50");
    expect(svg).toContain("لا ينطبق");
    expect(svg).not.toContain("<x>");
    expect(sparklineSvg([10, 60])).toContain("<path");
  });
});

describe("bank v1 end to end", () => {
  it("public, all-yes answers score high; paying outside the deed raises a critical flag and caps the axis", () => {
    const answers: Record<string, { value: unknown }> = {
      P01: { value: "existing" }, P02: { value: "public" }, P03: { value: "5to50" }, P04: { value: "no" }, P06: { value: "individual" },
    };
    for (const q of QUESTIONS) if (q.axisCode !== "P" && q.options?.[0] && !answers[q.code]) answers[q.code] = { value: q.options[0].value };
    const axes = AXES.map((a) => ({ ...a }));
    const qs = QUESTIONS.map((q) => ({ ...q, depth: q.depth ?? "basic" }));
    const good = computeAssessment({ axes, questions: qs, answers, flagDefs: [] });
    expect(good.sizeClass).toBe("small");
    expect(good.computedType.type).toBe("public");
    expect(good.overallScore).toBeGreaterThan(60);

    const flagQ = QUESTIONS.find((q) => q.code === "A1-08")!;
    expect(flagQ.criticalFlagCode).toBeTruthy();
    const bad = { ...answers, "A1-08": { value: "yes" } };
    const out = computeAssessment({ axes, questions: qs, answers: bad, flagDefs: [{ code: flagQ.criticalFlagCode!, titleAr: "x", axisCode: "A1", severity: "critical" }] });
    expect(out.status).toBe("critical");
    expect(out.axisScores.find((a) => a.axisCode === "A1")!.score!).toBeLessThanOrEqual(39);
  });
});
