"use server";

import { and, eq, inArray, max } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  agendaItems, attendance, conflictDeclarations, meetings, minutes, minuteSignatures, performanceReviews, policies, resolutions, tasks, users, votes,
} from "@/server/db/schema";
import { issueOtp, maskPhone, otpErrorText, verifyOtp } from "@/server/auth/otp";
import { audit, nextNumber } from "@/server/lib/audit";
import { sha256 } from "@/server/lib/crypto";
import { todayISO } from "@/server/engines/dates";
import { emitWaqfEvent } from "@/server/modules/compliance/events";
import { notify } from "@/server/modules/notify";
import { parseForm, UserError, waqfAction, type WaqfCtx } from "@/server/modules/_shared";
import { fmtDateTime, type ActionState } from "@/lib/utils";
import {
  conflictedUsers, ensureBoard, governanceProfile, isVoteValue, latestMinutes, loadItem, loadMeeting, meetingSeats, minutesSigners,
  notifyIfTemplate, resolutionVotes,
} from "./core";
import {
  checkQuorum, composeMeetingTitle, decide, isPresent, minutesTemplate, POLICY_TYPES, RESOLUTION_CATEGORIES, splitMeetingTitle, tally,
  type VoteValue,
} from "./pure";

const uuid = z.string().uuid("قيمة غير صالحة.");
const gov = (waqfId: string) => `/app/w/${waqfId}/governance`;
const mtg = (waqfId: string, id: string) => `/app/w/${waqfId}/governance/meetings/${id}`;
const ids = (fd: FormData) => ({ waqfId: String(fd.get("waqfId") ?? ""), meetingId: String(fd.get("meetingId") ?? "") });
const bad = (): ActionState => ({ error: "طلب غير صالح. أعد تحميل الصفحة." });

async function meetingOr404(c: WaqfCtx, meetingId: string) {
  const m = await loadMeeting(c.tx, c.access.waqf.id, meetingId);
  if (!m) throw new UserError("الاجتماع غير موجود.");
  if (m.status === "cancelled") throw new UserError("الاجتماع ملغى.");
  return m;
}

/** Wraps a minutes update so the DB lock trigger (protect_locked_minutes) becomes a clear message. */
async function guardedMinutesUpdate(c: WaqfCtx, fn: (tx: WaqfCtx["tx"]) => Promise<unknown>) {
  try {
    await c.tx.transaction(async (sp) => {
      await fn(sp);
    });
  } catch (e) {
    const msg = String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? "");
    if (msg.includes("minutes are locked")) throw new UserError("المحضر مقفل بعد اكتمال التوقيعات ولا يمكن تعديله. لإضافة تصحيح أنشئ محضرًا ملحقًا في اجتماع لاحق.");
    throw e;
  }
}

// ───────────────────────── Meetings ─────────────────────────

const meetingSchema = z.object({
  title: z.string().trim().min(3, "اكتب عنوان الاجتماع.").max(200),
  kind: z.enum(["regular", "extraordinary"], { message: "اختر نوع الاجتماع." }),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "حدّد التاريخ والوقت."),
  location: z.string().trim().max(200).optional().default(""),
  link: z.union([z.literal(""), z.string().trim().url("الرابط غير صالح. ابدأ بـ https://")]).optional().default(""),
  agenda: z.string().max(4000).optional().default(""),
});

export async function createMeeting(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  if (!uuid.safeParse(waqfId).success) return bad();
  const r = parseForm(meetingSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (!d.location && !d.link) return { error: "حدّد مكان الاجتماع أو رابط الاجتماع عن بُعد.", fieldErrors: { location: "مطلوب المكان أو الرابط." } };
  let newId = "";
  const res = await waqfAction(waqfId, "governance.manage", async (c) => {
    const body = await ensureBoard(c.tx, waqfId, c.auth.user.id);
    const number = await nextNumber(c.tx, "MTG");
    const [m] = await c.tx.insert(meetings).values({
      waqfId, bodyId: body.id, kind: d.kind, title: composeMeetingTitle(number, d.title), scheduledAt: new Date(`${d.scheduledAt}:00+03:00`),
      location: d.location || null, link: d.link || null, createdBy: c.auth.user.id,
    }).returning({ id: meetings.id });
    const lines = d.agenda.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30);
    if (lines.length) {
      await c.tx.insert(agendaItems).values(lines.map((l, i) => {
        const decision = /^[!*]/.test(l);
        return { meetingId: m.id, waqfId, position: i + 1, title: l.replace(/^[!*]\s*/, "").slice(0, 300), kind: decision ? "decision" : "discussion", createdBy: c.auth.user.id };
      }));
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.meeting_create", entityType: "meeting", entityId: m.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, ...d } });
    newId = m.id;
  }, gov(waqfId));
  if (newId) redirect(mtg(waqfId, newId));
  return res;
}

const itemSchema = z.object({
  title: z.string().trim().min(3, "اكتب عنوان البند.").max(300),
  kind: z.enum(["info", "discussion", "decision"]),
  presenterName: z.string().trim().max(120).optional().default(""),
});

export async function addAgendaItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  const r = parseForm(itemSchema, fd);
  if ("state" in r) return r.state;
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    const mn = await latestMinutes(c.tx, m.id);
    if (mn && mn.status !== "draft") throw new UserError("لا تُضاف بنود بعد تعميم المحضر.");
    const [{ pos }] = await c.tx.select({ pos: max(agendaItems.position) }).from(agendaItems).where(eq(agendaItems.meetingId, m.id));
    const [it] = await c.tx.insert(agendaItems).values({ meetingId: m.id, waqfId, position: (pos ?? 0) + 1, title: r.data.title, kind: r.data.kind, presenterName: r.data.presenterName || null, createdBy: c.auth.user.id }).returning({ id: agendaItems.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.agenda_add", entityType: "agenda_item", entityId: it.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: r.data });
    return { ok: true, message: "أُضيف البند إلى جدول الأعمال." };
  }, mtg(waqfId, meetingId));
}

