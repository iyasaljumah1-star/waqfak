/**
 * Regression tests for the issues found in the acceptance run of the waqf establishment journey (REQ-000472, local).
 * Each test names the finding it covers.
 */
import { describe, expect, it } from "vitest";
import { SERVICES } from "@/server/seed/data/services";
import { formFor } from "@/server/modules/requests/intake/forms";
import { validateStep, type Answers } from "@/server/modules/requests/intake/engine";
import { readiness, openMarkers } from "@/server/modules/outputs/pure";
import { draftDeed } from "@/server/modules/outputs/drafting";
import { guardTransition, type GuardInput } from "@/server/modules/requests/workflow";
import { sameValue } from "@/server/modules/requests/insights";
import { clientPhase, processingPhase } from "@/server/modules/requests/phase";
import type { OutputSection } from "@/server/db/schema/operations";

const formOf = (code: string) => {
  const s = SERVICES.find((x) => x.code === code)!;
  return formFor({ code, audiences: s.audiences, requiredDocuments: s.docs ?? [] });
};
const masarifStep = formOf("T03").steps.find((s) => s.key === "masarif")!;
const rows = (r: [string, string, string][]) => JSON.stringify(r.map(([tier, beneficiary, share]) => ({ tier, beneficiary, share, division: "equal" })));
const base: Answers = { alternateMasraf: "الفقراء", selfBenefit: "no" };

describe("ACC-06: shares of one tier may not exceed 100٪ in the intake form", () => {
  it("70٪ + 50٪ in tier 1 is refused with the tier named", () => {
    const e = validateStep(masarifStep, { ...base, masarif: rows([["1", "أولادي", "70"], ["1", "طلاب العلم", "50"]]) });
    expect(e.masarif).toContain("120");
    expect(e.masarif).toContain("«الطبقة (الترتيب)» فيها 1");
  });
  it("60٪ + 40٪ in tier 1, or 70٪ and 50٪ in different tiers, are accepted", () => {
    expect(validateStep(masarifStep, { ...base, masarif: rows([["1", "أولادي", "60"], ["1", "طلاب العلم", "40"]]) }).masarif).toBeUndefined();
    expect(validateStep(masarifStep, { ...base, masarif: rows([["1", "أولادي", "70"], ["2", "طلاب العلم", "50"]]) }).masarif).toBeUndefined();
  });
});

const sec = (blocks: OutputSection["blocks"], audience: OutputSection["audience"] = "client"): OutputSection => ({ key: "deed", title: "نص وثيقة الوقف", required: true, audience, blocks });
const clause = (text: string, generated = "نص مولد") => ({ type: "clause" as const, key: "asset", n: 2, title: "الأصل الموقوف", text, generated, prov: "client" as const });

describe("ACC-01: a document with a «[يُستكمل…]» marker typed by a person is not ready", () => {
  it("an edited clause holding a marker blocks sending and approval", () => {
    const r = readiness([sec([clause("سهم في شركة [يُستكمل: مستند ملكية الأسهم].")])], []);
    expect(r.ready).toBe(false);
    expect(r.unwritten[0].section).toContain("الأصل الموقوف");
  });
  it("a conflict marker blocks too; a clean clause does not", () => {
    expect(readiness([sec([clause("رقم الصك [تعارض يُحسم: رقمان مختلفان].")])], []).ready).toBe(false);
    expect(readiness([sec([clause("عمارة سكنية بصك رقم 310123456789.")])], []).ready).toBe(true);
  });
  it("internal notes that explain the markers do not count", () => {
    expect(openMarkers([sec([{ type: "para", internal: true, text: "ما بين معقوفين [يُستكمل: …] لم يُقدَّم بعد" }])])).toEqual([]);
    expect(openMarkers([sec([clause("[يُستكمل: x]")], "internal")])).toEqual([]);
  });
  it("a marker already raised as a blocking gap of that clause is not listed twice", () => {
    const gap = { key: "board_rules", label: "تشكيل المجلس", severity: "blocking" as const, clause: "asset" };
    expect(openMarkers([sec([clause("[يُستكمل: x]")])], [gap])).toEqual([]);
  });
});

describe("ACC-02: work is not sent to the client, nor the request closed, while tasks are open", () => {
  const g: GuardInput = { from: "quality_review", to: "awaiting_client_approval", actorUserId: "qa", conflictCheck: "passed", workflowCode: "standard", deliverers: ["prep"], submittedDeliverables: 1, unsignedOpinionDeliverables: 0, contractSignedByClient: true, hasContract: true, quoteAmount: 1, pricingModel: "fixed" };
  const task = "مطابقة صك الملكية مع السجل العقاري والتأكد من خلوه من الرهن";
  it("QA approval is refused with the open task named", () => {
    expect(guardTransition({ ...g, openTasks: [task] })).toContain(task);
    expect(guardTransition({ ...g, openTasks: [] })).toBeNull();
  });
  it("closing is refused; the client's approval (→ completed) is not held by staff tasks", () => {
    expect(guardTransition({ ...g, from: "completed", to: "closed", openTasks: [task, "تحديث سجل الأصول"] })).toContain("2 مهام مفتوحة");
    expect(guardTransition({ ...g, from: "awaiting_client_approval", to: "completed", openTasks: [task] })).toBeNull();
  });
});

describe("ACC-03: an approved numeric-looking value is not reported as changed", () => {
  it("jsonb returns «1012345678» as a number: still the same value", () => {
    expect(sameValue(1012345678, "1012345678")).toBe(true);
    expect(sameValue("1012345678", "1012345679")).toBe(false);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(["a", 1], ["a", "1"])).toBe(true);
    // a table answer (JSON text) against the parsed rows the jsonb column returns
    expect(sameValue('[{"tier":"1","share":"60"}]', [{ share: "60", tier: 1 }])).toBe(true);
    expect(sameValue('[{"tier":"1","share":"60"}]', [{ share: "50", tier: 1 }])).toBe(false);
  });
});

describe("ACC-04: the asset clause does not print «….،»", () => {
  it("a description ending with a period is joined cleanly", () => {
    const d = draftDeed({ keys: { waqifName: "واقف", waqifId: "1012345678", waqfKind: "khayri", assetDescription: "عمارة سكنية في الرياض.", ownershipDeedNo: "310123456789", share: "whole", appurtenances: "all", registeredToWaqif: "yes" }, tables: { masarif: [] }, attached: { ownership: 1 }, requesterName: "واقف" });
    const asset = d.clauses.find((c) => c.key === "asset")!;
    expect(asset.text).toContain("عمارة سكنية في الرياض، المملوك");
    expect(asset.text).not.toContain(".،");
  });
});

describe("ACC-05: the client sees the real phase before work starts, and no «(لا إجراء)» after it ends", () => {
  const p = { assigned: true, data: null, openClientItems: 0, outputs: [] };
  it("quote and contract are steps on the client, not «قيد التنفيذ»", () => {
    expect(clientPhase({ ...p, status: "quote" })).toMatchObject({ phase: "quote", owner: "client" });
    expect(clientPhase({ ...p, status: "awaiting_contract" })).toMatchObject({ phase: "contract", owner: "client" });
    expect(processingPhase({ ...p, status: "quote" }).label).not.toContain("قيد التنفيذ");
  });
  it("a completed request waits for the team to close it", () => {
    expect(processingPhase({ ...p, status: "completed" })).toMatchObject({ phase: "completed", owner: "team" });
  });
});
