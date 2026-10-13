import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, or } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  approvals, auditLogs, budgets, complaints, distributions, documents, leases, maintenancePlans, minutes, nazaraEngagements,
  nazaraEvents, nazaraTeam, obligationInstances, obligations, reports, riskRegister, roles, serviceRequests, tasks, userRoles,
  users, violations, waqfs,
} from "@/server/db/schema";
import type { Auth } from "@/server/authz/context";
import { rolePermissionMap } from "@/server/authz/context";
import { addDays, todayISO } from "@/server/engines/dates";
import { read } from "@/server/modules/_shared";
import { OPEN_STATUSES, RUNNING_STATUSES } from "./pure";

export async function nazaraManagerIds(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(inArray(roles.key, ["nazara_manager"]), eq(users.status, "active")));
  return [...new Set(rows.map((r) => r.id))];
}

/**
 * Live operational counts for a set of waqfs, computed from the records themselves (no stored KPIs).
 * Window: overdue = due before today; upcoming = due within the next 30 days (obligations) / 90 days (leases).
 */
async function opsCounts(tx: Tx, waqfIds: string[]) {
  const today = todayISO();
  const in30 = addDays(today, 30);
  const in90 = addDays(today, 90);
  const empty = new Map<string, number>();
  if (!waqfIds.length) return { overdueTasks: empty, openTasks: empty, obligationsDue: empty, obligationsOverdue: empty, leasesEnding: empty, approvalsPending: empty, complaintsOpen: empty, risksOpen: empty, violationsOpen: empty };
  const count = async (q: Promise<{ w: string | null }[]>) => {
    const m = new Map<string, number>();
    for (const r of await q) if (r.w) m.set(r.w, (m.get(r.w) ?? 0) + 1);
    return m;
  };
  const [overdueTasks, openTasks, obligationsDue, obligationsOverdue, leasesEnding, approvalsA, approvalsD, approvalsB, complaintsOpen, risksOpen, violationsOpen] = await Promise.all([
    count(tx.select({ w: tasks.waqfId }).from(tasks).where(and(inArray(tasks.waqfId, waqfIds), inArray(tasks.status, ["todo", "in_progress"]), lt(tasks.dueOn, today)))),
    count(tx.select({ w: tasks.waqfId }).from(tasks).where(and(inArray(tasks.waqfId, waqfIds), inArray(tasks.status, ["todo", "in_progress"])))),
    count(tx.select({ w: obligationInstances.waqfId }).from(obligationInstances).where(and(inArray(obligationInstances.waqfId, waqfIds), inArray(obligationInstances.status, ["upcoming", "due_soon"]), lte(obligationInstances.dueOn, in30)))),
    count(tx.select({ w: obligationInstances.waqfId }).from(obligationInstances).where(and(inArray(obligationInstances.waqfId, waqfIds), eq(obligationInstances.status, "overdue")))),
    count(tx.select({ w: leases.waqfId }).from(leases).where(and(inArray(leases.waqfId, waqfIds), eq(leases.status, "active"), lte(leases.endsOn, in90)))),
    count(tx.select({ w: approvals.waqfId }).from(approvals).where(and(inArray(approvals.waqfId, waqfIds), inArray(approvals.status, ["draft", "submitted"])))),
    count(tx.select({ w: distributions.waqfId }).from(distributions).where(and(inArray(distributions.waqfId, waqfIds), eq(distributions.status, "planned")))),
    count(tx.select({ w: budgets.waqfId }).from(budgets).where(and(inArray(budgets.waqfId, waqfIds), eq(budgets.status, "draft")))),
    count(tx.select({ w: complaints.waqfId }).from(complaints).where(and(inArray(complaints.waqfId, waqfIds), inArray(complaints.status, ["open", "in_progress"])))),
    count(tx.select({ w: riskRegister.waqfId }).from(riskRegister).where(and(inArray(riskRegister.waqfId, waqfIds), eq(riskRegister.status, "open")))),
    count(tx.select({ w: violations.waqfId }).from(violations).where(and(inArray(violations.waqfId, waqfIds), ne(violations.status, "closed")))),
  ]);
  const approvalsPending = new Map<string, number>();
  for (const m of [approvalsA, approvalsD, approvalsB]) for (const [k, v] of m) approvalsPending.set(k, (approvalsPending.get(k) ?? 0) + v);
  return { overdueTasks, openTasks, obligationsDue, obligationsOverdue, leasesEnding, approvalsPending, complaintsOpen, risksOpen, violationsOpen };
}

