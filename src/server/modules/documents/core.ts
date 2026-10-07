import "server-only";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  auditLogs, documentAccessLog, documentLinks, documents, documentVersions, permissions, rolePermissions, roles, waqfKeys, waqfMemberships,
} from "../../db/schema";
import { ROLES } from "../../authz/catalog";
import { decryptBuffer, masterDataKey, newDataKey, sha256, unwrapDataKey } from "../../lib/crypto";
import { audit } from "../../lib/audit";
import { getStorage } from "../../adapters/storage";
import { notify } from "../notify";
import { fmtBoth } from "@/lib/utils";
import { EXPIRY_THRESHOLDS, type Confidentiality } from "./labels";

/**
 * Job-safe core of the document vault (no Next.js imports): confidentiality gate, keys, blobs, links,
 * access log and expiry reminders. Re-exported by ./service.
 */

export type DocRow = typeof documents.$inferSelect;
export type VersionRow = typeof documentVersions.$inferSelect;

/**
 * What the caller may do, as seen by the confidentiality gate.
 * - `perms`: the waqf-level permissions for waqf documents (WaqfAccess.perms), otherwise the user's global perms.
 * - `requestParty`: requester / assigned staff / admin.requests.all on the document's request.
 * A WaqfAccess can be passed directly together with `userId`.
 */
export type DocAccess = { userId: string; perms: ReadonlySet<string>; requestParty?: boolean };

export const CONF_PERM: Record<Confidentiality, string> = {
  internal: "documents.view",
  confidential: "documents.view_confidential",
  secret: "documents.view_secret",
};

/**
 * Confidentiality gate (applied after RLS):
 *  - waqf documents: internal → documents.view, confidential → documents.view_confidential, secret → documents.view_secret.
 *  - personal / request-only documents (no waqf): the owner always; request parties for internal/confidential.
 *    Note: RLS treats waqf_id IS NULL rows as visible, so this gate is the only barrier for them.
 */
export async function canSeeDocument(access: DocAccess | null | undefined, doc: Pick<DocRow, "waqfId" | "ownerUserId" | "confidentiality" | "requestId">): Promise<boolean> {
  return canSeeDocumentSync(access, doc);
}

export function canSeeDocumentSync(access: DocAccess | null | undefined, doc: Pick<DocRow, "waqfId" | "ownerUserId" | "confidentiality" | "requestId">): boolean {
  if (!access) return false;
  if (doc.waqfId) return access.perms.has(CONF_PERM[doc.confidentiality]);
  if (doc.ownerUserId === access.userId) return true;
  if (doc.requestId && access.requestParty) return doc.confidentiality !== "secret";
  return false;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ───────────── Keys & blobs ─────────────

/** Data key for a document: the waqf's envelope key (created on first use) or the master key. */
export async function dataKeyFor(tx: Tx, waqfId: string | null): Promise<Buffer> {
  if (!waqfId) return masterDataKey();
  const [k] = await tx.select({ wrapped: waqfKeys.wrappedKey }).from(waqfKeys).where(eq(waqfKeys.waqfId, waqfId)).limit(1);
  if (k) return unwrapDataKey(k.wrapped);
  const nk = newDataKey();
  const ins = await tx.insert(waqfKeys).values({ waqfId, wrappedKey: nk.wrapped }).onConflictDoNothing().returning({ waqfId: waqfKeys.waqfId });
  if (ins.length) return nk.raw;
  const [again] = await tx.select({ wrapped: waqfKeys.wrappedKey }).from(waqfKeys).where(eq(waqfKeys.waqfId, waqfId)).limit(1);
  return unwrapDataKey(again.wrapped);
}

/** Reads and decrypts a stored version; verifies integrity against the recorded SHA-256. */
export async function readVersionPlain(tx: Tx, doc: Pick<DocRow, "waqfId">, v: VersionRow): Promise<Buffer> {
  const blob = await getStorage().get(v.storageKey);
  if (!v.encrypted) return blob;
  const key = await dataKeyFor(tx, doc.waqfId);
  const plain = decryptBuffer(blob, key, v.iv!, v.authTag!);
  if (sha256(plain) !== v.sha256) throw new Error(`integrity check failed for version ${v.id}`);
  return plain;
}

export async function logAccess(tx: Tx, e: { documentId: string; versionId?: string | null; waqfId?: string | null; userId?: string | null; action: string; ip?: string | null }) {
  await tx.insert(documentAccessLog).values({
    documentId: e.documentId, versionId: e.versionId ?? null, waqfId: e.waqfId ?? null, userId: e.userId ?? null, action: e.action, ip: e.ip ?? null,
  });
}

// ───────────── Links ─────────────

const ENTITY_TYPE_RE = /^[a-z][a-z_]{1,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Links a document to any entity (asset, meeting, request…). Idempotent. RLS checks the waqf. */
export async function linkDocument(tx: Tx, documentId: string, entityType: string, entityId: string, waqfId: string | null) {
  if (!ENTITY_TYPE_RE.test(entityType) || !UUID_RE.test(entityId)) throw new HttpError(400, "رابط الوثيقة غير صالح.");
  await tx.insert(documentLinks).values({ documentId, entityType, entityId, waqfId: waqfId ?? null }).onConflictDoNothing();
}

/** Role → permissions from the DB (falls back to the code catalog), without the Next-bound authz cache. */
async function rolePermissionMapForJob(tx: Tx) {
  const rows = await tx
    .select({ role: roles.key, perm: permissions.key })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.role)) map.set(r.role, new Set());
    map.get(r.role)!.add(r.perm);
  }
  for (const [k, def] of Object.entries(ROLES)) if (!map.has(k)) map.set(k, new Set(def.permissions));
  return map;
}

