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
import type { Comparison, Condition, Divergence, Fact, Factor, Issue, Polarity, Rank, SourceRef, Statement, StatementKind, Weighing } from "./types";

/** Text without diacritics and tatweel; hamza forms as alif, alif maqsura as ya (for matching only). */
export const bare = (s: string) => s.replace(/[ً-ٰٟـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي");

// ───────────────────────── concepts the conditions and the facts are matched on ─────────────────────────

type Concept = { key: string; label: string; words: RegExp; negators?: RegExp };
const CONCEPTS: Concept[] = [
  { key: "benefit", label: "قيام منافع العين", words: /منافع|منفع|ينتفع|انتفاع|الانتفاع|يُنتفع/, negators: /تعطل|تتعطل|خرب|خراب|تعذر|تهدم|انهدم/ },
  { key: "maslaha", label: "المصلحة أو الحاجة", words: /مصلح|اصلح|حاج/ },
  { key: "waqif", label: "شرط الواقف", words: /شرط|شروط|اشترط/ },
  { key: "judge", label: "إذن الحاكم أو الجهة", words: /اذن|حاكم|قاضي|المحكم|الهيئ/ },
  { key: "mosque", label: "كون الموقوف مسجدًا", words: /مسجد/ },
  { key: "cash", label: "وجه الانتفاع بالنقود", words: /قرض|القرض|استثمار|مضارب|تحلي|الوزن/ },
];
const NEGATION = /(?:^|\s)(?:لم|لا|ليس|ليست|غير|بلا|بدون|عدم|دون)(?=\s|$)/g;

/** Which concepts a phrase speaks of, and whether it affirms or denies each (a negator word counts as a denial). */
export function conceptsOf(phrase: string): Map<string, boolean> {
  const t = bare(phrase);
  const out = new Map<string, boolean>();
  const neg = (t.match(NEGATION) ?? []).length % 2 === 1;
  for (const c of CONCEPTS) {
    const has = c.words.test(t) || (c.negators?.test(t) ?? false);
    if (!has) continue;
    const denied = neg !== (c.negators?.test(t) ?? false);
    out.set(c.key, !denied);
  }
  return out;
}

const contentTokens = (s: string) => new Set(tokenize(s));
const overlap = (a: Set<string>, b: Set<string>) => (a.size ? [...a].filter((x) => b.has(x)).length / a.size : 0);

/** A condition against the facts: met, unmet or unknown — and by which fact (engine's matching, lexical). */
export function conditionStatus(cond: string, facts: Fact[]): { status: Condition["status"]; byFact?: string } {
  const cc = conceptsOf(cond);
  if (cc.size) {
    for (const [k, affirmed] of cc) {
      const f = facts.find((x) => conceptsOf(x.text).has(k));
      if (!f) continue;
      return { status: conceptsOf(f.text).get(k) === affirmed ? "met" : "unmet", byFact: f.text };
    }
    return { status: "unknown" };
  }
  const ct = contentTokens(cond);
  const negC = (bare(cond).match(NEGATION) ?? []).length % 2 === 1;
  for (const f of facts) {
    if (overlap(ct, contentTokens(f.text)) >= 0.5) {
      const negF = (bare(f.text).match(NEGATION) ?? []).length % 2 === 1;
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
    const f = facts.find((x) => (d.concept ? conceptsOf(x.text).has(d.concept) : false) || (d.words ? d.words.test(bare(x.text)) : false));
    return { key: d.key, question: d.question, essential: d.essential, status: f ? (f.status === "established" ? "given" : "assumed") : "missing", by: f?.text };
  });
  return {
    question, head: headOf(question), topic: topic?.label ?? null, subIssues: topic?.subIssues ?? [], factors,
    missing: factors.filter((f) => f.essential && f.status === "missing").map((f) => f.question), facts, by: "engine",
  };
}

// ───────────────────────── 2. statements ─────────────────────────

/** Where a new statement starts in a classical text (the school's terms), and the nature that start gives it. */
const STARTERS: { re: RegExp; kind: StatementKind }[] = [
  { re: /وعنه|وعن احمد|وفي روايه|وفي رواية/, kind: "riwaya" },
  { re: /وقيل/, kind: "qila" },
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
const BACK_REF = /^(?:و?اختاره|وهو المذهب|وهو الصحيح|والمذهب خلافه|والصحيح خلافه|وهو خلاف المذهب|وعليه الاصحاب|وعليه اكثر الاصحاب)/;
/** The text says the view it states is NOT the school's («والمذهب خلافه»): never read as the relied-upon view. */
const NOT_MUTAMAD = /والمذهب خلافه|والصحيح خلافه|خلاف المذهب|خلاف الصحيح|والمشهور خلافه/;
const MUTAMAD = /الصحيح من المذهب|وهو المذهب|وهي المذهب|وهي الصحيحه|وهي الصحيحة|على المذهب|والمذهب|وعليه الاصحاب|وعليه جماهير الاصحاب|وعليه اكثر الاصحاب|المشهور في المذهب|المذهب انه/;
const NASS = /نص عليه|نص احمد|منصوص احمد|المنصوص/;

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
function conditionsIn(t: string): { text: string; kind: Condition["kind"] }[] {
  const out: { text: string; kind: Condition["kind"] }[] = [];
  // a fragment ends on a whole word (a cut «غيره» must not read as the negation «غير»)
  const whole = (m: RegExpMatchArray) => {
    let end = (m.index ?? 0) + m[0].length;
    while (end < t.length && /[ء-ي]/.test(t[end]!)) end++;
    // the condition ends where the ruling begins («إذا كانت منافعه قائمة | لم يجز بيعه»)
    return t.slice(m.index ?? 0, end).replace(/^[\s(]+/, "").split(RULING_CUT)[0]!.trim();
  };
  for (const m of t.matchAll(/(?:^|[\s(])(?:فان لم|وان لم|ان لم|اذا لم|فاذا|اذا|بشرط|حيث|متى)\s+([^،.؛:\n()…]{3,60})/g)) out.push({ text: whole(m), kind: "condition" });
  for (const m of t.matchAll(/(?:^|[\s(])الا\s+(?:ان\s+)?([^،.؛:\n()…]{3,60})/g)) out.push({ text: whole(m), kind: "exception" });
  for (const m of t.matchAll(/(?:لمصلح[هة]|للمصلح[هة]|مع الحاج[هة]|بلا حاج[هة]|لظهور المصلح[هة])/g)) out.push({ text: m[0].trim(), kind: "condition" });
  return out;
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
    pieces = pieces.filter((x) => overlap(qTokens, contentTokens(x)) >= 0.34 || [...qTokens].some((w) => w.length > 3 && contentTokens(x).has(w) && /حكم|يجوز|يصح|لا/.test(bare(x))));
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
    pieces = joined.filter((x) => x.length > 8);
  }
  const statements: Statement[] = pieces.map((piece, i) => {
    const t = bare(piece);
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
    if (!contemporary && NOT_MUTAMAD.test(t)) { rank = "other"; markers.push(t.match(NOT_MUTAMAD)![0]); }
    else if (!contemporary && MUTAMAD.test(t)) { rank = "mutamad"; markers.push(t.match(MUTAMAD)![0]); }
    const pol = polarityOf(t);
    if (pol.marker) markers.push(pol.marker);
    const conds: Condition[] = conditionsIn(t).map((c) => ({ ...c, ...conditionStatus(c.text, ctx.facts) }));
    const unmet = conds.some((c) => c.kind === "condition" && c.status === "unmet");
    // «لا … إلا أن A، إلا أن B»: each exception met reverses the ruling once (an exception to the exception restores it)
    // exceptions joined by «أو إلا» are alternatives (any one met reverses once); otherwise each is nested in the last
    const alternatives = /او الا|او الا ان/.test(t);
    const met = conds.filter((c) => c.kind === "exception" && c.status === "met").length;
    const metExceptions = alternatives ? Math.min(met, 1) : met;
    const exceptionMet = metExceptions % 2 === 1;
    const unknown = conds.some((c) => c.status === "unknown");
    const reverse = (p: Polarity): Polarity => ({ prohibit: "permit", permit: "prohibit", not_obliged: "oblige", oblige: "not_obliged" } as Record<string, Polarity>)[p] ?? p;
    const applies: Statement["applies"] = metExceptions ? "applies" : unmet ? "does_not_apply" : unknown ? "unknown" : "applies";
    const via = !contemporary ? t.match(/^و?قال في\s+([ء-ي]+)/)?.[1] : undefined;
    return {
      id: `${ctx.idPrefix}.${i + 1}`, kind, rank, text: piece, element: contemporary && kind !== "naql" ? "author" : "quote",
      attributedTo: via && kind !== "naql" ? `${attributionOf(t.replace(/^و?قال في\s+[ء-ي]+\s+/, ""), kind) ?? "غير مسمى"} — بنقل كتاب «${via}»` : attributionOf(t, kind), polarity: pol.polarity, conditions: conds, applies, effective: exceptionMet ? reverse(pol.polarity) : pol.polarity,
      source, markers: [...new Set(markers)],
    };
  });
  // a passage that names the relied-upon view makes the riwayat and «qila» views beside it the other views
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
  const known = statements.filter((s) => s.effective !== "unknown");
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
    const both = a.applies !== "does_not_apply" && b.applies !== "does_not_apply";
    const sameConds = JSON.stringify([...new Set(a.conditions.flatMap((c) => [...conceptsOf(c.text).keys()]))].sort()) === JSON.stringify([...new Set(b.conditions.flatMap((c) => [...conceptsOf(c.text).keys()]))].sort());
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

export function weigh(statements: Statement[], issue: Issue, cmp: Comparison): Weighing {
  const humanReview = ["اعتماد المراجع الشرعي المختص للنتيجة والاستدلال ومدى صحة الاستناد إلى كل مصدر"];
  const unreviewed = [...new Set(statements.filter((s) => s.source.status !== "approved").map((s) => `${s.source.title} — ${s.source.locator}`))];
  if (unreviewed.length) humanReview.push(`مراجعة النصوص المستخدمة غير المراجعة: ${unreviewed.join("؛ ")}`);
  if (statements.some((s) => s.source.flags.some((f) => /ضوئي|معيب/.test(f)))) humanReview.push("مقابلة النصوص المستخرجة آليًا بالمطبوع قبل الاعتماد");
  if (issue.missing.length) {
    return { status: "needs_facts", reasons: ["لا يُرجَّح قبل استكمال الوقائع المؤثرة في الحكم."], unresolved: issue.missing, humanReview, by: "engine" };
  }
  const allKnown = statements.filter((s) => s.effective !== "unknown" && s.applies !== "does_not_apply");
  // the school's books, where they speak to the facts, are what is weighed; guidance pages and contemporary books, and
  // statements whose conditions the facts leave open, are set beside them (listed among the other views), not against them
  const classicalApplying = allKnown.filter((s) => s.source.refKind === "classical_fiqh" && s.applies === "applies");
  const known = classicalApplying.length ? classicalApplying : allKnown;
  if (!allKnown.length) {
    return {
      status: "insufficient",
      reasons: statements.length ? ["لم يتبين من النصوص المسترجعة حكم ينطبق على الواقعة (الحكم أو القيد غير ظاهر في ألفاظها)."] : ["لم يُعثر في قاعدة المعرفة على نص في المسألة."],
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
  if (byPol.size === 1) {
    leaning = [...byPol.keys()][0]!;
    reasons.push("اتفقت النصوص المنطبقة على الواقعة في الحكم.");
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
