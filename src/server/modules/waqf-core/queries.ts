import "server-only";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, like, lt, notInArray, sql } from "drizzle-orm";
import { cache } from "react";
import { requireWaqf, type Auth } from "../../authz/context";
import type { Permission } from "../../authz/catalog";
import {
  assessmentResults, assessments, auditLogs, delegations, invitations, obligationInstances, obligations, serviceRequests, services,
  users, waqfMemberships, waqfs, waqfTimelineEvents,
} from "../../db/schema";
import { withSystem } from "../../db";
import { sha256 } from "../../lib/crypto";
import { read } from "../_shared";
import { OPEN_REQUEST_EXCLUDED } from "../portal/queries";

/** requireWaqf, de-duplicated within one request (layout + page share the result). */
export const waqfAccess = cache((auth: Auth, waqfId: string, perm: Permission = "waqf.view") => requireWaqf(auth, waqfId, perm));

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function waqfOverview(auth: Auth, waqfId: string) {
  const [oblCounts, overdue, latest, openReqs, timeline, members] = await Promise.all([
    read(auth, (tx) =>
      tx.select({ status: obligationInstances.status, n: count() }).from(obligationInstances).where(eq(obligationInstances.waqfId, waqfId)).groupBy(obligationInstances.status),
    ),
    read(auth, (tx) =>
      tx
        .select({ id: obligationInstances.id, title: obligations.titleAr, dueOn: obligationInstances.dueOn, penaltyCode: obligations.penaltyCode, reference: obligations.referenceText })
        .from(obligationInstances)
        .innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId))
        .where(and(eq(obligationInstances.waqfId, waqfId), eq(obligationInstances.status, "overdue")))
        .orderBy(asc(obligationInstances.dueOn))
        .limit(10),
    ),
    read(auth, (tx) =>
      tx
        .select({
          assessmentId: assessmentResults.assessmentId, overallScore: assessmentResults.overallScore, maturityLevel: assessmentResults.maturityLevel,
          status: assessmentResults.status, confidence: assessmentResults.confidence, computedAt: assessmentResults.computedAt, kind: assessments.kind,
        })
        .from(assessmentResults)
        .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
        .where(and(eq(assessments.waqfId, waqfId), isNull(assessments.supersededBy)))
        .orderBy(desc(assessmentResults.computedAt))
        .limit(1),
    ),
    read(auth, (tx) =>
      tx
        .select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, service: services.nameAr, createdAt: serviceRequests.createdAt })
        .from(serviceRequests)
        .innerJoin(services, eq(services.id, serviceRequests.serviceId))
        .where(and(eq(serviceRequests.waqfId, waqfId), notInArray(serviceRequests.status, [...OPEN_REQUEST_EXCLUDED])))
        .orderBy(desc(serviceRequests.createdAt))
        .limit(5),
    ),
    read(auth, (tx) =>
      tx.select().from(waqfTimelineEvents).where(eq(waqfTimelineEvents.waqfId, waqfId)).orderBy(desc(waqfTimelineEvents.occurredOn), desc(waqfTimelineEvents.createdAt)).limit(6),
    ),
    waqfMembers(auth, waqfId, true),
  ]);
  return { oblCounts: Object.fromEntries(oblCounts.map((r) => [r.status, Number(r.n)])) as Record<string, number>, overdue, latest: latest[0] ?? null, openReqs, timeline, members };
}

export async function waqfMembers(auth: Auth, waqfId: string, activeOnly = false) {
  return read(auth, (tx) =>
    tx
      .select({
        id: waqfMemberships.id, userId: waqfMemberships.userId, roleKey: waqfMemberships.roleKey, isIndependent: waqfMemberships.isIndependent,
        status: waqfMemberships.status, startsAt: waqfMemberships.startsAt, endsAt: waqfMemberships.endsAt, name: users.fullName, phone: users.phone,
      })
      .from(waqfMemberships)
      .innerJoin(users, eq(users.id, waqfMemberships.userId))
      .where(and(eq(waqfMemberships.waqfId, waqfId), activeOnly ? eq(waqfMemberships.status, "active") : undefined))
      .orderBy(sql`case when ${waqfMemberships.status} = 'active' then 0 else 1 end`, asc(waqfMemberships.startsAt)),
  );
}

