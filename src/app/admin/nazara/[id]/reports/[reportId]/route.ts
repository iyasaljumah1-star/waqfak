import { and, eq, inArray, isNull } from "drizzle-orm";
import { withContext } from "@/server/db";
import { nazaraEngagements, reports } from "@/server/db/schema";
import { getAuth } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { pdfShell, renderPdf } from "@/server/modules/pdf/render";
import { nameOf, nazaraFile } from "@/server/modules/nazara/report";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;
const fail = (status: number, msg: string) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** GET /admin/nazara/[id]/reports/[reportId] — nazara outputs for the team (drafts included). Perm: nazara.view + waqf access (RLS). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; reportId: string }> }) {
  const { id, reportId } = await params;
  if (!UUID.test(id) || !UUID.test(reportId)) return fail(404, "غير موجود");
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "pdf";
  const auth = await getAuth();
  if (!auth || !auth.isStaff || !auth.session.mfaVerified || !auth.perms.has("nazara.view")) return fail(401, "سجّل الدخول بحساب فريق النظارة ثم أعد المحاولة.");
  const { ip, userAgent } = await requestInfo();
  const out = await withContext(auth.db, async (tx) => {
    const [e] = await tx.select({ waqfId: nazaraEngagements.waqfId }).from(nazaraEngagements).where(eq(nazaraEngagements.id, id)).limit(1);
    if (!e) return null;
    const [row] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.waqfId, e.waqfId), isNull(reports.revokedAt), inArray(reports.kind, ["nazara_periodic", "nazara_takeover", "nazara_handover"])))
      .limit(1);
    if (!row?.snapshot) return null;
    await audit(tx, { actorUserId: auth.user.id, action: "reports.download", entityType: "report", entityId: row.id, waqfId: e.waqfId, ip, userAgent, after: { number: row.number, kind: row.kind, format } });
    return nazaraFile(row, { generatedBy: await nameOf(tx, row.generatedBy), approvedBy: await nameOf(tx, row.approvedBy) }, format);
  });
  if (!out) return fail(404, "المستند غير موجود أو لا تملك صلاحية تنزيله.");
  let body: Buffer;
  let type: string;
  if (out.kind === "pdf") {
    try {
      body = await renderPdf(pdfShell(out.title, out.html), { headerTitle: out.headerTitle });
    } catch (err) {
      console.error("[nazara] pdf render failed", err);
      return fail(503, "تعذر إنشاء ملف PDF الآن. أعد المحاولة بعد قليل.");
    }
    type = "application/pdf";
  } else {
    body = out.body;
    type = out.type;
  }
  return new Response(new Uint8Array(body), {
    headers: { "content-type": type, "content-disposition": `attachment; filename="${out.name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
