/**
 * Read-only preview of Word (docx) and Excel (xlsx) files as plain, escaped HTML — no dependency, no script, no
 * remote resource. The zip is read from its central directory and each needed part is inflated with a size cap.
 * What is shown is the text the file holds (paragraphs, headings, bold/italic, tables; sheets as tables); layout,
 * images and formulas are not reproduced, and the page says so. Pure module (unit-testable).
 */
import { inflateRawSync } from "node:zlib";

const MAX_PART = 20 * 1024 * 1024;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const xmlText = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");

/** Zip entries by name (central directory), inflated on demand. */
export function zipParts(buf: Buffer): Map<string, () => Buffer> {
  const out = new Map<string, () => Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    out.set(name, () => {
      if (usize > MAX_PART) throw new Error("part too large");
      const lnlen = buf.readUInt16LE(local + 26);
      const lelen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lnlen + lelen;
      const data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART });
      throw new Error("unsupported compression");
    });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

/** One Word paragraph (w:p) as HTML. */
function wordParagraph(xml: string): string {
  const style = attr(xml.match(/<w:pStyle [^>]*>/)?.[0] ?? "", "w:val") ?? "";
  const runs: string[] = [];
  for (const r of xml.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
    const run = r[0];
    const text = [...run.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\/>/g)].map((m) => (m[2] === "tab" ? "\t" : m[2] === "br" ? "\n" : xmlText(m[1] ?? ""))).join("");
    if (!text) continue;
    let h = esc(text);
    if (/<w:b(?: w:val="(?:1|true)")?\/>/.test(run)) h = `<strong>${h}</strong>`;
    if (/<w:i(?: w:val="(?:1|true)")?\/>/.test(run)) h = `<em>${h}</em>`;
    if (/<w:u /.test(run) && !/<w:u w:val="none"/.test(run)) h = `<u>${h}</u>`;
    runs.push(h);
  }
  const body = runs.join("");
  if (!body.trim()) return "";
  const level = /^(Heading|Titre|عنوان)\s*(\d)/i.exec(style)?.[2] ?? (/^Title$/i.test(style) ? "1" : null);
  if (level) return `<h${Math.min(4, Number(level) + 1)}>${body}</h${Math.min(4, Number(level) + 1)}>`;
  const list = /<w:numPr>/.test(xml);
  return list ? `<p class="li">• ${body}</p>` : `<p>${body}</p>`;
}

function wordBody(xml: string): string {
  const parts: string[] = [];
  // Top-level blocks in order: tables and paragraphs.
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  for (const m of body.matchAll(re)) {
    const b = m[0];
    if (b.startsWith("<w:tbl>")) {
      const rows = [...b.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((tr) =>
        `<tr>${[...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((tc) => `<td>${[...tc[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => wordParagraph(p[0])).join("") || "&nbsp;"}</td>`).join("")}</tr>`);
      parts.push(`<table>${rows.join("")}</table>`);
    } else parts.push(wordParagraph(b));
  }
  return parts.filter(Boolean).join("\n");
}

function colIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  return [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

function excelBody(parts: Map<string, () => Buffer>): { html: string; truncated: boolean } {
  const read = (n: string) => { const f = parts.get(n); return f ? f().toString("utf8") : ""; };
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(""));
  const wb = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  const sheets = [...wb.matchAll(/<sheet [^>]*\/>/g)].map((s) => ({ name: xmlText(attr(s[0], "name") ?? ""), rid: attr(s[0], "r:id") }));
  let truncated = false;
  const out: string[] = [];
  for (const s of sheets.slice(0, 5)) {
    const target = rels.match(new RegExp(`Id="${s.rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${s.rid}"`))?.[1];
    if (!target) continue;
    const xml = read(`xl/${target.replace(/^\/?xl\//, "")}`);
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 300) { truncated = true; break; }
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = c[1];
        const i = Math.min(colIndex(attr(at, "r") ?? "A1"), 40);
        const t = attr(at, "t");
        const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const inline = c[2]?.match(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/)?.[1];
        cells[i] = t === "s" && v !== undefined ? shared[Number(v)] ?? "" : t === "inlineStr" ? xmlText(inline ?? "") : v !== undefined ? xmlText(v) : "";
      }
      rows.push(Array.from(cells, (x) => x ?? ""));
    }
    const width = Math.max(0, ...rows.map((r) => r.length));
    out.push(`<h2>ورقة: ${esc(s.name)}</h2>${rows.length ? `<table>${rows.map((r) => `<tr>${Array.from({ length: width }, (_, i) => `<td>${esc(r[i] ?? "")}</td>`).join("")}</tr>`).join("")}</table>` : "<p class=\"muted\">ورقة فارغة.</p>"}`);
  }
  if (sheets.length > 5) truncated = true;
  return { html: out.join("\n"), truncated };
}

export type OfficePreview = { ok: true; html: string } | { ok: false; reason: string };

/** HTML page (full document) showing the file's text, with a note on what the preview leaves out. */
export function officePreview(buf: Buffer, kind: "docx" | "xlsx", title: string): OfficePreview {
  let parts: Map<string, () => Buffer>;
  try {
    parts = zipParts(buf);
  } catch {
    return { ok: false, reason: "تعذر قراءة الملف: بنيته غير سليمة. نزّله وافتحه في برنامجه." };
  }
  let body = "";
  let note = "";
  try {
    if (kind === "docx") {
      const doc = parts.get("word/document.xml");
      if (!doc) return { ok: false, reason: "الملف لا يحتوي على نص مستند Word يمكن عرضه." };
      body = wordBody(doc().toString("utf8"));
      note = "معاينة نصية للمستند: تظهر الفقرات والعناوين والجداول كما هي، ولا يظهر التنسيق الدقيق ولا الصور ولا الحواشي. للنسخة الأصلية نزّل الملف.";
    } else {
      const r = excelBody(parts);
      body = r.html;
      note = `معاينة لقيم الخلايا كما حُفظت في الملف (لا تُعاد الصيغ ولا التنسيق).${r.truncated ? " عُرضت أول 5 أوراق وأول 300 صف من كل ورقة." : ""} للنسخة الأصلية نزّل الملف.`;
    }
  } catch {
    return { ok: false, reason: "تعذر استخراج محتوى الملف للمعاينة (قد يكون كبيرًا جدًا أو بصيغة غير مدعومة). نزّله وافتحه في برنامجه." };
  }
  if (!body.trim()) return { ok: false, reason: "لا يحتوي الملف على نص يمكن عرضه في المعاينة. نزّله لعرضه في برنامجه." };
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:system-ui,"Segoe UI",Tahoma,sans-serif;max-width:56rem;margin:0 auto;padding:16px;line-height:1.9;color:#1b1f23;background:#fff}
.note{background:#f6f1e4;border:1px solid #e3d6b4;border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}td{border:1px solid #d5d9de;padding:4px 8px;vertical-align:top}
h1{font-size:20px}h2{font-size:18px}h3{font-size:16px}h4{font-size:15px}.li{margin-inline-start:1em}.muted{color:#666}
</style></head><body><p class="note">${esc(note)}</p><h1>${esc(title)}</h1>${body}</body></html>`;
  return { ok: true, html };
}
