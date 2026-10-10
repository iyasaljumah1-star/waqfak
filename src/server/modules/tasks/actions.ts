"use server";

import { and, eq, notInArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { serviceRequests, taskComments, tasks, waqfMemberships } from "@/server/db/schema";
import { loadWaqfAccess, type Auth, type WaqfAccess } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { parseForm, userAction, UserError, waqfAction } from "@/server/modules/_shared";
import type { Tx } from "@/server/db";
import { notifyIfTemplate } from "@/server/modules/governance/core";
import type { ActionState } from "@/lib/utils";
import { canSeeTask, computeProgress, sanitizeChecklist, type ChecklistItem } from "./pure";

const uuid = z.string().uuid("قيمة غير صالحة.");
const date = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح.")]);

/** Roles allowed to create and assign tasks in a waqf. */
const canManage = (a: WaqfAccess) => a.perms.has("waqf.edit") || a.perms.has("governance.manage") || a.perms.has("compliance.manage");

const paths = (waqfId: string | null, taskId?: string) => [
  "/app/tasks",
  ...(waqfId ? [`/app/w/${waqfId}/tasks`, ...(taskId ? [`/app/w/${waqfId}/tasks/${taskId}`] : [])] : []),
];

type Ctx = { auth: Auth; tx: Tx; ip: string; userAgent: string };

/** Loads a task the caller can see, with their rights on it. Works for waqf tasks and personal (waqf-less) tasks. */
async function withTask(taskId: string, fn: (c: Ctx & { t: typeof tasks.$inferSelect; manage: boolean; mine: boolean }) => Promise<ActionState | void>): Promise<ActionState> {
  let waqfId: string | null = null;
  const res = await userAction(async (c) => {
    const [t] = await c.tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!t) throw new UserError("المهمة غير موجودة.");
    waqfId = t.waqfId;
    let manage = false;
    if (t.waqfId) {
      const access = await loadWaqfAccess(c.tx, c.auth, t.waqfId);
      if (!access || !access.perms.has("waqf.view")) throw new UserError("لا تشمل صلاحياتك هذه المهمة.");
      manage = canManage(access);
    } else if (t.createdBy !== c.auth.user.id && t.assigneeUserId !== c.auth.user.id) {
      throw new UserError("لا تشمل صلاحياتك هذه المهمة.");
    }
    if (!canSeeTask(t, { id: c.auth.user.id, isStaff: c.auth.isStaff })) throw new UserError("لا تشمل صلاحياتك هذه المهمة.");
    const mine = t.assigneeUserId === c.auth.user.id || t.createdBy === c.auth.user.id;
    return fn({ ...c, t, manage: manage || (!t.waqfId && mine), mine });
  });
  if (!res.error) {
    const { revalidatePath } = await import("next/cache");
    for (const p of paths(waqfId, taskId)) revalidatePath(p);
  }
  return res;
}

async function assertAssignable(tx: Tx, waqfId: string, userId: string) {
  const ok = (await tx.select({ w: waqfMemberships.waqfId, role: waqfMemberships.roleKey, s: waqfMemberships.status }).from(waqfMemberships).where(eq(waqfMemberships.userId, userId)))
    .some((r) => r.w === waqfId && r.s === "active" && r.role !== "beneficiary");
  if (ok) return;
  const [staff] = await tx.select({ id: serviceRequests.id }).from(serviceRequests)
    .where(and(eq(serviceRequests.waqfId, waqfId), eq(serviceRequests.assignedToUserId, userId), notInArray(serviceRequests.status, ["closed", "cancelled", "rejected"]))).limit(1);
  if (!staff) throw new UserError("المكلّف ليس عضوًا نشطًا في هذا الوقف ولا موظفًا مكلّفًا بطلب مفتوح فيه.");
}

const createSchema = z.object({
  title: z.string().trim().min(3, "اكتب عنوان المهمة.").max(200),
  description: z.string().trim().max(4000).optional().default(""),
  assigneeUserId: z.union([z.literal(""), uuid]).optional().default(""),
  dueOn: date.optional().default(""),
  priority: z.enum(["urgent", "high", "normal", "low"]).default("normal"),
  visibility: z.enum(["shared", "internal"]).default("shared"),
  checklist: z.string().max(6000).optional().default(""),
});

