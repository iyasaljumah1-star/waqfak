/**
 * Reference engine, phase 1: retrieval, verification, versions and citation guard. Pure tests (no database, no
 * network). Official texts come from the verified snapshots in data/references; every other text is synthetic.
 * Numbers in describe() titles map to the acceptance criteria of the phase-1 order.
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, cpSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeChars, parseOrdinal, tokenize, cardinalValue } from "../src/server/references/arabic";
import { cite } from "../src/server/references/citation";
import { compareTexts } from "../src/server/references/compare";
import { gregorianToHijri, hijriToGregorian } from "../src/server/references/dates";
import { fetchOfficial, isOfficialUrl } from "../src/server/references/fetcher";
import { getEntry, REGISTRY, statusAt, validateRegistry, type RegistryEntry } from "../src/server/references/registry";
import { segment, toUnits } from "../src/server/references/segment";
import { loadManifest, readCandidate, readSnapshot, SnapshotIntegrityError, versionFromSnapshot } from "../src/server/references/snapshots";
import { AppendOnlyViolation, InMemoryVersionStore, sha256, type RefVersion } from "../src/server/references/versions";

const snap = (id: string) => {
  const e = loadManifest().find((m) => m.id === id)!;
  return { entry: e, text: readSnapshot(e) };
};

// ───────────── Synthetic regulation used across tests ─────────────
const OFFICIAL = `# لائحة اختبارية

**المادة الأولى:**

**التسجيل**

1- يجب على الناظر تسجيل الوقف خلال ثلاثين يوم عمل من تاريخ توثيقه.

2- لا يجوز للناظر استبدال الأصل إلا بعد الحصول على إذن الجهة المختصة.

**المادة الثانية:**

**الغرامة**

يعاقب المخالف بغرامة لا تزيد على (خمسمائة ألف) ريال، ويُمنح مهلة خمسة عشر يوماً للتصحيح.

**المادة الثالثة:**

**النفاذ**

تسري أحكام هذه اللائحة من تاريخ نشرها في الجريدة الرسمية.

جميع الحقوق محفوظة
`;
const variant = (from: string, to: string) => OFFICIAL.replace(from, to);

describe("1. retrieval from official sources", () => {
  let server: Server;
  let base = "";
  const pages: Record<string, { status: number; type: string; body: string; location?: string }> = {};
  beforeAll(async () => {
    server = createServer((req, res) => {
      const p = pages[req.url ?? ""];
      if (!p) return void res.writeHead(404).end();
      if (p.location) return void res.writeHead(302, { location: p.location }).end();
      res.writeHead(p.status, { "content-type": p.type }).end(p.body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
    const html = `<html><body><nav>قائمة</nav><h1>لائحة اختبارية</h1><p>1443-7-03 الموافق 04-02-2022</p>${OFFICIAL.split("\n").filter(Boolean).map((l) => `<p>${l.replace(/\*\*/g, "")}</p>`).join("")}<footer>جميع الحقوق محفوظة لجريدة أم القرى</footer></body></html>`;
    pages["/ok"] = { status: 200, type: "text/html; charset=UTF-8", body: html };
    pages["/blocked"] = { status: 403, type: "text/html", body: "" };
    pages["/pdf"] = { status: 200, type: "application/pdf", body: "%PDF-1.7" };
    pages["/nostructure"] = { status: 200, type: "text/html", body: "<html><body><p>صفحة بلا نص نظامي</p></body></html>" };
    pages["/redirect"] = { status: 302, type: "", body: "", location: "https://law.arbiter.sa/x" };
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const host = () => new URL(base).host;

  it("fetches an official page, isolates the legal text and fingerprints it", async () => {
    const r = await fetchOfficial(`${base}/ok`, { refId: "TEST", allowHostsForTest: [host()] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.title).toBe("لائحة اختبارية");
    expect(r.doc.dateLine).toBe("1443-7-03 الموافق 04-02-2022");
    expect(r.doc.text).toContain("تسري أحكام هذه اللائحة من تاريخ نشرها");
    expect(r.doc.text).not.toContain("قائمة");
    expect(r.doc.sha256).toBe(sha256(r.doc.text));
    expect(segment(r.doc.text).articles.map((a) => a.number)).toEqual([1, 2, 3]);
  });

  it("never fetches a non-official host as official, and never over plain http", async () => {
    const spy = vi.fn();
    for (const url of ["https://law.arbiter.sa/law/x", "https://qanoniah.com/File/x", "http://www.uqn.gov.sa/details?p=1"]) {
      const r = await fetchOfficial(url, { refId: "TEST", fetchImpl: spy as unknown as typeof fetch });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.attempt.failure?.kind).toBe("link");
    }
    expect(spy).not.toHaveBeenCalled();
    expect(isOfficialUrl("https://www.uqn.gov.sa/details?p=18926")).toBe(true);
    expect(isOfficialUrl("https://laws.boe.gov.sa/BoeLaws/Laws/LawDetails/x/1")).toBe(true);
  });

  it("records why a retrieval failed instead of substituting another text", async () => {
    const opts = { refId: "TEST", allowHostsForTest: [host()] };
    const kinds = async (p: string) => {
      const r = await fetchOfficial(`${base}${p}`, opts);
      return r.ok ? "ok" : r.attempt.failure!.kind;
    };
    expect(await kinds("/blocked")).toBe("access_blocked");
    expect(await kinds("/missing")).toBe("link");
    expect(await kinds("/pdf")).toBe("file");
    expect(await kinds("/nostructure")).toBe("extraction");
    expect(await kinds("/redirect")).toBe("link");
    const slow = await fetchOfficial(`${base}/ok`, { ...opts, timeoutMs: 1, fetchImpl: ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch });
    expect(slow.ok).toBe(false);
  });

  it("keeps the verified copies of official pages intact (sha256 checked on every load)", () => {
    for (const e of loadManifest()) {
      expect(isOfficialUrl(e.url)).toBe(true);
      expect(() => readSnapshot(e)).not.toThrow();
    }
    const dir = mkdtempSync(path.join(tmpdir(), "refs-"));
    cpSync(path.join(process.cwd(), "data/references"), dir, { recursive: true });
    const e = loadManifest(dir)[0]!;
    writeFileSync(path.join(dir, e.file), readFileSync(path.join(dir, e.file), "utf8").replace("الهيئة", "الهيئه"));
    expect(() => readSnapshot(e, dir)).toThrow(SnapshotIntegrityError);
  });

  it("reads the official texts retrieved for the priority references", () => {
    const nzr = segment(snap("NZR/uqn-p18926").text);
    expect(nzr.articles.map((a) => a.number)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(nzr.issues).toEqual([]);
    expect(nzr.articles[31]!.body).toContain("تسري أحكام هذه اللائحة من تاريخ نشرها في الجريدة الرسمية");
    const dec = snap("NZR/uqn-p18936").text;
    expect(dec).toContain("رقم (31 /1 /18 /43) وتاريخ 30 /05/ 1443هـ");
    const prd = segment(snap("PRD/uqn-4001176").text);
    expect(prd.articles.length).toBe(37);
    expect(prd.articles.find((a) => a.number === 35)!.body).toContain("تحل هذه اللائحة محل لائحة إنشاء المحافظ الاستثمارية الوقفية");
    expect(prd.articles.find((a) => a.number === 36)!.body).toContain("خلال مدة لا تتجاوز (12) شهرًا من تاريخ نفاذها");
    expect(prd.articles.find((a) => a.number === 37)!.body).toContain("ويُعمل بها بعد مضي (90) يومًا من تاريخ نشرها");
    expect(segment(snap("DON/uqn-p27532").text).articles.length).toBe(12);
  });
});