export async function removeAgendaItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  const itemId = String(fd.get("itemId") ?? "");
  if (![waqfId, meetingId, itemId].every((x) => uuid.safeParse(x).success)) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    await meetingOr404(c, meetingId);
    const it = await loadItem(c.tx, waqfId, itemId);
    if (!it || it.meetingId !== meetingId) throw new UserError("البند غير موجود.");
    const [res] = await c.tx.select({ id: resolutions.id }).from(resolutions).where(eq(resolutions.agendaItemId, it.id)).limit(1);
    if (res) throw new UserError("طُرح هذا البند للتصويت، فلا يُحذف. سجّل ما جرى في المحضر.");
    const [coi] = await c.tx.select({ id: conflictDeclarations.id }).from(conflictDeclarations).where(eq(conflictDeclarations.agendaItemId, it.id)).limit(1);
    if (coi) throw new UserError("سُجّل على هذا البند إقرار تعارض مصالح، فلا يُحذف حفاظًا على السجل.");
    await c.tx.delete(agendaItems).where(eq(agendaItems.id, it.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.agenda_remove", entityType: "agenda_item", entityId: it.id, waqfId, ip: c.ip, userAgent: c.userAgent, before: { title: it.title } });
    return { ok: true, message: "حُذف البند." };
  }, mtg(waqfId, meetingId));
}

export async function sendInvitations(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    if (m.heldAt) throw new UserError("انعقد الاجتماع بالفعل.");
    const items = await c.tx.select({ id: agendaItems.id }).from(agendaItems).where(eq(agendaItems.meetingId, m.id));
    if (!items.length) throw new UserError("أضف بندًا واحدًا على الأقل إلى جدول الأعمال قبل إرسال الدعوات.");
    await ensureBoard(c.tx, waqfId, c.auth.user.id);
    const { seats } = await meetingSeats(c.tx, m.id, waqfId);
    const existing = new Set((await c.tx.select({ id: attendance.bodyMembershipId }).from(attendance).where(eq(attendance.meetingId, m.id))).map((a) => a.id));
    // When no attendance rows exist yet, meetingSeats returned the current board.
    const fresh = seats.filter((s) => !existing.has(s.membershipId));
    if (fresh.length) await c.tx.insert(attendance).values(fresh.map((s) => ({ meetingId: m.id, bodyMembershipId: s.membershipId, waqfId, status: "invited" })));
    await c.tx.update(meetings).set({ invitationsSentAt: new Date(), updatedBy: c.auth.user.id }).where(eq(meetings.id, m.id));
    const { title } = splitMeetingTitle(m.title);
    let n = 0;
    for (const s of seats) {
      if (!s.userId) continue;
      await notify(s.userId, "meeting.invite", { title, when: fmtDateTime(m.scheduledAt), waqf: c.access.waqf.name }, { waqfId, link: mtg(waqfId, m.id), tx: c.tx });
      n++;
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.invite", entityType: "meeting", entityId: m.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { invited: n, resend: !!m.invitationsSentAt } });
    return { ok: true, message: `أُرسلت الدعوة إلى ${n} من الأعضاء مع جدول الأعمال.` };
  }, mtg(waqfId, meetingId));
}

export async function cancelMeeting(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    if (m.heldAt) throw new UserError("لا يُلغى اجتماع انعقد. وثّق ما جرى في المحضر.");
    await c.tx.update(meetings).set({ status: "cancelled", updatedBy: c.auth.user.id }).where(eq(meetings.id, m.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.meeting_cancel", entityType: "meeting", entityId: m.id, waqfId, ip: c.ip, userAgent: c.userAgent });
    return { ok: true, message: "أُلغي الاجتماع." };
  }, [mtg(waqfId, meetingId), gov(waqfId)]);
}

// ───────────────────────── Conflict of interest ─────────────────────────

const coiSchema = z.object({
  itemId: uuid,
  kind: z.enum(["none", "actual", "potential"], { message: "اختر نوع الإقرار." }),
  relationDegree: z.union([z.literal(""), z.coerce.number().int().min(1).max(4)]).optional(),
  description: z.string().trim().max(1000).optional().default(""),
});

