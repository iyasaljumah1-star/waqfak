"use server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { documents, documentShares, documentVersions } from "../../db/schema";
import { audit } from "../../lib/audit";
import { randomToken, sha256 } from "../../lib/crypto";
import { env } from "../../env";
import { emitWaqfEvent } from "../compliance/events";
import { parseForm, UserError, waqfAction, type WaqfCtx } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { canSeeDocumentSync, confidentialityChangeAllowed, logAccess, type DocRow } from "./service";
import { CONFIDENTIALITY, DOC_TYPES } from "./labels";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const optDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "أدخل التاريخ بصيغة صحيحة.").optional());
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max, `النص أطول من ${max} حرف.`).optional());
const ids = { waqfId: z.uuid(), docId: z.uuid() };

const docPath = (waqfId: string, docId?: string) => (docId ? [`/app/w/${waqfId}/documents`, `/app/w/${waqfId}/documents/${docId}`] : [`/app/w/${waqfId}/documents`]);

async function loadDoc(c: WaqfCtx, docId: string): Promise<DocRow> {
  const [d] = await c.tx.select().from(documents).where(and(eq(documents.id, docId), eq(documents.waqfId, c.access.waqf.id))).limit(1);
  if (!d || !canSeeDocumentSync({ userId: c.auth.user.id, perms: c.access.perms }, d)) throw new UserError("الوثيقة غير موجودة أو لا تملك صلاحية الوصول إليها.");
  return d;
}

// ───────────── Metadata ─────────────

const metaSchema = z.object({
  ...ids,
  title: z.string().trim().min(2, "اكتب عنوانًا من حرفين على الأقل.").max(200, "العنوان أطول من 200 حرف."),
  docType: z.enum(DOC_TYPES, { error: "اختر نوع الوثيقة." }),
  number: optText(100),
  issuer: optText(200),
  issuedOn: optDate,
  issuedOnHijri: optText(40),
  expiresOn: optDate,
  retentionUntil: optDate,
  confidentiality: z.enum(CONFIDENTIALITY, { error: "اختر درجة السرية." }),
});

export async function updateDocumentMeta(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(metaSchema, fd);
  if ("state" in r) return r.state;
  const f = r.data;
  return waqfAction(f.waqfId, "documents.upload", async (c) => {
    const d = await loadDoc(c, f.docId);
    if (d.approvalStatus === "locked") throw new UserError("الوثيقة مقفلة ولا يمكن تعديل بياناتها.");
    if (d.archivedAt) throw new UserError("الوثيقة مؤرشفة. استعدها أولًا ثم عدّل بياناتها.");
    const confErr = confidentialityChangeAllowed(d.confidentiality, f.confidentiality, c.access.perms);
    if (confErr) return { error: confErr, fieldErrors: { confidentiality: confErr } };
    if (f.issuedOn && f.expiresOn && f.expiresOn < f.issuedOn) return { error: "راجع الحقول المظللة.", fieldErrors: { expiresOn: "تاريخ الانتهاء قبل تاريخ الإصدار." } };
    const next = {
      title: f.title, docType: f.docType, number: f.number ?? null, issuer: f.issuer ?? null, issuedOn: f.issuedOn ?? null,
      issuedOnHijri: f.issuedOnHijri ?? null, expiresOn: f.expiresOn ?? null, retentionUntil: f.retentionUntil ?? null, confidentiality: f.confidentiality,
    };
    const before = Object.fromEntries(Object.keys(next).map((k) => [k, d[k as keyof DocRow]]));
    const changed = Object.keys(next).some((k) => (before[k] ?? null) !== next[k as keyof typeof next]);
    if (!changed) return { ok: true, message: "لا تغييرات للحفظ." };
    await c.tx
      .update(documents)
      .set({ ...next, approvalStatus: d.approvalStatus === "approved" ? "in_review" : d.approvalStatus, updatedBy: c.auth.user.id, ...(f.confidentiality !== "internal" ? { searchText: null } : {}) })
      .where(eq(documents.id, d.id));
    await logAccess(c.tx, { documentId: d.id, waqfId: d.waqfId, userId: c.auth.user.id, action: "update", ip: c.ip });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "documents.update", entityType: "document", entityId: d.id, waqfId: d.waqfId, ip: c.ip, userAgent: c.userAgent, before, after: next });
    if (next.docType === "registration_certificate" && next.expiresOn && next.expiresOn !== d.expiresOn)
      await emitWaqfEvent(c.tx, { waqfId: c.access.waqf.id, event: "cert_expiry", date: next.expiresOn, refId: d.id, actorUserId: c.auth.user.id });
    return { ok: true, message: d.approvalStatus === "approved" ? "تم حفظ البيانات، وعادت الوثيقة إلى المراجعة لاعتمادها من جديد." : "تم حفظ بيانات الوثيقة." };
  }, docPath(f.waqfId, f.docId));
}

