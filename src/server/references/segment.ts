/**
 * Splits a statute or regulation into articles, paragraphs and items with stable locators. Works on the gazette page
 * (markdown) and on knowledge-base copies extracted from PDFs (tables of contents, page headers, run-in titles).
 */
import { normalizeChars, parseOrdinal, stripMarkdown, toLatinDigits } from "./arabic";
import type { RefUnit } from "./types";

export type ParagraphSeg = { number: number; text: string; items: { letter: string; text: string }[] };

export type ArticleSeg = {
  number: number;
  heading: string | null;
  /** Full article text without its heading. */
  body: string;
  /** Text before the first numbered paragraph (an article may have no paragraphs at all). */
  intro: string;
  paragraphs: ParagraphSeg[];
  /** Index of the heading line in the cleaned text (for diagnostics). */
  line: number;
  /** Body lines tagged with the paragraph and item they belong to (paragraph 0 = text before the first paragraph). */
  lines: { text: string; paragraph: number; item: string | null }[];
};

export type Segmentation = {
  articles: ArticleSeg[];
  /** Structural problems found while splitting (missing or duplicated articles, out of order). */
  issues: string[];
};

const FOOTER = /جميع الحقوق محفوظة/;
const CHAPTER = /^\s*الفصل\s+[^\s:]+(?:\s+[^\s:]+)?\s*:/;
const ITEM_LETTERS = ["أ", "ب", "ج", "د", "هـ", "ه", "و", "ز", "ح", "ط", "ي", "ك", "ت", "ث"] as const;

/** «المادة الحادية عشرة:» / «1 المادة الأول :» (table of contents) / «المادة (12)». */
function headingOf(line: string): { number: number; rest: string } | null {
  // PDF copies stretch words with tatweel and scatter diacritics («المــــادة الرابعــــة عشــــرة»).
  const l = toLatinDigits(line.normalize("NFKC")).replace(/[\u0640\u064B-\u065F\u0670\u200E\u200F]/g, "").trim();
  const m = l.match(/^(?:[0-9.]+\s+|[ء-ي]{1,2}\s+)?(?:[(«])?المادة\s+(.+)$/);
  if (!m) return null;
  const after = m[1]!;
  const numeric = after.match(/^\(?\s*([0-9]{1,3})\s*\)?\s*(?:[:：-]\s*(.*))?$/);
  if (numeric) return { number: Number(numeric[1]), rest: (numeric[2] ?? "").trim() };
  const colon = after.search(/[:：]/);
  const words = (colon >= 0 ? after.slice(0, colon) : after).replace(/[)»]/g, "").trim();
  const rest = colon >= 0 ? after.slice(colon + 1).trim() : "";
  // The ordinal is at most five words; anything longer is a sentence that mentions an article.
  const parts = words.split(/\s+/);
  for (let n = Math.min(5, parts.length); n >= 1; n--) {
    const v = parseOrdinal(parts.slice(0, n).join(" "));
    if (v !== null) {
      if (n < parts.length && colon < 0) {
        // «المادة الخامسة من هذه اللائحة» inside a sentence: not a heading.
        const tail = parts.slice(n).join(" ");
        if (tail.length > 40 || /^(من|في|وفق|الواردة|المشار)/.test(tail)) return null;
        return { number: v, rest: tail };
      }
      if (n < parts.length) return null;
      return { number: v, rest };
    }
  }
  return null;
}

const PARA = /^\s*(?:\.?0?([0-9]{1,2})\s*[-–)](?!\d)|0?([0-9]{1,2})\.\s|\.0?([0-9]{1,2})(?=\s|\p{L})|0([1-9])\s)\s*/u;
function paragraphMarker(line: string): { number: number; text: string } | null {
  const l = toLatinDigits(line).replace(/[‎‏]/g, "");
  const m = l.match(PARA);
  if (!m) return null;
  const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
  if (!n || n > 60) return null;
  return { number: n, text: l.slice(m[0].length).trim() };
}

