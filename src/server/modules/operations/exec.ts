import "server-only";
import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { requestStages, taskEvents, tasks } from "@/server/db/schema";
import type { TaskEventAction } from "@/server/db/schema/operations";
import type { RequestCtx } from "@/server/modules/requests/access";
import { outputsFor } from "@/server/modules/outputs/catalog";
import { intakeTask, planExecTasks, type ExecKind, type PlannedTask } from "./exec-pure";

/**
 * Request execution tasks: creation (idempotent — a unique index on request/kind/stage/output makes retries and
 * refreshes harmless) and the synchronization rules with the records they mirror:
 *  - intake task       ← completed when the request is accepted for service; cancelled with the request.
 *  - stage tasks       ← created when work starts; completed when their stage is completed (either way);
 *                        the last work stage task reopens when the work comes back from review or the client.
 *  - prepare_output    ← completed when the output is submitted for review; reopened when the output is returned.
 *  - review_output     ← completed only by approving the output.
 * Every change writes a task event (append-only) with the actor and the assignee at that moment.
 */

type Req = { id: string; number: string; waqfId: string | null; assignedToUserId: string | null; priority: string };
type TaskRow = typeof tasks.$inferSelect;

export async function taskEvent(tx: Tx, t: Pick<TaskRow, "id" | "waqfId" | "requestId" | "assigneeUserId">, e: { action: TaskEventAction; from?: string | null; to?: string | null; actorId: string | null; note?: string | null; documentId?: string | null; outputId?: string | null }) {
  await tx.insert(taskEvents).values({
    taskId: t.id, waqfId: t.waqfId, requestId: t.requestId, action: e.action, fromStatus: e.from ?? null, toStatus: e.to ?? null,
    actorUserId: e.actorId, ownerUserId: t.assigneeUserId, direct: !!e.actorId && e.actorId !== t.assigneeUserId,
    note: e.note ?? null, documentId: e.documentId ?? null, outputId: e.outputId ?? null,
  });
}

async function insertPlanned(tx: Tx, req: Req, planned: PlannedTask[], actorId: string, dueByStage: Map<string, string | null>) {
  if (!planned.length) return 0;
  const rows = await tx
    .insert(tasks)
    .values(planned.map((p) => ({
      waqfId: req.waqfId, requestId: req.id, sourceType: "request", sourceId: req.id, kind: p.kind, stageKey: p.stageKey, outputKey: p.outputKey,
      title: p.title, description: req.number, assigneeUserId: req.assignedToUserId, priority: req.priority, visibility: "internal",
      dueOn: p.stageKey ? dueByStage.get(p.stageKey) ?? null : null, createdBy: actorId, updatedBy: actorId,
    })))
    .onConflictDoNothing()
    .returning();
  for (const t of rows) await taskEvent(tx, t, { action: "create", to: t.status, actorId, note: "أُنشئت من مسار الطلب" });
  return rows.length;
}

export async function ensureIntakeTask(tx: Tx, req: Req, actorId: string) {
  return insertPlanned(tx, req, [intakeTask()], actorId, new Map());
}

/** Creates the execution tasks of a request (no-op for the ones that exist). */
export async function ensureExecTasks(tx: Tx, rc: RequestCtx, actorId: string) {
  const stages = await tx.select({ key: requestStages.stageKey, due: requestStages.slaDueAt }).from(requestStages).where(eq(requestStages.requestId, rc.req.id));
  const due = new Map(stages.map((s) => [s.key, s.due ? s.due.toISOString().slice(0, 10) : null]));
  const planned = planExecTasks(rc.stagesDef, outputsFor(rc.service));
  return insertPlanned(tx, rc.req, planned, actorId, due);
}

async function findTask(tx: Tx, requestId: string, kind: ExecKind, key?: { stageKey?: string | null; outputKey?: string | null }) {
  const conds = [eq(tasks.requestId, requestId), eq(tasks.kind, kind)];
  if (key?.stageKey) conds.push(eq(tasks.stageKey, key.stageKey));
  if (key?.outputKey) conds.push(eq(tasks.outputKey, key.outputKey));
  const [t] = await tx.select().from(tasks).where(and(...conds)).limit(1);
  return t ?? null;
}

