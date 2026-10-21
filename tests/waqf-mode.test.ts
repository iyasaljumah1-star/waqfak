import { describe, expect, it } from "vitest";
import { SERVICES } from "@/server/seed/data/services";
import { formFor } from "@/server/modules/requests/intake/forms";
import { checkIntake, intakeNeeds, sanitizeAnswers, visibleFields, visibleSteps, type Answers } from "@/server/modules/requests/intake/engine";
import { REGISTERED_ONLY, waqfModeOf, waqfModesFor } from "@/server/modules/requests/waqf-mode";
import { guardTransition } from "@/server/modules/requests/workflow";

const formOf = (code: string) => {
  const s = SERVICES.find((x) => x.code === code)!;
  return formFor({ code, audiences: s.audiences, requiredDocuments: s.docs ?? [] });
};
const shown = (code: string, a: Answers) => visibleSteps(formOf(code), a).flatMap((st) => visibleFields(st, a).map((f) => f.key));

describe("which waqf a request may concern", () => {
  it("establishment and wills accept «no waqf yet»; services about an existing waqf do not", () => {
    expect(waqfModesFor("T05").none).toBe(true);
    expect(waqfModesFor("W01").none).toBe(true);
    for (const c of ["G09", "F04", "C13", "I08", "N08"]) expect(waqfModesFor(c).none, c).toBe(false);
    expect(waqfModesFor("G09").reasons.none).toContain("وقف قائم");
  });

  it("an unregistered waqf is accepted wherever the service reads waqf data, except services run on the platform file", () => {
    for (const c of ["G09", "F04", "C08", "I08", "T06"]) expect(waqfModesFor(c).unregistered, c).toBe(true);
    for (const c of REGISTERED_ONLY) {
      expect(waqfModesFor(c).unregistered, c).toBe(false);
      expect(waqfModesFor(c).reasons.unregistered, c).toContain("مسجلًا");
    }
    // services that start from the client's answers only (design, wills) have no unregistered-waqf step
    expect(waqfModesFor("T01").unregistered).toBe(false);
    expect(formOf("T01").steps.some((s) => s.key === "unregisteredWaqf")).toBe(false);
  });

  it("every service offers at least one choice", () => {
    for (const s of SERVICES) {
      const m = waqfModesFor(s.code);
      expect(m.registered || m.unregistered || m.none, s.code).toBe(true);
    }
  });

  it("the stored mode: linked waqf → registered; else as recorded; older requests without one → none", () => {
    expect(waqfModeOf({ waqfId: "x", intake: { waqfMode: "unregistered" } })).toBe("registered");
    expect(waqfModeOf({ waqfId: null, intake: { waqfMode: "unregistered" } })).toBe("unregistered");
    expect(waqfModeOf({ waqfId: null, intake: {} })).toBe("none");
  });
});

describe("the unregistered-waqf step", () => {
  it("appears only for an unregistered waqf, and never for a registered one (its data comes from the file)", () => {
    expect(shown("G09", { waqfMode: "unregistered" })).toContain("uwName");
    expect(shown("G09", { waqfMode: "registered", waqfContext: "yes" })).not.toContain("uwName");
    expect(shown("G09", { waqfMode: "registered", waqfContext: "yes" })).toContain("dataReview");
  });

  it("asks what the service needs: G09 the board, F04 the financial records, I08 the assets", () => {
    const g = shown("G09", { waqfMode: "unregistered", uwNazirType: "board" });
    expect(g).toEqual(expect.arrayContaining(["uwNazirType", "uwBoardSize", "uwMinutes", "uwPrevEval"]));
    expect(shown("G09", { waqfMode: "unregistered", uwNazirType: "individual" })).not.toContain("uwBoardSize");
    expect(shown("F04", { waqfMode: "unregistered" })).toContain("uwFinance");
    expect(shown("F04", { waqfMode: "unregistered" })).not.toContain("uwMinutes");
    expect(shown("I08", { waqfMode: "unregistered" })).toContain("uwAssets");
  });

  it("does not ask what the service's own form already asks (no duplicate deed number)", () => {
    const t06 = formOf("T06").steps.flatMap((s) => s.fields.map((f) => f.key));
    const t04 = formOf("T04").steps.flatMap((s) => s.fields.map((f) => f.key));
    for (const keys of [t06, t04]) expect(keys.filter((k) => k === "uwDeedNo" || k === "deedNo").length).toBeLessThanOrEqual(1);
  });

  it("a client cannot keep unregistered-waqf answers on a registered request (dropped by the form rules)", () => {
    const a = sanitizeAnswers(formOf("G09"), { waqfMode: "registered", uwName: "وقف تجريبي" });
    expect(a.uwName).toBeUndefined();
  });

  it("the deed document is asked only when the client says there is a deed, and does not block sending", () => {
    const form = formOf("G09");
    const base: Answers = { waqfMode: "unregistered", uwName: "وقف تجريبي", uwType: "general", uwStatus: "documented", uwCountry: "sa", uwHasDeed: "yes" };
    const n = intakeNeeds(form, base, {});
    expect(n.start.map((x) => x.key)).toContain("uw_deed");
    expect(n.submit.map((x) => x.key)).not.toContain("uw_deed");
    expect(intakeNeeds(form, { ...base, uwHasDeed: "no" }, {}).start.map((x) => x.key)).not.toContain("uw_deed");
  });
});

