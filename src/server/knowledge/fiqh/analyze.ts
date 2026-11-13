/**
 * Fiqh research — the pure part (owner's order of 2026-11-07, §3). No model, no network: every step is a reading of the
 * retrieved texts' own wording, and says which words it rests on, so that the sharia reviewer can check each one.
 *
 *  1. analyzeIssue: the matter, its head word, the facts it turns on (given / assumed / missing). No weighing while an
 *     essential fact is missing (§3.1).
 *  2. extractStatements: splits a passage at the school's wording — «وعنه» (a riwaya), «وقيل», «وجهًا», «خرّج»,
 *     «اختاره فلان», «نص عليه», «على الصحيح من المذهب» — and gives each statement its nature, its standing (only when
 *     the text states it: never from the book's fame), its ruling and its conditions and exceptions. A contemporary
 *     book's sentences are its author's explanation, summary or choice — or a quotation it attributes (§3.6).
 *  3. compare: positions, agreements, real or conditional divergences; «الميسّر» set beside the original books.
 *  4. weigh: a preliminary leaning, with its reasons, the views not taken and why, what the sources leave open, a
 *     confidence and what needs a human. The school's relied-upon view (المعتمد) and the leaning on these facts are kept
 *     apart: the latter may differ when the former's condition is not met by the facts (§3.7). When the sources do not
 *     suffice, it says so (§3.7, last paragraph) — it never makes up a weighing.
 *
 * Limits (stated in every dossier): the reading is lexical — the wording of the passages, a closed list of the school's
 * terms and of a few concepts (benefit, interest, the founder's condition, the judge's permission, a mosque). It does not
 * understand a text it has no words for; what it cannot tell, it marks «غير متحقق».
 */
import { normalizeArabic, tokenize } from "@/server/modules/ai/text";
import type { Comparison, Condition, ConditionPart, Divergence, ExceptionStructure, Fact, Factor, Issue, Polarity, Rank, RegulatoryItem, RegulatoryStanding, RegulatoryTrack, SourceRef, Statement, StatementKind, Weighing } from "./types";

