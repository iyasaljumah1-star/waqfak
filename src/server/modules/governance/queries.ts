import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  agendaItems, conflictDeclarations, meetings, minutes, minuteSignatures, performanceReviews, policies, resolutions, tasks, users, votes,
} from "../../db/schema";
import { governanceProfile, latestMinutes, loadSeats, meetingSeats } from "./core";
import { independenceSummary, isPresent, splitMeetingTitle } from "./pure";

export async function governanceHome(tx: Tx, waqfId: string) {
  const [mtgs, res, pols, reviews, profile, board] = await Promise.all([
    tx.select().from(meetings).where(eq(meetings.waqfId, waqfId)).orderBy(desc(meetings.scheduledAt)).limit(50),
    tx.select().from(resolutions).where(eq(resolutions.waqfId, waqfId)).orderBy(desc(resolutions.createdAt)).limit(100),
    tx.select().from(policies).where(eq(policies.waqfId, waqfId)).orderBy(asc(policies.policyType)),
    tx.select().from(performanceReviews).where(eq(performanceReviews.waqfId, waqfId)).orderBy(desc(performanceReviews.year), desc(performanceReviews.createdAt)),
    governanceProfile(tx, waqfId),
    loadSeats(tx, waqfId),
  ]);
  const mins = mtgs.length ? await tx.select({ meetingId: minutes.meetingId, status: minutes.status, version: minutes.version }).from(minutes).where(inArray(minutes.meetingId, mtgs.map((m) => m.id))) : [];
  const minByMeeting = new Map<string, string>();
  for (const m of mins.sort((a, b) => a.version - b.version)) minByMeeting.set(m.meetingId, m.status);
  const resTasks = res.length
    ? await tx.select({ sourceId: tasks.sourceId, status: tasks.status }).from(tasks).where(and(eq(tasks.waqfId, waqfId), eq(tasks.sourceType, "resolution"), inArray(tasks.sourceId, res.map((r) => r.id))))
    : [];
  const meetingNo = new Map(mtgs.map((m) => [m.id, splitMeetingTitle(m.title).number]));
  const year = new Date().getFullYear();
  const heldThisYear = mtgs.filter((m) => m.heldAt && m.heldAt.getFullYear() === year).length;
  return {
    meetings: mtgs.map((m) => ({ ...m, ...splitMeetingTitle(m.title), minutesStatus: minByMeeting.get(m.id) ?? null })),
    resolutions: res.map((r) => ({
      ...r,
      meetingNumber: r.meetingId ? meetingNo.get(r.meetingId) ?? null : null,
      tasksOpen: resTasks.filter((t) => t.sourceId === r.id && (t.status === "todo" || t.status === "in_progress")).length,
      tasksTotal: resTasks.filter((t) => t.sourceId === r.id).length,
    })),
    policies: pols,
    reviews,
    profile,
    seats: board.seats,
    hasBody: !!board.bodyId,
    independence: independenceSummary(board.seats, profile.independentTarget),
    heldThisYear,
  };
}

export type MeetingPage = NonNullable<Awaited<ReturnType<typeof meetingPage>>>;

export async function meetingPage(tx: Tx, waqfId: string, meetingId: string, me: string) {
  const [m] = await tx.select().from(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.waqfId, waqfId))).limit(1);
  if (!m) return null;
  const [items, seatsInfo, profile, mn, res, decl] = await Promise.all([
    tx.select().from(agendaItems).where(eq(agendaItems.meetingId, m.id)).orderBy(asc(agendaItems.position)),
    meetingSeats(tx, m.id, waqfId),
    governanceProfile(tx, waqfId),
    latestMinutes(tx, m.id),
    tx.select().from(resolutions).where(eq(resolutions.meetingId, m.id)).orderBy(asc(resolutions.createdAt)),
    tx.select().from(conflictDeclarations).where(eq(conflictDeclarations.meetingId, m.id)).orderBy(asc(conflictDeclarations.declaredAt)),
  ]);
  const allVotes = res.length ? await tx.select().from(votes).where(inArray(votes.resolutionId, res.map((r) => r.id))) : [];
  const sigs = mn ? await tx.select().from(minuteSignatures).where(eq(minuteSignatures.minuteId, mn.id)) : [];
  const resTasks = res.length
    ? await tx
        .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueOn: tasks.dueOn, sourceId: tasks.sourceId, assignee: users.fullName })
        .from(tasks)
        .leftJoin(users, eq(users.id, tasks.assigneeUserId))
        .where(and(eq(tasks.sourceType, "resolution"), inArray(tasks.sourceId, res.map((r) => r.id))))
    : [];
  const { seats, attendance, modes } = seatsInfo;
  const mySeat = seats.find((s) => s.userId === me) ?? null;
  const nameOf = new Map(seats.map((s) => [s.userId ?? "", s.name]));
  return {
    meeting: { ...m, ...splitMeetingTitle(m.title) },
    items: items.map((it) => {
      const r = res.find((x) => x.agendaItemId === it.id) ?? null;
      const vs = r ? allVotes.filter((v) => v.resolutionId === r.id) : [];
      const d = decl.filter((x) => x.agendaItemId === it.id);
      return {
        ...it,
        declarations: d.map((x) => ({ ...x, name: nameOf.get(x.userId) ?? "عضو" })),
        conflicted: d.filter((x) => x.kind !== "none").map((x) => x.userId),
        myDeclaration: d.find((x) => x.userId === me) ?? null,
        resolution: r,
        votesCast: vs.filter((v) => v.value !== "recused").length,
        votes: vs.map((v) => ({ ...v, name: nameOf.get(v.userId) ?? "عضو" })),
        myVote: vs.find((v) => v.userId === me)?.value ?? null,
        tasks: r ? resTasks.filter((t) => t.sourceId === r.id) : [],
      };
    }),
    seats: seats.map((s) => ({ ...s, status: attendance.get(s.membershipId) ?? null, mode: modes.get(s.membershipId) ?? null })),
    invited: attendance.size > 0,
    presentVoting: seats.filter((s) => s.hasVote && isPresent(attendance.get(s.membershipId))).length,
    profile,
    minutes: mn,
    signatures: sigs.map((s) => ({ ...s, name: nameOf.get(s.userId) ?? "عضو" })),
    mySeat: mySeat ? { ...mySeat, status: attendance.get(mySeat.membershipId) ?? null } : null,
  };
}
