import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/server/authz/context";
import { withContext } from "@/server/db";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { loadRtm } from "@/server/modules/admin/editors/compliance.queries";
import { filterRtm, RTM_CSV_HEADER, rtmCsvRows } from "@/server/modules/admin/editors/pure";
import { buildCsv } from "@/server/modules/compliance/pure";

/** CSV export of the requirements traceability matrix (same filters as the page). Audited. */
export async function GET(req: NextRequest) {
  const auth = await requireStaff("admin.compliance");
  const p = req.nextUrl.searchParams;
  const f = { q: p.get("q") ?? "", source: p.get("source") ?? "", status: p.get("status") ?? "", area: p.get("area") ?? "", kind: p.get("kind") ?? "", gaps: p.get("gaps") === "1" };
  const { ip, userAgent } = await requestInfo();
  const rows = await withContext(auth.db, async (tx) => {
    const r = filterRtm(await loadRtm(tx), f);
    await audit(tx, { actorUserId: auth.user.id, action: "admin.traceability.export", entityType: "rtm", entityId: null, ip, userAgent, after: { filters: f, requirements: r.length } });
    return r;
  });
  const csv = buildCsv(RTM_CSV_HEADER, rtmCsvRows(rows));
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="waqfak-rtm-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
