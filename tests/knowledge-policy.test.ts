/**
 * Unified knowledge engine — pure parts: the citation policy, the retrieval units, article detection in a question.
 * No database. Synthetic hits only.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decide, sufficiency, type Hit } from "../src/server/knowledge/policy";
import { pageUnits, quoteUnits, statuteUnits } from "../src/server/knowledge/units";
import { loadCatalog, unitsOf } from "../src/server/knowledge/catalog";

const hit = (over: Partial<Hit> = {}): Hit => ({
  chunkId: "c1", refCode: "SYN", refKind: "official_guide", registryId: null, version: "v1", title: "مرجع", locator: "صفحة الملف 1", articleNo: null,
  paragraphNo: null, pageFile: 1, pagePrinted: null, text: "نص", quality: "good", services: ["C01"], publishedOn: null, effectiveOn: null, repealedOn: null,
  superseded: false, score: 1, ...over,
});
const ctx = { service: "C01", asOf: "2026-11-06" };
const accepted = [{ decision: "accepted" as const, at: "2026-11-06T09:00:00Z" }];

describe("citation policy", () => {
  it("a non-registry source is citable only after an accepted review, and never as binding", () => {
    expect(decide(hit(), ctx, {})).toMatchObject({ citable: false, refusal: "not_reviewed" });
    expect(decide(hit(), ctx, { reviews: [{ decision: "rejected", at: "2026-11-06T10:00:00Z" }, ...accepted] })).toMatchObject({ citable: false, refusal: "review_rejected" });
    expect(decide(hit(), ctx, { reviews: accepted })).toMatchObject({ citable: true, binding: false });
    expect(decide(hit({ refKind: "academic_study" }), ctx, { reviews: accepted })).toMatchObject({ citable: true, binding: false, label: expect.stringMatching(/^دراسة أكاديمية/) });
  });
  it("a statute or regulation is decided by the reference guard only — a source review does not replace it", () => {
    const st = hit({ refKind: "regulation", registryId: "NZR", articleNo: 16 });
    expect(decide(st, ctx, { reviews: accepted })).toMatchObject({ citable: false, refusal: "registry_refused" });
    expect(decide(st, ctx, { registry: { ok: false, refusal: "not_reviewed", detail: "لم تُراجع" } })).toMatchObject({ citable: false, refusal: "registry_refused" });
    expect(decide(hit({ refKind: "statute" }), ctx, { reviews: accepted })).toMatchObject({ citable: false }); // unregistered statute
  });
  it("service link, dates, superseded versions and degraded text are refused with their reason", () => {
    expect(decide(hit({ services: ["F02"] }), ctx, { reviews: accepted })).toMatchObject({ refusal: "not_applicable" });
    expect(decide(hit({ superseded: true }), ctx, { reviews: accepted })).toMatchObject({ refusal: "out_of_date" });
    expect(decide(hit({ superseded: true }), { ...ctx, historical: true }, { reviews: accepted })).toMatchObject({ citable: true });
    expect(decide(hit({ repealedOn: "2026-08-25" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "out_of_date" });
    expect(decide(hit({ effectiveOn: "2027-01-01" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "not_yet_effective" });
    expect(decide(hit({ quality: "degraded" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "degraded_text" });
    expect(decide(hit({ refKind: "unclassified" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "unclassified" });
  });
  it("insufficiency is stated when nothing is citable, or when a binding basis is needed and only guidance is citable", () => {
    expect(sufficiency([], { binding: false })).toMatchObject({ sufficient: false, reason: expect.stringContaining("لم يُعثر") });
    const g = { hit: hit(), decision: decide(hit(), ctx, { reviews: accepted }) };
    expect(sufficiency([g], { binding: false })).toEqual({ sufficient: true });
    expect(sufficiency([g], { binding: true })).toMatchObject({ sufficient: false, reason: expect.stringContaining("لا نص نظامي ملزم") });
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
    expect(cat.length).toBe(48);
    for (const e of cat) expect(e.refKind).not.toBe("unclassified");
    const empty = cat.filter((e) => unitsOf(e).units.length === 0).map((e) => e.refCode);
    expect(empty).toEqual(["NCNP-DIRECTORY"]);
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
    expect(src.filter((f) => /engine\/knowledge\/search"|searchKb\(/.test(fs.readFileSync(f, "utf8")) && !rel(f).endsWith("engine/knowledge/search.ts")).map(rel)).toEqual([]);
  });
});
