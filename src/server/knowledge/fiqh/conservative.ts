/**
 * Conservative abstention (owner's decision of 2026-11-12, stage 11, «ثانياً»). A TEMPORARY, protective measure — not a
 * semantic reading and not a substitute for one. The lexical analysis (analyze.ts) misreads facts and clauses written in
 * words it does not know (independent review, findings N10-2 to N10-5). Rather than adding more words to its lists, this
 * layer refuses to rely on what it cannot read with certainty:
 *
 *  - a fact is relied upon only when it is stated plainly: a doubt, a claim, a report («قيل»، «زعم»), a request or a
 *    pending decision, a partial or reversed state («ثم»، «سُحب»), a continuing state («ما زال»، «لم يعد») is «not
 *    established» — neither affirmed nor denied — and the condition it was matched to becomes unknown;
 *  - a statement whose ruling is limited by a clause in words the analysis does not parse («عند»، «في حال»، «لو» in
 *    mid-sentence, «ما لم»، «سوى»…) or that is a question («أفيجوز»، «يا ترى هل»…) states no ruling here;
 *  - a statement that names another school («وذهب الشافعية…»، «وأما المالكية فقالوا…»، «عندهم») is that school's report:
 *    never the relied-upon view of the Hanbali school, whatever «وهو المذهب» follows it; nor is a statement whose school
 *    is not known;
 *  - when ONE fact on which the ruling turns is not established, the result is «يحتاج استكمال الوقائع», with no leaning.
 *
 * The output is a frame the user is shown: the established facts (with where they are stated), the facts not
 * established or not mentioned, the facts the ruling depends on, the texts relied upon with their author, book and
 * school, and whether the result is preliminary (always: a specialist reviews it) or needs the facts completed.
 */
import { bare, compare, evaluate, weigh } from "./analyze";
import { KIND_AR, type Comparison, type Condition, type Fact, type Issue, type Statement, type Weighing } from "./types";

export const CONSERVATIVE_VERSION = "conservative/1";

/** Words that make a fact uncertain, pending, reported, partial, reversed or continuing (bare spelling). */
const HEDGE = new RegExp(
  [
    String.raw`(?:^|\s)(?:ي|ن|ا)?شك|مشكوك|(?:^|\s)(?:زعم|يزعم|زعمت|ادعي|يدعي|ادعت|تدعي|قيل|يقال|يذكر ان|ذكر ان|نقل ان|بلغنا|سمعنا)(?:\s|$)`,
    String.raw`(?:^|\s)(?:يبدو|يظهر ان|لعل|ربما|اظن|نظن|يغلب علي الظن|يرجح ان|يحتمل|محتمل|متوقع|يتوقع|سوف)(?:\s|$)`,
    String.raw`(?:^|\s)(?:تقدم|تقدمت|قدم|قدمت|طلب|طلبت|يطلب|ننتظر|ينتظر|بانتظار|انتظار|قيد النظر|قيد الدراسه|تحت الدراسه|لم تبت|لم يبت|لم يفصل|لم تفصل)(?:\s|$)`,
    String.raw`(?:لم|لما)\s[^،.]*\sبعد(?:\s|$)|حتي الان|الي الان|(?:^|\s)(?:ما زال|ما زالت|مازال|مازالت|لا يزال|لا تزال|لم يعد|لم تعد)(?:\s|$)`,
    String.raw`(?:^|\s)(?:جزئي|جزئيا|جزئيه|بعض|نسبيا|تقريبا|غالبا|احيانا)(?:\s|$)|(?:^|\s)ثم(?:\s|$)`,
    String.raw`(?:^|\s)(?:سحب|سحبت|الغي|الغت|الغاء|ابطل|ابطلت|رفض|رفضت|برفض|اعترض|اعترضت|علق|علقت)(?:\s|$)`,
    String.raw`(?:ليس|لا)\s+(?:عندنا|لدينا|معنا)|(?:لا|لم)\s+(?:اعلم|نعلم|يعلم|ندري|ادري|نعرف|اعرف)|غير\s+(?:معروف|معلوم|واضح|مؤكد|ثابت|متحقق)`,
    String.raw`(?:^|\s)(?:اذا|لو|متي)(?:\s|$)|[؟?]`,
  ].join("|"),
);

/** Why a fact is not plain (null: plain). An «assumed» fact is never established. */
export function factHedge(f: Fact): string | null {
  if (f.status !== "established") return "واقعة مفترضة لا ثابتة";
  const m = bare(f.text).match(HEDGE);
  return m ? `في صيغتها ما يمنع الجزم بها («${m[0].trim()}»): شك أو نقل أو طلب أو انتظار أو حال متغيرة أو جزئية أو شرط` : null;
}

