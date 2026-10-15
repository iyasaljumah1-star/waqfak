import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { withContext } from "@/server/db";
import { documents, documentVersions } from "@/server/db/schema";
import { getAuth } from "@/server/authz/context";
import { requestInfo } from "@/server/lib/request-info";
import { canSeeDocument, logAccess, readVersionPlain, resolveDocAccess } from "@/server/modules/documents/service";
import { fileResponse, htmlPreviewResponse, jsonError } from "@/server/modules/documents/http";
import { kindFromMime } from "@/server/adapters/scan";
import { officePreview } from "@/server/adapters/office-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/files/[documentId]?v=<versionId>&disposition=inline|attachment
 * inline on a Word/Excel file returns a read-only HTML preview of its text (sandboxed, no script).
 * RLS (user context) + confidentiality gate; only clean versions are served; every access is logged.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const auth = await getAuth();
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified)) return jsonError(401, "سجّل الدخول أولًا.");
  if (!UUID.test(documentId)) return jsonError(404, "الوثيقة غير موجودة.");
  const v = req.nextUrl.searchParams.get("v");
  if (v && !UUID.test(v)) return jsonError(404, "النسخة غير موجودة.");
  const inline = req.nextUrl.searchParams.get("disposition") === "inline";
  const { ip } = await requestInfo();

  try {
    const out = await withContext(auth.db, async (tx) => {
      const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);
      if (!doc) {
        await logAccess(tx, { documentId, userId: auth.user.id, action: "denied", ip });
        return { error: 404 as const };
      }
      const { access } = await resolveDocAccess(tx, auth, doc);
      if (!(await canSeeDocument(access, doc))) {
        await logAccess(tx, { documentId, waqfId: doc.waqfId, userId: auth.user.id, action: "denied", ip });
        return { error: 403 as const };
      }
      const [ver] = await tx
        .select()
        .from(documentVersions)
        .where(and(eq(documentVersions.documentId, doc.id), v ? eq(documentVersions.id, v) : eq(documentVersions.version, doc.currentVersion)))
        .limit(1);
      if (!ver) return { error: 404 as const };
      if (ver.scanStatus !== "clean") return { error: 409 as const };
      const data = await readVersionPlain(tx, doc, ver);
      await logAccess(tx, { documentId, versionId: ver.id, waqfId: doc.waqfId, userId: auth.user.id, action: inline ? "view" : "download", ip });
      return { data, ver, doc };
    });
    if ("error" in out) {
      if (out.error === 404) return jsonError(404, "الوثيقة غير موجودة أو لا تملك صلاحية الوصول إليها.");
      if (out.error === 403) return jsonError(403, "ليست لديك صلاحية الاطلاع على هذه الوثيقة بحسب درجة سريتها.");
      return jsonError(409, "هذه النسخة لم تجتز الفحص الأمني، ولا يمكن فتحها.");
    }
    // Word and Excel cannot be shown by the browser: «view» returns a read-only text preview of the file instead.
    const kind = kindFromMime(out.ver.mimeType);
    if (inline && (kind === "docx" || kind === "xlsx")) {
      const pv = officePreview(out.data, kind, out.doc.title);
      return pv.ok ? htmlPreviewResponse(pv.html) : jsonError(422, pv.reason);
    }
    return fileResponse(out.data, out.ver.mimeType, out.ver.originalName, inline);
  } catch (e) {
    console.error("[files.get]", e);
    return jsonError(500, "تعذر فتح الملف. أعد المحاولة، وإن تكررت المشكلة تواصل مع الدعم.");
  }
}