export async function declareConflict(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  const r = parseForm(coiSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.kind !== "none" && d.description.length < 5) return { error: "صف طبيعة التعارض باختصار.", fieldErrors: { description: "مطلوب وصف التعارض." } };
  return waqfAction(waqfId, "coi.declare", async (c) => {
    const m = await meetingOr404(c, meetingId);
    const it = await loadItem(c.tx, waqfId, d.itemId);
    if (!it || it.meetingId !== m.id) throw new UserError("البند غير موجود.");
    const { seats } = await meetingSeats(c.tx, m.id, waqfId);
    if (!seats.some((s) => s.userId === c.auth.user.id)) throw new UserError("الإقرار لأعضاء المجلس المدعوين لهذا الاجتماع.");
    const [prev] = await c.tx.select().from(conflictDeclarations).where(and(eq(conflictDeclarations.agendaItemId, it.id), eq(conflictDeclarations.userId, c.auth.user.id))).limit(1);
    if (prev && (prev.kind !== "none" || d.kind === "none")) throw new UserError("سجّلت إقرارك على هذا البند مسبقًا. الإقرارات لا تُعدّل؛ تواصل مع أمين السر لأي تصحيح.");
    const [res] = await c.tx.select().from(resolutions).where(eq(resolutions.agendaItemId, it.id)).limit(1);
    if (res && res.status !== "draft") throw new UserError("أُغلق التصويت على هذا البند.");
    let recuseNow = false;
    if (res && d.kind !== "none") {
      const [mine] = await c.tx.select().from(votes).where(and(eq(votes.resolutionId, res.id), eq(votes.userId, c.auth.user.id))).limit(1);
      if (mine) throw new UserError("صوّتَّ على هذا البند قبل الإفصاح. أبلغ رئيس المجلس فورًا ليُثبت ذلك في المحضر.");
      recuseNow = true;
    }
    const [row] = await c.tx.insert(conflictDeclarations).values({
      waqfId, userId: c.auth.user.id, meetingId: m.id, agendaItemId: it.id, kind: d.kind,
      relationDegree: typeof d.relationDegree === "number" ? d.relationDegree : null, description: d.description || null, action: d.kind === "none" ? "none" : "recuse",
      year: Number(todayISO().slice(0, 4)),
    }).returning({ id: conflictDeclarations.id });
    if (recuseNow && res) await c.tx.insert(votes).values({ resolutionId: res.id, userId: c.auth.user.id, waqfId, value: "recused", reason: "إفصاح عن تعارض مصالح" }).onConflictDoNothing();
    if (d.kind !== "none") {
      await emitWaqfEvent(c.tx, { waqfId, event: "conflict_declared", date: todayISO(), refId: row.id, actorUserId: c.auth.user.id, meta: { meetingId: m.id, agendaItemId: it.id, kind: d.kind } });
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.coi_declare", entityType: "conflict_declaration", entityId: row.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { item: it.title, kind: d.kind, relationDegree: d.relationDegree, description: d.description } });
    return { ok: true, message: d.kind === "none" ? "سُجّل إقرارك بعدم وجود تعارض." : "سُجّل إفصاحك. ستُستبعد من المداولة والتصويت على هذا البند ولن تُحسب في نصابه." };
  }, mtg(waqfId, meetingId));
}

// ───────────────────────── Attendance & quorum ─────────────────────────

export async function recordAttendance(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    const att = await c.tx.select().from(attendance).where(eq(attendance.meetingId, m.id));
    if (!att.length) throw new UserError("أرسل الدعوات أولًا ليُنشأ كشف الحضور.");
    const mn = await latestMinutes(c.tx, m.id);
    if (mn && mn.status !== "draft") throw new UserError("عُمّم المحضر؛ لا يُعدّل كشف الحضور بعده.");
    const allowed = new Set(["invited", "present", "apologized", "absent", "proxy"]);
    const changes: Record<string, string> = {};
    for (const a of att) {
      const s = String(fd.get(`status_${a.bodyMembershipId}`) ?? a.status);
      const mode = String(fd.get(`mode_${a.bodyMembershipId}`) ?? a.mode ?? "");
      if (!allowed.has(s)) throw new UserError("حالة حضور غير صالحة.");
      if (s !== a.status || (mode || null) !== a.mode) {
        await c.tx.update(attendance).set({ status: s, mode: isPresent(s) ? mode || "in_person" : null, recordedAt: new Date() })
          .where(and(eq(attendance.meetingId, m.id), eq(attendance.bodyMembershipId, a.bodyMembershipId)));
        changes[a.bodyMembershipId] = s;
      }
    }
    // Attendance changed after quorum was confirmed → quorum must be re-checked.
    if (m.quorumMet !== null && Object.keys(changes).length) await c.tx.update(meetings).set({ quorumMet: null }).where(eq(meetings.id, m.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.attendance", entityType: "meeting", entityId: m.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: changes });
    return { ok: true, message: "حُفظ كشف الحضور." };
  }, mtg(waqfId, meetingId));
}

export async function confirmQuorum(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    const { seats, attendance: att } = await meetingSeats(c.tx, m.id, waqfId);
    if (!att.size) throw new UserError("أرسل الدعوات وسجّل الحضور أولًا.");
    const p = await governanceProfile(c.tx, waqfId);
    const q = checkQuorum(seats, att, { rule: p.quorumRule, requireIndependent: p.requireIndependent });
    await c.tx.update(meetings).set({
      quorumRequired: q.required, quorumMet: q.met, status: q.met ? "held" : m.status, heldAt: q.met ? (m.heldAt ?? new Date()) : m.heldAt, updatedBy: c.auth.user.id,
    }).where(eq(meetings.id, m.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.quorum", entityType: "meeting", entityId: m.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: q });
    if (!q.met) return { error: `لم يكتمل النصاب: ${q.reasons.join(" ")} ويبدأ التصويت بعد اكتماله.` };
    return { ok: true, message: `اكتمل النصاب (${q.presentVoting} من ${q.votingMembers}، المطلوب ${q.required}). الاجتماع منعقد.` };
  }, mtg(waqfId, meetingId));
}

// ───────────────────────── Voting ─────────────────────────

const openSchema = z.object({
  itemId: uuid,
  text: z.string().trim().min(5, "اكتب نص القرار المقترح.").max(2000),
  category: z.enum(RESOLUTION_CATEGORIES, { message: "اختر تصنيف القرار." }),
  requiresExternalApproval: z.string().optional(),
});

export async function openVote(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  const r = parseForm(openSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    if (!m.quorumMet) throw new UserError("تحقق من اكتمال النصاب قبل طرح أي بند للتصويت.");
    const it = await loadItem(c.tx, waqfId, d.itemId);
    if (!it || it.meetingId !== m.id) throw new UserError("البند غير موجود.");
    if (it.kind !== "decision") throw new UserError("يُطرح للتصويت ما كان من البنود «للقرار» فقط.");
    const [exists] = await c.tx.select({ id: resolutions.id }).from(resolutions).where(eq(resolutions.agendaItemId, it.id)).limit(1);
    if (exists) throw new UserError("طُرح هذا البند للتصويت مسبقًا.");
    const { seats, attendance: att } = await meetingSeats(c.tx, m.id, waqfId);
    const conflicted = await conflictedUsers(c.tx, it.id);
    const p = await governanceProfile(c.tx, waqfId);
    const q = checkQuorum(seats, att, { rule: p.quorumRule, requireIndependent: p.requireIndependent, excludeUserIds: conflicted });
    if (!q.met) throw new UserError(`لا يكتمل نصاب هذا البند بعد استبعاد المتعارضين: ${q.reasons.join(" ")}`);
    const number = await nextNumber(c.tx, "RES");
    const [res] = await c.tx.insert(resolutions).values({
      waqfId, meetingId: m.id, agendaItemId: it.id, number, text: d.text, category: d.category, requiresExternalApproval: d.requiresExternalApproval === "on", createdBy: c.auth.user.id,
    }).returning({ id: resolutions.id });
    const recused = seats.filter((s) => s.hasVote && s.userId && conflicted.has(s.userId) && isPresent(att.get(s.membershipId)));
    if (recused.length) await c.tx.insert(votes).values(recused.map((s) => ({ resolutionId: res.id, userId: s.userId!, waqfId, value: "recused" as const, reason: "إفصاح عن تعارض مصالح" })));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.vote_open", entityType: "resolution", entityId: res.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, item: it.title, recused: recused.map((s) => s.name), quorum: q } });
    return { ok: true, message: `فُتح التصويت على القرار ${number}.${recused.length ? ` استُبعد ${recused.length} لتعارض المصالح.` : ""}` };
  }, mtg(waqfId, meetingId));
}

