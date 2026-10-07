import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import {
  annualPeriods, applicable, buildCsv, buildFacts, buildIcs, buildZip, closureFor, configOf, crc32, csvCell, explain, isSatisfied,
  monthWeeks, nextStatus, penaltyInfo, periodKeyFor, pickReminder, readiness, riskBand, rowToDef, shiftMonth,
  type ObligationRow, type WaqfProfile,
} from "../src/server/modules/compliance/pure";
import { dueFor } from "../src/server/engines/compliance";

const profile = (o: Partial<WaqfProfile> = {}): WaqfProfile => ({
  id: "w1", sizeClass: "medium", legalType: "public", computedType: null, status: "registered", nazirMode: "individual", creationMode: null,
  waqfakRole: null, collectsDonations: false, hasForeignParty: false, hasBeneficiariesAbroad: false, hasActiveLitigation: false, directBenefit: false,
  founderAlive: true, fiscalYearEnd: "12-31", documentedOn: "2023-03-14", registeredOn: "2023-05-02", registrationExpiresOn: "2027-05-01", stage: 5, ...o,
});

const row = (o: Partial<ObligationRow> = {}): ObligationRow => ({
  id: "o1", code: "OB-TST-01", titleAr: "اختبار", triggerEvent: "material_change", offsetValue: 15, offsetUnit: "business_days", recurrence: "none",
  appliesTo: {}, severity: "high", reminderOffsetsDays: [30, 7, 1], obligationType: "update", ...o,
});

describe("applicability (data-driven)", () => {
  const f = buildFacts(profile(), { portfolioCount: 0, beneficiaryCount: 12 });

  it("applies structured size / flag filters", () => {
    expect(applicable(row({ appliesTo: { sizeClasses: ["large", "medium"] } }), f)).toBe(true);
    expect(applicable(row({ appliesTo: { sizeClasses: ["small"] } }), f)).toBe(false);
    expect(applicable(row({ appliesTo: { requiresFlags: ["collectsDonations"] } }), f)).toBe(false);
    expect(applicable(row({ appliesTo: { requiresFlags: ["collectsDonations"] } }), buildFacts(profile({ collectsDonations: true })))).toBe(true);
    expect(applicable(row({ appliesTo: { excludesFlags: ["hasPortfolio"] } }), buildFacts(profile(), { portfolioCount: 1 }))).toBe(false);
  });

  it("evaluates an admin-authored JSON-logic rule over waqf facts (no code change needed)", () => {
    const rule = { and: [{ "==": [{ var: "legalType" }, "public"] }, { ">=": [{ var: "beneficiaryCount" }, 10] }] };
    expect(applicable(row({ appliesTo: { rule } }), f)).toBe(true);
    expect(applicable(row({ appliesTo: { rule } }), buildFacts(profile(), { beneficiaryCount: 3 }))).toBe(false);
    expect(applicable(row({ appliesTo: { rule: { "==": [{ var: "assessment.q_foreign" }, "yes"] } } }), buildFacts(profile(), { assessmentFacts: { q_foreign: "yes" } }))).toBe(true);
  });

  it("never applies an invalid rule, a manual definition or an internal one", () => {
    expect(applicable(row({ appliesTo: { rule: { nope: [1] } } }), f)).toBe(false);
    expect(applicable(row({ obligationType: "manual" }), f)).toBe(false);
  });

  it("derives facts: documented/registered from status, direct benefit from size, flags from assessment", () => {
    const g = buildFacts(profile({ status: "draft", documentedOn: null, registeredOn: null, sizeClass: "direct_benefit" }), { assessmentFacts: { conditionSetsPayDate: "yes" } });
    expect(g.documented).toBe(false);
    expect(g.registered).toBe(false);
    expect(g.directBenefit).toBe(true);
    expect(g.conditionSetsPayDate).toBe(true);
  });

  it("explains why an obligation applies", () => {
    const why = explain(row({ appliesTo: { sizeClasses: ["medium"], requiresFlags: ["registered"] } }), f);
    expect(why.join(" ")).toContain("متوسط");
    expect(why.join(" ")).toContain("مسجّل لدى الهيئة");
  });
});

