/**
 * Retrieval units of the unified knowledge engine (PURE, unit-tested). A unit is what a citation points to, so its
 * locator must be one a reader can find in the source:
 *  - an official instrument: one unit per paragraph (or per article without paragraphs), «م16/ف3» — the same locators
 *    as the reference registry, so the citation guard can decide on exactly the cited paragraph;
 *  - a book, guide, study or standard: one unit per page, «ص 45 (الملف 47)» (printed page, file page), split when long;
 *  - a verified quotation (from a specialist's check against the page or the official page): kept as its own unit with
 *    the locator recorded at verification («ج10 ص31»).
 * Text is kept verbatim; only the separate search copy is normalized.
 */
import { segment } from "@/server/references/segment";

export type Unit = {
  locator: string;
  articleNo: number | null;
  paragraphNo: number | null;
  pageFile: number | null;
  pagePrinted: string | null;
  text: string;
  textOrigin: "official_text" | "text_layer" | "ocr" | "verified_quote";
};

/** Paragraph-level units of an official text (gazette snapshot). The article heading is repeated in each unit. */
export function statuteUnits(text: string): Unit[] {
  const seg = segment(text);
  const out: Unit[] = [];
  for (const a of seg.articles) {
    const head = `المادة ${a.number}${a.heading ? `: ${a.heading}` : ""}`;
    if (!a.paragraphs.length) {
      out.push({ locator: `م${a.number}`, articleNo: a.number, paragraphNo: null, pageFile: null, pagePrinted: null, text: `${head}\n${a.body}`.trim(), textOrigin: "official_text" });
      continue;
    }
    if (a.intro.trim()) out.push({ locator: `م${a.number}/ف0`, articleNo: a.number, paragraphNo: 0, pageFile: null, pagePrinted: null, text: `${head}\n${a.intro}`.trim(), textOrigin: "official_text" });
    for (const p of a.paragraphs) {
      const items = p.items.map((i) => `${i.letter}- ${i.text}`).join("\n");
      const body = items && !p.text.includes(p.items[0]!.text) ? `${p.text}\n${items}` : p.text;
      out.push({ locator: `م${a.number}/ف${p.number}`, articleNo: a.number, paragraphNo: p.number, pageFile: null, pagePrinted: null, text: `${head}\n${p.number}- ${body}`.trim(), textOrigin: "official_text" });
    }
  }
  return out;
}

export type ExtractedPage = { file: number; printed: string | null; method: "text" | "ocr"; text: string };

/** Page units of a document extracted page by page (scripts/knowledge/extract_pdf.py). */
export function pageUnits(pages: ExtractedPage[], opts: { maxChars?: number } = {}): Unit[] {
  const max = opts.maxChars ?? 2200;
  const out: Unit[] = [];
  for (const p of pages) {
    const t = p.text.trim();
    if (t.length < 40) continue;
    const loc = p.printed ? `ص ${p.printed} (الملف ${p.file})` : `صفحة الملف ${p.file}`;
    const parts: string[] = [];
    if (t.length <= max) parts.push(t);
    else {
      let cur = "";
      for (const line of t.split("\n")) {
        if (cur && cur.length + line.length + 1 > max) {
          parts.push(cur);
          cur = "";
        }
        cur = cur ? `${cur}\n${line}` : line;
      }
      if (cur) parts.push(cur);
    }
    parts.forEach((x, i) => out.push({ locator: i ? `${loc} (تابع ${i})` : loc, articleNo: null, paragraphNo: null, pageFile: p.file, pagePrinted: p.printed, text: x, textOrigin: p.method === "ocr" ? "ocr" : "text_layer" }));
  }
  return out;
}

export type VerifiedQuote = { locator: string; quote: string; verifiedHow: string; topic?: string };

/** Units from quotations verified by a specialist against the page image or the official page. */
export function quoteUnits(quotes: VerifiedQuote[]): Unit[] {
  return quotes
    .filter((q) => q.quote.trim().length >= 20)
    .map((q) => {
      const page = q.locator.match(/ص\s*(\d+)/)?.[1] ?? null;
      const art = q.locator.match(/(?:^|\s)م(?:ادة)?\s*(\d+)/)?.[1];
      return { locator: q.locator, articleNo: art ? Number(art) : null, paragraphNo: null, pageFile: null, pagePrinted: page, text: `${q.topic ? `[${q.topic}] ` : ""}${q.quote}`, textOrigin: "verified_quote" as const };
    });
}

/** Quality of a page-extracted text: OCR is searchable but never reliable enough to quote unchecked. */
export function pagesQuality(pages: ExtractedPage[]): "good" | "degraded" | "unreadable" {
  const total = pages.reduce((n, p) => n + p.text.length, 0);
  if (total < 800) return "unreadable";
  const ocr = pages.filter((p) => p.method === "ocr").reduce((n, p) => n + p.text.length, 0);
  return ocr / Math.max(1, total) > 0.3 ? "degraded" : "good";
}
