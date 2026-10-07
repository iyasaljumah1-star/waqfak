import "server-only";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  contracts, contractSignatures, deliverables, requestEvents, serviceRequests, services, waqfMemberships, waqfs, workflowTemplates,
} from "@/server/db/schema";
import { ForbiddenError, loadWaqfAccess, rolePermissionMap, type Auth } from "@/server/authz/context";
import { actorsFor, type Actor, type RequestStatus } from "./workflow";

/**
 * Request isolation (non-negotiable). RLS returns rows with waqf_id NULL to everyone and gives assigned
 * staff the whole waqf, so EVERY request query and action applies this app-level rule as well:
 *   client side → requester = me, or a waqf member whose *membership* grants requests.view
 *   staff side  → admin.requests.all, or assignedToUserId = me (with staff.requests.assigned)
 */

/** Waqf ids where my membership roles (not staff assignment) grant `perm`. */
export async function memberWaqfIdsWith(tx: Tx, auth: Auth, perm: string): Promise<string[]> {
  const rows = await tx
    .select({ waqfId: waqfMemberships.waqfId, roleKey: waqfMemberships.roleKey, endsAt: waqfMemberships.endsAt })
    .from(waqfMemberships)
    .where(and(eq(waqfMemberships.userId, auth.user.id), eq(waqfMemberships.status, "active")));
  const map = await rolePermissionMap();
  const now = new Date();
  const ids = new Set<string>();
  const agentWaqfs: string[] = [];
  for (const r of rows) {
    if (r.endsAt && r.endsAt <= now) continue;
    if (r.roleKey === "agent") agentWaqfs.push(r.waqfId);
    else if (map.get(r.roleKey)?.has(perm)) ids.add(r.waqfId);
  }
  for (const w of agentWaqfs) {
    if (ids.has(w)) continue;
    const a = await loadWaqfAccess(tx, auth, w); // applies the power-of-attorney scope
    if (a?.delegation && a.perms.has(perm)) ids.add(w);
  }
  return [...ids];
}

export async function memberCan(tx: Tx, auth: Auth, waqfId: string, perm: string) {
  return (await memberWaqfIdsWith(tx, auth, perm)).includes(waqfId);
}

/** SQL condition for the client-side request list. */
export async function clientRequestFilter(tx: Tx, auth: Auth) {
  const viewable = await memberWaqfIdsWith(tx, auth, "requests.view");
  return viewable.length ? or(eq(serviceRequests.requesterUserId, auth.user.id), inArray(serviceRequests.waqfId, viewable))! : eq(serviceRequests.requesterUserId, auth.user.id);
}

/** SQL condition for the staff-side request list. */
export function staffRequestFilter(auth: Auth) {
  if (auth.perms.has("admin.requests.all")) return undefined;
  return eq(serviceRequests.assignedToUserId, auth.user.id);
}

export type RequestCtx = {
  req: typeof serviceRequests.$inferSelect;
  service: typeof services.$inferSelect;
  waqf: { id: string; name: string; waqfakRole: string; sizeClass: string | null } | null;
  workflowCode: string;
  stagesDef: { key: string; name: string; slaDays: number; role: string; clientApproval?: boolean }[];
  isRequester: boolean;
  memberView: boolean;
  memberCreate: boolean;
  memberSign: boolean;
  isAssignee: boolean;
  isOps: boolean;
  clientSide: boolean;
  staffSide: boolean;
  deliverers: string[];
  actors: Actor[];
  resumeTo: RequestStatus | null;
};

