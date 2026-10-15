"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Tx } from "@/server/db";
import {
  assets, bankAccounts, beneficiaries, documents, holidays, leases, minutes, nazaraEngagements, nazaraEvents, nazaraTeam, obligationInstances,
  reports, resolutions, roles, settings, tasks, trusteeAppointments, trustees, userRoles, users, waqfMemberships, waqfs, waqfTimelineEvents,
} from "@/server/db/schema";
import { rolePermissionMap, type Auth } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { addBusinessDays, addDays, todayISO } from "@/server/engines/dates";
import { checkMaker, approvalMode } from "@/server/modules/approvals/policy";
import { parseForm, UserError } from "@/server/modules/_shared";
import { staffAction } from "@/server/modules/admin/guard";
import { notify } from "@/server/modules/notify";
import type { ActionState } from "@/lib/utils";
import { openEngagementTx } from "./engine";
import { syncRequestsFromNazara } from "@/server/modules/operations/links";
import { buildPeriodicSnapshot, buildRecordSnapshot } from "./report";
import { randomToken } from "@/server/lib/crypto";
import { activationGate, NAZARA_LICENSE_KEY, type LicenceRecord } from "./licence";
import { ACTIVATION_TASKS, canTransition, checklistProgress, END_REASON_AR, freshHandover, RUNNING_STATUSES, STATUS_AR, TRANSITIONS, type EngagementStatus } from "./pure";

const uuid = z.string().uuid("معرّف غير صالح.");
const PATH = (id: string) => [`/admin/nazara/${id}`, "/admin/nazara"];

type Engagement = typeof nazaraEngagements.$inferSelect;
type Ctx = { auth: Auth; tx: Tx; ip: string; userAgent: string };

async function readSettingValue<T>(tx: Tx, key: string, fallback: T): Promise<T> {
  const [r] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return (r?.v as T) ?? fallback;
}

/** Loads an engagement the caller can see (RLS: waqf access) — never by id alone. */
async function loadEngagement(tx: Tx, id: string): Promise<Engagement> {
  const [e] = await tx.select().from(nazaraEngagements).where(eq(nazaraEngagements.id, id)).limit(1).for("update");
  if (!e) throw new UserError("لم نجد ملف النظارة، أو لا تملك صلاحية الوصول إليه.");
  return e;
}

async function logEvent(c: Ctx, e: Engagement, action: string, to: string | null, note?: string | null, extra?: Record<string, unknown>) {
  await c.tx.insert(nazaraEvents).values({ engagementId: e.id, waqfId: e.waqfId, action, fromStatus: e.status, toStatus: to, note: note ?? null, actorUserId: c.auth.user.id });
  await audit(c.tx, {
    actorUserId: c.auth.user.id, action: `nazara.${action}`, entityType: "nazara_engagement", entityId: e.id, waqfId: e.waqfId, ip: c.ip, userAgent: c.userAgent,
    before: { status: e.status }, after: { status: to ?? e.status, ...(note ? { note } : {}), ...(extra ?? {}) },
  });
}

async function notifyTeam(c: Ctx, e: Engagement, status: string, note: string) {
  const team = await c.tx.select({ userId: nazaraTeam.userId }).from(nazaraTeam).where(and(eq(nazaraTeam.engagementId, e.id), isNull(nazaraTeam.removedAt)));
  const [w] = await c.tx.select({ name: waqfs.name }).from(waqfs).where(eq(waqfs.id, e.waqfId)).limit(1);
  for (const id of new Set(team.map((t) => t.userId).filter((u) => u !== c.auth.user.id)))
    await notify(id, "nazara.update", { number: e.number, status, waqf: w?.name ?? "", note }, { waqfId: e.waqfId, link: `/admin/nazara/${e.id}`, tx: c.tx });
}

async function setStatus(c: Ctx, e: Engagement, action: keyof typeof TRANSITIONS, patch: Partial<typeof nazaraEngagements.$inferInsert>, note?: string | null, extra?: Record<string, unknown>) {
  const t = TRANSITIONS[action];
  if (!c.auth.perms.has(t.perm)) throw new UserError(t.perm === "nazara.approve" ? "هذا القرار يتطلب صلاحية اعتماد النظارة." : "لا تملك صلاحية إدارة ملفات النظارة.");
  if (!canTransition(e.status, action)) throw new UserError(`لا يمكن «${t.label}» والملف في حالة «${STATUS_AR[e.status as EngagementStatus] ?? e.status}».`);
  await c.tx.update(nazaraEngagements).set({ ...patch, status: t.to, updatedBy: c.auth.user.id }).where(eq(nazaraEngagements.id, e.id));
  await logEvent(c, e, action, t.to, note, extra);
  await notifyTeam(c, e, STATUS_AR[t.to], note ?? t.label);
  await syncRequestsFromNazara(c, e, action, note ?? null);
}