/** Clause words the lexical analysis does not parse as a condition or an exception (bare spelling). */
const UNREAD_CLAUSE = /(?:^|\s)(?:عند|في حال|حال|حاله|في حاله|لو|ولو|فلو|ما لم|ما دام|مادام|طالما|سوي|عدا|خلا|ما عدا|ما خلا|بشرط|شريطه|شرط ان|متي ما|كلما)(?=\s)/g;
/** Names after «عند» that attribute a view, not a condition («عند أحمد»). */
const ATTRIBUTIVE_AFTER = /^(?:احمد|الامام|اصحاب|الاصحاب|الحنابل|الشافع|الحنف|المالك|الجمهور|اهل|بعض|اكثر|المتاخرين|المتقدمين|الشيخ|ابن|القاضي|ابي|ابو)/;
/** Questions the analysis does not recognise: «أفيجوز»، «أوَيجوز»، «ترى»، «يا ترى هل» (bare spelling, after «و»/«ف»). */
const QUESTION = /^(?:[وف])?ا(?:[وف])?(?:يجوز|يصح|يلزم|يجب|تجوز|تصح|يحل|يحق|يباع|تباع|يستبدل|يملك|يشترط)(?=\s|$)|(?:^|\s)(?:يا\s+)?تري(?:\s|$)|(?:^|\s)هل(?:\s|$)|[؟?]/;
/** Another school named anywhere in the statement (bare spelling). «مالك» only as the imam, never as an owner. */
const OTHER_SCHOOL_ANY =
  /(?:^|\s)(?:و|ف)?(?:ال)?(?:شافعي|شافعيه|حنفي|حنفيه|احناف|مالكي|مالكيه|ظاهري|ظاهريه)(?=\s|$|[،.:])|اصحاب (?:الشافعي|ابي حنيفه|مالك)|(?:ابو|ابي|ابا) حنيفه|(?:الامام|قال|مذهب|عند|قول) مالك(?=\s|$|[،.:])|(?:^|\s)عندهم(?=\s|$|[،.:])|(?:^|\s)(?:الثوري|الاوزاعي|داود الظاهري|ابن حزم)(?=\s|$|[،.:])/;
const HANBALI_NAMED = /عند (?:ال)?حنابل[هة]|عند اصحابنا|عندنا|مذهب احمد|المذهب الحنبلي|عند الامام احمد|الحنابله/;

const NEGATED = /(?:^|\s)(?:لا|لم|لن|ليس|ليست|غير|عدم|بلا|بدون|دون|ما)(?:\s|$)/;
const stem = (w: string) => w.replace(/^(?:و|ف|ب|ل)?(?:ال)?/, "").replace(/(?:ها|هم|ه|ات|ين|ون)$/, "");
const wordsOf = (t: string) => bare(t).split(/[^ء-ي]+/).map(stem).filter((w) => w.length >= 3);
/** Whether two phrases share a word (by its first letters, prefixes and suffixes aside). */
function sharesWord(a: string, b: string): boolean {
  const wb = wordsOf(b);
  return wordsOf(a).some((x) => wb.some((y) => x.slice(0, 4) === y.slice(0, 4) || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x)))));
}

export type School = "hanbali" | "other" | "unknown";

/** The school a statement speaks for, as far as its words and its book show it. */
export function schoolOf(s: Statement): School {
  const t = bare(s.text);
  if (s.otherSchool || OTHER_SCHOOL_ANY.test(t)) return HANBALI_NAMED.test(t) && !OTHER_SCHOOL_ANY.test(t.replace(HANBALI_NAMED, "")) ? "hanbali" : "other";
  // the school's books (the knowledge base holds the Hanbali books under «classical_fiqh»); a contemporary author's
  // words are the author's: the school only when they name it
  if (s.source.refKind === "classical_fiqh") return "hanbali";
  if (s.source.refKind === "contemporary_book" && HANBALI_NAMED.test(t)) return "hanbali";
  return "unknown";
}

export type FrameFact = { text: string; where: string };
export type FrameGap = { text: string; why: string };
export type FrameDependency = { statementId: string; condition: string; kind: Condition["kind"]; status: "met" | "unmet" | "unknown"; byFact?: string };
export type FrameBasis = {
  statementId: string; quote: string; nature: string; attributedTo: string | null; book: string; author: string | null; locator: string;
  school: School; schoolAr: string; reliedUpon: boolean; reviewed: boolean; note?: string;
};
export type FactsFrame = {
  version: string;
  /**
   * «needs_facts»: a fact the ruling turns on is not established — no recommendation; «no_result»: the texts give no
   * ruling on these facts (unclear, contrary, none) — no recommendation; «preliminary»: a leaning, always preliminary.
   */
  status: "needs_facts" | "no_result" | "preliminary";
  statusAr: string;
  established: FrameFact[];
  notEstablished: FrameGap[];
  dependsOn: FrameDependency[];
  basis: FrameBasis[];
  /** What the layer changed in the lexical reading, so that the reviewer sees it. */
  changes: string[];
  note: string;
};