const voteSchema = z.object({ resolutionId: uuid, value: z.string(), noConflict: z.string().optional(), reason: z.string().trim().max(500).optional().default("") });

export async function castVote(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  const r = parseForm(voteSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (!isVoteValue(d.value)) return { error: "اختر: موافق أو معارض أو ممتنع.", fieldErrors: { value: "اختر صوتك." } };
  const value: VoteValue = d.value;
  return waqfAction(waqfId, "governance.vote", async (c) => {
    const m = await meetingOr404(c, meetingId);
    const [res] = await c.tx.select().from(resolutions).where(and(eq(resolutions.id, d.resolutionId), eq(resolutions.meetingId, m.id))).limit(1);
    if (!res || !res.agendaItemId) throw new UserError("القرار غير موجود.");
    if (res.status !== "draft") throw new UserError("أُغلق التصويت على هذا القرار.");
    const { seats, attendance: att } = await meetingSeats(c.tx, m.id, waqfId);
    const seat = seats.find((s) => s.userId === c.auth.user.id);
    if (!seat || !seat.hasVote) throw new UserError("التصويت لأعضاء المجلس ذوي الصوت فقط.");
    if (!isPresent(att.get(seat.membershipId))) throw new UserError("سُجّلت غائبًا عن هذا الاجتماع، فلا يُحتسب لك صوت. راجع أمين السر إن كان ذلك خطأ.");
    const conflicted = await conflictedUsers(c.tx, res.agendaItemId);
    if (conflicted.has(c.auth.user.id)) throw new UserError("أفصحت عن تعارض مصالح في هذا البند، فأنت مستبعد من التصويت عليه.");
    const [decl] = await c.tx.select({ id: conflictDeclarations.id }).from(conflictDeclarations).where(and(eq(conflictDeclarations.agendaItemId, res.agendaItemId), eq(conflictDeclarations.userId, c.auth.user.id))).limit(1);
    if (!decl) {
      if (d.noConflict !== "on") return { error: "أقرّ بعدم وجود تعارض مصالح لك في هذا البند قبل التصويت، أو أفصح عن التعارض.", fieldErrors: { noConflict: "الإقرار مطلوب." } };
      await c.tx.insert(conflictDeclarations).values({ waqfId, userId: c.auth.user.id, meetingId: m.id, agendaItemId: res.agendaItemId, kind: "none", action: "none", year: Number(todayISO().slice(0, 4)) });
    }
    const ins = await c.tx.insert(votes).values({ resolutionId: res.id, userId: c.auth.user.id, waqfId, value, reason: d.reason || null }).onConflictDoNothing().returning({ v: votes.value });
    if (!ins.length) throw new UserError("سُجّل صوتك على هذا القرار مسبقًا، والأصوات لا تُعدّل بعد الإدلاء بها.");
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.vote", entityType: "resolution", entityId: res.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: res.number, value } });
    return { ok: true, message: "سُجّل صوتك، وهو نهائي." };
  }, mtg(waqfId, meetingId));
}

export async function closeVote(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  const resolutionId = String(fd.get("resolutionId") ?? "");
  if (![waqfId, meetingId, resolutionId].every((x) => uuid.safeParse(x).success)) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    const [res] = await c.tx.select().from(resolutions).where(and(eq(resolutions.id, resolutionId), eq(resolutions.meetingId, m.id))).limit(1);
    if (!res || !res.agendaItemId) throw new UserError("القرار غير موجود.");
    if (res.status !== "draft") throw new UserError("أُغلق التصويت مسبقًا.");
    const vs = await resolutionVotes(c.tx, res.id);
    const t = tally(vs.map((v) => v.value as VoteValue));
    const { seats, attendance: att } = await meetingSeats(c.tx, m.id, waqfId);
    const conflicted = await conflictedUsers(c.tx, res.agendaItemId);
    const eligible = seats.filter((s) => s.hasVote && isPresent(att.get(s.membershipId)) && !(s.userId && conflicted.has(s.userId)));
    const voted = new Set(vs.map((v) => v.userId));
    const missing = eligible.filter((s) => s.userId && !voted.has(s.userId));
    if (missing.length && fd.get("force") !== "on") {
      return { error: `لم يصوّت بعد: ${missing.map((s) => s.name).join("، ")}. انتظرهم، أو أغلق التصويت مع تأكيد عدّهم غير مصوّتين.`, data: { needForce: true } };
    }
    const p = await governanceProfile(c.tx, waqfId);
    const chair = seats.find((s) => s.role === "chair");
    const chairVote = (chair?.userId ? (vs.find((v) => v.userId === chair.userId)?.value as VoteValue | undefined) : undefined) ?? null;
    const dcs = decide(t, eligible.length, p.majorityRule, { enabled: p.castingVote, chairVote });
    await c.tx.update(resolutions).set({
      status: dcs.outcome, votesFor: t.for, votesAgainst: t.against, votesAbstain: t.abstain, votesRecused: t.recused, decidedAt: new Date(),
      reviewNote: dcs.note, updatedBy: c.auth.user.id,
    }).where(eq(resolutions.id, res.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.vote_close", entityType: "resolution", entityId: res.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: res.number, tally: t, ...dcs, notVoted: missing.map((s) => s.name) } });
    return { ok: true, message: `${dcs.outcome === "approved" ? "اعتُمد" : "رُفض"} القرار ${res.number}: موافق ${t.for}، معارض ${t.against}، ممتنع ${t.abstain}، مستبعد ${t.recused}. ${dcs.note}.` };
  }, [mtg(waqfId, meetingId), gov(waqfId)]);
}

// ───────────────────────── Minutes ─────────────────────────

export async function draftMinutes(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    if (!m.heldAt) throw new UserError("يُحرَّر المحضر بعد انعقاد الاجتماع واكتمال النصاب.");
    const prev = await latestMinutes(c.tx, m.id);
    if (prev) throw new UserError("للاجتماع محضر بالفعل.");
    const open = await c.tx.select({ number: resolutions.number }).from(resolutions).where(and(eq(resolutions.meetingId, m.id), eq(resolutions.status, "draft")));
    if (open.length) throw new UserError(`أغلق التصويت أولًا على: ${open.map((o) => o.number).join("، ")}.`);
    const body = await buildMinutesBody(c, m);
    const [row] = await c.tx.insert(minutes).values({ meetingId: m.id, waqfId, body, preparedBy: c.auth.user.id, createdBy: c.auth.user.id }).returning({ id: minutes.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.minutes_draft", entityType: "minutes", entityId: row.id, waqfId, ip: c.ip, userAgent: c.userAgent });
    return { ok: true, message: "أُنشئت مسودة المحضر، وأُدرجت فيها القرارات ونتائج التصويت تلقائيًا. راجعها وأكمل ملخص المداولات." };
  }, mtg(waqfId, meetingId));
}

async function buildMinutesBody(c: WaqfCtx, m: typeof meetings.$inferSelect) {
  const { seats, attendance: att } = await meetingSeats(c.tx, m.id, m.waqfId);
  const items = await c.tx.select().from(agendaItems).where(eq(agendaItems.meetingId, m.id)).orderBy(agendaItems.position);
  const res = await c.tx.select().from(resolutions).where(eq(resolutions.meetingId, m.id));
  const decl = items.length ? await c.tx.select().from(conflictDeclarations).where(inArray(conflictDeclarations.agendaItemId, items.map((i) => i.id))) : [];
  const nameOf = new Map(seats.map((s) => [s.userId, s.name]));
  const { number, title } = splitMeetingTitle(m.title);
  return minutesTemplate({
    waqfName: c.access.waqf.name, meetingNumber: number, meetingTitle: title, kind: m.kind, when: fmtDateTime(m.scheduledAt),
    place: [m.location, m.link ? "عن بُعد" : null].filter(Boolean).join(" — ") || "—",
    attendees: seats.map((s) => ({ name: s.name, role: s.role, status: att.get(s.membershipId) ?? "invited", independent: s.isIndependent })),
    quorum: m.quorumRequired ? { required: m.quorumRequired, present: seats.filter((s) => s.hasVote && isPresent(att.get(s.membershipId))).length, met: !!m.quorumMet } : null,
    items: items.map((it) => {
      const r = res.find((x) => x.agendaItemId === it.id);
      return {
        position: it.position, title: it.title, kind: it.kind,
        conflicts: decl.filter((d) => d.agendaItemId === it.id && d.kind !== "none").map((d) => nameOf.get(d.userId) ?? "عضو"),
        resolution: r ? { number: r.number, text: r.text, status: r.status, tally: { for: r.votesFor, against: r.votesAgainst, abstain: r.votesAbstain, recused: r.votesRecused }, note: r.reviewNote } : null,
      };
    }),
  });
}

const minutesSchema = z.object({ minuteId: uuid, body: z.string().trim().min(50, "المحضر قصير جدًا.").max(60_000) });

export async function saveMinutes(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  const r = parseForm(minutesSchema, fd);
  if ("state" in r) return r.state;
  return waqfAction(waqfId, "governance.manage", async (c) => {
    await meetingOr404(c, meetingId);
    const [mn] = await c.tx.select().from(minutes).where(and(eq(minutes.id, r.data.minuteId), eq(minutes.meetingId, meetingId))).limit(1);
    if (!mn) throw new UserError("المحضر غير موجود.");
    if (mn.status === "circulated") throw new UserError("عُمّم المحضر للتوقيع. أعده إلى مسودة أولًا (تُلغى التوقيعات السابقة).");
    await guardedMinutesUpdate(c, (tx) => tx.update(minutes).set({ body: r.data.body, updatedBy: c.auth.user.id }).where(eq(minutes.id, mn.id)));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.minutes_save", entityType: "minutes", entityId: mn.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { length: r.data.body.length } });
    return { ok: true, message: "حُفظت المسودة." };
  }, mtg(waqfId, meetingId));
}

export async function circulateMinutes(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  const minuteId = String(fd.get("minuteId") ?? "");
  if (![waqfId, meetingId, minuteId].every((x) => uuid.safeParse(x).success)) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    const [mn] = await c.tx.select().from(minutes).where(and(eq(minutes.id, minuteId), eq(minutes.meetingId, m.id))).limit(1);
    if (!mn) throw new UserError("المحضر غير موجود.");
    if (mn.status !== "draft") throw new UserError("المحضر ليس مسودة.");
    if (/ملخص المداولة:\s*\n/.test(mn.body)) throw new UserError("أكمل «ملخص المداولة» لكل بند قبل التعميم للتوقيع.");
    const hash = sha256(mn.body);
    await guardedMinutesUpdate(c, (tx) => tx.update(minutes).set({ status: "circulated", circulatedAt: new Date(), contentHash: hash, updatedBy: c.auth.user.id }).where(eq(minutes.id, mn.id)));
    const { seats, attendance: att } = await meetingSeats(c.tx, m.id, waqfId);
    const { title } = splitMeetingTitle(m.title);
    for (const s of seats) if (s.userId && isPresent(att.get(s.membershipId))) await notify(s.userId, "minutes.sign", { title }, { waqfId, link: `${mtg(waqfId, m.id)}#minutes`, tx: c.tx });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.minutes_circulate", entityType: "minutes", entityId: mn.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { contentHash: hash } });
    return { ok: true, message: "عُمّم المحضر على الحاضرين للتوقيع." };
  }, mtg(waqfId, meetingId));
}

