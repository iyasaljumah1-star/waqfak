import "dotenv/config";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// keep the expiry-reminder test free of outbound messages (in-app notifications are rolled back)
vi.mock("../src/server/adapters/messaging", () => ({ sendEmail: vi.fn(async () => undefined), sendSms: vi.fn(async () => undefined) }));

import { builtinScan, MAX_UPLOAD_BYTES, scanFile, sniffFile, registerScanner, UPLOAD_KINDS } from "../src/server/adapters/scan";
import { decryptBuffer, encryptBuffer, newDataKey, sha256, unwrapDataKey } from "../src/server/lib/crypto";
import { assertKey, LocalDiskStorage, newStorageKey } from "../src/server/adapters/storage";
import { evaluateChecklist, lastFiscalYearEnd, type ChecklistDoc } from "../src/server/modules/documents/checklist";
import { canSeeDocumentSync, documentExpiryReminders } from "../src/server/modules/documents/core";
import { ROLES } from "../src/server/authz/catalog";
import { withSystem } from "../src/server/db";
import * as schema from "../src/server/db/schema";
import { and, eq, inArray } from "drizzle-orm";

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
  it("refuses plain text from users (not in the allowlist) but allows it for server-side ingestion", async () => {
    expect(await sniffFile(Buffer.from("ملاحظات الناظر\nسطر ثانٍ"), "n.txt")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await sniffFile(Buffer.from("ملاحظات الناظر\nسطر ثانٍ"), "n.txt", ["pdf", "txt"])).toMatchObject({ ok: true, kind: "txt" });
    expect(await sniffFile(Buffer.from([0, 1, 2, 3, 250, 251, 252]), "n.txt", ["txt"])).toMatchObject({ ok: false, code: "unsupported" });
  });
  it("accepts every allowlisted kind and nothing else", async () => {
    expect(UPLOAD_KINDS).toEqual(["pdf", "png", "jpg", "webp", "docx", "xlsx"]);
    const xlsx = zip({ "[Content_Types].xml": ct("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml").replace("/word/document.xml", "/xl/workbook.xml"), "xl/workbook.xml": "<workbook/>" });
    expect(await sniffFile(xlsx, "book.xlsx")).toMatchObject({ ok: true, kind: "xlsx" });
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    expect(await sniffFile(jpg, "scan.jpeg")).toMatchObject({ ok: true, kind: "jpg" });
    const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1");
    expect(await sniffFile(gif, "a.gif")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await sniffFile(Buffer.from("#!/bin/sh\nrm -rf /\n"), "run.sh")).toMatchObject({ ok: false, code: "unsupported" });
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

// ───────────── confidentiality gate ─────────────
describe("canSeeDocumentSync (applied after RLS)", () => {
  const W = "11111111-1111-4111-8111-111111111111";
  const perms = (role: string) => new Set<string>(ROLES[role].permissions);
  const doc = (c: "internal" | "confidential" | "secret", extra: Partial<{ waqfId: string | null; ownerUserId: string; requestId: string | null }> = {}) =>
    ({ waqfId: W, ownerUserId: "owner", requestId: null, confidentiality: c, ...extra });
  it("maps internal / confidential / secret to documents.view / view_confidential / view_secret", () => {
    const nazir = { userId: "n", perms: perms("nazir") };
    const member = { userId: "m", perms: perms("board_member") };
    const committee = { userId: "c", perms: perms("committee_member") };
    expect([doc("internal"), doc("confidential"), doc("secret")].map((d) => canSeeDocumentSync(nazir, d))).toEqual([true, true, true]);
    expect([doc("internal"), doc("confidential"), doc("secret")].map((d) => canSeeDocumentSync(member, d))).toEqual([true, true, false]);
    expect([doc("internal"), doc("confidential"), doc("secret")].map((d) => canSeeDocumentSync(committee, d))).toEqual([true, false, false]);
  });
  it("denies beneficiary-only members, viewers and no access", () => {
    expect(canSeeDocumentSync({ userId: "b", perms: perms("beneficiary") }, doc("internal"))).toBe(false);
    expect(canSeeDocumentSync({ userId: "v", perms: perms("viewer") }, doc("internal"))).toBe(false);
    expect(canSeeDocumentSync(null, doc("internal"))).toBe(false);
  });
  it("uploading a waqf document does not grant the uploader access by ownership", () => {
    expect(canSeeDocumentSync({ userId: "owner", perms: new Set() }, doc("internal"))).toBe(false);
  });
  it("personal documents: owner only; request parties for non-secret request documents", () => {
    const personal = doc("secret", { waqfId: null, ownerUserId: "u1" });
    expect(canSeeDocumentSync({ userId: "u1", perms: new Set() }, personal)).toBe(true);
    expect(canSeeDocumentSync({ userId: "u2", perms: new Set(["documents.view_secret"]) }, personal)).toBe(false);
    const req = doc("confidential", { waqfId: null, ownerUserId: "u1", requestId: "r1" });
    expect(canSeeDocumentSync({ userId: "staff", perms: new Set(), requestParty: true }, req)).toBe(true);
    expect(canSeeDocumentSync({ userId: "staff", perms: new Set(), requestParty: false }, req)).toBe(false);
    expect(canSeeDocumentSync({ userId: "staff", perms: new Set(), requestParty: true }, { ...req, confidentiality: "secret" })).toBe(false);
  });
});

// ───────────── required-document checklist ─────────────
describe("required-document checklist", () => {
  const today = "2026-10-07";
  let n = 0;
  const d = (docType: string, extra: Partial<ChecklistDoc> = {}): ChecklistDoc => ({
    id: `d${++n}`, docType, title: docType, status: "active", expiresOn: null, issuedOn: null, createdAt: new Date("2026-01-15T10:00:00Z"), visible: true, ...extra,
  });
  const run = (docs: ChecklistDoc[], over: Partial<Parameters<typeof evaluateChecklist>[0]> = {}) =>
    Object.fromEntries(evaluateChecklist({ today, fiscalYearEnd: "12-31", docs, realEstateAssets: [], hasAnyAssets: false, ...over }).map((i) => [i.key, i.state]));

  it("lists all six required documents as missing for an empty waqf", () => {
    expect(run([])).toEqual({ waqf_deed: "missing", registration_certificate: "missing", nazara_deed: "missing", ownership_deed: "missing", financial_statement: "missing", bo_register: "missing" });
  });
  it("marks present, expiring, expired and quarantined documents", () => {
    const r = run([d("waqf_deed"), d("registration_certificate", { expiresOn: "2026-10-30" }), d("nazara_deed", { expiresOn: "2026-09-01" }), d("bo_register", { status: "quarantine" })]);
    expect(r).toMatchObject({ waqf_deed: "ok", registration_certificate: "expiring", nazara_deed: "expired", bo_register: "pending" });
  });
  it("prefers a renewed certificate over the expired one and ignores rejected files", () => {
    const r = run([d("registration_certificate", { expiresOn: "2025-01-01" }), d("registration_certificate", { expiresOn: "2028-01-01" }), d("waqf_deed", { status: "rejected" })]);
    expect(r).toMatchObject({ registration_certificate: "ok", waqf_deed: "missing" });
  });
  it("ownership deeds follow the real-estate assets", () => {
    expect(run([], { realEstateAssets: [{ id: "a", covered: true }, { id: "b", covered: false }], hasAnyAssets: true }).ownership_deed).toBe("partial");
    expect(run([], { realEstateAssets: [{ id: "a", covered: false }], hasAnyAssets: true }).ownership_deed).toBe("missing");
    expect(run([d("ownership_deed")], { realEstateAssets: [{ id: "a", covered: true }], hasAnyAssets: true }).ownership_deed).toBe("ok");
    expect(run([], { hasAnyAssets: true }).ownership_deed).toBe("ok"); // cash-only waqf
  });
  it("financial statements must cover the last completed fiscal year (with a grace period)", () => {
    expect(lastFiscalYearEnd("2026-10-07", "12-31")).toBe("2025-12-31");
    expect(lastFiscalYearEnd("2026-10-07", "06-30")).toBe("2026-06-30");
    expect(run([d("financial_statement", { issuedOn: "2026-03-30" })]).financial_statement).toBe("ok");
    expect(run([d("financial_statement", { issuedOn: "2025-03-30" })]).financial_statement).toBe("outdated");
    expect(run([d("financial_statement", { issuedOn: "2025-03-30" })], { today: "2026-02-01" }).financial_statement).toBe("due");
    expect(run([d("financial_statement", { issuedOn: "2025-03-30" })], { fiscalYearEnd: "06-30" }).financial_statement).toBe("due");
  });
  it("does not link documents the viewer may not see", () => {
    const items = evaluateChecklist({ today, fiscalYearEnd: "12-31", docs: [d("bo_register", { visible: false })], realEstateAssets: [], hasAnyAssets: false });
    expect(items.find((i) => i.key === "bo_register")).toMatchObject({ state: "ok", doc: { visible: false } });
  });
});

// ───────────── expiry reminders (daily job), against the dev database, rolled back ─────────────
const creds = (() => {
  try {
    return JSON.parse(readFileSync("storage/demo-credentials.json", "utf8")) as { waqfs: Record<"A" | "B" | "C", string>; users: Record<string, { id: string }> };
  } catch {
    return null;
  }
})();

describe.skipIf(!creds || !process.env.DATABASE_URL)("documentExpiryReminders", () => {
  class Rollback extends Error {}
  const plusDays = (n: number) => {
    const t = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()) + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };

  it("notifies authorised recipients once per threshold and respects confidentiality", async () => {
    const A = creds!.waqfs.A;
    const C = creds!.waqfs.C;
    const nazir = creds!.users.nazir.id;
    const chair = creds!.users.chair.id;
    const out = await withSystem(async (tx) => {
      const mk = (waqfId: string, owner: string, title: string, confidentiality: "internal" | "secret", expiresOn: string) =>
        tx.insert(schema.documents).values({ waqfId, ownerUserId: owner, docType: "permission", title, confidentiality, status: "active", expiresOn }).returning({ id: schema.documents.id }).then((r) => r[0].id);
      const a = await mk(A, nazir, "اختبار تذكير الانتهاء", "internal", plusDays(25));
      const c = await mk(C, chair, "اختبار سري جدًا", "secret", plusDays(5));
      const far = await mk(A, nazir, "اختبار بعيد الانتهاء", "internal", plusDays(200));
      await documentExpiryReminders(tx);
      const notes = await tx.select({ userId: schema.notifications.userId, title: schema.notifications.titleAr }).from(schema.notifications)
        .where(and(eq(schema.notifications.type, "document.expiring"), inArray(schema.notifications.userId, [nazir, chair])));
      const logs = await tx.select({ id: schema.auditLogs.entityId, after: schema.auditLogs.after }).from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.action, "documents.expiry_reminder"), inArray(schema.auditLogs.entityId, [a, c, far])));
      await documentExpiryReminders(tx); // second run: nothing new for these documents
      const logs2 = await tx.select({ id: schema.auditLogs.entityId }).from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.action, "documents.expiry_reminder"), inArray(schema.auditLogs.entityId, [a, c, far])));
      throw new Rollback(JSON.stringify({ a, c, far, notes, logs, logs2: logs2.length }));
    }).catch((e) => {
      if (e instanceof Rollback) return JSON.parse(e.message);
      throw e;
    });
    expect(out.notes.some((n: { userId: string; title: string }) => n.userId === nazir && n.title.includes("اختبار تذكير الانتهاء"))).toBe(true);
    expect(out.notes.some((n: { title: string }) => n.title.includes("اختبار سري جدًا"))).toBe(false); // nobody on C holds view_secret
    expect(out.notes.some((n: { title: string }) => n.title.includes("اختبار بعيد الانتهاء"))).toBe(false);
    const byDoc = Object.fromEntries(out.logs.map((l: { id: string; after: { threshold: number; recipients: number } }) => [l.id, l.after]));
    expect(byDoc[out.a]).toMatchObject({ threshold: 30 });
    expect(byDoc[out.c]).toMatchObject({ threshold: 7, recipients: 0 });
    expect(byDoc[out.far]).toBeUndefined();
    expect(out.logs2).toBe(out.logs.length);
  }, 30_000);
});