describe("2. in force, amended, repealed", () => {
  const E = (id: string) => getEntry(id)!;
  it("registry facts are all evidenced from official hosts or recorded as unknown with a reason", () => {
    expect(validateRegistry()).toEqual([]);
    const broken: RegistryEntry = { ...E("DON"), id: "X", status: { value: "in_force", evidence: [{ url: "https://law.arbiter.sa/x", quote: "ساري", retrievedAt: "2026-11-06T00:00:00Z" }] } };
    expect(validateRegistry([...REGISTRY, broken]).some((v) => v.includes("غير رسمي"))).toBe(true);
    const noReason = { ...E("DON"), id: "Y", effective: { value: null, unknownReason: "" } } as RegistryEntry;
    expect(validateRegistry([...REGISTRY, noReason]).some((v) => v.includes("بلا سبب"))).toBe(true);
  });

  it("dates the products regulation and the repeal of the portfolios regulation from the official text", () => {
    expect(E("PRD").effective.value).toMatchObject({ from: "2026-09-10", computed: true });
    expect(statusAt(E("PRD"), "2026-07-01")).toBe("not_yet_in_force");
    expect(statusAt(E("PRD"), "2026-11-06")).toBe("in_force");
    expect(statusAt(E("PRT"), "2026-01-01")).toBe("in_force");
    expect(statusAt(E("PRT"), "2026-11-06")).toBe("repealed");
    expect(statusAt(E("FND"), "2026-11-06")).toBe("repealed");
  });

  it("treats an amended statute as in force only from a proven date, and an unpublished text as unknown", () => {
    expect(statusAt(E("GAA-LAW"), "2023-01-01")).toBe("in_force_amended");
    expect(statusAt(E("GAA-LAW"), "2020-01-01")).toBe("unknown");
    expect(statusAt(E("BO-STD"), "2026-11-06")).toBe("unknown");
    expect(statusAt(E("QWB"), "2026-11-06")).toBe("repealed");
    expect(statusAt(E("IHY"), "2026-11-06")).toBe("in_force");
    expect(statusAt(E("NZR"), "2022-02-03")).toBe("not_yet_in_force");
    expect(statusAt(E("NZR"), "2022-02-04")).toBe("in_force");
  });

  it("converts Hijri dates as the gazette prints them side by side", () => {
    const pairs: [string, [number, number, number]][] = [["2022-02-04", [1443, 7, 3]], ["2026-06-12", [1447, 12, 26]], ["2026-10-02", [1448, 4, 21]], ["2025-10-17", [1447, 4, 25]], ["2022-11-18", [1444, 4, 24]], ["2022-07-01", [1443, 12, 2]], ["2022-12-30", [1444, 6, 6]]];
    for (const [g, [y, m, d]] of pairs) {
      expect(gregorianToHijri(g)).toEqual({ year: y, month: m, day: d });
      expect(hijriToGregorian({ year: y, month: m, day: d })).toBe(g);
    }
  });
});

