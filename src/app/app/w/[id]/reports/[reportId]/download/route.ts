import { and, eq, inArray, isNull } from "drizzle-orm";
import { withContext } from "@/server/db";
import { reports, users } from "@/server/db/schema";
import { getAuth, loadWaqfAccess } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { pdfShell, renderPdf } from "@/server/modules/pdf/render";
import { BO_PDF_CSS, annualHtml, boDecryptor, boHtml, type AnySnapshot } from "@/server/modules/compliance/reports";
import { CATEGORY_AR, STATUS_AR, buildCsv } from "@/server/modules/compliance/pure";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

const fail = (status: number, msg: string) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** GET /app/w/[id]/reports/[reportId]/download — renders a stored package (perm reports.generate). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; reportId: string }> }) {
  const { id, reportId } = await params;
  if (!UUID.test(id) || !UUID.test(reportId)) return fail(404, "غير موجود");
  const auth = await getAuth();
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified)) return fail(401, "سجّل الدخول ثم أعد المحاولة.");
  const { ip, userAgent } = await requestInfo();

  const out = await withContext(auth.db, async (tx) => {
    const access = await loadWaqfAccess(tx, auth, id);
    if (!access || !access.perms.has("reports.generate")) return null;
    const [row] = await tx
      .select({ r: reports, by: users.fullName })
      .from(reports)
      .leftJoin(users, eq(users.id, reports.generatedBy))
      .where(and(eq(reports.id, reportId), eq(reports.waqfId, id), isNull(reports.revokedAt), inArray(reports.kind, ["annual", "gaa_package", "compliance"])))
      .limit(1);
    if (!row?.r.snapshot) return null;
    const s = row.r.snapshot as AnySnapshot;
    const canBo = access.perms.has("bo.view");
    await audit(tx, { actorUserId: auth.user.id, action: "reports.download", entityType: "report", entityId: reportId, waqfId: id, ip, userAgent, after: { number: row.r.number, package: s.package, decrypted: s.package === "bo" ? canBo : undefined } });
    const meta = { number: row.r.number, verificationCode: row.r.verificationCode, generatedBy: row.by };
    if (s.package === "obligations_csv") {
      const csv = buildCsv(
        ["الرمز", "الالتزام", "الفئة", "الحالة", "الفترة", "الموعد", "تاريخ الإنجاز", "المرجع", "المرجع بانتظار التحقق", "الجزاء المحتمل", "الأدلة", "سبب الإعفاء"],
        s.rows.map((r) => [r.code, r.title, CATEGORY_AR[r.category] ?? r.category, STATUS_AR[r.status] ?? r.status, r.periodKey, r.dueOn ?? "", r.completedOn ?? "", r.reference, r.referencePending ? "نعم" : "لا", r.penalty, r.evidence, r.waivedReason]),
      );
      return { kind: "file" as const, body: Buffer.from(csv, "utf8"), type: "text/csv; charset=utf-8", name: `${row.r.number}-obligations.csv` };
    }
    if (s.package === "bo") {
      const dec = canBo ? await boDecryptor(tx, id) : null;
      return { kind: "pdf" as const, html: pdfShell(s.title, boHtml(s, meta, dec), BO_PDF_CSS), headerTitle: `سري — ${s.title} — ${row.r.number}`, name: `${row.r.number}-beneficial-owners${canBo ? "" : "-masked"}.pdf` };
    }
    return { kind: "pdf" as const, html: pdfShell(s.title, annualHtml(s, meta)), headerTitle: `${s.title} — ${row.r.number}`, name: `${row.r.number}-annual-package.pdf` };
  });
  if (!out) return fail(404, "الحزمة غير موجودة أو لا تملك صلاحية تنزيلها.");
  let body: Buffer;
  let type: string;
  if (out.kind === "pdf") {
    try {
      body = await renderPdf(out.html, { headerTitle: out.headerTitle });
    } catch (e) {
      console.error("[reports] pdf render failed", e);
      return fail(503, "تعذر إنشاء ملف PDF الآن. أعد المحاولة بعد قليل.");
    }
    type = "application/pdf";
  } else {
    body = out.body;
    type = out.type;
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="${out.name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
