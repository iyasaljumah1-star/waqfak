import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { notificationTemplates } from "@/server/db/schema";
import { redirect } from "next/navigation";
import { ForbiddenError, requireStaff, type Auth } from "@/server/authz/context";
import type { Permission } from "@/server/authz/catalog";
import { userAction } from "@/server/modules/_shared";
import { notify } from "@/server/modules/notify";
import type { ActionState } from "@/lib/utils";

type Ctx = { auth: Auth; tx: Tx; ip: string; userAgent: string };

/**
 * Staff mutation wrapper: same as `userAction` plus the staff rules enforced by `requireStaff`
 * (staff account, MFA enrolled and verified in this session). Errors become Arabic ActionState.
 */
export function staffAction(perm: Permission, fn: (c: Ctx) => Promise<ActionState | void>, revalidate?: string | string[]): Promise<ActionState> {
  return userAction(
    async (c) => {
      assertStaff(c.auth);
      return fn(c);
    },
    { perm, revalidate },
  );
}

export function assertStaff(auth: Auth) {
  if (!auth.isStaff || !auth.user.mfaEnabled || !auth.session.mfaVerified)
    throw new ForbiddenError("هذا الإجراء متاح لفريق وقفك بعد تفعيل التحقق بخطوتين.");
}

/**
 * Page guard for admin pages: staff with MFA (via requireStaff) and the page permission. Staff who lack the permission
 * land on the admin dashboard with a calm notice instead of leaving the admin area.
 */
export async function requireAdmin(perm: Permission, ...alternatives: Permission[]): Promise<Auth> {
  const auth = await requireStaff("admin.access");
  if (![perm, ...alternatives].some((p) => auth.perms.has(p))) redirect("/admin?denied=1");
  return auth;
}

export const isSuperAdmin =(auth: Auth) => auth.globalRoles.includes("super_admin");

/**
 * Sends a templated notification only when the template exists. `notify` falls back to the raw key as a title
 * when a template is missing, which would show users an internal code.
 */
export async function notifyIfTemplate(tx: Tx, userId: string, key: string, vars: Record<string, string | number | null | undefined>, opts: { waqfId?: string | null; link?: string } = {}) {
  const [t] = await tx.select({ key: notificationTemplates.key }).from(notificationTemplates).where(eq(notificationTemplates.key, key)).limit(1);
  if (!t) return false;
  await notify(userId, key, vars, { ...opts, tx });
  return true;
}

/** Masks a phone for staff screens: +9665•••••123. */
export const maskPhoneShort = (p: string | null | undefined) => (p ? `${p.slice(0, 5)}•••••${p.slice(-3)}` : "—");

/** Escapes LIKE wildcards in user search input. */
export const likeTerm = (q: string) => `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
