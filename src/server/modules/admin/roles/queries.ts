import "server-only";
import { asc, count, eq } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import { permissions, rolePermissions, roles, userRoles } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";

/** Permission domains that belong to staff (global) roles; every other domain is waqf-scoped. */
export const GLOBAL_DOMAINS = new Set(["admin", "staff"]);

/** Cells that cannot change from the matrix, with the reason shown to the admin. */
export function lockedCell(roleKey: string, permKey: string): string | null {
  if (permKey === "mlro.access" && roleKey !== "mlro") return "سجلات مكافحة غسل الأموال مقصورة على دور مسؤول الامتثال (فصل المهام).";
  if (roleKey === "mlro" && permKey === "mlro.access") return "لا يُسحب من دور مسؤول الامتثال لأنه أساس عمله.";
  if (roleKey === "super_admin" && ["admin.access", "admin.roles", "admin.users"].includes(permKey)) return "تُبقى لمسؤول النظام الأعلى حتى لا يُغلق باب الإدارة.";
  return null;
}

export async function roleMatrix(auth: Auth) {
  return read(auth, async (tx) => {
    const [rs, ps, rp, holders] = await Promise.all([
      tx.select({ id: roles.id, key: roles.key, nameAr: roles.nameAr, scope: roles.scope }).from(roles).orderBy(asc(roles.scope), asc(roles.nameAr)),
      tx.select({ id: permissions.id, key: permissions.key, nameAr: permissions.nameAr, domain: permissions.domain }).from(permissions).orderBy(asc(permissions.domain), asc(permissions.key)),
      tx.select({ roleId: rolePermissions.roleId, permissionId: rolePermissions.permissionId }).from(rolePermissions),
      tx.select({ roleId: userRoles.roleId, n: count() }).from(userRoles).groupBy(userRoles.roleId),
    ]);
    const roleKey = new Map(rs.map((r) => [r.id, r.key]));
    const permKey = new Map(ps.map((p) => [p.id, p.key]));
    const granted = new Set(rp.map((x) => `${roleKey.get(x.roleId)}|${permKey.get(x.permissionId)}`));
    const holdersBy = new Map(holders.map((h) => [roleKey.get(h.roleId)!, h.n]));
    return { roles: rs.map((r) => ({ ...r, holders: holdersBy.get(r.key) ?? 0 })), permissions: ps, granted };
  });
}
