import "server-only";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import { withSystem } from "@/server/db";
import { breakGlassAccess, users, waqfs } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";

export const BG_STATUS_LABEL: Record<string, string> = {
  requested: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض", expired: "منتهٍ", revoked: "أُلغي مبكرًا",
};

/** Effective status: an approved grant past its expiry is shown as expired. */
export const bgStatus = (s: string, expiresAt: Date | null) => (s === "approved" && expiresAt && expiresAt <= new Date() ? "expired" : s);

/** All emergency-access requests (approvers hold a global-access role, so RLS shows every row). */
export async function listBreakGlass(auth: Auth) {
  return read(auth, async (tx) => {
    const rows = await tx
      .select({
        id: breakGlassAccess.id, userId: breakGlassAccess.userId, waqfId: breakGlassAccess.waqfId, reason: breakGlassAccess.reason, status: breakGlassAccess.status,
        approvedBy: breakGlassAccess.approvedBy, approvedAt: breakGlassAccess.approvedAt, expiresAt: breakGlassAccess.expiresAt, createdAt: breakGlassAccess.createdAt,
        waqfName: waqfs.name, waqfNumber: waqfs.internalNumber,
      })
      .from(breakGlassAccess)
      .leftJoin(waqfs, eq(waqfs.id, breakGlassAccess.waqfId))
      .orderBy(desc(breakGlassAccess.createdAt))
      .limit(100);
    const ids = [...new Set(rows.flatMap((r) => [r.userId, r.approvedBy]).filter(Boolean) as string[])];
    const people = ids.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    const names = new Map(people.map((p) => [p.id, p.name ?? "—"]));
    return rows.map((r) => ({ ...r, requester: names.get(r.userId) ?? "—", approver: r.approvedBy ? names.get(r.approvedBy) ?? "—" : null }));
  });
}

/**
 * The requester's own emergency requests. Before approval the requester cannot see the waqf (RLS), so the row itself is
 * invisible to them; this narrow system read returns only their own rows and the waqf number they typed.
 * Requested from integrator: an RLS policy `user_id = app_current_user()` on break_glass_access to drop this exception.
 */
export async function myBreakGlass(auth: Auth) {
  return withSystem((tx) =>
    tx
      .select({ id: breakGlassAccess.id, status: breakGlassAccess.status, expiresAt: breakGlassAccess.expiresAt, createdAt: breakGlassAccess.createdAt, waqfId: breakGlassAccess.waqfId, waqfNumber: waqfs.internalNumber })
      .from(breakGlassAccess)
      .leftJoin(waqfs, eq(waqfs.id, breakGlassAccess.waqfId))
      .where(eq(breakGlassAccess.userId, auth.user.id))
      .orderBy(desc(breakGlassAccess.createdAt))
      .limit(20),
  );
}

/** Whether the user holds an approved, unexpired emergency grant on a waqf. */
export async function hasActiveBreakGlass(auth: Auth, waqfId: string) {
  const rows = await read(auth, (tx) =>
    tx
      .select({ id: breakGlassAccess.id, expiresAt: breakGlassAccess.expiresAt })
      .from(breakGlassAccess)
      .where(and(eq(breakGlassAccess.userId, auth.user.id), eq(breakGlassAccess.waqfId, waqfId), eq(breakGlassAccess.status, "approved"), gt(breakGlassAccess.expiresAt, new Date())))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Every page view made under an emergency grant is written to the audit trail, including the waqf's own trail. */
export async function recordBreakGlassView(auth: Auth, waqfId: string, grantId: string, path: string) {
  const { ip, userAgent } = await requestInfo();
  await read(auth, (tx) => audit(tx, { actorUserId: auth.user.id, action: "breakglass.viewed", entityType: "break_glass_access", entityId: grantId, waqfId, ip, userAgent, after: { path } }));
}
