import "server-only";
import { and, eq } from "drizzle-orm";
import { withContext } from "@/server/db";
import { deliverables, outputs } from "@/server/db/schema";
import { getAuth } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { fail } from "@/server/modules/commerce/documents";
import { renderPdf } from "@/server/modules/pdf/render";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { outputDocHtml, versionOf } from "./server";

const UUID = /^[0-9a-f-]{36}$/i;

/** Staff PDF of an output version (the client receives the approved one as a document once it is released). */
export async function outputPdf(requestId: string, outputId: string, version: number | null) {
  if (!UUID.test(requestId) || !UUID.test(outputId)) return fail(404, "غير موجود");
  const auth = await getAuth();
  if (!auth || !auth.isStaff || (auth.user.mfaEnabled && !auth.session.mfaVerified)) return fail(404, "غير موجود");
  const { ip, userAgent } = await requestInfo();
  const out = await withContext(auth.db, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, requestId, "staff");
    } catch {
      return null;
    }
    const [o] = await tx.select().from(outputs).where(and(eq(outputs.id, outputId), eq(outputs.requestId, requestId))).limit(1);
    if (!o) return null;
    const v = await versionOf(tx, o.id, version ?? o.currentVersion);
    if (!v) return null;
    const [d] = o.deliverableId ? await tx.select({ signedBy: deliverables.signedBy }).from(deliverables).where(eq(deliverables.id, o.deliverableId)).limit(1) : [];
    await audit(tx, { actorUserId: auth.user.id, action: "outputs.download", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip, userAgent, after: { number: o.number, version: v.version } });
    return { html: await outputDocHtml(tx, rc, o, v, d?.signedBy ?? null), title: o.title, name: `${o.number}-v${v.version}.pdf` };
  });
  if (!out) return fail(404, "المستند غير موجود أو لا تملك صلاحية تنزيله.");
  let body: Buffer;
  try {
    body = await renderPdf(out.html, { headerTitle: out.title });
  } catch (err) {
    console.error("[outputs.pdf] render failed", err);
    return fail(503, "تعذر إنشاء ملف PDF الآن. أعد المحاولة بعد قليل.");
  }
  return new Response(new Uint8Array(body), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${out.name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
