/**
 * Fiqh research, preliminary weighing and the human review path (owner's order of 2026-11-07, §3, §7, §9).
 * Part 1 — pure analysis on SYNTHETIC TEST TEXTS («نص اختبار», attributed to no real book) for the situations that need
 * a controlled text. Part 2 — the test knowledge base (published texts; synthetic matters and facts). Part 3 — the
 * review path: decisions bound to an authenticated session, B13 passage by passage, the final gate. The accounts are
 * TEST ACCOUNTS, never human reviewers (owner's order 2026-11-06, §4): they prove the mechanism only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

vi.mock("server-only", () => ({}));

import * as schema from "../src/server/db/schema";
import { analyzeIssue, compare, conditionStatus, extractStatements, weigh } from "../src/server/knowledge/fiqh/analyze";
import type { Fact, SourceRef } from "../src/server/knowledge/fiqh/types";
import { FIQH_CASES } from "./knowledge/fiqh-cases";

const src = (o: Partial<SourceRef> = {}): SourceRef => ({
  chunkId: o.chunkId ?? "t1", refCode: o.refCode ?? "TEST-FQH-A", refKind: o.refKind ?? "classical_fiqh", title: o.title ?? "نص اختبار أ", author: null, edition: null,
  locator: o.locator ?? "ص1", volume: null, page: null, topic: null, status: o.status ?? "unreviewed", flags: o.flags ?? [], ...o,
});
const F = (text: string, status: Fact["status"] = "established"): Fact => ({ text, status });
const run = (question: string, facts: Fact[], texts: { s: SourceRef; text: string }[]) => {
  const issue = analyzeIssue(question, facts);
  const statements = texts.flatMap((t, i) => extractStatements(t.s, t.text, { question, facts, idPrefix: `ق${i + 1}` }));
  const comparison = compare(statements, issue);
  return { issue, statements, comparison, weighing: weigh(statements, issue, comparison) };
};

describe("fiqh analysis — synthetic test texts", () => {
  it("statement nature and standing come from the text's wording: the relied-upon view, a riwaya, «qila», a scholar's choice; no standing invented", () => {
    const r = run("ما حكم إجارة الوقف مدة طويلة؟", [F("الإجارة لمصلحة الوقف")], [{ s: src(), text: "تصح إجارة الوقف مدة طويلة على الصحيح من المذهب وعنه لا تصح وقيل تصح بإذن الحاكم واختاره الشيخ تقي الدين" }]);
    const [a, b, c] = r.statements;
    expect(a).toMatchObject({ kind: "text", rank: "mutamad", polarity: "permit", element: "quote" });
    expect(b).toMatchObject({ kind: "riwaya", rank: "other", polarity: "prohibit", attributedTo: "الإمام أحمد (رواية)" });
    // «وقيل تصح بإذن الحاكم واختاره الشيخ…»: a «qila» view, which the named scholar chose
    expect(c).toMatchObject({ kind: "qila", attributedTo: "الشيخ تقي الدين", polarity: "permit" });
    expect(c!.markers).toEqual(expect.arrayContaining(["وقيل"]));
    expect(r.statements).toHaveLength(3);
    // a text without the school's wording: standing «غير متحققة», never «المعتمد» by the book's fame
    const plain = run("ما حكم إجارة الوقف؟", [], [{ s: src(), text: "تصح إجارة الوقف بأجرة المثل" }]);
    expect(plain.statements[0]).toMatchObject({ rank: "unverified", attributedTo: null });
  });

  it("the relied-upon view and the leaning on these facts are kept apart: when the former's condition is not met, the analysis may lean elsewhere — flagged", () => {
    const r = run("ما حكم بيع الوقف للمصلحة؟", [F("منافع العين قائمة"), F("في البيع مصلحة ظاهرة للوقف"), F("لا شرط للواقف في البيع")], [
      { s: src(), text: "إذا تعطلت منافعه جاز بيعه على الصحيح من المذهب" },
      { s: src({ refCode: "TEST-FQH-B", chunkId: "t2", title: "نص اختبار ب" }), text: "وجوز الشيخ تقي الدين بيعه لمصلحة" },
    ]);
    expect(r.statements[0]).toMatchObject({ rank: "mutamad", applies: "does_not_apply" });
    expect(r.weighing).toMatchObject({ status: "weighed", leaning: "permit", differsFromMutamad: false });
    // the relied-upon view permits only on its condition; with a text where it prohibits and its condition holds the other way:
    const r2 = run("ما حكم بيع الوقف للمصلحة؟", [F("تعطلت منافع العين"), F("في البيع مصلحة ظاهرة للوقف"), F("لا شرط للواقف في البيع")], [
      { s: src(), text: "إذا كانت منافعه قائمة لم يجز بيعه على الصحيح من المذهب" },
      { s: src({ refCode: "TEST-FQH-B", chunkId: "t2", title: "نص اختبار ب" }), text: "وجوز الشيخ تقي الدين بيعه لمصلحة" },
    ]);
    expect(r2.statements[0]).toMatchObject({ rank: "mutamad", polarity: "prohibit", applies: "does_not_apply" });
    expect(r2.weighing).toMatchObject({ status: "weighed", leaning: "permit", differsFromMutamad: true, confidence: "low" });
    expect((r2.weighing as { humanReview: string[] }).humanReview.join(" ")).toMatch(/يخالف المعتمد/);
  });

  it("a text's plain wording against a condition in another source: the divergence is one of condition, and no weighing is made up without a ground", () => {
    const r = run("ما حكم إجارة الوقف مدة طويلة؟", [F("في الإجارة الطويلة مصلحة ظاهرة للوقف")], [
      { s: src(), text: "لا تصح إجارة الوقف مدة طويلة" },
      { s: src({ refCode: "TEST-FQH-B", chunkId: "t2", title: "نص اختبار ب" }), text: "تصح إجارة الوقف مدة طويلة إذا كانت لمصلحة الوقف" },
    ]);
    expect(r.comparison.divergences).toEqual([expect.objectContaining({ nature: "in_condition" })]);
    expect(r.weighing.status).toBe("unresolved");
  });

  it("a contemporary book: its author's explanation or choice, never the school's text; an attribution to the school is flagged for checking", () => {
    const r = run("ما حكم إجارة الوقف مدة طويلة؟", [], [{ s: src({ refKind: "contemporary_book", refCode: "TEST-BOOK" }), text: "والراجح عند الحنابلة جواز إجارة الوقف مدة طويلة إذا كانت فيها مصلحة." }]);
    expect(r.statements[0]).toMatchObject({ kind: "author_choice", element: "author", rank: "unverified" });
    expect(r.comparison.contemporaryChecks[0]).toMatchObject({ outcome: "attributes_school" });
    // alone it may still ground a draft's weighing, with low confidence and the reviewer told it rests on the book alone
    expect(r.weighing).toMatchObject({ status: "weighed", confidence: "low" });
    expect((r.weighing as { humanReview: string[] }).humanReview.join(" ")).toMatch(/الميسّر/);
  });

  it("no weighing before the facts the ruling turns on are given; assumptions are told apart from established facts", () => {
    const r = run("ما حكم بيع الوقف؟", [], [{ s: src(), text: "لا يجوز بيعه إلا أن تتعطل منافعه" }]);
    expect(r.issue.missing.length).toBeGreaterThan(0);
    expect(r.weighing.status).toBe("needs_facts");
    const a = analyzeIssue("ما حكم بيع الوقف؟", [F("تعطلت منافع العين", "assumed"), F("لا شرط للواقف", "established")]);
    expect(a.factors.find((f) => f.key === "benefit")).toMatchObject({ status: "assumed" });
    expect(a.factors.find((f) => f.key === "waqif")).toMatchObject({ status: "given" });
  });

  it("conditions and exceptions against facts: negation, «تعطّل», and a cut word read as such", () => {
    expect(conditionStatus("فان لم تتعطل منافعه", [F("تعطلت منافع العقار")]).status).toBe("unmet");
    expect(conditionStatus("الا ان يكون بحال لا ينتفع به", [F("تعطلت منافع العقار")]).status).toBe("met");
    expect(conditionStatus("الا ان تتعطل منافعه او لمحلته او غيره", [F("تعطلت منافع العقار")]).status).toBe("met");
    expect(conditionStatus("بشرط اذن الحاكم", [F("صدر اذن المحكمة")]).status).toBe("met");
    expect(conditionStatus("بشرط اذن الحاكم", []).status).toBe("unknown");
  });

  it("round 7: the school's verdict on a view is read as such; a negated obligation is not an obligation; a riwaya stays the imam's", () => {
    const a = run("ما حكم بيع الوقف؟", [], [{ s: src(), text: "يجوز بيعه وقيل لا يجوز والمذهب خلافه" }]).statements;
    expect(a.find((x) => x.kind === "qila")).toMatchObject({ rank: "other" });
    expect(a.some((x) => x.rank === "mutamad" && x.kind === "qila")).toBe(false);
    const b = run("ما حكم بيع الوقف؟", [], [{ s: src(), text: "وعنه يجوز بيعه والصحيح من المذهب أنه لا يجوز" }]).statements;
    expect(b).toEqual([expect.objectContaining({ kind: "riwaya", rank: "other", polarity: "permit" }), expect.objectContaining({ rank: "mutamad", polarity: "prohibit" })]);
    expect(run("ما حكم ذلك؟", [], [{ s: src(), text: "لا يلزم الناظر ذلك" }]).statements[0]).toMatchObject({ polarity: "not_obliged" });
    expect(run("ما حكم ذلك؟", [], [{ s: src(), text: "لا يحق للناظر بيعه إلا بإذن الحاكم" }]).statements[0]).toMatchObject({ polarity: "prohibit" });
    expect(run("ما حكم وقف الدراهم؟", [], [{ s: src(), text: "وعنه يصح وقف الدراهم اختاره شيخنا" }]).statements[0]!.attributedTo).toBe("الإمام أحمد (رواية) — اختارها شيخنا");
  });

  it("round 7 (cont.): «وهي المذهب» makes the riwaya the relied-upon view and the contrary statement the other; nested exceptions; «لا بأس»; «ليس لل…»; an unnamed «الشيخ»", () => {
    const a = run("ما حكم وقف الدراهم؟", [], [{ s: src(), text: "لا يصح وقف الدراهم. وعنه يصح، وهي المذهب عند المتأخرين." }]).statements;
    expect(a).toEqual([expect.objectContaining({ rank: "other", polarity: "prohibit" }), expect.objectContaining({ kind: "riwaya", rank: "mutamad", polarity: "permit" })]);
    const n = run("ما حكم بيع الوقف؟", [F("تعطلت منافع العقار كليًا"), F("اشترط الواقف ألا يباع الوقف بحال")], [{ s: src(), text: "لا يجوز بيعه إلا أن تتعطل منافعه، إلا أن يشترط الواقف ألا يباع بحال." }]).statements[0]!;
    expect(n).toMatchObject({ polarity: "prohibit", effective: "prohibit" });
    expect(run("ما حكم ذلك؟", [], [{ s: src(), text: "ولا بأس ببيع آلته إذا خربت" }]).statements[0]).toMatchObject({ polarity: "permit" });
    expect(run("ما حكم ذلك؟", [], [{ s: src(), text: "وليس للواقف الرجوع في وقفه بعد لزومه" }]).statements[0]).toMatchObject({ polarity: "prohibit" });
    expect(run("ما حكم ذلك؟", [], [{ s: src(), text: "قال الشيخ: يجوز إبداله لمصلحة راجحة" }]).statements[0]!.attributedTo).toMatch(/لم يُسمَّ/);
  });

  it("a weighing is a research recommendation: never a ruling, never final", () => {
    const r = run("ما حكم إجارة الوقف؟", [F("لمصلحة")], [{ s: src(), text: "تصح إجارة الوقف" }]);
    expect(r.weighing.by).toBe("engine");
    expect(r.weighing.humanReview[0]).toMatch(/اعتماد المراجع الشرعي/);
  });
});

const url = process.env.KE_TEST_DATABASE_URL;
const ownerUrl = process.env.KE_TEST_DATABASE_OWNER_URL;
const ready = !!url && /_test(\?|$)/.test(url) && !!ownerUrl;

describe.skipIf(!ready)("fiqh research on the test knowledge base, and the review path (dedicated test database)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(() => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema, casing: "snake_case" });
  });
  afterAll(async () => { await pool?.end(); });
  const rolledBack = <T>(fn: (tx: never) => Promise<T>) => db.transaction(async (tx) => {
    const out = await fn(tx as never);
    throw Object.assign(new Error("rollback"), { out });
  }).catch((e: Error & { out?: T }) => { if (e.message === "rollback") return e.out as T; throw e; });

  for (const c of FIQH_CASES) {
    it(`case ${c.id}: ${c.title}`, async () => {
      const { research } = await import("../src/server/knowledge/fiqh/research");
      const d = await rolledBack((tx) => research(tx, { question: c.question, facts: c.facts, asOf: "2026-11-07", stage: "preliminary", refCodes: c.refCodes }));
      // nothing attributed to a source that the source's passage does not hold; no page invented
      for (const s of d.statements) {
        const src = d.sources.find((x) => x.chunkId === s.source.chunkId)!;
        expect(src).toBeTruthy();
        if (s.source.page) expect(s.source.locator).toContain(s.source.page);
      }
      expect(c.judge?.(d) ?? null).toBeNull();
    });
  }

  it("the review path: session-bound decisions, author excluded, B13 passage by passage, modification recorded, the final gate", async () => {
    const cases = await import("./knowledge/cases");
    const { research, saveDossier } = await import("../src/server/knowledge/fiqh/research");
    const rv = await import("../src/server/knowledge/review");
    const { finalBasisErrors } = await import("../src/server/knowledge/gate");
    const out = await rolledBack(async (tx: import("../src/server/db").Tx) => {
      const AUTHOR = "00000000-0000-4000-8000-00000000af02";
      await cases.testReviewer(tx, AUTHOR, ["sharia"]);
      await cases.testReviewer(tx);
      const d = await research(tx, { question: FIQH_CASES[0]!.question, facts: FIQH_CASES[0]!.facts, asOf: "2026-11-07", stage: "draft" });
      const saved = await saveDossier(tx, d, { createdBy: AUTHOR });
      const sections = [{ key: "a", title: "الرأي", blocks: [{ type: "specialist", prompt: "", text: "مسودة", refs: d.sources.map((s, i) => ({ n: i + 1, refCode: s.refCode, version: "", locator: s.locator, chunkId: s.chunkId })), dossierId: saved.id }] }] as never;
      const before = await finalBasisErrors(tx, sections, "2026-11-07");
      const dbBefore = (await tx.execute<{ n: number }>(sql`select sections_unreviewed_basis(${JSON.stringify(sections)}::jsonb) as n`)).rows[0]!.n;
      const refusals: Record<string, string> = {};
      const attempt = async (k: string, fn: () => Promise<unknown>) => { await tx.execute(sql`savepoint a`); try { await fn(); refusals[k] = "ACCEPTED"; await tx.execute(sql`release savepoint a`); } catch (e) { refusals[k] = String((e as { cause?: Error }).cause?.message ?? (e as Error).message).slice(0, 160); await tx.execute(sql`rollback to savepoint a`); } };
      // the dossier's author does not review it; no session token, no review; a field without the permission, no review
      await attempt("author", () => cases.asUser(tx, AUTHOR, () => rv.recordFiqhReview(tx, cases.actorOf(AUTHOR), { dossierId: saved.id, decision: "approved", note: "اعتماد من معدّ الملف نفسه" })));
      await attempt("noSession", () => cases.asUser(tx, cases.TEST_REVIEWER, () => rv.recordFiqhReview(tx, { userId: cases.TEST_REVIEWER, sessionToken: "" }, { dossierId: saved.id, decision: "approved", note: "اعتماد بلا جلسة مصادقة" })));
      await attempt("forgedToken", () => cases.asUser(tx, cases.TEST_REVIEWER, () => rv.recordFiqhReview(tx, { userId: cases.TEST_REVIEWER, sessionToken: "forged-token" }, { dossierId: saved.id, decision: "approved", note: "اعتماد برمز جلسة مزور" })));
      await attempt("directInsert", () => cases.asUser(tx, cases.TEST_REVIEWER, () => tx.execute(sql`insert into fiqh_reviews (dossier_id, dossier_sha256, reviewer_user_id, reviewer_role, decision, note) values (${saved.id}::uuid, ${saved.sha256}, ${cases.TEST_REVIEWER}::uuid, 'sharia', 'approved', 'إدراج مباشر بلا جلسة')`)));
      // a request for more research, then a modification with the reviewer's own weighing and ONE passage approved
      await cases.asUser(tx, cases.TEST_REVIEWER, () => rv.recordFiqhReview(tx, cases.actorOf(cases.TEST_REVIEWER), { dossierId: saved.id, decision: "more_research", note: "يُستكمل البحث في إذن الحاكم" }));
      const st1 = (await rv.dossierStanding(tx, [saved.id])).get(saved.id)!;
      const one = d.sources[0]!.chunkId;
      await tx.execute(sql`select pg_sleep(0.01)`);
      await cases.asUser(tx, cases.TEST_REVIEWER, () => rv.recordFiqhReview(tx, cases.actorOf(cases.TEST_REVIEWER), { dossierId: saved.id, decision: "modified", note: "أعتمد الجواز مع تقييده بالمصلحة الظاهرة", replacement: { position: "الجواز بقيد المصلحة الظاهرة", reasons: "نص كشاف القناع على الاستدانة لمصلحة بلا إذن حاكم", statementIds: [d.statements[0]!.id] }, passages: [one] }));
      const st2 = (await rv.dossierStanding(tx, [saved.id])).get(saved.id)!;
      const passages = await rv.passageStanding(tx, d.sources.map((s) => s.chunkId));
      const after = await finalBasisErrors(tx, sections, "2026-11-07");
      const dbAfter = (await tx.execute<{ n: number }>(sql`select sections_unreviewed_basis(${JSON.stringify(sections)}::jsonb) as n`)).rows[0]!.n;
      // the remaining passages approved one by one: the gate opens
      for (const s of d.sources.slice(1)) {
        const [c] = await tx.select({ id: schema.kbChunks.sourceId }).from(schema.kbChunks).where(sql`id = ${s.chunkId}::uuid`);
        await cases.asUser(tx, cases.TEST_REVIEWER, () => rv.recordSourceReview(tx, cases.actorOf(cases.TEST_REVIEWER), { sourceId: c!.id, chunkId: s.chunkId, decision: "accepted", note: "مقابلة المقطع بمصدره (حساب اختبار)" }));
      }
      const finalErrors = await finalBasisErrors(tx, sections, "2026-11-07");
      const dbFinal = (await tx.execute<{ n: number }>(sql`select sections_unreviewed_basis(${JSON.stringify(sections)}::jsonb) as n`)).rows[0]!.n;
      // withdrawing the reviewer's permission: the approval no longer counts
      await tx.execute(sql`delete from user_roles where user_id = ${cases.TEST_REVIEWER}::uuid`);
      const withdrawn = await finalBasisErrors(tx, sections, "2026-11-07");
      return { before, dbBefore, refusals, st1: st1.latest?.decision, final1: st1.final, st2: st2.latest?.decision, final2: st2.final, replacement: st2.latest?.replacement, passages: [...passages.entries()], one, after, dbAfter, finalErrors, dbFinal, withdrawn, n: d.sources.length };
    });
    expect(out.n).toBeGreaterThan(1);
    expect(out.before.length).toBeGreaterThan(out.n - 1);
    expect(out.dbBefore).toBeGreaterThan(0);
    expect(out.refusals.author).toMatch(/معدّ الملف/);
    expect(out.refusals.noSession).toMatch(/جلسة/);
    expect(out.refusals.forgedToken).toMatch(/authenticated session/);
    expect(out.refusals.directInsert).toMatch(/authenticated session|recorded only/);
    expect([out.st1, out.final1]).toEqual(["more_research", false]);
    expect([out.st2, out.final2]).toEqual(["modified", true]);
    expect(out.replacement).toMatchObject({ position: "الجواز بقيد المصلحة الظاهرة" });
    // B13: the passage approved with the decision is approved; the others are not (under review: used in a dossier)
    expect(out.passages.find(([id]) => id === out.one)?.[1]).toBe("approved");
    expect(out.passages.filter(([id]) => id !== out.one).every(([, st]) => st !== "approved")).toBe(true);
    expect(out.after.length).toBe(out.n - 1);
    expect(out.dbAfter).toBe(out.n - 1);
    expect(out.finalErrors).toEqual([]);
    expect(out.dbFinal).toBe(0);
    expect(out.withdrawn.length).toBeGreaterThan(0);
  });
});
