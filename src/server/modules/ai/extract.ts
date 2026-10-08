/**
 * Best-effort document text extraction and field suggestion without external dependencies (pure; unit-tested).
 * - PDF: walks content streams (FlateDecode via zlib), reads Tj/TJ text operators, maps glyph codes through
 *   ToUnicode CMaps when present. Scanned PDFs (images) yield no text — callers show a graceful message.
 * - DOCX: minimal ZIP reader (central directory + inflateRaw) → word/document.xml → paragraphs.
 * - Plain text: UTF-8.
 * Suggestions are never applied automatically: they are stored as "suggested" and need a human decision.
 */
import { inflateRawSync, inflateSync } from "node:zlib";
import { normalizeArabic } from "./text";

const MAX_INFLATED = 8 * 1024 * 1024;
const MAX_TEXT = 60_000;

// ───────────── PDF ─────────────

function inflateSafe(buf: Buffer): Buffer | null {
  try {
    return inflateSync(buf, { maxOutputLength: MAX_INFLATED });
  } catch {
    try {
      return inflateRawSync(buf, { maxOutputLength: MAX_INFLATED });
    } catch {
      return null;
    }
  }
}

type Stream = { dict: string; data: Buffer };

function pdfStreams(pdf: Buffer): Stream[] {
  const s = pdf.toString("latin1");
  const out: Stream[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(s)) && guard++ < 2000) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    const dictStart = s.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 ? s.slice(dictStart, m.index) : "";
    let raw = pdf.subarray(start, end);
    // trim the EOL that precedes "endstream"
    while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) raw = raw.subarray(0, raw.length - 1);
    let data: Buffer | null = raw;
    if (/\/FlateDecode/.test(dict)) data = inflateSafe(raw);
    else if (/\/Filter/.test(dict)) data = null; // DCT, JBIG2… (images) are skipped
    if (data) out.push({ dict, data });
    re.lastIndex = end + 9;
  }
  return out;
}

/** Parses bfchar / bfrange sections of a ToUnicode CMap. */
export function parseCMap(src: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexToStr = (h: string) => {
    const clean = h.replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i + 4 <= clean.length; i += 4) out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
    if (clean.length % 4 === 2) out += String.fromCharCode(parseInt(clean.slice(-2), 16));
    return out;
  };
  for (const block of src.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const p of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(p[1], 16), hexToStr(p[2]));
  }
  for (const block of src.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const p of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(p[1], 16);
      const hi = Math.min(parseInt(p[2], 16), lo + 5000);
      if (p[4]) {
        const base = hexToStr(p[4]);
        for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)));
      } else if (p[5]) {
        const items = [...p[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => hexToStr(x[1]));
        items.forEach((v, i) => map.set(lo + i, v));
      }
    }
  }
  return map;
}

function decodeLiteral(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e: string) => {
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" } as Record<string, string>)[e] ?? "";
  });
}

