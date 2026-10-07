import type { NextRequest } from "next/server";
import { z } from "zod";
import { withContext } from "@/server/db";
import { getAuth } from "@/server/authz/context";
import { env } from "@/server/env";
import { requestInfo } from "@/server/lib/request-info";
import { rateLimit } from "@/server/lib/rate-limit";
import { MAX_UPLOAD_BYTES, sniffFile } from "@/server/adapters/scan";
import { getStorage } from "@/server/adapters/storage";
import { HttpError, ingestUpload } from "@/server/modules/documents/service";
import { CONFIDENTIALITY, DOC_TYPES } from "@/server/modules/documents/labels";
import { jsonError, sameOrigin } from "@/server/modules/documents/http";
import { UserError } from "@/server/modules/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const opt = <T extends z.ZodType>(s: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), s.optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "صيغة التاريخ غير صحيحة.");

const fields = z.object({
  documentId: opt(z.uuid()),
  waqfId: opt(z.uuid()),
  requestId: opt(z.uuid()),
  docType: opt(z.enum(DOC_TYPES)),
  title: opt(z.string().trim().max(200, "العنوان أطول من 200 حرف.")),
  confidentiality: opt(z.enum(CONFIDENTIALITY)),
  number: opt(z.string().trim().max(100)),
  issuer: opt(z.string().trim().max(200)),
  issuedOn: opt(date),
  issuedOnHijri: opt(z.string().trim().max(40)),
  expiresOn: opt(date),
  changeNote: opt(z.string().trim().max(500)),
  linkEntityType: opt(z.string().regex(/^[a-z][a-z_]{1,39}$/)),
  linkEntityId: opt(z.uuid()),
});

/** POST /api/files — multipart upload (field "file" + metadata). See CONVENTIONS.md "Files API". */
export async function POST(req: NextRequest) {
  const auth = await getAuth();
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified)) return jsonError(401, "سجّل الدخول أولًا ثم أعد رفع الملف.");
  if (!sameOrigin(req, env.APP_URL)) return jsonError(403, "طلب من مصدر غير موثوق.");
  if (!(await rateLimit(`upload:${auth.user.id}`, 60, 3600))) return jsonError(429, "رفعت ملفات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 256 * 1024) return jsonError(413, "حجم الملف أكبر من 15 ميغابايت. اضغط الملف أو قسّمه ثم أعد الرفع.");

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return jsonError(400, "تعذر قراءة الملف المرفوع. أعد المحاولة.");
  }
  const file = fd.get("file");
  if (!(file instanceof File)) return jsonError(400, "لم يصل أي ملف. اختر ملفًا ثم أعد المحاولة.");
  if (file.size > MAX_UPLOAD_BYTES) return jsonError(413, "حجم الملف أكبر من 15 ميغابايت. اضغط الملف أو قسّمه ثم أعد الرفع.");

  const raw: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (k !== "file" && typeof v === "string") raw[k] = v;
  const parsed = fields.safeParse(raw);
  if (!parsed.success) return jsonError(400, "بعض بيانات الوثيقة غير صحيحة. راجعها ثم أعد المحاولة.", { issues: parsed.error.issues.map((i) => i.path.join(".")) });
  const f = parsed.data;
  if (!!f.linkEntityType !== !!f.linkEntityId) return jsonError(400, "رابط الوثيقة ناقص.");

  const data = Buffer.from(await file.arrayBuffer());
  const originalName = (file.name || "document").normalize("NFC");
  const sniff = await sniffFile(data, originalName);
  if (!sniff.ok) return jsonError(sniff.code === "too_large" ? 413 : 415, sniff.message, { code: sniff.code });

  const { ip, userAgent } = await requestInfo();
  let blobKey: string | null = null;
  try {
    const res = await withContext(auth.db, (tx) =>
      ingestUpload(tx, auth, { ip, userAgent }, {
        data,
        originalName,
        kind: sniff.kind,
        mime: sniff.mime,
        documentId: f.documentId,
        waqfId: f.waqfId,
        requestId: f.requestId,
        docType: f.docType ?? "other",
        title: f.title || originalName.replace(/\.[^.]+$/, "").slice(0, 200) || "وثيقة",
        confidentiality: f.confidentiality ?? "internal",
        number: f.number,
        issuer: f.issuer,
        issuedOn: f.issuedOn,
        issuedOnHijri: f.issuedOnHijri,
        expiresOn: f.expiresOn,
        changeNote: f.changeNote,
        link: f.linkEntityType && f.linkEntityId ? { entityType: f.linkEntityType, entityId: f.linkEntityId } : null,
      }, (k) => (blobKey = k)),
    );
    const body = { id: res.documentId, versionId: res.versionId, version: res.version, title: res.title, status: res.status };
    if (res.status === "clean") return Response.json(body, { status: 201, headers: { "Cache-Control": "no-store" } });
    return jsonError(res.status === "rejected" ? 422 : 202, res.reason, body);
  } catch (e) {
    if (blobKey) await getStorage().delete(blobKey).catch(() => undefined);
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    if (e instanceof UserError) return jsonError(400, e.message);
    console.error("[files.upload]", e);
    return jsonError(500, "تعذر حفظ الملف. أعد المحاولة، وإن تكررت المشكلة تواصل مع الدعم.");
  }
}
