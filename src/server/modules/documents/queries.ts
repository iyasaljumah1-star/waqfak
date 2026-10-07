import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lte, or, type SQL } from "drizzle-orm";
import type { Tx } from "../../db";
import { documentAccessLog, documentLinks, documents, documentShares, documentVersions, users } from "../../db/schema";
import { canSeeDocumentSync, type DocAccess, type DocRow } from "./service";
import { CONFIDENTIALITY, DOC_TYPES, EXPIRING_SOON_DAYS } from "./labels";

export type DocFilters = { type?: string; conf?: string; expiring?: boolean; q?: string; archived?: boolean };

function isoPlusDays(n: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): DocFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) || undefined;
  const type = one("type");
  const conf = one("conf");
  return {
    type: type && (DOC_TYPES as readonly string[]).includes(type) ? type : undefined,
    conf: conf && (CONFIDENTIALITY as readonly string[]).includes(conf) ? conf : undefined,
    expiring: one("expiring") === "1",
    q: one("q")?.trim().slice(0, 100) || undefined,
    archived: one("archived") === "1",
  };
}

const escLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Documents of one waqf visible to the caller (RLS + confidentiality gate). */
export async function listWaqfDocuments(tx: Tx, waqfId: string, access: DocAccess, f: DocFilters = {}) {
  const where: SQL[] = [eq(documents.waqfId, waqfId)];
  where.push(f.archived ? isNotNull(documents.archivedAt) : isNull(documents.archivedAt));
  if (f.type) where.push(eq(documents.docType, f.type));
  if (f.conf) where.push(eq(documents.confidentiality, f.conf as DocRow["confidentiality"]));
  if (f.expiring) where.push(isNotNull(documents.expiresOn), lte(documents.expiresOn, isoPlusDays(EXPIRING_SOON_DAYS)));
  if (f.q) {
    const p = `%${escLike(f.q)}%`;
    where.push(or(ilike(documents.title, p), ilike(documents.number, p), ilike(documents.issuer, p))!);
  }
  const rows = await tx.select().from(documents).where(and(...where)).orderBy(asc(documents.docType), desc(documents.updatedAt)).limit(500);
  return rows.filter((d) => canSeeDocumentSync(access, d));
}

/** Documents attached to a request, an entity link, or a waqf — used by <DocumentList>. */
export async function listDocumentsFor(tx: Tx, scope: { waqfId?: string | null; requestId?: string | null; link?: { entityType: string; entityId: string } }) {
  const where: SQL[] = [isNull(documents.archivedAt)];
  if (scope.link) {
    const ids = await tx
      .select({ id: documentLinks.documentId })
      .from(documentLinks)
      .where(and(eq(documentLinks.entityType, scope.link.entityType), eq(documentLinks.entityId, scope.link.entityId)));
    if (!ids.length) return [];
    where.push(inArray(documents.id, ids.map((i) => i.id)));
  }
  if (scope.waqfId) where.push(eq(documents.waqfId, scope.waqfId));
  if (scope.requestId) where.push(eq(documents.requestId, scope.requestId));
  if (!scope.link && !scope.waqfId && !scope.requestId) return [];
  return tx.select().from(documents).where(and(...where)).orderBy(desc(documents.createdAt)).limit(200);
}

export async function getDocument(tx: Tx, docId: string) {
  const [d] = await tx.select().from(documents).where(eq(documents.id, docId)).limit(1);
  return d ?? null;
}

export async function documentDetail(tx: Tx, docId: string) {
  const [versions, log, shares, links] = await Promise.all([
    tx
      .select({ v: documentVersions, uploader: users.fullName })
      .from(documentVersions)
      .leftJoin(users, eq(users.id, documentVersions.uploadedBy))
      .where(eq(documentVersions.documentId, docId))
      .orderBy(desc(documentVersions.version)),
    tx
      .select({ id: documentAccessLog.id, action: documentAccessLog.action, at: documentAccessLog.at, ip: documentAccessLog.ip, versionId: documentAccessLog.versionId, userId: documentAccessLog.userId, name: users.fullName })
      .from(documentAccessLog)
      .leftJoin(users, eq(users.id, documentAccessLog.userId))
      .where(eq(documentAccessLog.documentId, docId))
      .orderBy(desc(documentAccessLog.at))
      .limit(100),
    tx
      .select({ s: documentShares, by: users.fullName })
      .from(documentShares)
      .leftJoin(users, eq(users.id, documentShares.createdBy))
      .where(eq(documentShares.documentId, docId))
      .orderBy(desc(documentShares.createdAt)),
    tx.select().from(documentLinks).where(eq(documentLinks.documentId, docId)),
  ]);
  return { versions, log, shares, links };
}

export async function userName(tx: Tx, id: string | null) {
  if (!id) return null;
  const [u] = await tx.select({ n: users.fullName }).from(users).where(eq(users.id, id)).limit(1);
  return u?.n ?? null;
}