// ───────────── Approval ─────────────

export async function approveDocument(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object(ids), fd);
  if ("state" in r) return r.state;
  const { waqfId, docId } = r.data;
  return waqfAction(waqfId, "documents.approve", async (c) => {
    const d = await loadDoc(c, docId);
    if (d.status !== "active") throw new UserError("يُتاح الاعتماد للوثائق السارية التي اجتازت الفحص الأمني.");
    if (d.approvalStatus === "approved" || d.approvalStatus === "locked") throw new UserError("الوثيقة معتمدة مسبقًا.");
    const [cur] = await c.tx
      .select({ by: documentVersions.uploadedBy })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, d.id), eq(documentVersions.version, d.currentVersion)))
      .limit(1);
    if (d.ownerUserId === c.auth.user.id || cur?.by === c.auth.user.id)
      throw new UserError("رفعتَ هذه الوثيقة بنفسك؛ يعتمدها عضو آخر يملك صلاحية الاعتماد.");
    await c.tx.update(documents).set({ approvalStatus: "approved", updatedBy: c.auth.user.id }).where(eq(documents.id, d.id));
    await logAccess(c.tx, { documentId: d.id, waqfId: d.waqfId, userId: c.auth.user.id, action: "approve", ip: c.ip });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "documents.approve", entityType: "document", entityId: d.id, waqfId: d.waqfId, ip: c.ip, userAgent: c.userAgent, before: { approvalStatus: d.approvalStatus }, after: { approvalStatus: "approved", version: d.currentVersion } });
    return { ok: true, message: "اعتُمدت الوثيقة." };
  }, docPath(waqfId, docId));
}

// ───────────── Archive (soft) ─────────────

export async function archiveDocument(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ ...ids, restore: z.preprocess(blank, z.literal("1").optional()) }), fd);
  if ("state" in r) return r.state;
  const { waqfId, docId, restore } = r.data;
  return waqfAction(waqfId, "documents.approve", async (c) => {
    const d = await loadDoc(c, docId);
    if (restore) {
      if (!d.archivedAt) return { ok: true, message: "الوثيقة غير مؤرشفة." };
      const [cur] = await c.tx
        .select({ scan: documentVersions.scanStatus })
        .from(documentVersions)
        .where(and(eq(documentVersions.documentId, d.id), eq(documentVersions.version, d.currentVersion)))
        .limit(1);
      const status = cur?.scan === "clean" ? "active" : "rejected";
      await c.tx.update(documents).set({ archivedAt: null, status, updatedBy: c.auth.user.id }).where(eq(documents.id, d.id));
      await logAccess(c.tx, { documentId: d.id, waqfId: d.waqfId, userId: c.auth.user.id, action: "restore", ip: c.ip });
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "documents.restore", entityType: "document", entityId: d.id, waqfId: d.waqfId, ip: c.ip, userAgent: c.userAgent, after: { status } });
      return { ok: true, message: "استُعيدت الوثيقة." };
    }
    if (d.archivedAt) return { ok: true, message: "الوثيقة مؤرشفة مسبقًا." };
    if (d.approvalStatus === "locked") throw new UserError("الوثيقة مقفلة ولا يمكن أرشفتها.");
    const now = new Date();
    await c.tx.update(documents).set({ archivedAt: now, status: "archived", updatedBy: c.auth.user.id }).where(eq(documents.id, d.id));
    // archiving also ends public access
    await c.tx.update(documentShares).set({ revokedAt: now }).where(and(eq(documentShares.documentId, d.id), isNull(documentShares.revokedAt)));
    await logAccess(c.tx, { documentId: d.id, waqfId: d.waqfId, userId: c.auth.user.id, action: "archive", ip: c.ip });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "documents.archive", entityType: "document", entityId: d.id, waqfId: d.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: d.status }, after: { status: "archived", retentionUntil: d.retentionUntil } });
    return { ok: true, message: "أُرشفت الوثيقة. تبقى محفوظة ويمكن استعادتها." };
  }, docPath(waqfId, docId));
}

