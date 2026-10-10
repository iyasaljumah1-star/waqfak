import "server-only";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { withContext, type Tx } from "@/server/db";
import { aiInteractions, documentVersions, documents, extractedFields } from "@/server/db/schema";
import { ForbiddenError, loadWaqfAccess, type Auth, type WaqfAccess } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { rateLimit } from "@/server/lib/rate-limit";
import { UserError } from "../_shared";
import { emitWaqfEvent } from "../compliance/events";
import { canSeeDocumentSync, logAccess, readVersionPlain } from "../documents/core";
import { DOC_TYPES, docTypeLabel } from "../documents/labels";
import { extractText, suggestFields, type FieldSuggestion } from "./extract";
import { maskPII } from "./safety";
import type { AssistDoc, SuggestionView } from "./types";

/**
 * Document assist: best-effort extraction of key fields from a document the user can see. Results are stored in
 * extracted_fields with status "suggested" and are only applied to the document after a human approves them.
 * Secret documents are never processed.
 */

export const ASSIST_MIMES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
const MAX_BYTES = 15 * 1024 * 1024;

export const FIELD_LABEL: Record<string, string> = {
  number: "رقم الوثيقة", issuedOn: "تاريخ الإصدار", issuedOnHijri: "تاريخ الإصدار الهجري", expiresOn: "تاريخ الانتهاء", issuer: "جهة الإصدار", docType: "نوع الوثيقة",
};
type FieldKey = FieldSuggestion["field"];
const COLUMN: Record<FieldKey, "number" | "issuedOn" | "issuedOnHijri" | "expiresOn" | "issuer" | "docType"> = {
  number: "number", issuedOn: "issuedOn", issuedOnHijri: "issuedOnHijri", expiresOn: "expiresOn", issuer: "issuer", docType: "docType",
};


const docAccess = (auth: Auth, access: WaqfAccess) => ({ userId: auth.user.id, perms: access.perms });

/** Documents of the waqf the assistant may read for this user (visible, not secret, clean, supported type). */
export async function listAssistableDocuments(tx: Tx, auth: Auth, access: WaqfAccess): Promise<AssistDoc[]> {
  if (!access.perms.has("documents.view")) return [];
  const rows = await tx
    .select({ d: documents, mime: documentVersions.mimeType, scan: documentVersions.scanStatus })
    .from(documents)
    .innerJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), eq(documentVersions.version, documents.currentVersion)))
    .where(and(eq(documents.waqfId, access.waqf.id), isNull(documents.archivedAt), ne(documents.status, "rejected"), ne(documents.confidentiality, "secret"), inArray(documentVersions.mimeType, ASSIST_MIMES)))
    .orderBy(desc(documents.updatedAt))
    .limit(60);
  return rows.filter((r) => r.scan === "clean" && canSeeDocumentSync(docAccess(auth, access), r.d)).map((r) => ({ id: r.d.id, title: r.d.title, docType: r.d.docType, mime: r.mime }));
}

function display(field: string, value: string) {
  return field === "docType" ? docTypeLabel(value) : value;
}

export async function loadSuggestions(tx: Tx, docId: string): Promise<SuggestionView[]> {
  const [doc] = await tx.select().from(documents).where(eq(documents.id, docId)).limit(1);
  if (!doc) return [];
  const rows = await tx.select().from(extractedFields).where(and(eq(extractedFields.documentId, docId), eq(extractedFields.source, "ai_local"))).orderBy(desc(extractedFields.createdAt));
  return rows.map((r) => {
    const cur = doc[COLUMN[r.field as FieldKey] ?? "number"] as string | null;
    const [value, evidence] = splitEvidence(r.value ?? "");
    return { id: r.id, field: r.field, label: FIELD_LABEL[r.field] ?? r.field, value, display: display(r.field, value), confidence: Number(r.confidence ?? 0), status: r.status, current: cur ? display(r.field, cur) : null, evidence };
  });
}

// The schema has no evidence column: the snippet is kept after a separator inside `value` (see Requests to integrator).
const SEP = "␞";
const joinEvidence = (value: string, evidence: string) => (evidence ? `${value}${SEP}${evidence.slice(0, 240)}` : value);
function splitEvidence(v: string): [string, string | null] {
  const i = v.indexOf(SEP);
  return i < 0 ? [v, null] : [v.slice(0, i), v.slice(i + 1)];
}

async function loadAccess(tx: Tx, auth: Auth, waqfId: string) {
  const access = await loadWaqfAccess(tx, auth, waqfId);
  if (!access) throw new ForbiddenError("لا يمكنك الوصول إلى هذا الوقف.");
  if (!access.perms.has("ai.use") || !access.perms.has("documents.view")) throw new ForbiddenError();
  return access;
}