/** Text without diacritics and tatweel; hamza forms as alif, alif maqsura as ya (for matching only). */
export const bare = (s: string) => s.replace(/[ً-ٰٟـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي");

// ───────────────────────── concepts the conditions and the facts are matched on ─────────────────────────

/**
 * A concept is read from its PREDICATE, not from the mention of an entity (N9-4): «إذن الحاكم» needs the permission
 * («أذن»، «إذن»، «موافقة»، «ترخيص»، «قرار»), not the word «الحاكم» or «الهيئة» — «رفعت الهيئة تقريرًا» says nothing
 * of a permission. `affirm` predicates state the concept; `deny` predicates state its contrary (the benefits disrupted).
 */
type Concept = { key: string; label: string; affirm: RegExp; deny?: RegExp };
const CONCEPTS: Concept[] = [
  { key: "benefit", label: "قيام منافع العين", affirm: /منافع[ء-ي]*(?:\s+[ء-ي]+){0,2}\s+(?:قائم|باقي|مستمر)|قيام (?:ال)?منافع|ينتفع|انتفاع|يُنتفع|منتفع/, deny: /تعطل|تتعطل|خرب|خراب|تعذر|تهدم|انهدم/ },
  { key: "maslaha", label: "المصلحة أو الحاجة", affirm: /مصلح|اصلح|حاج/ },
  // the root ش-ر-ط in its forms («شرط», «شروط», «اشترط», «يشترطه», «اشتراط») and «نص الواقف» (round 8, B5)
  { key: "waqif", label: "شرط الواقف", affirm: /ش(?:ت)?ر[وا]?ط|نص(?:ه|ها)?\s+(?:عليه\s+)?الواقف|نص الواقف/ },
  { key: "judge", label: "إذن الحاكم أو الجهة", affirm: /اذن|ياذن|تاذن|موافق|وافق|ترخيص|رخص|بقرار|قرار من|حكم (?:ال)?(?:حاكم|قاضي|محكم)|بحكم/ },
  { key: "mosque", label: "كون الموقوف مسجدًا", affirm: /مسجد/ },
  { key: "cash", label: "وجه الانتفاع بالنقود", affirm: /قرض|القرض|استثمار|مضارب|تحلي|الوزن/ },
];
// a negator, or a verb of refusal that negates its complement («رفض القاضي الإذن» is no permission)
const NEGATORS = /^(?:لم|لا|ليس|ليست|غير|بلا|بدون|عدم|دون|ما|لن|رفض|رفضت|يرفض|منع|منعت|امتنع|امتنعت|رد|ردت|سحب|سحبت|الغي|الغت)$/;
/**
 * Not knowing is not a «no» (N9-4): a clause that says the fact is unknown, unestablished or unclear — «لا نعلم هل…»،
 * «لم يتبين»، «لم يثبت لدينا»، «لا توجد لدينا معلومة»، «غير معلوم»، «مجهول»، a question inside the fact — leaves every
 * concept it mentions UNKNOWN, whatever negation it holds.
 */
const EPISTEMIC = /(?:^|\s)(?:لا|لم|ما|غير|ليس)\s+(?:لدينا\s+|عندنا\s+)?(?:ن|ي|ت|ا)?(?:علم|عرف|تبين|ثبت|تضح|تحقق|دري|تأكد|تاكد|معلوم|معروف|واضح|ثابت|مؤكد|متحقق|بين|يتبين|يتضح|يثبت)|غير\s+(?:معلوم|معروف|واضح|ثابت|مؤكد|متحقق|محدد)|مجهول|(?:لا|لم)\s+(?:توجد|يوجد|تتوفر|يتوفر|تتوافر|ترد|يرد|يذكر|تذكر|يحدد)\s+(?:لدينا\s+|عندنا\s+)?(?:اي\s+)?(?:معلوم|بيان|دليل|ما\s|علم)|لا\s+(?:معلوم|بيان)|(?:^|\s)هل\s|ربما|يحتمل|قد\s+يكون|لا\s+ندري|لا\s+يدري/;
type Stance = "affirmed" | "denied" | "unknown";
/** The clauses of a fact or condition: a stance is read per clause (one clause's «لم» does not negate another's). */
const clausesOf = (t: string) => t.split(/[،,.؛:]|\s+(?=و(?:لا|لم|ليس|لن|قد|هل|لكن)\s)|\s+(?=(?:ثم|لكن|غير ان)\s)/).map((x) => x.trim()).filter(Boolean);

/** Which concepts a phrase speaks of, and its stance on each: affirmed, denied, or unknown (not known / contradictory). */
export function stancesOf(phrase: string): Map<string, Stance> {
  const out = new Map<string, Stance>();
  for (const clause of clausesOf(bare(phrase))) {
    const epistemic = EPISTEMIC.test(clause);
    const words = clause.split(/\s+/);
    for (const c of CONCEPTS) {
      for (const [re, base] of [[c.affirm, true], [c.deny, false]] as const) {
        if (!re) continue;
        const m = clause.match(re);
        if (!m) continue;
        let st: Stance;
        if (epistemic) st = "unknown";
        else {
          // negation in scope: the negators among the three words before the predicate (and one attached «لا» in it)
          const at = clause.slice(0, m.index ?? 0).split(/\s+/).filter(Boolean).length;
          const negs = words.slice(Math.max(0, at - 3), at).filter((w) => NEGATORS.test(w)).length + (/^لا\s/.test(m[0]) ? 1 : 0);
          st = (negs % 2 === 1) !== base ? "affirmed" : "denied";
        }
        const prev = out.get(c.key);
        out.set(c.key, !prev || prev === st ? st : "unknown"); // contrary statements of one fact: not known
        break;
      }
    }
  }
  return out;
}

/** The concepts a phrase states definitely (true: affirmed, false: denied); unknown ones are left out. */
export function conceptsOf(phrase: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const [k, st] of stancesOf(phrase)) if (st !== "unknown") out.set(k, st === "affirmed");
  return out;
}
/** Every concept a phrase mentions, whatever its stance (for the questions to ask). */
export const conceptKeys = (phrase: string) => [...stancesOf(phrase).keys()];

const contentTokens = (s: string) => new Set(tokenize(s));
const overlap = (a: Set<string>, b: Set<string>) => (a.size ? [...a].filter((x) => b.has(x)).length / a.size : 0);

/** A condition against the facts: met, unmet or unknown — and by which fact (engine's matching, lexical). */
export function conditionStatus(cond: string, facts: Fact[]): { status: Condition["status"]; byFact?: string } {
  const cc = conceptsOf(cond);
  if (cc.size) {
    for (const [k, affirmed] of cc) {
      const said = facts.map((f) => ({ f, st: stancesOf(f.text).get(k) })).filter((x) => x.st);
      if (!said.length) continue;
      const definite = said.filter((x) => x.st !== "unknown");
      // only «not known» about it, or facts that contradict each other: the condition is unknown (never «unmet»)
      if (!definite.length) return { status: "unknown", byFact: said[0]!.f.text };
      if (new Set(definite.map((x) => x.st)).size > 1) return { status: "unknown", byFact: definite.map((x) => x.f.text).join("؛ ") };
      return { status: (definite[0]!.st === "affirmed") === affirmed ? "met" : "unmet", byFact: definite[0]!.f.text };
    }
    return { status: "unknown" };
  }
  const ct = contentTokens(cond);
  const negC = (bare(cond).split(/\s+/).filter((w) => NEGATORS.test(w)).length) % 2 === 1;
  for (const f of facts) {
    if (overlap(ct, contentTokens(f.text)) >= 0.5) {
      if (EPISTEMIC.test(bare(f.text))) return { status: "unknown", byFact: f.text };
      const negF = (bare(f.text).split(/\s+/).filter((w) => NEGATORS.test(w)).length) % 2 === 1;
      return { status: negC === negF ? "met" : "unmet", byFact: f.text };
    }
  }
  return { status: "unknown" };
}

// ───────────────────────── 1. the matter ─────────────────────────

type Topic = { key: string; label: string; words: RegExp; factors: { key: string; question: string; essential: boolean; concept?: string; words?: RegExp }[]; subIssues: string[] };
const TOPICS: Topic[] = [
  {
    key: "exchange", label: "بيع الوقف واستبداله ونقله", words: /استبدال|ابدال|مناقل|بيع|يباع|نقل الوقف|نقله/,
    factors: [
      { key: "benefit", question: "هل تعطلت منافع العين الموقوفة كليًا أو جزئيًا، أم هي قائمة؟", essential: true, concept: "benefit" },
      { key: "waqif", question: "هل للواقف شرط في بيع الموقوف أو استبداله أو المنع منه؟", essential: true, concept: "waqif" },
      { key: "maslaha", question: "ما المصلحة الظاهرة في الاستبدال، وما البدل المقترح؟", essential: false, concept: "maslaha" },
      { key: "mosque", question: "هل العين الموقوفة مسجد؟", essential: false, concept: "mosque" },
      { key: "judge", question: "هل صدر إذن من الحاكم أو الجهة المختصة؟", essential: false, concept: "judge" },
    ],
    subIssues: ["حكم البيع أو الاستبدال مع قيام المنافع ومع تعطلها", "الاستبدال لمجرد المصلحة", "أثر شرط الواقف", "مصرف الثمن وشراء البدل"],
  },
  {
    key: "borrowing", label: "الاستدانة على الوقف", words: /استدان|يستدين|اقتراض|يقترض|الدين على الوقف/,
    factors: [
      { key: "maslaha", question: "ما مصلحة الوقف في الاستدانة وما غرضها؟", essential: true, concept: "maslaha" },
      { key: "waqif", question: "هل للواقف شرط يمنع الاستدانة أو يقيدها؟", essential: true, concept: "waqif" },
      { key: "judge", question: "هل يُشترط إذن الحاكم أو الجهة، وهل صدر؟", essential: false, concept: "judge" },
    ],
    subIssues: ["صلاحية الناظر في الاستدانة", "اشتراط إذن الحاكم", "أثر شرط الواقف"],
  },
  {
    key: "fee", label: "أجرة الناظر", words: /اجره الناظر|اجر الناظر|اجرة|اجره|عوض الناظر/,
    factors: [
      { key: "waqif", question: "هل حدد الواقف للناظر أجرة أو نسبة؟", essential: true, concept: "waqif" },
      { key: "work", question: "ما العمل الذي يقوم به الناظر؟", essential: false, words: /عمل|يعمل|مهام/ },
    ],
    subIssues: ["أجرة الناظر مع شرط الواقف وبدونه", "قدرها عند عدم الشرط"],
  },
  {
    key: "cash", label: "وقف النقود", words: /الدراهم|دراهم|النقود|نقود|نقدي|الدنانير/,
    factors: [{ key: "cash", question: "ما وجه الانتفاع بالنقود الموقوفة: قرض، أم استثمار، أم غيره؟", essential: true, concept: "cash" }],
    subIssues: ["صحة وقف النقود", "وجه الانتفاع بها مع بقاء الأصل"],
  },
  {
    key: "spending", label: "مصارف الوقف وتغيير شرط الواقف", words: /مصرف|مصارف|تغيير شرط|صرف الريع|فاضل|فائض/,
    factors: [
      { key: "waqif", question: "ما نص شرط الواقف في المصرف؟", essential: true, concept: "waqif" },
      { key: "maslaha", question: "هل تعذر العمل بالشرط، أو صار غيره أصلح؟", essential: false, concept: "maslaha" },
    ],
    subIssues: ["تعيّن المصرف بشرط الواقف", "تغيير الشرط إلى الأصلح", "صرف الفاضل"],
  },
];

function headOf(question: string): string | null {
  const m = bare(question).match(/(?:حكم|يجوز|تجوز|يصح|تصح|يجب|يلزم)\s+(?:لل?[ء-ي]+\s+(?:ان)\s+)?([ء-ي]{3,})/);
  return m ? m[1]! : null;
}

export function analyzeIssue(question: string, facts: Fact[]): Issue {
  const q = bare(normalizeArabic(question));
  // the topic whose words come first in the question («يغير مصارف الوقف وإبداله» is about the spending, not the sale)
  const at = (t: Topic) => Math.min(...[q, bare(question)].map((x) => { const m = x.match(t.words); return m ? m.index ?? 0 : Infinity; }));
  const topic = [...TOPICS].sort((a, b) => at(a) - at(b)).find((t) => at(t) < Infinity) ?? null;
  const factorDefs = topic?.factors ?? [{ key: "waqif", question: "ما نص شرط الواقف المتعلق بالمسألة، إن وُجد؟", essential: false, concept: "waqif" }];
  const factors: Factor[] = factorDefs.map((d) => {
    // a factor is given only by a fact that states it — «لم يتبين هل تعطلت المنافع» leaves it missing (N9-4)
    const f = facts.find((x) => (d.concept ? conceptsOf(x.text).has(d.concept) : false) || (d.words ? d.words.test(bare(x.text)) && !EPISTEMIC.test(bare(x.text)) : false));
    return { key: d.key, question: d.question, essential: d.essential, status: f ? (f.status === "established" ? "given" : "assumed") : "missing", by: f?.text };
  });
  // what is asked: «يجب/يلزم» asks about obligation; «يجوز/يصح/حكم» about permission (round 8, §3.3)
  const asks: Issue["asks"] = /(?:^|\s)(?:هل\s+)?(?:يجب|يلزم|تجب|تلزم|واجب|لازم|يتعين)(?=\s|$)/.test(q) ? "obligation" : /يجوز|تجوز|يصح|تصح|حكم|يحل|يحق|هل ل|ان ي/.test(q) ? "permission" : "unknown";
  return {
    question, head: headOf(question), topic: topic?.label ?? null, subIssues: topic?.subIssues ?? [], factors, asks,
    missing: factors.filter((f) => f.essential && f.status === "missing").map((f) => f.question), facts, by: "engine",
  };
}

// ───────────────────────── 2. statements ─────────────────────────

/** Where a new statement starts in a classical text (the school's terms), and the nature that start gives it. */
const STARTERS: { re: RegExp; kind: StatementKind }[] = [
  { re: /وعنه|وعن احمد|وفي روايه|وفي رواية/, kind: "riwaya" },
  { re: /وقيل/, kind: "qila" },
  // a report of another school starts a statement of its own (N9-7)
  { re: /(?:وقال|وعند|ومذهب)\s+(?:ال)?(?:شافعي[هة]?|حنفي[هة]|مالكي[هة]|ظاهري[هة]|اب[يو] حنيف[هة]|مالك)(?![ء-ي])/, kind: "text" },
  { re: /وفي وجه|وذكره وجها|وذكر وجها/, kind: "wajh" },
  { re: /ويتخرج|وخرج|وخرّج/, kind: "takhrij" },
  { re: /ويحتمل/, kind: "ihtimal" },
  { re: /وجوز|وجوّز|واختار|وقال الشيخ|قال الشيخ|وقال شيخنا/, kind: "ikhtiyar" },
  { re: /وقال في|قال في/, kind: "naql" },
];
// the school's verdict on what precedes («والمذهب خلافه»، «وهو المذهب»): a clause of its own, joined back to the view it
// judges; «والصحيح من المذهب أنه…»، «والمذهب أنه…» starts the relied-upon view itself (independent review, round 7)
STARTERS.push({ re: /والصحيح من المذهب|والمذهب|وهو المذهب|وهو الصحيح|والصحيح خلافه|وعليه الاصحاب|وعليه اكثر الاصحاب/, kind: "text" });
const STARTER_RE = new RegExp(`(?:^|\\s)(?=${STARTERS.map((s) => s.re.source).join("|")})`, "g");
const BACK_REF = /^(?:و?اختاره|وهو المذهب|وهو الصحيح|والمذهب خلافه|والصحيح خلافه|وهو خلاف المذهب|وعليه الاصحاب|وعليه اكثر الاصحاب|وليس(?:ت)?\s+(?:هذا\s+|ذلك\s+)?(?:هو\s+)?المذهب)/;
/** The text says the view it states is NOT the school's («والمذهب خلافه»): never read as the relied-upon view. */
const NOT_MUTAMAD = /والمذهب خلافه|والصحيح خلافه|خلاف المذهب|خلاف الصحيح|والمشهور خلافه|ليس(?:ت)?\s+(?:هذا\s+|ذلك\s+|هذه\s+)?(?:هو\s+|هي\s+)?(?:المذهب|الصحيح|المعتمد)|ليس(?:ت)?\s+بالمذهب|غير المذهب|لا علي المذهب/;
/**
 * A view reported from another school (N9-7): «وقال الشافعي…»، «وعند الحنفية…»، «وهو المذهب عند الشافعية». It is a
 * report, never the Hanbali relied-upon view, and is kept out of the weighing; «خلافًا للشافعي» only names the other
 * school beside a statement that stays the book's own.
 */
const OTHER_SCHOOL = /(?:^|\s)(?:و|ف)?(?:قال|عند|مذهب|قول|وبه قال|وهو قول|وهو مذهب|والمذهب عند|وهو المذهب عند|المذهب عند)\s+(?:ال)?(?:شافعي[هة]?|حنفي[هة]|مالكي[هة]|ظاهري[هة]|اب[يو] حنيف[هة]|مالك|الثوري|الاوزاعي|داود)(?=\s|$|[،.:])/;
/** The Hanbali school named: «المذهب» then refers to it even beside another school. */
const HANBALI = /عند (?:ال)?حنابل[هة]|عند اصحابنا|مذهب احمد|المذهب الحنبلي|عند الامام احمد/;
const MUTAMAD = /الصحيح من المذهب|وهو المذهب|وهي المذهب|وهي الصحيحه|وهي الصحيحة|علي المذهب|والمذهب|وعليه الاصحاب|وعليه جماهير الاصحاب|وعليه اكثر الاصحاب|المشهور في المذهب|المذهب انه/;
const NASS = /نص عليه(?!\s+الواقف)|نص احمد|منصوص احمد|المنصوص(?!\s+عليه\s+في\s+(?:الوقف|الوثيقه|الصك))/;
/** «والمذهب الأول» / «والأول المذهب»: the relied-upon view named by its order — resolved only when unambiguous. */
const ORDINAL_REF = /والمذهب الاول|والاول هو المذهب|والاول المذهب|والصحيح الاول|والاول اصح|والاول هو الصحيح|والمذهب الثاني|والثاني هو المذهب|والثاني المذهب/;
/** A question, or an objection put to be answered («فإن قيل»): not a ruling (B4). */
const INTERROGATIVE = /[؟?]|^(?:و|ف)?(?:هل|ا(?:يجوز|يصح|يلزم|يجب|تجوز|تصح|يحل|يحق|يباع|يستبدل|يملك|يشترط))(?=\s|$)|^(?:فان|وان|ان|فلو|ولو)\s+(?:قيل|قلت|قال قائل|سال سائل)(?![ء-ي])/;

/** A sentence that lays down a rule (a regulation's or guide's), and the general disposition of the endowed property. */
const NORMATIVE = /يجب|يلتزم|يلزم|لا يجوز|لا يحق|يحظر|يمنع|يشترط|بموافقه|بعد موافقه|الا بموافقه|بقرار|يعاقب|غرامه|مخالفه|يراعي|ينبغي/;
const GENERAL_DISPOSITION = /التصرف|تصرف|التصرفات/;
const WAQF_PROPERTY = /الوقف|موقوف|الاعيان|الاصول|العين/;

const CONTRARY: [Polarity, Polarity][] = [["permit", "prohibit"], ["oblige", "not_obliged"], ["oblige", "prohibit"]];
/** Two polarities that cannot both hold of one act («يجوز» and «لا يجوز»), unlike «يجوز ولا يجب». */
export const contrary = (a: Polarity, b: Polarity) => CONTRARY.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
/** All the rulings a clause states, in order. */
export function polaritiesIn(t: string): { p: Polarity; i: number; m: string }[] {
  const tests: [Polarity, RegExp][] = [
    ["not_obliged", /(?:لا|لم|ليس)\s+(?:يجب|يلزم|يلزمه|يتعين|بواجب|بلازم)|عدم (?:ال)?وجوب|عدم (?:ال)?لزوم/g],
    ["prohibit", /(?:لم|لا)\s+(?:يصح|يجز|يجوز|تجوز|تصح|يستبدل|يبيع|يباع|يحل|يحق)|عدم (?:ال)?جواز|عدم (?:ال)?صح|يحرم|ليس له|ليس لل[ء-ي]+|ليس من حق|يمنع|لا يملك/g],
    ["oblige", /يجب|يلزم|وجب|يتعين|فتعين|تعين/g],
    ["permit", /لا باس|يصح|يجوز|جاز|جوز|تجوز|صح |فله|وله |للناظر|يحق|لم يكن جواز هذا بعيدا|جواز|الجواز|صحه|صحة/g],
  ];
  const all = tests.flatMap(([p, re]) => [...t.matchAll(re)].map((m) => ({ p, i: m.index ?? 0, m: m[0], end: (m.index ?? 0) + m[0].length })));
  // overlapping matches are one ruling: the earliest (and, at the same start, the longest) — «لا تصح» holds «صح »
  all.sort((a, b) => a.i - b.i || b.end - a.end);
  const kept: typeof all = [];
  for (const a of all) if (!kept.some((b) => a.i < b.end && b.i < a.end)) kept.push(a);
  // «للناظر», «فله», «وله» say whose the act is more than they rule on it: not counted against an explicit ruling
  return kept.filter((a) => !/^(?:للناظر|فله|وله )$/.test(a.m));
}

function polarityOf(t: string): { polarity: Polarity; marker: string | null } {
  const tests: [Polarity, RegExp][] = [
    ["not_obliged", /(?:لا|لم|ليس)\s+(?:يجب|يلزم|يلزمه|يتعين|بواجب|بلازم)|عدم (?:ال)?وجوب|عدم (?:ال)?لزوم/],
    ["prohibit", /(?:لم|لا)\s+(?:يصح|يجز|يجوز|تجوز|تصح|يستبدل|يبيع|يباع|يحل|يحق)|عدم (?:ال)?جواز|عدم (?:ال)?صح|يحرم|ليس له|ليس لل[ء-ي]+|ليس من حق|يمنع|لا يملك/],
    ["oblige", /يجب|يلزم|وجب|يتعين|فتعين|تعين/],
    ["permit", /لا باس|يصح|يجوز|جاز|جوز|تجوز|صح |فله|وله |للناظر|يحق|لم يكن جواز هذا بعيدا|جواز|الجواز|صحه|صحة/],
  ];
  const found = tests.map(([p, re]) => ({ p, m: t.match(re) })).filter((x) => x.m).sort((a, b) => (a.m!.index ?? 0) - (b.m!.index ?? 0));
  return found.length ? { polarity: found[0]!.p, marker: found[0]!.m![0] } : { polarity: "unknown", marker: null };
}

const RULING_CUT = /\s(?=(?:ف?لم|ف?لا)\s+(?:يصح|يجز|يجوز|تجوز|تصح|يستبدل|يبيع|يباع)|ف?(?:جاز|يجوز|يصح|صح|يحرم|يجب|وجب|يلزم|فله|فيباع)(?:\s|$)|علي الصحيح|على الصحيح)/;
type RawCondition = { text: string; kind: Condition["kind"]; at: number; end: number };
function conditionsIn(t: string): RawCondition[] {
  const out: RawCondition[] = [];
  // a fragment ends on a whole word (a cut «غيره» must not read as the negation «غير»)
  const whole = (m: RegExpMatchArray) => {
    let end = (m.index ?? 0) + m[0].length;
    while (end < t.length && /[ء-ي]/.test(t[end]!)) end++;
    // the condition ends where the ruling begins («إذا كانت منافعه قائمة | لم يجز بيعه»)
    return t.slice(m.index ?? 0, end).replace(/^[\s(]+/, "").split(RULING_CUT)[0]!.split(/\s(?=(?:او\s+)?(?:الا|والا|و(?:لا|لم|ليس|لن))\s)/)[0]!.trim();
  };
  const push = (m: RegExpMatchArray, kind: Condition["kind"]) => { const text = whole(m); out.push({ text, kind, at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }); };
  // «إلا إذا X» is an exception, not also a condition (B5)
  // a span stops before another «إلا», an «وإلا» (otherwise), or a new negated clause («… ولا يجوز هبته») — N9-5
  const SPAN = String.raw`((?:(?!\s(?:او\s+)?(?:الا|والا|و(?:لا|لم|ليس|لن))\s)[^،.؛:\n()…]){3,60})`;
  for (const m of t.matchAll(new RegExp(String.raw`(?:^|[\s(])(?:فان لم|وان لم|ان لم|اذا لم|فاذا|واذا|اذا|بشرط|حيث|متى)\s+` + SPAN, "g"))) if (!/الا\s*$/.test(t.slice(0, m.index ?? 0))) push(m, "condition");
  for (const m of t.matchAll(new RegExp(String.raw`(?:^|[\s(])و?الا\s+(?!ف)(?:ان\s+|اذا\s+)?` + SPAN, "g"))) push(m, "exception");
  for (const m of t.matchAll(/(?:لمصلح[هة]|للمصلح[هة]|مع الحاج[هة]|بلا حاج[هة]|لظهور المصلح[هة])/g)) push(m, "condition");
  return out;
}

/** A clause's conjuncts: «A أو B» (any), «A ويفعل B» (all: «و» before a verb starts a second requirement). */
function partsOf(text: string): { parts: string[]; join?: "and" | "or" } {
  const or = text.split(/\s+او\s+/).filter((x) => x.trim().length > 2);
  if (or.length > 1) return { parts: or, join: "or" };
  const and = text.split(/\s+(?=و(?:ي|ت|ن|ا)[ء-ي]{2,}\s)/).map((x) => x.replace(/^و/, "")).filter((x) => x.trim().length > 2);
  // only when each conjunct speaks of something the facts can answer («ويكون»/«وان» alone do not make a second one)
  if (and.length > 1 && and.every((x) => conceptKeys(x).length)) return { parts: and, join: "and" };
  return { parts: [text] };
}

/** A condition with its parts, against the facts. */
export function condition(text: string, kind: Condition["kind"], facts: Fact[], at?: number): Condition {
  const { parts, join } = partsOf(text);
  if (!join) return { text, kind, at, ...conditionStatus(text, facts) };
  const ps: ConditionPart[] = parts.map((x) => ({ text: x.trim(), ...conditionStatus(x, facts) }));
  return { text, kind, at, parts: ps, join, status: combine(ps.map((x) => x.status), join), byFact: ps.map((x) => x.byFact).filter(Boolean).join("؛ ") || undefined };
}
const combine = (st: Condition["status"][], join: "and" | "or"): Condition["status"] =>
  join === "and" ? (st.every((x) => x === "met") ? "met" : st.some((x) => x === "unmet") ? "unmet" : "unknown")
    : st.some((x) => x === "met") ? "met" : st.every((x) => x === "unmet") ? "unmet" : "unknown";

/** How the exceptions combine, from the words between them only (never assumed). */
export function exceptionStructure(t: string, exceptions: { at?: number; text: string; join?: "and" | "or" }[]): ExceptionStructure {
  if (!exceptions.length) return "none";
  // one «إلا» clause of several parts: «إلا أن A وB» cumulative, «إلا أن A أو B» alternative (the parts carry it)
  if (exceptions.length === 1) {
    const j = (exceptions[0] as { join?: "and" | "or" }).join;
    return j === "and" ? "cumulative" : j === "or" ? "alternative" : "single";
  }
  const joins = exceptions.slice(1).map((e, k) => t.slice((exceptions[k]!.at ?? 0) + exceptions[k]!.text.length, e.at ?? 0));
  if (joins.every((j) => /(?:^|\s)او\s*$/.test(j.trim() ? ` ${j.trim()}` : ""))) return "alternative";
  // «إلا أن A وإلا أن B»: «و» between two «إلا» may join alternatives or requirements — the text does not say (N9-5)
  return "unclear";
}

/** «لا … إلا أن …»: the ruling an exception gives — the contrary of the stated one. */
export const reverse = (p: Polarity): Polarity => ({ prohibit: "permit", permit: "prohibit", not_obliged: "oblige", oblige: "not_obliged" } as Record<string, Polarity>)[p] ?? p;

/** What a statement gives on the facts, from its ruling, conditions and the structure of its exceptions. */
export function evaluate(polarity: Polarity, conds: Condition[], structure: ExceptionStructure): Pick<Statement, "applies" | "effective"> {
  const c = conds.filter((x) => x.kind === "condition");
  const ex = conds.filter((x) => x.kind === "exception");
  if (c.some((x) => x.status === "unmet")) return { applies: "does_not_apply", effective: polarity };
  if (structure === "unclear") return { applies: "unknown", effective: "unknown" };
  const exStatus: Condition["status"] | null = !ex.length ? null
    : structure === "alternative" ? combine(ex.map((x) => x.status), "or")
      : structure === "cumulative" ? combine(ex.map((x) => x.status), "and") : ex[0]!.status;
  const open = c.some((x) => x.status === "unknown") || exStatus === "unknown";
  return { applies: open ? "unknown" : "applies", effective: exStatus === "met" ? reverse(polarity) : polarity };
}

function attributionOf(t: string, kind: StatementKind): string | null {
  // the names as the text writes them (no name is supplied that the text does not hold); a riwaya is the imam's, and a
  // scholar named after «اختاره» only chose it
  if (kind === "riwaya" || kind === "nass") return riwayaOrNass(t, kind);
  const name = t.match(/(?:اختاره|واختار|اختار|وجوز|جوز|وقال|قال|وذكره|ذكره)\s+(الشيخ\s+تقي\s+الدين|شيخنا(?:\s+يعني\s+به\s+الشيخ\s+تقي\s+الدين)?|ابن\s+[ء-ي]+|ابو\s+[ء-ي]+|القاضي|الموفق|المجد|صاحب\s+[ء-ي]+|الشيخ)/);
  if (name) return name[1]!.trim() === "الشيخ" ? "«الشيخ» (لم يُسمَّ في النص)" : name[1]!.trim();
  if (kind === "naql") {
    const book = t.match(/قال في\s+([ء-ي]+)/);
    if (book) return `كتاب «${book[1]}»`;
  }
  return null;
}
function riwayaOrNass(t: string, kind: "riwaya" | "nass"): string {
  if (kind === "nass") return "الإمام أحمد (منصوص)";
  {
    const chose = t.match(/(?:اختاره|اختارها|واختاره)\s+(الشيخ\s+تقي\s+الدين|شيخنا(?:\s+يعني\s+به\s+الشيخ\s+تقي\s+الدين)?|ابن\s+[ء-ي]+|القاضي|الموفق|المجد)/);
    return chose ? `الإمام أحمد (رواية) — اختارها ${chose[1]}` : "الإمام أحمد (رواية)";
  }
}

const CONTEMPORARY_CHOICE = /الراجح|الارجح|الاظهر|الذي يظهر|الاقرب|يترجح|نرى|والصواب/;
const CONTEMPORARY_SUMMARY = /الخلاص|خلاصه|الحاصل|باختصار|اجمالا/;
const CONTEMPORARY_QUOTE = /قال في|قال ابن|قال الشيخ|جاء في|نص الفقهاء|«|"/;
const SCHOOL_ATTRIBUTION = /المذهب|الحنابل|عند احمد|الامام احمد|الجمهور|اتفق|المالكيه|الحنفيه|الشافعيه/;

/** Statements of one passage. A long page (a contemporary book) is cut into sentences; only those on the matter stay. */
export function extractStatements(source: SourceRef, text: string, ctx: { question: string; facts: Fact[]; idPrefix: string }): Statement[] {
  const contemporary = source.refKind === "contemporary_book";
  const body = text.replace(/^\[[^\]]{2,80}\]\s*/, ""); // the topic tag of a verified quote is the specialist's, not the book's
  const qTokens = contentTokens(ctx.question);
  let pieces: string[];
  const sentences = contemporary || source.refKind !== "classical_fiqh" || body.length > 900;
  if (sentences) {
    pieces = body.split(/(?<=[.؛!؟])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 25);
    // a regulation or guidance passage was retrieved as relevant: its NORMATIVE sentences about the matter are kept
    // even in other words than the question's (N9-8) — the act asked about, or a disposition of the endowed property
    // in general («التصرف في العين الموقوفة» covers the sale) — never its other sentences
    const regulatory = source.refKind !== "classical_fiqh" && !contemporary;
    const act = TOPICS.find((tp) => tp.words.test(bare(ctx.question)))?.words;
    pieces = pieces.filter((x) => overlap(qTokens, contentTokens(x)) >= 0.34 || [...qTokens].some((w) => w.length > 3 && contentTokens(x).has(w) && /حكم|يجوز|يصح|لا/.test(bare(x)))
      || (regulatory && NORMATIVE.test(bare(x)) && ((act?.test(bare(x)) ?? false) || (GENERAL_DISPOSITION.test(bare(x)) && WAQF_PROPERTY.test(bare(x))))));
  } else {
    const b = bare(body);
    const cuts = [0, ...[...b.matchAll(STARTER_RE)].map((m) => (m.index ?? 0) + (m[0].startsWith(" ") ? 1 : 0)).filter((i) => i > 0), b.length];
    // positions in the bare text map onto the original by counting the letters kept (diacritics are dropped by bare())
    const map: number[] = [];
    for (let i = 0; i < body.length; i++) if (!/[ً-ٰٟـ]/.test(body[i]!)) map.push(i);
    map.push(body.length);
    pieces = [];
    for (let k = 0; k < cuts.length - 1; k++) pieces.push(body.slice(map[cuts[k]!], map[cuts[k + 1]!]).trim());
    pieces = pieces.filter((x) => x.length > 2);
    // a clause that only names its source («وقال في الفائق») reports the clause after it: they are one statement
    const merged: string[] = [];
    for (let k = 0; k < pieces.length; k++) {
      if (/^و?قال في\s+[ء-ي]+\s*$/.test(bare(pieces[k]!).trim()) && k + 1 < pieces.length) { pieces[k + 1] = `${pieces[k]} ${pieces[k + 1]}`; continue; }
      merged.push(pieces[k]!);
    }
    // «واختاره فلان», «وهو المذهب», «والمذهب خلافه» refer back: they judge the statement before them
    const joined: string[] = [];
    for (const x of merged) {
      if (joined.length && BACK_REF.test(bare(x))) joined[joined.length - 1] = `${joined[joined.length - 1]} ${x}`;
      else joined.push(x);
    }
    // a condition or exception governs its own sentence: a passage of two sentences that each state a ruling is two
    // statements («فإن لم تتعطل منافعه لم يجز بيعه. نص عليه…: لا يبيعه إلا أن يكون بحال لا ينتفع به»)
    // — only where a sentence carries its own condition or exception: a bare ruling («ولا يباع فيحرم بيعه.») stays with
    // what follows, since an exception after it may govern it («… ولا يصح … إلا أن تتعطل منافعه»)
    pieces = joined.flatMap((x) => {
      const ss = x.split(/(?<=[.؛])\s+/).filter((y) => y.trim().length > 8);
      if (ss.length < 2) return [x];
      const out: string[] = [];
      let cur = "";
      for (const y of ss) {
        cur = cur ? `${cur} ${y}` : y;
        const b = bare(cur);
        if (polaritiesIn(b).length && conditionsIn(b).length) { out.push(cur); cur = ""; }
      }
      if (cur) out.push(cur);
      return out.length > 1 && out.every((y) => polaritiesIn(bare(y)).length) ? out : [x];
    }).filter((x) => x.length > 8);
  }
  const statements: Statement[] = pieces.map((piece, i) => {
    // «إن» written with its hamza below is the conditional (unlike «أن»); a «لو» opening the statement states a
    // condition («ولو تعطلت منافعه جاز»), while «ولو» after the ruling concedes («لا يجوز ولو تعطلت») and is no condition
    const t = bare(piece.replace(/(^|[\s(])([وف]?)إ[ِ]?ن(?=\s)(?!\s+(?:قيل|قلت|قال|سأل|سال)(?![ء-ي]))/g, "$1$2اذا").replace(/^([وف]?)لو(?=\s)(?!\s+(?:قيل|قلت|قال)(?![ء-ي]))/, "$1اذا"));
    const markers: string[] = [];
    let kind: StatementKind;
    if (sentences && source.refKind !== "classical_fiqh" && !contemporary) {
      kind = "text"; // official guidance: its own words, by its nature (labelled with the source's kind)
    } else if (contemporary) {
      kind = CONTEMPORARY_QUOTE.test(t) ? "naql" : CONTEMPORARY_CHOICE.test(t) ? "author_choice" : CONTEMPORARY_SUMMARY.test(t) ? "author_summary" : "author_explanation";
      const m = t.match(CONTEMPORARY_QUOTE) ?? t.match(CONTEMPORARY_CHOICE) ?? t.match(CONTEMPORARY_SUMMARY);
      if (m) markers.push(m[0]);
    } else {
      // «وقال في الفائق وعنه يصح…»: a report of a riwaya by a named book — its nature is the riwaya, its channel the book
      const inner = /^و?قال في\s+[ء-ي]+\s+/.test(t) ? t.replace(/^و?قال في\s+[ء-ي]+\s+/, "") : null;
      const st = STARTERS.find((s) => s.re.test((inner ?? t).slice(0, 24)) && !(inner && s.kind === "naql")) ?? (inner ? STARTERS.find((s) => s.kind === "naql") : undefined);
      kind = st?.kind ?? (NASS.test(t) ? "nass" : "text");
      const m = st ? t.slice(0, 24).match(st.re) : t.match(NASS);
      if (m) markers.push(m[0]);
      if (/وجها|وجهان|الوجه/.test(t) && kind !== "riwaya") { kind = kind === "ikhtiyar" ? kind : "wajh"; markers.push(t.match(/وجها|وجهان|الوجه/)![0]); }
      if (/اختاره|واختار/.test(t) && kind === "text") { kind = "ikhtiyar"; markers.push(t.match(/اختاره|واختار/)![0]); }
    }
    let rank: Rank = "unverified";
    let unclear: string | undefined;
    const ordinal = !contemporary ? t.match(ORDINAL_REF) : null;
    const notMutamad = !contemporary && NOT_MUTAMAD.test(t);
    const otherSchool = !contemporary ? t.match(OTHER_SCHOOL)?.[0].trim() : undefined;
    if (otherSchool) { markers.push(otherSchool); unclear = undefined; }
    if (otherSchool) { /* a report of another school: never ranked in this school (N9-7) */ }
    else if (notMutamad) { rank = "other"; markers.push(t.match(NOT_MUTAMAD)![0]); }
    else if (ordinal) markers.push(ordinal[0]); // resolved below, against the views before it
    else if (!contemporary && MUTAMAD.test(t)) {
      // a possibility or a derivation («ويحتمل…»، «ويتخرج… على المذهب») is never the relied-upon view: «على المذهب»
      // there says what it is derived from (round 9, M3)
      if (kind === "ihtimal" || kind === "takhrij") { /* not ranked */ }
      // a view introduced by «قيل» is never the relied-upon view on the strength of a word in it (§3.4)
      else if (kind === "qila") { unclear = "قول مصدَّر بـ«قيل» وفيه لفظ المذهب: لا يُعدّ معتمدًا، ويقرر المراجع مرجع اللفظ"; markers.push(t.match(MUTAMAD)![0]); }
      else { rank = "mutamad"; markers.push(t.match(MUTAMAD)![0]); }
    }
    const raw = conditionsIn(t);
    // the ruling is read outside the condition and exception clauses («لا يجوز إلا أن … فيجوز» states one ruling)
    let main = t;
    for (const c of raw) {
      const i = t.indexOf(c.text, c.at);
      if (i >= 0) main = main.slice(0, i) + " ".repeat(c.text.length) + main.slice(i + c.text.length);
    }
    const rulings = polaritiesIn(main);
    let pol = polarityOf(t);
    if (INTERROGATIVE.test(t.trim())) { pol = { polarity: "unknown", marker: null }; unclear = "سؤال أو اعتراض يُجاب عنه، لا حكم"; }
    else if (rulings.some((a) => rulings.some((b) => contrary(a.p, b.p)))) { pol = { polarity: "unknown", marker: null }; unclear = `حكمان متقابلان في جملة واحدة («${rulings.map((r) => r.m).join("»، «")}»): التركيب غير واضح`; }
    if (pol.marker) markers.push(pol.marker);
    const conds: Condition[] = raw.map((c) => condition(c.text, c.kind, ctx.facts, c.at));
    const structure = exceptionStructure(t, conds.filter((c) => c.kind === "exception"));
    if (structure === "unclear" && !unclear) unclear = "أكثر من استثناء لا يبين النص أهي بدائل أم مجتمعة أم متداخلة";
    const ev = evaluate(pol.polarity, conds, structure);
    const via = !contemporary ? t.match(/^و?قال في\s+([ء-ي]+)/)?.[1] : undefined;
    return {
      id: `${ctx.idPrefix}.${i + 1}`, kind, rank, text: piece, element: contemporary && kind !== "naql" ? "author" : "quote",
      attributedTo: via && kind !== "naql" ? `${attributionOf(t.replace(/^و?قال في\s+[ء-ي]+\s+/, ""), kind) ?? "غير مسمى"} — بنقل كتاب «${via}»` : attributionOf(t, kind), polarity: pol.polarity, conditions: conds, applies: ev.applies, effective: ev.effective,
      exceptionStructure: structure, ...(unclear ? { unclear } : {}), ...(notMutamad && !otherSchool ? { schoolHoldsContrary: true } : {}), ...(otherSchool ? { otherSchool } : {}),
      source, markers: [...new Set(markers)],
    };
  });
  // «والمذهب الأول»: the first of the views before it — only when the views before it are exactly the two it orders
  // (a verdict on its own) or the one it is set against (a view that states its own ruling). Otherwise its referent is
  // not certain from the passage, and no view is made the relied-upon one (§3.4)
  statements.forEach((s, k) => {
    const o = !contemporary ? bare(s.text).match(ORDINAL_REF) : null;
    if (!o) return;
    const second = /الثاني/.test(o[0]);
    const before = statements.slice(0, k).filter((x) => x.polarity !== "unknown");
    const views = s.polarity === "unknown" ? before : [...before, s];
    if (views.length === 2 && !(s.polarity === "unknown" && before.length !== 2)) {
      const [first, other] = second ? [views[1]!, views[0]!] : [views[0]!, views[1]!];
      first.rank = "mutamad"; first.markers.push(o[0]);
      other.rank = "other";
    } else s.unclear = `«${o[0]}» لا يتعين مرجعه في المقطع (${views.length} من الأقوال قبله): لا يُعيَّن المعتمد`;
  });
  // a passage that names the relied-upon view makes the riwayat and «qila» views beside it the other views
  // a passage that reports another school's view: an unqualified «المذهب» in it does not say whose school it means —
  // unless the Hanbali school is named — so no view is made the relied-upon one on its strength (N9-7)
  if (!contemporary && statements.some((x) => x.otherSchool))
    for (const x of statements) if (x.rank === "mutamad" && !x.otherSchool && !HANBALI.test(bare(x.text))) {
      x.rank = "unverified";
      x.unclear = "«المذهب» في مقطع ينقل عن أكثر من مذهب ولا يسمي المذهب الحنبلي: لا يتعين أي مذهب يعني";
    }
  const mut = statements.filter((s) => s.rank === "mutamad");
  if (mut.length) for (const s of statements) {
    if (s.rank !== "unverified") continue;
    // the passage names the relied-upon view: the riwayat and «qila» views beside it, and any statement of it with a
    // contrary ruling, are the other views (as the passage itself presents them)
    if (["riwaya", "qila", "wajh", "takhrij", "ihtimal"].includes(s.kind) || (s.polarity !== "unknown" && mut.every((m) => m.polarity !== "unknown" && m.polarity !== s.polarity))) s.rank = "other";
  }
  return statements;
}

// ───────────────────────── 3. comparison ─────────────────────────

export function compare(statements: Statement[], issue: Issue): Comparison {
  // the fiqh track only: a regulation or a guide is never counted in agreement or divergence with the school's books (§4)
  const known = statements.filter((s) => s.effective !== "unknown" && FIQH_TRACK.has(s.source.refKind) && !s.otherSchool);
  const positions = (["permit", "prohibit", "oblige", "not_obliged"] as Polarity[]).map((p) => {
    const ss = known.filter((s) => s.effective === p);
    return { polarity: p, statementIds: ss.map((s) => s.id), refCodes: [...new Set(ss.map((s) => s.source.refCode))] };
  }).filter((x) => x.statementIds.length);
  const agreements: string[] = [];
  const divergences: Divergence[] = [];
  for (let i = 0; i < known.length; i++) for (let j = i + 1; j < known.length; j++) {
    const a = known[i]!, b = known[j]!;
    if (a.source.refCode === b.source.refCode && a.source.chunkId === b.source.chunkId && a.effective === b.effective) continue;
    if (a.effective === b.effective) { if (a.source.refCode !== b.source.refCode) agreements.push(`${a.id} و${b.id}: ${a.source.title} و${b.source.title} على ${a.effective}`); continue; }
    // «يجوز» and «لا يجب» do not contradict each other: no divergence is made of them (round 8, §3.3)
    if (!contrary(a.effective, b.effective)) continue;
    const both = a.applies !== "does_not_apply" && b.applies !== "does_not_apply";
    const sameConds = JSON.stringify([...new Set(a.conditions.flatMap((c) => conceptKeys(c.text)))].sort()) === JSON.stringify([...new Set(b.conditions.flatMap((c) => conceptKeys(c.text)))].sort());
    const nature: Divergence["nature"] = both && sameConds ? "real" : !both || !sameConds ? "in_condition" : "unverified";
    divergences.push({
      a: a.id, b: b.id, nature,
      note: nature === "real" ? "خلاف في الحكم مع انطباق القولين على الواقعة بحسب المطابقة الآلية" : "اختلاف مناط: القيود أو الاستثناءات مختلفة، أو أحد القولين لا ينطبق على الواقعة",
    });
  }
  const classical = known.filter((s) => s.source.refKind === "classical_fiqh");
  const contemporaryChecks = statements.filter((s) => s.source.refKind === "contemporary_book").map((s) => {
    if (SCHOOL_ATTRIBUTION.test(bare(s.text))) return { statementId: s.id, outcome: "attributes_school" as const, note: "ينسب المؤلف القول إلى المذهب أو إلى جماعة: لا يُعتمد إلا بالرجوع إلى المصدر الأصلي" };
    if (!classical.length || s.effective === "unknown") return { statementId: s.id, outcome: "no_original" as const, note: "لا نص أصلي في المصادر المسترجعة يقابله؛ يبقى شرحًا للمؤلف" };
    const same = classical.some((c) => c.effective === s.effective);
    return same
      ? { statementId: s.id, outcome: "agrees" as const, note: "يوافق ما في الكتب الأصلية المسترجعة" }
      : { statementId: s.id, outcome: "differs" as const, note: "يخالف ما في الكتب الأصلية المسترجعة: يُتحقق منه" };
  });
  const w = issue.factors.find((f) => f.key === "waqif");
  const waqifCondition = !w
    ? "لم يُحدَّد أثر لشرط الواقف في هذه المسألة."
    : w.status === "missing"
      ? "شرط الواقف غير معروف من الوقائع المقدمة؛ والنتيجة قد تتغير به — يُطلب نص وثيقة الوقف."
      : `قُدّم في الوقائع ما يتعلق بشرط الواقف («${w.by}»)؛ يُراعى مقدَّمًا على ما يخالفه من الأقوال ما لم يكن مخالفًا للشرع، ويقرره المراجع.`;
  return { positions, agreements, divergences, contemporaryChecks, waqifCondition, by: "engine" };
}

// ───────────────────────── 4. preliminary weighing ─────────────────────────

/** The fiqh track: the school's books and contemporary books. Guidance and regulations are the regulatory track (§4). */
export const FIQH_TRACK = new Set(["classical_fiqh", "contemporary_book"]);
const DIMENSION: Record<Issue["asks"], Set<Polarity> | null> = { obligation: new Set(["oblige", "not_obliged"]), permission: new Set(["permit", "prohibit"]), unknown: null };

/**
 * The preliminary weighing, on the fiqh track only, robust to what the facts leave open (owner's order 2026-11-08, §3.1):
 * every condition the facts do not settle is tried both ways; when the result changes with it, the result depends on
 * that fact and is not given — «تتوقف النتيجة على استكمال هذه الواقعة» — with the fact and the question that supplies it.
 * A missing fact is never evidence against a view, and a relied-upon view is never set aside because its condition is
 * unknown.
 */
export function weigh(all: Statement[], issue: Issue, cmp: Comparison): Weighing {
  // the fiqh track, of this school: a report of another school is shown, never weighed as this school's (N9-7)
  const statements = all.filter((s) => FIQH_TRACK.has(s.source.refKind) && !s.otherSchool);
  // the conditions the facts leave open, by their wording (the same words are the same fact)
  const open = new Map<string, { text: string; concept: string | null }>();
  for (const s of statements) for (const c of s.conditions) {
    for (const u of c.parts?.length ? c.parts : [c]) if (u.status === "unknown") open.set(bare(u.text).trim(), { text: u.text, concept: conceptKeys(u.text)[0] ?? null });
  }
  const base = weighCore(statements, issue, cmp);
  if (!open.size || base.status === "needs_facts" && issue.missing.length) return base;
  const keys = [...open.keys()];
  const askFor = (ks: string[]) => ks.map((k) => {
    const o = open.get(k)!;
    const f = o.concept ? issue.factors.find((x) => x.key === o.concept) : undefined;
    return f ? `«${o.text}» — ${f.question}` : `هل تحقق في الواقعة: «${o.text}»؟`;
  });
  const needs = (ks: string[], why: string): Weighing => ({
    status: "needs_facts", reasons: ["تتوقف النتيجة على استكمال هذه الواقعة.", why], unresolved: askFor(ks),
    humanReview: base.humanReview, by: "engine",
  });
  if (keys.length > 6) return needs(keys, "قيود كثيرة لم تبيّنها الوقائع.");
  const outcome = (w: Weighing) => `${w.status}:${w.status === "weighed" ? w.leaning : ""}`;
  const outcomes = new Set<string>();
  let sample: Weighing | null = null;
  for (let m = 0; m < 1 << keys.length; m++) {
    const set = (st: Condition["status"], key: string) => (st === "unknown" && keys.includes(key) ? ((m >> keys.indexOf(key)) & 1 ? "met" : "unmet") : st);
    const assumed = statements.map((s) => {
      const conds = s.conditions.map((c) => {
        if (c.parts?.length) { const parts = c.parts.map((u) => ({ ...u, status: set(u.status, bare(u.text).trim()) })); return { ...c, parts, status: combine(parts.map((u) => u.status), c.join!) }; }
        return { ...c, status: set(c.status, bare(c.text).trim()) };
      });
      return { ...s, conditions: conds, ...evaluate(s.polarity, conds, s.exceptionStructure) };
    });
    const w = weighCore(assumed, issue, cmp);
    outcomes.add(outcome(w));
    sample ??= w;
  }
  if (outcomes.size > 1) {
    // the facts whose value changes the result
    const decisive = keys.filter((_, bit) => {
      for (let m = 0; m < 1 << keys.length; m++) {
        if ((m >> bit) & 1) continue;
        const at = (mm: number) => {
          const assumed = statements.map((s) => {
            const st = (x: Condition["status"], key: string) => (x === "unknown" && keys.includes(key) ? ((mm >> keys.indexOf(key)) & 1 ? "met" : "unmet") : x);
            const conds = s.conditions.map((c) => c.parts?.length ? (() => { const parts = c.parts!.map((u) => ({ ...u, status: st(u.status, bare(u.text).trim()) })); return { ...c, parts, status: combine(parts.map((u) => u.status), c.join!) }; })() : { ...c, status: st(c.status, bare(c.text).trim()) });
            return { ...s, conditions: conds, ...evaluate(s.polarity, conds, s.exceptionStructure) };
          });
          return outcome(weighCore(assumed, issue, cmp));
        };
        if (at(m) !== at(m | (1 << bit))) return true;
      }
      return false;
    });
    return needs(decisive.length ? decisive : keys, "الحكم في المصادر معلق بقيد أو استثناء لم تبيّنه الوقائع، ويتغير الحكم بتحققه أو عدمه.");
  }
  // the result is the same whichever way the open facts go: it does not rest on them
  if (outcome(base) === [...outcomes][0]) {
    if (base.status === "weighed") base.uncertainty.push(`قيود لم تتبين من الوقائع ولا يتغير بها الحكم: ${[...open.values()].map((o) => o.text).join("؛ ")}`);
    return base;
  }
  if (sample!.status === "weighed") sample!.uncertainty.push(`قيود لم تتبين من الوقائع ولا يتغير بها الحكم: ${[...open.values()].map((o) => o.text).join("؛ ")}`);
  return sample!;
}

function weighCore(statements: Statement[], issue: Issue, cmp: Comparison): Weighing {
  const humanReview = ["اعتماد المراجع الشرعي المختص للنتيجة والاستدلال ومدى صحة الاستناد إلى كل مصدر"];
  const unreviewed = [...new Set(statements.filter((s) => s.source.status !== "approved").map((s) => `${s.source.title} — ${s.source.locator}`))];
  if (unreviewed.length) humanReview.push(`مراجعة النصوص المستخدمة غير المراجعة: ${unreviewed.join("؛ ")}`);
  if (statements.some((s) => s.source.flags.some((f) => /ضوئي|معيب/.test(f)))) humanReview.push("مقابلة النصوص المستخرجة آليًا بالمطبوع قبل الاعتماد");
  if (issue.missing.length) {
    return { status: "needs_facts", reasons: ["لا يُرجَّح قبل استكمال الوقائع المؤثرة في الحكم."], unresolved: issue.missing, humanReview, by: "engine" };
  }
  const unclear = statements.filter((s) => s.unclear);
  for (const s of unclear) humanReview.push(`نص لم يُستخرج منه حكم لعدم وضوح تركيبه (${s.id}): ${s.unclear}`);
  // a «يجوز» does not answer «يجب؟», nor a «لا يجب» answer «يجوز؟»
  const dim = DIMENSION[issue.asks];
  const offDimension = dim ? statements.filter((s) => s.effective !== "unknown" && !dim.has(s.effective)) : [];
  const allKnown = statements.filter((s) => s.effective !== "unknown" && s.applies !== "does_not_apply" && (!dim || dim.has(s.effective)));
  // the school's books, where they speak to the facts, are what is weighed; guidance pages and contemporary books, and
  // statements whose conditions the facts leave open, are set beside them (listed among the other views), not against them
  const classicalApplying = allKnown.filter((s) => s.source.refKind === "classical_fiqh" && s.applies === "applies");
  const known = classicalApplying.length ? classicalApplying : allKnown;
  if (!allKnown.length) {
    return {
      status: "insufficient",
      reasons: !statements.length ? ["لم يُعثر في قاعدة المعرفة على نص في المسألة."]
        : offDimension.length ? [`النصوص المسترجعة تتناول ${issue.asks === "obligation" ? "الجواز أو المنع لا الوجوب" : "الوجوب أو عدمه لا الجواز"}؛ لا يُستنتج منها جواب السؤال.`]
          : ["لم يتبين من النصوص المسترجعة حكم ينطبق على الواقعة (الحكم أو القيد غير ظاهر في ألفاظها)."],
      unresolved: issue.subIssues, humanReview, by: "engine",
    };
  }
  const mutamad = statements.filter((s) => s.rank === "mutamad" && s.source.refKind === "classical_fiqh");
  // the relied-upon view with a condition the facts leave open is not set aside: the fact is asked for (round 8)
  const open = mutamad.filter((m) => m.applies === "unknown" && m.effective !== "unknown");
  if (open.length) {
    const conds = [...new Set(open.flatMap((m) => m.conditions.filter((c) => c.status === "unknown").map((c) => c.text)))];
    return { status: "needs_facts", reasons: ["للقول المعتمد في المذهب قيد لم تبيّنه الوقائع؛ لا يُرجَّح قبل معرفته."], unresolved: conds.map((c) => `هل تحقق في الواقعة: «${c}»؟`), humanReview, by: "engine" };
  }
  const mutamadApplying = mutamad.filter((s) => s.applies !== "does_not_apply" && s.effective !== "unknown");
  const byPol = new Map<Polarity, Statement[]>();
  for (const s of known) byPol.set(s.effective, [...(byPol.get(s.effective) ?? []), s]);
  let leaning: Polarity;
  const reasons: string[] = [];
  let differs = false;
  // a view the book itself says is not the school's («وقيل … والمذهب خلافه») is never the basis by itself
  if (known.every((s) => s.rank === "other")) {
    const contrary = known.some((s) => s.schoolHoldsContrary);
    return {
      status: "unresolved",
      reasons: [contrary ? "نصّ الكتاب على أن المذهب خلاف القول المتاح («والمذهب خلافه»)، ولم يرد في المقطع لفظ قول المذهب نفسه: لا يُبنى عليه ميل، ولا يُصاغ قول المذهب من غير نصه." : "الأقوال المتاحة خلاف المعتمد بنص الكتاب، والمعتمد لم يرد بلفظه في المقاطع."],
      unresolved: issue.subIssues, humanReview, by: "engine",
    };
  }
  if (byPol.size === 1) {
    leaning = [...byPol.keys()][0]!;
    reasons.push("اتفقت نصوص الكتب الفقهية المنطبقة على الواقعة في الحكم (المسار الفقهي وحده؛ القيود النظامية تُعرض في مسارها).");
  } else if (mutamadApplying.length) {
    leaning = mutamadApplying[0]!.effective;
    reasons.push("القول المعتمد في المذهب — بنص الكتاب — منطبق على الواقعة بحسب قيوده.");
  } else if (mutamad.length) {
    // the relied-upon view's condition is not met by these facts: the leaning on THESE facts may differ from it
    const others = known.filter((s) => s.source.refKind === "classical_fiqh");
    if (!others.length) return { status: "unresolved", reasons: ["المعتمد لا ينطبق قيده على الواقعة، ولا قول أصلي آخر منطبق في المصادر المسترجعة."], unresolved: issue.subIssues, humanReview, by: "engine" };
    const counts = [...byPol.entries()].map(([p, ss]) => ({ p, n: ss.filter((s) => s.source.refKind === "classical_fiqh").length })).sort((a, b) => b.n - a.n);
    if (counts.length > 1 && counts[0]!.n === counts[1]!.n) return { status: "unresolved", reasons: ["أقوال متعارضة منطبقة على الواقعة بلا مرجح ظاهر في النصوص، والمعتمد لا ينطبق قيده."], unresolved: issue.subIssues, humanReview, by: "engine" };
    leaning = counts[0]!.p;
    differs = mutamad.some((m) => m.polarity !== leaning);
    reasons.push("قيد القول المعتمد غير متحقق في الواقعة، فمال التحليل إلى القول المنطبق عليها.");
  } else {
    return { status: "unresolved", reasons: ["أقوال متعارضة، ولم يتبين من النصوص المتاحة أيها المعتمد في المذهب."], unresolved: issue.subIssues, humanReview, by: "engine" };
  }
  const chosen = byPol.get(leaning)!;
  // the relied-upon view, where its condition is not met by the facts, does not decide them; a leaning resting on another
  // view with a different ruling is flagged as differing from it (§3.7)
  if (!differs && mutamad.length && !chosen.some((c) => c.rank === "mutamad") && mutamad.some((m) => m.polarity !== leaning && m.polarity !== "unknown")) {
    differs = true;
    reasons.push("القول المعتمد في المذهب لا ينطبق قيده على هذه الواقعة، فبُني الميل على قول آخر.");
  }
  const asides = allKnown.filter((s) => !known.includes(s) && s.effective !== leaning).map((s) => ({ statementId: s.id, why: s.source.refKind === "classical_fiqh" ? "انطباقه على الواقعة غير متبين" : "ليس من كتب المذهب: لا يُرجَّح به على نصوصها المنطبقة" }));
  const others = known.filter((s) => s.effective !== leaning).map((s) => ({
    statementId: s.id,
    why: s.rank === "other" ? "خلاف المعتمد بحسب نص الكتاب" : mutamadApplying.length && s.rank !== "mutamad" ? "يخالف القول المعتمد المنطبق على الواقعة" : "لم يتقدم بمرجح من النصوص المتاحة",
  }));
  const notApplying = statements.filter((s) => s.applies === "does_not_apply").map((s) => ({ statementId: s.id, why: "قيده غير متحقق في الواقعة" }));
  for (const c of chosen) for (const cond of c.conditions) if (cond.status === "met") reasons.push(`تحقق القيد «${cond.text}» بالواقعة «${cond.byFact}» (مطابقة آلية).`);
  const classicalSources = new Set(chosen.filter((s) => s.source.refKind === "classical_fiqh").map((s) => s.source.refCode));
  const onlyContemporary = !classicalSources.size;
  const uncertainty: string[] = [];
  const unknownConds = chosen.flatMap((s) => s.conditions.filter((c) => c.status === "unknown").map((c) => c.text));
  if (unknownConds.length) uncertainty.push(`قيود لم تتبين من الوقائع: ${[...new Set(unknownConds)].join("؛ ")}`);
  if (onlyContemporary) { uncertainty.push("المستند كتاب معاصر وحده: شرح المؤلف لا نص المذهب."); humanReview.push("مستند إلى «الميسّر» وحده: للمراجع طلب الرجوع إلى مصدر أصلي"); }
  if (differs) { uncertainty.push("الميل في الواقعة يخالف القول المعتمد في المذهب."); humanReview.push("ترجيح يخالف المعتمد لعدم انطباق قيده: يقرره المراجع"); }
  if (cmp.divergences.some((d) => d.nature === "real")) uncertainty.push("خلاف حقيقي بين أقوال منطبقة على الواقعة.");
  if (issue.factors.some((f) => f.status === "assumed")) uncertainty.push("بعض الوقائع مفترضة لا ثابتة.");
  const unreviewedChosen = chosen.some((s) => s.source.status !== "approved");
  let confidence: "high" | "medium" | "low" = classicalSources.size >= 2 && chosen.some((s) => s.rank === "mutamad") && !unknownConds.length ? "high" : classicalSources.size >= 1 ? "medium" : "low";
  if (onlyContemporary || differs || issue.factors.some((f) => f.status === "assumed")) confidence = "low";
  if (unreviewedChosen && confidence === "high") confidence = "medium";
  return {
    status: "weighed", leaning, statementIds: chosen.map((s) => s.id), reasons: [...new Set(reasons)],
    supporting: [...new Set(chosen.map((s) => `${s.source.title} — ${s.source.locator}`))],
    others: [...others, ...asides, ...notApplying], mutamad: mutamad.map((s) => s.id), differsFromMutamad: differs,
    unresolved: issue.factors.filter((f) => f.status === "missing").map((f) => f.question), confidence, uncertainty, humanReview: [...new Set(humanReview)], by: "engine",
  };
}

export const LIMITS = [
  "القراءة لفظية: تعتمد ألفاظ النصوص ومصطلحات المذهب المعروفة (وعنه، وقيل، وجهًا، اختاره، نص عليه، الصحيح من المذهب) وقائمة مغلقة من المفاهيم؛ ما لا لفظ له لا يُستنتج.",
  "مرتبة القول لا تُستنتج من شهرة الكتاب: تُذكر «معتمدًا» فقط حين ينص الكتاب على ذلك.",
  "مطابقة القيود بالوقائع آلية مبدئية، والمراجع يقررها.",
  "لا يصدر عن المحرك حكم ولا فتوى؛ الاعتماد للمراجع الشرعي المختص وحده.",
];

// ───────────────────────── 5. the regulatory track (§4) ─────────────────────────

const DIRECTION = /يراعي|يراعى|ينبغي|يوصي|يوصى|يستحسن|يفضل|يحسن|يُستحسن|يُفضل/;
/** The standing of a non-fiqh passage, from its source's kind and its own wording. */
export function regulatoryStanding(refKind: string, text: string): RegulatoryStanding {
  if (["statute", "regulation", "official_instruction"].includes(refKind)) return "binding";
  if (refKind === "official_guide" || refKind === "professional_standard") return DIRECTION.test(bare(text)) ? "non_binding" : "guidance";
  return "explanation";
}

/**
 * The regulatory track beside the fiqh result: every regulatory and guidance statement kept with its standing; each set
 * against the fiqh leaning (never declared in agreement: at most «no conflict seen» by the lexical matching); the
 * combined effect; and a legal review whenever a binding text is involved or a conflict is seen.
 */
export function regulatoryTrack(all: Statement[], w: Weighing | null, retrieved: SourceRef[] = []): RegulatoryTrack {
  const items: RegulatoryItem[] = all.filter((s) => !FIQH_TRACK.has(s.source.refKind)).map((s) => ({
    statementId: s.id, refCode: s.source.refCode, title: s.source.title, locator: s.source.locator,
    standing: regulatoryStanding(s.source.refKind, s.text), polarity: s.effective, applies: s.applies, text: s.text,
  }));
  const leaning = w?.status === "weighed" ? w.leaning : null;
  const relation = items.map((i) => {
    if (i.polarity === "unknown" || !leaning || i.applies !== "applies") return { statementId: i.statementId, outcome: "undetermined" as const, note: !leaning ? "لا ميل فقهي يقابَل به" : i.polarity === "unknown" ? "أثر النص على الحكم غير متبين من ألفاظه" : i.applies === "unknown" ? "قيد النص أو استثناؤه لم يتبين من الوقائع: أثره معلق عليه" : "قيد النص غير متحقق في الواقعة بحسب المطابقة الآلية — يبقى معروضًا ولا يُسقط" };
    if (contrary(i.polarity, leaning)) return { statementId: i.statementId, outcome: "conflict" as const, note: "يقابل الميل الفقهي: تعارض ظاهر يُعرض على المراجعة النظامية والشرعية؛ لا يُدّعى اتفاق" };
    return { statementId: i.statementId, outcome: "no_conflict_seen" as const, note: "لا تعارض ظاهر بحسب المطابقة الآلية — ليس إثباتًا للاتفاق" };
  });
  const binding = items.filter((i) => i.standing === "binding");
  const conflict = relation.some((r) => r.outcome === "conflict");
  const combined: string[] = [];
  combined.push(leaning ? "المسار الفقهي: ميل مبدئي من نصوص الكتب الفقهية وحدها؛ لا يُستدل عليه بالأدلة الإرشادية ولا بالأنظمة." : "المسار الفقهي: لا ميل مبدئي (انظر الترجيح).");
  // retrieved but not read into a rule is never reported as «not retrieved» (N9-8)
  const regRetrieved = retrieved.filter((r) => !FIQH_TRACK.has(r.refKind) && !items.some((i) => i.refCode === r.refCode && i.locator === r.locator));
  for (const r of regRetrieved) combined.push(`استُرجع ${regulatoryStanding(r.refKind, "") === "binding" ? "نص نظامي ملزم" : "نص إرشادي"} ولم يُستخرج منه حكم صريح في المسألة؛ يقرؤه المراجع النظامي ولا يُسقط: ${r.title} — ${r.locator}.`);
  if (!items.length && !regRetrieved.length) combined.push("المسار النظامي: لم يُسترجع نص نظامي أو إرشادي في المسألة — لا يعني ذلك انتفاء القيود النظامية؛ يُتحقق منها قبل التطبيق.");
  for (const b of binding) combined.push(`قيد نظامي ملزم يُراعى في التطبيق أيًّا كان الميل الفقهي، ولا يُنسب إلى المذهب: ${b.title} — ${b.locator}.`);
  for (const g of items.filter((i) => i.standing !== "binding")) combined.push(`${g.standing === "guidance" ? "إرشاد رسمي" : g.standing === "non_binding" ? "توجيه غير ملزم" : "شرح"} يُستأنس به ولا يقوم مقام النص الملزم ولا يُثبت المعتمد: ${g.title} — ${g.locator}.`);
  if (conflict) combined.push("يوجد تعارض ظاهر بين المسارين: لا يُدّعى الاتفاق، ويُعرض على المراجعة النظامية لتحديد الأثر.");
  return { items, relation, combined, legalReview: !!binding.length || conflict || regRetrieved.some((r) => regulatoryStanding(r.refKind, "") === "binding"), by: "engine" };
}