describe("completeness levels", () => {
  const form = formOf("T05");
  const base: Answers = { waqfMode: "none", capacity: "waqif", contactName: "عميل تجريبي", contactPhone: "0500000000", preferredContact: "platform", priority: "normal", assetType: "real_estate", propertyUse: "commercial", propertyCity: "الرياض", ownership: "self", disposal: "self", goals: "وقف ريعه على تعليم الأيتام", duration: "perpetual", sizeEstimate: "small", beneficiaryKind: "general" };

  it("T05 asks by asset type: real estate fields, or securities fields, never both", () => {
    expect(shown("T05", { assetType: "real_estate" })).toEqual(expect.arrayContaining(["propertyCity", "propertyDeedNo", "occupancy"]));
    expect(shown("T05", { assetType: "real_estate" })).not.toContain("securityIssuer");
    expect(shown("T05", { assetType: "securities" })).toEqual(expect.arrayContaining(["securityKind", "securityIssuer", "securityQty"]));
    expect(shown("T05", { assetType: "securities" })).not.toContain("propertyCity");
    expect(shown("T05", { assetType: "cash" })).toContain("cashAmount");
  });

  it("start-level gaps do not block sending; required gaps do", () => {
    const n = intakeNeeds(form, base, {});
    expect(n.submit).toEqual([]);
    expect(n.start.map((x) => x.key)).toEqual(expect.arrayContaining(["propertyDeedNo", "encumbrances", "assets"]));
    expect(n.support.map((x) => x.key)).toEqual(expect.arrayContaining(["propertyDistrict", "value"]));
    expect(n.percent).toBeLessThan(100);
    const missingCity = intakeNeeds(form, { ...base, propertyCity: undefined }, {});
    expect(missingCity.submit.map((x) => x.key)).toContain("propertyCity");
  });

  it("«لا أعرف» lets the request be sent but holds the start", () => {
    const a = { ...base, ownership: "unknown" };
    expect(checkIntake(form, a, {}).fieldsComplete).toBe(true);
    const n = intakeNeeds(form, a, {});
    expect(n.start.find((x) => x.key === "ownership")?.why).toBeTruthy();
  });

  it("fields that do not apply are left out of completeness", () => {
    const n = intakeNeeds(form, base, {});
    expect([...n.submit, ...n.start, ...n.support].map((x) => x.key)).not.toContain("securityQty");
  });

  it("an answer needing a specialist is listed as such once given", () => {
    expect(intakeNeeds(form, base, {}).specialist.map((x) => x.key)).toContain("disposal");
  });

  it("work does not start while start-level items are missing; sending and resuming are not affected", () => {
    const g = { actorUserId: "u", conflictCheck: "passed", workflowCode: "standard", deliverers: [], submittedDeliverables: 0, unsignedOpinionDeliverables: 0, contractSignedByClient: true, hasContract: false, quoteAmount: null, pricingModel: "free", verified: true, accepted: true, blockingItems: 0 };
    expect(guardTransition({ ...g, from: "triage", to: "in_progress", startMissing: ["رقم صك الملكية"] })).toContain("رقم صك الملكية");
    expect(guardTransition({ ...g, from: "triage", to: "in_progress", startMissing: [] })).toBeNull();
    expect(guardTransition({ ...g, from: "awaiting_client", to: "in_progress", startMissing: ["x"] })).toBeNull();
  });
});

describe("each kind of service has its own structured form", () => {
  const structured = (code: string) => formOf(code).steps
    .filter((s) => !["applicant", "waqfData", "unregisteredWaqf", "notes"].includes(s.key))
    .flatMap((s) => s.fields)
    .filter((f) => f.type !== "textarea" && f.type !== "hidden" && (f.required || f.requiredIf));
  it.each([["F04", "مالية"], ["C08", "قانونية"], ["G09", "حوكمة"], ["I08", "أصول"], ["T05", "تأسيس"]])("%s (%s): several required structured fields, not one text box", (code) => {
    expect(structured(code).length, code).toBeGreaterThanOrEqual(2);
  });
});