export async function reopenMinutes(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  const minuteId = String(fd.get("minuteId") ?? "");
  if (![waqfId, meetingId, minuteId].every((x) => uuid.safeParse(x).success)) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const [mn] = await c.tx.select().from(minutes).where(and(eq(minutes.id, minuteId), eq(minutes.meetingId, meetingId))).limit(1);
    if (!mn) throw new UserError("المحضر غير موجود.");
    if (mn.status === "locked") throw new UserError("المحضر مقفل ولا يعاد إلى مسودة.");
    const signed = await minutesSigners(c.tx, mn.id);
    await c.tx.delete(minuteSignatures).where(eq(minuteSignatures.minuteId, mn.id));
    await guardedMinutesUpdate(c, (tx) => tx.update(minutes).set({ status: "draft", contentHash: null, circulatedAt: null, updatedBy: c.auth.user.id }).where(eq(minutes.id, mn.id)));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.minutes_reopen", entityType: "minutes", entityId: mn.id, waqfId, ip: c.ip, userAgent: c.userAgent, before: { signatures: signed.length } });
    return { ok: true, message: `أُعيد المحضر إلى مسودة وأُلغيت ${signed.length} من التوقيعات.` };
  }, mtg(waqfId, meetingId));
}

async function signableMinutes(c: WaqfCtx, meetingId: string, minuteId: string) {
  const m = await meetingOr404(c, meetingId);
  const [mn] = await c.tx.select().from(minutes).where(and(eq(minutes.id, minuteId), eq(minutes.meetingId, m.id))).limit(1);
  if (!mn) throw new UserError("المحضر غير موجود.");
  if (mn.status === "locked") throw new UserError("المحضر مقفل.");
  if (mn.status !== "circulated" || !mn.contentHash) throw new UserError("المحضر ليس معروضًا للتوقيع الآن.");
  if (sha256(mn.body) !== mn.contentHash) throw new UserError("بصمة نص المحضر لا تطابق المحفوظ. أوقف التوقيع وأبلغ أمين السر.");
  const { seats, attendance: att } = await meetingSeats(c.tx, m.id, c.access.waqf.id);
  const seat = seats.find((s) => s.userId === c.auth.user.id);
  if (!seat || !isPresent(att.get(seat.membershipId))) throw new UserError("يوقّع المحضرَ الحاضرون فقط.");
  const [already] = await c.tx.select().from(minuteSignatures).where(and(eq(minuteSignatures.minuteId, mn.id), eq(minuteSignatures.userId, c.auth.user.id))).limit(1);
  if (already) throw new UserError("وقّعت هذا المحضر مسبقًا.");
  return { m, mn };
}

