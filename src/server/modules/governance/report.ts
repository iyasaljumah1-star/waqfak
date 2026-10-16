import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  assets, bodies, bodyMemberships, meetings, minutes, obligationInstances, obligations, policies, resolutions, riskRegister, tasks, users, waqfGovernanceProfiles, waqfs,
} from "@/server/db/schema";
import { addDays, todayISO } from "@/server/engines/dates";
import { POLICY_TYPES } from "./pure";

/**
 * Governance report of a waqf for a period, built only from its records: who governs it, by which rules, what was
 * held and decided, how decisions were carried out, the policies, obligations, assets and risks. A section with no
 * records says so; no figure is estimated. It is a working report for the waqf's managers, not a filing.
 */
export async function governanceReport(tx: Tx, waqfId: string, from: string, to: string) {
  const [w] = await tx.select({ name: waqfs.name, internalNumber: waqfs.internalNumber, nazirMode: waqfs.nazirMode }).from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (!w) return null;
  const today = todayISO();
  const fromTs = new Date(`${from}T00:00:00+03:00`);
  const toTs = new Date(`${to}T23:59:59+03:00`);
  const [boardRows, rules, mts, res, pols, obl, ast, risks] = await Promise.all([
    tx.select({ name: bodyMemberships.personName, role: bodyMemberships.role, capacity: bodyMemberships.capacity, independent: bodyMemberships.isIndependent, vote: bodyMemberships.hasVote, exec: bodyMemberships.isExecutive, sign: bodyMemberships.canSign, startsOn: bodyMemberships.startsOn, endsOn: bodyMemberships.endsOn, status: bodyMemberships.status, hasAccount: bodyMemberships.userId, body: bodies.name, kind: bodies.kind })
      .from(bodyMemberships).innerJoin(bodies, eq(bodies.id, bodyMemberships.bodyId)).where(eq(bodies.waqfId, waqfId)),
    tx.select().from(waqfGovernanceProfiles).where(eq(waqfGovernanceProfiles.waqfId, waqfId)).limit(1),
    tx.select({ id: meetings.id, title: meetings.title, status: meetings.status, at: meetings.scheduledAt, quorumMet: meetings.quorumMet, heldAt: meetings.heldAt }).from(meetings).where(and(eq(meetings.waqfId, waqfId), gte(meetings.scheduledAt, fromTs), lte(meetings.scheduledAt, toTs))).orderBy(desc(meetings.scheduledAt)),
    tx.select({ id: resolutions.id, number: resolutions.number, text: resolutions.text, status: resolutions.status, decidedAt: resolutions.decidedAt, executedAt: resolutions.executedAt }).from(resolutions).where(and(eq(resolutions.waqfId, waqfId), gte(resolutions.createdAt, fromTs), lte(resolutions.createdAt, toTs))).orderBy(desc(resolutions.createdAt)),
    tx.select({ type: policies.policyType, title: policies.title, status: policies.status, approvedOn: policies.approvedOn, reviewDue: policies.reviewDue, version: policies.version }).from(policies).where(eq(policies.waqfId, waqfId)),
    tx.select({ title: obligations.titleAr, status: obligationInstances.status, dueOn: obligationInstances.dueOn }).from(obligationInstances).innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId)).where(eq(obligationInstances.waqfId, waqfId)),
    tx.select({ title: assets.title, category: assets.category, value: assets.marketValue, lastValuationOn: assets.lastValuationOn }).from(assets).where(and(eq(assets.waqfId, waqfId), isNull(assets.archivedAt))),
    tx.select({ title: riskRegister.title, category: riskRegister.category, impact: riskRegister.impact, likelihood: riskRegister.likelihood, status: riskRegister.status, reviewOn: riskRegister.reviewOn, treatment: riskRegister.treatment }).from(riskRegister).where(eq(riskRegister.waqfId, waqfId)),
  ]);
  const meetingIds = mts.map((m) => m.id);
  const locked = meetingIds.length ? await tx.select({ meetingId: minutes.meetingId, status: minutes.status }).from(minutes).where(inArray(minutes.meetingId, meetingIds)) : [];
  const resIds = res.map((r) => r.id);
  const resTasks = resIds.length
    ? await tx.select({ sourceId: tasks.sourceId, title: tasks.title, status: tasks.status, dueOn: tasks.dueOn, assignee: users.fullName }).from(tasks).leftJoin(users, eq(users.id, tasks.assigneeUserId)).where(and(eq(tasks.sourceType, "resolution"), inArray(tasks.sourceId, resIds)))
    : [];
  const live = boardRows.filter((m) => (m.status ?? "active") !== "ended" && (!m.endsOn || m.endsOn >= today));
  const approvedTypes = new Set(pols.filter((p) => p.status === "approved").map((p) => p.type));
  const yearAgo = addDays(today, -365);
  return {
    waqf: w, from, to, generatedOn: today,
    board: { members: live, ended: boardRows.length - live.length, independent: live.filter((m) => m.independent).length, voting: live.filter((m) => m.vote).length, withoutAccount: live.filter((m) => !m.hasAccount).length },
    rules: rules[0] ?? null,
    meetings: {
      list: mts.map((m) => ({ ...m, minutes: locked.find((x) => x.meetingId === m.id)?.status ?? null })),
      held: mts.filter((m) => m.status === "held").length, cancelled: mts.filter((m) => m.status === "cancelled").length, scheduled: mts.filter((m) => m.status === "scheduled").length,
      lockedMinutes: locked.filter((x) => x.status === "locked").length, perYearTarget: rules[0]?.meetingsPerYear ?? null,
    },
    resolutions: res.map((r) => {
      const ts = resTasks.filter((t) => t.sourceId === r.id);
      return { ...r, tasks: ts, open: ts.filter((t) => t.status === "todo" || t.status === "in_progress").length, overdue: ts.filter((t) => (t.status === "todo" || t.status === "in_progress") && t.dueOn && t.dueOn < today).length, done: ts.filter((t) => t.status === "done").length };
    }),
    policies: POLICY_TYPES.map(([type, label]) => {
      const p = pols.filter((x) => x.type === type).sort((a, b) => b.version - a.version)[0];
      return { type, label, status: p ? p.status : "missing", approvedOn: p?.approvedOn ?? null, reviewDue: p?.reviewDue ?? null, reviewOverdue: !!(p?.reviewDue && p.reviewDue < today) };
    }),
    policiesApproved: approvedTypes.size,
    obligations: { overdue: obl.filter((o) => o.status === "overdue"), dueSoon: obl.filter((o) => o.status !== "done" && o.status !== "waived" && o.dueOn && o.dueOn >= today && o.dueOn <= addDays(today, 30)), done: obl.filter((o) => o.status === "done").length },
    assets: { count: ast.length, valued: ast.filter((a) => a.value != null).length, total: ast.reduce((s, a) => s + (a.value == null ? 0 : Number(a.value)), 0), stale: ast.filter((a) => !a.lastValuationOn || a.lastValuationOn < yearAgo).length },
    risks: { list: risks.filter((r) => r.status !== "closed").sort((a, b) => b.impact * b.likelihood - a.impact * a.likelihood), closed: risks.filter((r) => r.status === "closed").length },
  };
}