function itemMarker(line: string): { letter: string; text: string } | null {
  const l = line.replace(/[‎‏‌]/g, "").trim();
  for (const letter of ITEM_LETTERS) {
    const re = new RegExp(`^(?:\\()?${letter}(?:\\))?\\s*[-–.)](?!\\d)\\s*`);
    const m = l.match(re);
    if (m) return { letter: letter === "ه" ? "هـ" : letter, text: l.slice(m[0].length).trim() };
  }
  return null;
}

/** Splits a run-in title from the first paragraph: «تعيين الناظر 1- يجوز للواقف…». */
function splitRunIn(text: string): { title: string | null; body: string } {
  const m = toLatinDigits(text).match(/^(.{2,60}?)\s+(1\s*[-–)]\s*[\s\S]*)$/);
  if (m && !/[.،؛]/.test(m[1]!)) return { title: m[1]!.trim(), body: m[2]! };
  return { title: null, body: text };
}

function looksLikeTitle(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 60 && !paragraphMarker(t) && !itemMarker(t) && !/[.،؛:]$/.test(t) && !/[.،؛]/.test(t);
}

type Raw = { number: number; heading: string | null; lines: string[]; line: number };

/** A bold run-in title on the gazette page («**الامتثال للجهة الإشرافية** يجب على…») goes on its own line. */
function splitBoldRunIn(md: string): string {
  return md.replace(/^\*\*([^*\n]{2,60})\*\*[ \t]+(?=\S)/gm, (m, title: string) => (/^\s*المادة\s/.test(title) ? m : `**${title.trim()}**\n`));
}

/**
 * Paragraph and item markers written inside a line by PDF extraction («…بالآتي: .1التعاقد…», «أ. انتهاء … ب. أي
 * تغير…») start a new line, so paragraphs are recognised in copies as they are on the gazette page.
 */
function splitInlineMarkers(line: string): string[] {
  return line
    .replace(/([^\s])\s+(?=(?:\.[0-9]{1,2}(?=\p{L})|[0-9]{1,2}\s*[-–]\s*\p{L}))/gu, "$1\n")
    .replace(/([.:؛،])\s*(?=\.[0-9]{1,2}\p{L})/gu, "$1\n")
    .replace(/([.:؛])\s+(?=(?:أ|ب|ج|د|هـ|و|ز|ح|ط)\s*[.-]\s)/gu, "$1\n")
    .split("\n");
}

export function segment(input: string): Segmentation {
  const lines = stripMarkdown(splitBoldRunIn(input)).split("\n").flatMap(splitInlineMarkers);
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  let skipNextTitle = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FOOTER.test(line)) {
      cur = null;
      continue;
    }
    if (CHAPTER.test(line)) {
      // A chapter title on the next line belongs to the chapter, not to the article before it.
      skipNextTitle = line.replace(CHAPTER, "").trim().length === 0;
      continue;
    }
    if (skipNextTitle && line.trim()) {
      skipNextTitle = false;
      if (looksLikeTitle(line) && !headingOf(line)) continue;
    }
    const h = headingOf(line);
    if (h && cur && h.number === cur.number) {
      // The same heading repeated right after itself is a page break in a PDF, not a new article.
      if (h.rest && !looksLikeTitle(h.rest)) cur.lines.push(h.rest);
      continue;
    }
    if (h) {
      cur = { number: h.number, heading: null, lines: [], line: i };
      raws.push(cur);
      if (h.rest) {
        if (looksLikeTitle(h.rest)) cur.heading = h.rest;
        else {
          const r = splitRunIn(h.rest);
          cur.heading = r.title;
          cur.lines.push(r.body);
        }
      }
      continue;
    }
    if (!cur) continue;
    if (!line.trim()) continue;
    if (cur.heading === null && cur.lines.length === 0) {
      if (looksLikeTitle(line)) {
        cur.heading = line.trim();
        continue;
      }
      const r = splitRunIn(line.trim());
      if (r.title) {
        cur.heading = r.title;
        cur.lines.push(r.body);
        continue;
      }
    }
    cur.lines.push(line.trim());
  }

  // Tables of contents repeat every heading with no body: keep, per number, the occurrence with the longest body.
  const issues: string[] = [];
  const best = new Map<number, Raw>();
  const substantial = new Map<number, number>();
  for (const r of raws) {
    const len = r.lines.join(" ").length;
    if (len > 200) substantial.set(r.number, (substantial.get(r.number) ?? 0) + 1);
    const prev = best.get(r.number);
    if (!prev || len > prev.lines.join(" ").length) best.set(r.number, r);
  }
  for (const [n, c] of substantial) if (c > 1) issues.push(`المادة ${n}: وردت بنصين مختلفين أو أكثر في الملف`);

  const articles = [...best.values()]
    .filter((r) => r.lines.join(" ").trim().length > 0)
    .sort((a, b) => a.number - b.number)
    .map(buildArticle);
  const order = [...best.values()].filter((r) => r.lines.length).sort((a, b) => a.line - b.line).map((r) => r.number);
  for (let i = 1; i < order.length; i++) if (order[i]! < order[i - 1]!) {
    issues.push(`ترتيب المواد في الملف غير متسلسل عند المادة ${order[i]}`);
    break;
  }
  if (articles.length) {
    const max = articles[articles.length - 1]!.number;
    const have = new Set(articles.map((a) => a.number));
    const missing: number[] = [];
    for (let n = 1; n <= max; n++) if (!have.has(n)) missing.push(n);
    if (missing.length) issues.push(`مواد لم يُعثر على نصها: ${missing.join("، ")}`);
  }
  return { articles, issues };
}

