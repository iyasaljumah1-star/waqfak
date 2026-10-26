import "server-only";
import { nazaraEngagements, requestLinks } from "@/server/db/schema";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import {
  assessments, auditLogs, invoices, obligationInstances, obligations, serviceRequests, services, users, waqfMemberships, waqfs,
} from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { likeTerm } from "../guard";
import { COMPLETE_WAQF_SQL, completenessOf } from "@/server/modules/waqf-core/completeness";
import { openReviewCounts } from "@/server/modules/waqf-core/file-review";

/** state: complete (default — what «الأوقاف» means), in_progress (drafts and files being completed), reviews (with file changes awaiting review), all. */
export type WaqfFilter = { q?: string; type?: string; size?: string; status?: string; demo?: string; state?: string };
export const WAQF_STATES = [
  { key: "complete", label: "الأوقاف المكتملة" },
  { key: "in_progress", label: "قيد التأسيس أو الاستكمال" },
  { key: "reviews", label: "تعديلات وطلبات بانتظار المراجعة" },
  { key: "all", label: "كل الملفات" },
] as const;

type W = typeof waqfs.$inferSelect;

export async function listAllWaqfs(auth: Auth, f: WaqfFilter) {
  return read(auth, async (tx) => {
    const conds: (SQL | undefined)[] = [isNull(waqfs.archivedAt)];
    if (f.type) conds.push(eq(waqfs.legalType, f.type as NonNullable<W["legalType"]>));
    if (f.size) conds.push(eq(waqfs.sizeClass, f.size as NonNullable<W["sizeClass"]>));
    if (f.status) conds.push(eq(waqfs.status, f.status as W["status"]));
    if (f.demo === "yes") conds.push(eq(waqfs.isDemo, true));
    if (f.demo === "no") conds.push(eq(waqfs.isDemo, false));
    if (f.q?.trim()) conds.push(or(ilike(waqfs.name, likeTerm(f.q)), ilike(waqfs.internalNumber, likeTerm(f.q)), ilike(waqfs.nationalUnifiedNumber, likeTerm(f.q))));
    const state = f.state ?? "complete";
    const completeIds = sql`(select w.id from waqfs w where ${COMPLETE_WAQF_SQL})`;
    // will plans (a waqf after death, still an idea) are not waqf files to complete
    const notWillIdea = sql`not (${waqfs.creationMode} = 'bequest' and ${waqfs.status} = 'idea')`;
    if (state === "complete") conds.push(sql`${waqfs.id} in ${completeIds}`);
    if (state === "in_progress") conds.push(sql`${waqfs.id} not in ${completeIds}`, sql`${waqfs.status} <> 'ended'`, notWillIdea);
    if (state === "reviews") conds.push(sql`exists (select 1 from tasks t where t.waqf_id = ${waqfs.id} and t.kind in ('file_review','file_change_request') and t.status in ('todo','in_progress'))`);
    const rows = await tx
      .select({
        id: waqfs.id, name: waqfs.name, number: waqfs.internalNumber, legalType: waqfs.legalType, sizeClass: waqfs.sizeClass, status: waqfs.status,
        nazirMode: waqfs.nazirMode, waqfakRole: waqfs.waqfakRole, isDemo: waqfs.isDemo, createdAt: waqfs.createdAt, stage: waqfs.stage,
      })
      .from(waqfs)
      .where(and(...conds))
      .orderBy(desc(waqfs.createdAt))
      .limit(300);
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const [mem, req, obl] = await Promise.all([
      tx.select({ waqfId: waqfMemberships.waqfId, n: count() }).from(waqfMemberships).where(and(inArray(waqfMemberships.waqfId, ids), eq(waqfMemberships.status, "active"))).groupBy(waqfMemberships.waqfId),
      tx
        .select({ waqfId: serviceRequests.waqfId, n: count() })
        .from(serviceRequests)
        .where(and(inArray(serviceRequests.waqfId, ids), sql`${serviceRequests.status} not in ('draft','completed','closed','cancelled','rejected')`))
        .groupBy(serviceRequests.waqfId),
      tx
        .select({ waqfId: obligationInstances.waqfId, n: count() })
        .from(obligationInstances)
        .where(and(inArray(obligationInstances.waqfId, ids), eq(obligationInstances.status, "overdue")))
        .groupBy(obligationInstances.waqfId),
    ]);
    const [comp, reviews] = await Promise.all([completenessOf(tx, ids), openReviewCounts(tx, ids)]);
    const m = new Map(mem.map((x) => [x.waqfId, x.n]));
    const q = new Map(req.map((x) => [x.waqfId!, x.n]));
    const o = new Map(obl.map((x) => [x.waqfId, x.n]));
    return rows.map((r) => ({ ...r, members: m.get(r.id) ?? 0, openRequests: q.get(r.id) ?? 0, overdue: o.get(r.id) ?? 0, completeness: comp.get(r.id) ?? { complete: false, missing: [] }, reviews: reviews.get(r.id) ?? 0 }));
  });
}
export type AdminWaqfRow = Awaited<ReturnType<typeof listAllWaqfs>>[number];