/** Moves a linked task to `to` because its record changed (system rule), recording the actor who caused it. */
export async function syncTask(tx: Tx, requestId: string, kind: ExecKind, key: { stageKey?: string | null; outputKey?: string | null } | undefined, to: "done" | "todo" | "cancelled" | "in_progress", actorId: string, note: string) {
  const t = await findTask(tx, requestId, kind, key);
  if (!t || t.status === to) return null;
  if (to === "done" && t.status === "cancelled") return null;
  const now = new Date();
  await tx.update(tasks).set({
    status: to, updatedBy: actorId,
    completedAt: to === "done" ? now : null, completedBy: to === "done" ? actorId : null, progress: to === "done" ? 100 : t.progress,
    ...(to === "in_progress" && !t.startedAt ? { startedAt: now, startedBy: actorId } : {}),
  }).where(eq(tasks.id, t.id));
  await taskEvent(tx, t, { action: to === "done" ? "complete" : to === "cancelled" ? "cancel" : to === "todo" ? "reopen" : "start", from: t.status, to, actorId, note });
  return t.id;
}

/** Cancels the request's open tasks (request cancelled or rejected). */
export async function cancelOpenTasks(tx: Tx, requestId: string, actorId: string, note: string) {
  const open = await tx.select().from(tasks).where(and(eq(tasks.requestId, requestId), inArray(tasks.status, ["todo", "in_progress"])));
  for (const t of open) {
    await tx.update(tasks).set({ status: "cancelled", updatedBy: actorId }).where(eq(tasks.id, t.id));
    await taskEvent(tx, t, { action: "cancel", from: t.status, to: "cancelled", actorId, note });
  }
}

/** On reassignment of the request, open tasks held by the previous assignee (or unassigned) follow the request. */
export async function moveOpenTasks(tx: Tx, requestId: string, from: string | null, to: string, actorId: string) {
  const open = await tx.select().from(tasks).where(and(eq(tasks.requestId, requestId), inArray(tasks.status, ["todo", "in_progress"])));
  for (const t of open.filter((x) => x.assigneeUserId === from || !x.assigneeUserId)) {
    await tx.update(tasks).set({ assigneeUserId: to, updatedBy: actorId }).where(eq(tasks.id, t.id));
    await taskEvent(tx, { ...t, assigneeUserId: to }, { action: "assign", actorId, note: "انتقلت مع إسناد الطلب" });
  }
}

/**
 * Stage tasks follow the stage plan: a completed stage completes its task; with `reopen` (work returned from quality
 * review or from the client) the task of the reactivated stage is reopened.
 */
export async function syncStageTasks(tx: Tx, requestId: string, actorId: string, note: string, opts: { reopen?: boolean } = {}) {
  const [stages, stageTasks] = await Promise.all([
    tx.select({ key: requestStages.stageKey, status: requestStages.status }).from(requestStages).where(eq(requestStages.requestId, requestId)).orderBy(asc(requestStages.position)),
    tx.select().from(tasks).where(and(eq(tasks.requestId, requestId), eq(tasks.kind, "stage"))),
  ]);
  for (const t of stageTasks) {
    const s = stages.find((x) => x.key === t.stageKey);
    if (!s || t.status === "cancelled") continue;
    if (s.status === "done" && t.status !== "done") await syncTask(tx, requestId, "stage", { stageKey: t.stageKey }, "done", actorId, note);
    if (opts.reopen && s.status === "active" && t.status === "done") await syncTask(tx, requestId, "stage", { stageKey: t.stageKey }, "todo", actorId, note);
  }
}

export async function openTaskCount(tx: Tx, requestId: string) {
  const rows = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.requestId, requestId), notInArray(tasks.status, ["done", "cancelled"]), isNull(tasks.completedAt)));
  return rows.length;
}
