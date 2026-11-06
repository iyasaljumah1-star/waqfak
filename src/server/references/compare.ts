/**
 * Compares the official text of a reference with a knowledge-base copy, article by article and paragraph by
 * paragraph. Every difference is classified (editorial / OCR / substantive) with the reason, and its effect on the
 * legal meaning is stated. A high similarity score never makes a copy acceptable: one changed word can change a ruling.
 */
import { cardinalValue, isCardinalWord, isOrdinalWord, ordinalValue, PRESENTATION_FORMS, stripMarkdown, toLatinDigits, tokenize, type Token } from "./arabic";
import { diffTokens } from "./diff";
import { segment, type ArticleSeg, type Segmentation } from "./segment";
import type { MatchOutcome } from "./types";

export type DiffClass =
  | "editorial" // spelling, hamza, spacing, grammatical form of the same number, known equivalent wording
  | "ocr" // extraction damage in the copy (garbled letters, reversed text, page furniture, Latin noise)
  | "substantive" // a number, duration, negation, permission or obligation differs: the ruling differs
  | "presumed_substantive"; // words dropped or added with no harmless explanation: treated as meaningful until reviewed

export type Difference = {
  locator: string; // «م8/ف2» (official numbering)
  class: DiffClass;
  reason: string;
  official: string;
  candidate: string;
  /** Effect on the legal meaning, in Arabic, for the reviewer. */
  impact: string;
};

export type ArticleResult = {
  article: number;
  outcome: MatchOutcome;
  /** How the copy's text for this article was found: by its heading, by its content (heading missing), or not at all. */
  located: "heading" | "content" | "missing";
  /** Share of the official words found, in order, in the copy (0..1). Informative only, never decisive. */
  coverage: number;
  headingMatches: boolean;
  officialParagraphs: number[];
  candidateParagraphs: number[];
  differences: Difference[];
};

export type ComparisonResult = {
  outcome: MatchOutcome;
  articlesOfficial: number;
  articlesCandidate: number;
  counts: Record<MatchOutcome, number>;
  articles: ArticleResult[];
  /** Articles present in the copy but not in the official text. */
  extraArticles: number[];
  officialIssues: string[];
  candidateIssues: string[];
  /** The copy contains PDF presentation-form characters (a sign of raw PDF extraction). */
  candidateHasPresentationForms: boolean;
};

const SEVERITY: MatchOutcome[] = ["identical", "editorial_only", "extraction_defective", "substantive_difference"];
const worse = (a: MatchOutcome, b: MatchOutcome) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a);

/** Words that carry permission, obligation, prohibition or negation: changing them changes the ruling. */
const NORMATIVE = new Set(
  ["لا", "ولا", "ليس", "غير", "عدم", "دون", "الا", "يجب", "يجوز", "لايجوز", "يحظر", "يمنع", "يلتزم", "تلتزم", "يشترط", "يتعين", "لزم", "يلزم", "ممنوع", "محظور", "جواز", "وجوب", "حظر", "اذن", "باذن", "موافقه", "بموافقه", "فقط", "كل", "جميع", "بعض", "او", "ثم", "قبل", "بعد", "خلال", "تتجاوز", "يتجاوز", "تزيد", "يزيد", "تقل", "يقل", "اقل", "اكثر", "حد", "اقصي", "ادني"].map((w) => w),
);
/** Time units: a changed unit changes a deadline. */
const TIME_UNITS = new Set(["يوم", "يوما", "ايام", "اليوم", "شهر", "اشهر", "شهرا", "سنه", "سنتين", "سنوات", "سنتان", "اسبوع", "اسابيع", "ساعه", "ساعات", "عمل"]);

/** Wording pairs accepted as editorial because they do not change the ruling (confirmed by a reviewer once each). */
const EQUIVALENTS: { a: string[]; b: string[]; after?: RegExp; note: string }[] = [
  { a: ["علي"], b: ["عن"], after: /^(تزيد|يزيد|زاد|تزد|يزد)$/, note: "«لا تزيد على» و«لا تزيد عن» بمعنى واحد" },
  { a: ["عن"], b: ["علي"], after: /^(تزيد|يزيد|زاد|تزد|يزد)$/, note: "«لا تزيد عن» و«لا تزيد على» بمعنى واحد" },
];