export async function requestMinutesOtp(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  const minuteId = String(fd.get("minuteId") ?? "");
  if (![waqfId, meetingId, minuteId].every((x) => uuid.safeParse(x).success)) return bad();
  return waqfAction(waqfId, "governance.view", async (c) => {
    const { mn } = await signableMinutes(c, meetingId, minuteId);
    const issued = await issueOtp(c.auth.user.phone, "step_up", c.ip, { minuteId: mn.id, userId: c.auth.user.id, contentHash: mn.contentHash });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.minutes_sign_otp", entityType: "minutes", entityId: mn.id, waqfId, ip: c.ip, userAgent: c.userAgent });
    return { ok: true, message: "أرسلنا رمز التوقيع إلى جوالك.", data: { challengeId: issued.challengeId, demoCode: issued.demoCode ?? null, masked: maskPhone(c.auth.user.phone) } };
  });
}

const signSchema = z.object({
  minuteId: uuid,
  challengeId: uuid,
  code: z.string().regex(/^\d{6}$/, "الرمز 6 أرقام."),
  consent: z.literal("on", { message: "أكّد أنك قرأت المحضر وتوافق على ما ورد فيه." }),
});

export async function signMinutes(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success || !uuid.safeParse(meetingId).success) return bad();
  const r = parseForm(signSchema, fd);
  if ("state" in r) return { ...r.state, data: { challengeId: fd.get("challengeId") } };
  const d = r.data;
  return waqfAction(waqfId, "governance.view", async (c) => {
    const { mn } = await signableMinutes(c, meetingId, d.minuteId);
    const v = await verifyOtp(d.challengeId, c.auth.user.phone, "step_up", d.code);
    if (!v.ok) return { error: otpErrorText(v.reason), data: { challengeId: d.challengeId } };
    if (v.context?.minuteId !== mn.id || v.context?.userId !== c.auth.user.id) throw new UserError("الرمز لا يخص هذا المحضر. اطلب رمزًا جديدًا.");
    if (v.context?.contentHash !== mn.contentHash) throw new UserError("تغيّر نص المحضر بعد إرسال الرمز. أعد تحميل الصفحة واطلب رمزًا جديدًا.");
    await c.tx.insert(minuteSignatures).values({ minuteId: mn.id, userId: c.auth.user.id, waqfId, method: "otp_consent", contentHash: mn.contentHash! });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.minutes_sign", entityType: "minutes", entityId: mn.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { contentHash: mn.contentHash, challengeId: d.challengeId } });
    return { ok: true, message: "وُقّع المحضر باسمك، وحُفظت بصمة نصه." };
  }, mtg(waqfId, meetingId));
}

