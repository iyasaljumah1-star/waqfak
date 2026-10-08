import "server-only";
import { and, asc, desc, eq, isNull, notInArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../../db";
import { resolutions, serviceRequests, taskComments, tasks, users, waqfMemberships, waqfs } from "../../db/schema";
import { roleName } from "../../authz/catalog";
import { canSeeTask } from "./pure";

const assignee = alias(users, "assignee");

const taskCols = {
  t: tasks,
  assigneeName: assignee.fullName,
};

/** Active waqf members (deduplicated) as assignee options, with their roles. */
export async function assignableMembers(tx: Tx, waqfId: string) {
  const rows = await tx
    .select({ id: users.id, name: users.fullName, role: waqfMemberships.roleKey })
    .from(waqfMemberships)
    .innerJoin(users, eq(users.id, waqfMemberships.userId))
    .where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.status, "active")));
  const map = new Map<string, { id: string; name: string; roles: string[] }>();
  for (const r of rows) {
    if (r.role === "beneficiary") continue; // beneficiaries are not assigned waqf work
    const m = map.get(r.id) ?? { id: r.id, name: r.name ?? "عضو", roles: [] };
    m.roles.push(roleName(r.role));
    map.set(r.id, m);
  }
  const staff = await tx
    .selectDistinct({ id: users.id, name: users.fullName })
    .from(serviceRequests)
    .innerJoin(users, eq(users.id, serviceRequests.assignedToUserId))
    .where(and(eq(serviceRequests.waqfId, waqfId), notInArray(serviceRequests.status, ["closed", "cancelled", "rejected"])));
  for (const s of staff) if (!map.has(s.id)) map.set(s.id, { id: s.id, name: s.name ?? "موظف", roles: ["فريق وقفك"] });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export async function waqfTasks(tx: Tx, waqfId: string, me: { id: string; isStaff: boolean }) {
  const rows = await tx
    .select(taskCols)
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeUserId))
    .where(eq(tasks.waqfId, waqfId))
    .orderBy(asc(tasks.dueOn), desc(tasks.createdAt))
    .limit(500);
  return rows.filter((r) => canSeeTask(r.t, me));
}

export async function taskDetail(tx: Tx, waqfId: string, taskId: string, me: { id: string; isStaff: boolean }) {
  const [row] = await tx
    .select(taskCols)
    .from(tasks)
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeUserId))
    .where(and(eq(tasks.id, taskId), eq(tasks.waqfId, waqfId)))
    .limit(1);
  if (!row || !canSeeTask(row.t, me)) return null;
  const comments = await tx
    .select({ id: taskComments.id, body: taskComments.body, createdAt: taskComments.createdAt, authorId: taskComments.authorId, author: users.fullName, authorStaff: users.isStaff })
    .from(taskComments)
    .leftJoin(users, eq(users.id, taskComments.authorId))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));
  const [creator] = row.t.createdBy ? await tx.select({ name: users.fullName }).from(users).where(eq(users.id, row.t.createdBy)).limit(1) : [];
  let source: { label: string; href: string | null } | null = null;
  if (row.t.sourceType === "resolution" && row.t.sourceId) {
    const [r] = await tx.select({ number: resolutions.number, meetingId: resolutions.meetingId }).from(resolutions).where(eq(resolutions.id, row.t.sourceId)).limit(1);
    if (r) source = { label: `القرار ${r.number}`, href: r.meetingId ? `/app/w/${waqfId}/governance/meetings/${r.meetingId}` : `/app/w/${waqfId}/governance#resolutions` };
  } else if (row.t.sourceType === "request" && (row.t.requestId || row.t.sourceId)) {
    const rid = row.t.requestId ?? row.t.sourceId!;
    const [r] = await tx.select({ number: serviceRequests.number }).from(serviceRequests).where(eq(serviceRequests.id, rid)).limit(1);
    if (r) source = { label: `الطلب ${r.number}`, href: `/app/requests/${rid}` };
  } else if (row.t.sourceType === "assessment") {
    source = { label: "خطة عمل التقييم", href: `/app/w/${waqfId}/assessments` };
  } else if (row.t.sourceType === "compliance") {
    source = { label: "الحوكمة والامتثال", href: `/app/w/${waqfId}/governance#policies` };
  }
  return { ...row, comments, creator: creator?.name ?? null, source };
}

/** Tasks assigned to me (or created by me without an assignee) across every waqf I can reach. */
export async function myTasks(tx: Tx, me: { id: string; isStaff: boolean }) {
  const rows = await tx
    .select({ t: tasks, waqfName: waqfs.name, assigneeName: assignee.fullName })
    .from(tasks)
    .leftJoin(waqfs, eq(waqfs.id, tasks.waqfId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeUserId))
    .where(or(eq(tasks.assigneeUserId, me.id), and(isNull(tasks.assigneeUserId), eq(tasks.createdBy, me.id))))
    .orderBy(asc(tasks.dueOn), desc(tasks.createdAt))
    .limit(500);
  return rows.filter((r) => canSeeTask(r.t, me));
}

export async function taskById(tx: Tx, taskId: string) {
  const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return t ?? null;
}