/** Page furniture repeated by PDF extraction (running headers, page numbers, table-of-contents numbers). */
const FURNITURE = [/^جميع$/, /^الحقوق$/, /^محفوظه$/, /^للهييه$/, /^العامه$/, /^للاوقاف$/, /^لايحه$/, /^تنظيم$/, /^اعمال$/, /^النظاره$/, /^مجلس$/, /^الامناء$/, /^الامنا$/, /^جدول$/, /^المحتويات$/, /^[0-9]{1,3}$/];
const isFurniture = (t: Token) => FURNITURE.some((re) => re.test(t.norm));

/** Share of a span's 4-word runs found in another text (0..1). Tolerates noise inside moved blocks. */
function gramShare(span: Token[], haystack: string): number {
  if (span.length < 4) return 0;
  let hit = 0;
  let n = 0;
  for (let i = 0; i + 4 <= span.length; i++) {
    n++;
    if (haystack.includes(" " + span.slice(i, i + 4).map((t) => t.norm).join(" ") + " ")) hit++;
  }
  return hit / n;
}

type Tagged = Token & { paragraph: number; item: string | null };

function tagTokens(a: ArticleSeg): Tagged[] {
  const out: Tagged[] = [];
  for (const l of a.lines) for (const t of tokenize(l.text)) out.push({ ...t, paragraph: l.paragraph, item: l.item });
  return out;
}

function numericValue(tokens: Token[]): number | null {
  const norms = tokens.map((t) => t.norm);
  const card = cardinalValue(norms);
  if (card !== null) return card;
  const ord = ordinalValue(norms);
  if (ord !== null) return ord;
  if (norms.length === 1) {
    const stripped = norms[0]!.replace(/^(ال|و|ب|ل)/, "");
    const v = cardinalValue([stripped]);
    if (v !== null) return v;
  }
  return null;
}

const hasDigit = (ts: Token[]) => ts.some((t) => /[0-9]/.test(t.norm));
const hasNumberWord = (ts: Token[]) => ts.some((t) => isCardinalWord(t.norm) || isOrdinalWord(t.norm));

