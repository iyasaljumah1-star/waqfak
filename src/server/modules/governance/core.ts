import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  agendaItems, attendance, bodies, bodyMemberships, conflictDeclarations, meetings, minutes, minuteSignatures, notificationTemplates,
  resolutions, settings, users, votes, waqfGovernanceProfiles, waqfMemberships,
} from "../../db/schema";
import { notify } from "../notify";
import type { BoardSeat, MajorityRule, QuorumRule, VoteValue } from "./pure";

/** Waqf memberships that sit on the board, mapped to board seat roles. */
const ROLE_TO_SEAT: Record<string, { role: string; hasVote: boolean }> = {
  board_chair: { role: "chair", hasVote: true },
  board_member: { role: "member", hasVote: true },
  board_secretary: { role: "secretary", hasVote: false },
};

export async function boardBody(tx: Tx, waqfId: string) {
  const [b] = await tx.select().from(bodies).where(and(eq(bodies.waqfId, waqfId), eq(bodies.kind, "board"))).orderBy(asc(bodies.createdAt)).limit(1);
  return b ?? null;
}

/** Board members derived from waqf memberships (used before a board body exists). */
async function derivedSeats(tx: Tx, waqfId: string) {
  const rows = await tx
    .select({ id: waqfMemberships.id, userId: waqfMemberships.userId, roleKey: waqfMemberships.roleKey, isIndependent: waqfMemberships.isIndependent, name: users.fullName })
    .from(waqfMemberships)
    .innerJoin(users, eq(users.id, waqfMemberships.userId))
    .where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.status, "active")));
  let board = rows.filter((r) => ROLE_TO_SEAT[r.roleKey]);
  // Waqf without a board: the nazir(s) act as the deciding body.
  if (!board.length) board = rows.filter((r) => r.roleKey === "nazir").map((r) => ({ ...r, roleKey: "board_chair" }));
  return board.map((r) => ({ ...r, seat: ROLE_TO_SEAT[r.roleKey] }));
}

/**
 * Makes sure the waqf has a board body whose memberships mirror the board roles in waqf memberships.
 * Adds missing members; never removes (history of past meetings must stay intact).
 */
export async function ensureBoard(tx: Tx, waqfId: string, actorId: string) {
  let body = await boardBody(tx, waqfId);
  if (!body) {
    [body] = await tx.insert(bodies).values({ waqfId, kind: "board", name: "مجلس النظارة", createdBy: actorId }).returning();
  }
  const existing = await tx.select({ userId: bodyMemberships.userId }).from(bodyMemberships).where(and(eq(bodyMemberships.bodyId, body.id), isNull(bodyMemberships.endsOn)));
  const have = new Set(existing.map((e) => e.userId));
  const want = await derivedSeats(tx, waqfId);
  const add = want.filter((w) => !have.has(w.userId));
  if (add.length) {
    await tx.insert(bodyMemberships).values(
      add.map((w) => ({
        bodyId: body!.id, waqfId, userId: w.userId, personName: w.name ?? "عضو", role: w.seat.role, isIndependent: w.isIndependent, hasVote: w.seat.hasVote, createdBy: actorId,
      })),
    );
  }
  return body;
}

/** Current board seats (from the board body, or derived from memberships when none exists yet). */
export async function loadSeats(tx: Tx, waqfId: string): Promise<{ seats: BoardSeat[]; bodyId: string | null }> {
  const body = await boardBody(tx, waqfId);
  if (!body) {
    const d = await derivedSeats(tx, waqfId);
    return { bodyId: null, seats: d.map((r) => ({ membershipId: r.id, userId: r.userId, name: r.name ?? "عضو", role: r.seat.role, isIndependent: r.isIndependent, hasVote: r.seat.hasVote })) };
  }
  const rows = await tx.select().from(bodyMemberships).where(and(eq(bodyMemberships.bodyId, body.id), isNull(bodyMemberships.endsOn))).orderBy(asc(bodyMemberships.createdAt));
  const order: Record<string, number> = { chair: 0, vice_chair: 1, member: 2, secretary: 3, observer: 4 };
  return {
    bodyId: body.id,
    seats: rows
      .map((r) => ({ membershipId: r.id, userId: r.userId, name: r.personName, role: r.role, isIndependent: r.isIndependent, hasVote: r.hasVote }))
      .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9)),
  };
}

