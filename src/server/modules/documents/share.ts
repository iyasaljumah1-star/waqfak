import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withSystem } from "../../db";
import { documents, documentShares, documentVersions } from "../../db/schema";
import { sha256 } from "../../lib/crypto";
import { logAccess, readVersionPlain } from "./service";

/**
 * Public share links (/s/[token]). The token is never stored: only its SHA-256.
 * Anonymous access cannot carry a user identity into RLS, so these two functions use the system context,
 * scoped strictly to the single share row matched by the token hash (same pattern as /r/[token]).
 */

export type ShareState = "ok" | "not_found" | "revoked" | "expired" | "used_up" | "unavailable";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function lookup(tx: Parameters<Parameters<typeof withSystem>[0]>[0], token: string, lock: boolean) {
  const q = tx
    .select({ s: documentShares, d: documents, v: documentVersions })
    .from(documentShares)
    .innerJoin(documents, eq(documents.id, documentShares.documentId))
    .leftJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), eq(documentVersions.version, documents.currentVersion)))
    .where(eq(documentShares.tokenHash, sha256(token)))
    .limit(1);
  const [row] = lock ? await q.for("update", { of: documentShares }) : await q;
  if (!row) return { state: "not_found" as ShareState, row: null };
  const { s, d, v } = row;
  let state: ShareState = "ok";
  if (s.revokedAt) state = "revoked";
  else if (s.expiresAt.getTime() <= Date.now()) state = "expired";
  else if (s.uses >= s.maxUses) state = "used_up";
  else if (d.status !== "active" || d.archivedAt || d.confidentiality === "secret" || !v || v.scanStatus !== "clean") state = "unavailable";
  return { state, row };
}

/** Read-only view for the share page (does not count a use). */
export async function viewShare(token: string) {
  if (!TOKEN_RE.test(token)) return { state: "not_found" as ShareState, info: null };
  return withSystem(async (tx) => {
    const { state, row } = await lookup(tx, token, false);
    if (!row || state !== "ok") return { state, info: null };
    return {
      state,
      info: {
        title: row.d.title,
        docType: row.d.docType,
        sizeBytes: row.v!.sizeBytes,
        mimeType: row.v!.mimeType,
        expiresAt: row.s.expiresAt,
        remaining: row.s.maxUses - row.s.uses,
      },
    };
  });
}

/** Consumes one use atomically and returns the decrypted current version. Logs success and refusals. */
export async function consumeShare(token: string, ip: string) {
  if (!TOKEN_RE.test(token)) return { state: "not_found" as ShareState, file: null };
  return withSystem(async (tx) => {
    const { state, row } = await lookup(tx, token, true);
    if (!row) return { state, file: null };
    if (state !== "ok") {
      await logAccess(tx, { documentId: row.d.id, waqfId: row.d.waqfId, userId: null, action: "denied", ip });
      return { state, file: null };
    }
    await tx.update(documentShares).set({ uses: sql`${documentShares.uses} + 1` }).where(eq(documentShares.id, row.s.id));
    const data = await readVersionPlain(tx, row.d, row.v!);
    await logAccess(tx, { documentId: row.d.id, versionId: row.v!.id, waqfId: row.d.waqfId, userId: null, action: "download", ip });
    return { state, file: { data, mime: row.v!.mimeType, name: row.v!.originalName } };
  });
}