/** Edit distance counting an adjacent transposition as one edit («تسجيله» / «تسجليه»). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

function looksGarbled(t: Token): boolean {
  return /[A-Za-z]/.test(t.raw) || (/[0-9]/.test(t.raw) && /[\p{L}]/u.test(t.raw.replace(/[0-9%/.,]/g, "")) && !/^[0-9]+$/.test(t.raw)) || t.norm.length === 1;
}

type Context = { officialAll: string; candidateAll: string };
const joinNorm = (ts: Token[]) => " " + ts.map((t) => t.norm).join(" ") + " ";

function classify(A: Token[], B: Token[], before: Token | undefined, ctx?: Context): { cls: DiffClass; reason: string; impact: string } {
  // Several words replaced side by side («على خمسمائة» / «عن خمسمئة»): editorial only if every pair is.
  if (A.length > 1 && A.length === B.length && A.length <= 8) {
    const parts = A.map((t, i) => classifyOne([t], [B[i]!], i === 0 ? before : A[i - 1], ctx));
    if (parts.every((p) => p.cls === "editorial")) return { cls: "editorial", reason: [...new Set(parts.map((p) => p.reason))].join("؛ "), impact: "لا أثر في المعنى" };
  }
  return classifyOne(A, B, before, ctx);
}

function classifyOne(A: Token[], B: Token[], before: Token | undefined, ctx?: Context): { cls: DiffClass; reason: string; impact: string } {
  const aj = A.map((t) => t.norm).join("");
  const bj = B.map((t) => t.norm).join("");
  if (A.length && B.length && aj === bj) return { cls: "editorial", reason: "اختلاف في الفصل بين الكلمات فقط", impact: "لا أثر في المعنى" };

  // Text moved by the extraction: the words missing here are elsewhere in the copy, or the extra words here belong
  // elsewhere in the official text. The ruling is not lost, but the copy cannot be cited at this locator.
  // Running headers and page numbers inserted by the extraction (no official words lost).
  if (B.length && B.filter(isFurniture).length / B.length >= 0.7 && (!A.length || A.every(isFurniture))) {
    return { cls: "ocr", reason: "رأس صفحة أو أرقام صفحات أُدرجت في النص عند الاستخراج", impact: "لا أثر في المعنى، لكن النص المستخرج غير صالح للاقتباس كما هو" };
  }
  if (ctx) {
    const movedOut = A.length >= 3 && (ctx.candidateAll.includes(joinNorm(A)) || (A.length >= 8 && gramShare(A, ctx.candidateAll) >= 0.6));
    const cleanB = B.filter((t) => !isFurniture(t));
    const movedIn = B.length >= 3 && (ctx.officialAll.includes(joinNorm(B)) || (cleanB.length >= 8 && gramShare(cleanB, ctx.officialAll) >= 0.6));
    if ((movedOut || !A.length) && (movedIn || !B.length) && (movedOut || movedIn)) {
      return { cls: "ocr", reason: movedOut && movedIn ? "نص مبدَّل الموضع بين أجزاء النسخة" : movedOut ? "نص المادة موجود في موضع آخر من النسخة" : "نص من موضع آخر أُقحم هنا في النسخة", impact: "الحكم غير مفقود لكن موضعه في النسخة خاطئ؛ لا يصلح الاستشهاد بالنسخة في هذا الموضع" };
    }
  }

  // A real change of wording in a ruling is local. Long spans are structural (moved, merged or lost blocks): they are
  // judged below as moved text, extraction damage, or presumed meaningful, never «confirmed» by a word they contain.
  const local = A.length <= 8 && B.length <= 8;

  // Damaged words in the copy (cut off, one or two letters wrong) are checked before wording rules, so «أدن» for
  // «أدنى» is extraction damage rather than a changed limit.
  if (A.length && A.length === B.length && !hasNumberWord(A) && !hasNumberWord(B) && !hasDigit(A) && !hasDigit(B)) {
    if (A.every((t, i) => B[i]!.norm.length >= 2 && B[i]!.norm.length < t.norm.length && t.norm.startsWith(B[i]!.norm))) {
      return { cls: "ocr", reason: "كلمة مبتورة في النسخة", impact: "النص المستخرج ناقص في هذا الموضع ولا يصلح للاقتباس" };
    }
    if (A.every((t, i) => t.norm.length > 3 && !/[0-9]/.test(t.norm) && levenshtein(t.norm, B[i]!.norm) <= Math.max(1, Math.floor(t.norm.length / 4)))) {
      return { cls: "ocr", reason: "خطأ في حرف أو حرفين (قراءة ضوئية)", impact: "على الأرجح لا يغيّر المعنى، لكن الكلمة في النسخة خاطئة" };
    }
  }
  // Fragments that are not words of the official text at all (short nonsense tokens from a bad scan).
  if (ctx && B.length >= 3) {
    const unknownShare = B.filter((t) => !ctx.officialAll.includes(" " + t.norm + " ")).length / B.length;
    const meanLen = B.reduce((n, t) => n + t.norm.length, 0) / B.length;
    if (unknownShare >= 0.6 && meanLen <= 3.5) return { cls: "ocr", reason: "مقاطع ليست كلمات من النص الرسمي (تشويه قراءة ضوئية)", impact: "النص المستخرج تالف في هذا الموضع ولا يصلح للاقتباس" };
  }

  // «10%» and «10»: a percentage became a plain number (or the reverse).
  if (A.length === B.length && A.length > 0 && A.some((t, i) => t.norm.endsWith("%") !== B[i]!.norm.endsWith("%")) && A.every((t, i) => t.norm.replace(/%$/, "") === B[i]!.norm.replace(/%$/, ""))) {
    return { cls: "substantive", reason: "علامة النسبة المئوية مختلفة", impact: "يغيّر القيمة من نسبة مئوية إلى عدد مطلق أو العكس" };
  }

  // A date written in another order or padding («26 /2/ 1437» / «1437/02/26»): same three numbers.
  const nums = (ts: Token[]) => ts.flatMap((t) => t.norm.split("/")).filter((x) => /^[0-9]+$/.test(x)).map(Number);
  if (A.length && B.length && A.every((t) => /^[0-9/]+$/.test(t.norm)) && B.every((t) => /^[0-9/]+$/.test(t.norm))) {
    const na = nums(A).sort((x, y) => x - y).join(",");
    const nb = nums(B).sort((x, y) => x - y).join(",");
    if (na === nb && nums(A).length >= 3 && nums(A).some((x) => x > 1300)) return { cls: "editorial", reason: "التاريخ نفسه بترتيب أو صيغة مختلفة", impact: "لا أثر في المعنى" };
  }

  // Numbers first: a different value is always substantive, the same value in another form is editorial.
  if ((hasDigit(A) || hasNumberWord(A) || hasDigit(B) || hasNumberWord(B)) && A.length && B.length) {
    // Read the number with the word before it when that word is part of it («الرابعة والعشرين», «خمسة عشرة»).
    const lead = before && (isCardinalWord(before.norm) || isOrdinalWord(before.norm)) ? [before] : [];
    const va = numericValue([...lead, ...A]) ?? numericValue(A);
    const vb = numericValue([...lead, ...B]) ?? numericValue(B);
    if (va !== null && vb !== null) {
      if (va === vb) return { cls: "editorial", reason: `الرقم نفسه (${va}) بصيغة مختلفة`, impact: "لا أثر في المعنى: القيمة واحدة" };
      return { cls: "substantive", reason: `رقم مختلف: ${va} في النص الرسمي و${vb} في النسخة`, impact: "يغيّر مدة أو مبلغًا أو إحالة: الحكم مختلف" };
    }
  }
  if (local && (hasDigit(A) || hasDigit(B)) && !(A.length && B.length)) {
    return { cls: "substantive", reason: A.length ? "سقط رقم من النسخة" : "رقم زائد في النسخة", impact: "قد يغيّر مدة أو مبلغًا أو إحالة" };
  }

  for (const eq of EQUIVALENTS) {
    if (A.length === eq.a.length && B.length === eq.b.length && A.every((t, i) => t.norm === eq.a[i]) && B.every((t, i) => t.norm === eq.b[i])) {
      if (!eq.after || (before && eq.after.test(before.norm))) return { cls: "editorial", reason: eq.note, impact: "لا أثر في المعنى (صيغة متكافئة مسجلة)" };
    }
  }

  const normA = A.filter((t) => NORMATIVE.has(t.norm));
  const normB = B.filter((t) => NORMATIVE.has(t.norm));
  if (local && (normA.length || normB.length)) {
    const words = [...normA, ...normB].map((t) => t.raw).join("، ");
    return { cls: "substantive", reason: `اختلاف في لفظ يحدد الحكم (${words})`, impact: "يغيّر الإذن أو الإلزام أو الحظر أو النفي أو الحد" };
  }
  const timeA = A.filter((t) => TIME_UNITS.has(t.norm));
  const timeB = B.filter((t) => TIME_UNITS.has(t.norm));
  if (local && (timeA.length || timeB.length)) return { cls: "substantive", reason: "اختلاف في وحدة المدة", impact: "يغيّر المهلة النظامية" };

  // Extraction damage in the copy.
  if (B.some(looksGarbled)) return { cls: "ocr", reason: "حروف مشوهة أو لاتينية أو أرقام ملتصقة بالحروف في النسخة", impact: "النص المستخرج تالف في هذا الموضع ولا يصلح للاقتباس" };
  if (A.length && B.length) {
    const reversed = B.some((t) => A.some((o) => o.norm.length > 2 && [...o.norm].reverse().join("") === t.norm));
    if (reversed) return { cls: "ocr", reason: "نص معكوس الاتجاه في النسخة", impact: "النص المستخرج تالف في هذا الموضع" };
    const truncated = A.length === B.length && A.every((t, i) => B[i]!.norm.length >= 2 && B[i]!.norm.length < t.norm.length && t.norm.startsWith(B[i]!.norm));
    if (truncated) return { cls: "ocr", reason: "كلمة مبتورة في النسخة", impact: "النص المستخرج ناقص في هذا الموضع ولا يصلح للاقتباس" };
    const close = A.length === B.length && A.every((t, i) => t.norm.length > 3 && levenshtein(t.norm, B[i]!.norm) <= Math.max(1, Math.floor(t.norm.length / 4)));
    if (close) return { cls: "ocr", reason: "خطأ في حرف أو حرفين (قراءة ضوئية)", impact: "على الأرجح لا يغيّر المعنى، لكن الكلمة في النسخة خاطئة" };
  }
  if (!A.length) return { cls: "presumed_substantive", reason: "عبارة زائدة في النسخة ليست في النص الرسمي", impact: "إضافة إلى النص النظامي؛ تُعامل كمؤثرة حتى المراجعة" };
  if (!B.length) return { cls: "presumed_substantive", reason: "عبارة ساقطة من النسخة", impact: "سقوط جزء من الحكم؛ تُعامل كمؤثرة حتى المراجعة" };
  return { cls: "presumed_substantive", reason: "عبارة مختلفة", impact: "صياغة مختلفة لم يثبت تكافؤها؛ تُعامل كمؤثرة حتى المراجعة" };
}

function locatorOf(article: number, t: Tagged | undefined): string {
  if (!t || t.paragraph === 0) return `م${article}`;
  return `م${article}/ف${t.paragraph}${t.item ? `/${t.item}` : ""}`;
}

function lcsLen(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    prev = cur;
  }
  return prev[b.length]!;
}

/** «المصطلح : التعريف» rows (gazette tables) or «المصطلح: التعريف» lines (definition lists). */
const DEF_ROW = /^([^:：]{2,45}?)\s*[:：]\s+(.{3,})$/;
export function definitionRows(a: ArticleSeg): { term: string; def: string }[] {
  return a.lines
    .map((l) => l.text.match(DEF_ROW))
    .filter((m): m is RegExpMatchArray => !!m && !/^\d/.test(m[1]!.trim()) && !(m[1]!.trim() === "المصطلح" && m[2]!.trim() === "التعريف"))
    .map((m) => ({ term: m[1]!.trim(), def: m[2]!.trim() }));
}