// ───────────────────────── team & memberships ─────────────────────────

/** Waqf role a team member holds for the engagement's current phase. */
const membershipRole = (status: string, teamRole: string) =>
  (RUNNING_STATUSES as string[]).includes(status) ? (teamRole === "lead" ? "nazir" : "executive") : "nazara_reviewer";

async function grantMembership(tx: Tx, waqfId: string, userId: string, roleKey: string, by: string) {
  const [existing] = await tx
    .select({ id: waqfMemberships.id, status: waqfMemberships.status })
    .from(waqfMemberships)
    .where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.userId, userId), eq(waqfMemberships.roleKey, roleKey)))
    .limit(1);
  if (existing) {
    await tx.update(waqfMemberships).set({ status: "active", endsAt: null, updatedBy: by }).where(eq(waqfMemberships.id, existing.id));
    return existing.id;
  }
  const [m] = await tx.insert(waqfMemberships).values({ waqfId, userId, roleKey, status: "active", invitedBy: by, createdBy: by }).returning({ id: waqfMemberships.id });
  return m.id;
}

async function endMembership(tx: Tx, membershipId: string | null, by: string) {
  if (!membershipId) return;
  await tx.update(waqfMemberships).set({ status: "ended", endsAt: new Date(), updatedBy: by }).where(eq(waqfMemberships.id, membershipId));
}

/** Re-issues every active team member's waqf membership for the engagement's (new) phase. */
async function syncTeamMemberships(tx: Tx, e: Engagement, status: string, by: string) {
  const team = await tx.select().from(nazaraTeam).where(and(eq(nazaraTeam.engagementId, e.id), isNull(nazaraTeam.removedAt)));
  for (const t of team) {
    const ended = status === "ended" || status === "rejected";
    if (ended) {
      await endMembership(tx, t.membershipId, by);
      continue;
    }
    const role = membershipRole(status, t.teamRole);
    const [cur] = t.membershipId ? await tx.select({ roleKey: waqfMemberships.roleKey }).from(waqfMemberships).where(eq(waqfMemberships.id, t.membershipId)).limit(1) : [];
    if (cur?.roleKey === role) continue;
    await endMembership(tx, t.membershipId, by);
    const mid = await grantMembership(tx, e.waqfId, t.userId, role, by);
    await tx.update(nazaraTeam).set({ membershipId: mid }).where(eq(nazaraTeam.id, t.id));
  }
}

// ───────────────────────── opening ─────────────────────────

const openSchema = z.object({ waqfId: uuid });
export async function openEngagement(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(openSchema, fd);
  if ("state" in r) return r.state;
  let id = "";
  const res = await staffAction("nazara.manage", async ({ auth, tx, ip, userAgent }) => {
    const [w] = await tx.select({ id: waqfs.id }).from(waqfs).where(eq(waqfs.id, r.data.waqfId)).limit(1);
    if (!w) throw new UserError("لم نجد الوقف، أو لا تملك صلاحية الوصول إليه.");
    const o = await openEngagementTx(tx, { waqfId: w.id, actorId: auth.user.id, ip, userAgent });
    id = o.id;
  }, "/admin/nazara");
  if (res.error) return res;
  redirect(`/admin/nazara/${id}`);
}

// ───────────────────────── intake ─────────────────────────

const checkSchema = z.object({
  id: uuid,
  key: z.string().min(1).max(60),
  status: z.enum(["missing", "received", "not_applicable"], { message: "اختر حالة البند." }),
  documentId: z.union([z.literal(""), uuid]).optional().default(""),
  note: z.string().trim().max(500, "الملاحظة طويلة جدًا.").optional().default(""),
});

export async function updateChecklistItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(checkSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, d.id);
    if (!["intake", "under_review", "pending_completion"].includes(e.status)) throw new UserError("قائمة الاستلام تُعدَّل قبل اعتماد القبول فقط.");
    const item = e.checklist.find((i) => i.key === d.key);
    if (!item) throw new UserError("البند غير موجود.");
    if (d.status === "not_applicable" && item.required && d.note.length < 5) return { error: "راجع الحقول المظللة.", fieldErrors: { note: "اذكر سبب عدم انطباق بند مطلوب." } };
    if (d.documentId) {
      const [doc] = await c.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d.documentId), eq(documents.waqfId, e.waqfId))).limit(1);
      if (!doc) throw new UserError("الوثيقة المختارة لا تخص هذا الوقف.");
    }
    const next = e.checklist.map((i) =>
      i.key === d.key ? { ...i, status: d.status, documentId: d.documentId || null, note: d.note || null, updatedBy: c.auth.user.id, updatedAt: new Date().toISOString() } : i,
    );
    await c.tx.update(nazaraEngagements).set({ checklist: next, updatedBy: c.auth.user.id }).where(eq(nazaraEngagements.id, e.id));
    await audit(c.tx, {
      actorUserId: c.auth.user.id, action: "nazara.checklist", entityType: "nazara_engagement", entityId: e.id, waqfId: e.waqfId, ip: c.ip, userAgent: c.userAgent,
      before: { key: d.key, status: item.status }, after: { key: d.key, status: d.status, documentId: d.documentId || null },
    });
    return { ok: true, message: "حُفظ البند." };
  }, PATH(d.id));
}