function decodeHex(hex: string, cmap: Map<number, string> | null): string {
  const h = hex.replace(/\s+/g, "");
  if (h.toUpperCase().startsWith("FEFF")) {
    let out = "";
    for (let i = 4; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return out;
  }
  if (cmap && cmap.size) {
    let out = "";
    const width = h.length % 4 === 0 ? 4 : 2;
    for (let i = 0; i + width <= h.length; i += width) out += cmap.get(parseInt(h.slice(i, i + width), 16)) ?? "";
    return out;
  }
  let out = "";
  for (let i = 0; i + 2 <= h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return out;
}

function mapLiteral(lit: string, cmap: Map<number, string> | null): string {
  const raw = decodeLiteral(lit);
  if (!cmap || !cmap.size) return raw;
  let out = "";
  for (const ch of raw) out += cmap.get(ch.charCodeAt(0)) ?? ch;
  return out;
}

/** Extracts text from content-stream text operators (Tj, TJ, ', "). */
function textFromContent(content: string, cmap: Map<number, string> | null): string {
  const lines: string[] = [];
  let line = "";
  const tokenRe = /\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>|\[(?:\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>|[^\]])*\]\s*TJ|T\*|Td|TD|Tm|ET|Tj|'|"/g;
  let pending: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(content))) {
    const t = m[0];
    if (t.startsWith("(")) pending.push(mapLiteral(t.slice(1, -1), cmap));
    else if (t.startsWith("<")) pending.push(decodeHex(t.slice(1, -1), cmap));
    else if (t.startsWith("[")) {
      const parts = t.match(/\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]+>|-?\d+(\.\d+)?/g) ?? [];
      for (const p of parts) {
        if (p.startsWith("(")) line += mapLiteral(p.slice(1, -1), cmap);
        else if (p.startsWith("<")) line += decodeHex(p.slice(1, -1), cmap);
        else if (Number(p) < -200) line += " ";
      }
      pending = [];
    } else if (t === "Tj" || t === "'" || t === '"') {
      if (t !== "Tj" && line) {
        lines.push(line);
        line = "";
      }
      line += pending.join("");
      pending = [];
    } else if (t === "T*" || t === "Td" || t === "TD" || t === "Tm" || t === "ET") {
      pending = [];
      if (line.trim()) lines.push(line);
      line = "";
    }
  }
  if (line.trim()) lines.push(line);
  return lines.join("\n");
}

export function extractPdfText(pdf: Buffer): string {
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return "";
  const streams = pdfStreams(pdf);
  const cmapSrc = streams.map((s) => s.data.toString("latin1")).filter((t) => t.includes("begincmap"));
  const cmap = cmapSrc.length ? parseCMap(cmapSrc.join("\n")) : null;
  const parts: string[] = [];
  let total = 0;
  for (const s of streams) {
    const txt = s.data.toString("latin1");
    if (txt.includes("begincmap") || !/(Tj|TJ)/.test(txt) || !/BT[\s\S]*ET/.test(txt)) continue;
    const t = textFromContent(txt, cmap);
    if (t.trim()) {
      parts.push(t);
      total += t.length;
      if (total > MAX_TEXT) break;
    }
  }
  // Literal strings may carry UTF-8 bytes (some generators); re-decode when that yields Arabic.
  const joined = parts.join("\n");
  const asUtf8 = Buffer.from(joined, "latin1").toString("utf8");
  const text = /[؀-ۿ]/.test(asUtf8) && !asUtf8.includes("�") ? asUtf8 : joined;
  // Arabic in PDFs is often stored in visual order: presentation forms are folded to base letters.
  return text.normalize("NFKC").slice(0, MAX_TEXT);
}

// ───────────── DOCX (ZIP) ─────────────

function zipEntry(zip: Buffer, name: string): Buffer | null {
  const min = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const entryName = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (entryName === name) {
      if (zip.readUInt32LE(local) !== 0x04034b50) return null;
      const lNameLen = zip.readUInt16LE(local + 26);
      const lExtraLen = zip.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = zip.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) {
        try {
          return inflateRawSync(data, { maxOutputLength: MAX_INFLATED });
        } catch {
          return null;
        }
      }
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? "",
  );

export function extractDocxText(docx: Buffer): string {
  if (docx.readUInt32LE(0) !== 0x04034b50) return "";
  const xml = zipEntry(docx, "word/document.xml");
  if (!xml) return "";
  const s = xml.toString("utf8");
  const paras = s.split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => decodeXml(m[1])).join("")).filter((x) => x.trim());
  return paras.join("\n").slice(0, MAX_TEXT);
}

export function extractText(data: Buffer, mime: string): string {
  try {
    if (mime === "application/pdf") return extractPdfText(data);
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return extractDocxText(data);
    if (mime.startsWith("text/")) return data.toString("utf8").slice(0, MAX_TEXT);
  } catch {
    return "";
  }
  return "";
}

// ───────────── Field suggestions ─────────────

export type FieldSuggestion = { field: "number" | "issuedOn" | "issuedOnHijri" | "expiresOn" | "issuer" | "docType"; value: string; confidence: number; evidence: string };

const toAsciiDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