/**
 * Definitions tables come out of PDFs scrambled (terms in one column, definitions in another). Each definition is
 * checked on its own wording; the order is ignored, but a definition no longer next to its term is reported, since the
 * copy then no longer says which term it defines.
 */
function compareDefinitions(off: ArticleSeg, B: Tagged[], ctx?: Context): { differences: Difference[]; coverage: number } {
  const rows = definitionRows(off);
  const diffs: Difference[] = [];
  const bj = joinNorm(B);
  let found = 0;
  let detached = 0;
  for (const r of rows) {
    const term = tokenize(r.term);
    const def = tokenize(r.def);
    const loc = `م${off.number}/«${r.term}»`;
    const defJ = joinNorm(def);
    if (bj.includes(defJ)) {
      found++;
      const around = bj.slice(Math.max(0, bj.indexOf(defJ) - 60), bj.indexOf(defJ) + defJ.length + 60);
      if (!around.includes(joinNorm(term))) detached++;
      continue;
    }
    let span = locateByContent(def, B);
    if (!span && def.length < 8) {
      // Short definitions: best sliding window by common words.
      let best: [number, number, number] | null = null;
      const dn = def.map((t) => t.norm);
      for (let i = 0; i + 1 < B.length; i++) {
        const w = B.slice(i, i + def.length + 2).map((t) => t.norm);
        const score = lcsLen(dn, w) / dn.length;
        if (!best || score > best[2]) best = [i, Math.min(B.length, i + def.length + 2), score];
      }
      if (best && best[2] >= 0.6) span = [best[0], best[1]];
    }
    if (!span) {
      diffs.push({ locator: loc, class: "presumed_substantive", reason: "تعريف ساقط من النسخة", official: r.def, candidate: "", impact: "سقوط تعريف مصطلح نظامي؛ يغيّر نطاق تطبيق الأحكام المحيلة إليه" });
      continue;
    }
    found++;
    const window = B.slice(span[0], span[1]);
    const ops = diffTokens(def.map((t) => t.norm), window.map((t) => t.norm));
    for (const [k, o] of ops.entries()) {
      if (o.op === "equal" || (o.op === "insert" && (k === 0 || k === ops.length - 1))) continue;
      const sa = def.slice(o.a[0], o.a[1]);
      const sb = window.slice(o.b[0], o.b[1]);
      const c = classify(sa, sb, def[o.a[0] - 1], ctx);
      diffs.push({ locator: loc, class: c.cls, reason: c.reason, official: sa.map((t) => t.raw).join(" "), candidate: sb.map((t) => t.raw).join(" "), impact: c.impact });
    }
  }
  if (detached) diffs.push({ locator: `م${off.number}`, class: "ocr", reason: `جدول التعريفات مفكك في النسخة: ${detached} من ${rows.length} تعريفًا ليس بجوار مصطلحه`, official: `${rows.length} مصطلحًا`, candidate: "", impact: "نص التعريفات موجود لكن النسخة لا تبين أي تعريف لأي مصطلح؛ لا يصلح الاستشهاد بها" });
  // Lines of the article outside the table (its opening sentence) are checked by containment.
  for (const l of off.lines) {
    if (DEF_ROW.test(l.text)) continue;
    const t = tokenize(l.text);
    if (t.length >= 3 && !bj.includes(joinNorm(t)) && !locateByContent(t, B)) diffs.push({ locator: `م${off.number}`, class: "presumed_substantive", reason: "عبارة ساقطة من النسخة", official: l.text, candidate: "", impact: "سقوط جزء من النص؛ يُعامل كمؤثر حتى المراجعة" });
  }
  return { differences: diffs, coverage: rows.length ? found / rows.length : 1 };
}