describe("3. OCR and extraction damage", () => {
  it("flags garbled letters, Latin noise, cut words, letter swaps and page headers as extraction damage", () => {
    const cases = [
      variant("تسجيل الوقف خلال", "تسجيل اAلوقف خلال"),
      variant("الجهة المختصة", "الجهة المختص"),
      variant("توثيقه", "توثقيه"),
      variant("للتصحيح.", "للتصحيح. لائحة تنظيم أعمال النظارة 12"),
    ];
    for (const c of cases) {
      const r = compareTexts(OFFICIAL, c);
      expect(r.outcome).toBe("extraction_defective");
      expect(r.articles.flatMap((a) => a.differences).every((d) => d.class === "ocr")).toBe(true);
    }
  });

  it("reads PDF presentation forms back to letters and reports their presence", () => {
    const pdfish = OFFICIAL.replace("الجريدة", "ﺍﻟﺠﺮﻳﺩﺓ");
    const r = compareTexts(OFFICIAL, pdfish);
    expect(r.candidateHasPresentationForms).toBe(true);
  });

  it("finds an article whose heading the copy lost, by its content", () => {
    const r = compareTexts(OFFICIAL, OFFICIAL.replace("**المادة الثانية:**", ""));
    const a2 = r.articles.find((a) => a.article === 2)!;
    expect(a2.located).toBe("content");
    expect(a2.outcome).toBe("extraction_defective");
  });
});