/** Engagements visible to the caller (RLS on waqf access: team membership, assignment or global staff access). */
export async function listEngagements(auth: Auth, opts: { status?: string; mine?: boolean } = {}) {
  return read(auth, async (tx) => {
    const conds = [];
    if (opts.status === "open") conds.push(inArray(nazaraEngagements.status, OPEN_STATUSES));
    else if (opts.status) conds.push(eq(nazaraEngagements.status, opts.status));
    if (opts.mine) {
      const mine = tx.select({ id: nazaraTeam.engagementId }).from(nazaraTeam).where(and(eq(nazaraTeam.userId, auth.user.id), isNull(nazaraTeam.removedAt)));
      conds.push(inArray(nazaraEngagements.id, mine));
    }
    const rows = await tx
      .select({ e: nazaraEngagements, waqfName: waqfs.name, waqfNumber: waqfs.internalNumber, sizeClass: waqfs.sizeClass, isDemo: waqfs.isDemo, lead: users.fullName })
      .from(nazaraEngagements)
      .innerJoin(waqfs, eq(waqfs.id, nazaraEngagements.waqfId))
      .leftJoin(users, eq(users.id, nazaraEngagements.leadUserId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(nazaraEngagements.updatedAt));
    const running = rows.filter((r) => (RUNNING_STATUSES as string[]).includes(r.e.status)).map((r) => r.e.waqfId);
    const ops = await opsCounts(tx, running);
    return { rows, ops };
  });
}

export type EngagementList = Awaited<ReturnType<typeof listEngagements>>;

/** Waqfs the caller can open an engagement for: accessible, not already under an open engagement. */
export async function openableWaqfs(auth: Auth) {
  return read(auth, async (tx) => {
    const busy = tx.select({ id: nazaraEngagements.waqfId }).from(nazaraEngagements).where(notInArray(nazaraEngagements.status, ["rejected", "ended"]));
    return tx
      .select({ id: waqfs.id, name: waqfs.name, number: waqfs.internalNumber, isDemo: waqfs.isDemo })
      .from(waqfs)
      .where(and(notInArray(waqfs.id, busy), isNull(waqfs.archivedAt)))
      .orderBy(asc(waqfs.name))
      .limit(200);
  });
}

export async function engagementDetail(auth: Auth, id: string) {
  return read(auth, async (tx) => {
    const [row] = await tx
      .select({ e: nazaraEngagements, w: waqfs })
      .from(nazaraEngagements)
      .innerJoin(waqfs, eq(waqfs.id, nazaraEngagements.waqfId))
      .where(eq(nazaraEngagements.id, id))
      .limit(1);
    if (!row) return null;
    const { e, w } = row;
    const today = todayISO();
    const [team, events, docs, req, rpts] = await Promise.all([
      tx.select({ t: nazaraTeam, name: users.fullName }).from(nazaraTeam).leftJoin(users, eq(users.id, nazaraTeam.userId)).where(and(eq(nazaraTeam.engagementId, e.id), isNull(nazaraTeam.removedAt))).orderBy(asc(nazaraTeam.addedAt)),
      tx.select({ ev: nazaraEvents, name: users.fullName }).from(nazaraEvents).leftJoin(users, eq(users.id, nazaraEvents.actorUserId)).where(eq(nazaraEvents.engagementId, e.id)).orderBy(desc(nazaraEvents.at)).limit(50),
      tx.select({ id: documents.id, title: documents.title, docType: documents.docType }).from(documents).where(and(eq(documents.waqfId, w.id), isNull(documents.archivedAt))).orderBy(desc(documents.createdAt)).limit(200),
      e.requestId ? tx.select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status }).from(serviceRequests).where(eq(serviceRequests.id, e.requestId)).limit(1) : Promise.resolve([]),
      tx.select().from(reports).where(and(eq(reports.waqfId, w.id), inArray(reports.kind, ["nazara_periodic", "nazara_takeover", "nazara_handover"]))).orderBy(desc(reports.generatedAt)).limit(20),
    ]);

    // Operations panel: only meaningful once the team runs the waqf.
    let ops: null | {
      overdueTasks: { id: string; title: string; dueOn: string | null; assignee: string | null }[];
      openTasks: number;
      obligations: { id: string; title: string; dueOn: string | null; status: string }[];
      leasesEnding: { id: string; tenant: string; endsOn: string | null }[];
      maintenanceDue: { id: string; item: string; nextDueOn: string | null }[];
      approvalsPending: { kind: string; label: string; count: number; href: string }[];
      complaintsOpen: number;
      risksOpen: { id: string; title: string; score: number }[];
      violationsOpen: number;
      recent: { id: number | string; action: string; at: Date; actor: string | null }[];
    } = null;
    if ((RUNNING_STATUSES as string[]).includes(e.status)) {
      const in30 = addDays(today, 30);
      const in90 = addDays(today, 90);
      const [ot, openT, obl, ls, mp, ap, dist, bud, mins, cm, rk, vio, recent] = await Promise.all([
        tx.select({ id: tasks.id, title: tasks.title, dueOn: tasks.dueOn, assignee: users.fullName }).from(tasks).leftJoin(users, eq(users.id, tasks.assigneeUserId)).where(and(eq(tasks.waqfId, w.id), inArray(tasks.status, ["todo", "in_progress"]), lt(tasks.dueOn, today))).orderBy(asc(tasks.dueOn)).limit(10),
        tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.waqfId, w.id), inArray(tasks.status, ["todo", "in_progress"]))),
        tx.select({ id: obligationInstances.id, title: obligations.titleAr, dueOn: obligationInstances.dueOn, status: obligationInstances.status }).from(obligationInstances).innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId)).where(and(eq(obligationInstances.waqfId, w.id), or(eq(obligationInstances.status, "overdue"), and(inArray(obligationInstances.status, ["upcoming", "due_soon"]), lte(obligationInstances.dueOn, in30))))).orderBy(asc(obligationInstances.dueOn)).limit(10),
        tx.select({ id: leases.id, tenant: leases.tenantName, endsOn: leases.endsOn }).from(leases).where(and(eq(leases.waqfId, w.id), eq(leases.status, "active"), lte(leases.endsOn, in90))).orderBy(asc(leases.endsOn)).limit(10),
        tx.select({ id: maintenancePlans.id, item: maintenancePlans.item, nextDueOn: maintenancePlans.nextDueOn }).from(maintenancePlans).where(and(eq(maintenancePlans.waqfId, w.id), lte(maintenancePlans.nextDueOn, in30), ne(maintenancePlans.status, "done"))).orderBy(asc(maintenancePlans.nextDueOn)).limit(10),
        tx.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.waqfId, w.id), inArray(approvals.status, ["draft", "submitted"]))),
        tx.select({ id: distributions.id }).from(distributions).where(and(eq(distributions.waqfId, w.id), eq(distributions.status, "planned"))),
        tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.waqfId, w.id), eq(budgets.status, "draft"))),
        tx.select({ id: minutes.id }).from(minutes).where(and(eq(minutes.waqfId, w.id), inArray(minutes.status, ["draft", "circulated"]))),
        tx.select({ id: complaints.id }).from(complaints).where(and(eq(complaints.waqfId, w.id), inArray(complaints.status, ["open", "in_progress"]))),
        tx.select({ id: riskRegister.id, title: riskRegister.title, impact: riskRegister.impact, likelihood: riskRegister.likelihood }).from(riskRegister).where(and(eq(riskRegister.waqfId, w.id), eq(riskRegister.status, "open"))).limit(20),
        tx.select({ id: violations.id }).from(violations).where(and(eq(violations.waqfId, w.id), ne(violations.status, "closed"))),
        tx.select({ id: auditLogs.id, action: auditLogs.action, at: auditLogs.at, actor: users.fullName }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(and(eq(auditLogs.waqfId, w.id), gte(auditLogs.at, new Date(Date.now() - 30 * 86400_000)))).orderBy(desc(auditLogs.at)).limit(12),
      ]);
      const base = `/app/w/${w.id}`;
      ops = {
        overdueTasks: ot,
        openTasks: openT.length,
        obligations: obl.map((o) => ({ ...o, status: String(o.status) })),
        leasesEnding: ls,
        maintenanceDue: mp,
        approvalsPending: [
          { kind: "approvals", label: "أذونات الجهة المختصة قيد الإعداد أو الانتظار", count: ap.length, href: `${base}/deed` },
          { kind: "distributions", label: "دفعات صرف بانتظار الاعتماد", count: dist.length, href: `${base}/finance` },
          { kind: "budgets", label: "موازنات بانتظار الاعتماد", count: bud.length, href: `${base}/finance` },
          { kind: "minutes", label: "محاضر لم تُعتمد بعد", count: mins.length, href: `${base}/governance` },
        ].filter((x) => x.count > 0),
        complaintsOpen: cm.length,
        risksOpen: rk.map((r) => ({ id: r.id, title: r.title, score: r.impact * r.likelihood })).sort((a, b) => b.score - a.score).slice(0, 8),
        violationsOpen: vio.length,
        recent: recent.map((r) => ({ id: r.id, action: r.action, at: r.at, actor: r.actor })),
      };
    }
    const { requestsLinkedTo } = await import("@/server/modules/operations/links");
    const requests = await requestsLinkedTo(tx, "nazara_engagement", e.id);
    // legacy: a file opened before explicit links keeps its single request
    if (req[0] && !requests.some((r) => r.id === req[0].id)) requests.push({ ...req[0], relation: "origin", service: "تولي النظارة (ناظر اعتباري)", code: "N01", createdAt: new Date(0) });
    return { e, w, team, events, docs, request: req[0] ?? null, requests, reports: rpts, ops, today };
  });
}