const notesSchema = z.object({ id: uuid, intakeNotes: z.string().trim().max(5000, "الملاحظات طويلة جدًا.") });
export async function saveIntakeNotes(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(notesSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    await c.tx.update(nazaraEngagements).set({ intakeNotes: r.data.intakeNotes || null, updatedBy: c.auth.user.id }).where(eq(nazaraEngagements.id, e.id));
    return { ok: true, message: "حُفظت الملاحظات." };
  }, PATH(r.data.id));
}

/** Records an intake gap as a follow-up task on the waqf (assigned to the lead), linked back to the engagement. */
const gapSchema = z.object({
  id: uuid,
  title: z.string().trim().min(5, "اكتب عنوان المهمة.").max(200),
  dueOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح.")]).optional().default(""),
  assigneeUserId: z.union([z.literal(""), uuid]).optional().default(""),
});
export async function addEngagementTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(gapSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, d.id);
    if (e.status === "ended" || e.status === "rejected") throw new UserError("الملف مقفل.");
    const team = await c.tx.select({ userId: nazaraTeam.userId }).from(nazaraTeam).where(and(eq(nazaraTeam.engagementId, e.id), isNull(nazaraTeam.removedAt)));
    const assignee = d.assigneeUserId || e.leadUserId || c.auth.user.id;
    if (d.assigneeUserId && !team.some((t) => t.userId === d.assigneeUserId)) throw new UserError("أسند المهمة إلى عضو في فريق النظارة.");
    const [t] = await c.tx
      .insert(tasks)
      .values({ waqfId: e.waqfId, sourceType: "nazara", sourceId: e.id, title: d.title, assigneeUserId: assignee, dueOn: d.dueOn || null, visibility: "internal", createdBy: c.auth.user.id, updatedBy: c.auth.user.id })
      .returning({ id: tasks.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "nazara.task", entityType: "task", entityId: t.id, waqfId: e.waqfId, ip: c.ip, userAgent: c.userAgent, after: { title: d.title, assignee, dueOn: d.dueOn || null, engagement: e.number } });
    if (assignee !== c.auth.user.id) await notify(assignee, "nazara.update", { number: e.number, status: "مهمة جديدة", waqf: "", note: d.title }, { waqfId: e.waqfId, link: `/admin/nazara/${e.id}`, tx: c.tx });
    return { ok: true, message: "أُنشئت المهمة." };
  }, PATH(d.id));
}

// ───────────────────────── team ─────────────────────────

const teamSchema = z.object({ id: uuid, userId: uuid, teamRole: z.enum(["lead", "member"], { message: "اختر الدور في الفريق." }) });
export async function addTeamMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(teamSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, d.id);
    if (e.status === "ended" || e.status === "rejected") throw new UserError("الملف مقفل.");
    if (d.teamRole === "lead" && !c.auth.perms.has("nazara.approve")) throw new UserError("تعيين مسؤول الملف يتطلب صلاحية اعتماد النظارة.");
    const [u] = await c.tx.select({ id: users.id, isStaff: users.isStaff, status: users.status, name: users.fullName }).from(users).where(eq(users.id, d.userId)).limit(1);
    if (!u || !u.isStaff || u.status !== "active") throw new UserError("اختر موظفًا نشطًا من فريق وقفك.");
    // Only staff whose role carries nazara permissions may join a nazara team.
    const keys = (await c.tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, u.id))).map((x) => x.key);
    const map = await rolePermissionMap();
    if (!keys.some((k) => map.get(k)?.has("nazara.view"))) throw new UserError("هذا الموظف لا يحمل دورًا في النظارة الاعتبارية. امنحه دور «موظف النظارة» أولًا.");
    const current = await c.tx.select().from(nazaraTeam).where(and(eq(nazaraTeam.engagementId, e.id), isNull(nazaraTeam.removedAt)));
    if (current.some((t) => t.userId === u.id)) throw new UserError("الموظف عضو في الفريق.");
    if (d.teamRole === "lead") {
      for (const old of current.filter((t) => t.teamRole === "lead")) {
        await c.tx.update(nazaraTeam).set({ teamRole: "member" }).where(eq(nazaraTeam.id, old.id));
      }
    }
    const role = membershipRole(e.status, d.teamRole);
    const mid = await grantMembership(c.tx, e.waqfId, u.id, role, c.auth.user.id);
    await c.tx.insert(nazaraTeam).values({ engagementId: e.id, waqfId: e.waqfId, userId: u.id, teamRole: d.teamRole, membershipId: mid, addedBy: c.auth.user.id });
    if (d.teamRole === "lead") await c.tx.update(nazaraEngagements).set({ leadUserId: u.id, updatedBy: c.auth.user.id }).where(eq(nazaraEngagements.id, e.id));
    // The previous lead's waqf role follows its new team role.
    if (d.teamRole === "lead") await syncTeamMemberships(c.tx, { ...e, leadUserId: u.id }, e.status, c.auth.user.id);
    await logEvent(c, e, "team_add", null, `${u.name ?? "موظف"} — ${d.teamRole === "lead" ? "مسؤول الملف" : "عضو الفريق"}`, { userId: u.id, teamRole: d.teamRole, waqfRole: role });
    await notify(u.id, "nazara.update", { number: e.number, status: "انضممت إلى فريق النظارة", waqf: "", note: d.teamRole === "lead" ? "مسؤول الملف" : "عضو الفريق" }, { waqfId: e.waqfId, link: `/admin/nazara/${e.id}`, tx: c.tx });
    return { ok: true, message: "أُضيف إلى الفريق." };
  }, PATH(d.id));
}

