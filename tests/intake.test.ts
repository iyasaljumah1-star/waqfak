import { describe, expect, it } from "vitest";
import { SERVICES } from "@/server/seed/data/services";
import { DOC_TYPES } from "@/server/modules/documents/labels";
import {
  checkIntake, evalCond, intakeProgress, sanitizeAnswers, summarize, summaryText, validateField, validateStep, visibleDocs, visibleSteps,
  type Cond, type Field, type ServiceForm,
} from "@/server/modules/requests/intake/engine";
import { formFor, INTAKE_FORM_CODES } from "@/server/modules/requests/intake/forms";

const formOf = (code: string) => {
  const s = SERVICES.find((x) => x.code === code)!;
  return formFor({ code, audiences: s.audiences, requiredDocuments: s.docs ?? [] });
};

const condFields = (c: Cond | undefined): string[] => (!c ? [] : "all" in c ? c.all.flatMap(condFields) : "any" in c ? c.any.flatMap(condFields) : [c.field]);

describe("service intake forms", () => {
  it("every catalog service has its own specialised form", () => {
    const missing = SERVICES.map((s) => s.code).filter((c) => !INTAKE_FORM_CODES.includes(c));
    expect(missing).toEqual([]);
  });

  for (const svc of SERVICES) {
    it(`${svc.code} form is well-formed`, () => {
      const form = formOf(svc.code);
      const fields = form.steps.flatMap((s) => s.fields);
      const keys = fields.map((f) => f.key);
      expect(new Set(keys).size, "duplicate field keys").toBe(keys.length);
      expect(form.steps[0].key).toBe("applicant");
      expect(form.steps.length).toBeGreaterThanOrEqual(3);
      // the service asks at least one question of its own (beyond applicant + notes)
      expect(form.steps.slice(1, -1).flatMap((s) => s.fields).length).toBeGreaterThan(0);
      for (const f of fields) {
        if (["select", "radio", "checkboxes"].includes(f.type)) expect(f.options?.length, `${f.key} options`).toBeGreaterThan(0);
        for (const ref of [...condFields(f.showIf), ...condFields(f.requiredIf)]) expect(keys, `${f.key} refers to ${ref}`).toContain(ref);
      }
      for (const d of form.docs) {
        expect(DOC_TYPES as readonly string[]).toContain(d.docType);
        for (const ref of [...condFields(d.showIf), ...condFields(d.requiredIf)]) expect(keys, `doc ${d.key} refers to ${ref}`).toContain(ref);
      }
      expect(new Set(form.docs.map((d) => d.key)).size).toBe(form.docs.length);
      expect(form.sources.length).toBeGreaterThan(0);
    });
  }

  it("merges the documents configured on the service (admin) into the form", () => {
    const n01 = formOf("N01");
    expect(n01.docs.map((d) => d.docType)).toEqual(expect.arrayContaining(["waqf_deed", "registration_certificate", "ownership_deed", "financial_statement", "bank_statement"]));
    expect(n01.docs.find((d) => d.docType === "waqf_deed")?.required).toBe(true);
    // the shared form definition is not mutated across calls
    const again = formOf("T03");
    expect(again.docs.filter((d) => d.key === "ownership").length).toBe(1);
  });
});