function buildArticle(r: Raw): ArticleSeg {
  const paragraphs: ParagraphSeg[] = [];
  const intro: string[] = [];
  const tagged: ArticleSeg["lines"] = [];
  let p: ParagraphSeg | null = null;
  let item: string | null = null;
  for (const line of r.lines) {
    const pm = paragraphMarker(line);
    if (pm && (!p || pm.number === p.number + 1 || (pm.number === 1 && !p))) {
      p = { number: pm.number, text: pm.text, items: [] };
      paragraphs.push(p);
      item = null;
      tagged.push({ text: line, paragraph: p.number, item: null });
      continue;
    }
    const im = itemMarker(line);
    if (im) {
      item = im.letter;
      if (p) {
        p.items.push(im);
        p.text += (p.text ? "\n" : "") + line;
      } else intro.push(line);
      tagged.push({ text: line, paragraph: p?.number ?? 0, item });
      continue;
    }
    // A line after the items («وتتحقق الجهة المختصة…») is kept with the paragraph, never attached to the last item:
    // the source does not say which unit it closes, so it is cited at paragraph level only.
    item = null;
    if (p) p.text += (p.text ? "\n" : "") + line;
    else intro.push(line);
    tagged.push({ text: line, paragraph: p?.number ?? 0, item: null });
  }
  return { number: r.number, heading: r.heading, body: r.lines.join("\n"), intro: intro.join("\n"), paragraphs, line: r.line, lines: tagged };
}

/** Flattens a segmentation into citable units: the article, each paragraph, each item. */
export function toUnits(seg: Segmentation): RefUnit[] {
  const units: RefUnit[] = [];
  for (const a of seg.articles) {
    units.push({ locator: `م${a.number}`, article: a.number, paragraph: null, item: null, heading: a.heading, text: a.body });
    if (a.intro && a.paragraphs.length) units.push({ locator: `م${a.number}/ف0`, article: a.number, paragraph: 0, item: null, heading: a.heading, text: a.intro });
    for (const p of a.paragraphs) {
      units.push({ locator: `م${a.number}/ف${p.number}`, article: a.number, paragraph: p.number, item: null, heading: a.heading, text: p.text });
      for (const it of p.items) units.push({ locator: `م${a.number}/ف${p.number}/${it.letter}`, article: a.number, paragraph: p.number, item: it.letter, heading: a.heading, text: it.text });
    }
  }
  return units;
}

/** Normalised fingerprint of a text, for quick equality checks. */
export function fingerprint(s: string): string {
  return normalizeChars(stripMarkdown(s)).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