const removeSchema = z.object({ id: uuid, teamId: uuid });
export async function removeTeamMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(removeSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    const [t] = await c.tx.select().from(nazaraTeam).where(and(eq(nazaraTeam.id, r.data.teamId), eq(nazaraTeam.engagementId, e.id), isNull(nazaraTeam.removedAt))).limit(1);
    if (!t) throw new UserError("العضو غير موجود في الفريق.");
    if (t.teamRole === "lead" && (RUNNING_STATUSES as string[]).includes(e.status)) throw new UserError("عيّن مسؤولًا آخر للملف قبل إخراج المسؤول الحالي؛ النظارة القائمة لا تبقى بلا مسؤول.");
    await c.tx.update(nazaraTeam).set({ removedAt: new Date(), removedBy: c.auth.user.id }).where(eq(nazaraTeam.id, t.id));
    await endMembership(c.tx, t.membershipId, c.auth.user.id);
    if (t.teamRole === "lead") await c.tx.update(nazaraEngagements).set({ leadUserId: null }).where(eq(nazaraEngagements.id, e.id));
    await logEvent(c, e, "team_remove", null, null, { userId: t.userId });
    return { ok: true, message: "أُخرج من الفريق وأُنهي وصوله إلى الوقف." };
  }, PATH(r.data.id));
}

// ───────────────────────── decisions ─────────────────────────

const simpleSchema = z.object({ id: uuid, note: z.string().trim().max(2000).optional().default("") });

export async function startReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(simpleSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    if (!e.leadUserId) throw new UserError("عيّن مسؤولًا للملف قبل بدء الدراسة.");
    await setStatus(c, e, "start_review", {}, r.data.note || null);
    return { ok: true, message: "بدأت الدراسة." };
  }, PATH(r.data.id));
}

export async function requestCompletion(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(simpleSchema, fd);
  if ("state" in r) return r.state;
  if (r.data.note.length < 10) return { error: "راجع الحقول المظللة.", fieldErrors: { note: "اذكر ما يلزم استكماله (10 أحرف على الأقل)." } };
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    await setStatus(c, e, "request_completion", { decision: "completion_requested", decisionReason: r.data.note }, r.data.note);
    return { ok: true, message: "سُجّل طلب الاستكمال." };
  }, PATH(r.data.id));
}

export async function acceptEngagement(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(simpleSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("nazara.approve", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    const p = checklistProgress(e.checklist);
    if (p.requiredOpen.length) throw new UserError(`لا يُعتمد القبول وفي قائمة الاستلام بنود مطلوبة لم تُستلم: ${p.requiredOpen.map((i) => i.label).slice(0, 3).join("؛ ")}${p.requiredOpen.length > 3 ? "…" : ""}`);
    await setStatus(c, e, "accept", { decision: "accepted", decisionReason: r.data.note || null, decidedBy: c.auth.user.id, decidedAt: new Date() }, r.data.note || "اعتُمد القبول");
    return { ok: true, message: "اعتُمد قبول النظارة. الخطوة التالية: قرار التعيين ثم المباشرة." };
  }, PATH(r.data.id));
}

