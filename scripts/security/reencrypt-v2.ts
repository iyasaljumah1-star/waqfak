/**
 * Stage 11.1 (S11-5): re-encrypts the stored document versions written before the ciphertext was bound to its row (v1,
 * AES-256-GCM without associated data) to v2 (associated data = the row: id, document, version, waqf, storage key,
 * content hash — lib/crypto.ts versionAad). A safe transition:
 *
 *  1. each v1 blob is read and decrypted, and its content checked against the recorded SHA-256 (a mismatch stops it);
 *  2. the content is encrypted under v2 into a NEW blob (a new storage key) — the old blob is never overwritten;
 *  3. the new blob is read back and decrypted with the row's associated data, and its hash checked again;
 *  4. only then is the row switched (storage key, iv, tag, scheme) — by the system, the one change security.sql
 *     dv_fixed allows a stored version — in the same transaction as the check that it is still v1;
 *  5. every switch is written to a manifest (old key, new key, hash). The OLD blobs stay: they are removed only by the
 *     separate --purge step, which re-verifies each new blob first, and which is not run by --apply.
 *
 *   npx tsx --conditions=react-server scripts/security/reencrypt-v2.ts            # dry run: what would change
 *   npx tsx --conditions=react-server scripts/security/reencrypt-v2.ts --apply    # re-encrypt, keep old blobs
 *   npx tsx --conditions=react-server scripts/security/reencrypt-v2.ts --verify   # every v2 version opens and matches
 *   npx tsx --conditions=react-server scripts/security/reencrypt-v2.ts --purge <manifest.json>  # after verification only
 *
 * Runs on the system connection (SYSTEM_DATABASE_URL). Test environment only in this stage.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { withSystem } from "../../src/server/db";
import { documentVersions } from "../../src/server/db/schema";
import { decryptBuffer, encryptBuffer, sha256, versionAad } from "../../src/server/lib/crypto";
import { dataKeyFor } from "../../src/server/modules/documents/core";
import { getStorage } from "../../src/server/adapters/storage";
import { env } from "../../src/server/env";

type Entry = { versionId: string; documentId: string; oldKey: string; newKey: string; sha256: string };

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--verify") ? "verify" : process.argv.includes("--purge") ? "purge" : "dry";

/** A new key in the same scope as the old one (w/<waqf>/… or u/<user>/…). */
const nextKey = (old: string) => `${old.split("/").slice(0, 2).join("/")}/${crypto.randomUUID()}`;

async function apply(dry: boolean) {
  const rows = await withSystem((tx) => tx.select().from(documentVersions).where(and(eq(documentVersions.encScheme, "v1"), eq(documentVersions.encrypted, true))));
  const storage = getStorage();
  const done: Entry[] = [];
  const failed: { versionId: string; reason: string }[] = [];
  for (const v of rows) {
    try {
      await withSystem(async (tx) => {
        const key = await dataKeyFor(tx, v.waqfId);
        const plain = decryptBuffer(await storage.get(v.storageKey), key, v.iv!, v.authTag!);
        if (sha256(plain) !== v.sha256) throw new Error("content does not match its recorded hash");
        if (dry) return;
        const newKey = nextKey(v.storageKey);
        const aad = versionAad({ ...v, storageKey: newKey });
        const enc = encryptBuffer(plain, key, aad);
        await storage.put(newKey, enc.ct);
        // read back what was written and open it as the row will
        const back = decryptBuffer(await storage.get(newKey), key, enc.iv, enc.tag, aad);
        if (sha256(back) !== v.sha256) throw new Error("the new blob does not read back");
        const [sw] = await tx.update(documentVersions).set({ storageKey: newKey, iv: enc.iv, authTag: enc.tag, encScheme: "v2" })
          .where(and(eq(documentVersions.id, v.id), eq(documentVersions.encScheme, "v1"))).returning({ id: documentVersions.id });
        if (!sw) throw new Error("the row changed meanwhile");
        done.push({ versionId: v.id, documentId: v.documentId, oldKey: v.storageKey, newKey, sha256: v.sha256 });
      });
    } catch (e) {
      failed.push({ versionId: v.id, reason: (e as Error).message });
    }
  }
  let manifest: string | null = null;
  if (!dry && done.length) {
    const dir = path.join(env.STORAGE_DIR, "migrations");
    mkdirSync(dir, { recursive: true });
    manifest = path.join(dir, `reencrypt-v2-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(manifest, JSON.stringify({ kind: "reencrypt-v2", at: new Date().toISOString(), oldBlobsKept: true, entries: done }, null, 1));
  }
  console.log(JSON.stringify({ mode: dry ? "dry" : "apply", v1Found: rows.length, reencrypted: done.length, failed, manifest }, null, 1));
  if (failed.length) process.exitCode = 1;
}

async function verify() {
  const rows = await withSystem((tx) => tx.select().from(documentVersions).where(eq(documentVersions.encrypted, true)));
  const storage = getStorage();
  const bad: { versionId: string; reason: string }[] = [];
  let v2 = 0;
  for (const v of rows) {
    if (v.encScheme !== "v2") continue;
    v2++;
    try {
      const key = await withSystem((tx) => dataKeyFor(tx, v.waqfId));
      const plain = decryptBuffer(await storage.get(v.storageKey), key, v.iv!, v.authTag!, versionAad(v));
      if (sha256(plain) !== v.sha256) bad.push({ versionId: v.id, reason: "hash mismatch" });
    } catch (e) {
      bad.push({ versionId: v.id, reason: (e as Error).message });
    }
  }
  console.log(JSON.stringify({ mode: "verify", encrypted: rows.length, v2, v1Left: rows.filter((r) => r.encScheme === "v1").length, bad }, null, 1));
  if (bad.length) process.exitCode = 1;
}

async function purge(file: string) {
  const m = JSON.parse(readFileSync(file, "utf8")) as { entries: Entry[] };
  const storage = getStorage();
  let removed = 0;
  const kept: { versionId: string; reason: string }[] = [];
  for (const e of m.entries) {
    // the new blob must open under its row as the row stands now, before the old one goes
    const [v] = await withSystem((tx) => tx.select().from(documentVersions).where(eq(documentVersions.id, e.versionId)).limit(1));
    try {
      if (!v || v.encScheme !== "v2" || v.storageKey !== e.newKey) throw new Error("row is not on the new blob");
      const key = await withSystem((tx) => dataKeyFor(tx, v.waqfId));
      const plain = decryptBuffer(await storage.get(v.storageKey), key, v.iv!, v.authTag!, versionAad(v));
      if (sha256(plain) !== e.sha256) throw new Error("hash mismatch");
      await storage.delete(e.oldKey);
      removed++;
    } catch (err) {
      kept.push({ versionId: e.versionId, reason: (err as Error).message });
    }
  }
  console.log(JSON.stringify({ mode: "purge", removed, kept }, null, 1));
}

(async () => {
  if (mode === "verify") await verify();
  else if (mode === "purge") await purge(process.argv[process.argv.indexOf("--purge") + 1]!);
  else await apply(mode === "dry");
  process.exit(process.exitCode ?? 0);
})();
