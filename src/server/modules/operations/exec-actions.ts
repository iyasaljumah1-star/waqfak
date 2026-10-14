"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { documents, outputs, requestStages, roles, tasks, userRoles, users } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { assignableRoleKeys, loadRequestCtx } from "@/server/modules/requests/access";
import { advance, type ActCtx } from "@/server/modules/requests/engine";
import { advanceStage, type PlanStage } from "@/server/modules/requests/workflow";
import type { ActionState } from "@/lib/utils";
import { EXEC_KIND_LABEL, executeRight, nextTaskStatus, taskActions, type ExecKind, type TaskAction } from "./exec-pure";
import { taskEvent } from "./exec";

/**
 * Actions on request execution tasks. Rights are enforced here (server), not by the buttons: an authorized manager
 * (admin.requests.all) executes any task directly with no assignment; otherwise the task's or the request's assignee.
 * The executor and the assignee are recorded separately on every event.
 */

const uuid = z.string().uuid("قيمة غير صالحة.");
const schema = z.object({
  taskId: uuid,
  requestId: uuid,
  action: z.enum(["start", "complete", "return", "cancel", "reopen", "assign"]),
  note: z.string().trim().max(2000).optional().default(""),
  userId: z.union([z.literal(""), uuid]).optional().default(""),
  documentId: z.union([z.literal(""), uuid]).optional().default(""),
});
const reval = (id: string) => [`/admin/requests/${id}`, "/admin", "/admin/requests"];

async function loadTask(c: ActCtx, taskId: string, requestId: string) {
  const [t] = await c.tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.requestId, requestId))).limit(1).for("update");
  if (!t) throw new UserError("المهمة غير موجودة أو لا تملك صلاحية الوصول إليها.");
  const rc = await loadRequestCtx(c.tx, c.auth, requestId, "staff");
  const right = executeRight({ isStaff: c.auth.isStaff, perms: c.auth.perms, userId: c.auth.user.id, taskAssignee: t.assigneeUserId, requestAssignee: rc.req.assignedToUserId });
  if (!right.can) throw new ForbiddenError("لا تملك تنفيذ هذه المهمة: ينفذها المكلّف بها أو مدير مخوّل.");
  return { t, rc, right };
}

/** Kind-specific completion rules: the task completes only when the record it mirrors allows it. */
async function completionCheck(c: ActCtx, t: typeof tasks.$inferSelect, rc: Awaited<ReturnType<typeof loadTask>>["rc"]) {
  const kind = t.kind as ExecKind | null;
  if (kind === "intake" && !rc.req.acceptedAt) throw new UserError("تكتمل هذه المهمة بقبول الطلب للخدمة بعد التحقق من بياناته (من لوحة «الفرز» في صفحة الطلب).");
  if (kind === "prepare_output") {
    const [o] = await c.tx.select({ status: outputs.status }).from(outputs).where(and(eq(outputs.requestId, rc.req.id), eq(outputs.outputKey, t.outputKey ?? ""))).limit(1);
    if (!o || (o.status !== "in_review" && o.status !== "approved")) throw new UserError("تكتمل مهمة الإعداد بإرسال مسودة المخرج للمراجعة.");
  }
  if (kind === "review_output") throw new UserError("تكتمل مهمة المراجعة باعتماد المخرج نفسه.");
  if (kind === "cycle") throw new UserError("تكتمل مهمة الدورة بإقفال الدورة من لوحة الخدمة المستمرة.");
  if (kind === "stage") {
    const stages = await c.tx.select().from(requestStages).where(eq(requestStages.requestId, rc.req.id));
    const s = stages.find((x) => x.stageKey === t.stageKey);
    if (rc.req.status !== "in_progress") throw new UserError("تُنجز مراحل العمل أثناء التنفيذ.");
    if (!s || s.status !== "active") throw new UserError("هذه المرحلة ليست المرحلة الجارية.");
    // Completing the active stage moves the workflow on (unless it is the last work stage, closed by sending to review).
    const plan: PlanStage[] = [...stages].sort((a, b) => a.position - b.position).map((x) => {
      const d = rc.stagesDef.find((y) => y.key === x.stageKey);
      return { key: x.stageKey, role: d?.role ?? "employee", clientApproval: d?.clientApproval, status: x.status as PlanStage["status"] };
    });
    if (advanceStage(plan)) {
      await advance(c, rc);
      return "advanced";
    }
    return "last";
  }
  return null;
}