export type EngagementDetail = NonNullable<Awaited<ReturnType<typeof engagementDetail>>>;

/** Staff eligible to join a nazara team (active staff holding a role that carries `nazara.view`). */
export async function teamCandidates(auth: Auth) {
  const map = await rolePermissionMap();
  const keys = [...map.entries()].filter(([, p]) => p.has("nazara.view")).map(([k]) => k);
  if (!keys.length) return [];
  return read(auth, async (tx) => {
    const rows = await tx
      .selectDistinct({ id: users.id, name: users.fullName })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(inArray(roles.key, keys), eq(users.status, "active"), eq(users.isStaff, true)))
      .orderBy(asc(users.fullName));
    return rows;
  });
}

/** The waqf's current (open) nazara engagement, if any — read under the caller's waqf access. */
export async function currentEngagement(auth: Auth, waqfId: string) {
  return read(auth, async (tx) => {
    const [e] = await tx
      .select({ id: nazaraEngagements.id, status: nazaraEngagements.status, isPractice: nazaraEngagements.isPractice, startedOn: nazaraEngagements.startedOn })
      .from(nazaraEngagements)
      .where(and(eq(nazaraEngagements.waqfId, waqfId), notInArray(nazaraEngagements.status, ["rejected", "ended"])))
      .limit(1);
    return e ?? null;
  });
}
