import "server-only";
import { eq, max } from "drizzle-orm";
import type { Tx } from "../../db";
import { documents, documentVersions, serviceRequests } from "../../db/schema";
import type { Auth, WaqfAccess } from "../../authz/context";

// authz/context pulls in next/navigation; load it lazily so this module stays importable from jobs/scripts.
const loadWaqfAccess: typeof import("../../authz/context").loadWaqfAccess = async (...a) => (await import("../../authz/context")).loadWaqfAccess(...a);
import { encryptBuffer, sha256 } from "../../lib/crypto";
import { audit } from "../../lib/audit";
import { getStorage, newStorageKey } from "../../adapters/storage";
import { scanFile, type FileKind } from "../../adapters/scan";
import { emitWaqfEvent } from "../compliance/events";
import { CONF_RANK, type Confidentiality } from "./labels";
import { canSeeDocumentSync, dataKeyFor, HttpError, linkDocument, logAccess, type DocAccess, type DocRow } from "./core";

export * from "./core";

/** Whether `auth` is a party to the request (requester, assignee, or admin.requests.all). */
export async function isRequestParty(tx: Tx, auth: Auth, requestId: string) {
  const [r] = await tx
    .select({ id: serviceRequests.id, waqfId: serviceRequests.waqfId, requester: serviceRequests.requesterUserId, assignee: serviceRequests.assignedToUserId })
    .from(serviceRequests)
    .where(eq(serviceRequests.id, requestId))
    .limit(1);
  if (!r) return { request: null, party: false };
  const party = r.requester === auth.user.id || r.assignee === auth.user.id || auth.perms.has("admin.requests.all");
  return { request: r, party };
}

/** Builds the DocAccess for one document (loads waqf access / request parties as needed). */
export async function resolveDocAccess(tx: Tx, auth: Auth, doc: Pick<DocRow, "waqfId" | "requestId">): Promise<{ access: DocAccess; waqf: WaqfAccess | null }> {
  let waqf: WaqfAccess | null = null;
  let perms: ReadonlySet<string> = auth.perms;
  if (doc.waqfId) {
    waqf = await loadWaqfAccess(tx, auth, doc.waqfId);
    perms = waqf?.perms ?? new Set();
  }
  const requestParty = doc.requestId ? (await isRequestParty(tx, auth, doc.requestId)).party : false;
  return { access: { userId: auth.user.id, perms, requestParty, staff: auth.isStaff }, waqf };
}

// ───────────── Upload / ingest ─────────────

export type UploadInput = {
  data: Buffer;
  originalName: string;
  kind: FileKind;
  mime: string;
  documentId?: string | null;
  waqfId?: string | null;
  requestId?: string | null;
  docType: string;
  title: string;
  confidentiality: Confidentiality;
  number?: string | null;
  issuer?: string | null;
  issuedOn?: string | null;
  issuedOnHijri?: string | null;
  expiresOn?: string | null;
  changeNote?: string | null;
  link?: { entityType: string; entityId: string } | null;
};

export type UploadResult =
  | { status: "clean"; documentId: string; versionId: string; version: number; title: string }
  | { status: "rejected"; documentId: string; versionId: string; version: number; title: string; reason: string }
  | { status: "quarantine"; documentId: string; versionId: string; version: number; title: string; reason: string };

/**
 * Stores an upload: permission checks, encryption, blob write, rows, scan, links, access log and audit.
 * Must run inside withContext(auth.db). `onBlob` receives the storage key so the caller can clean up if the tx fails.
 */
