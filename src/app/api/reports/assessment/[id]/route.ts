import { withContext } from "@/server/db";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { resolveAssessment } from "@/server/modules/assessment/access";
import { loadResultBundle } from "@/server/modules/assessment/queries";
import { assessmentReportHtml } from "@/server/modules/assessment/report";
import { renderPdf } from "@/server/modules/pdf/render";

export const runtime = "nodejs";

/**
 * GET /api/reports/assessment/[id] — the assessment report as PDF.
 * Allowed: the respondent (owner), a member of the linked waqf with assessment.view, a reviewer of a deep
 * assessment, or the browser holding the anonymous cookie. Everyone else gets 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = await resolveAssessment(id);
  if (!v) return new Response("التقرير غير موجود أو لا تملك صلاحية الوصول إليه.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (v.row.status === "draft") return new Response("أكمل التقييم أولًا ثم نزّل التقرير.", { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
  const { ip, userAgent } = await requestInfo();
  const bundle = await withContext(v.db, async (tx) => {
    const b = await loadResultBundle(tx, v.row);
    if (b) {
      await audit(tx, {
        actorUserId: v.auth?.user.id ?? null, actorLabel: v.auth ? null : "زائر (تقييم مجهول)", action: "assessment.report_download",
        entityType: "assessment", entityId: v.row.id, waqfId: v.row.waqfId, ip, userAgent,
      });
    }
    return b;
  });
  if (!bundle) return new Response("لم تُحسب النتيجة بعد.", { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
  try {
    const pdf = await renderPdf(assessmentReportHtml(bundle), { headerTitle: `تقرير التقييم الوقفي ${bundle.number}` });
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="waqf-assessment-${bundle.number}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.error("[pdf]", e);
    return new Response("تعذر إنشاء ملف PDF الآن. أعد المحاولة بعد دقيقة.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
