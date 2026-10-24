import "server-only";
import { and, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { withContext, withSystem, type DbContext, type Tx } from "../db";
import {
  breakGlassAccess,
  delegations, permissions, rolePermissions, roles, serviceRequests, userRoles, waqfMemberships, waqfs,
} from "../db/schema";
import { readSession, type SessionRow, type UserRow } from "../auth/session";
import { ESTABLISHING_FOUNDER_PERMS, ESTABLISHING_STATUSES, ROLES, STAFF_ASSIGNED_WAQF_PERMS, STAFF_WAQF_EDIT_PERMS, type Permission } from "./catalog";

const BREAK_GLASS_PERMS: Permission[] = ["waqf.view", "deed.view", "assets.view", "finance.view", "finance.summary", "statements.view", "beneficiaries.view", "governance.view", "documents.view", "compliance.view", "assessment.view", "requests.view", "audit.view_waqf"];

// ───────────── role → permission map (DB is the source of truth; cached briefly) ─────────────
let roleCache: { at: number; map: Map<string, Set<string>> } | null = null;

export async function rolePermissionMap(): Promise<Map<string, Set<string>>> {
  if (roleCache && Date.now() - roleCache.at < 60_000) return roleCache.map;
  const rows = await withSystem((tx) =>
    tx
      .select({ role: roles.key, perm: permissions.key })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)),
  );
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.role)) map.set(r.role, new Set());
    map.get(r.role)!.add(r.perm);
  }
  // Fallback to the code catalog for roles not yet seeded.
  for (const [key, def] of Object.entries(ROLES)) if (!map.has(key)) map.set(key, new Set(def.permissions));
  roleCache = { at: Date.now(), map };
  return map;
}
export const invalidateRoleCache = () => {
  roleCache = null;
};

export type Auth = {
  user: UserRow;
  session: SessionRow;
  globalRoles: string[];
  perms: Set<string>;
  globalAccess: boolean;
  isStaff: boolean;
  db: DbContext;
};

export const getAuth = cache(async (): Promise<Auth | null> => {
  const s = await readSession();
  if (!s) return null;
  const grs = await withSystem((tx) =>
    tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, s.user.id)),
  );
  const globalRoles = grs.map((r) => r.key);
  const map = await rolePermissionMap();
  const perms = new Set<string>();
  for (const r of globalRoles) for (const p of map.get(r) ?? []) perms.add(p);
  const globalAccess = globalRoles.some((r) => ROLES[r]?.globalAccess);
  return {
    user: s.user,
    session: s.session,
    globalRoles,
    perms,
    globalAccess,
    isStaff: s.user.isStaff || globalRoles.length > 0,
    db: { userId: s.user.id, globalAccess, mlro: false, roles: globalRoles },
  };
});

/** For pages and actions that need a signed-in, fully verified user. */
export async function requireAuth(opts: { next?: string } = {}): Promise<Auth> {
  const auth = await getAuth();
  if (!auth) redirect(`/login${opts.next ? `?next=${encodeURIComponent(opts.next)}` : ""}`);
  if (auth.user.mfaEnabled && !auth.session.mfaVerified) redirect("/login/mfa");
  return auth;
}

export async function requireStaff(perm: Permission = "admin.access"): Promise<Auth> {
  const auth = await requireAuth({ next: "/admin" });
  if (!auth.isStaff || !auth.perms.has(perm)) redirect("/app?denied=1");
  if (!auth.user.mfaEnabled) redirect("/app/security?enforce=staff");
  return auth;
}

export class ForbiddenError extends Error {
  constructor(message = "ليست لديك صلاحية لهذا الإجراء.") {
    super(message);
  }
}

export function assertPerm(auth: Auth, perm: Permission) {
  if (!auth.perms.has(perm)) throw new ForbiddenError();
}

// ───────────── waqf-level access (RBAC + ABAC) ─────────────

export type WaqfAccess = {
  waqf: typeof waqfs.$inferSelect;
  roles: string[];
  perms: Set<string>;
  isStaffAssigned: boolean;
  viaGlobal: boolean;
  delegation: { validTo: string; scope: string[] } | null;
  isBeneficiaryOnly: boolean;
  /** The founder holds the file (ESTABLISHING_FOUNDER_PERMS) for this waqf right now: no nazir or chair on the platform. */
  establishingFounder?: boolean;
  /** Staff completing or correcting the file under «admin.waqfs.edit» (STAFF_WAQF_EDIT_PERMS). */
  staffEditor?: boolean;
};