/** Summary of one waqf for staff. Visibility comes from RLS (global role, assignment, or an active emergency grant). */
export async function waqfSummary(auth: Auth, id: string) {
  return read(auth, async (tx) => {
    const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, id)).limit(1);
    if (!w) return null;
    const [members, reqs, obls, invs, ass, recent] = await Promise.all([
      tx
        .select({ userId: waqfMemberships.userId, roleKey: waqfMemberships.roleKey, status: waqfMemberships.status, isIndependent: waqfMemberships.isIndependent, name: users.fullName })
        .from(waqfMemberships)
        .leftJoin(users, eq(users.id, waqfMemberships.userId))
        .where(eq(waqfMemberships.waqfId, id))
        .orderBy(asc(waqfMemberships.roleKey)),
      tx
        .select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, slaDueAt: serviceRequests.slaDueAt, service: services.nameAr, assignee: users.fullName })
        .from(serviceRequests)
        .leftJoin(services, eq(services.id, serviceRequests.serviceId))
        .leftJoin(users, eq(users.id, serviceRequests.assignedToUserId))
        .where(eq(serviceRequests.waqfId, id))
        .orderBy(desc(serviceRequests.createdAt))
        .limit(20),
      tx
        .select({ id: obligationInstances.id, status: obligationInstances.status, dueOn: obligationInstances.dueOn, title: obligations.titleAr, severity: obligations.severity })
        .from(obligationInstances)
        .innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId))
        .where(and(eq(obligationInstances.waqfId, id), inArray(obligationInstances.status, ["overdue", "due_soon", "upcoming"])))
        .orderBy(sql`case ${obligationInstances.status} when 'overdue' then 0 when 'due_soon' then 1 else 2 end`, asc(obligationInstances.dueOn))
        .limit(12),
      tx.select({ id: invoices.id, number: invoices.number, status: invoices.status, total: invoices.total, issuedOn: invoices.issuedOn }).from(invoices).where(eq(invoices.waqfId, id)).orderBy(desc(invoices.issuedOn)).limit(10),
      tx.select({ id: assessments.id, kind: assessments.kind, status: assessments.status, completedAt: assessments.completedAt }).from(assessments).where(eq(assessments.waqfId, id)).orderBy(desc(assessments.startedAt)).limit(5),
      tx.select({ id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, actorUserId: auditLogs.actorUserId }).from(auditLogs).where(eq(auditLogs.waqfId, id)).orderBy(desc(auditLogs.id)).limit(10),
    ]);
    // Operational links: the request that opened this file, and the nazara files of the waqf (each with its requests)
    const origin = await tx.select({ requestId: requestLinks.requestId }).from(requestLinks).where(and(eq(requestLinks.entityType, "waqf"), eq(requestLinks.entityId, id), eq(requestLinks.relation, "origin"))).limit(1);
    const engagements = await tx.select({ id: nazaraEngagements.id, number: nazaraEngagements.number, status: nazaraEngagements.status }).from(nazaraEngagements).where(eq(nazaraEngagements.waqfId, id)).orderBy(desc(nazaraEngagements.createdAt));
    const linked = engagements.length ? await tx.select({ requestId: requestLinks.requestId, engagementId: requestLinks.entityId }).from(requestLinks).where(and(eq(requestLinks.entityType, "nazara_engagement"), inArray(requestLinks.entityId, engagements.map((e) => e.id)))) : [];
    const requests = reqs.map((r) => ({ ...r, origin: origin[0]?.requestId === r.id, engagement: engagements.find((e) => linked.some((l) => l.requestId === r.id && l.engagementId === e.id))?.number ?? null }));
    return { waqf: w, members, requests, obligations: obls, invoices: invs, assessments: ass, recent, engagements };
  });
}
