import "server-only";
import { and, asc, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import type { Auth } from "@/server/authz/context";
import { outputs, outputVersions, taskEvents, tasks, users, waqfMemberships, waqfs } from "@/server/db/schema";
import type { RequestCtx } from "@/server/modules/requests/access";
import { outputsFor, PROFILE_FORMAT, REVIEW_LABEL, SPECIALTY_LABEL } from "@/server/modules/outputs/catalog";
import { readiness } from "@/server/modules/outputs/pure";
import { executeRight, taskActions } from "./exec-pure";
import { linksOfRequest } from "./links";

/** Everything the staff request page needs about execution: tasks (with rights), outputs, links, linkable waqfs. */
export async function requestOperations(tx: Tx, auth: Auth, rc: RequestCtx) {
  const reqId = rc.req.id;
  const [taskRows, events, outRows, links] = await Promise.all([
    tx.select().from(tasks).where(eq(tasks.requestId, reqId)).orderBy(asc(tasks.createdAt)),
    tx.select().from(taskEvents).where(eq(taskEvents.requestId, reqId)).orderBy(desc(taskEvents.at)),
    tx.select().from(outputs).where(eq(outputs.requestId, reqId)).orderBy(asc(outputs.createdAt)),
    linksOfRequest(tx, reqId),
  ]);
  const curVersions = outRows.length
    ? await tx.select({ outputId: outputVersions.outputId, version: outputVersions.version, gaps: outputVersions.gaps, sections: outputVersions.sections, origin: outputVersions.origin, at: outputVersions.createdAt })
        .from(outputVersions).where(inArray(outputVersions.outputId, outRows.map((o) => o.id)))
    : [];
  const order = (k: string | null) => ({ intake: 0, stage: 1, prepare_output: 2, review_output: 3 } as Record<string, number>)[k ?? ""] ?? 4;
  const taskList = taskRows.sort((a, b) => order(a.kind) - order(b.kind)).map((t) => {
    const right = executeRight({ isStaff: auth.isStaff, perms: auth.perms, userId: auth.user.id, taskAssignee: t.assigneeUserId, requestAssignee: rc.req.assignedToUserId });
    const terminal = ["closed", "cancelled", "rejected"].includes(rc.req.status);
    return { ...t, right, actions: terminal ? [] : taskActions(t, right), events: events.filter((e) => e.taskId === t.id) };
  });
  const defs = outputsFor(rc.service);
  const outputList = defs.map((def) => {
    const o = outRows.find((x) => x.outputKey === def.key) ?? null;
    const v = o ? curVersions.find((x) => x.outputId === o.id && x.version === o.currentVersion) : null;
    const ready = v ? readiness(v.sections, v.gaps) : null;
    return {
      def, specialtyLabel: SPECIALTY_LABEL[def.specialty], reviewLabel: REVIEW_LABEL[def.review], formatLabel: PROFILE_FORMAT[def.profile], o,
      delivered: o?.status === "approved" && !!o.documentId && ["awaiting_client_approval", "completed", "closed"].includes(rc.req.status),
      version: v ? { version: v.version, origin: v.origin, at: v.at } : null,
      blocking: ready?.blocking.length ?? 0, unwritten: ready?.unwritten.length ?? 0, warnings: ready?.warnings.length ?? 0,
    };
  });
  // Waqfs the requester holds a role in (for linking a request sent with no waqf)
  const requesterWaqfs = rc.req.waqfId ? [] : await tx
    .select({ id: waqfs.id, name: waqfs.name, role: waqfMemberships.roleKey })
    .from(waqfMemberships).innerJoin(waqfs, eq(waqfs.id, waqfMemberships.waqfId))
    .where(and(eq(waqfMemberships.userId, rc.req.requesterUserId), eq(waqfMemberships.status, "active"), notInArray(waqfMemberships.roleKey, ["beneficiary"]), isNull(waqfs.archivedAt)));
  const ids = [...new Set([...taskRows.flatMap((t) => [t.assigneeUserId, t.completedBy, t.startedBy]), ...events.flatMap((e) => [e.actorUserId, e.ownerUserId]), ...outRows.flatMap((o) => [o.approvedBy, o.submittedBy])].filter((x): x is string => !!x))];
  const people = ids.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
  return { tasks: taskList, outputs: outputList, links, requesterWaqfs, people: new Map(people.map((p) => [p.id, p.name ?? "—"])) };
}