export type ExtractOutcome = { ok: true; message: string; suggestions: SuggestionView[] } | { ok: false; message: string };

export async function runExtraction(auth: Auth, waqfId: string, documentId: string, meta: { ip: string; userAgent: string }): Promise<ExtractOutcome> {
  if (!(await rateLimit(`ai:extract:${auth.user.id}`, 20, 3600))) throw new UserError("طلبت استخراجًا كثيرًا خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.");
  return withContext(auth.db, async (tx) => {
    const access = await loadAccess(tx, auth, waqfId);
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.waqfId, waqfId))).limit(1);
    if (!doc || !canSeeDocumentSync(docAccess(auth, access), doc)) throw new UserError("الوثيقة غير موجودة أو لا تملك صلاحية الاطلاع عليها.");
    if (doc.confidentiality === "secret") return { ok: false, message: "تُستثنى الوثائق «السرية جدًا» من المعالجة الآلية؛ أدخل بياناتها يدويًا من صفحة الوثيقة." };
    if (doc.archivedAt || doc.status === "rejected") return { ok: false, message: "الوثيقة مؤرشفة أو مرفوضة، فلا يمكن استخراج بياناتها." };
    const [v] = await tx.select().from(documentVersions).where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.version, doc.currentVersion))).limit(1);
    if (!v || v.scanStatus !== "clean") return { ok: false, message: "لم يكتمل فحص الملف الأمني بعد، أو لم يجتزه. أعد المحاولة بعد اكتمال الفحص." };
    if (!ASSIST_MIMES.includes(v.mimeType)) return { ok: false, message: "يدعم الاستخراج ملفات PDF النصية وWord والنص فقط. أدخل البيانات يدويًا لهذا النوع." };
    if (v.sizeBytes > MAX_BYTES) return { ok: false, message: "الملف أكبر من الحد المسموح للاستخراج الآلي." };

    let text = "";
    try {
      text = extractText(await readVersionPlain(tx, doc, v), v.mimeType);
    } catch {
      return { ok: false, message: "تعذرت قراءة الملف. أدخل البيانات يدويًا من صفحة الوثيقة." };
    }
    await logAccess(tx, { documentId: doc.id, versionId: v.id, waqfId, userId: auth.user.id, action: "ai_extract", ip: meta.ip });
    const found = text.replace(/\s+/g, " ").trim().length >= 15 ? suggestFields(text) : [];

    await tx.delete(extractedFields).where(and(eq(extractedFields.documentId, doc.id), eq(extractedFields.source, "ai_local"), eq(extractedFields.status, "suggested")));
    if (found.length) {
      await tx.insert(extractedFields).values(
        found.map((f) => ({ documentId: doc.id, waqfId, field: f.field, value: joinEvidence(f.value, f.evidence), confidence: f.confidence.toFixed(3), status: "suggested", source: "ai_local" })),
      );
    }
    const type = found.find((f) => f.field === "docType");
    if (type && access.perms.has("documents.upload") && (DOC_TYPES as readonly string[]).includes(type.value)) {
      await tx.update(documents).set({ aiSuggestedType: type.value }).where(eq(documents.id, doc.id));
    }
    const [row] = await tx
      .insert(aiInteractions)
      .values({
        userId: auth.user.id, waqfId, kind: "extract", input: `document:${doc.id}`,
        sources: [{ documentId: doc.id, title: doc.title, snippet: "" }],
        output: maskPII(found.map((f) => `${f.field}=${f.value} (${f.confidence})`).join("; ") || "no_text"),
        provider: "local", refused: false,
      })
      .returning({ id: aiInteractions.id });
    await audit(tx, { actorUserId: auth.user.id, action: "ai.extract", entityType: "document", entityId: doc.id, waqfId, ip: meta.ip, userAgent: meta.userAgent, after: { interaction: row.id, fields: found.map((f) => f.field) } });

    if (!found.length) {
      return text.trim().length < 15
        ? { ok: false, message: "لم نجد نصًا قابلًا للقراءة في الملف؛ قد يكون صورة ممسوحة ضوئيًا. أدخل البيانات يدويًا من صفحة الوثيقة." }
        : { ok: false, message: "قرأنا نص الملف ولم نجد فيه رقمًا أو تاريخًا أو جهة إصدار واضحة. أدخل البيانات يدويًا من صفحة الوثيقة." };
    }
    return { ok: true, message: `اقترحنا ${found.length} ${found.length === 1 ? "حقلًا" : "حقول"}. راجع كل قيمة قبل اعتمادها.`, suggestions: await loadSuggestions(tx, doc.id) };
  });
}