export async function waqfSettingsData(auth: Auth, waqfId: string) {
  const [members, invites, delegs] = await Promise.all([
    waqfMembers(auth, waqfId),
    read(auth, (tx) =>
      tx
        .select({
          id: invitations.id, phone: invitations.phone, roleKey: invitations.roleKey, expiresAt: invitations.expiresAt, acceptedAt: invitations.acceptedAt,
          revokedAt: invitations.revokedAt, createdAt: invitations.createdAt, scope: invitations.scope, inviter: users.fullName,
        })
        .from(invitations)
        .leftJoin(users, eq(users.id, invitations.invitedBy))
        .where(eq(invitations.waqfId, waqfId))
        .orderBy(desc(invitations.createdAt))
        .limit(30),
    ),
    read(auth, (tx) =>
      tx
        .select({
          id: delegations.id, agentUserId: delegations.agentUserId, agentName: users.fullName, agentPhone: users.phone, scope: delegations.scope,
          validFrom: delegations.validFrom, validTo: delegations.validTo, status: delegations.status, poaNo: delegations.powerOfAttorneyNo,
          principalName: delegations.principalName, createdAt: delegations.createdAt,
        })
        .from(delegations)
        .innerJoin(users, eq(users.id, delegations.agentUserId))
        .where(eq(delegations.waqfId, waqfId))
        .orderBy(desc(delegations.createdAt)),
    ),
  ]);
  return { members, invites, delegs };
}

export const AUDIT_PAGE_SIZE = 25;

export async function waqfAuditPage(auth: Auth, waqfId: string, f: { page: number; prefix?: string; from?: string; to?: string }) {
  const where = and(
    eq(auditLogs.waqfId, waqfId),
    f.prefix ? like(auditLogs.action, `${f.prefix.replace(/[%_\\]/g, "")}%`) : undefined,
    f.from ? gte(auditLogs.at, new Date(`${f.from}T00:00:00+03:00`)) : undefined,
    f.to ? lt(auditLogs.at, new Date(new Date(`${f.to}T00:00:00+03:00`).getTime() + 86_400_000)) : undefined,
  );
  const [rows, total, prefixes] = await Promise.all([
    read(auth, (tx) =>
      tx
        .select({
          id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId,
          actorLabel: auditLogs.actorLabel, actorName: users.fullName, before: auditLogs.before, after: auditLogs.after, ip: auditLogs.ip,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(where)
        .orderBy(desc(auditLogs.id))
        .limit(AUDIT_PAGE_SIZE)
        .offset((f.page - 1) * AUDIT_PAGE_SIZE),
    ),
    read(auth, (tx) => tx.select({ n: count() }).from(auditLogs).where(where)),
    read(auth, (tx) =>
      tx
        .selectDistinct({ p: sql<string>`split_part(${auditLogs.action}, '.', 1)` })
        .from(auditLogs)
        .where(and(eq(auditLogs.waqfId, waqfId), isNotNull(auditLogs.action))),
    ),
  ]);
  return { rows, total: Number(total[0]?.n ?? 0), prefixes: prefixes.map((p) => p.p).filter(Boolean).sort() };
}

/**
 * Invitation preview by secret token. The invitee is not yet a member, so RLS would hide the row: this one narrow lookup
 * runs in the system context and returns only what the invitation page shows (waqf name, role, inviter, state).
 */
export async function invitationByToken(token: string) {
  if (!token || token.length < 20 || token.length > 64) return null;
  const [row] = await withSystem((tx) =>
    tx
      .select({
        id: invitations.id, phone: invitations.phone, roleKey: invitations.roleKey, expiresAt: invitations.expiresAt, acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt, note: invitations.note, scope: invitations.scope, waqfId: invitations.waqfId, waqfName: waqfs.name, inviter: users.fullName,
      })
      .from(invitations)
      .innerJoin(waqfs, eq(waqfs.id, invitations.waqfId))
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(eq(invitations.tokenHash, sha256(token)))
      .limit(1),
  );
  return row ?? null;
}
