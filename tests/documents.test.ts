import "dotenv/config";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { builtinScan, MAX_UPLOAD_BYTES, scanFile, sniffFile, registerScanner } from "../src/server/adapters/scan";
import { decryptBuffer, encryptBuffer, newDataKey, sha256, unwrapDataKey } from "../src/server/lib/crypto";
import { assertKey, LocalDiskStorage, newStorageKey } from "../src/server/adapters/storage";

// ───────────── fixtures ─────────────
const pdf = (body = "") =>
  Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R ${body} >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, "latin1");

const pdfWithStream = (content: string) => {
  const z = deflateSync(Buffer.from(content, "latin1"));
  return Buffer.concat([
    Buffer.from(`%PDF-1.7\n3 0 obj << /Type /ObjStm /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, "latin1"),
    z,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
};

/** Minimal stored (uncompressed) ZIP writer — enough for OOXML type detection. */
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const ct = (main: string, extra = "") =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="${main}"/>${extra}</Types>`;
const DOCX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const docx = (extra: Record<string, string> = {}) => zip({ "[Content_Types].xml": ct(DOCX_MAIN), "word/document.xml": "<w:document/>", ...extra });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from("IHDR"),
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]),
]);

// ───────────── sniffing ─────────────
describe("sniffFile (real type vs claimed extension)", () => {
  it("accepts a real PDF", async () => {
    const r = await sniffFile(pdf(), "صك الوقف.pdf");
    expect(r).toMatchObject({ ok: true, kind: "pdf", mime: "application/pdf" });
  });
  it("rejects HTML renamed to .pdf", async () => {
    const r = await sniffFile(Buffer.from("<!doctype html><html><script>alert(1)</script></html>"), "invoice.pdf");
    expect(r).toMatchObject({ ok: false, code: "mismatch" });
  });
  it("rejects a PNG claimed as .pdf, accepts it as .png", async () => {
    expect(await sniffFile(png, "x.pdf")).toMatchObject({ ok: false, code: "mismatch" });
    expect(await sniffFile(png, "x.PNG")).toMatchObject({ ok: true, kind: "png" });
  });
  it("detects docx from the zip content and refuses it as .xlsx", async () => {
    expect(await sniffFile(docx(), "a.docx")).toMatchObject({ ok: true, kind: "docx" });
    expect(await sniffFile(docx(), "a.xlsx")).toMatchObject({ ok: false, code: "mismatch" });
  });
  it("accepts UTF-8 text only as .txt and refuses binary noise", async () => {
    expect(await sniffFile(Buffer.from("ملاحظات الناظر\nسطر ثانٍ"), "n.txt")).toMatchObject({ ok: true, kind: "txt" });
    expect(await sniffFile(Buffer.from([0, 1, 2, 3, 250, 251, 252]), "n.txt")).toMatchObject({ ok: false, code: "unsupported" });
  });
  it("refuses unsupported types, empty files, oversize files and missing extensions", async () => {
    expect(await sniffFile(zip({ "a.txt": "x" }), "a.zip")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await sniffFile(Buffer.alloc(0), "a.pdf")).toMatchObject({ ok: false, code: "empty" });
    expect(await sniffFile(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "a.pdf")).toMatchObject({ ok: false, code: "too_large" });
    expect(await sniffFile(pdf(), "noext")).toMatchObject({ ok: false, code: "no_extension" });
  });
});

