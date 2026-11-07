/**
 * Unified knowledge engine — pure parts: the citation policy, the retrieval units, article detection in a question.
 * No database. Synthetic hits only.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { decide, draftSufficiency, draftUse, passageStatus, SCHOOL_QUESTION, sufficiency, type Hit, type SourceReview } from "../src/server/knowledge/policy";
import { pageUnits, quoteUnits, statuteUnits } from "../src/server/knowledge/units";
import { loadCatalog, unitsOf } from "../src/server/knowledge/catalog";

const hit = (over: Partial<Hit> = {}): Hit => ({
  chunkId: "c1", refCode: "SYN", refKind: "official_guide", registryId: null, version: "v1", title: "مرجع", locator: "صفحة الملف 1", articleNo: null,
  paragraphNo: null, pageFile: 1, pagePrinted: null, text: "نص", textOrigin: "verified_quote", quality: "good", services: ["C01"], publishedOn: null, effectiveOn: null,
  repealedOn: null, superseded: false, blocked: false, reviewRole: "legal", coverage: 1, score: 1, ...over,
});
const ctx = { service: "C01", asOf: "2026-11-06" };
const rev = (o: Partial<SourceReview> = {}): SourceReview => ({ decision: "accepted", at: "2026-11-06T09:00:00Z", role: "legal", chunkId: null, ...o });
/** B13: the passage used ("c1") reviewed and accepted (with the source as a whole). */
const accepted = [rev(), rev({ chunkId: "c1" })];

