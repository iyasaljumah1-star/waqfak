/**
 * Knowledge base: text quality, splitting a reference into citable passages, and article numbers (PURE, unit-tested).
 * Nothing here rewrites a reference: the passages keep the extracted text verbatim; a normalized copy is kept apart for
 * search only.
 */
import { normalizeArabic } from "@/server/modules/ai/text";

export type TextQuality = "good" | "degraded" | "unreadable";

/**
 * Some PDFs give their Arabic text with letters in the wrong order (e.g. «املادة» for «المادة», «عىل» for «على»): the
 * text is searchable but cannot be quoted as the text of the law. Detected from the ratio of these known defect forms
 * to the correct forms; a text too short to carry the document is «unreadable» (scanned pages).
 */
export function assessQuality(text: string, opts: { expectedMinChars?: number } = {}): { quality: TextQuality; note: string; defectRatio: number } {
  const t = text.replace(/\s+/g, " ").trim();
  const min = opts.expectedMinChars ?? 1500;
  const arabic = (t.match(/[؀-ۿ]/g) ?? []).length;
  if (t.length < min || arabic < min / 2)
    return { quality: "unreadable", note: `لا نص مقروء كافٍ (${t.length} حرفًا): الملف صور ممسوحة أو بلا طبقة نصية؛ يلزم نسخة نصية رسمية.`, defectRatio: 1 };
  const count = (re: RegExp) => (t.match(re) ?? []).length;
  // known defect forms (letters reordered by the PDF) against their correct forms
  const defects = count(/(^|\s)(املادة|عىل|إىل)(?=\s|$|:)/g) + count(/(^|\s)ا(مل|جل|حل|خل)[\u0621-\u064A]/g);
  const correct = count(/(^|\s)(المادة|على|إلى)(?=\s|$|:)/g) + count(/(^|\s)ال(م|ج|ح|خ)[\u0621-\u064A]/g);
  const ratio = defects / Math.max(1, defects + correct);
  if (ratio > 0.2)
    return { quality: "degraded", note: `النص المستخرج فيه خلل ترتيب حروف معروف (نسبة ${(ratio * 100).toFixed(0)}٪): يُبحث فيه ولا يُقتبس نصًا للنظام قبل استبداله بنسخة نصية رسمية.`, defectRatio: ratio };
  return { quality: "good", note: "نص مقروء بلا خلل ظاهر في الاستخراج.", defectRatio: ratio };
}

const ONES: Record<string, number> = {
  "الأولى": 1, "الاولى": 1, "الحادية": 1, "الثانية": 2, "الثالثة": 3, "الرابعة": 4, "الخامسة": 5, "السادسة": 6, "السابعة": 7, "الثامنة": 8, "التاسعة": 9, "العاشرة": 10,
};
const TENS: Record<string, number> = {
  "العشرون": 20, "الثلاثون": 30, "الأربعون": 40, "الاربعون": 40, "الخمسون": 50, "الستون": 60, "السبعون": 70, "الثمانون": 80, "التسعون": 90,
  // the oblique forms a question uses («ما نص المادة الخامسة والعشرين؟») — stage 11, FR11-9
  "العشرين": 20, "الثلاثين": 30, "الأربعين": 40, "الاربعين": 40, "الخمسين": 50, "الستين": 60, "السبعين": 70, "الثمانين": 80, "التسعين": 90,
};
const HUNDREDS: Record<string, number> = { "المائة": 100, "المئة": 100, "المائتين": 200, "المائتني": 200, "المئتين": 200, "الثلاثمائة": 300, "الأربعمائة": 400, "الخمسمائة": 500, "الستمائة": 600, "السبعمائة": 700 };

/**
 * The number of an article from its Arabic ordinal heading («المادة الخامسة والعشرون بعد المائة» → 125), or from
 * digits («المادة (12)»). Null when not recognised — the passage then keeps its locator without a number.
 */