export async function rejectEngagement(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(simpleSchema, fd);
  if ("state" in r) return r.state;
  if (r.data.note.length < 10) return { error: "راجع الحقول المظللة.", fieldErrors: { note: "اذكر سبب الرفض (10 أحرف على الأقل)." } };
  return staffAction("nazara.approve", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    await setStatus(c, e, "reject", { decision: "rejected", decisionReason: r.data.note, decidedBy: c.auth.user.id, decidedAt: new Date() }, r.data.note);
    await syncTeamMemberships(c.tx, e, "rejected", c.auth.user.id);
    return { ok: true, message: "سُجّل الرفض وأُنهي وصول الفريق إلى الوقف." };
  }, PATH(r.data.id));
}

// ───────────────────────── appointment & activation ─────────────────────────

const appointmentSchema = z.object({
  id: uuid,
  appointmentDecisionNo: z.string().trim().min(1, "أدخل رقم قرار التعيين.").max(80),
  appointmentDecisionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "أدخل تاريخ القرار."),
  appointmentAuthority: z.enum(["competent_authority", "court", "notary", "gaa", "internal"], { message: "اختر جهة القرار." }),
  appointmentDocumentId: z.union([z.literal(""), uuid]).optional().default(""),
  powers: z.string().trim().min(10, "اذكر صلاحيات الناظر كما في القرار.").max(4000),
  feeTerms: z.string().trim().min(3, "اذكر أتعاب النظارة كما في القرار أو الشرط.").max(2000),
  responsibilities: z.string().trim().min(10, "اذكر مسؤوليات الناظر كما في القرار.").max(4000),
});

/** Records the naming decision (م4/6: الصلاحيات والأتعاب والمسؤوليات). Editable until activation. */
export async function saveAppointment(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(appointmentSchema, fd);
  if ("state" in r) return r.state;
  const { id, ...d } = r.data;
  if (d.appointmentDecisionDate > todayISO()) return { error: "راجع الحقول المظللة.", fieldErrors: { appointmentDecisionDate: "تاريخ القرار في المستقبل." } };
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, id);
    if (!["under_review", "accepted"].includes(e.status)) throw new UserError("يُسجَّل قرار التعيين بعد بدء الدراسة وقبل المباشرة.");
    if (d.appointmentDocumentId) {
      const [doc] = await c.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d.appointmentDocumentId), eq(documents.waqfId, e.waqfId))).limit(1);
      if (!doc) throw new UserError("وثيقة القرار لا تخص هذا الوقف.");
    }
    await c.tx.update(nazaraEngagements).set({ ...d, appointmentDocumentId: d.appointmentDocumentId || null, updatedBy: c.auth.user.id }).where(eq(nazaraEngagements.id, e.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "nazara.appointment", entityType: "nazara_engagement", entityId: e.id, waqfId: e.waqfId, ip: c.ip, userAgent: c.userAgent, after: { decisionNo: d.appointmentDecisionNo, date: d.appointmentDecisionDate, authority: d.appointmentAuthority } });
    return { ok: true, message: "حُفظ قرار التعيين." };
  }, PATH(id));
}

/**
 * Starts the nazara: Waqfak becomes the waqf's legal-entity nazir. Licence gate (م5/2): a real waqf needs the GAA
 * licence active, numbered and unexpired; a demo/test waqf may be activated as a marked practice engagement.
 */
