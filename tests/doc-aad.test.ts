/**
 * Stage 11.1 (S11-5): a stored document version is encrypted bound to its row (AES-256-GCM associated data). A blob — or
 * a blob's key, iv and tag — moved under another row does not open; a row changed after writing does not open; and the
 * scheme moves only from v1 to v2, by the system. Development database and storage (the vault after the re-encryption
 * of scripts/security/reencrypt-v2.ts); nothing is written to the vault.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";

vi.mock("server-only", () => ({}));

const enabled = !!process.env.SYSTEM_DATABASE_URL && /waqfak_dev/.test(process.env.DATABASE_URL ?? "") && !!process.env.STORAGE_DIR;

describe("stage 11.1 S11-5 — encryption bound to the row", async () => {
  const C = await import("../src/server/lib/crypto");
  it("associated data: the same key and iv open only with the same row", () => {
    const key = Buffer.alloc(32, 7);
    const row = { id: "11111111-1111-4111-8111-111111111111", documentId: "22222222-2222-4222-8222-222222222222", version: 1, waqfId: null, storageKey: "u/x/y", sha256: "h" };
    const enc = C.encryptBuffer(Buffer.from("وثيقة اختبار اصطناعية"), key, C.versionAad(row));
    expect(C.decryptBuffer(enc.ct, key, enc.iv, enc.tag, C.versionAad(row)).toString()).toBe("وثيقة اختبار اصطناعية");
    for (const other of [{ ...row, id: "33333333-3333-4333-8333-333333333333" }, { ...row, documentId: "44444444-4444-4444-8444-444444444444" }, { ...row, version: 2 }, { ...row, waqfId: "55555555-5555-4555-8555-555555555555" }, { ...row, storageKey: "u/x/z" }, { ...row, sha256: "g" }])
      expect(() => C.decryptBuffer(enc.ct, key, enc.iv, enc.tag, C.versionAad(other))).toThrow();
    expect(() => C.decryptBuffer(enc.ct, key, enc.iv, enc.tag)).toThrow(); // and not without it
  });
});

describe.skipIf(!enabled)("stage 11.1 S11-5 — the vault (development)", () => {
  let owner: Client;
  beforeAll(async () => { owner = new Client({ connectionString: process.env.DATABASE_OWNER_URL }); await owner.connect(); });
  afterAll(async () => { await owner?.end(); });

  it("every stored version is v2 and opens under its own row; a victim's blob under another row of the same scope does not", async () => {
    const { withSystem } = await import("../src/server/db");
    const { readVersionPlain } = await import("../src/server/modules/documents/core");
    const left = (await owner.query(`select count(*)::int n from document_versions where encrypted and enc_scheme <> 'v2'`)).rows[0].n;
    expect(left).toBe(0);
    // two versions with no waqf (the master key: the case S11-5 found) — the attacker's row pointed at the victim's blob
    const rows = (await owner.query(`select * from document_versions where waqf_id is null and encrypted order by uploaded_at limit 2`)).rows;
    expect(rows.length).toBe(2);
    const camel = (r: Record<string, unknown>) => ({ id: r.id, documentId: r.document_id, version: r.version, waqfId: r.waqf_id, storageKey: r.storage_key, sha256: r.sha256, iv: r.iv, authTag: r.auth_tag, encrypted: r.encrypted, encScheme: r.enc_scheme, mimeType: r.mime_type }) as never;
    const [victim, attacker] = [camel(rows[0]), camel(rows[1])] as Record<string, unknown>[];
    await withSystem(async (tx) => {
      expect((await readVersionPlain(tx, { waqfId: null }, victim as never)).length).toBeGreaterThan(0);
      const moved = { ...attacker, storageKey: victim!.storageKey, iv: victim!.iv, authTag: victim!.authTag, sha256: victim!.sha256 };
      await expect(readVersionPlain(tx, { waqfId: null }, moved as never)).rejects.toThrow();
    });
  });

  it("the scheme moves only from v1 to v2, by the system: never back, never by a person", async () => {
    const sys = new Client({ connectionString: process.env.SYSTEM_DATABASE_URL });
    await sys.connect();
    try {
      await sys.query("begin");
      await sys.query(`select set_config('app.user_id', '', true)`);
      const [v] = (await sys.query(`select id from document_versions where encrypted and enc_scheme = 'v2' limit 1`)).rows;
      expect(v).toBeTruthy();
      const back = await sys.query(`update document_versions set enc_scheme = 'v1' where id = $1`, [v.id]).then((r) => `updated ${r.rowCount}`, (e: Error) => e.message);
      expect(back).toMatch(/only from v1 to v2/);
    } finally {
      await sys.query("rollback").catch(() => null);
      await sys.end();
    }
  });
});
