/**
 * Relevance regressions (owner's order of 2026-11-08, «خامساً»): the independent review's off-target questions (X*) and
 * paraphrases (P*), plus 7L and its negatives, on the dedicated «ke_test» database, each in a rolled-back transaction.
 * What is checked is the draft tier (`usable`), which is what the pipeline passes to the model. Every fix is a rule of
 * the matcher (answer type, qualifiers, negation, synonym groups, descriptors) — none is a per-question exception — so
 * the negatives sit beside the positives they could break.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

vi.mock("server-only", () => ({}));

const APP = process.env.KE_TEST_DATABASE_URL;
const enabled = !!APP && /ke_test/.test(APP) && !!process.env.KE_TEST_DATABASE_OWNER_URL;
const T = "2026-11-07";

type R = import("../src/server/knowledge/retrieve").RetrieveResult;
const top = (r: R) => r.usable[0]?.hit ?? null;
const where = (r: R) => r.usable.map((u) => `${u.hit.refCode} ${u.hit.locator}`).join(" | ");

describe.skipIf(!enabled)("relevance regressions (dedicated test database)", () => {
  let app: Pool;
  let schema: typeof import("../src/server/db/schema");
  let K: typeof import("../src/server/knowledge/retrieve");
  beforeAll(async () => {
    app = new Pool({ connectionString: APP });
    schema = await import("../src/server/db/schema");
    K = await import("../src/server/knowledge/retrieve");
  });
  afterAll(async () => { await app?.end(); });

  class Rollback extends Error {}
  async function ask(question: string, extra: Record<string, unknown> = {}): Promise<R> {
    const db = drizzle(app, { schema, casing: "snake_case" });
    let out: R | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
        out = await K.retrieve(tx as never, { question, service: "*", asOf: T, ...extra });
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return out!;
  }

  // ── nothing usable: the passage shares words but not the matter ─────────────────────────────────────────────────
  const NONE: [string, string, string][] = [
    ["X1", "هل يجب على الناظر تسجيل سيارته الخاصة لدى الهيئة خلال ثلاثين يوم عمل؟", "شيء آخر غير الوقف"],
    ["X3", "ما عقوبة الناظر إذا لم يسجل الوقف لدى الهيئة؟", "السؤال عن عقوبة: نص بلا عقوبة لا يجيب"],
    ["X5b", "كم بلغ معدل البطالة بين الوافدين في الربع الأول من عام 2025؟", "فئة أخرى"],
    ["X6", "كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2019؟", "سنة غير مذكورة"],
    ["X6c", "كم بلغ معدل البطالة بين السعوديين في الربع الأول من العام الماضي لعام 2025 أي قبل عشر سنوات؟", "تاريخ نسبي"],
    ["X12", "كم معدل البطالة بين السعوديات الإناث في الربع الأول من عام 2025؟", "فئة أخرى"],
    ["X13", "ما حكم بيع ثمرة نخل الوقف في موسمها؟", "فعل آخر"],
    ["X15", "ما حكم استبدال الوقف بسيارة كهربائية؟", "مادة غائبة"],
    ["X16", "هل يجوز للناظر أن يستدين لنفسه من مال الوقف لشراء منزل؟", "لنفسه، لا للوقف"],
    ["X17", "هل يصح وقف الدراهم عند الشافعية؟", "مذهب آخر"],
    ["X20", "ما حكم بيع الوقف عند الشافعية إذا تعطلت منافعه؟", "مذهب آخر"],
    ["7L-neg-place", "كم بلغ عدد سكان الرياض في تعداد 2022؟", "مدينة غير مذكورة (سطر التاريخ «Riyadh» ليس سكانها)"],
    ["7L-neg-year", "كم بلغ إجمالي عدد سكان المملكة في تعداد 2010؟", "سنة غير مذكورة"],
    ["7L-neg-year-b", "ما الوسيط العمري للسكان في تعداد 2010؟", "سنة غير مذكورة"],
    ["P-neg-period", "ما المدة التي يجب على الناظر خلالها تسجيل سيارته لدى المرور؟", "مدة لشيء آخر"],
  ];
  for (const [id, q, why] of NONE) {
    it(`${id}: no usable passage (${why})`, async () => {
      const r = await ask(q);
      expect(r.usable.length, where(r)).toBe(0);
    }, 90_000);
  }

  // ── the right passage first ──────────────────────────────────────────────────────────────────────────────────────
  const RIGHT: [string, string, RegExp, RegExp][] = [
    // ref+locator, then something in its text
    ["P2", "ما نسبة العاطلين عن العمل من المواطنين في أول ربع من 2025؟", /^GASTAT-LFS .*الفقرة 4/, /6\.3/],
    ["P3", "هل يجوز للقيّم الاقتراض على الوقف دون إذن القاضي؟", /^FQH-KASHSHAF/, /الاستدان/],
    ["P3b", "هل يجوز للناظر الاستدانة على الوقف من غير إذن الحاكم؟", /^FQH-KASHSHAF/, /الاستدان/],
    ["P5", "مهلة قيد الأعيان الموقوفة عند الهيئة العامة للأوقاف", /^NAZIR-GUIDE ص 16/, /تسجيل الوقف/],
    ["P6", "ما المدة التي يجب على الناظر خلالها تسجيل الوقف والأصول الموقوفة لدى الهيئة؟", /^NAZIR-GUIDE ص 16/, /30/],
    ["P1", "خلال كم يوم يلزم ناظر الوقف قيد الوقف وأصوله في الهيئة؟", /^NAZIR-GUIDE ص 16/, /30/],
    ["P8", "ما حكم مناقلة الوقف عند تعطل منافعه؟", /^(FQH-SHARH-MUNTAHA|FQH-KASHSHAF|FQH-INSAF)/, /المناقل/],
    ["P10", "كم بلغ معدل البطالة بين السعوديين في 2025 مقارنة بعام 2024؟", /^GASTAT-LFS/, /2025/],
    ["P12", "هل للناظر الاستدانة على الوقف بدون إذن الحاكم؟", /^FQH-KASHSHAF/, /الاستدان/],
    ["P13", "ما حكم بيع الوقف إذا تعطلت منافعه عند الحنابلة؟", /^(FQH-SHARH-MUNTAHA|FQH-KASHSHAF|FQH-INSAF)/, /بيع/],
    ["X14", "ما أجر الواقف وثوابه عند الله؟", /^BOOK-MAYSAR ص 211/, /ثواب/],
    ["7L-draft", "كم بلغ إجمالي عدد سكان المملكة في تعداد 2022؟", /^SPA-CENSUS-2023 .*الفقرة 1$/, /32,175,224/],
    ["7L-age", "ما الوسيط العمري للسكان في تعداد 2022؟", /^SPA-CENSUS-2023 .*الفقرة 2$/, /./],
  ];
  for (const [id, q, ref, text] of RIGHT) {
    it(`${id}: right passage first`, async () => {
      const r = await ask(q);
      const h = top(r);
      expect(h && `${h.refCode} ${h.locator}`, where(r)).toMatch(ref);
      expect(h!.text.normalize("NFC").replace(/[ً-ْ]/g, "")).toMatch(text);
    }, 90_000);
  }

  it("X14: the fee passages are refused for a reward question (أجر ≠ أجرة)", async () => {
    const r = await ask("ما أجر الواقف وثوابه عند الله؟");
    const fee = r.results.find((x) => x.hit.refCode === "BOOK-MAYSAR" && /ص 109/.test(x.hit.locator));
    if (fee) expect(fee.draft.usable).toBe(false);
    expect(r.usable.every((u) => !/أجرة الناظر/.test(u.hit.text))).toBe(true);
  }, 90_000);

  it("X9: a negated question answered by the positive duty is flagged, never read as agreeing", async () => {
    const r = await ask("هل يجب على الناظر ألا يسجل الوقف لدى الهيئة؟");
    expect(r.usable.length).toBeGreaterThan(0);
    for (const u of r.usable) if (!K.passageNegates(u.hit.text, K.negatedAct("هل يجب على الناظر ألا يسجل الوقف لدى الهيئة؟")!)) expect(u.draft.usable && u.draft.flags).toContain("negation_mismatch");
    // the same question without the negation carries no such flag
    const pos = await ask("هل يجب على الناظر أن يسجل الوقف لدى الهيئة؟");
    expect(pos.usable.some((u) => u.draft.usable && u.draft.flags.includes("negation_mismatch"))).toBe(false);
  }, 90_000);

  it("7L: the descriptor match is flagged and the passage keeps its own (English) words", async () => {
    const r = await ask("كم بلغ إجمالي عدد سكان المملكة في تعداد 2022؟");
    const u = r.usable[0]!;
    expect(u.draft.usable && u.draft.flags).toContain("descriptor_match");
    expect(u.hit.text).toMatch(/population/i);
    expect(u.hit.text).not.toMatch(/كم بلغ/);
  }, 90_000);

  it("nothing leaves the machine: retrieval and fiqh research make no network call (no model, no external service)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("network call attempted"); });
    // node:http/https through their CommonJS objects (the ESM namespace cannot be spied on)
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const http = req("node:http") as typeof import("node:http");
    const https = req("node:https") as typeof import("node:https");
    const httpSpy = vi.spyOn(http, "request");
    const httpsSpy = vi.spyOn(https, "request");
    try {
      const { research } = await import("../src/server/knowledge/fiqh/research");
      const db = drizzle(app, { schema, casing: "snake_case" });
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
        await K.retrieve(tx as never, { question: "ما حكم بيع الوقف إذا تعطلت منافعه؟", service: "*", asOf: T });
        // synthetic facts only (no client, no waqf)
        await research(tx as never, { question: "ما حكم بيع الوقف إذا تعطلت منافعه؟", facts: [{ text: "واقعة اصطناعية: تعطلت منافع عقار اختبار", status: "established" }], asOf: T });
        throw new Rollback();
      }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore(); httpSpy.mockRestore(); httpsSpy.mockRestore();
    }
  }, 120_000);

  it("pure: negation helpers", () => {
    expect(K.negatedAct("هل يجب على الناظر ألا يسجل الوقف؟")).toBeTruthy();
    expect(K.negatedAct("هل يجب على الناظر أن يسجل الوقف؟")).toBeNull();
    expect(K.passageNegates("لا يسجل الناظر الوقف", "يسجل")).toBe(true);
    expect(K.passageNegates("يلتزم الناظر بتسجيل الوقف", "يسجل")).toBe(false);
  });

  it("pure: answer-type and qualifier rules, with their negatives", () => {
    const m = K.qualifiersMissing;
    expect(m("ما عقوبة الناظر إذا لم يسجل؟", "يلتزم الناظر بالتسجيل")).toContain("العقوبة أو الغرامة المسؤول عنها");
    expect(m("ما عقوبة الناظر إذا لم يسجل؟", "يعاقب بغرامة لا تزيد على")).toEqual([]);
    expect(m("خلال كم يوم يسجل الوقف؟", "يسجل الوقف لدى الهيئة")).toContain("المدة المسؤول عنها");
    expect(m("خلال كم يوم يسجل الوقف؟", "خلال ثلاثين يوم عمل")).toEqual([]);
    expect(m("ما أجر الواقف عند الله؟", "أجرة الناظر من ريع الوقف")).toContain("الأجر بمعنى الثواب");
    expect(m("ما أجر الواقف عند الله؟", "يدوم أجرها وثوابها للواقف")).toEqual([]);
    expect(m("كم في 2025 مقارنة بعام 2024؟", "في الربع الأول من 2025")).toEqual([]);
    expect(m("كم في 2023 مقارنة بعام 2024؟", "في الربع الأول من 2025").length).toBe(1);
    expect(m("كم سكان الرياض؟", "عدد سكان المملكة")).toContain("«رياض»");
    expect(m("كم سكان المملكة؟", "عدد سكان المملكة")).toEqual([]);
    expect(m("كم المعدل في العام الماضي؟", "المعدل 6.3%").some((x) => /التاريخ النسبي/.test(x))).toBe(true);
  });
});
