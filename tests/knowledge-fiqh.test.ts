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
import { analyzeIssue, compare, conditionStatus, extractStatements, regulatoryTrack, reverse, weigh } from "../src/server/knowledge/fiqh/analyze";
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
    // its condition («إذا كانت فيها مصلحة») unknown: the result depends on that fact and is not given (order 2026-11-08, §3.1)
    expect(r.weighing.status).toBe("needs_facts");
    expect(r.weighing.reasons.join(" ")).toMatch(/تتوقف النتيجة على استكمال هذه الواقعة/);
    // with the fact given, it may ground a draft's weighing alone — low confidence, the reviewer told it rests on the book alone
    const r2 = run("ما حكم إجارة الوقف مدة طويلة؟", [F("في الإجارة الطويلة مصلحة ظاهرة للوقف")], [{ s: src({ refKind: "contemporary_book", refCode: "TEST-BOOK" }), text: "والراجح عند الحنابلة جواز إجارة الوقف مدة طويلة إذا كانت فيها مصلحة." }]);
    expect(r2.weighing).toMatchObject({ status: "weighed", confidence: "low" });
    expect((r2.weighing as { humanReview: string[] }).humanReview.join(" ")).toMatch(/الميسّر/);
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
    // two «إلا» clauses with nothing saying how they relate (nested? repeated?): no ruling is drawn, and a human decides
    // (order 2026-11-08, §3.2 — replaces the former parity count, which assumed nesting)
    const nr = run("ما حكم بيع الوقف؟", [F("تعطلت منافع العقار كليًا"), F("اشترط الواقف ألا يباع الوقف بحال")], [{ s: src(), text: "لا يجوز بيعه إلا أن تتعطل منافعه، إلا أن يشترط الواقف ألا يباع بحال." }]);
    const n = nr.statements[0]!;
    expect(n).toMatchObject({ polarity: "prohibit", effective: "unknown", exceptionStructure: "unclear" });
    expect(nr.weighing.status).not.toBe("weighed");
    expect(nr.weighing.humanReview.join(" ")).toMatch(/لا يبين النص/);
    expect(run("ما حكم ذلك؟", [], [{ s: src(), text: "ولا بأس ببيع آلته إذا خربت" }]).statements[0]).toMatchObject({ polarity: "permit" });
    expect(run("ما حكم ذلك؟", [], [{ s: src(), text: "وليس للواقف الرجوع في وقفه بعد لزومه" }]).statements[0]).toMatchObject({ polarity: "prohibit" });
    expect(run("ما حكم ذلك؟", [], [{ s: src(), text: "قال الشيخ: يجوز إبداله لمصلحة راجحة" }]).statements[0]!.attributedTo).toMatch(/لم يُسمَّ/);
  });

  it("round 8: alternative exceptions reverse once; an exception to a negated obligation obliges; an open condition of the relied-upon view asks for the fact", () => {
    const alt = run("ما حكم بيع الوقف؟", [F("تعطلت منافع العقار"), F("اذن الحاكم بالبيع")], [{ s: src(), text: "لا يجوز بيعه إلا أن تتعطل منافعه أو إلا بإذن الحاكم" }]).statements[0]!;
    expect(alt).toMatchObject({ polarity: "prohibit", effective: "permit" });
    const ob = run("ما حكم ذلك؟", [F("في الإشهاد مصلحة ظاهرة")], [{ s: src(), text: "لا يلزم الناظر الإشهاد إلا لمصلحة" }]).statements[0]!;
    expect(ob.polarity).toBe("not_obliged");
    const w = run("ما حكم إجارة الوقف مدة طويلة؟", [F("لا شرط للواقف")], [
      { s: src(), text: "تصح إجارة الوقف مدة طويلة إذا أذن الحاكم على الصحيح من المذهب" },
      { s: src({ refCode: "TEST-FQH-B", chunkId: "t2" }), text: "وقال الشيخ تقي الدين لا تصح إجارته مدة طويلة" },
    ]).weighing;
    expect(w.status).toBe("needs_facts");
  });

  // ── order of 2026-11-08, «ثالثاً»: unknown conditions, exceptions, negation, the relied-upon view ──────────────────
  const W = (r: ReturnType<typeof run>) => r.weighing as Extract<typeof r.weighing, { status: "weighed" }>;
  it("§3.1 a condition of the relied-upon view: met → its ruling; unmet → the other view, flagged; unknown → «تتوقف النتيجة», never the other view", () => {
    const texts = [
      { s: src(), text: "تصح إجارة الوقف مدة طويلة إذا أذن الحاكم على الصحيح من المذهب" },
      { s: src({ refCode: "TEST-FQH-B", chunkId: "t2", title: "نص اختبار ب" }), text: "وقال الشيخ تقي الدين لا تصح إجارته مدة طويلة" },
    ];
    const met = run("ما حكم إجارة الوقف مدة طويلة؟", [F("لا شرط للواقف"), F("صدر إذن الحاكم بالإجارة")], texts);
    expect(W(met)).toMatchObject({ status: "weighed", leaning: "permit", differsFromMutamad: false });
    const unmet = run("ما حكم إجارة الوقف مدة طويلة؟", [F("لا شرط للواقف"), F("لم يصدر إذن الحاكم")], texts);
    expect(W(unmet)).toMatchObject({ status: "weighed", leaning: "prohibit", differsFromMutamad: true, confidence: "low" });
    const unknown = run("ما حكم إجارة الوقف مدة طويلة؟", [F("لا شرط للواقف")], texts);
    expect(unknown.weighing.status).toBe("needs_facts");
    expect(unknown.weighing.reasons[0]).toBe("تتوقف النتيجة على استكمال هذه الواقعة.");
    expect(unknown.weighing.unresolved.join(" ")).toMatch(/اذن الحاكم/);
  });

  it("§3.1 a condition of the other view: unknown and not decisive → the relied-upon view stands; decisive → «تتوقف النتيجة»; a missing fact is no evidence against a view", () => {
    const texts = [
      { s: src(), text: "لا تصح إجارة الوقف مدة طويلة على الصحيح من المذهب" },
      { s: src({ refCode: "TEST-FQH-B", chunkId: "t2" }), text: "وقيل تصح إذا كانت لمصلحة الوقف" },
    ];
    const r = run("ما حكم إجارة الوقف مدة طويلة؟", [F("لا شرط للواقف")], texts);
    expect(W(r)).toMatchObject({ status: "weighed", leaning: "prohibit" });
    expect(W(r).uncertainty.join(" ")).toMatch(/لا يتغير بها الحكم/);
    // no relied-upon view, and the only applying view's condition unknown: the result turns on it
    const r2 = run("ما حكم إجارة الوقف مدة طويلة؟", [F("لا شرط للواقف")], [{ s: src(), text: "تصح إجارة الوقف مدة طويلة إذا كانت لمصلحة الوقف" }]);
    expect(r2.weighing.status).toBe("needs_facts");
    expect(r2.weighing.unresolved.join(" ")).toMatch(/مصلح/);
  });

  it("§3.2 exceptions: single; alternatives (any one); cumulative (all); undeterminable → no ruling, human review", () => {
    const single = (facts: Fact[]) => run("ما حكم بيع الوقف؟", [F("لا شرط للواقف"), ...facts], [{ s: src(), text: "لا يجوز بيعه إلا أن تتعطل منافعه" }]).statements[0]!;
    expect(single([F("تعطلت منافع العقار")])).toMatchObject({ exceptionStructure: "single", effective: "permit", applies: "applies" });
    expect(single([F("منافع العقار قائمة")])).toMatchObject({ effective: "prohibit", applies: "applies" });
    const alt = (facts: Fact[]) => run("ما حكم بيع الوقف؟", facts, [{ s: src(), text: "لا يجوز بيعه إلا أن تتعطل منافعه أو إلا بإذن الحاكم" }]).statements[0]!;
    expect(alt([F("منافع العقار قائمة"), F("أذن الحاكم بالبيع")])).toMatchObject({ exceptionStructure: "alternative", effective: "permit" });
    expect(alt([F("منافع العقار قائمة"), F("لم يأذن الحاكم")])).toMatchObject({ effective: "prohibit", applies: "applies" });
    expect(alt([F("منافع العقار قائمة")])).toMatchObject({ applies: "unknown" });
    const cum = (facts: Fact[]) => run("هل يجوز للناظر الاستدانة على الوقف؟", facts, [{ s: src(), text: "لا يجوز للناظر الاستدانة على الوقف إلا أن يشترطه الواقف ويأذن الحاكم" }]).statements[0]!;
    expect(cum([F("اشترط الواقف ذلك"), F("أذن الحاكم")])).toMatchObject({ exceptionStructure: "cumulative", effective: "permit", applies: "applies" });
    expect(cum([F("اشترط الواقف ذلك"), F("لم يأذن الحاكم")])).toMatchObject({ effective: "prohibit", applies: "applies" });
    expect(cum([F("اشترط الواقف ذلك")])).toMatchObject({ applies: "unknown" });
    // no parity count: two «إلا» clauses with no connector are not read as nested
    const u = run("ما حكم بيع الوقف؟", [F("تعطلت منافع العقار"), F("أذن الحاكم")], [{ s: src(), text: "لا يجوز بيعه إلا أن تتعطل منافعه، إلا بإذن الحاكم" }]);
    expect(u.statements[0]).toMatchObject({ exceptionStructure: "unclear", effective: "unknown" });
    expect(u.weighing.status).not.toBe("weighed");
  });

  it("§3.3 «لا يلزم الناظر الإشهاد إلا أن يشترطه الواقف»: conjugated «يشترطه»; not obliged / obliged / depends; «يجوز» does not answer «يلزم؟»; reverse()", () => {
    const q = "هل يلزم الناظر الإشهاد؟";
    const t = [{ s: src(), text: "لا يلزم الناظر الإشهاد إلا أن يشترطه الواقف" }];
    const ob = run(q, [F("اشترط الواقف الإشهاد في الوقفية")], t);
    expect(ob.statements[0]).toMatchObject({ polarity: "not_obliged", effective: "oblige", applies: "applies" });
    expect(W(ob)).toMatchObject({ status: "weighed", leaning: "oblige" });
    const no = run(q, [F("لم يشترط الواقف الإشهاد")], t);
    expect(W(no)).toMatchObject({ status: "weighed", leaning: "not_obliged" });
    const open = run(q, [], t);
    expect(open.weighing.status).toBe("needs_facts");
    expect(open.weighing.reasons[0]).toMatch(/تتوقف النتيجة/);
    // permitted is not obliged, and not-obliged is not permitted: a «يجوز» answers no «يلزم؟»
    const perm = run(q, [F("لا شرط للواقف")], [{ s: src(), text: "يجوز للناظر الإشهاد على تصرفاته" }]);
    expect(perm.weighing.status).toBe("insufficient");
    expect(perm.weighing.reasons.join(" ")).toMatch(/الجواز أو المنع لا الوجوب/);
    expect(perm.comparison.divergences).toEqual([]);
    expect([reverse("prohibit"), reverse("permit"), reverse("not_obliged"), reverse("oblige"), reverse("unknown")]).toEqual(["permit", "prohibit", "oblige", "not_obliged", "unknown"]);
    // «إلا إذا نص الواقف»: one exception (not also a condition), read as the founder's condition
    const nass = run("ما حكم صرف الريع لغير المصرف؟", [F("نص الواقف في الوقفية على جواز ذلك")], [{ s: src(), text: "لا يجوز صرف الريع لغير مصرفه إلا إذا نص الواقف" }]).statements[0]!;
    expect(nass.conditions.map((c) => c.kind)).toEqual(["exception"]);
    expect(nass).toMatchObject({ effective: "permit", kind: "text" });
    // contrary rulings in one clause: no ruling drawn
    expect(run("ما حكم بيعه؟", [], [{ s: src(), text: "يجوز بيعه ولا يجوز بيعه" }]).statements[0]).toMatchObject({ polarity: "unknown", unclear: expect.stringMatching(/التركيب غير واضح/) });
  });

  it("§3.4 the relied-upon view is never invented: «والمذهب الأول» resolved only when unambiguous; «قيل» never the school's; «والمذهب خلافه» says the school holds the contrary", () => {
    const a = run("ما حكم بيع الوقف؟", [], [{ s: src(), text: "يجوز بيعه وعنه لا يجوز والمذهب الأول" }]).statements;
    expect(a.find((x) => x.polarity === "permit")).toMatchObject({ rank: "mutamad" });
    expect(a.find((x) => x.kind === "riwaya")).toMatchObject({ rank: "other" });
    // three views before it: which is «the first» of the school's two? not certain from the passage
    const b = run("ما حكم بيع الوقف؟", [], [{ s: src(), text: "يجوز بيعه وعنه لا يجوز وقيل يجوز بإذن الحاكم والمذهب الأول" }]).statements;
    expect(b.some((x) => x.rank === "mutamad")).toBe(false);
    expect(b.find((x) => /الاول/.test(x.unclear ?? ""))).toBeTruthy();
    // a single view before it: its referent may lie outside the passage
    const c = run("ما حكم بيع الوقف؟", [], [{ s: src(), text: "يجوز بيعه والمذهب الأول" }]).statements;
    expect(c.some((x) => x.rank === "mutamad")).toBe(false);
    // «وقيل … والمذهب خلافه» alone: the school holds the contrary — no leaning built on the «qila» view, no school view invented
    const d = run("ما حكم بيع الوقف؟", [F("تعطلت منافع العقار"), F("لا شرط للواقف")], [{ s: src(), text: "وقيل يجوز بيعه والمذهب خلافه" }]);
    expect(d.statements[0]).toMatchObject({ kind: "qila", rank: "other", schoolHoldsContrary: true });
    expect(d.weighing.status).toBe("unresolved");
    expect(d.weighing.reasons.join(" ")).toMatch(/المذهب خلاف القول المتاح/);
    // «وقيل … وهو المذهب»: «qila» stays «qila», flagged for the reviewer
    const e = run("ما حكم بيع الوقف؟", [], [{ s: src(), text: "وقيل يجوز بيعه وهو المذهب" }]).statements[0]!;
    expect(e.rank).not.toBe("mutamad");
    expect(e.unclear).toMatch(/قيل/);
    // riwaya, wajh and a scholar's choice kept apart
    const f = run("ما حكم بيع الوقف؟", [], [{ s: src(), text: "وعنه يجوز بيعه وفي وجه لا يجوز واختار الشيخ تقي الدين جوازه للمصلحة" }]).statements;
    expect(f.map((x) => x.kind)).toEqual(["riwaya", "wajh", "ikhtiyar"]);
    // a question (B4) is not a ruling
    const g = run("ما حكم بيع الوقف؟", [], [{ s: src({ refKind: "official_guide" }), text: "هل يجوز للناظر بيع الوقف إذا تعطلت منافعه كليًا؟ يجوز بيع الوقف إذا تعطلت منافعه بقرار من الجهة المختصة." }]).statements;
    expect(g[0]).toMatchObject({ polarity: "unknown", unclear: expect.stringMatching(/سؤال/) });
  });

  it("§4 two tracks: a regulation never weighed with the books, never dropped, never declared in agreement; guidance never proves the school's view", () => {
    const q = "ما حكم بيع الوقف إذا تعطلت منافعه؟";
    const facts = [F("تعطلت منافع العقار"), F("لا شرط للواقف")];
    const reg = src({ refCode: "TEST-REG", refKind: "regulation", chunkId: "r1", title: "لائحة اختبار" });
    const r = run(q, facts, [{ s: src(), text: "يجوز بيعه إذا تعطلت منافعه" }, { s: reg, text: "لا يجوز بيع الوقف ولو تعطلت منافعه" }]);
    expect(W(r)).toMatchObject({ status: "weighed", leaning: "permit" });
    expect(W(r).statementIds.every((id) => r.statements.find((x) => x.id === id)!.source.refKind === "classical_fiqh")).toBe(true);
    // no agreement or divergence counted across the tracks
    expect([...r.comparison.agreements, ...r.comparison.divergences.map((d) => `${d.a} ${d.b}`)].join(" ")).not.toMatch(/ق2/);
    const t = regulatoryTrack(r.statements, r.weighing);
    expect(t.items).toEqual([expect.objectContaining({ refCode: "TEST-REG", standing: "binding" })]);
    expect(t.relation[0]).toMatchObject({ outcome: "conflict" });
    expect(t.legalReview).toBe(true);
    expect(t.combined.join(" ")).toMatch(/قيد نظامي ملزم.*لا يُنسب إلى المذهب/);
    expect(t.combined.join(" ")).toMatch(/تعارض ظاهر/);
    expect(t.combined.join(" ")).not.toMatch(/اتفق/);
    // the same ruling: at most «no conflict seen», never «agreement»
    const same = run(q, facts, [{ s: src(), text: "يجوز بيعه إذا تعطلت منافعه" }, { s: reg, text: "يجوز للناظر بيع الوقف إذا تعطلت منافعه بعد موافقة الهيئة" }]);
    const ts = regulatoryTrack(same.statements, same.weighing);
    expect(ts.relation[0]!.outcome).not.toBe("conflict");
    expect(ts.relation.map((x) => x.note).join(" ")).not.toMatch(/^اتفاق/);
    expect(ts.items[0]!.standing).toBe("binding");
    // a constraint whose condition is not met is still shown, never dropped
    const unmet = run(q, facts, [{ s: src(), text: "يجوز بيعه إذا تعطلت منافعه" }, { s: reg, text: "إذا كان الوقف مسجدا لم يجز بيعه ولو تعطلت منافعه" }]);
    const tu = regulatoryTrack(unmet.statements, unmet.weighing);
    expect(tu.items).toHaveLength(1);
    expect(tu.combined.join(" ")).toMatch(/لائحة اختبار/);
    // guidance alone: no fiqh weighing from it (it never proves the school's view), standing kept apart from binding
    const g = run(q, facts, [{ s: src({ refKind: "official_guide", refCode: "TEST-GUIDE", chunkId: "g1" }), text: "يجوز بيع الوقف إذا تعطلت منافعه." }]);
    expect(g.weighing.status).toBe("insufficient");
    const tg = regulatoryTrack(g.statements, g.weighing);
    expect(tg.items[0]).toMatchObject({ standing: "guidance" });
    expect(tg.legalReview).toBe(false);
    expect(regulatoryTrack(run(q, facts, [{ s: src({ refKind: "official_guide", chunkId: "g2" }), text: "يراعى عند بيع الوقف تعطل منافعه." }]).statements, null).items[0]).toMatchObject({ standing: "non_binding" });
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
