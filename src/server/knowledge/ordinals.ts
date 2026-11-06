/**
 * Article numbers written as ordinals («المادة الحادية والعشرون بعد السبعمائة»), read from texts whose extraction has
 * the known letter-order defect («املادة احلادية والعرشون بعد السبعامئة»). PURE, unit-tested.
 *
 * A number is given to a passage only when it is proved by the text itself (review B6/N4):
 *  - every word of the heading is a known ordinal word (or «بعد»), and the words compose one number;
 *  - the number continues the sequence: the previous heading reads n−1 AND the next reads n+1 (the first and last
 *    article need their one neighbour), and the accepted numbers are unique and strictly increasing;
 *  - the text is one instrument: if the numbering restarts (a statute bound with its regulations), no number is given
 *    anywhere, because «م5» would not say which instrument;
 *  - most headings must be proved; otherwise the numbering of the whole text is not trusted and no number is given.
 * No number is better than a wrong one: an unnumbered passage is still searchable by its words, never citable by
 * article number.
 */

/** Key that is the same for a word and its letter-swapped form: letters sorted, «ا» and «ل» removed, hamza unified. */
export function ordinalKey(word: string): string {
  const w = word
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/^و(?=ال|ا[ء-ي]ل|ا)/, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[:،.]/g, "");
  return [...w.replace(/[ال]/g, "")].sort().join("");
}

const WORDS: [string, number][] = [
  ["الأولى", 1], ["الأول", 1], ["الحادية", 1], ["الحادي", 1], ["الثانية", 2], ["الثاني", 2], ["الثالثة", 3], ["الثالث", 3],
  ["الرابعة", 4], ["الرابع", 4], ["الخامسة", 5], ["الخامس", 5], ["السادسة", 6], ["السادس", 6], ["السابعة", 7], ["السابع", 7],
  ["الثامنة", 8], ["الثامن", 8], ["التاسعة", 9], ["التاسع", 9], ["العاشرة", 10], ["العاشر", 10], ["عشرة", 10], ["عشر", 10],
  ["العشرون", 20], ["الثلاثون", 30], ["الأربعون", 40], ["الخمسون", 50], ["الستون", 60], ["السبعون", 70], ["الثمانون", 80], ["التسعون", 90],
  ["المائة", 100], ["المئة", 100], ["المائتين", 200], ["المئتين", 200], ["الثلاثمائة", 300], ["الثلاثمئة", 300], ["الأربعمائة", 400], ["الأربعمئة", 400],
  ["الخمسمائة", 500], ["الخمسمئة", 500], ["الستمائة", 600], ["الستمئة", 600], ["السبعمائة", 700], ["السبعمئة", 700], ["الثمانمائة", 800], ["الثمانمئة", 800],
  ["التسعمائة", 900], ["التسعمئة", 900],
];
const VALUE = new Map<string, number>();
for (const [w, n] of WORDS) {
  const k = ordinalKey(w);
  const prev = VALUE.get(k);
  // «العاشرة» and «عشرة» share a key; both are worth 10 wherever they stand, so the collision is harmless
  if (prev !== undefined && prev !== n) throw new Error(`ordinal key collision: ${w}`);
  VALUE.set(k, n);
}

/** Value of an ordinal heading («املادة السادسة عرشة بعد السبعامئة:»), or null if any word is not an ordinal word. */
export function ordinalHeadingValue(line: string): number | null {
  // the ordinal is what stands before the colon; a title or footnote marks may follow it («: ن)720(», «: التعريفات»)
  const m = line.trim().match(/^(?:المادة|املادة)\s+([^:()\d]+?)\s*(?::.*)?$/);
  if (!m) return null;
  const words = m[1].split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let total = 0;
  let units = 0; // a unit word seen; «عشرة» after it makes a teen
  for (const w of words) {
    if (w === "بعد") continue;
    const v = VALUE.get(ordinalKey(w));
    if (v === undefined) return null;
    if (v >= 100) total += v;
    else if (v === 10 && units) total += 10;
    else {
      total += v;
      if (v < 10) units++;
    }
  }
  return total > 0 ? total : null;
}

export type OrdinalPassage = { locator: string; articleNo: number | null; text: string };
export type OrdinalReport = { headings: number; proved: number; restarts: number; trusted: boolean; reason: string };

