/**
 * Stage 11 (owner's decision of 2026-11-12, «ثانياً»): conservative abstention in the fiqh research. SYNTHETIC TEST TEXTS
 * («نص اختبار»), the independent review's failing cases N10-2 to N10-5 in their own wording (qa10/f1-fiqh.ts), and
 * controls. The property under test: where the lexical reading cannot be sure, there is no firm result — «يحتاج استكمال
 * الوقائع» or no result — and where the facts are plain the preliminary result stands. Never a ruling, never final.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { analyzeIssue, extractStatements } from "../src/server/knowledge/fiqh/analyze";
import { conservative, factHedge, schoolOf, FRAME_NOTE } from "../src/server/knowledge/fiqh/conservative";
import type { Fact, SourceRef } from "../src/server/knowledge/fiqh/types";

const src = (refKind = "classical_fiqh", refCode = "A"): SourceRef => ({ chunkId: refCode, refCode, refKind, title: `نص اختبار ${refCode}`, author: null, edition: null, locator: "ص1", volume: null, page: "1", topic: null, status: "unreviewed", flags: [] });
const F = (t: string, status: Fact["status"] = "established"): Fact => ({ text: t, status });
const QS = "ما حكم بيع الوقف إذا تعطلت منافعه؟";
const run = (texts: (string | [string, string])[], facts: Fact[], q = QS) => {
  const issue = analyzeIssue(q, facts);
  const all = texts.flatMap((t, i) => {
    const [kind, text] = typeof t === "string" ? ["classical_fiqh", t] : t;
    return extractStatements(src(kind, `S${i + 1}`), text, { question: q, facts, idPrefix: `ق${i + 1}` });
  });
  return conservative(issue, all);
};
const firm = (r: ReturnType<typeof run>) => (r.weighing.status === "weighed" ? r.weighing.leaning : null);
const JUDGE = "ولا يجوز بيعه إلا بإذن الحاكم على الصحيح من المذهب. وعنه يجوز بيعه.";
const lost = [F("تعطلت منافع العقار كليًا"), F("لا شرط للواقف في البيع")];
const present = [F("منافع العقار قائمة"), F("لا شرط للواقف في البيع")];

describe("N10-2: a fact not plainly stated is not established — the result waits for it", () => {
  it.each([
    ["F3 pending", "ننتظر قرار المحكمة"],
    ["F4 applied, not granted", "تقدم الناظر بطلب إذن من المحكمة"],
    ["F5 refused (never a permission)", "صدر قرار من المحكمة برفض البيع"],
    ["F6 not decided yet", "المحكمة لم تبت في طلب الإذن بعد"],
    ["F7 in doubt", "يُشك في صدور الإذن"],
    ["hearsay", "قيل إن القاضي أذن"],
    ["granted then revoked", "أذنت المحكمة ثم ألغت إذنها"],
  ])("%s: «%s» → no permit; needs the fact", (_, fact) => {
    const r = run([JUDGE], [...lost, F(fact)]);
    expect(firm(r)).not.toBe("permit");
    expect(r.frame.status).toBe("needs_facts");
    expect(r.frame.statusAr).toBe("يحتاج استكمال الوقائع");
    expect(r.frame.notEstablished.map((g) => g.text)).toContain(fact);
  });
  it("F16/F17: a negated paraphrase or a continuing state is not matched to «تتعطل منافعه» either way", () => {
    for (const fact of ["الانتفاع بالعقار غير ممكن", "ما زالت منافع العقار قائمة"]) {
      const r = run(["ولا يجوز بيعه إلا أن تتعطل منافعه."], [F(fact), F("لا شرط للواقف")]);
      expect(r.frame.status, fact).toBe("needs_facts");
      expect(firm(r), fact).toBeNull();
    }
  });
  it("an assumed fact is never established", () => {
    expect(factHedge(F("تعطلت منافع العقار", "assumed"))).toMatch(/مفترضة/);
    const r = run(["ولا يجوز بيعه إلا أن تتعطل منافعه."], [F("تعطلت منافع العقار", "assumed"), F("لا شرط للواقف")]);
    expect(r.frame.established.map((f) => f.text)).not.toContain("تعطلت منافع العقار");
  });
});

describe("N10-4: a clause in words the reading does not parse limits the ruling — no ruling is drawn from it", () => {
  it.each([
    ["T5 «عند»", "ويجوز بيعه عند تعطل منافعه.", present],
    ["T6 «في حال»", "ويجوز بيعه في حال تعطلت منافعه.", present],
    ["T7 mid-sentence «لو»", "ويجوز بيعه لو تعطلت منافعه.", present],
    ["T10 «ما لم»", "ولا يجوز بيعه ما لم تتعطل منافعه.", lost],
    ["T9 «سوى» (a mosque)", "لا يجوز بيعه إلا أن تتعطل منافعه سوى المسجد فلا يباع.", [...lost, F("العين الموقوفة مسجد")]],
    ["T8 nested «إلا» (a mosque)", "لا يجوز بيعه إلا أن تتعطل منافعه، إلا المسجد فلا يباع بحال.", [...lost, F("العين الموقوفة مسجد")]],
    ["T12 «بشرط ألا»", "ويجوز بيعه بشرط ألا تكون منافعه قائمة.", present],
  ])("%s → no permit", (_, text, facts) => {
    const r = run([text], facts as Fact[]);
    expect(firm(r)).not.toBe("permit");
    expect(r.frame.status).not.toBe("preliminary");
  });
  it("«عند أحمد» attributes a view: it is not read as a condition", () => {
    const r = run(["ويجوز بيعه إذا تعطلت منافعه عند أحمد."], lost);
    expect(r.frame.changes.join(" ")).not.toMatch(/«عند»/);
  });
});

describe("N10-5: a question is not a ruling", () => {
  it.each(["أفيجوز بيع الوقف إذا تعطلت منافعه", "أوَيجوز بيعه إذا تعطلت منافعه", "ترى أيجوز بيعه إذا تعطلت منافعه", "يا ترى هل يجوز بيعه إذا تعطلت منافعه", "أتباع العين الموقوفة إذا خربت"])("«%s» → no ruling", (t) => {
    const r = run([t], lost);
    expect(firm(r)).toBeNull();
    expect(r.frame.status).toBe("no_result");
  });
});

describe("N10-3: another school's «وهو المذهب» is never the relied-upon view; a school not known is not relied upon", () => {
  it.each([
    ["M2", "ويجوز بيعه إذا تعطلت منافعه. وذهب الشافعية إلى أنه لا يجوز بيعه، وهو المذهب عندهم."],
    ["M5", "ويجوز بيعه إذا تعطلت منافعه. وخالف الحنفية فلم يجيزوا بيعه، وهو المذهب عندهم."],
    ["M12", "ويجوز بيعه إذا تعطلت منافعه. وأما المالكية فقالوا: لا يجوز بيعه، وهو المذهب عندهم."],
    ["M13", "ويجوز بيعه إذا تعطلت منافعه. ومنع منه أصحاب الشافعي وهو المذهب عندهم."],
  ])("%s: no prohibition from the other school; none of its statements relied upon", (_, text) => {
    const r = run([text], lost);
    expect(firm(r)).not.toBe("prohibit");
    for (const b of r.frame.basis.filter((x) => x.school === "other")) expect(b.reliedUpon).toBe(false);
    expect(r.frame.basis.some((b) => b.school === "other")).toBe(true);
  });
  it("«والمذهب عندنا» beside another school stays the school's; a contemporary author not naming the school is «unknown»", () => {
    const r = run(["وعند الشافعية لا يجوز بيعه. والمذهب عندنا جواز بيعه إذا تعطلت منافعه."], lost);
    expect(firm(r)).toBe("permit");
    const c = run([["contemporary_book", "الراجح جواز بيعه إذا تعطلت منافعه."]], lost);
    expect(schoolOf(c.statements[0]!)).toBe("unknown");
    expect(c.frame.basis[0]).toMatchObject({ school: "unknown", reliedUpon: false });
  });
});

describe("the frame shown to the user, and the controls", () => {
  it("plain facts keep a preliminary result; the frame lists established facts with where, what is missing, what the ruling depends on, and the texts with their attribution", () => {
    const a = run(["ولا يجوز بيعه إلا أن تتعطل منافعه."], lost);
    expect(firm(a)).toBe("permit");
    expect(a.frame).toMatchObject({ status: "preliminary", statusAr: "نتيجة أولية — تحتاج مراجعة مختص", note: FRAME_NOTE });
    expect(a.frame.established).toEqual([{ text: "تعطلت منافع العقار كليًا", where: "الوقائع المقدمة، الواقعة 1" }, { text: "لا شرط للواقف في البيع", where: "الوقائع المقدمة، الواقعة 2" }]);
    expect(a.frame.dependsOn).toEqual([expect.objectContaining({ statementId: "ق1.1", kind: "exception", status: "met", byFact: "تعطلت منافع العقار كليًا" })]);
    expect(a.frame.basis[0]).toMatchObject({ quote: "ولا يجوز بيعه إلا أن تتعطل منافعه.", nature: "نص الكتاب", book: "نص اختبار S1", school: "hanbali", reviewed: false });
    expect(firm(run(["ولا يجوز بيعه إلا أن تتعطل منافعه."], present))).toBe("prohibit");
    const granted = run([JUDGE], [...lost, F("أذنت المحكمة في البيع")]);
    expect(firm(granted)).toBe("permit");
    expect(granted.frame.basis.find((b) => b.reliedUpon)).toMatchObject({ school: "hanbali" });
  });
  it("the layer only abstains: over plain and hedged facts, it never gives a leaning the lexical reading did not, nor the opposite one", async () => {
    const { compare, weigh } = await import("../src/server/knowledge/fiqh/analyze");
    const texts = [JUDGE, "ولا يجوز بيعه إلا أن تتعطل منافعه.", "ويجوز بيعه إذا تعطلت منافعه.", "إذا تعطلت منافعه جاز بيعه على الصحيح من المذهب"];
    const factSets = [lost, present, [...lost, F("أذنت المحكمة في البيع")], [...lost, F("لم تأذن المحكمة")], [...lost, F("يُشك في صدور الإذن")]];
    for (const t of texts) for (const facts of factSets) {
      const issue = analyzeIssue(QS, facts);
      const st = extractStatements(src(), t, { question: QS, facts, idPrefix: "ق1" });
      const lexical = weigh(st, issue, compare(st, issue));
      const c = conservative(issue, st);
      if (c.weighing.status === "weighed") expect(lexical, `${t} | ${facts.map((f) => f.text).join("، ")}`).toMatchObject({ status: "weighed", leaning: c.weighing.leaning });
    }
  });
});
