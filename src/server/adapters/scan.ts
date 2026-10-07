/**
 * File-type sniffing and content scanning for uploads.
 *
 * Pure module (no Next.js / DB imports) so it is unit-testable and reusable from jobs.
 *
 * Pipeline used by POST /api/files:
 *   1. sniffFile(): detect the real type from the bytes (file-type) and compare it with the claimed
 *      extension. Unknown/unsupported types and mismatches are refused before anything is stored.
 *   2. The blob is stored encrypted with the version in scan status "pending" (document "quarantine").
 *   3. scanFile(): built-in rules, then the optional external engine. Result "clean" activates the
 *      document; "rejected" marks it rejected (never served); "error" keeps it in quarantine.
 *
 * External antivirus (later): set SCAN_PROVIDER=<name> and call registerScanner({ name, scan }) at
 * startup (for example a ClamAV INSTREAM client or a cloud AV API). The built-in rules always run first.
 * If SCAN_PROVIDER names a scanner that is not registered, scanning fails closed (stays in quarantine).
 * SCAN_PROVIDER unset or "builtin" means built-in rules only.
 */
import { inflateSync } from "node:zlib";
import { fileTypeFromBuffer } from "file-type";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export type FileKind = "pdf" | "png" | "jpg" | "webp" | "docx" | "xlsx" | "txt";

export const FILE_KINDS: Record<FileKind, { mime: string; exts: string[]; label: string }> = {
  pdf: { mime: "application/pdf", exts: ["pdf"], label: "PDF" },
  png: { mime: "image/png", exts: ["png"], label: "PNG" },
  jpg: { mime: "image/jpeg", exts: ["jpg", "jpeg"], label: "JPEG" },
  webp: { mime: "image/webp", exts: ["webp"], label: "WebP" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", exts: ["docx"], label: "Word" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", exts: ["xlsx"], label: "Excel" },
  txt: { mime: "text/plain", exts: ["txt"], label: "نص" },
};

/** For <input accept>. */
export const ACCEPT_ATTR = Object.values(FILE_KINDS).flatMap((k) => [k.mime, ...k.exts.map((e) => `.${e}`)]).join(",");

export const kindFromMime = (mime: string): FileKind | null =>
  (Object.entries(FILE_KINDS).find(([, v]) => v.mime === mime)?.[0] as FileKind | undefined) ?? null;

export type SniffResult =
  | { ok: true; kind: FileKind; mime: string; ext: string }
  | { ok: false; code: "empty" | "too_large" | "unsupported" | "mismatch" | "no_extension"; message: string };

export function extOf(name: string) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** UTF-8 text without NUL/control bytes (tabs, newlines and CR allowed). */
export function looksLikeText(buf: Buffer) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return false;
  }
  const sample = buf.subarray(0, 8192);
  let ctrl = 0;
  for (const b of sample) if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c) ctrl++;
  return ctrl === 0;
}

export async function sniffFile(buf: Buffer, originalName: string): Promise<SniffResult> {
  if (!buf.length) return { ok: false, code: "empty", message: "الملف فارغ. اختر ملفًا يحتوي على بيانات." };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, code: "too_large", message: "حجم الملف أكبر من 15 ميغابايت. اضغط الملف أو قسّمه ثم أعد الرفع." };
  const ext = extOf(originalName);
  if (!ext) return { ok: false, code: "no_extension", message: "اسم الملف بلا امتداد. أعد تسمية الملف بامتداده الصحيح (مثل ‎.pdf) ثم أعد الرفع." };
  const ft = await fileTypeFromBuffer(buf);
  let kind: FileKind | null = null;
  if (ft) {
    kind = (Object.entries(FILE_KINDS).find(([, v]) => v.mime === ft.mime)?.[0] as FileKind | undefined) ?? null;
    if (!kind) return { ok: false, code: "unsupported", message: "نوع الملف غير مقبول. الأنواع المقبولة: PDF وPNG وJPEG وWebP وWord (docx) وExcel (xlsx) والنص." };
  } else if (looksLikeText(buf)) {
    kind = "txt";
  } else {
    return { ok: false, code: "unsupported", message: "تعذر التعرف على نوع الملف. الأنواع المقبولة: PDF وPNG وJPEG وWebP وWord (docx) وExcel (xlsx) والنص." };
  }
  if (!FILE_KINDS[kind].exts.includes(ext)) {
    // A text body under a non-.txt name (e.g. HTML renamed to .pdf) lands here too.
    return { ok: false, code: "mismatch", message: `محتوى الملف لا يطابق امتداده (‎.${ext}). ارفع الملف الأصلي دون تغيير امتداده.` };
  }
  return { ok: true, kind, mime: FILE_KINDS[kind].mime, ext };
}

