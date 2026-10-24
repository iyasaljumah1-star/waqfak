import "server-only";
import { and, count, eq, gt, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import {
  assessments, breakGlassAccess, contactMessages, dataSubjectRequests, invoices, obligationInstances, outboxMessages,
  serviceRequests, tasks, users, waqfs,
} from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { COMPLETE_WAQF_SQL } from "@/server/modules/waqf-core/completeness";

const CLOSED = ["draft", "completed", "closed", "cancelled", "rejected"] as const;

export type DashboardData = {
  clients?: { total: number; new30: number };
  /** complete = what «الأوقاف» lists (waqf-core/completeness); inProgress = drafts and files still being completed. */
  waqfs?: { complete: number; inProgress: number; demo: number; reviews: number };
  requests?: { scope: "all" | "mine"; byStatus: { status: string; n: number }[]; open: number; slaBreaches: number; unassigned: number | null; withoutWaqf: number; total: number };
  obligations?: { overdue: number; dueSoon: number; waqfsAffected: number };
  invoices?: { outstanding: number; amount: number; overdue: number };
  assessments?: { awaitingReview: number };
  contact?: { new: number };
  breakGlass?: { pending: number; active: number };
  privacy?: { open: number; overdue: number };
  outbox?: { queued: number; failed: number };
};

/** Company KPIs, each computed only when the viewer holds the permission that governs it. RLS applies to every query. */
export async function dashboardData(auth: Auth): Promise<DashboardData> {
  const can = (p: string) => auth.perms.has(p);
  return read(auth, async (tx) => {
    const out: DashboardData = {};
    const now = new Date();

    if (can("admin.users")) {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [r] = await tx
        .select({ total: count(), new30: sql<number>`count(*) filter (where ${users.createdAt} > ${since})`.mapWith(Number) })
        .from(users)
        .where(and(eq(users.isStaff, false), notInArray(users.status, ["deleted"])));
      const [c] = await tx.select({ n: count() }).from(contactMessages).where(eq(contactMessages.status, "new"));
      out.clients = { total: r.total, new30: r.new30 };
      out.contact = { new: c.n };
    }

    if (can("admin.waqfs.all")) {
      const wr = await tx.execute<{ complete: number; total: number; demo: number }>(sql`
        select count(*) filter (where ${COMPLETE_WAQF_SQL})::int as complete, count(*)::int as total, count(*) filter (where w.is_demo)::int as demo
        from waqfs w where w.archived_at is null and w.status <> 'ended' and not (w.creation_mode = 'bequest' and w.status = 'idea')`);
      const [rv] = await tx.select({ n: count() }).from(tasks).where(and(eq(tasks.kind, "file_review"), inArray(tasks.status, ["todo", "in_progress"])));
      const row = wr.rows[0] ?? { complete: 0, total: 0, demo: 0 };
      out.waqfs = { complete: Number(row.complete), inProgress: Number(row.total) - Number(row.complete), demo: Number(row.demo), reviews: rv.n };
      const [o] = await tx
        .select({
          overdue: sql<number>`count(*) filter (where ${obligationInstances.status} = 'overdue')`.mapWith(Number),
          dueSoon: sql<number>`count(*) filter (where ${obligationInstances.status} = 'due_soon')`.mapWith(Number),
          waqfsAffected: sql<number>`count(distinct ${obligationInstances.waqfId}) filter (where ${obligationInstances.status} = 'overdue')`.mapWith(Number),
        })
        .from(obligationInstances);
      out.obligations = o;
    }

    const allReq = can("admin.requests.all");
    if (allReq || can("staff.requests.assigned")) {
      const scope = allReq ? undefined : eq(serviceRequests.assignedToUserId, auth.user.id);
      const open = and(notInArray(serviceRequests.status, [...CLOSED]), scope);
      const byStatus = await tx.select({ status: serviceRequests.status, n: count() }).from(serviceRequests).where(open).groupBy(serviceRequests.status);
      const [b] = await tx
        .select({ n: count() })
        .from(serviceRequests)
        .where(and(open, lt(serviceRequests.slaDueAt, now), notInArray(serviceRequests.status, ["awaiting_client", "on_hold", "awaiting_client_approval"])));
      let unassigned: number | null = null;
      if (allReq) {
        const [u] = await tx.select({ n: count() }).from(serviceRequests).where(and(open, isNull(serviceRequests.assignedToUserId)));
        unassigned = u.n;
      }
      const [nw] = await tx.select({ n: count() }).from(serviceRequests).where(and(open, isNull(serviceRequests.waqfId)));
      const [all] = await tx.select({ n: count() }).from(serviceRequests).where(and(scope, notInArray(serviceRequests.status, ["draft"])));
      out.requests = {
        withoutWaqf: nw.n, total: all.n,
        scope: allReq ? "all" : "mine",
        byStatus: byStatus.map((r) => ({ status: r.status, n: r.n })).sort((a, b) => b.n - a.n),
        open: byStatus.reduce((s, r) => s + r.n, 0),
        slaBreaches: b.n,
        unassigned,
      };
    }

    if (can("admin.finance")) {
      // Payable invoices only (no proformas or credit notes); the amount is what remains after confirmed payments.
      const [i] = await tx
        .select({
          outstanding: count(),
          amount: sql<number>`coalesce(sum(${invoices.total} - coalesce((select sum(p.amount) from payments p where p.invoice_id = ${invoices.id} and p.status = 'paid'), 0)), 0)`.mapWith(Number),
          overdue: sql<number>`count(*) filter (where ${invoices.status} = 'overdue' or (${invoices.dueOn} is not null and ${invoices.dueOn} < current_date))`.mapWith(Number),
        })
        .from(invoices)
        .where(and(inArray(invoices.status, ["issued", "partially_paid", "overdue"]), notInArray(invoices.kind, ["proforma", "credit_note"])));
      out.invoices = { outstanding: i.outstanding, amount: i.amount ?? 0, overdue: i.overdue };
    }

    if (can("staff.assessment_review")) {
      const [a] = await tx.select({ n: count() }).from(assessments).where(and(eq(assessments.kind, "deep"), eq(assessments.status, "under_review")));
      out.assessments = { awaitingReview: a.n };
    }

    if (can("breakglass.approve")) {
      const [g] = await tx
        .select({
          pending: sql<number>`count(*) filter (where ${breakGlassAccess.status} = 'requested')`.mapWith(Number),
          active: sql<number>`count(*) filter (where ${breakGlassAccess.status} = 'approved' and ${breakGlassAccess.expiresAt} > now())`.mapWith(Number),
        })
        .from(breakGlassAccess);
      out.breakGlass = g;
    }

    if (can("admin.notifications")) {
      const [d] = await tx
        .select({
          open: count(),
          overdue: sql<number>`count(*) filter (where ${dataSubjectRequests.dueAt} < now())`.mapWith(Number),
        })
        .from(dataSubjectRequests)
        .where(inArray(dataSubjectRequests.status, ["received", "in_progress"]));
      const [m] = await tx
        .select({
          queued: sql<number>`count(*) filter (where ${outboxMessages.status} = 'queued')`.mapWith(Number),
          failed: sql<number>`count(*) filter (where ${outboxMessages.status} = 'failed')`.mapWith(Number),
        })
        .from(outboxMessages)
        .where(gt(outboxMessages.createdAt, new Date(Date.now() - 7 * 86_400_000)));
      out.privacy = d;
      out.outbox = m;
    }
    return out;
  });
}

/** Count of approved, unexpired emergency grants — shown as a standing banner to approvers and auditors. */
export async function activeBreakGlassCount(auth: Auth) {
  if (!auth.perms.has("breakglass.approve") && !auth.perms.has("admin.audit")) return 0;
  const [r] = await read(auth, (tx) =>
    tx.select({ n: count() }).from(breakGlassAccess).where(and(eq(breakGlassAccess.status, "approved"), gt(breakGlassAccess.expiresAt, new Date()))),
  );
  return r.n;
}
