import { describe, expect, it } from "vitest";
import { buildQuote, recurringTerms, splitInstallments, termWhen } from "@/server/modules/commerce/pure";
import { dueAlerts, dueAlertSettings, initialDueOn, installmentStage, type InstallmentInvoice } from "@/server/modules/billing/schedule-pure";

const cfg = dueAlertSettings({ beforeDays: 7, overdueDays: [1, 7, 30] });
const inv = (p: Partial<InstallmentInvoice>): InstallmentInvoice => ({ id: "i", number: "INV-1", status: "issued", kind: "tax_invoice", total: 115, paid: 0, createdAt: "2026-10-01", approvedAt: "2026-10-01", sentAt: "2026-10-01", paidOn: null, ...p });

describe("dated installments in the quote", () => {
  const base = { lines: [{ description: "خدمة", qty: 1, unit: 1000 }], discount: 0, vatRate: 15, validUntil: "2026-11-01", today: "2026-10-15" };
  it("accepts set dates, milestones and the usual triggers, and checks each", () => {
    const ok = buildQuote({ ...base, terms: [
      { label: "عند التوقيع", percent: 30, due: "on_contract", beforeStart: true },
      { label: "الدفعة الثانية", percent: 30, due: "on_date", beforeStart: false, dueOn: "2026-12-01" },
      { label: "عند اعتماد الخطة", percent: 40, due: "on_milestone", beforeStart: false, milestone: "اعتماد خطة العمل" },
    ] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.terms[1]).toMatchObject({ due: "on_date", dueOn: "2026-12-01" });
      expect(termWhen(ok.terms[2])).toBe("عند اعتماد خطة العمل");
      const parts = splitInstallments(ok.net, 15, ok.terms);
      expect(parts.reduce((s, p) => s + p.total, 0)).toBeCloseTo(ok.total, 2);
    }
    const bad = buildQuote({ ...base, terms: [{ label: "بلا تاريخ", percent: 50, due: "on_date", beforeStart: false }, { label: "مرحلة", percent: 50, due: "on_milestone", beforeStart: false, milestone: "" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/تاريخ استحقاقها.*سمِّ المرحلة/);
    const past = buildQuote({ ...base, terms: [{ label: "ماضية", percent: 100, due: "on_date", beforeStart: false, dueOn: "2026-01-01" }] });
    expect(past.ok).toBe(false);
  });
  it("a recurring plan becomes dated installments that add up exactly", () => {
    const q = recurringTerms({ count: 3, every: "monthly", firstOn: "2026-11-30", percent: 100, label: "اشتراك" });
    expect(q.map((t) => t.dueOn)).toEqual(["2026-11-30", "2026-12-30", "2027-01-30"]);
    expect(q.reduce((s, t) => s + t.percent, 0)).toBeCloseTo(100, 2);
    expect(recurringTerms({ count: 4, every: "quarterly", firstOn: "2026-01-31", percent: 60, label: "ربعية" }).map((t) => t.dueOn)).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
    expect(recurringTerms({ count: 0, every: "annual", firstOn: "2026-01-01", percent: 10, label: "x" })).toEqual([]);
  });
});

describe("installment stages and finance alerts", () => {
  const row = { dueOn: "2026-10-20", total: 115 };
  it("dates are separate: an invoice sent is not payment; only payment pays", () => {
    expect(installmentStage(row, [], "2026-10-01", cfg)).toBe("upcoming");
    expect(installmentStage(row, [], "2026-10-15", cfg)).toBe("due_soon");
    expect(installmentStage(row, [], "2026-10-20", cfg)).toBe("due");
    expect(installmentStage(row, [inv({ status: "draft", sentAt: null })], "2026-10-20", cfg)).toBe("due"); // a draft is not sent
    expect(installmentStage(row, [inv({})], "2026-10-20", cfg)).toBe("invoiced");
    expect(installmentStage(row, [inv({})], "2026-10-25", cfg)).toBe("overdue");
    expect(installmentStage(row, [inv({ status: "paid", paid: 115, paidOn: "2026-10-22" })], "2026-10-25", cfg)).toBe("paid");
    expect(installmentStage({ dueOn: null, total: 115 }, [], "2026-10-25", cfg)).toBe("unscheduled");
  });
  it("each alert is owed once: before, on the day, and at each overdue step", () => {
    expect(dueAlerts(row, "due_soon", "2026-10-15", cfg, []).map((a) => a.key)).toEqual(["before"]);
    expect(dueAlerts(row, "due_soon", "2026-10-15", cfg, ["before"])).toEqual([]);
    expect(dueAlerts(row, "due", "2026-10-20", cfg, ["before"]).map((a) => a.key)).toEqual(["due"]);
    expect(dueAlerts(row, "overdue", "2026-10-28", cfg, ["before", "due"]).map((a) => a.key)).toEqual(["overdue:7"]);
    expect(dueAlerts(row, "paid", "2026-10-28", cfg, [])).toEqual([]);
  });
  it("settings fall back to defaults; due dates come from the contract", () => {
    expect(dueAlertSettings({ beforeDays: -3, overdueDays: ["x"] })).toEqual({ beforeDays: 7, overdueDays: [1, 7, 30] });
    expect(initialDueOn({ due: "on_date", dueOn: "2026-12-01" }, "2026-10-01")).toBe("2026-12-01");
    expect(initialDueOn({ due: "on_contract" }, "2026-10-01")).toBe("2026-10-01");
    expect(initialDueOn({ due: "on_milestone" }, "2026-10-01")).toBeNull();
  });
});
