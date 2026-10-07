import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, notInArray, type SQL } from "drizzle-orm";
import {
  deliverables, documents, invoices, recommendations, requestEvents, requestNotes, requestStages, roles, serviceRequests, services, userRoles, users, waqfs,
} from "@/server/db/schema";
import { ForbiddenError, type Auth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import type { Tx } from "@/server/db";
import { assignableRoleKeys, clientRequestFilter, contractState, loadRequestCtx, memberWaqfIdsWith, staffRequestFilter } from "./access";
import { availableTransitions, type RequestStatus } from "./workflow";
import { readSetting } from "./catalog";

const listCols = {
  id: serviceRequests.id,
  number: serviceRequests.number,
  status: serviceRequests.status,
  priority: serviceRequests.priority,
  waqfId: serviceRequests.waqfId,
  waqfName: waqfs.name,
  serviceCode: services.code,
  serviceName: services.nameAr,
  requesterId: serviceRequests.requesterUserId,
  requesterName: users.fullName,
  assignedToUserId: serviceRequests.assignedToUserId,
  slaDueAt: serviceRequests.slaDueAt,
  conflictCheck: serviceRequests.conflictCheck,
  submittedAt: serviceRequests.submittedAt,
  updatedAt: serviceRequests.updatedAt,
  currentStageKey: serviceRequests.currentStageKey,
};

function baseList(tx: Tx) {
  return tx
    .select(listCols)
    .from(serviceRequests)
    .innerJoin(services, eq(services.id, serviceRequests.serviceId))
    .leftJoin(waqfs, eq(waqfs.id, serviceRequests.waqfId))
    .leftJoin(users, eq(users.id, serviceRequests.requesterUserId));
}
export type RequestListRow = Awaited<ReturnType<typeof baseList>>[number];

/** Client side: my requests (requester) and requests of waqfs where my membership grants requests.view. */
export async function listClientRequests(auth: Auth, opts: { waqfId?: string } = {}) {
  return read(auth, async (tx) => {
    const f = await clientRequestFilter(tx, auth);
    const conds: SQL[] = [f];
    if (opts.waqfId) conds.push(eq(serviceRequests.waqfId, opts.waqfId));
    return (await baseList(tx).where(and(...conds)).orderBy(desc(serviceRequests.updatedAt)).limit(300));
  });
}

export type QueueTab = "mine" | "all" | "unassigned" | "overdue" | "awaiting_client" | "quality";
export const QUEUE_TABS: { key: QueueTab; label: string; opsOnly?: boolean }[] = [
  { key: "mine", label: "المسندة إليّ" },
  { key: "all", label: "كل الطلبات المفتوحة", opsOnly: true },
  { key: "unassigned", label: "غير مسندة", opsOnly: true },
  { key: "overdue", label: "متأخرة عن المهلة" },
  { key: "awaiting_client", label: "بانتظار العميل" },
  { key: "quality", label: "مراجعة الجودة" },
];
const CLOSED: RequestStatus[] = ["closed", "cancelled", "rejected"];

/** Staff queue. Non-ops staff see ONLY requests assigned to them, whatever the tab. */
export async function staffQueue(auth: Auth, tab: QueueTab, q?: string) {
  return read(auth, async (tx) => {
    const conds: (SQL | undefined)[] = [staffRequestFilter(auth)];
    const ops = auth.perms.has("admin.requests.all");
    switch (tab) {
      case "mine":
        conds.push(eq(serviceRequests.assignedToUserId, auth.user.id), notInArray(serviceRequests.status, CLOSED));
        break;
      case "all":
        conds.push(notInArray(serviceRequests.status, CLOSED));
        break;
      case "unassigned":
        conds.push(isNull(serviceRequests.assignedToUserId), notInArray(serviceRequests.status, CLOSED));
        break;
      case "overdue":
        conds.push(lt(serviceRequests.slaDueAt, new Date()), notInArray(serviceRequests.status, [...CLOSED, "completed", "on_hold", "awaiting_client", "quote", "awaiting_contract", "awaiting_client_approval"]));
        break;
      case "awaiting_client":
        conds.push(inArray(serviceRequests.status, ["awaiting_client", "quote", "awaiting_contract", "awaiting_client_approval"]));
        break;
      case "quality":
        conds.push(eq(serviceRequests.status, "quality_review"));
        break;
    }
    if (!ops && (tab === "all" || tab === "unassigned")) return [];
    let rows = (await baseList(tx).where(and(...conds)).orderBy(asc(serviceRequests.slaDueAt), desc(serviceRequests.updatedAt)).limit(300));
    if (q?.trim()) {
      const s = q.trim().toLowerCase();
      rows = rows.filter((r) => [r.number, r.serviceName, r.waqfName, r.requesterName, r.serviceCode].some((x) => x?.toLowerCase().includes(s)));
    }
    return rows;
  });
}

export async function queueCounts(auth: Auth) {
  const tabs: QueueTab[] = ["mine", "unassigned", "overdue", "awaiting_client", "quality"];
  const out: Partial<Record<QueueTab, number>> = {};
  for (const t of tabs) out[t] = (await staffQueue(auth, t)).length;
  return out;
}

/** Staff users eligible for assignment (global role granting staff.requests.assigned). */
export async function assignableStaff(auth: Auth) {
  const keys = await assignableRoleKeys();
  return read(auth, async (tx) => {
    const rows = await tx
      .select({ id: users.id, name: users.fullName, role: roles.key, roleName: roles.nameAr })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.isStaff, true), eq(users.status, "active"), inArray(roles.key, keys)));
    const m = new Map<string, { id: string; name: string; roles: string[] }>();
    for (const r of rows) {
      const e = m.get(r.id) ?? { id: r.id, name: r.name ?? "موظف", roles: [] };
      e.roles.push(r.roleName ?? r.role);
      m.set(r.id, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  });
}