/** A span deleted here and a near-identical span inserted elsewhere in the same article: moved and damaged, same numbers. */
function pairMoved(differences: Difference[]): void {
  const dels = differences.filter((d) => !d.candidate && d.official.split(" ").length >= 3);
  const ins = differences.filter((d) => !d.official && d.candidate.split(" ").length >= 3);
  const numsOf = (s: string) => (toLatinDigits(s).match(/[0-9]+/g) ?? []).map((x) => String(Number(x))).sort().join(",");
  for (const d of dels) {
    const a = tokenize(d.official).map((t) => t.norm);
    for (const i of ins) {
      const b = tokenize(i.candidate).map((t) => t.norm);
      const sameNums = numsOf(d.official) === numsOf(i.candidate);
      const ratio = lcsLen(a, b) / Math.max(a.length, b.length);
      if (sameNums && (ratio >= 0.75 || (numsOf(d.official) !== "" && ratio >= 0.5))) {
        for (const x of [d, i]) {
          x.class = "ocr";
          x.reason = "نص منقول داخل المادة مع تشوه في الاستخراج (الأرقام نفسها)";
          x.impact = "الحكم غير مفقود لكن النسخة مشوهة في هذا الموضع؛ لا يصلح الاستشهاد بها";
        }
      }
    }
  }
}