export async function lockMinutes(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  const minuteId = String(fd.get("minuteId") ?? "");
  if (![waqfId, meetingId, minuteId].every((x) => uuid.safeParse(x).success)) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const m = await meetingOr404(c, meetingId);
    const [mn] = await c.tx.select().from(minutes).where(and(eq(minutes.id, minuteId), eq(minutes.meetingId, m.id))).limit(1);
    if (!mn) throw new UserError("المحضر غير موجود.");
    if (mn.status === "locked") throw new UserError("المحضر مقفل مسبقًا.");
    if (mn.status !== "circulated") throw new UserError("عمّم المحضر للتوقيع أولًا.");
    if (sha256(mn.body) !== mn.contentHash) throw new UserError("بصمة نص المحضر لا تطابق المحفوظ؛ لا يمكن الإقفال.");
    const { seats, attendance: att } = await meetingSeats(c.tx, m.id, waqfId);
    const signed = new Set((await minutesSigners(c.tx, mn.id)).filter((s) => s.contentHash === mn.contentHash).map((s) => s.userId));
    const missing = seats.filter((s) => s.userId && isPresent(att.get(s.membershipId)) && !signed.has(s.userId));
    if (missing.length) throw new UserError(`لم يوقّع بعد: ${missing.map((s) => s.name).join("، ")}.`);
    const now = new Date();
    await guardedMinutesUpdate(c, (tx) => tx.update(minutes).set({ status: "locked", approvedAt: now, lockedAt: now, updatedBy: c.auth.user.id }).where(eq(minutes.id, mn.id)));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.minutes_lock", entityType: "minutes", entityId: mn.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { contentHash: mn.contentHash, signatures: signed.size } });
    return { ok: true, message: "أُقفل المحضر وأصبح نهائيًا، وقراراته نافذة للتنفيذ." };
  }, [mtg(waqfId, meetingId), gov(waqfId)]);
}

// ───────────────────────── Resolutions → tasks ─────────────────────────

const resTaskSchema = z.object({
  resolutionId: uuid,
  title: z.string().trim().min(3, "اكتب عنوان المهمة.").max(200),
  assigneeUserId: z.union([z.literal(""), uuid]).optional().default(""),
  dueOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح.")]).optional().default(""),
});

export async function taskFromResolution(_: ActionState, fd: FormData): Promise<ActionState> {
  const { waqfId, meetingId } = ids(fd);
  if (!uuid.safeParse(waqfId).success) return bad();
  const r = parseForm(resTaskSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const [res] = await c.tx.select().from(resolutions).where(and(eq(resolutions.id, d.resolutionId), eq(resolutions.waqfId, waqfId))).limit(1);
    if (!res) throw new UserError("القرار غير موجود.");
    if (!["approved", "executed"].includes(res.status)) throw new UserError("تُنشأ مهام التنفيذ للقرارات المعتمدة فقط.");
    if (d.assigneeUserId) {
      const [u] = await c.tx.select({ id: users.id }).from(users).where(eq(users.id, d.assigneeUserId)).limit(1);
      if (!u) throw new UserError("المكلّف غير موجود.");
    }
    const number = await nextNumber(c.tx, "TSK");
    const [t] = await c.tx.insert(tasks).values({
      waqfId, sourceType: "resolution", sourceId: res.id, title: d.title, description: `${number} — تنفيذ القرار ${res.number}: ${res.text}`,
      assigneeUserId: d.assigneeUserId || null, dueOn: d.dueOn || null, priority: "high", visibility: "shared", createdBy: c.auth.user.id,
    }).returning({ id: tasks.id });
    if (d.assigneeUserId) await notifyIfTemplate(c.tx, d.assigneeUserId, "task.assigned", { title: d.title, waqf: c.access.waqf.name, due: d.dueOn }, { waqfId, link: `/app/w/${waqfId}/tasks/${t.id}` });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.create", entityType: "task", entityId: t.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, from: res.number, ...d } });
    return { ok: true, message: `أُنشئت مهمة تنفيذ للقرار ${res.number}.` };
  }, [gov(waqfId), `/app/w/${waqfId}/tasks`, ...(meetingId ? [mtg(waqfId, meetingId)] : [])]);
}