export async function activateEngagement(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(simpleSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("nazara.approve", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    if (!canTransition(e.status, "activate")) throw new UserError("تُباشَر النظارة بعد اعتماد القبول.");
    const missing = [
      !e.leadUserId && "مسؤول الملف",
      !e.appointmentDecisionNo && "رقم قرار التعيين",
      !e.appointmentDecisionDate && "تاريخه",
      !e.powers && "الصلاحيات",
      !e.feeTerms && "الأتعاب",
      !e.responsibilities && "المسؤوليات",
    ].filter(Boolean);
    if (missing.length) throw new UserError(`أكمل قرار التعيين قبل المباشرة: ${missing.join("، ")}.`);
    const [w] = await c.tx.select().from(waqfs).where(eq(waqfs.id, e.waqfId)).limit(1);
    if (!w) throw new UserError("لم نجد الوقف.");
    const licences = await readSettingValue<LicenceRecord[]>(c.tx, "company.licenses", []);
    const licence = licences.find((l) => l.key === NAZARA_LICENSE_KEY);
    const gate = activationGate({ licence, today: todayISO(), waqfIsDemo: w.isDemo });
    if (!gate.allowed) throw new UserError(gate.reason);

    const profile = await readSettingValue<{ nameAr?: string }>(c.tx, "company.profile", {});
    const today = todayISO();
    const [tr] = await c.tx
      .insert(trustees)
      .values({ waqfId: w.id, kind: "legal_entity", displayName: profile.nameAr || "شركة وقفك", licenseNo: gate.practice ? null : licence?.number ?? null, licenseExpiresOn: gate.practice ? null : licence?.expiresOn ?? null, residesInKsa: true, startsOn: e.appointmentDecisionDate ?? today, status: "active", createdBy: c.auth.user.id })
      .returning({ id: trustees.id });
    await c.tx.insert(trusteeAppointments).values({
      trusteeId: tr.id, waqfId: w.id, decisionNo: e.appointmentDecisionNo, decisionDate: e.appointmentDecisionDate, authority: e.appointmentAuthority,
      powers: e.powers, fees: e.feeTerms, responsibilities: e.responsibilities, documentId: e.appointmentDocumentId, createdBy: c.auth.user.id,
    });
    await c.tx.update(waqfs).set({ waqfakRole: "nazir", nazirMode: "legal_entity", updatedBy: c.auth.user.id }).where(eq(waqfs.id, w.id));
    await c.tx.insert(waqfTimelineEvents).values({
      waqfId: w.id, type: "nazara_started", occurredOn: today, title: gate.practice ? "مباشرة «وقفك» النظارة (تجريبية)" : "مباشرة «وقفك» النظارة بصفتها ناظرًا اعتباريًا",
      details: `قرار التعيين ${e.appointmentDecisionNo} بتاريخ ${e.appointmentDecisionDate}`, documentId: e.appointmentDocumentId, createdBy: c.auth.user.id,
    });
    // Duties triggered by the change of nazir, as tasks for the lead (see ACTIVATION_TASKS for sources).
    const hol = new Set((await c.tx.select({ day: holidays.day }).from(holidays)).map((h) => String(h.day)));
    for (const t of ACTIVATION_TASKS) {
      const due = t.businessDays ? addBusinessDays(today, t.businessDays, hol) : t.days ? addDays(today, t.days) : null;
      await c.tx.insert(tasks).values({
        waqfId: w.id, sourceType: "nazara", sourceId: e.id, title: t.title, description: `المرجع: ${t.source}`, assigneeUserId: e.leadUserId,
        dueOn: due, priority: "high", visibility: "shared", createdBy: c.auth.user.id, updatedBy: c.auth.user.id,
      });
    }
    await setStatus(c, e, "activate", { trusteeId: tr.id, startedOn: today, activatedBy: c.auth.user.id, isPractice: gate.practice }, gate.practice ? "مباشرة تجريبية على وقف تجريبي" : "مباشرة النظارة", { practice: gate.practice, licenceNo: gate.practice ? null : licence?.number ?? null });
    await syncTeamMemberships(c.tx, e, "active", c.auth.user.id);
    return { ok: true, message: gate.practice ? "بدأت النظارة التجريبية على هذا الوقف التجريبي." : "بدأت النظارة. أصبح فريق الملف يدير الوقف بصفته الناظر." };
  }, [...PATH(r.data.id), "/admin/waqfs"]);
}

export async function suspendEngagement(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(simpleSchema, fd);
  if ("state" in r) return r.state;
  if (r.data.note.length < 10) return { error: "راجع الحقول المظللة.", fieldErrors: { note: "اذكر سبب الإيقاف ومرجعه (مثل قرار الهيئة م24/1ج)." } };
  return staffAction("nazara.approve", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    await setStatus(c, e, "suspend", {}, r.data.note);
    if (e.trusteeId) await c.tx.update(trustees).set({ status: "suspended" }).where(eq(trustees.id, e.trusteeId));
    return { ok: true, message: "أُوقفت النظارة مؤقتًا." };
  }, PATH(r.data.id));
}

export async function resumeEngagement(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(simpleSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("nazara.approve", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    await setStatus(c, e, "resume", {}, r.data.note || "استئناف النظارة");
    if (e.trusteeId) await c.tx.update(trustees).set({ status: "active" }).where(eq(trustees.id, e.trusteeId));
    return { ok: true, message: "استُؤنفت النظارة." };
  }, PATH(r.data.id));
}

// ───────────────────────── ending & handover ─────────────────────────

const endingSchema = z.object({
  id: uuid,
  endReason: z.enum(["resignation", "dismissal", "lost_condition", "deed_term", "other"], { message: "اختر سبب انتهاء النظارة." }),
  endNote: z.string().trim().min(10, "اذكر تفاصيل الانتهاء ومرجعه (10 أحرف على الأقل).").max(2000),
  successorName: z.string().trim().max(200).optional().default(""),
});

