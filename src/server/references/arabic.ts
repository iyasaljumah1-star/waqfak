/**
 * Arabic text handling for reference verification: clean-up of extraction artefacts, normalisation for comparison,
 * tokenisation, and reading of Arabic ordinal and cardinal number words. Pure functions, no I/O.
 *
 * Normalisation is only used to ALIGN texts. Whether a difference matters is decided in compare.ts on the raw tokens.
 */

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
/** Bidi marks, zero-width characters and BOM, common in gazette HTML (e.g. «1‏-»). */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿­]/g;
const ARABIC_INDIC = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;

/** Arabic presentation forms (U+FB50–U+FDFF, U+FE70–U+FEFF) only appear in text extracted from PDFs. */
export const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-ﻼ]/;

export function toLatinDigits(s: string): string {
  return s
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Removes markdown produced by the page converter: bold, headings, escapes, table rules and pipes. */
export function stripMarkdown(s: string): string {
  return s
    .split("\n")
    .filter((line) => !/^\s*\|?\s*(:?-{3,}:?\s*\|\s*)+(:?-{3,}:?)?\s*\|?\s*$/.test(line))
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\*\*/g, "")
        .replace(/\\([-\\*_.()[\]#|])/g, "$1")
        .replace(/^\s*\|(.*)\|\s*$/, (_m, inner: string) => inner.split("|").map((c) => c.trim()).filter(Boolean).join(" : ")),
    )
    .join("\n");
}

/** Character-level normalisation used for alignment (NFKC folds PDF presentation forms back to letters). */
export function normalizeChars(s: string): string {
  return toLatinDigits(s.normalize("NFKC"))
    .replace(INVISIBLE, "")
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

export type Token = {
  /** As written (after NFKC and invisible-mark removal only). */
  raw: string;
  /** Normalised for alignment. */
  norm: string;
};

/**
 * Splits into word and number tokens. Punctuation is dropped from the comparison stream: a comma or a dash never
 * changes a ruling, while every word and every number is compared. Letters glued to digits are split («200مليون»).
 */
export function tokenize(s: string): Token[] {
  const cleaned = toLatinDigits(s.normalize("NFKC")).replace(INVISIBLE, "");
  const out: Token[] = [];
  const re = /[0-9]+(?:[.,/][0-9]+)*%?|[\p{L}\p{M}]+/gu;
  for (const m of cleaned.matchAll(re)) {
    const raw = m[0];
    // «02» and «2» are the same number; leading zeros carry no meaning in a legal text.
    const norm = normalizeChars(raw).replace(/(^|[/.,])0+(?=[0-9])/g, "$1");
    if (!norm) continue;
    out.push({ raw, norm });
  }
  return out;
}

// ───────────── Number words ─────────────

const UNITS_FEM: Record<string, number> = {
  الاولي: 1, الاول: 1, الحاديه: 1, الحادي: 1,
  الثانيه: 2, الثاني: 2,
  الثالثه: 3, الثالث: 3,
  الرابعه: 4, الرابع: 4,
  الخامسه: 5, الخامس: 5,
  السادسه: 6, السادس: 6,
  السابعه: 7, السابع: 7,
  الثامنه: 8, الثامن: 8,
  التاسعه: 9, التاسع: 9,
  العاشره: 10, العاشر: 10,
};
const TENS: Record<string, number> = {
  العشرون: 20, العشرين: 20,
  الثلاثون: 30, الثلاثين: 30,
  الاربعون: 40, الاربعين: 40,
  الخمسون: 50, الخمسين: 50,
  الستون: 60, الستين: 60,
  السبعون: 70, السبعين: 70,
  الثمانون: 80, الثمانين: 80,
  التسعون: 90, التسعين: 90,
};

/**
 * Reads an Arabic ordinal written in words («الحادية والعشرون», «الثالثة عشرة», «المائة بعد العاشرة» is not used in
 * Saudi statutes; «العاشرة بعد المائة» is). Returns null when the words are not a complete ordinal.
 */
export function parseOrdinal(words: string): number | null {
  const w = normalizeChars(words).replace(/[()«»"]/g, " ").replace(/\s+/g, " ").trim();
  if (!w) return null;
  let hundreds = 0;
  let rest = w;
  const hundred = rest.match(/^(.*?)\s*بعد\s+الما(?:ي|ئ)?ه$/);
  if (hundred) {
    hundreds = 100;
    rest = hundred[1]!.trim();
    if (!rest) return null;
  } else if (/^الما(?:ي|ئ)?ه$/.test(rest)) {
    return 100;
  }
  const parts = rest.split(" ");
  if (parts.length === 1) {
    const p = parts[0]!;
    if (p in UNITS_FEM) return hundreds + UNITS_FEM[p]!;
    if (p in TENS) return hundreds + TENS[p]!;
    return null;
  }
  if (parts.length === 2) {
    const a = parts[0]!;
    const b = parts[1]!.startsWith("و") ? parts[1]!.slice(1) : parts[1]!;
    const u = UNITS_FEM[a];
    if (!u || u >= 10) return null;
    // «الثالثة عشرة» → 13
    if (b === "عشره" || b === "عشر") return hundreds + 10 + u;
    // «الحادية والعشرون» → 21
    const t = TENS[b];
    if (t) return hundreds + t + u;
  }
  return null;
}

const CARDINAL: Record<string, number> = {
  صفر: 0, واحد: 1, واحده: 1, احد: 1, احدي: 1, اثنان: 2, اثنين: 2, اثنتان: 2, اثنتين: 2,
  ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7,
  ثمان: 8, ثماني: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10,
  عشرون: 20, عشرين: 20, ثلاثون: 30, ثلاثين: 30, اربعون: 40, اربعين: 40, خمسون: 50, خمسين: 50,
  ستون: 60, ستين: 60, سبعون: 70, سبعين: 70, ثمانون: 80, ثمانين: 80, تسعون: 90, تسعين: 90,
  مايه: 100, مائه: 100, ماييه: 100, مايتان: 200, مايتين: 200, ثلاثمايه: 300, اربعمايه: 400, خمسمايه: 500,
  ستمايه: 600, سبعمايه: 700, ثمانمايه: 800, تسعمايه: 900,
  الف: 1000, الفا: 1000, الفان: 2000, الفين: 2000, الاف: 1000, مليون: 1_000_000, ملايين: 1_000_000,
};
// «مئة» is also written «مائة»; both spellings of every hundred.
for (const [w, v] of Object.entries({ "": 100, ثلاث: 300, اربع: 400, خمس: 500, ست: 600, سبع: 700, ثمان: 800, تسع: 900 })) {
  CARDINAL[`${w}ميه`] = v;
  CARDINAL[`${w}مايه`] = v;
}

/** True when the normalised token is a cardinal number word (with or without the conjunction «و»). */
export function isCardinalWord(norm: string): boolean {
  return norm in CARDINAL || (norm.startsWith("و") && norm.slice(1) in CARDINAL);
}

/**
 * Value of a run of cardinal words or digits («خمسة عشر» = «خمسة عشرة» = 15, «خمسمائة ألف» = 500000). Returns null
 * when a token is not numeric. Used to tell a grammatical variant (same value) from a changed number.
 */
export function cardinalValue(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  for (const t0 of tokens) {
    if (/^[0-9]+$/.test(t0)) {
      current += Number(t0);
      continue;
    }
    const t = t0 in CARDINAL ? t0 : t0.startsWith("و") ? t0.slice(1) : t0;
    const v = CARDINAL[t];
    if (v === undefined) return null;
    if (v >= 1000) {
      total += (current || 1) * v;
      current = 0;
    } else if (v === 10 && current > 0 && current < 10) {
      current += 10; // «خمسة عشر»
    } else {
      current += v;
    }
  }
  return total + current;
}

/** Value of an ordinal phrase from normalised tokens, accepting a leading «المادة»-free run. */
export function ordinalValue(tokens: string[]): number | null {
  if (tokens.length === 0 || tokens.length > 4) return null;
  const v = parseOrdinal(tokens.join(" "));
  if (v !== null || tokens.length !== 1 || !tokens[0]!.startsWith("و")) return v;
  return parseOrdinal(tokens[0]!.slice(1));
}

/** True when the token is (part of) an ordinal written in words. */
export function isOrdinalWord(norm: string): boolean {
  return ordinalValue([norm]) !== null || norm === "عشره" || norm === "عشر";
}