export async function markResolutionExecuted(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  const resolutionId = String(fd.get("resolutionId") ?? "");
  if (![waqfId, resolutionId].every((x) => uuid.safeParse(x).success)) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const [res] = await c.tx.select().from(resolutions).where(and(eq(resolutions.id, resolutionId), eq(resolutions.waqfId, waqfId))).limit(1);
    if (!res || res.status !== "approved") throw new UserError("يُعلَّم المعتمد فقط بأنه منفّذ.");
    const open = await c.tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.sourceType, "resolution"), eq(tasks.sourceId, res.id), inArray(tasks.status, ["todo", "in_progress"])));
    if (open.length) throw new UserError(`بقيت ${open.length} من مهام التنفيذ مفتوحة. أنجزها أو ألغها أولًا.`);
    await c.tx.update(resolutions).set({ status: "executed", executedAt: new Date(), updatedBy: c.auth.user.id }).where(eq(resolutions.id, res.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.resolution_executed", entityType: "resolution", entityId: res.id, waqfId, ip: c.ip, userAgent: c.userAgent });
    return { ok: true, message: `عُلّم القرار ${res.number} منفّذًا.` };
  }, gov(waqfId));
}

// ───────────────────────── Policies & performance reviews ─────────────────────────

const policySchema = z.object({
  policyId: z.union([z.literal(""), uuid]).optional().default(""),
  policyType: z.enum(POLICY_TYPES.map((p) => p[0]) as [string, ...string[]], { message: "اختر نوع السياسة." }),
  title: z.string().trim().min(3, "اكتب عنوان السياسة.").max(200),
  status: z.enum(["draft", "approved", "superseded"]),
  approvedOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  reviewDue: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  resolutionId: z.union([z.literal(""), uuid]).optional().default(""),
});

export async function savePolicy(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  if (!uuid.safeParse(waqfId).success) return bad();
  const r = parseForm(policySchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.status === "approved" && !d.approvedOn) return { error: "حدّد تاريخ اعتماد السياسة.", fieldErrors: { approvedOn: "مطلوب للسياسة المعتمدة." } };
  if (d.status === "approved" && !d.reviewDue) return { error: "حدّد موعد المراجعة القادمة؛ تراجع السياسات دوريًا.", fieldErrors: { reviewDue: "مطلوب للسياسة المعتمدة." } };
  if (d.approvedOn && d.reviewDue && d.reviewDue <= d.approvedOn) return { error: "موعد المراجعة يجب أن يأتي بعد تاريخ الاعتماد.", fieldErrors: { reviewDue: "بعد تاريخ الاعتماد." } };
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const values = {
      policyType: d.policyType, title: d.title, status: d.status, approvedOn: d.approvedOn || null, reviewDue: d.reviewDue || null,
      approvedByResolutionId: d.resolutionId || null, updatedBy: c.auth.user.id,
    };
    if (d.policyId) {
      const [prev] = await c.tx.select().from(policies).where(and(eq(policies.id, d.policyId), eq(policies.waqfId, waqfId))).limit(1);
      if (!prev) throw new UserError("السياسة غير موجودة.");
      const bump = prev.status === "approved" && d.status === "approved" && prev.approvedOn !== values.approvedOn;
      await c.tx.update(policies).set({ ...values, version: bump ? prev.version + 1 : prev.version }).where(eq(policies.id, prev.id));
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.policy_update", entityType: "policy", entityId: prev.id, waqfId, ip: c.ip, userAgent: c.userAgent, before: prev, after: values });
    } else {
      const [row] = await c.tx.insert(policies).values({ waqfId, ...values, createdBy: c.auth.user.id }).returning({ id: policies.id });
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.policy_create", entityType: "policy", entityId: row.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: values });
    }
    return { ok: true, message: "حُفظت السياسة في السجل." };
  }, gov(waqfId));
}

export async function policyReviewTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  const policyId = String(fd.get("policyId") ?? "");
  if (![waqfId, policyId].every((x) => uuid.safeParse(x).success)) return bad();
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const [p] = await c.tx.select().from(policies).where(and(eq(policies.id, policyId), eq(policies.waqfId, waqfId))).limit(1);
    if (!p) throw new UserError("السياسة غير موجودة.");
    const [open] = await c.tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.sourceType, "compliance"), eq(tasks.sourceId, p.id), inArray(tasks.status, ["todo", "in_progress"]))).limit(1);
    if (open) throw new UserError("توجد مهمة مراجعة مفتوحة لهذه السياسة.");
    const [t] = await c.tx.insert(tasks).values({
      waqfId, sourceType: "compliance", sourceId: p.id, title: `مراجعة: ${p.title}`, description: "مراجعة دورية للسياسة وتحديثها عند الحاجة، ثم اعتمادها بقرار من المجلس (لائحة تنظيم أعمال النظارة م14).",
      dueOn: p.reviewDue, assigneeUserId: c.auth.user.id, priority: "normal", visibility: "shared", createdBy: c.auth.user.id,
    }).returning({ id: tasks.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.create", entityType: "task", entityId: t.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { policy: p.title } });
    return { ok: true, message: "أُضيفت مهمة المراجعة إلى المهام." };
  }, [gov(waqfId), `/app/w/${waqfId}/tasks`]);
}

const reviewSchema = z.object({
  subjectType: z.enum(["nazir", "board", "member"]),
  subjectName: z.string().trim().min(2, "اكتب اسم من يُقيَّم.").max(200),
  year: z.coerce.number().int().min(2000).max(2100),
  score: z.union([z.literal(""), z.coerce.number().min(0).max(100)]).optional(),
  notes: z.string().trim().max(2000).optional().default(""),
});

export async function addPerformanceReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  if (!uuid.safeParse(waqfId).success) return bad();
  const r = parseForm(reviewSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(waqfId, "governance.manage", async (c) => {
    const [row] = await c.tx.insert(performanceReviews).values({
      waqfId, subjectType: d.subjectType, subjectName: d.subjectName, year: d.year, score: typeof d.score === "number" ? d.score.toFixed(2) : null, notes: d.notes || null, createdBy: c.auth.user.id,
    }).returning({ id: performanceReviews.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "governance.review_add", entityType: "performance_review", entityId: row.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: d });
    return { ok: true, message: "سُجّل التقييم." };
  }, gov(waqfId));
}