/**
 * Splits a statute at its ordinal article headings and gives numbers only where proved (see the module note).
 * The text after the last article (an index of articles «المادة )713(: …») and before the first stay unnumbered.
 */
export function splitOrdinalStatute(text: string, opts: { maxChars?: number; minProvedShare?: number } = {}): { passages: OrdinalPassage[]; report: OrdinalReport } {
  const max = opts.maxChars ?? 2400;
  const lines = text.split("\n");
  const heads: { i: number; v: number | null }[] = [];
  lines.forEach((l, i) => {
    const t = l.trim();
    if (/^(المادة|املادة)\s+[^\d()\s][^:]{0,60}:/.test(t) && t.length < 90) heads.push({ i, v: ordinalHeadingValue(t) });
  });
  const vals = heads.map((h) => h.v);
  const restarts = vals.filter((v, k) => v === 1 && k > 0 && vals.slice(0, k).some((x) => x !== null)).length;
  const proved = new Set<number>();
  const seen = new Map<number, number>();
  for (const v of vals) if (v !== null) seen.set(v, (seen.get(v) ?? 0) + 1);
  const at = (k: number) => (k >= 0 && k < vals.length ? vals[k] : undefined);
  heads.forEach((h, k) => {
    if (h.v === null || (seen.get(h.v) ?? 0) > 1) return; // a number read twice proves neither
    const v = h.v;
    // both neighbours must agree (n−1, n+1); the first heading must read 1 followed by 2 and 3, the last must follow
    // n−2 and n−1
    const inner = at(k - 1) === v - 1 && at(k + 1) === v + 1;
    const first = k === 0 && v === 1 && at(k + 1) === 2 && at(k + 2) === 3;
    const last = k === vals.length - 1 && at(k - 1) === v - 1 && at(k - 2) === v - 2;
    if (inner || first || last) proved.add(k);
  });
  // strictly increasing and unique among the proved
  let last = 0;
  for (const k of [...proved].sort((a, b) => a - b)) {
    if ((vals[k] as number) <= last) proved.delete(k);
    else last = vals[k] as number;
  }
  const minShare = opts.minProvedShare ?? 0.9;
  const share = heads.length ? proved.size / heads.length : 0;
  let trusted = true;
  let reason = `${proved.size} من ${heads.length} عنوان مادة ثبت رقمها بالتسلسل`;
  if (restarts) {
    trusted = false;
    reason = `الترقيم يبدأ من جديد ${restarts} مرة (أكثر من وثيقة في الملف)؛ لا يُعطى رقم مادة`;
  } else if (heads.length < 3 || share < minShare) {
    trusted = false;
    reason = `${reason} (${Math.round(share * 100)}٪ أقل من ${Math.round(minShare * 100)}٪)؛ لا يُعطى رقم مادة`;
  }
  const out: OrdinalPassage[] = [];
  const push = (locator: string, no: number | null, body: string) => {
    const t = body.trim();
    if (t.length < 20) return;
    for (let k = 0; k < t.length; k += max) out.push({ locator: k ? `${locator} (تابع)` : locator, articleNo: no, text: t.slice(k, k + max) });
  };
  if (heads.length) {
    push("التمهيد", null, lines.slice(0, heads[0].i).join("\n"));
    heads.forEach((h, k) => {
      const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
      let body = lines.slice(h.i, end);
      // after the last article: an index of articles («المادة )1(: …») is not part of it
      if (k + 1 === heads.length) {
        const idx = body.findIndex((l, j) => j > 0 && (/^(المادة|املادة)\s*\)\s*\d+\s*\(/.test(l.trim()) || /(^|\s)(الفهرس|فهرس المواد|المحتويات)\s*$/.test(l.trim())));
        if (idx > 0) {
          push("الفهرس", null, body.slice(idx).join("\n"));
          body = body.slice(0, idx);
        }
      }
      const n = trusted && proved.has(k) ? (h.v as number) : null;
      push(n !== null ? `م${n}` : `مقطع ${k + 1}`, n, body.join("\n"));
    });
  } else push("النص", null, text);
  return { passages: out, report: { headings: heads.length, proved: trusted ? proved.size : 0, restarts, trusted, reason } };
}