// ───────────── Share links ─────────────

const shareSchema = z.object({
  ...ids,
  days: z.coerce.number({ error: "حدد مدة الصلاحية." }).int().min(1, "أقل مدة يوم واحد.").max(30, "أقصى مدة 30 يومًا."),
  maxUses: z.coerce.number({ error: "حدد عدد مرات التنزيل." }).int().min(1, "مرة واحدة على الأقل.").max(50, "50 مرة على الأكثر."),
});

export async function createShareLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(shareSchema, fd);
  if ("state" in r) return r.state;
  const { waqfId, docId, days, maxUses } = r.data;
  return waqfAction(waqfId, "documents.share", async (c) => {
    const d = await loadDoc(c, docId);
    if (d.status !== "active" || d.archivedAt) throw new UserError("تُتاح المشاركة للوثائق السارية غير المؤرشفة.");
    if (d.confidentiality === "secret") throw new UserError("لا تُشارك الوثائق «السرية جدًا» عبر روابط عامة. خفّض درجة السرية أولًا إن كان ذلك مناسبًا.");
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const [s] = await c.tx
      .insert(documentShares)
      .values({ documentId: d.id, waqfId: d.waqfId, tokenHash: sha256(token), createdBy: c.auth.user.id, expiresAt, maxUses })
      .returning({ id: documentShares.id });
    await logAccess(c.tx, { documentId: d.id, waqfId: d.waqfId, userId: c.auth.user.id, action: "share", ip: c.ip });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "documents.share", entityType: "document", entityId: d.id, waqfId: d.waqfId, ip: c.ip, userAgent: c.userAgent, after: { shareId: s.id, expiresAt, maxUses } });
    return { ok: true, message: "أُنشئ الرابط. انسخه الآن؛ فهو يظهر هذه المرة فقط.", data: { url: `${env.APP_URL}/s/${token}` } };
  }, docPath(waqfId, docId));
}

export async function revokeShareLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ ...ids, shareId: z.uuid() }), fd);
  if ("state" in r) return r.state;
  const { waqfId, docId, shareId } = r.data;
  return waqfAction(waqfId, "documents.share", async (c) => {
    const d = await loadDoc(c, docId);
    const res = await c.tx
      .update(documentShares)
      .set({ revokedAt: new Date() })
      .where(and(eq(documentShares.id, shareId), eq(documentShares.documentId, d.id), isNull(documentShares.revokedAt)))
      .returning({ id: documentShares.id });
    if (!res.length) return { ok: true, message: "الرابط ملغى مسبقًا." };
    await logAccess(c.tx, { documentId: d.id, waqfId: d.waqfId, userId: c.auth.user.id, action: "share_revoke", ip: c.ip });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "documents.share_revoke", entityType: "document", entityId: d.id, waqfId: d.waqfId, ip: c.ip, userAgent: c.userAgent, after: { shareId } });
    return { ok: true, message: "أُلغي الرابط ولم يعد يعمل." };
  }, docPath(waqfId, docId));
}
