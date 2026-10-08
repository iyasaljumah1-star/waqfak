import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  bodies, bodyMemberships, founders, successions, trusteeAppointments, trustees, waqfClassifications, waqfGovernanceProfiles,
  waqfRegistrations, waqfTimelineEvents, users,
} from "../../db/schema";

export async function identityData(tx: Tx, waqfId: string) {
  const [classes, regs, timeline] = await Promise.all([
    tx
      .select({ c: waqfClassifications, by: users.fullName })
      .from(waqfClassifications)
      .leftJoin(users, eq(users.id, waqfClassifications.decidedBy))
      .where(eq(waqfClassifications.waqfId, waqfId))
      .orderBy(desc(waqfClassifications.effectiveFrom), desc(waqfClassifications.createdAt)),
    tx.select().from(waqfRegistrations).where(eq(waqfRegistrations.waqfId, waqfId)).orderBy(desc(waqfRegistrations.createdAt)),
    tx.select().from(waqfTimelineEvents).where(eq(waqfTimelineEvents.waqfId, waqfId)).orderBy(desc(waqfTimelineEvents.occurredOn), desc(waqfTimelineEvents.createdAt)).limit(100),
  ]);
  return { classes, regs, timeline };
}

export async function partiesData(tx: Tx, waqfId: string) {
  const [fs, ts, succ, bs, profile] = await Promise.all([
    tx.select().from(founders).where(eq(founders.waqfId, waqfId)).orderBy(asc(founders.createdAt)),
    tx.select().from(trustees).where(eq(trustees.waqfId, waqfId)).orderBy(asc(trustees.status), desc(trustees.startsOn)),
    tx.select().from(successions).where(eq(successions.waqfId, waqfId)).orderBy(asc(successions.position), asc(successions.createdAt)),
    tx.select().from(bodies).where(eq(bodies.waqfId, waqfId)).orderBy(asc(bodies.createdAt)),
    tx.select().from(waqfGovernanceProfiles).where(eq(waqfGovernanceProfiles.waqfId, waqfId)).limit(1),
  ]);
  const tIds = ts.map((t) => t.id);
  const bIds = bs.map((b) => b.id);
  const [apps, mems] = await Promise.all([
    tIds.length ? tx.select().from(trusteeAppointments).where(and(eq(trusteeAppointments.waqfId, waqfId), inArray(trusteeAppointments.trusteeId, tIds))).orderBy(desc(trusteeAppointments.decisionDate)) : [],
    bIds.length ? tx.select().from(bodyMemberships).where(and(eq(bodyMemberships.waqfId, waqfId), inArray(bodyMemberships.bodyId, bIds))).orderBy(asc(bodyMemberships.role), asc(bodyMemberships.personName)) : [],
  ]);
  return { founders: fs, trustees: ts, appointments: apps, successions: succ, bodies: bs, memberships: mems, profile: profile[0] ?? null };
}