export async function ingestUpload(tx: Tx, auth: Auth, meta: { ip: string; userAgent: string }, input: UploadInput, onBlob: (key: string) => void): Promise<UploadResult> {
  let existing: DocRow | null = null;
  let waqfId = input.waqfId || null;
  let requestId = input.requestId || null;
  let confidentiality = input.confidentiality;

  if (input.documentId) {
    const [d] = await tx.select().from(documents).where(eq(documents.id, input.documentId)).limit(1);
    if (!d) throw new HttpError(404, "الوثيقة غير موجودة أو لا تملك صلاحية الوصول إليها.");
    existing = d;
    waqfId = d.waqfId;
    requestId = d.requestId;
    confidentiality = d.confidentiality;
    if (d.archivedAt) throw new HttpError(409, "الوثيقة مؤرشفة. استعدها أولًا ثم ارفع النسخة الجديدة.");
    if (d.approvalStatus === "locked") throw new HttpError(409, "الوثيقة مقفلة ولا تقبل نسخًا جديدة.");
  }

  // Scope & permission
  let waqfAccess: WaqfAccess | null = null;
  let party = false;
  if (requestId) {
    const r = await isRequestParty(tx, auth, requestId);
    if (!r.request) throw new HttpError(404, "الطلب غير موجود أو لا تملك صلاحية الوصول إليه.");
    if (waqfId && r.request.waqfId && r.request.waqfId !== waqfId) throw new HttpError(400, "الطلب لا يتبع هذا الوقف.");
    if (!waqfId && r.request.waqfId) waqfId = r.request.waqfId; // request on a waqf → waqf-scoped (RLS + waqf key)
    party = r.party;
  }
  if (waqfId) {
    waqfAccess = await loadWaqfAccess(tx, auth, waqfId);
    if (!waqfAccess) throw new HttpError(404, "الوقف غير موجود أو لا تملك صلاحية الوصول إليه.");
    if (!waqfAccess.perms.has("documents.upload") && !party) throw new HttpError(403, "ليست لديك صلاحية رفع الوثائق في هذا الوقف.");
  } else if (requestId) {
    if (!party) throw new HttpError(403, "رفع الوثائق في هذا الطلب متاح لمقدّم الطلب والموظف المسند إليه فقط.");
  } else if (existing && existing.ownerUserId !== auth.user.id) {
    throw new HttpError(403, "لا يمكنك إضافة نسخة إلى وثيقة شخصية لمستخدم آخر.");
  }
  if (confidentiality === "secret" && (waqfId || requestId)) {
    const perms = waqfAccess?.perms ?? auth.perms;
    if (!perms.has("documents.view_secret")) throw new HttpError(403, "رفع وثيقة «سرية جدًا» يتطلب صلاحية الاطلاع على الوثائق السرية جدًا.");
  }
  if (existing) {
    const { access } = await resolveDocAccess(tx, auth, existing);
    if (!canSeeDocumentSync(access, existing)) throw new HttpError(403, "ليست لديك صلاحية على هذه الوثيقة.");
  }

  // Encrypt & store
  const key = await dataKeyFor(tx, waqfId);
  const enc = encryptBuffer(input.data, key);
  const storageKey = newStorageKey({ waqfId, userId: auth.user.id });
  await getStorage().put(storageKey, enc.ct);
  onBlob(storageKey);

  let doc: DocRow;
  if (existing) doc = existing;
  else {
    [doc] = await tx
      .insert(documents)
      .values({
        waqfId, ownerUserId: auth.user.id, requestId, docType: input.docType, title: input.title, number: input.number || null,
        issuer: input.issuer || null, issuedOn: input.issuedOn || null, issuedOnHijri: input.issuedOnHijri || null,
        expiresOn: input.expiresOn || null, confidentiality, status: "quarantine", currentVersion: 1,
        // a deliverable uploaded by the team stays internal until it is released to the client
        ...(input.docType === "deliverable" && requestId && auth.isStaff ? { approvalStatus: "in_review" as const } : {}),
        createdBy: auth.user.id, updatedBy: auth.user.id,
      })
      .returning();
  }
  const [{ n }] = await tx.select({ n: max(documentVersions.version) }).from(documentVersions).where(eq(documentVersions.documentId, doc.id));
  const version = (n ?? 0) + 1;
  const [ver] = await tx
    .insert(documentVersions)
    .values({
      documentId: doc.id, waqfId, version, storageKey, sha256: sha256(input.data), sizeBytes: input.data.length, mimeType: input.mime,
      originalName: input.originalName.slice(0, 200), encrypted: true, iv: enc.iv, authTag: enc.tag, scanStatus: "pending",
      uploadedBy: auth.user.id, changeNote: input.changeNote || null,
    })
    .returning();

  // Scan (quarantine → clean | rejected)
  const verdict = await scanFile(input.data, input.kind);
  const base = { documentId: doc.id, versionId: ver.id, version, title: doc.title };
  let result: UploadResult;
  if (verdict.status === "clean") {
    await tx.update(documentVersions).set({ scanStatus: "clean", scanDetail: `${verdict.engine}: clean` }).where(eq(documentVersions.id, ver.id));
    await tx
      .update(documents)
      .set({
        status: "active",
        currentVersion: version,
        updatedBy: auth.user.id,
        // a new version of an approved document needs re-approval
        approvalStatus: existing && existing.approvalStatus === "approved" ? "in_review" : doc.approvalStatus,
        searchText: input.kind === "txt" && confidentiality === "internal" ? input.data.toString("utf8").slice(0, 20_000) : null,
      })
      .where(eq(documents.id, doc.id));
    result = { status: "clean", ...base };
    if (!existing && waqfId && input.docType === "registration_certificate" && input.expiresOn)
      await emitWaqfEvent(tx, { waqfId, event: "cert_expiry", date: input.expiresOn, refId: doc.id, actorUserId: auth.user.id });
  } else if (verdict.status === "rejected") {
    await tx.update(documentVersions).set({ scanStatus: "infected", scanDetail: `${verdict.code}: ${verdict.reason}` }).where(eq(documentVersions.id, ver.id));
    if (!existing) await tx.update(documents).set({ status: "rejected" }).where(eq(documents.id, doc.id));
    result = { status: "rejected", ...base, reason: `رُفض الملف: ${verdict.reason}. أزل المحتوى النشط واحفظ الملف من جديد ثم أعد الرفع.` };
  } else {
    await tx.update(documentVersions).set({ scanStatus: "failed", scanDetail: `${verdict.engine}: ${verdict.reason}` }).where(eq(documentVersions.id, ver.id));
    result = { status: "quarantine", ...base, reason: "تعذر فحص الملف الآن، وبقي في الحجر. أعد المحاولة لاحقًا أو تواصل مع الدعم." };
  }

  if (input.link && !existing) await linkDocument(tx, doc.id, input.link.entityType, input.link.entityId, waqfId);
  await logAccess(tx, { documentId: doc.id, versionId: ver.id, waqfId, userId: auth.user.id, action: "upload", ip: meta.ip });
  await audit(tx, {
    actorUserId: auth.user.id,
    action: result.status === "clean" ? (existing ? "documents.version_upload" : "documents.upload") : "documents.upload_rejected",
    entityType: "document",
    entityId: doc.id,
    waqfId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    after: { title: doc.title, docType: doc.docType, version, sizeBytes: input.data.length, mime: input.mime, confidentiality, scan: verdict.status, requestId },
  });
  return result;
}

/** Raising confidentiality is free (subject to view_secret for "secret"); lowering it needs documents.approve. */
export function confidentialityChangeAllowed(from: Confidentiality, to: Confidentiality, perms: ReadonlySet<string>): string | null {
  if (to === "secret" && from !== "secret" && !perms.has("documents.view_secret")) return "تصنيف «سرية جدًا» يتطلب صلاحية الاطلاع على الوثائق السرية جدًا.";
  if (CONF_RANK[to] < CONF_RANK[from] && !perms.has("documents.approve")) return "خفض درجة السرية يتطلب صلاحية اعتماد الوثائق.";
  return null;
}