/** Seats of a specific meeting: the board seats that were invited (attendance rows), else the current board. */
export async function meetingSeats(tx: Tx, meetingId: string, waqfId: string) {
  const att = await tx.select().from(attendance).where(eq(attendance.meetingId, meetingId));
  const { seats } = await loadSeats(tx, waqfId);
  if (!att.length) return { seats, attendance: new Map<string, string>(), modes: new Map<string, string | null>() };
  const ids = att.map((a) => a.bodyMembershipId);
  const rows = await tx.select().from(bodyMemberships).where(inArray(bodyMemberships.id, ids));
  const order: Record<string, number> = { chair: 0, vice_chair: 1, member: 2, secretary: 3, observer: 4 };
  const ms: BoardSeat[] = rows
    .map((r) => ({ membershipId: r.id, userId: r.userId, name: r.personName, role: r.role, isIndependent: r.isIndependent, hasVote: r.hasVote }))
    .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
  return { seats: ms, attendance: new Map(att.map((a) => [a.bodyMembershipId, a.status])), modes: new Map(att.map((a) => [a.bodyMembershipId, a.mode])) };
}

export type GovProfile = { quorumRule: QuorumRule; majorityRule: MajorityRule; requireIndependent: boolean; independentTarget: number | null; meetingsPerYear: number; castingVote: boolean };

export async function governanceProfile(tx: Tx, waqfId: string): Promise<GovProfile> {
  const [p] = await tx.select().from(waqfGovernanceProfiles).where(eq(waqfGovernanceProfiles.waqfId, waqfId)).limit(1);
  const [cv] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, "governance.chair_casting_vote")).limit(1);
  return {
    quorumRule: (p?.quorumRule as QuorumRule) ?? "majority",
    majorityRule: (p?.majorityRule as MajorityRule) ?? "simple",
    requireIndependent: p?.requireIndependentForQuorum ?? false,
    independentTarget: p?.independentRatioTarget ? Number(p.independentRatioTarget) : null,
    meetingsPerYear: p?.meetingsPerYear ?? 4,
    castingVote: cv ? cv.v !== false : true, // default: the chair's vote settles ties
  };
}

/** User ids that declared an actual or potential conflict on an agenda item. */
export async function conflictedUsers(tx: Tx, agendaItemId: string) {
  const rows = await tx
    .select({ userId: conflictDeclarations.userId, kind: conflictDeclarations.kind })
    .from(conflictDeclarations)
    .where(eq(conflictDeclarations.agendaItemId, agendaItemId));
  return new Set(rows.filter((r) => r.kind !== "none").map((r) => r.userId));
}

export async function loadMeeting(tx: Tx, waqfId: string, meetingId: string) {
  const [m] = await tx.select().from(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.waqfId, waqfId))).limit(1);
  return m ?? null;
}

export async function loadItem(tx: Tx, waqfId: string, itemId: string) {
  const [it] = await tx.select().from(agendaItems).where(and(eq(agendaItems.id, itemId), eq(agendaItems.waqfId, waqfId))).limit(1);
  return it ?? null;
}

export async function latestMinutes(tx: Tx, meetingId: string) {
  const rows = await tx.select().from(minutes).where(eq(minutes.meetingId, meetingId)).orderBy(asc(minutes.version));
  return rows.at(-1) ?? null;
}

export async function minutesSigners(tx: Tx, minuteId: string) {
  return tx.select().from(minuteSignatures).where(eq(minuteSignatures.minuteId, minuteId));
}

export async function resolutionVotes(tx: Tx, resolutionId: string) {
  return tx.select().from(votes).where(eq(votes.resolutionId, resolutionId));
}

export async function meetingResolutions(tx: Tx, meetingId: string) {
  return tx.select().from(resolutions).where(eq(resolutions.meetingId, meetingId)).orderBy(asc(resolutions.createdAt));
}

/** notify() writes the raw key as title when a template is missing; only send when the template exists. */
export async function notifyIfTemplate(tx: Tx, userId: string, key: string, vars: Record<string, string | number | null | undefined>, opts: { waqfId?: string | null; link?: string }) {
  const [t] = await tx.select({ key: notificationTemplates.key }).from(notificationTemplates).where(eq(notificationTemplates.key, key)).limit(1);
  if (!t) return false;
  await notify(userId, key, vars, { ...opts, tx });
  return true;
}

export const isVoteValue = (v: string): v is VoteValue => v === "for" || v === "against" || v === "abstain";
