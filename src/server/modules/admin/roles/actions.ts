"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { permissions, rolePermissions, roles } from "@/server/db/schema";
import { invalidateRoleCache } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { isSuperAdmin, staffAction } from "../guard";
import { GLOBAL_DOMAINS, lockedCell } from "./queries";

/**
 * Grants or removes one permission from one role. Takes effect on the next request of every holder
 * (the role cache is invalidated after commit), without code changes.
 */
export async function setRolePermission(roleKey: string, permKey: string, grant: boolean): Promise<ActionState> {
  const res = await staffAction("admin.roles", async ({ auth, tx, ip, userAgent }) => {
    if (typeof roleKey !== "string" || typeof permKey !== "string" || typeof grant !== "boolean") throw new UserError("طلب غير صالح.");
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
    const [perm] = await tx.select().from(permissions).where(eq(permissions.key, permKey)).limit(1);
    if (!role || !perm) throw new UserError("الدور أو الصلاحية غير موجود.");
    const locked = lockedCell(roleKey, permKey);
    if (locked) throw new UserError(locked);
    const permIsGlobal = GLOBAL_DOMAINS.has(perm.domain);
    if (permIsGlobal !== (role.scope === "global"))
      throw new UserError(role.scope === "global" ? "هذه صلاحية على مستوى الوقف؛ تُمنح لأدوار الأوقاف لا لأدوار الفريق." : "هذه صلاحية لفريق وقفك؛ لا تُمنح لأدوار الأوقاف.");
    if (!isSuperAdmin(auth)) {
      if (roleKey === "super_admin") throw new UserError("تعديل صلاحيات «مسؤول النظام الأعلى» مقصور على مسؤول نظام أعلى.");
      if (grant && !auth.perms.has(permKey)) throw new UserError("لا يمكنك منح صلاحية لا تملكها.");
      if (auth.globalRoles.includes(roleKey) && !grant) throw new UserError("لا يمكنك تقليص صلاحيات دور تحمله أنت؛ اطلب ذلك من مسؤول آخر.");
    }
    // Lock the role row so concurrent toggles on the same role serialize.
    await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, role.id)).for("update");
    const [{ n }] = await tx.select({ n: count() }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    const [has] = await tx.select().from(rolePermissions).where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionId, perm.id))).limit(1);
    if (grant === !!has) return { ok: true, message: "لا تغيير." };
    if (grant) {
      await tx.insert(rolePermissions).values({ roleId: role.id, permissionId: perm.id });
    } else {
      // A role with no rows falls back to the code catalog defaults, which would silently restore every permission.
      if (n <= 1) throw new UserError("يجب أن يبقى للدور صلاحية واحدة على الأقل. لإيقاف الدور اسحبه من حامليه.");
      await tx.delete(rolePermissions).where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permissionId, perm.id)));
    }
    await audit(tx, {
      actorUserId: auth.user.id, action: grant ? "admin.role.permission_granted" : "admin.role.permission_revoked", entityType: "role", entityId: roleKey, ip, userAgent,
      before: { role: roleKey, permission: permKey, granted: !!has }, after: { role: roleKey, permission: permKey, granted: grant },
    });
    return { ok: true, message: grant ? `أُضيفت «${perm.nameAr}» إلى «${role.nameAr}».` : `أُزيلت «${perm.nameAr}» من «${role.nameAr}».` };
  });
  if (res.ok) {
    invalidateRoleCache();
    revalidatePath("/admin", "layout");
  }
  return res;
}