const pad = (n: number) => String(n).padStart(2, "0");
function isoDate(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

type DateHit = { iso: string; hijri: boolean; index: number; raw: string };

function findDates(text: string): DateHit[] {
  const out: DateHit[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)\s*(هـ|ه(?=[\s.,،)]|$)|م(?=[\s.,،)]|$))?/g)) {
    const y = Number(m[1]);
    const hijri = y >= 1300 && y < 1600;
    if (!hijri && (y < 1950 || y > 2100)) continue;
    const iso = isoDate(y, Number(m[2]), Number(m[3]));
    if (iso) out.push({ iso, hijri, index: m.index!, raw: m[0] });
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)\s*(هـ|ه(?=[\s.,،)]|$)|م(?=[\s.,،)]|$))?/g)) {
    const y = Number(m[3]);
    const hijri = y >= 1300 && y < 1600;
    if (!hijri && (y < 1950 || y > 2100)) continue;
    const iso = isoDate(y, Number(m[2]), Number(m[1]));
    if (iso) out.push({ iso, hijri, index: m.index!, raw: m[0] });
  }
  return out.sort((a, b) => a.index - b.index);
}

const near = (text: string, index: number, re: RegExp, before = 40) => re.test(normalizeArabic(text.slice(Math.max(0, index - before), index)));