export async function loadWaqfAccess(tx: Tx, auth: Auth, waqfId: string): Promise<WaqfAccess | null> {
  const [waqf] = await tx.select().from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (!waqf) return null; // RLS hides waqfs the user cannot access
  const map = await rolePermissionMap();
  const now = new Date();
  const mems = await tx
    .select({ roleKey: waqfMemberships.roleKey, endsAt: waqfMemberships.endsAt, status: waqfMemberships.status })
    .from(waqfMemberships)
    .where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.userId, auth.user.id), eq(waqfMemberships.status, "active")));
  const activeRoles = mems.filter((m) => !m.endsAt || m.endsAt > now).map((m) => m.roleKey);
  const perms = new Set<string>();
  let delegation: WaqfAccess["delegation"] = null;
  for (const r of activeRoles) {
    if (r === "agent") continue;
    for (const p of map.get(r) ?? []) perms.add(p);
  }
  if (activeRoles.includes("agent")) {
    const today = now.toISOString().slice(0, 10);
    const [d] = await tx
      .select()
      .from(delegations)
      .where(and(eq(delegations.waqfId, waqfId), eq(delegations.agentUserId, auth.user.id), eq(delegations.status, "active"), lte(delegations.validFrom, today), gte(delegations.validTo, today)))
      .limit(1);
    if (d) {
      delegation = { validTo: d.validTo, scope: d.scope };
      const allowed = map.get("agent") ?? new Set();
      for (const p of d.scope) if (allowed.has(p)) perms.add(p); // intersection of role ceiling and POA scope
    }
  }
  // The founder completes the file of their waqf until a nazir or chair holds it on the platform (see catalog).
  let establishingFounder = false;
  if (activeRoles.includes("founder") && (ESTABLISHING_STATUSES as readonly string[]).includes(waqf.status)) {
    const [held] = await tx
      .select({ id: waqfMemberships.id })
      .from(waqfMemberships)
      .where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.status, "active"), inArray(waqfMemberships.roleKey, ["nazir", "board_chair"])))
      .limit(1);
    if (!held) {
      establishingFounder = true;
      for (const p of ESTABLISHING_FOUNDER_PERMS) perms.add(p);
    }
  }
  let isStaffAssigned = false;
  if (auth.isStaff) {
    const [assigned] = await tx
      .select({ id: serviceRequests.id })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.waqfId, waqfId), eq(serviceRequests.assignedToUserId, auth.user.id), notInArray(serviceRequests.status, ["closed", "cancelled", "rejected"])))
      .limit(1);
    if (assigned) {
      isStaffAssigned = true;
      for (const p of STAFF_ASSIGNED_WAQF_PERMS) perms.add(p);
    }
  }
  // Approved, unexpired break-glass grant → read-only access (every view is audited by the admin module).
  let viaBreakGlass = false;
  if (auth.isStaff && perms.size === 0) {
    const [bg] = await tx
      .select({ id: breakGlassAccess.id })
      .from(breakGlassAccess)
      .where(and(eq(breakGlassAccess.waqfId, waqfId), eq(breakGlassAccess.userId, auth.user.id), eq(breakGlassAccess.status, "approved"), gte(breakGlassAccess.expiresAt, now)))
      .limit(1);
    if (bg) {
      viaBreakGlass = true;
      for (const p of BREAK_GLASS_PERMS) perms.add(p);
    }
  }
  const viaGlobal = (auth.globalAccess && perms.size === 0) || viaBreakGlass;
  if (auth.globalAccess) for (const p of STAFF_ASSIGNED_WAQF_PERMS) perms.add(p);
  // System administrator / operations manager: complete and correct any waqf file (never finance or membership).
  const staffEditor = auth.isStaff && auth.perms.has("admin.waqfs.edit") && waqf.status !== "ended";
  if (staffEditor) for (const p of STAFF_WAQF_EDIT_PERMS) perms.add(p);
  if (perms.size === 0) return null;
  const isBeneficiaryOnly = activeRoles.length > 0 && activeRoles.every((r) => r === "beneficiary") && !isStaffAssigned && !auth.globalAccess;
  return { waqf, roles: activeRoles, perms, isStaffAssigned, viaGlobal, delegation, isBeneficiaryOnly, establishingFounder, staffEditor };
}

/** Loads access inside its own transaction; redirects/throws when the user has no access. */
export async function requireWaqf(auth: Auth, waqfId: string, perm: Permission = "waqf.view"): Promise<WaqfAccess> {
  const access = await withContext(auth.db, (tx) => loadWaqfAccess(tx, auth, waqfId));
  if (!access) redirect("/app?notfound=1");
  if (!access.perms.has(perm)) {
    if (access.isBeneficiaryOnly) redirect(`/app/b/${waqfId}`);
    redirect(`/app/w/${waqfId}?denied=1`);
  }
  return access;
}

export function waqfCan(access: WaqfAccess, perm: Permission) {
  return access.perms.has(perm);
}

export async function myWaqfIds(tx: Tx, userId: string) {
  const rows = await tx
    .select({ waqfId: waqfMemberships.waqfId, roleKey: waqfMemberships.roleKey })
    .from(waqfMemberships)
    .where(and(eq(waqfMemberships.userId, userId), eq(waqfMemberships.status, "active")));
  return rows;
}

export { inArray };