const SCHOOL_AR: Record<School, string> = { hanbali: "المذهب الحنبلي (كتب المذهب)", other: "مذهب آخر — لا يُعتمد", unknown: "مذهب قائله غير معروف من النص — لا يُعتمد" };
export const FRAME_NOTE =
  "معالجة تحفظية مؤقتة: لا تحل محل فهم دلالي للنصوص والوقائع. ما لم يُصرَّح به في الوقائع يُعامل غير ثابت، والنتيجة في كل حال أولية تحتاج مراجعة مختص شرعي، ولا تُعد فتوى ولا حكمًا.";

export const STATUS_AR: Record<FactsFrame["status"], string> = {
  needs_facts: "يحتاج استكمال الوقائع",
  no_result: "لا يُستخلص حكم من النصوص على هذه الوقائع — يحتاج مراجعة مختص",
  preliminary: "نتيجة أولية — تحتاج مراجعة مختص",
};

type Result = { statements: Statement[]; comparison: Comparison; weighing: Weighing; frame: FactsFrame };

/** Applies the conservative rules to a dossier's issue and statements, and gives the frame the user is shown. */
export function conservative(issue: Issue, statements: Statement[]): Result {
  const changes: string[] = [];
  const hedged = new Map(issue.facts.map((f) => [f.text, factHedge(f)] as const));
  const notPlain = (byFact?: string) => !!byFact && byFact.split("؛ ").some((t) => hedged.get(t.trim()) !== null && hedged.has(t.trim()));
  // a negated fact matched to a condition by its concept only (no word in common): the negation may bear on another
  // predicate («الانتفاع غير ممكن» is the benefits LOST, read as «not lost») — not relied upon either way (N10-2)
  const negatedParaphrase = (cond: string, byFact?: string) => !!byFact && NEGATED.test(bare(byFact)) && !sharesWord(cond, byFact);

  const out = statements.map((s0) => {
    let s: Statement = { ...s0, conditions: s0.conditions.map((c) => ({ ...c, parts: c.parts?.map((p) => ({ ...p })) })), markers: [...s0.markers] };
    const t = bare(s.text);
    // 1. a question not recognised as one
    if (s.polarity !== "unknown" && QUESTION.test(t.trim())) {
      s = { ...s, polarity: "unknown", effective: "unknown", applies: "unknown", unclear: "صيغة سؤال أو استفهام: لا يُستخرج منها حكم (معالجة تحفظية)" };
      changes.push(`${s.id}: صيغة استفهام لا حكم`);
    }
    // 2. another school named in it, or a school not known: never the relied-upon view
    const school = schoolOf(s);
    if (school === "other" && !s.otherSchool) {
      s = { ...s, otherSchool: t.match(OTHER_SCHOOL_ANY)?.[0].trim() ?? "مذهب آخر" };
      changes.push(`${s.id}: ينقل عن مذهب آخر — لا يُعتمد ولا يُرجَّح به`);
    }
    if (s.rank === "mutamad" && school !== "hanbali") {
      s = { ...s, rank: "unverified", unclear: s.unclear ?? `لفظ «المذهب» في كلام ${school === "other" ? "مذهب آخر" : "قائل لا يُعرف مذهبه"}: لا يُعد معتمدًا` };
      changes.push(`${s.id}: لا يُعد معتمدًا (${SCHOOL_AR[school]})`);
    }
    // 3. a clause in words the analysis does not read: the statement's ruling is limited by something not matched
    if (s.polarity !== "unknown" && !s.unclear) {
      for (const m of t.matchAll(UNREAD_CLAUSE)) {
        const at = (m.index ?? 0) + (m[0].startsWith(" ") ? 1 : 0);
        const word = m[0].trim();
        if (word === "عند" && ATTRIBUTIVE_AFTER.test(t.slice(at + 4))) continue;
        s = { ...s, effective: "unknown", applies: "unknown", unclear: `قيد أو استثناء بصيغة («${word}») لا يقرؤها التحليل: لا يُبنى عليه حكم في الواقعة (معالجة تحفظية)` };
        changes.push(`${s.id}: قيد بصيغة غير مقروءة («${word}»)`);
        break;
      }
    }
    // 4. a condition matched to a fact that is not plain: unknown, neither met nor unmet
    let touched = false;
    for (const c of s.conditions) {
      for (const u of c.parts?.length ? c.parts : [c]) if (u.status !== "unknown" && (notPlain(u.byFact) || negatedParaphrase(u.text, u.byFact))) { u.status = "unknown"; touched = true; }
      if (c.parts?.length) {
        const st = c.parts.map((p) => p.status);
        c.status = c.join === "or" ? (st.includes("met") ? "met" : st.includes("unknown") ? "unknown" : "unmet") : st.includes("unmet") ? "unmet" : st.includes("unknown") ? "unknown" : "met";
      } else if (c.status !== "unknown" && (notPlain(c.byFact) || negatedParaphrase(c.text, c.byFact))) { c.status = "unknown"; touched = true; }
    }
    if (touched) {
      s = { ...s, ...(s.unclear && s.effective === "unknown" ? {} : evaluate(s.polarity, s.conditions, s.exceptionStructure)) };
      changes.push(`${s.id}: قيد طُوبق بواقعة غير صريحة — صار غير معلوم`);
    }
    return s;
  });

  // a view the lexical reading set «other» only because another statement of its passage was taken for the relied-upon
  // view — which this layer has just set aside — is no longer «other» on that ground (unless its book says so itself)
  const demoted = new Set(out.filter((s, i) => statements[i]!.rank === "mutamad" && s.rank !== "mutamad").map((s) => s.source.chunkId));
  for (const chunk of demoted) {
    const same = out.filter((s) => s.source.chunkId === chunk);
    if (same.some((s) => s.rank === "mutamad")) continue;
    for (const s of same) if (s.rank === "other" && !s.schoolHoldsContrary) { s.rank = "unverified"; changes.push(`${s.id}: لم يعد «خلاف المعتمد» بعد استبعاد ما ظُن معتمدًا`); }
  }
  const comparison = compare(out, issue);
  let weighing = weigh(out, issue, comparison);
  // the relied-upon view of the school only: the weighing names none other
  if (weighing.status === "weighed") weighing = { ...weighing, mutamad: weighing.mutamad.filter((id) => schoolOf(out.find((s) => s.id === id)!) === "hanbali") };

  // the facts the ruling depends on: the conditions of the school's statements on the question
  const fiqh = out.filter((s) => (s.source.refKind === "classical_fiqh" || s.source.refKind === "contemporary_book") && !s.otherSchool && s.polarity !== "unknown");
  const dependsOn: FrameDependency[] = fiqh.flatMap((s) => s.conditions.flatMap((c) => (c.parts?.length ? c.parts : [c]).map((u) => ({ statementId: s.id, condition: u.text, kind: c.kind, status: u.status, byFact: u.byFact }))));
  const open = dependsOn.filter((d) => d.status === "unknown");
  // one fact on which the result turns, not established: no recommendation (weigh() tells which open facts change it)
  if (weighing.status === "weighed" && issue.missing.length) {
    weighing = { status: "needs_facts", reasons: ["لا يُرجَّح قبل استكمال الوقائع المؤثرة في الحكم."], unresolved: issue.missing, humanReview: weighing.humanReview, by: "engine" };
  }
  const status: FactsFrame["status"] = weighing.status === "weighed" ? "preliminary" : weighing.status === "needs_facts" ? "needs_facts" : "no_result";

  const established = issue.facts.filter((f) => !hedged.get(f.text)).map((f) => ({ text: f.text, where: `الوقائع المقدمة، الواقعة ${issue.facts.indexOf(f) + 1}` }));
  const notEstablished: FrameGap[] = [
    ...issue.facts.filter((f) => hedged.get(f.text)).map((f) => ({ text: f.text, why: hedged.get(f.text)! })),
    ...issue.factors.filter((f) => f.status === "missing").map((f) => ({ text: f.question, why: f.essential ? "لم ترد في الوقائع، والحكم يتوقف عليها" : "لم ترد في الوقائع" })),
    ...[...new Map(open.map((d) => [bare(d.condition).trim(), d])).values()].map((d) => ({ text: d.condition, why: d.byFact ? `ورد ما يتصل به («${d.byFact}») دون تصريح يثبته أو ينفيه` : "لم يرد في الوقائع ما يثبته أو ينفيه" })),
  ];
  const basis: FrameBasis[] = out.filter((s) => s.source.refKind === "classical_fiqh" || s.source.refKind === "contemporary_book").map((s) => {
    const school = schoolOf(s);
    return {
      statementId: s.id, quote: s.text, nature: KIND_AR[s.kind], attributedTo: s.attributedTo, book: s.source.title, author: s.source.author, locator: s.source.locator,
      school, schoolAr: SCHOOL_AR[school], reliedUpon: s.rank === "mutamad" && school === "hanbali", reviewed: s.source.status === "approved",
      ...(s.unclear ? { note: s.unclear } : s.element === "author" ? { note: "كلام المؤلف المعاصر، لا نص المذهب" } : {}),
    };
  });
  return {
    statements: out, comparison, weighing,
    frame: {
      version: CONSERVATIVE_VERSION, status, statusAr: STATUS_AR[status],
      established, notEstablished, dependsOn, basis, changes: [...new Set(changes)], note: FRAME_NOTE,
    },
  };
}