// ───────────── Expiry reminders (daily compliance job) ─────────────

const MANAGER_ROLES = ["nazir", "board_chair", "executive", "delegated_manager"];

function riyadhToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}
function addDaysIso(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);

/**
 * Notifies document owners and waqf managers about documents expiring within 60/30/7 days
 * (template "document.expiring"). One reminder per document, threshold and expiry date: what was sent is
 * recorded in audit_logs (action "documents.expiry_reminder", after.threshold / after.expiresOn), so
 * changing the expiry date re-arms the reminders. Recipients must pass the confidentiality gate.
 * Runs in a system transaction. Returns the number of notifications sent.
 */
export async function documentExpiryReminders(tx: Tx): Promise<number> {
  const today = riyadhToday();
  const horizon = addDaysIso(today, Math.max(...EXPIRY_THRESHOLDS));
  const docs = await tx
    .select()
    .from(documents)
    .where(and(isNull(documents.archivedAt), eq(documents.status, "active"), gte(documents.expiresOn, today), lte(documents.expiresOn, horizon)));
  if (!docs.length) return 0;

  const sent = await tx
    .select({ entityId: auditLogs.entityId, after: auditLogs.after })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "documents.expiry_reminder"), inArray(auditLogs.entityId, docs.map((d) => d.id))));
  const sentKey = new Set(sent.map((s) => {
    const a = (s.after ?? {}) as { threshold?: number; expiresOn?: string };
    return `${s.entityId}|${a.threshold}|${a.expiresOn}`;
  }));

  const waqfIds = [...new Set(docs.map((d) => d.waqfId).filter((x): x is string => !!x))];
  const mems = waqfIds.length
    ? await tx
        .select({ waqfId: waqfMemberships.waqfId, userId: waqfMemberships.userId, roleKey: waqfMemberships.roleKey, endsAt: waqfMemberships.endsAt })
        .from(waqfMemberships)
        .where(and(inArray(waqfMemberships.waqfId, waqfIds), eq(waqfMemberships.status, "active")))
    : [];
  const roleMap = await rolePermissionMapForJob(tx);
  const now = new Date();
  // waqfId → userId → perms
  const permsByWaqf = new Map<string, Map<string, Set<string>>>();
  const managers = new Map<string, Set<string>>();
  for (const m of mems) {
    if (m.endsAt && m.endsAt <= now) continue;
    const byUser = permsByWaqf.get(m.waqfId) ?? new Map<string, Set<string>>();
    permsByWaqf.set(m.waqfId, byUser);
    const set = byUser.get(m.userId) ?? new Set<string>();
    byUser.set(m.userId, set);
    if (m.roleKey !== "agent") for (const p of roleMap.get(m.roleKey) ?? []) set.add(p);
    if (MANAGER_ROLES.includes(m.roleKey)) {
      const s = managers.get(m.waqfId) ?? new Set<string>();
      s.add(m.userId);
      managers.set(m.waqfId, s);
    }
  }

  let count = 0;
  for (const d of docs) {
    const days = dayDiff(today, d.expiresOn!);
    const threshold = [...EXPIRY_THRESHOLDS].sort((a, b) => a - b).find((t) => days <= t);
    if (threshold === undefined) continue;
    if (sentKey.has(`${d.id}|${threshold}|${d.expiresOn}`)) continue;
    const candidates = new Set<string>([d.ownerUserId, ...(d.waqfId ? managers.get(d.waqfId) ?? [] : [])]);
    const recipients = [...candidates].filter((uid) =>
      canSeeDocumentSync({ userId: uid, perms: d.waqfId ? permsByWaqf.get(d.waqfId)?.get(uid) ?? new Set() : new Set() }, d),
    );
    const link = d.waqfId ? `/app/w/${d.waqfId}/documents/${d.id}` : "/app";
    for (const uid of recipients) {
      await notify(uid, "document.expiring", { title: d.title, date: fmtBoth(d.expiresOn), days }, { waqfId: d.waqfId, link, tx });
      count++;
    }
    await audit(tx, {
      actorLabel: "system:documents.expiry",
      action: "documents.expiry_reminder",
      entityType: "document",
      entityId: d.id,
      waqfId: d.waqfId,
      after: { threshold, expiresOn: d.expiresOn, days, recipients: recipients.length },
    });
  }
  return count;
}

