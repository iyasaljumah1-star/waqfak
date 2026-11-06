/**
 * Unified knowledge engine — pure parts: the citation policy, the retrieval units, article detection in a question.
 * No database. Synthetic hits only.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decide, SCHOOL_QUESTION, sufficiency, type Hit, type SourceReview } from "../src/server/knowledge/policy";
import { pageUnits, quoteUnits, statuteUnits } from "../src/server/knowledge/units";
import { loadCatalog, unitsOf } from "../src/server/knowledge/catalog";

const hit = (over: Partial<Hit> = {}): Hit => ({
  chunkId: "c1", refCode: "SYN", refKind: "official_guide", registryId: null, version: "v1", title: "مرجع", locator: "صفحة الملف 1", articleNo: null,
  paragraphNo: null, pageFile: 1, pagePrinted: null, text: "نص", textOrigin: "verified_quote", quality: "good", services: ["C01"], publishedOn: null, effectiveOn: null,
  repealedOn: null, superseded: false, blocked: false, reviewRole: "legal", coverage: 1, score: 1, ...over,
});
const ctx = { service: "C01", asOf: "2026-11-06" };
const rev = (o: Partial<SourceReview> = {}): SourceReview => ({ decision: "accepted", at: "2026-11-06T09:00:00Z", role: "legal", chunkId: null, ...o });
const accepted = [rev()];

describe("citation policy", () => {
  it("a non-registry source is citable only after an accepted review by its field, and never as binding", () => {
    expect(decide(hit(), ctx, {})).toMatchObject({ citable: false, refusal: "not_reviewed" });
    expect(decide(hit(), ctx, { reviews: [rev({ role: "sharia" })] })).toMatchObject({ citable: false, refusal: "not_reviewed" });
    expect(decide(hit(), ctx, { reviews: [rev({ decision: "rejected", at: "2026-11-06T10:00:00Z" }), rev()] })).toMatchObject({ citable: false, refusal: "review_rejected" });
    expect(decide(hit(), ctx, { reviews: accepted })).toMatchObject({ citable: true, binding: false });
    expect(decide(hit({ refKind: "academic_study" }), ctx, { reviews: accepted })).toMatchObject({ citable: true, binding: false, label: expect.stringMatching(/^دراسة أكاديمية/) });
  });
  it("a page from a file's text layer needs a review of that page; OCR is never cited", () => {
    const page = hit({ textOrigin: "text_layer" });
    expect(decide(page, ctx, { reviews: accepted })).toMatchObject({ refusal: "passage_not_reviewed" });
    expect(decide(page, ctx, { reviews: [rev(), rev({ chunkId: "other" })] })).toMatchObject({ refusal: "passage_not_reviewed" });
    expect(decide(page, ctx, { reviews: [rev(), rev({ chunkId: "c1" })] })).toMatchObject({ citable: true });
    expect(decide(hit({ textOrigin: "ocr" }), ctx, { reviews: [rev(), rev({ chunkId: "c1" })] })).toMatchObject({ refusal: "ocr_text" });
  });
  it("a statute or regulation is decided by the reference guard and its text must match the passage", () => {
    const st = hit({ refKind: "regulation", registryId: "NZR", articleNo: 16 });
    const ok = { ok: true as const, display: {} as never };
    expect(decide(st, ctx, { reviews: accepted })).toMatchObject({ citable: false, refusal: "registry_refused" });
    expect(decide(st, ctx, { registry: { ok: false, refusal: "not_reviewed", detail: "لم تُراجع" } })).toMatchObject({ refusal: "registry_refused" });
    expect(decide(st, ctx, { registry: ok, registryTextMatches: false })).toMatchObject({ refusal: "text_mismatch" });
    expect(decide(st, ctx, { registry: ok, registryTextMatches: true })).toMatchObject({ citable: true, binding: true });
    expect(decide(hit({ refKind: "statute" }), ctx, { reviews: accepted })).toMatchObject({ citable: false }); // unregistered statute
  });
  it("service link, relevance, dates, versions, blocked passages and the school rule are refused with their reason", () => {
    expect(decide(hit({ services: ["F02"] }), ctx, { reviews: accepted })).toMatchObject({ refusal: "not_applicable" });
    expect(decide(hit({ services: ["F02"] }), { ...ctx, service: "*" }, { reviews: accepted })).toMatchObject({ citable: true });
    expect(decide(hit({ coverage: 0.3 }), ctx, { reviews: accepted })).toMatchObject({ refusal: "not_relevant" });
    expect(decide(hit({ superseded: true }), ctx, { reviews: accepted })).toMatchObject({ refusal: "out_of_date" });
    expect(decide(hit({ superseded: true }), { ...ctx, historical: true }, { reviews: accepted })).toMatchObject({ citable: true, label: expect.stringMatching(/نسخة سابقة$/) });
    expect(decide(hit({ repealedOn: "2026-08-25" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "out_of_date" });
    expect(decide(hit({ effectiveOn: "2027-01-01" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "not_yet_effective" });
    expect(decide(hit({ quality: "degraded" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "degraded_text" });
    expect(decide(hit({ blocked: true }), ctx, { reviews: accepted })).toMatchObject({ refusal: "blocked_passage" });
    expect(decide(hit({ refKind: "unclassified" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "unclassified" });
    const book = hit({ refKind: "contemporary_book", reviewRole: "sharia" });
    expect(decide(book, { ...ctx, schoolQuestion: true }, { reviews: [rev({ role: "sharia" })] })).toMatchObject({ refusal: "not_school_source" });
    expect(decide(book, ctx, { reviews: [rev({ role: "sharia" })] })).toMatchObject({ citable: true });
    expect(SCHOOL_QUESTION.test("هل يجوز وقف المشاع عند الحنابلة؟")).toBe(true);
  });
  it("insufficiency: nothing citable, no binding basis when needed, no Hanbali book on the school's view, a missing article", () => {
    expect(sufficiency([], { binding: false })).toMatchObject({ sufficient: false, reason: expect.stringContaining("لم يُعثر") });
    const g = { hit: hit(), decision: decide(hit(), ctx, { reviews: accepted }) };
    expect(sufficiency([g], { binding: false })).toEqual({ sufficient: true });
    expect(sufficiency([g], { binding: true })).toMatchObject({ sufficient: false, reason: expect.stringContaining("لا نص نظامي ملزم") });
    expect(sufficiency([g], { binding: false, school: true })).toMatchObject({ sufficient: false, reason: expect.stringContaining("المذهب الحنبلي") });
    expect(sufficiency([g], { binding: false, missingArticle: "المادة 99" })).toMatchObject({ sufficient: false, reason: expect.stringContaining("المادة 99") });
  });
});

describe("retrieval units", () => {
  it("statute units carry the registry's paragraph locators", () => {
    const u = statuteUnits("المادة الأولى: التعريفات\nنص التعريفات.\nالمادة الثانية: الأهداف\n1- الهدف الأول.\n2- الهدف الثاني.\nالمادة الثالثة: النطاق\nتسري على الجميع.");
    expect(u.map((x) => x.locator)).toEqual(["م1", "م2/ف1", "م2/ف2", "م3"]);
    expect(u[2]!.text).toContain("الهدف الثاني");
  });
  it("page units keep the file page and the printed page", () => {
    const u = pageUnits([{ file: 47, printed: "45", method: "text", text: "نص صفحة كاملة عن نظارة الوقف وأحكامها وشروط الناظر ومهامه." }, { file: 48, printed: null, method: "ocr", text: "نص قصير" }]);
    expect(u).toEqual([expect.objectContaining({ locator: "ص 45 (الملف 47)", pageFile: 47, pagePrinted: "45", textOrigin: "text_layer" })]);
  });
  it("verified quotations keep the locator recorded at verification", () => {
    expect(quoteUnits([{ locator: "ج2 ص425", quote: "وَالْوَقْفُ عَقْدٌ لَازِمٌ بِمُجَرَّدِ الْقَوْلِ", verifiedHow: "turath", topic: "لزوم الوقف" }])[0]).toMatchObject({ locator: "ج2 ص425", pagePrinted: "425", textOrigin: "verified_quote" });
  });
  it("the catalog classifies every source and gives each one units (except a quote too short to index)", () => {
    const cat = loadCatalog();
    expect(cat.length).toBe(49);
    for (const e of cat) expect(e.refKind).not.toBe("unclassified");
    const empty = cat.filter((e) => unitsOf(e).units.length === 0).map((e) => e.refCode);
    expect(empty).toEqual(["NCNP-DIRECTORY"]);
    // one edition, one source: quotations read in another Turath edition are their own source (independent review A1/B3)
    expect(cat.filter((e) => e.refCode.startsWith("FQH-KASHSHAF")).map((e) => e.refCode).sort()).toEqual(["FQH-KASHSHAF", "FQH-KASHSHAF-B21642"]);
    expect(cat.find((e) => e.refCode === "SOCPA-NPO-QA")).toMatchObject({ refKind: "professional_standard" });
    expect(cat.find((e) => e.refCode === "BOOK-MAYSAR")).toMatchObject({ blockedPages: ["86", "101", "110", "212", "213"], reviewRole: "sharia" });
    expect(cat.find((e) => e.refCode === "ACC-STUDY")).toMatchObject({ refKind: "academic_study" });
    expect(cat.find((e) => e.refCode === "BOOK-MAYSAR")).toMatchObject({ refKind: "contemporary_book" });
    expect(cat.find((e) => e.refCode === "INVEST-RULES")).toMatchObject({ refKind: "official_guide", services: ["I01", "I03", "I07"] });
    expect(cat.find((e) => e.refCode === "REPORTING-RULES")!.services).toEqual([]);
    expect(cat.find((e) => e.refCode === "GAA-LAW")).toMatchObject({ registryId: "GAA-LAW" });
    expect(unitsOf(cat.find((e) => e.refCode === "GAA-LAW")!).quality).toBe("degraded");
  });
});

describe("isolation of the knowledge engine (replaces nothing: the phase-1 isolation test is kept as it was)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
  const src = files(path.join(process.cwd(), "src"));
  const rel = (f: string) => path.relative(process.cwd(), f).split(path.sep).join("/");
  it("the reference engine is reached only by the knowledge engine (and the schema barrel)", () => {
    const importers = src.filter((f) => !rel(f).startsWith("src/server/references/")).filter((f) => /server\/references|from "\.\.?\/references|\.\/references"/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(importers.filter((f) => !f.startsWith("src/server/knowledge/"))).toEqual(["src/server/db/schema/index.ts"]);
  });
  it("the knowledge engine is reached only by engine-core's processing pipeline: no page, route, action or service module", () => {
    const importers = src.filter((f) => !rel(f).startsWith("src/server/knowledge/")).filter((f) => /server\/knowledge\//.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(importers).toEqual(["src/server/engine/pipeline/run.ts"]);
    expect(src.map(rel).filter((f) => f.startsWith("src/app/") && /server\/(knowledge|references)\//.test(fs.readFileSync(f, "utf8")))).toEqual([]);
  });
  it("engine-core's former direct search is no longer used anywhere", () => {
    expect(src.filter((f) => /knowledge\/search"|searchKb\(|chunkById\(/.test(fs.readFileSync(f, "utf8")) && !rel(f).endsWith("engine/knowledge/search.ts")).map(rel)).toEqual([]);
  });
});