/** Finds the copy's span holding an article whose heading is missing, by anchoring on 4-word runs of the official text. */
export function locateByContent(off: Token[], cand: Token[]): [number, number] | null {
  if (off.length < 8 || cand.length < 8) return null;
  const gram = (ts: Token[], i: number) => ts.slice(i, i + 4).map((t) => t.norm).join(" ");
  const index = new Map<string, number[]>();
  for (let i = 0; i + 4 <= cand.length; i++) {
    const g = gram(cand, i);
    const list = index.get(g);
    if (list) list.push(i);
    else index.set(g, [i]);
  }
  const votes = new Map<number, number>();
  const step = Math.max(1, Math.floor(off.length / 12));
  for (let k = 0; k + 4 <= off.length; k += step) {
    for (const p of index.get(gram(off, k)) ?? []) {
      const start = Math.round((p - k) / 5) * 5;
      votes.set(start, (votes.get(start) ?? 0) + 1);
    }
  }
  let best: [number, number] | null = null;
  for (const [start, v] of votes) if (!best || v > best[1]) best = [start, v];
  if (!best || best[1] < 2) return null;
  const from = Math.max(0, best[0] - 10);
  return [from, Math.min(cand.length, from + Math.ceil(off.length * 1.25) + 20)];
}

export function compareArticle(off: ArticleSeg, cand: ArticleSeg | undefined, candidateStream?: Token[], ctx?: Context): ArticleResult {
  const officialParagraphs = off.paragraphs.map((p) => p.number);
  let fallback: Tagged[] | null = null;
  if (!cand && candidateStream) {
    const span = locateByContent(tagTokens(off), candidateStream);
    if (span) fallback = candidateStream.slice(span[0], span[1]).map((t) => ({ ...t, paragraph: 0, item: null }));
  }
  if (!cand && !fallback) {
    return {
      article: off.number,
      outcome: "extraction_defective",
      located: "missing",
      coverage: 0,
      headingMatches: false,
      officialParagraphs,
      candidateParagraphs: [],
      differences: [{ locator: `م${off.number}`, class: "ocr", reason: "المادة غير موجودة في النسخة", official: off.body.slice(0, 200), candidate: "", impact: "النسخة ناقصة: لا يمكن الاستناد إليها في هذه المادة" }],
    };
  }
  const A = tagTokens(off);
  let B = cand ? tagTokens(cand) : fallback!;
  // A heading written as the first words of the body («أهداف اللائحة تهدف اللائحة إلى…») is the heading, not text.
  let runInHeading = false;
  if (cand && !cand.heading && off.heading) {
    const h = tokenize(off.heading).map((t) => t.norm);
    if (h.length && h.every((w, i) => B[i]?.norm === w)) {
      B = B.slice(h.length);
      runInHeading = true;
    } else if (h.length) {
      // Heading glued to the first word of the body («رهن الوقفيُحظر»).
      const hj = h.join("");
      let acc = "";
      for (let k = 0; k < Math.min(B.length, h.length + 1); k++) {
        acc += B[k]!.norm;
        if (acc.length >= hj.length) {
          if (acc.startsWith(hj) && acc.length > hj.length) {
            const rest = acc.slice(hj.length);
            B = [{ ...B[k]!, raw: rest, norm: rest }, ...B.slice(k + 1)];
            runInHeading = true;
          }
          break;
        }
      }
    }
  }
  const isDefinitions = definitionRows(off).length >= 3;
  const ops = isDefinitions ? [] : diffTokens(A.map((t) => t.norm), B.map((t) => t.norm));
  const differences: Difference[] = [];
  let equal = 0;
  let defCoverage: number | null = null;
  if (isDefinitions) {
    const r = compareDefinitions(off, B, ctx);
    differences.push(...r.differences);
    defCoverage = r.coverage;
  }
  for (const [k, o] of ops.entries()) {
    // A span found by content is cut generously: words outside the official article at its edges are not differences.
    if (!cand && o.op === "insert" && (k === 0 || k === ops.length - 1)) continue;
    if (o.op === "equal") {
      equal += o.a[1] - o.a[0];
      continue;
    }
    const sa = A.slice(o.a[0], o.a[1]);
    const sb = B.slice(o.b[0], o.b[1]);
    const c = classify(sa, sb, A[o.a[0] - 1], ctx);
    if (c.cls === "editorial") equal += sa.length;
    differences.push({
      locator: locatorOf(off.number, sa[0] ?? A[o.a[0] - 1]),
      class: c.cls,
      reason: c.reason,
      official: sa.map((t) => t.raw).join(" "),
      candidate: sb.map((t) => t.raw).join(" "),
      impact: c.impact,
    });
  }
  pairMoved(differences);
  const coverage = defCoverage ?? (A.length ? equal / A.length : 1);
  const headingMatches = !!cand && (runInHeading || (off.heading ?? "") === "" || tokenize(off.heading ?? "").map((t) => t.norm).join(" ") === tokenize(cand.heading ?? "").map((t) => t.norm).join(" "));
  const candidateParagraphs = cand ? cand.paragraphs.map((p) => p.number) : [];
  const missingParas = officialParagraphs.filter((n) => !candidateParagraphs.includes(n));
  if (!cand) {
    differences.push({ locator: `م${off.number}`, class: "ocr", reason: "عنوان المادة غير موجود في النسخة؛ عُثر على نصها بمطابقة المحتوى", official: `المادة ${off.number}`, candidate: "", impact: "لا يمكن تتبع المادة في النسخة برقمها؛ الإحالة إليها من النسخة غير موثوقة" });
  } else if (missingParas.length) {
    differences.push({ locator: `م${off.number}`, class: "ocr", reason: `ترقيم الفقرات مختلف: الفقرات ${missingParas.join("، ")} لم تُتعرف في النسخة`, official: officialParagraphs.join("، "), candidate: candidateParagraphs.join("، "), impact: "بنية المادة في النسخة لا تطابق الرسمي؛ الإحالة إلى الفقرة غير موثوقة" });
  }

  let outcome: MatchOutcome = "identical";
  const confirmed = differences.some((d) => d.class === "substantive");
  const presumed = differences.some((d) => d.class === "presumed_substantive");
  const ocr = differences.some((d) => d.class === "ocr");
  const editorial = differences.some((d) => d.class === "editorial");
  if (confirmed) outcome = "substantive_difference";
  else if (coverage < 0.9 || (ocr && !presumed)) outcome = "extraction_defective";
  else if (presumed) outcome = "substantive_difference";
  else if (ocr) outcome = "extraction_defective";
  else if (editorial || !headingMatches) outcome = "editorial_only";
  return { article: off.number, outcome, located: cand ? "heading" : "content", coverage: Math.round(coverage * 1000) / 1000, headingMatches, officialParagraphs, candidateParagraphs, differences };
}