export async function createTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  if (!uuid.safeParse(waqfId).success) return { error: "طلب غير صالح." };
  const r = parseForm(createSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let newId = "";
  const res = await waqfAction(waqfId, "waqf.view", async (c) => {
    if (!canManage(c.access)) throw new UserError("إنشاء المهام وتكليفها لمن يدير الوقف (الناظر أو الرئيس أو أمين السر أو المدير التنفيذي).");
    if (d.visibility === "internal" && !c.auth.isStaff) throw new UserError("المهام الداخلية لفريق وقفك فقط.");
    if (d.assigneeUserId) await assertAssignable(c.tx, waqfId, d.assigneeUserId);
    const checklist: ChecklistItem[] = d.checklist.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 50).map((text) => ({ text: text.slice(0, 300), done: false }));
    const number = await nextNumber(c.tx, "TSK");
    const [t] = await c.tx.insert(tasks).values({
      waqfId, sourceType: "manual", title: d.title, description: [number, d.description].filter(Boolean).join(" — "),
      assigneeUserId: d.assigneeUserId || null, dueOn: d.dueOn || null, priority: d.priority, visibility: d.visibility, checklist, createdBy: c.auth.user.id,
    }).returning({ id: tasks.id });
    if (d.assigneeUserId && d.assigneeUserId !== c.auth.user.id) {
      await notifyIfTemplate(c.tx, d.assigneeUserId, "task.assigned", { title: d.title, waqf: c.access.waqf.name, due: d.dueOn }, { waqfId, link: `/app/w/${waqfId}/tasks/${t.id}` });
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.create", entityType: "task", entityId: t.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, ...d } });
    newId = t.id;
  }, paths(waqfId));
  if (newId && fd.get("open") === "1") redirect(`/app/w/${waqfId}/tasks/${newId}`);
  return newId ? { ok: true, message: "أُضيفت المهمة." } : res;
}

const statusSchema = z.object({ taskId: uuid, status: z.enum(["todo", "in_progress", "done", "cancelled"]), progress: z.union([z.literal(""), z.coerce.number().min(0).max(100)]).optional() });