/** Opens the ending phase and prepares the handover list from the waqf's actual records (م27/3). */
export async function startEnding(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(endingSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return staffAction("nazara.approve", async (c) => {
    const e = await loadEngagement(c.tx, d.id);
    const w = e.waqfId;
    const n = async (q: Promise<unknown[]>) => (await q).length;
    const [aCount, lCount, bCount, benCount, dCount, rCount, mCount, oCount] = await Promise.all([
      n(c.tx.select({ id: assets.id }).from(assets).where(eq(assets.waqfId, w))),
      n(c.tx.select({ id: leases.id }).from(leases).where(and(eq(leases.waqfId, w), eq(leases.status, "active")))),
      n(c.tx.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.waqfId, w))),
      n(c.tx.select({ id: beneficiaries.id }).from(beneficiaries).where(eq(beneficiaries.waqfId, w))),
      n(c.tx.select({ id: documents.id }).from(documents).where(eq(documents.waqfId, w))),
      n(c.tx.select({ id: resolutions.id }).from(resolutions).where(eq(resolutions.waqfId, w))),
      n(c.tx.select({ id: minutes.id }).from(minutes).where(eq(minutes.waqfId, w))),
      n(c.tx.select({ id: obligationInstances.id }).from(obligationInstances).where(and(eq(obligationInstances.waqfId, w), inArray(obligationInstances.status, ["upcoming", "due_soon", "overdue"])))),
    ]);
    const handover = freshHandover({
      assets: `${aCount} أصل مسجل`,
      contracts: `${lCount} عقد إيجار ساري`,
      bank: `${bCount} حساب بنكي`,
      finance: "القيود والموازنات والقوائم المسجلة في ملف الوقف",
      beneficiaries: `${benCount} مستفيد مسجل`,
      documents: `${dCount} وثيقة`,
      decisions: `${rCount} قرار و${mCount} محضر`,
      obligations: `${oCount} التزام قائم`,
      registration: d.successorName ? `الناظر البديل: ${d.successorName}` : "يُحدَّد الناظر البديل",
    });
    await setStatus(c, e, "start_ending", { endReason: d.endReason, endNote: d.endNote, successorName: d.successorName || null, handover }, `${END_REASON_AR[d.endReason]} — ${d.endNote}`);
    return { ok: true, message: "بدأ الإنهاء. أكمل بنود التسليم ثم أقفل النظارة." };
  }, PATH(d.id));
}

const handoverSchema = z.object({ id: uuid, key: z.string().min(1).max(40), status: z.enum(["pending", "delivered"]), note: z.string().trim().max(500).optional().default("") });
export async function updateHandoverItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(handoverSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, d.id);
    if (e.status !== "ending") throw new UserError("بنود التسليم تُعدَّل في مرحلة الإنهاء فقط.");
    if (!e.handover.some((h) => h.key === d.key)) throw new UserError("البند غير موجود.");
    const next = e.handover.map((h) => (h.key === d.key ? { ...h, status: d.status, note: d.note || null, updatedBy: c.auth.user.id, updatedAt: new Date().toISOString() } : h));
    await c.tx.update(nazaraEngagements).set({ handover: next, updatedBy: c.auth.user.id }).where(eq(nazaraEngagements.id, e.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "nazara.handover", entityType: "nazara_engagement", entityId: e.id, waqfId: e.waqfId, ip: c.ip, userAgent: c.userAgent, after: { key: d.key, status: d.status } });
    return { ok: true, message: "حُفظ بند التسليم." };
  }, PATH(d.id));
}

/** Closes the nazara: every handover item delivered; the trustee record ends and the team's access to the waqf ends. */
export async function endEngagement(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(simpleSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("nazara.approve", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    const pending = e.handover.filter((h) => h.status !== "delivered");
    if (pending.length) throw new UserError(`بنود تسليم لم تُستكمل: ${pending.map((h) => h.label).slice(0, 3).join("؛ ")}${pending.length > 3 ? "…" : ""}`);
    const today = todayISO();
    if (e.trusteeId) await c.tx.update(trustees).set({ status: "ended", endsOn: today }).where(eq(trustees.id, e.trusteeId));
    await c.tx.update(waqfs).set({ waqfakRole: "none", updatedBy: c.auth.user.id }).where(eq(waqfs.id, e.waqfId));
    await c.tx.insert(waqfTimelineEvents).values({ waqfId: e.waqfId, type: "nazara_ended", occurredOn: today, title: "انتهاء نظارة «وقفك»", details: `${END_REASON_AR[e.endReason ?? "other"] ?? ""}${e.successorName ? ` — سُلّم الوقف إلى ${e.successorName}` : ""}`, createdBy: c.auth.user.id });
    await setStatus(c, e, "end", { endedOn: today }, r.data.note || "أُقفلت النظارة بعد التسليم");
    await syncTeamMemberships(c.tx, e, "ended", c.auth.user.id);
    return { ok: true, message: "أُقفلت النظارة، وأُنهي وصول الفريق إلى الوقف." };
  }, [...PATH(r.data.id), "/admin/waqfs"]);
}

