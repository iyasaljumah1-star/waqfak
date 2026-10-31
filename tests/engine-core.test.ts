import { describe, expect, it } from "vitest";
import { backoffMs, retryable, safeError } from "@/server/engine/queue/pure";
import { dataClassOf, maskFacts, modelAllowed } from "@/server/engine/llm/guard";
import { articleMentions, checkSection, unknownFigures } from "@/server/engine/verify/pure";
import { articleNumber, assessQuality, splitPassages } from "@/server/engine/knowledge/pure";
import { applyPacks, fillTemplate, packsFor, writerFor } from "@/server/engine/rules/evaluate";
import { rulePacks } from "@/server/engine/rules/packs";
import { parseSectionAnswer } from "@/server/engine/llm/prompt";
import { clientPhase, engineClientPhase } from "@/server/modules/requests/phase";
import type { LlmSource } from "@/server/engine/llm/types";

describe("queue policy", () => {
  it("backs off 30s, 2m, 8m, 30m, then 2h", () => {
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([30_000, 120_000, 480_000, 1_800_000, 7_200_000, 7_200_000]);
    expect(backoffMs(0)).toBe(30_000);
  });
  it("keeps no personal data in a job error", () => {
    const s = safeError(new Error("failed for 0551234567 and ali@example.com id 1012345678"));
    expect(s).not.toMatch(/0551234567|ali@example\.com|1012345678/);
    expect(s).toContain("[رقم]");
    expect(s).toContain("[بريد]");
    expect(safeError(new Error("x".repeat(2000))).length).toBeLessThanOrEqual(500);
  });
  it("retries infrastructure errors, not data errors", () => {
    expect(retryable(Object.assign(new Error("db"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(retryable(Object.assign(new Error("x"), { cause: { code: "40P01" } }))).toBe(true);
    expect(retryable(new Error("request timeout"))).toBe(true);
    expect(retryable(new Error("invalid input"))).toBe(false);
  });
});

describe("model guard (synthetic data only until approved)", () => {
  it("treats only a demonstration waqf as synthetic", () => {
    expect(dataClassOf({ hasWaqf: true, waqfIsDemo: true })).toBe("synthetic");
    expect(dataClassOf({ hasWaqf: true, waqfIsDemo: false })).toBe("real");
    expect(dataClassOf({ hasWaqf: false, waqfIsDemo: undefined })).toBe("real");
  });
  it("refuses real data while the flag is off, and any call without a provider", () => {
    expect(modelAllowed({ dataClass: "real", realDataFlag: false, providerId: "openai-compatible" }).ok).toBe(false);
    expect(modelAllowed({ dataClass: "synthetic", realDataFlag: false, providerId: "disabled" }).ok).toBe(false);
    expect(modelAllowed({ dataClass: "synthetic", realDataFlag: false, providerId: "mock" }).ok).toBe(true);
    expect(modelAllowed({ dataClass: "real", realDataFlag: true, providerId: "mock" }).ok).toBe(true);
  });
  it("masks identifiers throughout the facts", () => {
    const m = maskFacts({ a: "جوال 0551234567", b: ["ali@x.sa", "SA0380000000608010167519"], c: { id: "هوية 1012345678" }, n: 5 });
    expect(JSON.stringify(m)).not.toMatch(/0551234567|ali@x\.sa|SA0380000000608010167519|1012345678/);
    expect(m.n).toBe(5);
  });
});

const src = (n: number, text: string, refCode = "NAZARA-REG"): LlmSource => ({ n, chunkId: `c${n}`, refCode, locator: `المادة ${n}`, text });

describe("verification of generated text", () => {
  const sources = [src(1, "المادة الخامسة: على الناظر ..."), src(2, "نص آخر")];
  const arts = new Map<number, number | null>([[1, 5], [2, null]]);
  it("accepts a cited, complete section", () => {
    const r = checkSection({ text: "يلتزم الناظر بالإفصاح وفق المادة الخامسة [1].", citations: [1], sources, sourceArticles: arts, requireCitation: true });
    expect(r.ok).toBe(true);
  });
  it("rejects a section without a source", () => {
    const r = checkSection({ text: "يلتزم الناظر بالإفصاح.", citations: [], sources, sourceArticles: arts, requireCitation: true });
    expect(r.ok).toBe(false);
  });
  it("rejects a citation it was not given", () => {
    expect(checkSection({ text: "كذا [7].", citations: [7], sources, sourceArticles: arts, requireCitation: true }).ok).toBe(false);
  });
  it("rejects an article the cited passages do not contain", () => {
    const r = checkSection({ text: "وفق المادة العاشرة [1].", citations: [1], sources, sourceArticles: arts, requireCitation: true });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("المادة العاشرة");
  });
  it("rejects placeholders and empty text", () => {
    expect(checkSection({ text: "[يُستكمل لاحقًا] [1]", citations: [1], sources, sourceArticles: arts, requireCitation: true }).ok).toBe(false);
    expect(checkSection({ text: "  ", citations: [], sources, sourceArticles: arts, requireCitation: false }).ok).toBe(false);
  });
  it("finds article mentions and unknown figures", () => {
    expect(articleMentions("انظر المادة (12) و م 7").map((a) => a.no)).toEqual([12, 7]);
    expect(unknownFigures("المبلغ 150,000 في 2026-01-05", ["150000"])).toEqual(["2026-01-05"]);
  });
});

describe("knowledge base", () => {
  it("grades scanned, degraded and good text", () => {
    expect(assessQuality("نص قصير").quality).toBe("unreadable");
    const good = "المادة الأولى: على الناظر أن يحفظ الأصل إلى أن يقرر المجلس. ".repeat(60);
    expect(assessQuality(good).quality).toBe("good");
    const bad = "املادة األوىل: عىل الناظر أن يحفظ الأصل إىل أن يقرر املجلس. ".repeat(60);
    expect(assessQuality(bad).quality).toBe("degraded");
  });
  it("reads article numbers, including the known degraded form", () => {
    expect(articleNumber("المادة الخامسة والعشرون بعد المائة")).toBe(125);
    expect(articleNumber("المادة (12)")).toBe(12);
    expect(articleNumber("املادة الثالثة")).toBe(3);
    expect(articleNumber("مقدمة")).toBeNull();
  });
  it("splits by articles and keeps the text verbatim", () => {
    const body = (n: string) => `نص المادة ${n} كما ورد في المرجع دون تعديل.`;
    const text = ["تمهيد النظام وأحكامه العامة كما وردت.", "المادة الأولى:", body("الأولى"), "المادة الثانية:", body("الثانية"), "المادة الثالثة:", body("الثالثة")].join("\n");
    const p = splitPassages(text);
    expect(p.map((x) => x.articleNo).filter(Boolean)).toEqual([1, 2, 3]);
    expect(p.find((x) => x.articleNo === 2)!.text).toContain(body("الثانية"));
    expect(p[0].locator).toBe("التمهيد");
  });
  it("leaves a table of contents in the preamble", () => {
    const body = (n: string) => `نص المادة ${n} كما ورد في المرجع دون تعديل.`;
    const toc = ["جدول المحتويات", "المادة الأولى: التعريفات", "المادة الثانية: الأهداف", "المادة الثالثة: النطاق"];
    const text = [...toc, "تمهيد طويل بما يكفي ليكون مقطعًا.", "المادة الأولى: التعريفات", body("الأولى"), "المادة الثانية: الأهداف", body("الثانية"), "المادة الثالثة: النطاق", body("الثالثة")].join("\n");
    const p = splitPassages(text);
    expect(p.filter((x) => x.articleNo === 1)).toHaveLength(1);
    expect(p.find((x) => x.articleNo === 1)!.text).toContain(body("الأولى"));
    expect(p[0].locator).toBe("التمهيد");
    expect(p[0].text).toContain("جدول المحتويات");
  });
});

describe("rules engine (versioned packs)", () => {
  const base = { intake: { missingFields: 0, missingDocs: 0 }, request: { conflict: "clear" }, conflicts: { material: 0 }, gaps: { clientBlocking: 0 }, docs: { unreadable: 0 }, kb: { missingEssentialCount: 0 } };
  const packs = packsFor(rulePacks(), "C01");
  it("every pack carries an id and a version", () => {
    for (const p of rulePacks()) { expect(p.id).toBeTruthy(); expect(p.version).toMatch(/^\d+\.\d+\.\d+$/); }
  });
  it("finds nothing on a complete request", () => {
    expect(applyPacks(packs, base).findings.filter((f) => f.effect !== "warn")).toEqual([]);
  });
  it("asks the client for missing data and blocks on a missing essential reference", () => {
    const r1 = applyPacks(packs, { ...base, intake: { missingFields: 2, missingDocs: 0 } });
    expect(r1.findings.some((f) => f.effect === "client")).toBe(true);
    const r2 = applyPacks(packs, { ...base, kb: { missingEssentialCount: 1 } });
    expect(r2.findings.some((f) => f.ruleId === "essential_refs" && f.effect === "block")).toBe(true);
  });
  it("records which packs were applied", () => {
    expect(applyPacks(packs, base).applied[0]).toMatchObject({ id: "core.common", version: "1.0.0" });
  });
  it("picks a section writer and fills templates without inventing values", () => {
    expect(writerFor(packs, "analysis:x")).toMatchObject({ mode: "model", requireCitation: true });
    const t = fillTemplate("الخدمة {service.code} والقرار {decision:k} والناقص {waqf.name}", { service: { code: "C01" } }, [{ key: "k", title: "", value: "نعم", basis: "", pack: "p" }]);
    expect(t.text).toContain("C01");
    expect(t.text).toContain("نعم");
    expect(t.missing).toEqual(["waqf.name"]);
  });
});

describe("model answers", () => {
  it("parses the JSON answer and strips markup", () => {
    expect(parseSectionAnswer('x {"text":"<b>نص</b> [1]","citations":[1],"rationale":"r"} y')).toEqual({ text: "نص [1]", citations: [1], rationale: "r" });
    expect(parseSectionAnswer("بلا JSON")).toBeNull();
    expect(parseSectionAnswer('{"text":""}')).toBeNull();
  });
});

describe("client phase of an engine request", () => {
  it("never tells the client the output is available before approval", () => {
    for (const s of ["submitted", "triage", "in_progress", "quality_review"]) expect(engineClientPhase(s)!.next).not.toMatch(/متاحة لك في هذه الصفحة/);
    expect(engineClientPhase("awaiting_client")!.owner).toBe("client");
    expect(engineClientPhase("completed")!.label).toBe("معتمد");
  });
  it("is used only for engine requests", () => {
    const p = { status: "quality_review", assigned: true, data: null, openClientItems: 0 } as unknown as Parameters<typeof clientPhase>[0];
    expect(clientPhase({ ...p, engine: true }).label).toBe("قيد المراجعة والاعتماد النهائي");
    expect(clientPhase({ ...p, engine: false }).label).not.toBe("قيد المراجعة والاعتماد النهائي");
  });
});

describe("intake submit wording", () => {
  it("names what the client asks for", async () => {
    const { submitLabel } = await import("@/lib/submit-label");
    expect(submitLabel("C01")).toBe("طلب النتيجة");
    expect(submitLabel("T03")).toBe("إرسال للاعتماد");
    expect(submitLabel("N01")).toBe("إرسال الطلب");
  });
});
