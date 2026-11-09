import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withSystem } from "../../db";
import { documents, documentShares, documentShareUses, documentVersions } from "../../db/schema";
import { bindDocumentShare, capabilityLookup, verifyCapability } from "../../lib/capability";
import { logAccess, readVersionPlain } from "./service";

/**
 * Public share links (/s/[token]). The token is never stored: only its keyed lookup and its binding (lib/capability.ts).
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
    .where(eq(documentShares.tokenHash, capabilityLookup("document_share", token)))
    .limit(1);
  const [row] = lock ? await q.for("update", { of: documentShares }) : await q;
  // a share row re-pointed to another document, extended, given more uses, or planted without the key: not found
  if (!row) return { state: "not_found" as ShareState, row: null };
  if (!verifyCapability("document_share", token, row.s.binding, bindDocumentShare(row.s, { doc: row.d, version: row.v }))) {
    // a row that says it is revoked or past its expiry opens nothing either way: saying so is harmless (a writer who
    // shortens a link only disables it) and tells the holder the truth; anything else that fails the binding is unknown
    if (row.s.revokedAt) return { state: "revoked" as ShareState, row: null };
    if (row.s.expiresAt.getTime() <= Date.now()) return { state: "expired" as ShareState, row: null };
    return { state: "not_found" as ShareState, row: null };
  }
  // … and the content as issued: the same version (id, number, storage key, IV, tag, hash), the same waqf and
  // confidentiality — checked in the binding above (N9-2); a new version since is not opened by an old link
  const { s, d, v } = row;
  // uses are counted from the append-only use log, not from a counter a database writer could reset (N9-3)
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(documentShareUses).where(eq(documentShareUses.shareId, s.id));
  let state: ShareState = "ok";
  if (s.revokedAt) state = "revoked";
  else if (s.expiresAt.getTime() <= Date.now()) state = "expired";
  else if (n >= s.maxUses || s.uses >= s.maxUses) state = "used_up";
  else if (d.status !== "active" || d.archivedAt || d.confidentiality === "secret" || !v || v.scanStatus !== "clean") state = "unavailable";
  return { state, row: { ...row, used: n } };
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
        remaining: Math.max(0, row.s.maxUses - row.used),
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
    // one use: a row in the append-only log (under the share row's lock), and the display counter
    await tx.insert(documentShareUses).values({ shareId: row.s.id, ip });
    await tx.update(documentShares).set({ uses: row.used + 1 }).where(eq(documentShares.id, row.s.id));
    const data = await readVersionPlain(tx, row.d, row.v!);
    await logAccess(tx, { documentId: row.d.id, versionId: row.v!.id, waqfId: row.d.waqfId, userId: null, action: "download", ip });
    return { state, file: { data, mime: row.v!.mimeType, name: row.v!.originalName } };
  });
}