describe("4. differences at article and paragraph level", () => {
  it("a changed deadline is substantive, located at its paragraph, whatever the similarity", () => {
    const r = compareTexts(OFFICIAL, variant("ثلاثين يوم عمل", "ستين يوم عمل"));
    const d = r.articles[0]!.differences;
    expect(r.outcome).toBe("substantive_difference");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ locator: "م1/ف1", class: "substantive", official: "ثلاثين", candidate: "ستين" });
    expect(r.articles[0]!.coverage).toBeGreaterThan(0.9);
  });

  it("a removed negation or permission word is substantive", () => {
    for (const [a, b] of [["لا يجوز للناظر", "يجوز للناظر"], ["إلا بعد الحصول", "بعد الحصول"], ["يجب على الناظر", "يجوز للناظر"]] as const) {
      const r = compareTexts(OFFICIAL, variant(a, b));
      expect(r.outcome).toBe("substantive_difference");
      expect(r.articles[0]!.differences.some((d) => d.class === "substantive")).toBe(true);
    }
  });

  it("a changed amount or a lost percentage sign is substantive", () => {
    expect(compareTexts(OFFICIAL, variant("(خمسمائة ألف)", "(خمسين ألف)")).outcome).toBe("substantive_difference");
    const pct = "**المادة الأولى:**\n\nلا يتجاوز الفرق (10%) بين التقييمين في جميع الأحوال المذكورة.\n";
    expect(compareTexts(pct, pct.replace("10%", "10")).articles[0]!.differences[0]!.class).toBe("substantive");
  });

  it("a dropped paragraph is reported with its number (incomplete copy: not citable)", () => {
    const r = compareTexts(OFFICIAL, variant("\n2- لا يجوز للناظر استبدال الأصل إلا بعد الحصول على إذن الجهة المختصة.\n", "\n"));
    const d = r.articles[0]!.differences;
    expect(r.outcome).toBe("extraction_defective");
    expect(d.some((x) => x.locator === "م1/ف2" && x.class === "presumed_substantive" && x.reason === "عبارة ساقطة من النسخة")).toBe(true);
    expect(d.some((x) => x.reason.includes("ترقيم الفقرات"))).toBe(true);
  });

  it("spelling, diacritics, hamza and the same number in another form are editorial only", () => {
    const r = compareTexts(OFFICIAL, OFFICIAL.replace("لا تزيد على", "لا تزيد عن").replace("خمسة عشر يوماً", "خمسة عشرة يوماً").replace("خمسمائة", "خمسمئة").replace("إذن", "اذن").replace("يُمنح", "يمنح"));
    expect(r.outcome).toBe("editorial_only");
    expect(r.articles.flatMap((a) => a.differences).every((d) => d.class === "editorial")).toBe(true);
  });

  it("on the official Nazara regulation: the secondary copy differs only editorially where its text is intact", () => {
    const r = compareTexts(snap("NZR/uqn-p18926").text, readCandidate("NZR/arbiter-sec05.txt").text);
    const all = r.articles.flatMap((a) => a.differences);
    expect(all.filter((d) => d.class === "substantive" || d.class === "presumed_substantive")).toEqual([]);
    const a8 = r.articles.find((a) => a.article === 8)!.differences;
    expect(a8).toEqual(expect.arrayContaining([expect.objectContaining({ locator: "م8/ف1", class: "editorial", official: "على", candidate: "عن" }), expect.objectContaining({ locator: "م8/ف2", class: "editorial", reason: expect.stringContaining("15") })]));
    expect(r.articles.find((a) => a.article === 23)!.differences).toEqual([expect.objectContaining({ class: "editorial", reason: expect.stringContaining("24") })]);
  });

  it("on the official donations regulation: a lost percentage and an added phrase in the copy are caught", () => {
    const r = compareTexts(snap("DON/uqn-p27532").text, readCandidate("DON/arbiter-sec06.txt").text);
    const d = r.articles.flatMap((a) => a.differences);
    expect(d).toEqual(expect.arrayContaining([expect.objectContaining({ locator: "م3/ف8/ج", class: "substantive" }), expect.objectContaining({ locator: "م4/ف1", class: "presumed_substantive", candidate: "من تاريخ صدور الترخيص" })]));
  });
});