// ───────────── scanning ─────────────
describe("builtinScan rules", () => {
  it("passes a plain PDF", () => {
    expect(builtinScan(pdf(), "pdf").status).toBe("clean");
  });
  it.each([
    ["/OpenAction << /S /JavaScript /JS (app.alert(1)) >>", "pdf_javascript"],
    ["/OpenAction << /S /J#61vaScript >>", "pdf_javascript"],
    ["/OpenAction << /S /Launch /F (cmd.exe) >>", "pdf_launch"],
    ["/Names << /EmbeddedFiles 5 0 R >>", "pdf_embedded_file"],
  ])("rejects PDF with %s", (body, code) => {
    const v = builtinScan(pdf(body), "pdf");
    expect(v.status).toBe("rejected");
    expect(v.status === "rejected" && v.code).toBe(code);
  });
  it("finds JavaScript hidden inside a compressed object stream", () => {
    const v = builtinScan(pdfWithStream("<< /S /JavaScript /JS (x) >>"), "pdf");
    expect(v).toMatchObject({ status: "rejected", code: "pdf_javascript" });
    expect(builtinScan(pdfWithStream("<< /Type /Page >>"), "pdf").status).toBe("clean");
  });
  it("does not flag look-alike names", () => {
    expect(builtinScan(pdf("/JSONData (x) /Launcher 1"), "pdf").status).toBe("clean");
  });
  it("rejects docx/xlsx with macros", () => {
    expect(builtinScan(docx(), "docx").status).toBe("clean");
    expect(builtinScan(docx({ "word/vbaProject.bin": "VBA" }), "docx")).toMatchObject({ status: "rejected", code: "ooxml_macro" });
    expect(builtinScan(docx({ "xl/vbaProject.bin": "VBA" }), "xlsx")).toMatchObject({ status: "rejected", code: "ooxml_macro" });
  });
  it("rejects magic-byte mismatch", () => {
    expect(builtinScan(Buffer.from("<html>"), "pdf")).toMatchObject({ status: "rejected", code: "magic_mismatch" });
    expect(builtinScan(pdf(), "png")).toMatchObject({ status: "rejected", code: "magic_mismatch" });
  });
});

describe("scanFile provider hook", () => {
  it("runs built-in rules only by default", async () => {
    expect((await scanFile(pdf(), "pdf", undefined)).status).toBe("clean");
  });
  it("fails closed when the configured provider is not registered", async () => {
    expect(await scanFile(pdf(), "pdf", "clamav-missing")).toMatchObject({ status: "error" });
  });
  it("delegates to a registered external scanner after built-in rules pass", async () => {
    registerScanner({ name: "fake-av", scan: async (buf) => (buf.includes("EICAR") ? { status: "rejected", engine: "fake-av", code: "eicar", reason: "x" } : { status: "clean", engine: "fake-av" }) });
    expect((await scanFile(pdf("/Title (EICAR)"), "pdf", "fake-av")).status).toBe("rejected");
    expect(await scanFile(pdf(), "pdf", "fake-av")).toMatchObject({ status: "clean", engine: "fake-av" });
  });
});

// ───────────── encryption & storage ─────────────
describe("encryption at rest", () => {
  const original = pdf("/Title (وثيقة)");
  it("round-trips with a wrapped per-waqf data key", () => {
    const k = newDataKey();
    const enc = encryptBuffer(original, unwrapDataKey(k.wrapped));
    expect(enc.ct.equals(original)).toBe(false);
    expect(enc.ct.includes("%PDF")).toBe(false);
    const back = decryptBuffer(enc.ct, k.raw, enc.iv, enc.tag);
    expect(sha256(back)).toBe(sha256(original));
  });
  it("detects tampering and wrong keys (GCM tag)", () => {
    const k = newDataKey();
    const enc = encryptBuffer(original, k.raw);
    const bad = Buffer.from(enc.ct);
    bad[5] ^= 0xff;
    expect(() => decryptBuffer(bad, k.raw, enc.iv, enc.tag)).toThrow();
    expect(() => decryptBuffer(enc.ct, newDataKey().raw, enc.iv, enc.tag)).toThrow();
  });
});

describe("local storage adapter", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "waqfak-store-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("puts, gets and deletes blobs under w/<waqf>/<uuid>", async () => {
    const s = new LocalDiskStorage(dir);
    const key = newStorageKey({ waqfId: "11111111-1111-4111-8111-111111111111", userId: "x" });
    expect(key).toMatch(/^w\/1{8}-/);
    await s.put(key, Buffer.from("cipher"));
    expect(readFileSync(s.pathFor(key)).toString()).toBe("cipher");
    expect((await s.get(key)).toString()).toBe("cipher");
    await s.delete(key);
    await expect(s.get(key)).rejects.toThrow();
  });
  it("refuses keys that could escape the storage root", () => {
    expect(() => assertKey("../../etc/passwd")).toThrow();
    expect(() => assertKey("w/../../x")).toThrow();
  });
});