export function articleNumber(heading: string): number | null {
  // parse-only repair of the known extraction defects (the passage text itself is never changed)
  const h = heading.replace(/[ًٌٍَُِّْـ]/g, "").replace(/\s+/g, " ").trim()
    .replace(/(^|\s)(و?)امل/g, "$1$2الم").replace(/(^|\s)(و?)األ/g, "$1$2الأ").replace(/(^|\s)(و?)احل/g, "$1$2الح").replace(/ىل(?=\s|$|:)/g, "لى").replace(/(^|\s)(و?)الث/g, "$1$2الث");
  const digits = h.match(/المادة\s*\(?\s*(\d{1,4})\s*\)?/);
  if (digits) return Number(digits[1]);
  const m = h.match(/المادة\s+(.+?)(?::|$)/);
  if (!m) return null;
  const words = m[1].replace(/^ال/, "ال").split(" ").map((w) => w.replace(/^و/, "")).filter((w) => w && w !== "بعد");
  let total = 0;
  let any = false;
  for (const w of words) {
    if (w === "عشرة" || w === "عشر") { total += 10; any = true; continue; }
    if (ONES[w] !== undefined) { total += ONES[w]; any = true; continue; }
    if (TENS[w] !== undefined) { total += TENS[w]; any = true; continue; }
    if (HUNDREDS[w] !== undefined) { total += HUNDREDS[w]; any = true; continue; }
    if (w === "الحادي") { total += 1; any = true; continue; }
    if (w === "الثاني" || w === "الثالث" || w === "الرابع" || w === "الخامس" || w === "السادس" || w === "السابع" || w === "الثامن" || w === "التاسع") {
      total += ONES[`${w}ة`] ?? 0; any = true; continue;
    }
    if (w === "العشرون" || w === "عشرون") { total += 20; any = true; continue; }
    return any ? total : null;
  }
  return any && total > 0 ? total : null;
}

/** Bumped whenever splitPassages changes, so that loaded sources are split again. */
export const SPLITTER_VERSION = "split-2";

export type Passage = { locator: string; articleNo: number | null; text: string };

/** An article heading on its own line: «المادة الخامسة:» (or its degraded form «املادة …»). */
const ARTICLE_HEAD = /^(المادة|املادة)\s+\S[^\n]{0,80}$/;

/**
 * Splits a reference into passages: by article headings when the text has them («المادة …»), by numbered questions
 * («.16 …؟») for question-and-answer guides, by principles («المبدأ …»), else by pages. Each passage keeps its text
 * verbatim and a locator a reader can find in the source.
 */
export function splitPassages(text: string, opts: { maxChars?: number } = {}): Passage[] {
  const max = opts.maxChars ?? 2400;
  const lines = text.replace(/\r/g, "").split("\n");
  const heads: { i: number; locator: string; no: number | null }[] = [];
  lines.forEach((l, i) => {
    const clean = l.replace(/ـ+/g, "").replace(/\s+/g, " ").trim();
    if (ARTICLE_HEAD.test(clean) && clean.length < 90) heads.push({ i, locator: clean.replace(/:.*$/, "").replace(/^املادة/, "المادة"), no: articleNumber(clean.replace(/^املادة/, "المادة")) });
  });
  // a table of contents lists the headings first: a heading whose article recurs later is a contents entry, not the
  // article — it is left in the preamble instead of becoming a one-line «article» (or swallowing the preamble)
  for (let k = heads.length - 1; k >= 0; k--) {
    const h = heads[k];
    if (h.no !== null && heads.slice(k + 1).some((x) => x.no === h.no)) heads.splice(k, 1);
  }
  const out: Passage[] = [];
  const push =(locator: string, no: number | null, body: string) => {
    const t = body.trim();
    if (t.length < 20) return;
    for (let k = 0; k < t.length; k += max) out.push({ locator: k ? `${locator} (تابع)` : locator, articleNo: no, text: t.slice(k, k + max) });
  };
  if (heads.length >= 3) {
    // the preamble before the first article is kept as its own passage
    push("التمهيد", null, lines.slice(0, heads[0].i).join("\n"));
    heads.forEach((h, n) => push(h.locator, h.no, lines.slice(h.i, n + 1 < heads.length ? heads[n + 1].i : lines.length).join("\n")));
    return out;
  }
  const qs = [...text.matchAll(/(?:^|\n)\s*\.?(\d{1,3})\s*\.?\s*([^\n]{5,200}؟)/g)];
  if (qs.length >= 10) {
    let prev: { at: number; loc: string } | null = null;
    for (const q of qs) {
      if (prev) push(prev.loc, null, text.slice(prev.at, q.index));
      prev = { at: q.index ?? 0, loc: `س${q[1]}` };
    }
    if (prev) push(prev.loc, null, text.slice(prev.at));
    return out;
  }
  // pages (the extractor separates pages by a blank line)
  text.split(/\n\s*\n/).forEach((p, i) => push(`ص ${i + 1}`, null, p));
  return out;
}

/** Normalized copy of a passage for search (never shown). */
export const normForSearch = (s: string) => normalizeArabic(s).replace(/\s+/g, " ").trim();