describe("closures, satisfaction and periods", () => {
  it("uses code defaults only when the DB config is silent (DB wins)", () => {
    expect(closureFor(row({ code: "OB-REG-01" }), "registration")).toBe("all_open");
    expect(closureFor(row({ code: "OB-REG-01", appliesTo: { closesOn: ["other_event"] } }), "registration")).toBeNull();
    expect(closureFor(row({ appliesTo: { closesOn: [{ event: "statements_final", scope: "earliest_open" }] } }), "statements_final")).toBe("earliest_open");
    expect(configOf(row({ code: "OB-REG-03" })).closesOn).toEqual([{ event: "cert_expiry", scope: "other_periods" }]);
  });

  it("satisfiedWhen marks registration done once registered", () => {
    const r = row({ code: "OB-REG-01" });
    expect(isSatisfied(r, buildFacts(profile()))).toBe(true);
    expect(isSatisfied(r, buildFacts(profile({ status: "documented", registeredOn: null })))).toBe(false);
  });

  it("dedupe keys: one per period / reference / date", () => {
    expect(periodKeyFor({ recurrence: "annual", triggerEvent: "fiscal_year_end" }, { event: "fiscal_year_end", date: "2025-12-31" })).toBe("FY2025");
    expect(periodKeyFor({ recurrence: "none", triggerEvent: "standing" }, { event: "standing", date: "2023-01-01" })).toBe("standing");
    expect(periodKeyFor({ recurrence: "none", triggerEvent: "material_change" }, { event: "material_change", date: "2026-09-01", refId: "abc" })).toBe("ref:abc");
    // Date-keyed events ignore refId so profile-derived triggers and explicit emits dedupe.
    expect(periodKeyFor({ recurrence: "none", triggerEvent: "cert_expiry" }, { event: "cert_expiry", date: "2027-05-01", refId: "x" })).toBe("cert_expiry:2027-05-01");
  });

  it("materialises current and next fiscal periods, not before documentation", () => {
    expect(annualPeriods("12-31", "2026-10-07", "2023-03-14")).toEqual(["2025-12-31", "2026-12-31"]);
    expect(annualPeriods("06-30", "2026-10-07", null)).toEqual(["2026-06-30", "2027-06-30"]);
    expect(annualPeriods("12-31", "2026-10-07", "2026-01-10")).toEqual(["2026-12-31"]);
    expect(annualPeriods("bad", "2026-10-07", null)).toEqual(["2025-12-31", "2026-12-31"]);
  });

  it("computes due dates in business days (Fri/Sat weekend + holidays)", () => {
    const d = rowToDef(row({ offsetValue: 15, offsetUnit: "business_days" }));
    // 2026-09-01 is a Tuesday; 15 business days later (no holidays) = 2026-09-22.
    expect(dueFor(d, "2026-09-01", new Set()).due).toBe("2026-09-22");
    expect(dueFor(d, "2026-09-01", new Set(["2026-09-23", "2026-09-22"])).due).toBe("2026-09-24");
    expect(dueFor(rowToDef(row({ offsetUnit: "immediate", offsetValue: null })), "2026-09-01", new Set())).toEqual({ due: "2026-09-01", immediate: true });
  });
});

describe("status, reminders, readiness", () => {
  it("recomputes status from the due date", () => {
    expect(nextStatus("2026-10-01", "2026-10-07")).toBe("overdue");
    expect(nextStatus("2026-10-15", "2026-10-07")).toBe("due_soon");
    expect(nextStatus("2026-12-31", "2026-10-07")).toBe("upcoming");
    expect(nextStatus(null, "2026-10-07")).toBe("upcoming");
  });

  it("sends one reminder per offset, skipping (but covering) missed earlier offsets", () => {
    const r1 = pickReminder("2026-10-12", "2026-10-07", [30, 7, 1], []);
    expect(r1).toEqual({ kind: "reminder", offset: 7, covered: [30, 7] });
    expect(pickReminder("2026-10-12", "2026-10-07", [30, 7, 1], [30, 7])).toBeNull();
    expect(pickReminder("2026-10-12", "2026-10-11", [30, 7, 1], [30, 7])).toMatchObject({ offset: 1 });
  });

  it("sends overdue notices at 1, 7 and 30 days late, once each", () => {
    expect(pickReminder("2026-10-01", "2026-10-02", [30, 7, 1], [30, 7, 1])).toEqual({ kind: "overdue", offset: -1, covered: [-1] });
    expect(pickReminder("2026-10-01", "2026-10-09", [30, 7, 1], [-1])).toEqual({ kind: "overdue", offset: -7, covered: [-7] });
    expect(pickReminder("2026-10-01", "2026-10-09", [30, 7, 1], [-1, -7])).toBeNull();
  });

  it("readiness = done on time ÷ fallen due (waived excluded, early completion counts)", () => {
    const r = readiness(
      [
        { status: "done", dueOn: "2026-01-31", completedOn: "2026-01-20" },
        { status: "done", dueOn: "2026-02-28", completedOn: "2026-03-05" },
        { status: "overdue", dueOn: "2026-09-01", completedOn: null },
        { status: "waived", dueOn: "2026-05-01", completedOn: null },
        { status: "done", dueOn: "2026-12-31", completedOn: "2026-10-01" },
        { status: "upcoming", dueOn: "2026-12-31", completedOn: null },
      ],
      "2026-10-07",
    );
    expect(r).toEqual({ due: 4, onTime: 2, pct: 50 });
    expect(readiness([], "2026-10-07").pct).toBeNull();
  });
});