export async function setTaskStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(statusSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return withTask(d.taskId, async (c) => {
    if (!c.manage && c.t.assigneeUserId !== c.auth.user.id) throw new UserError("يحدّث حالة المهمة المكلَّفُ بها أو من يدير المهام.");
    if (d.status === "cancelled" && !c.manage) throw new UserError("إلغاء المهمة لمن يدير المهام.");
    const checklist = sanitizeChecklist(c.t.checklist);
    if (d.status === "done" && checklist.some((i) => !i.done) && fd.get("force") !== "on") {
      return { error: "بقيت بنود غير منجزة في قائمة التحقق. أنجزها أو أكّد الإغلاق.", data: { needForce: true } };
    }
    const progress = computeProgress(d.status, checklist, typeof d.progress === "number" ? d.progress : c.t.progress);
    await c.tx.update(tasks).set({ status: d.status, progress, completedAt: d.status === "done" ? new Date() : null, updatedBy: c.auth.user.id }).where(eq(tasks.id, c.t.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.status", entityType: "task", entityId: c.t.id, waqfId: c.t.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: c.t.status, progress: c.t.progress }, after: { status: d.status, progress } });
    return { ok: true, message: "حُدّثت المهمة." };
  });
}

export async function toggleChecklist(_: ActionState, fd: FormData): Promise<ActionState> {
  const taskId = String(fd.get("taskId") ?? "");
  const index = Number(fd.get("index"));
  if (!uuid.safeParse(taskId).success || !Number.isInteger(index)) return { error: "طلب غير صالح." };
  return withTask(taskId, async (c) => {
    if (!c.manage && c.t.assigneeUserId !== c.auth.user.id) throw new UserError("يحدّث قائمة التحقق المكلَّفُ بالمهمة أو من يديرها.");
    const list = sanitizeChecklist(c.t.checklist);
    if (!list[index]) throw new UserError("البند غير موجود.");
    list[index] = { ...list[index], done: !list[index].done };
    const status = c.t.status === "todo" && list.some((i) => i.done) ? "in_progress" : c.t.status;
    await c.tx.update(tasks).set({ checklist: list, status, progress: computeProgress(status, list, c.t.progress), updatedBy: c.auth.user.id }).where(eq(tasks.id, c.t.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.checklist", entityType: "task", entityId: c.t.id, waqfId: c.t.waqfId, ip: c.ip, userAgent: c.userAgent, after: { item: list[index].text, done: list[index].done } });
  });
}

export async function addChecklistItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const taskId = String(fd.get("taskId") ?? "");
  const text = String(fd.get("text") ?? "").trim();
  if (!uuid.safeParse(taskId).success) return { error: "طلب غير صالح." };
  if (text.length < 2) return { error: "اكتب نص البند.", fieldErrors: { text: "مطلوب." } };
  return withTask(taskId, async (c) => {
    if (!c.manage && c.t.assigneeUserId !== c.auth.user.id) throw new UserError("يضيف البنود المكلَّفُ بالمهمة أو من يديرها.");
    const list = sanitizeChecklist(c.t.checklist);
    if (list.length >= 50) throw new UserError("الحد الأقصى 50 بندًا.");
    list.push({ text: text.slice(0, 300), done: false });
    await c.tx.update(tasks).set({ checklist: list, progress: computeProgress(c.t.status, list, c.t.progress), updatedBy: c.auth.user.id }).where(eq(tasks.id, c.t.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.checklist_add", entityType: "task", entityId: c.t.id, waqfId: c.t.waqfId, ip: c.ip, userAgent: c.userAgent, after: { text } });
    return { ok: true, message: "أُضيف البند." };
  });
}

const editSchema = z.object({
  taskId: uuid,
  assigneeUserId: z.union([z.literal(""), uuid]).optional().default(""),
  dueOn: date.optional().default(""),
  priority: z.enum(["urgent", "high", "normal", "low"]),
  visibility: z.enum(["shared", "internal"]),
});

export async function editTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(editSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return withTask(d.taskId, async (c) => {
    if (!c.manage) throw new UserError("تعديل التكليف والموعد لمن يدير المهام.");
    if (d.visibility === "internal" && !c.auth.isStaff && c.t.visibility !== "internal") throw new UserError("المهام الداخلية لفريق وقفك فقط.");
    if (d.assigneeUserId && c.t.waqfId && d.assigneeUserId !== c.t.assigneeUserId) await assertAssignable(c.tx, c.t.waqfId, d.assigneeUserId);
    const after = { assigneeUserId: d.assigneeUserId || null, dueOn: d.dueOn || null, priority: d.priority, visibility: d.visibility };
    await c.tx.update(tasks).set({ ...after, updatedBy: c.auth.user.id }).where(eq(tasks.id, c.t.id));
    if (after.assigneeUserId && after.assigneeUserId !== c.t.assigneeUserId && after.assigneeUserId !== c.auth.user.id) {
      await notifyIfTemplate(c.tx, after.assigneeUserId, "task.assigned", { title: c.t.title, waqf: "", due: d.dueOn }, { waqfId: c.t.waqfId, link: c.t.waqfId ? `/app/w/${c.t.waqfId}/tasks/${c.t.id}` : "/app/tasks" });
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.edit", entityType: "task", entityId: c.t.id, waqfId: c.t.waqfId, ip: c.ip, userAgent: c.userAgent, before: { assigneeUserId: c.t.assigneeUserId, dueOn: c.t.dueOn, priority: c.t.priority, visibility: c.t.visibility }, after });
    return { ok: true, message: "حُفظ التعديل." };
  });
}

export async function addTaskComment(_: ActionState, fd: FormData): Promise<ActionState> {
  const taskId = String(fd.get("taskId") ?? "");
  const body = String(fd.get("body") ?? "").trim();
  if (!uuid.safeParse(taskId).success) return { error: "طلب غير صالح." };
  if (body.length < 2) return { error: "اكتب التعليق.", fieldErrors: { body: "مطلوب." } };
  if (body.length > 4000) return { error: "التعليق أطول من 4000 حرف.", fieldErrors: { body: "قصّر التعليق." } };
  return withTask(taskId, async (c) => {
    const [row] = await c.tx.insert(taskComments).values({ taskId: c.t.id, waqfId: c.t.waqfId, authorId: c.auth.user.id, body }).returning({ id: taskComments.id });
    const notifyTo = [c.t.assigneeUserId, c.t.createdBy].filter((u): u is string => !!u && u !== c.auth.user.id);
    for (const u of new Set(notifyTo)) await notifyIfTemplate(c.tx, u, "task.comment", { title: c.t.title }, { waqfId: c.t.waqfId, link: c.t.waqfId ? `/app/w/${c.t.waqfId}/tasks/${c.t.id}` : "/app/tasks" });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.comment", entityType: "task_comment", entityId: row.id, waqfId: c.t.waqfId, ip: c.ip, userAgent: c.userAgent });
    return { ok: true, message: "أُضيف التعليق." };
  });
}