describe("citation policy", () => {
  it("a non-registry passage is citable (final) only after an accepted review OF THAT PASSAGE by its field, and never as binding (B13)", () => {
    expect(decide(hit(), ctx, {})).toMatchObject({ citable: false, refusal: "passage_not_reviewed" });
    // the source accepted as a whole approves no passage; another passage's acceptance approves not this one
    expect(decide(hit(), ctx, { reviews: [rev()] })).toMatchObject({ citable: false, refusal: "passage_not_reviewed" });
    expect(decide(hit(), ctx, { reviews: [rev(), rev({ chunkId: "c2" })] })).toMatchObject({ citable: false, refusal: "passage_not_reviewed" });
    expect(decide(hit(), ctx, { reviews: [rev({ role: "sharia", chunkId: "c1" })] })).toMatchObject({ citable: false, refusal: "passage_not_reviewed" });
    // the latest review of the passage decides; a later rejection of the source as a whole withdraws it
    expect(decide(hit(), ctx, { reviews: [rev({ chunkId: "c1", decision: "rejected", at: "2026-11-06T10:00:00Z" }), rev({ chunkId: "c1" })] })).toMatchObject({ citable: false, refusal: "review_rejected" });
    expect(decide(hit(), ctx, { reviews: [rev({ chunkId: "c1" }), rev({ decision: "rejected", at: "2026-11-06T10:00:00Z" })] })).toMatchObject({ citable: false, refusal: "review_rejected" });
    expect(passageStatus({ chunkId: "c1", reviewRole: "legal" }, [])).toBe("unreviewed");
    expect(passageStatus({ chunkId: "c2", reviewRole: "legal" }, accepted)).toBe("unreviewed");
    expect(decide(hit(), ctx, { reviews: accepted })).toMatchObject({ citable: true, binding: false });
    expect(decide(hit({ refKind: "academic_study" }), ctx, { reviews: accepted })).toMatchObject({ citable: true, binding: false, label: expect.stringMatching(/^دراسة أكاديمية/) });
  });
  it("a page from a file's text layer needs a review of that page; OCR is never cited", () => {
    const page = hit({ textOrigin: "text_layer" });
    expect(decide(page, ctx, { reviews: [rev()] })).toMatchObject({ refusal: "passage_not_reviewed" });
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
    // the guard's text (provenance «guard») is the only text a registry citation may carry (rule 10)
    expect(decide(st, ctx, { registry: ok, registryTextMatches: true })).toMatchObject({ refusal: "text_mismatch" });
    expect(decide({ ...st, provenance: "guard" }, ctx, { registry: ok, registryTextMatches: true })).toMatchObject({ citable: true, binding: true });
    expect(decide(hit({ refKind: "statute" }), ctx, { reviews: accepted })).toMatchObject({ citable: false }); // unregistered statute
  });
  it("service link, relevance, dates, versions, blocked passages and the school rule are refused with their reason", () => {
    expect(decide(hit({ services: ["F02"] }), ctx, { reviews: accepted })).toMatchObject({ refusal: "not_applicable" });
    expect(decide(hit({ services: ["F02"] }), { ...ctx, service: "*" }, { reviews: accepted })).toMatchObject({ citable: true });
    expect(decide(hit({ coverage: 0.3 }), ctx, { reviews: accepted })).toMatchObject({ refusal: "not_relevant" });
    expect(decide(hit({ superseded: true }), ctx, { reviews: accepted })).toMatchObject({ refusal: "out_of_date" });
    // historical: the version in force on the date, by its own dates; unknown dates are refused (review B10/P9)
    const hctx = { ...ctx, asOf: "2023-06-01", historical: true };
    expect(decide(hit({ superseded: true, validity: "in_force", validFrom: "2020-01-01", validTo: "2025-01-01" }), hctx, { reviews: accepted })).toMatchObject({ citable: true, label: expect.stringMatching(/نسخة سابقة، سارية من 2020-01-01 إلى 2025-01-01$/) });
    expect(decide(hit({ superseded: true }), hctx, { reviews: accepted })).toMatchObject({ refusal: "unknown_validity" });
    expect(decide(hit({ validity: "unknown" }), hctx, { reviews: accepted })).toMatchObject({ refusal: "unknown_validity" });
    expect(decide(hit({ validity: "earlier", validFrom: "2015-01-01", validTo: "2020-01-01" }), hctx, { reviews: accepted })).toMatchObject({ refusal: "out_of_date" });
    expect(decide(hit({ validity: "later", validFrom: "2025-01-01" }), hctx, { reviews: accepted })).toMatchObject({ refusal: "not_yet_effective" });
    expect(decide(hit({ repealedOn: "2026-08-25" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "out_of_date" });
    expect(decide(hit({ effectiveOn: "2027-01-01" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "not_yet_effective" });
    expect(decide(hit({ quality: "degraded" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "degraded_text" });
    expect(decide(hit({ blocked: true }), ctx, { reviews: accepted })).toMatchObject({ refusal: "blocked_passage" });
    expect(decide(hit({ refKind: "unclassified" }), ctx, { reviews: accepted })).toMatchObject({ refusal: "unclassified" });
    const book = hit({ refKind: "contemporary_book", reviewRole: "sharia" });
    const sh = [rev({ role: "sharia" }), rev({ role: "sharia", chunkId: "c1" })];
    expect(decide(book, { ...ctx, schoolQuestion: true }, { reviews: sh })).toMatchObject({ refusal: "not_school_source" });
    expect(decide(book, ctx, { reviews: sh })).toMatchObject({ citable: true });
    expect(SCHOOL_QUESTION.test("هل يجوز وقف المشاع عند الحنابلة؟")).toBe(true);
  });
  it("insufficiency: nothing citable, no binding basis when needed, no Hanbali book on the school's view, a missing article", () => {
    expect(sufficiency([], { binding: false })).toMatchObject({ sufficient: false, reason: expect.stringContaining("لم يُعثر") });
    const g = { hit: hit(), decision: decide(hit(), ctx, { reviews: accepted }) };
    expect(sufficiency([g], { binding: false })).toEqual({ sufficient: true });
    expect(sufficiency([g], { binding: true })).toMatchObject({ sufficient: false, reason: expect.stringContaining("لا نص نظامي ملزم") });
    expect(sufficiency([g], { binding: false, school: true })).toMatchObject({ sufficient: false, reason: expect.stringContaining("المذهب الحنبلي") });
    expect(sufficiency([g], { binding: false, missingArticle: "المادة 99" })).toMatchObject({ sufficient: false, reason: expect.stringContaining("المادة 99") });
    // owner's order 2026-11-07 (§4): a contemporary book may stand alone — once its passage is reviewed for a final
    // document; never as the school's view
    const b = hit({ refKind: "contemporary_book", reviewRole: "sharia" });
    const gb = { hit: b, decision: decide(b, ctx, { reviews: [rev({ role: "sharia", chunkId: "c1" })] }) };
    expect(sufficiency([gb], { binding: false })).toEqual({ sufficient: true });
    expect(sufficiency([gb], { binding: false, school: true })).toMatchObject({ sufficient: false, reason: expect.stringContaining("المذهب الحنبلي") });
    expect(sufficiency([gb, g], { binding: false })).toEqual({ sufficient: true });
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
    expect(cat.find((e) => e.refCode === "BOOK-MAYSAR")).toMatchObject({ blockedPages: ["86", "101", "110", "194", "200", "212", "213", "231", "232"], reviewRole: "sharia" });
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
    // engine-core's pipeline, the public assistant's regulatory route (through the policy), the admin review page and
    // action (recording reviews), and the retired legacy loader's refusal check (catalog lookup only)
    expect(importers.sort()).toEqual(["src/app/admin/knowledge/page.tsx", "src/server/engine/knowledge/ingest.ts", "src/server/engine/pipeline/run.ts", "src/server/modules/admin/knowledge/actions.ts", "src/server/modules/ai/regulatory.ts"]);
    // no page reaches retrieval: the only page is the admin review page, which reads the review queue
    const pages = src.map(rel).filter((f) => f.startsWith("src/app/") && /server\/(knowledge|references)\//.test(fs.readFileSync(f, "utf8")));
    expect(pages).toEqual(["src/app/admin/knowledge/page.tsx"]);
    expect(fs.readFileSync("src/app/admin/knowledge/page.tsx", "utf8")).not.toMatch(/retrieve|readyRefCodes/);
    // the assistant reaches the knowledge base only through retrieve() (the policy), never the tables
    expect(fs.readFileSync("src/server/modules/ai/regulatory.ts", "utf8")).toMatch(/from "@\/server\/knowledge\/retrieve"/);
    expect(src.filter((f) => /\bkbChunks\b|\bkbSources\b/.test(fs.readFileSync(f, "utf8"))).map(rel).filter((f) => !f.startsWith("src/server/knowledge/") && f !== "src/server/db/schema/engine.ts" && !f.startsWith("src/server/engine/knowledge/"))).toEqual([]);
  });
  it("engine-core's former direct search is no longer used anywhere", () => {
    expect(src.filter((f) => /knowledge\/search"|searchKb\(|chunkById\(/.test(fs.readFileSync(f, "utf8")) && !rel(f).endsWith("engine/knowledge/search.ts")).map(rel)).toEqual([]);
  });
});

describe("article numbers written as ordinals (review B6/N4)", () => {
  it("reads compound ordinals, also in the letter-swapped extraction", async () => {
    const { ordinalHeadingValue } = await import("../src/server/knowledge/ordinals");
    expect(ordinalHeadingValue("املادة احلادية والعرشون بعد السبعامئة:")).toBe(721);
    expect(ordinalHeadingValue("املادة الثامنة عرشة بعد السبعامئة:")).toBe(718);
    expect(ordinalHeadingValue("المادة الحادية والثمانون بعد المائتين: نفاذ النظام")).toBe(281);
    expect(ordinalHeadingValue("املادة العارشة:")).toBe(10);
    expect(ordinalHeadingValue("املادة األوىل: ن)720(")).toBe(1);
    expect(ordinalHeadingValue("املادة الدعوى مدة التقادم")).toBeNull();
  });
  it("gives a number only where the heading and the sequence agree; a restarting numbering gives none", async () => {
    const { splitOrdinalStatute } = await import("../src/server/knowledge/ordinals");
    const art = (h: string) => `${h}\nنص المادة بما يكفي لتكون مقطعًا مستقلًا في قاعدة المعرفة.`;
    const one = splitOrdinalStatute([art("المادة الأولى:"), art("المادة الثانية:"), art("المادة الثالثة:"), art("المادة الخامسة:"), art("المادة الخامسة:"), art("المادة السادسة:")].join("\n"), { minProvedShare: 0.3 });
    // 3 is followed by a duplicated 5, and 6 follows it: neither proved; a number read twice proves nothing
    expect(one.passages.filter((p) => p.articleNo !== null).map((p) => p.articleNo)).toEqual([1, 2]);
    const two = splitOrdinalStatute([art("المادة الأولى:"), art("المادة الثانية:"), art("المادة الثالثة:"), art("المادة الأولى:"), art("المادة الثانية:")].join("\n"));
    expect(two.report.trusted).toBe(false);
    expect(two.passages.every((p) => p.articleNo === null)).toBe(true);
  });
  it("the Civil Transactions Law is numbered 1–721 from its own headings; the Companies Law file (several instruments) is not", async () => {
    const civil = unitsOf(loadCatalog().find((e) => e.refCode === "CIVIL-TX")!);
    const nums = civil.units.filter((u) => u.articleNo !== null && !u.locator.endsWith("(تابع)")).map((u) => u.articleNo!);
    expect(nums.length).toBeGreaterThan(700);
    expect(nums.every((n, i) => i === 0 || n > nums[i - 1]!)).toBe(true);
    expect(civil.units.find((u) => u.articleNo === 8)!.text).toMatch(/^املادة الثامنة:/);
    expect(unitsOf(loadCatalog().find((e) => e.refCode === "COMPANIES")!).units.filter((u) => u.articleNo !== null)).toEqual([]);
  });
});

describe("the pipeline's retrieval question (knowledge/question.ts)", () => {
  it("is the request's matter, masked, when there is one; else the service, section and instruction", async () => {
    const { matterOf, sectionQuestion } = await import("../src/server/knowledge/question");
    const mask = (s: string) => s.replace(/05\d{8}/g, "[هاتف]");
    const m = matterOf({ details: "هل للناظر أن يستدين على الوقف؟ جوالي 0501234567", intake: { note: "لمصلحة عمارة العقار الموقوف", n: 3 } }, mask);
    expect(m).toContain("[هاتف]");
    expect(m).not.toContain("0501234567");
    expect(sectionQuestion({ serviceName: "استشارة شرعية", sectionTitle: "التحليل", instruction: "اكتب التحليل", matter: m })).toContain("يستدين");
    expect(sectionQuestion({ serviceName: "استشارة شرعية", sectionTitle: "التحليل", instruction: "اكتب التحليل", matter: "" })).toBe("استشارة شرعية التحليل اكتب التحليل");
  });
});

describe("the public assistant and regulatory questions (review B11)", () => {
  it("asks the knowledge engine's policy for every general question, and no model composes an answer from the library (A1)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const { isRegulatoryQuestion } = await import("../src/server/modules/ai/regulatory");
    for (const q of ["ما نص المادة 16 من لائحة تنظيم أعمال النظارة؟", "هل يجوز استبدال الوقف؟", "ما الغرامة على تأخر تسجيل الوقف؟", "ما رأي الحنابلة في وقف المشاع؟"]) expect(isRegulatoryQuestion(q), q).toBe(true);
    const engine = fs.readFileSync("src/server/modules/ai/engine.ts", "utf8");
    const body = engine.slice(engine.indexOf("async function knowledgeAnswer"), engine.indexOf("const HELP_BLOCKS"));
    // the policy is asked first and unconditionally; the library is labelled explanatory; no external composition
    expect(body.indexOf("await regulatoryBasis(question)")).toBeGreaterThan(0);
    expect(body.indexOf("await regulatoryBasis(question)")).toBeLessThan(body.indexOf("isRegulatoryQuestion(question)"));
    expect(body).toContain("وليست سندًا نظاميًا أو شرعيًا");
    expect(engine).not.toMatch(/externalAnswer\(/);
    expect(fs.readFileSync("src/server/modules/ai/corpus.ts", "utf8")).not.toContain('"مرجع نظامي"');
  });

  it("draft tier: an unreviewed passage serves a draft with its flags; a rejected, irrelevant, blocked or inapplicable one does not (owner's order 2026-11-07, §4–§5)", () => {
    const d = draftUse(hit(), ctx, {});
    expect(d).toMatchObject({ usable: true, status: "unreviewed", flags: ["unreviewed"] });
    expect(draftUse(hit(), ctx, { reviews: accepted })).toMatchObject({ usable: true, status: "approved", flags: [] });
    expect(draftUse(hit(), ctx, { reviews: [rev({ chunkId: "c1", decision: "rejected" })] })).toMatchObject({ usable: false, refusal: "review_rejected" });
    expect(draftUse(hit({ coverage: 0.2 }), ctx, {})).toMatchObject({ usable: false, refusal: "not_relevant" });
    expect(draftUse(hit({ blocked: true }), ctx, {})).toMatchObject({ usable: false, refusal: "blocked_passage" });
    expect(draftUse(hit({ services: ["F02"] }), ctx, {})).toMatchObject({ usable: false, refusal: "not_applicable" });
    // OCR and degraded text: usable in a draft, flagged — never a verified quotation
    expect(draftUse(hit({ textOrigin: "ocr" }), ctx, {})).toMatchObject({ usable: true, flags: expect.arrayContaining(["ocr", "unreviewed"]) });
    expect(draftUse(hit({ quality: "degraded" }), ctx, {})).toMatchObject({ usable: true, flags: expect.arrayContaining(["degraded"]) });
    // «الميسّر» alone, unreviewed: a draft may rest on it; to a school question it is never attributed
    const book = hit({ refKind: "contemporary_book", reviewRole: "sharia" });
    expect(draftUse(book, ctx, {})).toMatchObject({ usable: true, flags: expect.arrayContaining(["unreviewed", "contemporary"]) });
    expect(draftUse(book, { ...ctx, schoolQuestion: true }, {})).toMatchObject({ usable: true, flags: expect.arrayContaining(["not_school_attribution"]) });
    expect(draftSufficiency([{ hit: book, draft: draftUse(book, ctx, {}) }], { binding: false })).toEqual({ sufficient: true });
    // a registry instrument: only from its stored official text, flagged until its comparison is accepted
    const st = hit({ refKind: "regulation", registryId: "NZR", articleNo: 16 });
    expect(draftUse(st, ctx, { registry: { ok: false, refusal: "not_reviewed", detail: "x" } })).toMatchObject({ usable: false });
    expect(draftUse({ ...st, provenance: "stored_official" }, ctx, { registry: { ok: false, refusal: "not_reviewed", detail: "x" }, registryDraftText: true })).toMatchObject({ usable: true, flags: expect.arrayContaining(["registry_unconfirmed"]) });
    expect(draftSufficiency([{ hit: book, draft: draftUse(book, ctx, {}) }], { binding: true })).toMatchObject({ sufficient: false });
  });
});