const NUMBER_RE =
  /(رقم\s*(?:الصك|الوثيقة|الوثيقه|الشهادة|الشهاده|السجل|القرار|العقد|الوكالة|الوكاله|المحضر)|(?:صك|شهادة|شهاده|سجل|قرار|عقد|وكالة|وكاله)\s*رقم|الرقم\s*المرجعي|رقم\s*التسجيل|No\.?|Number)\s*[:：\-–]?\s*\(?([A-Za-z0-9][A-Za-z0-9\-/]{2,30})/gi;
const ISSUER_RE =
  /(?:صادر(?:ة|ه)?\s*(?:من|عن)|الجهة\s*المصدرة|الجهه\s*المصدره|جهة\s*الإصدار|جهة\s*الاصدار|المُصدِر|المصدر)\s*[:：\-–]?\s*([^\n،,.؛:]{3,70})/g;
const KNOWN_ISSUERS = [
  /الهيئة العامة للأوقاف(?:\s*\(تجريبي\))?/,
  /المحكمة\s+(?:العامة|الشخصية|الأحوال الشخصية)?\s*(?:ب|في)?\s*[؀-ۿ]{2,20}/,
  /كتابة\s+العدل\s*(?:الأولى|الثانية)?\s*(?:ب|في)?\s*[؀-ۿ]{0,20}/,
  /وزارة\s+العدل/,
  /منصة\s+إيجار/,
  /هيئة\s+السوق\s+المالية/,
];

/** Keyword classifier for the document type (returns null when nothing is convincing). */
export function classifyDocType(text: string): { type: string; confidence: number } | null {
  const t = normalizeArabic(text.slice(0, 6000));
  const RULES: [string, RegExp, number][] = [
    ["nazara_deed", /صك\s+(ال)?نظاره|اثبات\s+نظاره|اقامه\s+ناظر/, 0.8],
    ["waqf_deed", /صك\s+(ال)?وقف|حجه\s+وقف|وثيقه\s+(ال)?وقف|اوقف\s+وحبس|وقفا\s+مويدا/, 0.8],
    ["registration_certificate", /شهاده\s+تسجيل|شهاده\s+(ال)?قيد|registration\s+certificate/, 0.75],
    ["ownership_deed", /صك\s+(ال)?ملكيه|صك\s+تملك|سجل\s+عقاري/, 0.75],
    ["lease", /عقد\s+(ال)?ايجار|المستاجر|الموجر|lease/, 0.7],
    ["power_of_attorney", /وكاله\s+(شرعيه|خاصه|عامه)|الوكيل\s+عن|power\s+of\s+attorney/, 0.75],
    ["minutes", /محضر\s+(ال)?اجتماع|جدول\s+الاعمال|minutes/, 0.7],
    ["resolution", /قرار\s+(مجلس|الناظر|رقم)|قرر\s+المجلس/, 0.65],
    ["financial_statement", /قايمه\s+المركز\s+المالي|القوايم\s+الماليه|الموازنه\s+التقديريه|financial\s+statements?/, 0.7],
    ["bank_statement", /كشف\s+حساب|رصيد\s+افتتاحي|bank\s+statement/, 0.7],
    ["valuation", /تقرير\s+تقييم|القيمه\s+السوقيه|مقيم\s+معتمد|valuation/, 0.7],
    ["judgment", /حكم\s+(قضايي|ابتدايي|نهايي)|صك\s+حكم|حكمت\s+المحكمه/, 0.7],
    ["permission", /اذن\s+(ال)?(بيع|استبدال|صيانه|بناء)|تصريح|رخصه\s+بناء|permit/, 0.6],
    ["official_letter", /خطاب|سعاده|الموضوع\s*:|ايصال/, 0.45],
    ["bo_register", /المستفيد\s+الحقيقي|beneficial\s+owner/, 0.6],
    ["contract", /عقد|الطرف\s+الاول|الطرف\s+الثاني|contract/, 0.5],
    ["policy", /سياسه|لايحه\s+داخليه|policy/, 0.5],
  ];
  for (const [type, re, conf] of RULES) if (re.test(t)) return { type, confidence: conf };
  return null;
}

/** Suggests metadata fields from extracted text. Each suggestion carries the snippet it came from. */
export function suggestFields(rawText: string): FieldSuggestion[] {
  const text = toAsciiDigits(rawText).replace(/\r/g, "");
  const out: FieldSuggestion[] = [];
  const snippet = (i: number, len: number) => text.slice(Math.max(0, i - 30), Math.min(text.length, i + len + 30)).replace(/\s+/g, " ").trim();

  const num = [...text.matchAll(NUMBER_RE)][0];
  if (num) {
    const specific = !/^(No\.?|Number)$/i.test(num[1].trim());
    out.push({ field: "number", value: num[2].replace(/[).]+$/, ""), confidence: specific ? 0.8 : 0.55, evidence: snippet(num.index!, num[0].length) });
  }

  const dates = findDates(text);
  const expiryCtx = /(تنتهي|ينتهي|الانتهاء|انتهاء|ساري(ه)?\s+(حتي|الي)|صالح(ه)?\s+(حتي|الي)|expir)/;
  const issueCtx = /(تاريخ|بتاريخ|وتاريخ|صدر|صدرت|اصدار|حرر|date|issued)/;
  const expiry = dates.find((d) => !d.hijri && near(text, d.index, expiryCtx));
  const greg = dates.filter((d) => !d.hijri && d !== expiry);
  const issued = greg.find((d) => near(text, d.index, issueCtx)) ?? greg[0];
  if (issued) out.push({ field: "issuedOn", value: issued.iso, confidence: near(text, issued.index, issueCtx) ? 0.75 : 0.5, evidence: snippet(issued.index, issued.raw.length) });
  if (expiry) out.push({ field: "expiresOn", value: expiry.iso, confidence: 0.7, evidence: snippet(expiry.index, expiry.raw.length) });
  const hijri = dates.find((d) => d.hijri);
  if (hijri) {
    const [y, m, d] = hijri.iso.split("-");
    out.push({ field: "issuedOnHijri", value: `${y}/${m}/${d}`, confidence: /ه/.test(hijri.raw) ? 0.75 : 0.6, evidence: snippet(hijri.index, hijri.raw.length) });
  }

  const iss = [...text.matchAll(ISSUER_RE)][0];
  if (iss) out.push({ field: "issuer", value: iss[1].trim(), confidence: 0.7, evidence: snippet(iss.index!, iss[0].length) });
  else {
    for (const re of KNOWN_ISSUERS) {
      const m = re.exec(text);
      if (m) {
        out.push({ field: "issuer", value: m[0].trim(), confidence: 0.55, evidence: snippet(m.index, m[0].length) });
        break;
      }
    }
  }

  const type = classifyDocType(text);
  if (type) out.push({ field: "docType", value: type.type, confidence: type.confidence, evidence: "" });
  return out;
}