/** Human decision on one suggestion. Approval applies the value only when the document field is still empty. */
export async function decideSuggestion(auth: Auth, waqfId: string, fieldId: string, decision: "approve" | "reject", meta: { ip: string; userAgent: string }) {
  return withContext(auth.db, async (tx) => {
    const access = await loadAccess(tx, auth, waqfId);
    if (!access.perms.has("documents.upload")) throw new ForbiddenError("اعتماد بيانات الوثائق يحتاج صلاحية رفع الوثائق وتعديلها.");
    const [f] = await tx.select().from(extractedFields).where(and(eq(extractedFields.id, fieldId), eq(extractedFields.waqfId, waqfId))).limit(1);
    if (!f) throw new UserError("لم نجد هذا الاقتراح. حدّث الصفحة ثم أعد المحاولة.");
    if (f.status !== "suggested") throw new UserError("سبق البت في هذا الاقتراح.");
    const [doc] = await tx.select().from(documents).where(eq(documents.id, f.documentId)).limit(1);
    if (!doc || !canSeeDocumentSync(docAccess(auth, access), doc)) throw new UserError("الوثيقة غير موجودة أو لا تملك صلاحية الاطلاع عليها.");
    const now = new Date();
    const [value] = splitEvidence(f.value ?? "");

    if (decision === "reject") {
      await tx.update(extractedFields).set({ status: "rejected", reviewedBy: auth.user.id, reviewedAt: now }).where(eq(extractedFields.id, f.id));
      await audit(tx, { actorUserId: auth.user.id, action: "ai.extract.reject", entityType: "extracted_field", entityId: f.id, waqfId, ip: meta.ip, userAgent: meta.userAgent, after: { field: f.field } });
      return { message: "رُفض الاقتراح ولن يُطبق." };
    }

    const col = COLUMN[f.field as FieldKey];
    const current = col ? (doc[col] as string | null) : null;
    const empty = col === "docType" ? doc.docType === "other" : !current;
    const validType = col !== "docType" || (DOC_TYPES as readonly string[]).includes(value);
    const canApply = !!col && empty && validType && !doc.archivedAt && doc.approvalStatus !== "locked";
    if (!canApply) {
      await tx.update(extractedFields).set({ status: "approved", reviewedBy: auth.user.id, reviewedAt: now }).where(eq(extractedFields.id, f.id));
      await audit(tx, { actorUserId: auth.user.id, action: "ai.extract.approve", entityType: "extracted_field", entityId: f.id, waqfId, ip: meta.ip, userAgent: meta.userAgent, after: { field: f.field, applied: false } });
      return { message: "اعتُمد الاقتراح دون تطبيقه، لأن للوثيقة قيمة مسجلة في هذا الحقل أو لأنها مقفلة. عدّلها من صفحة الوثيقة إن لزم." };
    }
    if (col === "expiresOn" && doc.issuedOn && value < doc.issuedOn) throw new UserError("تاريخ الانتهاء المقترح يسبق تاريخ الإصدار المسجل؛ لن يُطبق. راجع الوثيقة يدويًا.");
    if (col === "issuedOn" && doc.expiresOn && value > doc.expiresOn) throw new UserError("تاريخ الإصدار المقترح بعد تاريخ الانتهاء المسجل؛ لن يُطبق. راجع الوثيقة يدويًا.");
    const before = { [col]: current };
    await tx
      .update(documents)
      .set({ [col]: value, approvalStatus: doc.approvalStatus === "approved" ? "in_review" : doc.approvalStatus, updatedBy: auth.user.id })
      .where(eq(documents.id, doc.id));
    await tx.update(extractedFields).set({ status: "applied", reviewedBy: auth.user.id, reviewedAt: now }).where(eq(extractedFields.id, f.id));
    await logAccess(tx, { documentId: doc.id, waqfId, userId: auth.user.id, action: "update", ip: meta.ip });
    await audit(tx, { actorUserId: auth.user.id, action: "ai.extract.apply", entityType: "document", entityId: doc.id, waqfId, ip: meta.ip, userAgent: meta.userAgent, before, after: { [col]: value, fieldId: f.id } });
    const certType = col === "docType" ? value : doc.docType;
    const expires = col === "expiresOn" ? value : doc.expiresOn;
    if (certType === "registration_certificate" && expires && (col === "expiresOn" || col === "docType")) {
      await emitWaqfEvent(tx, { waqfId, event: "cert_expiry", date: expires, refId: doc.id, actorUserId: auth.user.id });
    }
    return { message: doc.approvalStatus === "approved" ? "طُبقت القيمة على الوثيقة، وعادت الوثيقة إلى المراجعة لاعتمادها من جديد." : "طُبقت القيمة على بيانات الوثيقة." };
  });
}