// ───────────── Content scanning ─────────────

export type ScanVerdict =
  | { status: "clean"; engine: string }
  | { status: "rejected"; engine: string; code: string; reason: string }
  | { status: "error"; engine: string; reason: string };

export interface ExternalScanner {
  name: string;
  scan(buf: Buffer, kind: FileKind): Promise<ScanVerdict>;
}

const scanners = new Map<string, ExternalScanner>();
export function registerScanner(s: ExternalScanner) {
  scanners.set(s.name, s);
}

function magicMatches(buf: Buffer, kind: FileKind): boolean {
  switch (kind) {
    case "pdf":
      return buf.subarray(0, 1024).includes("%PDF-");
    case "png":
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "jpg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "webp":
      return buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
    case "docx":
    case "xlsx":
      return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    case "txt":
      return looksLikeText(buf);
  }
}

/** PDF names may hex-escape characters (/J#61vaScript); normalise before matching. */
const decodePdfNames = (s: string) => s.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const PDF_RULES: { code: string; re: RegExp; reason: string }[] = [
  { code: "pdf_javascript", re: /\/(JavaScript|JS)(?![A-Za-z0-9])/, reason: "الملف يحتوي على شيفرة JavaScript مضمّنة" },
  { code: "pdf_launch", re: /\/Launch(?![A-Za-z0-9])/, reason: "الملف يحتوي على أمر لتشغيل برامج خارجية (Launch)" },
  { code: "pdf_embedded_file", re: /\/EmbeddedFiles?(?![A-Za-z0-9])/, reason: "الملف يحتوي على ملفات مضمّنة داخله" },
];

function* pdfStreams(raw: string, limit = 300) {
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(raw)) && n++ < limit) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    yield raw.slice(start, end);
    re.lastIndex = end;
  }
}

export function scanPdf(buf: Buffer): ScanVerdict {
  const raw = buf.toString("latin1");
  const texts = [decodePdfNames(raw)];
  // Object streams are usually Flate-compressed: inflate them (bounded) so rules see their content.
  let budget = 50 * 1024 * 1024;
  for (const s of pdfStreams(raw)) {
    if (budget <= 0) break;
    try {
      const out = inflateSync(Buffer.from(s, "latin1"), { maxOutputLength: Math.min(budget, 10 * 1024 * 1024) });
      budget -= out.length;
      texts.push(decodePdfNames(out.toString("latin1")));
    } catch {
      /* not a flate stream (images, fonts…) */
    }
  }
  for (const t of texts)
    for (const r of PDF_RULES) if (r.re.test(t)) return { status: "rejected", engine: "builtin", code: r.code, reason: r.reason };
  return { status: "clean", engine: "builtin" };
}

export function scanOoxml(buf: Buffer): ScanVerdict {
  const raw = buf.toString("latin1");
  if (/vbaProject\.bin/i.test(raw) || /macroEnabled/i.test(raw))
    return { status: "rejected", engine: "builtin", code: "ooxml_macro", reason: "الملف يحتوي على وحدات ماكرو (VBA)" };
  if (/activeX\/activeX\d*\.bin/i.test(raw))
    return { status: "rejected", engine: "builtin", code: "ooxml_activex", reason: "الملف يحتوي على عناصر ActiveX" };
  return { status: "clean", engine: "builtin" };
}

/** Built-in rules only (synchronous, deterministic). */
export function builtinScan(buf: Buffer, kind: FileKind): ScanVerdict {
  if (!magicMatches(buf, kind)) return { status: "rejected", engine: "builtin", code: "magic_mismatch", reason: "توقيع الملف لا يطابق نوعه" };
  if (kind === "pdf") return scanPdf(buf);
  if (kind === "docx" || kind === "xlsx") return scanOoxml(buf);
  return { status: "clean", engine: "builtin" };
}

export async function scanFile(buf: Buffer, kind: FileKind, provider = process.env.SCAN_PROVIDER): Promise<ScanVerdict> {
  const b = builtinScan(buf, kind);
  if (b.status !== "clean" || !provider || provider === "builtin") return b;
  const ext = scanners.get(provider);
  if (!ext) return { status: "error", engine: provider, reason: `scanner "${provider}" is not registered` };
  try {
    return await ext.scan(buf, kind);
  } catch (e) {
    return { status: "error", engine: provider, reason: e instanceof Error ? e.message : String(e) };
  }
}
