/**
 * Owner's decisions on the specialist tracks (2026-11-06) as code: the T02 methodology (synthetic cases TC1–TC12 of
 * the T02 report, synthetic data only) and the accounting framework by entity. Pure; no database.
 */
import { describe, expect, it } from "vitest";
import { assessStudy, checkFigure, type Figure, type StudyInput } from "../src/server/knowledge/t02";
import { frameworkFor, mayStateFas37AsFramework } from "../src/server/knowledge/accounting";

const off = (o: Partial<Figure>): Figure => ({ indicator: "مؤشر", value: 10, unit: "نسمة", dataClass: "official_published", sourceId: "GASTAT-CENSUS-2022", refYear: 2024, geoLevel: "region", geoCode: "جازان", minFreshnessYears: 5, purpose: "تعليم", side: "need", ...o });
const study = (o: Partial<StudyInput> = {}): StudyInput => ({ level: "region", year: 2026, requestedDomain: "تعليم", candidates: ["تعليم", "صحة"], condition: { kind: "general", permittedPurposes: [] }, figures: [], ...o });
const full = (p: string) => [off({ purpose: p }), off({ purpose: p, indicator: "مؤشر 2" }), off({ purpose: p, side: "supply", indicator: "عرض" })];

describe("T02 methodology", () => {
  it("TC1 a specific condition admits only its purposes, whatever the need elsewhere", () => {
    const r = assessStudy(study({ condition: { kind: "specific", permittedPurposes: ["تعليم"] }, figures: [...full("تعليم"), ...full("صحة")] }));
    expect(r.candidates).toEqual(["تعليم"]);
    expect(r.excluded.map((x) => x.purpose)).toEqual(["صحة"]);
    expect(r.excluded[0]!.why).toMatch(/م9\/1/);
  });
  it("TC2 a general condition with sufficient official recent data at the study's level gives a reasoned recommendation, still to be approved", () => {
    const r = assessStudy(study({ figures: [...full("تعليم"), ...full("صحة")] }));
    expect(r).toMatchObject({ status: "recommendation", confidence: "high", approvals: ["محلل", "مراجع شرعي"] });
  });
  it("TC3/TC4 a country or region figure is not local data for a district; no decisive recommendation", () => {
    const r = assessStudy(study({ level: "district", candidates: ["كبار السن"], figures: [off({ purpose: "كبار السن", geoLevel: "region" }), off({ purpose: "كبار السن", geoLevel: "country", indicator: "البطالة" })] }));
    expect(r.status).toBe("preliminary");
    expect(r.figures.every((f) => !f.scopeOk)).toBe(true);
    expect(r.gaps.join(" ")).toMatch(/R4/);
    expect(r.dataRequests.join(" ")).toMatch(/دراسة ميدانية/);
  });
  it("TC5 an old figure is labelled with its year and cannot support a decisive recommendation alone", () => {
    const c = checkFigure(off({ refYear: 2015 }), { level: "region", year: 2026 });
    expect(c.old).toBe(true);
    expect(c.label).toMatch(/قديم \(2015\)/);
    expect(assessStudy(study({ candidates: ["تعليم"], figures: [off({ refYear: 2015 }), off({ refYear: 2015, indicator: "2" }), off({ side: "supply", refYear: 2015 })] })).status).toBe("preliminary");
  });
  it("TC6/TC7 an estimate without formula, or a figure without a source, is not shown", () => {
    expect(checkFigure(off({ dataClass: "estimate_assumption", sourceId: null, formula: null }), { level: "region", year: 2026 }).shown).toBe(false);
    expect(checkFigure(off({ sourceId: null, sourceUrl: null }), { level: "region", year: 2026 })).toMatchObject({ shown: false, issues: [expect.stringMatching(/بلا مصدر/)] });
    const e = checkFigure(off({ dataClass: "estimate_assumption", sourceId: null, formula: "سكان المنطقة × نسبة وطنية", rationale: "لا رقم محلي" }), { level: "region", year: 2026 });
    expect(e).toMatchObject({ shown: true, estimate: true, label: expect.stringMatching(/تقديري$/) });
  });
  it("TC9 a requested domain outside the condition gives no recommendation and names the permitted purposes", () => {
    const r = assessStudy(study({ requestedDomain: "إسكان", candidates: ["إسكان"], condition: { kind: "specific", permittedPurposes: ["طلبة العلم"] } }));
    expect(r.status).toBe("out_of_condition");
    expect(r.statement).toMatch(/طلبة العلم/);
  });
  it("TC10 a field cell under 10 persons is suppressed", () => {
    expect(checkFigure(off({ dataClass: "field", cellSize: 6 }), { level: "region", year: 2026 })).toMatchObject({ shown: false, issues: [expect.stringMatching(/R12/)] });
  });
  it("TC11 an ambiguous condition suspends the study and refers it for interpretation", () => {
    expect(assessStudy(study({ condition: { kind: "ambiguous", permittedPurposes: [] } }))).toMatchObject({ status: "suspended", dataRequests: [expect.stringMatching(/م9\/2/)] });
  });
  it("TC12 an unstable ranking lowers confidence one step", () => {
    expect(assessStudy(study({ figures: [...full("تعليم"), ...full("صحة")], rankingStable: false })).confidence).toBe("medium");
  });
});

describe("accounting framework by entity", () => {
  it("defaults a registered waqf to SOCPA's non-profit standards, never FAS 37, and leaves the authority's confirmation open", () => {
    const r = frameworkFor("waqf_large_medium");
    expect(r.framework).toMatch(/سوكبا/);
    expect(r.fas37).toBe("supplementary_optional");
    expect(r.needsHumanDecision).toBe(true);
    expect(r.openQuestions.join(" ")).toMatch(/تأكيد مكتوب/);
  });
  it("keeps the waqf, the non-profit company, the fund and the commercial subsidiaries apart", () => {
    expect(frameworkFor("nonprofit_company").framework).toMatch(/لا معايير المنشآت غير الهادفة للربح/);
    expect(frameworkFor("waqf_fund").framework).toMatch(/صناديق الاستثمار/);
    expect(frameworkFor("commercial_subsidiary").framework).toMatch(/المعايير الدولية/);
    expect(frameworkFor("family_waqf_commercial").needsHumanDecision).toBe(true);
  });
  it("FAS 37 is stated as the framework only with the auditor's and the supervisor's written acceptance", () => {
    expect(mayStateFas37AsFramework({ auditorAcceptedInWriting: true, supervisorAcceptedInWriting: false })).toBe(false);
    expect(mayStateFas37AsFramework({ auditorAcceptedInWriting: true, supervisorAcceptedInWriting: true })).toBe(true);
  });
});