/** Full request view. `side` decides isolation and which notes are visible (internal notes are staff-only). */
export async function requestDetail(auth: Auth, id: string, side: "client" | "staff") {
  return read(auth, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, id, side);
    } catch (e) {
      if (e instanceof ForbiddenError) return null;
      throw e;
    }
    const stages = await tx.select().from(requestStages).where(eq(requestStages.requestId, id)).orderBy(asc(requestStages.position));
    const events = await tx.select().from(requestEvents).where(eq(requestEvents.requestId, id)).orderBy(desc(requestEvents.at));
    const notes = await tx
      .select()
      .from(requestNotes)
      .where(side === "client" ? and(eq(requestNotes.requestId, id), eq(requestNotes.visibility, "client")) : eq(requestNotes.requestId, id))
      .orderBy(asc(requestNotes.createdAt));
    const dels = await tx.select().from(deliverables).where(eq(deliverables.requestId, id)).orderBy(desc(deliverables.createdAt));
    const docs = await tx.select({ id: documents.id, title: documents.title, confidentiality: documents.confidentiality }).from(documents).where(and(eq(documents.requestId, id), isNull(documents.archivedAt)));
    const cs = await contractState(tx, id);
    const invs = await tx.select().from(invoices).where(eq(invoices.requestId, id)).orderBy(desc(invoices.createdAt));
    const ids = new Set<string>([rc.req.requesterUserId, ...(rc.req.assignedToUserId ? [rc.req.assignedToUserId] : [])]);
    for (const e of events) if (e.actorUserId) ids.add(e.actorUserId);
    for (const n of notes) ids.add(n.authorId);
    for (const s of cs.signatures) ids.add(s.userId);
    const people = ids.size ? await tx.select({ id: users.id, name: users.fullName, isStaff: users.isStaff, phone: users.phone }).from(users).where(inArray(users.id, [...ids])) : [];
    const names = new Map(people.map((p) => [p.id, { name: p.name ?? "مستخدم", isStaff: p.isStaff }]));
    const requester = people.find((p) => p.id === rc.req.requesterUserId);
    const transitions = availableTransitions(rc.req.status as RequestStatus, rc.actors, { resumeTo: rc.resumeTo });
    const vatRate = Number(await readSetting<number>(tx, "requests.default_vat_rate", 15)) || 15;
    return { rc, stages, events, notes, deliverables: dels, docs, contract: cs, invoices: invs, names, requesterPhone: requester?.phone ?? null, transitions, vatRate };
  });
}
export type RequestDetail = NonNullable<Awaited<ReturnType<typeof requestDetail>>>;

/** Waqfs where my membership allows requesting services. */
export async function requestableWaqfs(auth: Auth) {
  return read(auth, async (tx) => {
    const ids = await memberWaqfIdsWith(tx, auth, "requests.create");
    if (!ids.length) return [];
    return tx.select({ id: waqfs.id, name: waqfs.name, number: waqfs.internalNumber, waqfakRole: waqfs.waqfakRole }).from(waqfs).where(inArray(waqfs.id, ids)).orderBy(asc(waqfs.name));
  });
}

export async function recommendationForPrefill(auth: Auth, recId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(recId)) return null;
  return read(auth, async (tx) => {
    const [r] = await tx.select().from(recommendations).where(eq(recommendations.id, recId)).limit(1);
    if (!r) return null;
    // RLS hides other waqfs' recommendations; for waqf-less ones require membership-level access anyway
    if (r.waqfId) {
      const ok = (await memberWaqfIdsWith(tx, auth, "requests.create")).includes(r.waqfId);
      if (!ok) return null;
    }
    return r;
  });
}