export async function taskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const { t, rc, right } = await loadTask(c, d.taskId, d.requestId);
    if (["closed", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("الطلب منتهٍ؛ لا تُنفذ مهامه.");
    const action = d.action as TaskAction;
    if (!taskActions(t, right).includes(action)) throw new UserError("هذا الإجراء غير متاح للمهمة في حالتها الحالية.");
    const to = nextTaskStatus(t.status, action);
    if (!to) throw new UserError("هذا الإجراء غير متاح للمهمة في حالتها الحالية.");
    if ((action === "return" || action === "cancel") && d.note.length < 5) return { error: "اكتب السبب.", fieldErrors: { note: "اكتب السبب (5 أحرف على الأقل)." } };

    let note = d.note || null;
    let documentId: string | null = null;
    if (d.documentId) {
      const [doc] = await c.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d.documentId), eq(documents.requestId, rc.req.id))).limit(1);
      if (!doc) throw new UserError("المستند ليس من مستندات هذا الطلب.");
      documentId = doc.id;
    }

    if (action === "assign") {
      if (!d.userId) return { error: "اختر الموظف.", fieldErrors: { userId: "اختر الموظف." } };
      const keys = await assignableRoleKeys();
      const [emp] = await c.tx.select({ id: users.id, name: users.fullName }).from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(users.id, d.userId), eq(users.isStaff, true), eq(users.status, "active"), inArray(roles.key, keys))).limit(1);
      if (!emp) throw new UserError("اختر موظفًا يحمل دورًا تشغيليًا.");
      await c.tx.update(tasks).set({ assigneeUserId: emp.id, updatedBy: c.auth.user.id }).where(eq(tasks.id, t.id));
      await taskEvent(c.tx, { ...t, assigneeUserId: emp.id }, { action: "assign", actorId: c.auth.user.id, note: `أُسندت إلى ${emp.name ?? "موظف"}${note ? ` — ${note}` : ""}` });
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.assign", entityType: "task", entityId: t.id, waqfId: t.waqfId, ip: c.ip, userAgent: c.userAgent, before: { assignee: t.assigneeUserId }, after: { assignee: emp.id } });
      return { ok: true, message: `أُسندت المهمة إلى ${emp.name ?? "الموظف"}.` };
    }

    let stageNote: string | null = null;
    if (action === "complete") {
      const res = await completionCheck(c, t, rc);
      if (res === "advanced") stageNote = "اكتملت المرحلة وانتقل الطلب إلى المرحلة التالية";
      if (res === "last") stageNote = "آخر مرحلة عمل: تُغلق عند إرسال الطلب لمراجعة الجودة";
    }
    // advance() may already have completed this stage task through the stage sync
    const [fresh] = await c.tx.select().from(tasks).where(eq(tasks.id, t.id)).limit(1);
    if (fresh.status !== to) {
      const now = new Date();
      await c.tx.update(tasks).set({
        status: to as "todo" | "in_progress" | "done" | "cancelled", updatedBy: c.auth.user.id,
        ...(action === "start" ? { startedAt: now, startedBy: c.auth.user.id } : {}),
        ...(to === "done" ? { completedAt: now, completedBy: c.auth.user.id, progress: 100 } : {}),
        ...(to === "todo" ? { completedAt: null, completedBy: null } : {}),
      }).where(eq(tasks.id, t.id));
      note = [note, stageNote].filter(Boolean).join(" — ") || null;
      await taskEvent(c.tx, t, { action: action === "reopen" ? "reopen" : action, from: t.status, to, actorId: c.auth.user.id, note, documentId });
    } else if (documentId || note) {
      await taskEvent(c.tx, fresh, { action: documentId ? "attach" : "note", actorId: c.auth.user.id, note, documentId });
    }
    await audit(c.tx, {
      actorUserId: c.auth.user.id, action: `tasks.${action}`, entityType: "task", entityId: t.id, waqfId: t.waqfId, ip: c.ip, userAgent: c.userAgent,
      before: { status: t.status }, after: { status: to, kind: t.kind, direct: right.direct, owner: t.assigneeUserId, note: d.note || undefined },
    });
    return { ok: true, message: `${EXEC_KIND_LABEL[(t.kind ?? "stage") as ExecKind] ?? "المهمة"}: ${({ start: "بدأ التنفيذ.", complete: "أُكملت.", return: "أُعيدت للاستكمال.", cancel: "أُلغيت.", reopen: "أُعيد فتحها." } as Record<string, string>)[action]}` };
  }, { revalidate: reval(d.requestId) });
}

/** A note or an attachment on a task, without changing its status. */
export async function taskNote(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema.pick({ taskId: true, requestId: true, note: true, documentId: true }), fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.note.length < 2 && !d.documentId) return { error: "اكتب الملاحظة أو اختر المستند.", fieldErrors: { note: "مطلوب." } };
  return userAction(async (c) => {
    const { t, rc } = await loadTask(c, d.taskId, d.requestId);
    let documentId: string | null = null;
    if (d.documentId) {
      const [doc] = await c.tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d.documentId), eq(documents.requestId, rc.req.id))).limit(1);
      if (!doc) throw new UserError("المستند ليس من مستندات هذا الطلب.");
      documentId = doc.id;
    }
    await taskEvent(c.tx, t, { action: documentId ? "attach" : "note", actorId: c.auth.user.id, note: d.note || null, documentId });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.note", entityType: "task", entityId: t.id, waqfId: t.waqfId, ip: c.ip, userAgent: c.userAgent, after: { documentId } });
    return { ok: true, message: documentId ? "أُرفق المستند بالمهمة." : "أُضيفت الملاحظة." };
  }, { revalidate: reval(d.requestId) });
}

/** Requests already in execution before tasks existed: create their execution tasks (idempotent). */
export async function createExecTasks(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ requestId: uuid }), fd);
  if ("state" in r) return r.state;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, r.data.requestId, "staff");
    if (!rc.isOps && !rc.isAssignee) throw new ForbiddenError();
    if (!["in_progress", "quality_review", "awaiting_client_approval"].includes(rc.req.status)) throw new UserError("تُنشأ مهام التنفيذ عند بدء العمل.");
    const { ensureExecTasks, syncStageTasks } = await import("./exec");
    const n = await ensureExecTasks(c.tx, rc, c.auth.user.id);
    await syncStageTasks(c.tx, rc.req.id, c.auth.user.id, "مزامنة مع مراحل الطلب الحالية");
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "tasks.backfill", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { created: n } });
    return { ok: true, message: n ? `أُنشئت ${n} مهمة من مسار الطلب.` : "المهام موجودة مسبقًا." };
  }, { revalidate: reval(r.data.requestId) });
}
