import { describe, expect, it } from "vitest";
import { fiscalYearOf, fiscalYearRange, isValidSaudiIban, maskIban, requiredStatementKind, summarize, validateJournal } from "../src/server/modules/finance/pure";
import { computeShares, maskId, splitAmount, tierShareIssues } from "../src/server/modules/beneficiaries/pure";
import { bandForValue, leaseAlert, suggestSizeClass } from "../src/server/modules/assets/pure";
import { allocationTotal, validateAllocation } from "../src/server/modules/deed/pure";
import { buildDeedDraft, classify, emptyState, missingItems, normalizeState } from "../src/server/modules/establish/pure";
import { bequestCheck, buildWillDraft, emptyPlan } from "../src/server/modules/wills/pure";
import { normalizeNumber, readRows } from "../src/server/modules/waqf-file/form";

describe("finance", () => {
  it("validates Saudi IBANs with the mod-97 check and masks them", () => {
    expect(isValidSaudiIban("SA03 8000 0000 6080 1016 7519")).toBe(true);
    expect(isValidSaudiIban("SA04 8000 0000 6080 1016 7519")).toBe(false);
    expect(isValidSaudiIban("GB82WEST12345698765432")).toBe(false);
    expect(maskIban("7519")).toMatch(/7519$/);
    expect(maskIban("7519")).not.toMatch(/8000/);
  });
  it("accepts balanced journals only", () => {
    expect(validateJournal([{ accountCode: "1100", debit: 1000, credit: 0 }, { accountCode: "4100", debit: 0, credit: 1000 }]).ok).toBe(true);
    const r = validateJournal([{ accountCode: "1100", debit: 1000, credit: 0 }, { accountCode: "4100", debit: 0, credit: 900 }]);
    expect(r.ok).toBe(false);
    expect(validateJournal([{ accountCode: "1100", debit: 10, credit: 10 }, { accountCode: "4100", debit: 0, credit: 0 }]).ok).toBe(false);
    expect(validateJournal([{ accountCode: "1100", debit: 10, credit: 0 }]).ok).toBe(false);
    expect(validateJournal([{ accountCode: "9999", debit: 10, credit: 0 }, { accountCode: "4100", debit: 0, credit: 10 }]).ok).toBe(false);
    // cents are compared exactly (0.1 + 0.2 style errors do not break balance)
    expect(validateJournal([{ accountCode: "5100", debit: 0.1, credit: 0 }, { accountCode: "5200", debit: 0.2, credit: 0 }, { accountCode: "1100", debit: 0, credit: 0.3 }]).ok).toBe(true);
  });
  it("computes fiscal-year ranges and summaries", () => {
    expect(fiscalYearRange("12-31", 2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(fiscalYearRange("06-30", 2026)).toEqual({ from: "2025-07-01", to: "2026-06-30" });
    expect(fiscalYearOf("06-30", "2026-07-15")).toBe(2027);
    expect(fiscalYearOf("12-31", "2026-07-15")).toBe(2026);
    const s = summarize([
      { accountCode: "1100", debit: "1000", credit: "0" }, { accountCode: "4100", debit: "0", credit: "1000" },
      { accountCode: "5400", debit: "300", credit: "0" }, { accountCode: "1100", debit: "0", credit: "300" },
    ]);
    expect(s).toMatchObject({ revenue: 1000, expense: 300, net: 700, distributions: 300, cashIn: 1000, cashOut: 300 });
    expect(requiredStatementKind("medium")).toBe("audited");
    expect(requiredStatementKind("small")).toBe("simple_statement");
  });
});

describe("beneficiaries", () => {
  it("divides equally or male-double", () => {
    const eq = computeShares([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], "equal");
    expect(eq.ok && eq.shares.a).toBe(0.25);
    const md = computeShares([{ id: "s", gender: "m" }, { id: "d1", gender: "f" }, { id: "d2", gender: "f" }], "male_double");
    expect(md.ok && md.shares.s).toBe(0.5);
    expect(md.ok && md.shares.d1).toBe(0.25);
    expect(computeShares([{ id: "x" }], "male_double").ok).toBe(false);
  });
  it("splits amounts exactly to the halala", () => {
    const lines = splitAmount(100, [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }]);
    expect(lines.reduce((s, l) => s + Math.round(l.amount * 100), 0)).toBe(10000);
    expect(lines.map((l) => l.amount).sort()).toEqual([33.33, 33.33, 33.34]);
    expect(splitAmount(0, [])).toEqual([]);
  });
  it("flags tier shares over 100% and masks ids", () => {
    expect(tierShareIssues([{ tier: 1, relation: "and", sharePct: "60", name: "x" }, { tier: 1, relation: "and", sharePct: "50", name: "y" }])[0]).toMatch(/100%/);
    expect(tierShareIssues([{ tier: 1, relation: "and", sharePct: "60", name: "x" }, { tier: 1, relation: "and", sharePct: "40", name: "y" }])).toEqual([]);
    expect(maskId("1012345678")).toBe("••••••5678");
  });
});

describe("assets", () => {
  it("maps totals to bands and size classes", () => {
    expect(bandForValue(3_200_000)).toBe("lt5");
    expect(bandForValue(18_500_000)).toBe("5to50");
    expect(bandForValue(60_000_000)).toBe("50to200");
    expect(bandForValue(240_000_000)).toBe("gte200");
    expect(suggestSizeClass(18_500_000, false)).toBe("small");
    expect(suggestSizeClass(60_000_000, false)).toBe("medium");
    expect(suggestSizeClass(250_000_000, false)).toBe("large");
    expect(suggestSizeClass(250_000_000, true)).toBe("direct_benefit");
  });
  it("alerts on lease expiry", () => {
    expect(leaseAlert("2026-10-01", "2026-10-07")).toBe("expired");
    expect(leaseAlert("2026-12-01", "2026-10-07")).toBe("soon");
    expect(leaseAlert("2027-12-01", "2026-10-07")).toBe("ok");
    expect(leaseAlert(null, "2026-10-07")).toBe("open");
  });
});

describe("deed allocation", () => {
  it("keeps the total at or below 100%", () => {
    expect(allocationTotal({ maintenancePct: "10", reservePct: "5.5", nazirFeePct: 4 })).toBe(19.5);
    const ok = validateAllocation({ maintenancePct: "10", reservePct: "10" });
    expect(ok.ok && ok.beneficiariesPct).toBe(80);
    expect(validateAllocation({ maintenancePct: "60", reservePct: "50" }).ok).toBe(false);
  });
});

describe("establish wizard", () => {
  it("classifies from beneficiary answers (GAA type guide)", () => {
    const s = emptyState("س");
    expect(classify({ ...s.classification, beneficiaryKind: "public" }).type).toBe("public");
    expect(classify({ ...s.classification, beneficiaryKind: "both" }).type).toBe("joint");
    expect(classify({ ...s.classification, beneficiaryKind: "private" }).type).toBe("private");
    expect(classify({ ...s.classification, beneficiaryKind: "private", charitableQualifier: "yes" }).type).toBe("public");
  });
  it("lists what is missing and builds a deed draft with the guide's clauses", () => {
    const s = normalizeState({ classification: { beneficiaryKind: "private" } }, "واقف (تجريبي)");
    expect(missingItems(s).map((m) => m.step)).toEqual(expect.arrayContaining([3, 4, 5, 7]));
    const full = normalizeState({
      waqfName: "وقف الاختبار (تجريبي)",
      classification: { beneficiaryKind: "private", thenToCharity: "yes" },
      assets: [{ category: "real_estate", title: "عمارة سكنية", ownershipDocNo: "123", value: "2000000", inFounderName: "on", sharePct: "" }],
      classes: [{ name: "أولاد الواقف", kind: "private", tier: "1", relation: "and", sharePct: "", divisionRule: "male_double", substitutionRule: "branch_replaces" }],
      finalDestination: "الفقراء والمساكين",
      nazara: { mode: "founder" },
      allocation: { maintenancePct: "10", reservePct: "5" },
    }, "واقف (تجريبي)");
    expect(missingItems(full)).toEqual([]);
    const text = buildDeedDraft(full, "2026-10-07");
    for (const h of ["البند الأول", "الأصل الموقوف", "اسم الوقف", "مصارف الوقف", "النظارة", "توزيع الغلة", "الخاتمة"]) expect(text).toContain(h);
    expect(text).toContain("للذكر مثل حظ الأنثيين");
    expect(text).toContain("الفقراء والمساكين");
    expect(text).toContain("85%");
  });
});

describe("wills", () => {
  it("checks the one-third limit after debts", () => {
    const p = { ...emptyPlan(), estate: [{ kind: "cash", description: "", value: "900000" }, { kind: "real_estate", description: "", value: "300000" }], debts: "300000" };
    const ok = bequestCheck({ ...p, bequestMode: "pct", bequestPct: "33" });
    expect(ok.net).toBe(900000);
    expect(ok.third).toBe(300000);
    expect(ok.exceedsThird).toBe(false);
    const over = bequestCheck({ ...p, bequestMode: "amount", bequestAmount: "400000" });
    expect(over.exceedsThird).toBe(true);
    expect(over.excess).toBe(100000);
    expect(over.needsHeirConsent).toBe(true);
    expect(bequestCheck({ ...p, bequestMode: "pct", bequestPct: "10", bequestToHeir: "on" }).needsHeirConsent).toBe(true);
    expect(buildWillDraft({ ...p, testatorName: "موصٍ (تجريبي)", bequestMode: "amount", bequestAmount: "400000", masraf: "طلاب العلم" }, "2026-10-07")).toContain("إجازة الورثة");
  });
});

describe("form helpers", () => {
  it("normalizes Arabic digits and reads repeated rows", () => {
    expect(normalizeNumber("١٢٬٥٠٠٫٥")).toBe("12500.5");
    const fd = new FormData();
    fd.append("a.title", "x");
    fd.append("a.value", "1");
    fd.append("a.title", "");
    fd.append("a.value", "");
    fd.append("a.title", "y");
    fd.append("a.value", "2");
    expect(readRows(fd, "a", ["title", "value"])).toEqual([{ title: "x", value: "1" }, { title: "y", value: "2" }]);
  });
});
