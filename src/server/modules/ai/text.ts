/**
 * Arabic text processing for the local assistant engine (pure: no DB / Next imports; unit-tested in tests/ai.test.ts).
 * Normalization → tokenization → light stemming. Used for both indexing and queries so they always agree.
 */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;

/**
 * Canonical Arabic form used for matching:
 * - removes diacritics (tashkeel), Quranic marks and tatweel
 * - unifies alef forms (أ إ آ ٱ → ا), alef maqsura (ى → ي), hamza carriers (ؤ → و، ئ → ي)
 * - ta marbuta → ha (ة → ه)
 * - Arabic-Indic digits → ASCII, Latin → lower case
 */
export function normalizeArabic(input: string): string {
  return input
    .normalize("NFC")
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase();
}

const RAW_STOPWORDS = [
  "من", "في", "على", "إلى", "الى", "عن", "ما", "ماذا", "هل", "كيف", "هو", "هي", "هم", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي",
  "الذين", "اللذين", "او", "أو", "ثم", "مع", "كل", "بعد", "قبل", "عند", "لا", "لم", "لن", "ان", "أن", "إن", "كان", "كانت", "يكون",
  "تكون", "به", "بها", "له", "لها", "لي", "لك", "انا", "أنا", "نحن", "انت", "أنت", "هناك", "هنا", "اي", "أي", "متى", "لماذا", "وما",
  "فما", "قد", "ايضا", "أيضا", "حتى", "بين", "غير", "ذات", "ذو", "تم", "يتم", "وهو", "وهي", "او", "ولا", "وفي", "وعلى", "ومن",
  "اذا", "إذا", "لو", "كما", "منه", "منها", "فيه", "فيها", "عليه", "عليها", "الي", "اليه", "إليه", "لدي", "لدى", "عندي", "ممكن",
  "يمكن", "اريد", "أريد", "ابغى", "أبغى", "ابي", "ودي", "رجاء", "لو سمحت", "سمحت", "فضلك", "من فضلك", "يا", "شو", "وش", "ايش", "إيش",
  "the", "a", "an", "of", "and", "or", "to", "in", "is", "what", "how",
];
export const STOPWORDS = new Set(RAW_STOPWORDS.map(normalizeArabic));

const PREFIXES = ["وبال", "وال", "بال", "كال", "فال", "لل", "ال"];
const SUFFIXES = ["ات", "ون", "ين", "ان", "ها", "هم", "كم", "نا", "يه"];

/** Light stemmer (prefix/suffix stripping). Conservative: never leaves a stem shorter than 2-3 letters. */
export function stem(token: string): string {
  let t = token;
  if (/^[0-9a-z]+$/.test(t)) return t;
  // Up to two passes so "الالتزامات" and "التزامات" reduce to the same stem.
  for (let pass = 0; pass < 2; pass++) {
    const p = PREFIXES.find((x) => t.startsWith(x) && t.length - x.length >= 3);
    if (!p) break;
    t = t.slice(p.length);
  }
  for (const s of SUFFIXES) {
    if (t.endsWith(s) && t.length - s.length >= 3) {
      t = t.slice(0, -s.length);
      break;
    }
  }
  if (t.length >= 4 && t.endsWith("ه")) t = t.slice(0, -1); // ta marbuta (normalized to ه)
  return t;
}

/**
 * Crude root form used as a secondary match key (lower weight than the stem):
 * تفعيل → فعل (تسجيل/سجل، تحديث/حدث)، أفعل/يفعل/نفعل/تفعل → فعل (أسجل/يسجل)، فاعل → فعل (ناظر/نظر)، مفعول → فعل.
 */
export function rootOf(s: string): string {
  if (/^[0-9a-z-]+$/.test(s)) return s;
  if (s.length === 5 && s[0] === "ت" && s[3] === "ي") return s[1] + s[2] + s[4];
  if (s.length === 5 && s[0] === "م" && s[3] === "و") return s[1] + s[2] + s[4];
  if (s.length === 4 && "اينت".includes(s[0])) return s.slice(1);
  if (s.length === 4 && s[1] === "ا") return s[0] + s[2] + s[3];
  return s;
}

/** Small domain synonym list (normalized stems). Query-side only, at reduced weight. */
const SYNONYM_GROUPS = [
  ["عقوبة", "جزاء", "غرامة", "مخالفة"],
  ["مدة", "مهلة", "موعد"],
  ["مستند", "وثيقة", "وثائق"],
  ["ريع", "غلة", "عوائد"],
  ["ناظر", "نظارة"],
  ["تبرع", "تبرعات"],
].map((g) => g.map((w) => stem(normalizeArabic(w))));
export function synonymsOf(stemmed: string): string[] {
  for (const g of SYNONYM_GROUPS) if (g.includes(stemmed)) return g.filter((x) => x !== stemmed);
  return [];
}

/** Splits normalized text into raw word tokens (letters and digits; keeps codes such as REQ-001 as "req-001"). */
export function words(text: string): string[] {
  return normalizeArabic(text).match(/[a-z]+-\d+|[\p{L}\p{N}]+/gu) ?? [];
}

/** Full pipeline: normalize → split → drop stopwords and 1-letter tokens → stem. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    const s = stem(w);
    if (s.length >= 2 && !STOPWORDS.has(s)) out.push(s);
  }
  return out;
}

/** Removes Markdown syntax for display and passage extraction. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\[[ xX]\]\s*/g, "")
    .replace(/^\s*\|?\s*:?-{2,}.*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Splits plain text into sentence-like passages (Arabic and Latin punctuation, line breaks). */
export function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!؟?؛])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}