describe("penalty display", () => {
  const p = { code: "7-2", titleAr: "عدم التحديث", category: "التسجيل", dismissalRisk: "no", largeText: "غرامة كبيرة", mediumText: null, smallText: null, verificationStatus: "pending_verification" };
  it("picks the size band text and flags pending verification", () => {
    const large = penaltyInfo(p, "high", "large")!;
    expect(large.text).toContain("غرامة كبيرة");
    expect(large.pending).toBe(true);
    expect(large.text).toContain("بانتظار التحقق");
    expect(penaltyInfo(p, "high", "medium")!.text).toContain("غرامة مالية");
    expect(penaltyInfo({ ...p, dismissalRisk: "after_notice" }, "low", "small")!.band).toBe("dismissal");
    expect(penaltyInfo({ ...p, verificationStatus: "verified" }, "low", "small")!.pending).toBe(false);
    expect(penaltyInfo(null, "high", "large")).toBeNull();
  });
});

describe("exports", () => {
  it("builds RFC 5545 iCalendar with folded UTF-8 lines and escaped text", () => {
    const ics = buildIcs([{ uid: "u1", date: "2026-10-18", title: "رد على طلب الهيئة, عاجل; مهم", description: "سطر1\nسطر2", url: "https://x/y" }], new Date("2026-10-07T00:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261018");
    expect(ics).toContain("DTEND;VALUE=DATE:20261019");
    expect(ics).toContain("\\,");
    expect(ics).toContain("\\;");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  });

  it("neutralises CSV formula injection and adds a BOM", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell('a"b')).toBe(`"a""b"`);
    expect(buildCsv(["a"], [["1"]]).startsWith("﻿")).toBe(true);
  });

  it("writes a valid ZIP (signatures, CRC, deflated entries round-trip)", () => {
    const text = "سجل الالتزامات ".repeat(200);
    const zip = buildZip([{ name: "obligations.csv", data: text }, { name: "a.bin", data: new Uint8Array([1, 2, 3]) }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(2);
    // First entry: deflated, decompresses to the original and matches its CRC.
    const method = zip.readUInt16LE(8);
    const csize = zip.readUInt32LE(18);
    const nlen = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nlen).toString("utf8")).toBe("obligations.csv");
    const body = zip.subarray(30 + nlen, 30 + nlen + csize);
    const raw = method === 8 ? inflateRawSync(body) : body;
    expect(raw.toString("utf8")).toBe(text);
    expect(zip.readUInt32LE(14)).toBe(crc32(Buffer.from(text, "utf8")));
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("calendar helpers & risk bands", () => {
  it("builds Sunday-start weeks covering the month", () => {
    const w = monthWeeks("2026-10");
    expect(w[0].days[0]).toBe("2026-09-27");
    expect(w.flatMap((x) => x.days)).toContain("2026-10-31");
    expect(w.every((x) => x.days.length === 7)).toBe(true);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("scores risks impact × likelihood", () => {
    expect(riskBand(3, 3)).toMatchObject({ score: 9, band: "high" });
    expect(riskBand(1, 3)).toMatchObject({ score: 3, band: "medium" });
    expect(riskBand(1, 2).band).toBe("low");
  });
});