describe("intake engine", () => {
  const form = formOf("T03");
  const base = { capacity: "waqif", contactName: "مستخدم تجريبي", contactPhone: "0500000001", preferredContact: "platform", priority: "normal" };

  it("evaluates conditions", () => {
    expect(evalCond({ field: "a", eq: "yes" }, { a: "yes" })).toBe(true);
    expect(evalCond({ field: "a", in: ["x", "y"] }, { a: ["z", "y"] })).toBe(true);
    expect(evalCond({ field: "a", notEmpty: true }, { a: " " })).toBe(false);
    expect(evalCond({ all: [{ field: "a", eq: "1" }, { field: "b", eq: "2", not: true }] }, { a: "1", b: "3" })).toBe(true);
    expect(evalCond({ any: [{ field: "a", eq: "1" }, { field: "b", eq: "2" }] }, {})).toBe(false);
  });

  it("validates typed fields", () => {
    const fld = (type: Field["type"], o: Partial<Field> = {}): Field => ({ key: "x", label: "س", type, ...o });
    expect(validateField(fld("phone"), "0512345678", {})).toBeNull();
    expect(validateField(fld("phone"), "12345", {})).toMatch(/جوال/);
    expect(validateField(fld("idnumber"), "1234567890", {})).toBeNull();
    expect(validateField(fld("idnumber"), "3234567890", {})).not.toBeNull();
    expect(validateField(fld("money"), "-5", {})).not.toBeNull();
    expect(validateField(fld("percent"), "120", {})).not.toBeNull();
    expect(validateField(fld("number"), "2.5", {})).not.toBeNull();
    expect(validateField(fld("date"), "2025-02-30x", {})).not.toBeNull();
    expect(validateField(fld("select", { options: [["a", "أ"]] }), "b", {})).not.toBeNull();
    expect(validateField(fld("text", { required: true }), "", {})).toMatch(/مطلوب/);
    expect(validateField(fld("ack", { required: true }), undefined, {})).toMatch(/الإقرار/);
  });

  it("conditional required fields: agent must give the principal and POA", () => {
    const step = form.steps[0];
    expect(Object.keys(validateStep(step, { ...base }))).toEqual([]);
    const errs = validateStep(step, { ...base, capacity: "agent" });
    expect(Object.keys(errs).sort()).toEqual(["poaNumber", "principalName"]);
    // and the POA document becomes required
    expect(checkIntake(form, { ...base, capacity: "agent" }, {}).missingDocs.map((d) => d.key)).toContain("poa");
  });

  it("drops answers to hidden fields, unknown keys and invalid options", () => {
    const a = sanitizeAnswers(form, { ...base, capacity: "waqif", poaNumber: "123", unknown: "x", assetType: "nope", mortgaged: "no", mortgageNote: "should go" });
    expect(a.poaNumber).toBeUndefined();
    expect(a.unknown).toBeUndefined();
    expect(a.mortgageNote).toBeUndefined();
    expect(a.assetType).toBe("nope"); // select value kept for display; validation rejects it
    expect(validateStep(form.steps.find((s) => s.fields.some((f) => f.key === "assetType"))!, a).assetType).toBeTruthy();
  });

  it("cascades: hiding a field also hides fields that depend on it", () => {
    const f: ServiceForm = { code: "X", version: 1, sources: ["t"], docs: [], steps: [{ key: "s", title: "s", fields: [
      { key: "a", label: "a", type: "yesno" }, { key: "b", label: "b", type: "yesno", showIf: { field: "a", eq: "yes" } }, { key: "c", label: "c", type: "text", showIf: { field: "b", eq: "yes" } },
    ] }] };
    expect(sanitizeAnswers(f, { a: "no", b: "yes", c: "z" })).toEqual({ a: "no" });
  });

  it("full check: fields and documents, progress and summary", () => {
    const answers = {
      ...base, waqifName: "واقف تجريبي", waqifId: "1000000001", waqfName: "وقف تجريبي", waqfKind: "general", assetType: "real_estate",
      assetDescription: "أرض تجريبية في حي تجريبي", ownershipDeedNo: "000", registeredToWaqif: "yes", mortgaged: "no", share: "whole", appurtenances: "all",
      masarif: JSON.stringify([{ tier: "1", beneficiary: "مصرف تجريبي", share: "100", division: "na" }]), alternateMasraf: "الفقراء والمساكين",
      selfBenefit: "no", nazirType: "self", succession: "authority", investmentAllowed: "yes",
    };
    const c1 = checkIntake(form, answers, {});
    expect(c1.fieldsComplete).toBe(true);
    expect(c1.docsComplete).toBe(false);
    expect(c1.missingDocs.map((d) => d.key)).toEqual(["ownership"]);
    expect(intakeProgress(form, answers, {})).toBeLessThan(100);
    const c2 = checkIntake(form, answers, { ownership: ["d1"] });
    expect(c2.docsComplete).toBe(true);
    expect(intakeProgress(form, answers, { ownership: ["d1"] })).toBe(100);
    const sum = summarize(form, answers);
    expect(sum.map((s) => s.key)).toEqual(visibleSteps(form, answers).map((s) => s.key));
    expect(summaryText(form, answers)).toContain("أرض تجريبية");
    // conditional documents appear only when relevant
    expect(visibleDocs(form, answers).some((d) => d.key === "mortgagee")).toBe(false);
    expect(visibleDocs(form, { ...answers, mortgaged: "yes" }).some((d) => d.key === "mortgagee")).toBe(true);
  });
});

describe("table fields (repeating rows)", () => {
  const f: ServiceForm = { code: "X", version: 1, sources: ["t"], docs: [], steps: [{ key: "s", title: "s", fields: [
    { key: "rows", label: "الوصايا", type: "table", required: true, minRows: 1, columns: [
      { key: "kind", label: "النوع", type: "select", required: true, options: [["a", "أ"], ["b", "ب"]] },
      { key: "basis", label: "الأساس", type: "select", required: true, options: [["share", "نسبة"], ["amount", "مبلغ"]] },
      { key: "percent", label: "النسبة", type: "percent", required: true, showIf: { col: "basis", in: ["share"] } },
      { key: "amount", label: "المبلغ", type: "money", required: true, showIf: { col: "basis", in: ["amount"] } },
    ] },
  ] }] };
  it("requires the minimum rows and validates each visible cell", () => {
    expect(validateStep(f.steps[0], {}).rows).toMatch(/مطلوب|صفًا/);
    expect(validateStep(f.steps[0], { rows: JSON.stringify([{ kind: "a", basis: "share" }]) }).rows).toMatch(/النسبة/);
    expect(validateStep(f.steps[0], { rows: JSON.stringify([{ kind: "a", basis: "share", percent: "150" }]) }).rows).toMatch(/أكبر من 100/);
    expect(validateStep(f.steps[0], { rows: JSON.stringify([{ kind: "a", basis: "amount", amount: "5000" }]) }).rows).toBeUndefined();
  });
  it("sanitizes: drops hidden cells, unknown columns, empty rows and malformed input", () => {
    const a = sanitizeAnswers(f, { rows: JSON.stringify([{ kind: "a", basis: "amount", amount: "5", percent: "9", hack: "x" }, {}]) });
    expect(JSON.parse(a.rows as string)).toEqual([{ kind: "a", basis: "amount", amount: "5" }]);
    expect(sanitizeAnswers(f, { rows: "not json" }).rows).toBeUndefined();
  });
  it("displays one line per row", () => {
    const sum = summarize(f, { rows: JSON.stringify([{ kind: "a", basis: "share", percent: "10" }, { kind: "b", basis: "amount", amount: "500" }]) });
    expect(sum[0].rows[0].value).toContain("1) النوع: أ، الأساس: نسبة، النسبة: 10٪");
    expect(sum[0].rows[0].value).toContain("2) النوع: ب");
  });
});