// ───────────────────────── outputs ─────────────────────────

const reportSchema = z.object({
  id: uuid,
  kind: z.enum(["nazara_periodic", "nazara_takeover", "nazara_handover"], { message: "اختر نوع المخرج." }),
  from: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح.")]).optional().default(""),
  to: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح.")]).optional().default(""),
});

/** Prepares a nazara output from the recorded data (snapshot stored with a number and a verification code). */
export async function generateNazaraReport(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reportSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.kind === "nazara_periodic") {
    const fe: Record<string, string> = {};
    if (!d.from) fe.from = "حدد بداية الفترة.";
    if (!d.to) fe.to = "حدد نهاية الفترة.";
    if (d.from && d.to && d.from > d.to) fe.to = "نهاية الفترة قبل بدايتها.";
    if (d.to && d.to > todayISO()) fe.to = "نهاية الفترة في المستقبل.";
    if (Object.keys(fe).length) return { error: "راجع الحقول المظللة.", fieldErrors: fe };
  }
  return staffAction("nazara.manage", async (c) => {
    const e = await loadEngagement(c.tx, d.id);
    const [w] = await c.tx.select().from(waqfs).where(eq(waqfs.id, e.waqfId)).limit(1);
    if (!w) throw new UserError("لم نجد الوقف.");
    if (d.kind === "nazara_periodic" && !(RUNNING_STATUSES as string[]).includes(e.status)) throw new UserError("يُعدّ التقرير الدوري للنظارة القائمة فقط.");
    if (d.kind === "nazara_takeover" && !["accepted", "active", "suspended", "ending", "ended"].includes(e.status)) throw new UserError("يُعدّ محضر الاستلام بعد اعتماد القبول.");
    if (d.kind === "nazara_handover" && !["ending", "ended"].includes(e.status)) throw new UserError("يُعدّ محضر التسليم في مرحلة الإنهاء.");
    const snapshot = d.kind === "nazara_periodic" ? await buildPeriodicSnapshot(c.tx, e, w, d.from, d.to) : await buildRecordSnapshot(c.tx, e, w, d.kind);
    const number = await nextNumber(c.tx, "RPT");
    const status = d.kind === "nazara_periodic" ? "draft" : "final";
    const [row] = await c.tx
      .insert(reports)
      .values({ number, waqfId: w.id, kind: d.kind, title: snapshot.title, status, verificationCode: randomToken(12), snapshot, generatedBy: c.auth.user.id })
      .returning({ id: reports.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "nazara.report", entityType: "report", entityId: row.id, waqfId: w.id, ip: c.ip, userAgent: c.userAgent, after: { number, kind: d.kind, status, from: d.from || null, to: d.to || null } });
    return { ok: true, message: status === "draft" ? `أُعدّت مسودة التقرير ${number}، وتنتظر الاعتماد.` : `أُعدّ ${snapshot.title} ${number}.` };
  }, PATH(d.id));
}

const approveSchema = z.object({ id: uuid, reportId: uuid });
/** Approves a periodic report. Its preparer may approve it only with direct approval (recorded), unless a written policy requires a second person. */
export async function approveNazaraReport(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(approveSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("nazara.approve", async (c) => {
    const e = await loadEngagement(c.tx, r.data.id);
    const [rep] = await c.tx.select().from(reports).where(and(eq(reports.id, r.data.reportId), eq(reports.waqfId, e.waqfId), eq(reports.kind, "nazara_periodic"), isNull(reports.revokedAt))).limit(1);
    if (!rep) throw new UserError("التقرير غير موجود.");
    if (rep.status !== "draft") throw new UserError("التقرير معتمد مسبقًا.");
    const mk = await checkMaker(c.tx, c.auth, "nazara_report", rep.generatedBy === c.auth.user.id, "لا يعتمد معدّ التقرير تقريره؛ يعتمده مسؤول نظارة آخر.");
    if (!mk.ok) throw new UserError(mk.error);
    await c.tx.update(reports).set({ status: "approved", approvedBy: c.auth.user.id, approvedAt: new Date() }).where(eq(reports.id, rep.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "nazara.report_approved", entityType: "report", entityId: rep.id, waqfId: e.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: "draft", generatedBy: rep.generatedBy }, after: { status: "approved", number: rep.number, engagement: e.number, ...approvalMode(mk) } });
    return { ok: true, message: `اعتُمد التقرير ${rep.number}${mk.self ? " (اعتماد مباشر مسجّل لمعدّه)" : ""}، وأصبح متاحًا لأعضاء الوقف في «التقارير».` };
  }, PATH(r.data.id));
}