export function compareTexts(officialText: string, candidateText: string): ComparisonResult {
  return compareSegmentations(segment(officialText), segment(candidateText), PRESENTATION_FORMS.test(candidateText), tokenize(stripMarkdown(candidateText)));
}

export function compareSegmentations(off: Segmentation, cand: Segmentation, presentationForms = false, candidateStream?: Token[]): ComparisonResult {
  const byNum = new Map(cand.articles.map((a) => [a.number, a]));
  const ctx: Context | undefined = candidateStream
    ? { officialAll: joinNorm(off.articles.flatMap((a) => tagTokens(a))), candidateAll: joinNorm(candidateStream) }
    : undefined;
  const articles = off.articles.map((a) => compareArticle(a, byNum.get(a.number), candidateStream, ctx));
  const counts = { identical: 0, editorial_only: 0, substantive_difference: 0, extraction_defective: 0, unverifiable: 0, repealed_or_superseded: 0 } as Record<MatchOutcome, number>;
  let outcome: MatchOutcome = off.articles.length ? "identical" : "unverifiable";
  for (const r of articles) {
    counts[r.outcome]++;
    outcome = worse(outcome, r.outcome);
  }
  const offNums = new Set(off.articles.map((a) => a.number));
  const extraArticles = cand.articles.map((a) => a.number).filter((n) => !offNums.has(n));
  if (extraArticles.length) outcome = worse(outcome, "extraction_defective");
  return {
    outcome,
    articlesOfficial: off.articles.length,
    articlesCandidate: cand.articles.length,
    counts,
    articles,
    extraArticles,
    officialIssues: off.issues,
    candidateIssues: cand.issues,
    candidateHasPresentationForms: presentationForms,
  };
}