/** Loads a request with the caller's capacities. Throws ForbiddenError when the caller may not see it from `side`. */
export async function loadRequestCtx(tx: Tx, auth: Auth, id: string, side: "client" | "staff" | "any" = "any"): Promise<RequestCtx> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ForbiddenError("الطلب غير موجود أو لا تملك صلاحية عرضه.");
  const [row] = await tx
    .select({ req: serviceRequests, service: services })
    .from(serviceRequests)
    .innerJoin(services, eq(services.id, serviceRequests.serviceId))
    .where(eq(serviceRequests.id, id))
    .limit(1);
  if (!row) throw new ForbiddenError("الطلب غير موجود أو لا تملك صلاحية عرضه.");
  const { req, service } = row;
  const isRequester = req.requesterUserId === auth.user.id;
  let memberView = false, memberCreate = false, memberSign = false;
  let waqf: RequestCtx["waqf"] = null;
  if (req.waqfId) {
    const [w] = await tx.select({ id: waqfs.id, name: waqfs.name, waqfakRole: waqfs.waqfakRole, sizeClass: waqfs.sizeClass }).from(waqfs).where(eq(waqfs.id, req.waqfId)).limit(1);
    waqf = w ?? null;
    memberView = await memberCan(tx, auth, req.waqfId, "requests.view");
    memberCreate = await memberCan(tx, auth, req.waqfId, "requests.create");
    memberSign = await memberCan(tx, auth, req.waqfId, "contracts.sign");
  }
  const isOps = auth.isStaff && auth.perms.has("admin.requests.all");
  const isAssignee = auth.isStaff && req.assignedToUserId === auth.user.id && auth.perms.has("staff.requests.assigned");
  const clientSide = isRequester || memberView;
  const staffSide = isOps || isAssignee;
  if ((side === "client" && !clientSide) || (side === "staff" && !staffSide) || (side === "any" && !clientSide && !staffSide))
    throw new ForbiddenError("الطلب غير موجود أو لا تملك صلاحية عرضه.");

  const [wf] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.code, service.workflowTemplateCode)).limit(1);
  const deliverers = await loadDeliverers(tx, req.id);
  const actors = actorsFor({ userId: auth.user.id, isRequester, memberCanCreate: memberCreate, isAssignee, perms: auth.isStaff ? auth.perms : new Set(), deliverers });
  // Client capacities apply only from the client side; staff capacities only from the staff side.
  const sided = side === "client" ? actors.filter((a) => a === "client") : side === "staff" ? actors.filter((a) => a !== "client") : actors;
  let resumeTo: RequestStatus | null = null;
  if (req.status === "on_hold") {
    const [ev] = await tx.select({ from: requestEvents.fromStatus }).from(requestEvents)
      .where(and(eq(requestEvents.requestId, req.id), eq(requestEvents.toStatus, "on_hold"))).orderBy(desc(requestEvents.at)).limit(1);
    resumeTo = (ev?.from as RequestStatus) ?? "triage";
  }
  return {
    req, service, waqf, workflowCode: wf?.code ?? service.workflowTemplateCode, stagesDef: wf?.stages ?? [],
    isRequester, memberView, memberCreate, memberSign, isAssignee, isOps, clientSide, staffSide, deliverers, actors: sided, resumeTo,
  };
}

/** Users who produced the work: authors of submitted deliverables and whoever sent it to QA. */
export async function loadDeliverers(tx: Tx, requestId: string): Promise<string[]> {
  const d = await tx.select({ by: deliverables.createdBy }).from(deliverables).where(and(eq(deliverables.requestId, requestId), isNotNull(deliverables.createdBy)));
  const e = await tx.select({ by: requestEvents.actorUserId }).from(requestEvents).where(and(eq(requestEvents.requestId, requestId), eq(requestEvents.toStatus, "quality_review")));
  return [...new Set([...d.map((x) => x.by!), ...e.map((x) => x.by).filter((x): x is string => !!x)])];
}

export async function contractState(tx: Tx, requestId: string) {
  const [c] = await tx.select().from(contracts).where(and(eq(contracts.requestId, requestId), inArray(contracts.status, ["sent", "signed"]))).orderBy(desc(contracts.createdAt)).limit(1);
  if (!c) return { contract: null, clientSigned: false, companySigned: false, signatures: [] as (typeof contractSignatures.$inferSelect)[] };
  const sigs = await tx.select().from(contractSignatures).where(eq(contractSignatures.contractId, c.id));
  return {
    contract: c,
    clientSigned: sigs.some((s) => s.method === "otp"),
    companySigned: sigs.some((s) => s.method === "company_countersign"),
    signatures: sigs,
  };
}

/** Global roles that grant staff.requests.assigned (who can be assigned requests). */
export async function assignableRoleKeys() {
  const map = await rolePermissionMap();
  return [...map.entries()].filter(([, p]) => p.has("staff.requests.assigned")).map(([k]) => k);
}
