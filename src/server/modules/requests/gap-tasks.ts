import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { tasks } from "@/server/db/schema";
import { taskEvent } from "@/server/modules/operations/exec";
import { todayISO } from "@/server/engines/dates";
import { contextFor } from "./context/map";
import { resolveContext } from "./context/resolve";
import { periodFor } from "./context/types";
import { gapTasksFor } from "./gap-tasks-pure";
import type { Answers } from "./intake/engine";

type Req = { id: string; number: string; waqfId: string | null; assignedToUserId: string | null; priority: string };

/**
 * At submission: one internal task per waqf-file record the service needs that is missing or stale — only for gaps,
 * never for what is on record — tied to the record (field key `ctx:<block>`). Idempotent: a record that already has a
 * task gets none.
 */
export async function ensureGapTasks(tx: Tx, req: Req, serviceCode: string, answers: Answers, actorId: string) {
  const keys = req.waqfId ? contextFor(serviceCode) : [];
  if (!keys.length) return 0;
  const blocks = await resolveContext(tx, req.waqfId!, keys, periodFor(answers, todayISO()), { serviceCode, requestId: req.id });
  const planned = gapTasksFor(blocks);
  if (!planned.length) return 0;
  const existing = new Set((await tx.select({ f: tasks.fieldKey }).from(tasks).where(and(eq(tasks.requestId, req.id), inArray(tasks.fieldKey, planned.map((p) => p.fieldKey))))).map((x) => x.f));
  const fresh = planned.filter((p) => !existing.has(p.fieldKey));
  if (!fresh.length) return 0;
  const rows = await tx.insert(tasks).values(fresh.map((p) => ({
    waqfId: req.waqfId, requestId: req.id, sourceType: "request", sourceId: req.id, fieldKey: p.fieldKey, // identified by the field, not an exec kind (one exec task per kind)
    title: p.title, description: `${req.number}\n${p.description}`, assigneeUserId: req.assignedToUserId, priority: req.priority,
    status: "todo" as const, visibility: "internal" as const, createdBy: actorId, updatedBy: actorId,
  }))).returning();
  for (const t of rows) await taskEvent(tx, t, { action: "create", to: t.status, actorId, note: "أُنشئت آليًا لنقص في ملف الوقف عند إرسال الطلب" });
  return rows.length;
}