describe("5. no reliance on what could not be verified", () => {
  const store = new InMemoryVersionStore();
  const nzr = versionFromSnapshot(loadManifest().find((m) => m.id === "NZR/uqn-p18926")!, "2022-02-04", "أم القرى 1443/7/3هـ");
  store.addVersion(nzr);

  it("refuses an instrument with no stored official text, or whose force is not proven", () => {
    expect(cite(REGISTRY, store, { refId: "GAA-LAW", article: 1, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "no_version_for_date" });
    expect(cite(REGISTRY, store, { refId: "BO-STD", article: 5, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "status_unknown" });
    expect(cite(REGISTRY, store, { refId: "NOPE", article: 1, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "unknown_reference" });
  });

  it("refuses a stored text that was not compared, or compared but not reviewed by a person", () => {
    expect(cite(REGISTRY, store, { refId: "NZR", article: 8, paragraph: 1, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "not_compared" });
    store.addMatchRun({ id: "run-1", versionId: nzr.id, candidateLabel: "test", candidateSha256: "x", outcome: "extraction_defective", perArticle: { م8: "identical", م1: "extraction_defective" }, ranAt: "2026-11-06T00:00:00Z" });
    expect(cite(REGISTRY, store, { refId: "NZR", article: 8, paragraph: 1, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "not_reviewed" });
  });

  it("refuses an article whose comparison was not identical or editorial, even after review", () => {
    store.addReview({ runId: "run-1", reviewer: "reviewer-1", at: "2026-11-06T01:00:00Z", decision: "accepted", note: "test" });
    expect(cite(REGISTRY, store, { refId: "NZR", article: 1, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "article_not_verified" });
  });

  it("refuses a repealed text as in force, and a text from a non-official host", () => {
    expect(cite(REGISTRY, store, { refId: "PRT", article: 5, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "not_in_force" });
    const s2 = new InMemoryVersionStore();
    s2.addVersion({ ...nzr, id: "secondary", source: { ...nzr.source, url: "https://law.arbiter.sa/law/x" } });
    expect(cite(REGISTRY, s2, { refId: "NZR", article: 8, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "source_not_official" });
  });
});

describe("6. earlier versions are kept", () => {
  const v = (id: string, effectiveFrom: string, text: string): RefVersion => ({ id, refId: "SYN", label: id, effectiveFrom, source: { url: "https://www.uqn.gov.sa/details?p=1", retrievedAt: "2026-11-06T00:00:00Z", via: "relay_scrape", sha256: sha256(text), directConfirmed: false }, text, units: toUnits(segment(text)), createdAt: "2026-11-06T00:00:00Z" });
  it("answers which text applied on a past date after a newer text is added", () => {
    const s = new InMemoryVersionStore();
    s.addVersion(v("v1", "2022-02-04", OFFICIAL));
    s.addVersion(v("v2", "2025-01-01", variant("ثلاثين", "ستين")));
    expect(s.versionAt("SYN", "2023-06-01")!.id).toBe("v1");
    expect(s.versionAt("SYN", "2026-01-01")!.id).toBe("v2");
    expect(s.versionAt("SYN", "2021-01-01")).toBeNull();
    expect(s.versions("SYN")).toHaveLength(2);
  });

  it("refuses to overwrite a stored version and keeps stored objects immutable", () => {
    const s = new InMemoryVersionStore();
    const stored = s.addVersion(v("v1", "2022-02-04", OFFICIAL));
    expect(() => s.addVersion(v("v1", "2022-02-04", variant("ثلاثين", "ستين")))).toThrow(AppendOnlyViolation);
    expect(s.addVersion(v("v1-again", "2022-02-04", OFFICIAL))).toBe(stored);
    expect(() => {
      (stored as { text: string }).text = "x";
    }).toThrow(TypeError);
  });
});

describe("7. article references", () => {
  const units = toUnits(segment(snap("NZR/uqn-p18926").text));
  const unit = (l: string) => units.find((u) => u.locator === l);
  it("gives each article, paragraph and item of the official text a stable locator", () => {
    expect(unit("م8/ف1")!.text).toContain("خلال فترة زمنية لا تزيد على ثلاثين يوم عمل");
    expect(unit("م8/ف2/ب")!.text).toContain("أي تغيير جوهري يطرأ على الوقف");
    expect(unit("م5/ف1/و")!.text).toContain("أن يكون سعودياً");
    expect(unit("م24/ف1/ب")!.text).toContain("لا تزيد على (خمسمائة ألف) ريال");
    expect(unit("م33")).toBeUndefined();
  });

  it("does not take an article mentioned inside a sentence for a heading", () => {
    const t = "**المادة الأولى:**\n\nتطبق الأحكام الواردة في (المادة الخامسة) من هذه اللائحة.\nالمادة الخامسة من هذه اللائحة تسري على الجميع.\n";
    expect(segment(t).articles.map((a) => a.number)).toEqual([1]);
  });

  it("reads ordinals and number words", () => {
    expect(parseOrdinal("الحادية والثلاثون")).toBe(31);
    expect(parseOrdinal("الثالثة عشرة")).toBe(13);
    expect(parseOrdinal("العاشرة بعد المائة")).toBe(110);
    expect(cardinalValue(["خمسه", "عشر"])).toBe(15);
    expect(cardinalValue(["خمسه", "عشره"])).toBe(15);
    expect(cardinalValue(["خمسمايه", "الف"])).toBe(500000);
    expect(tokenize("02 مقدمي").map((t) => t.norm)).toEqual(["2", "مقدمي"]);
    expect(normalizeChars("الإدارة")).toBe("الاداره");
  });

  it("refuses to cite a locator that does not exist in the version", () => {
    const store = new InMemoryVersionStore();
    const nzr = versionFromSnapshot(loadManifest().find((m) => m.id === "NZR/uqn-p18926")!, "2022-02-04", "أم القرى");
    store.addVersion(nzr);
    expect(cite(REGISTRY, store, { refId: "NZR", article: 33, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "no_such_unit" });
    expect(cite(REGISTRY, store, { refId: "NZR", article: 8, paragraph: 9, asOf: "2026-11-06" })).toMatchObject({ ok: false, refusal: "no_such_unit" });
  });
});

describe("8. every unit traces back to its source", () => {
  it("a permitted citation shows the reference, article, text, official link, version, effective date and check", () => {
    const store = new InMemoryVersionStore();
    const entry = loadManifest().find((m) => m.id === "NZR/uqn-p18926")!;
    const nzr = store.addVersion(versionFromSnapshot(entry, "2022-02-04", "أم القرى 1443/7/3هـ"));
    store.addMatchRun({ id: "run-ok", versionId: nzr.id, candidateLabel: "synthetic", candidateSha256: "y", outcome: "identical", perArticle: { م8: "identical" }, ranAt: "2026-11-06T00:00:00Z" });
    store.addReview({ runId: "run-ok", reviewer: "reviewer-1", at: "2026-11-06T02:00:00Z", decision: "accepted", note: "synthetic" });
    const r = cite(REGISTRY, store, { refId: "NZR", article: 8, paragraph: 1, asOf: "2026-11-06" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.display).toMatchObject({ refName: "لائحة تنظيم أعمال النظارة", locator: "م8/ف1", officialUrl: "https://www.uqn.gov.sa/details?p=18926", versionLabel: "أم القرى 1443/7/3هـ", effectiveFrom: "2022-02-04", status: "in_force" });
    expect(r.display.text).toContain("ثلاثين يوم عمل");
    expect(r.display.verification).toMatchObject({ outcome: "identical", reviewedBy: "reviewer-1" });
    expect(r.display.verification.provenance).toContain("لم يُؤكد باسترجاع مباشر");
    expect(nzr.source.sha256).toBe(entry.sha256);
  });
});

describe("9–10. isolation: manual services untouched, nothing reaches clients", () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
  it("no page, route, server action or service module imports the reference engine", () => {
    const importers = files(path.join(process.cwd(), "src"))
      .filter((f) => !f.includes(`${path.sep}references${path.sep}`))
      .filter((f) => /server\/references|from "\.\.?\/references|\.\/references"/.test(readFileSync(f, "utf8")));
    // Only the schema barrel re-exports the table definitions (no runtime reads).
    expect(importers.map((f) => path.relative(process.cwd(), f))).toEqual([path.join("src", "server", "db", "schema", "index.ts")]);
  });
});
