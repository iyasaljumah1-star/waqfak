import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, like, or, type SQL , sql } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import { auditLogs, breakGlassAccess, roles, sessions, userRoles, users, userColumns, waqfMemberships, waqfs } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { likeTerm } from "../guard";

export type UserListFilter = { q?: string; kind?: "staff" | "clients" | "all"; status?: string; role?: string };

export async function listUsers(auth: Auth, f: UserListFilter) {
  return read(auth, async (tx) => {
    const conds: (SQL | undefined)[] = [];
    if (f.kind === "staff") conds.push(eq(users.isStaff, true));
    if (f.kind === "clients") conds.push(eq(users.isStaff, false));
    if (f.status) conds.push(eq(users.status, f.status as typeof users.$inferSelect.status));
    if (f.q?.trim()) {
      const t = likeTerm(f.q);
      const digits = f.q.replace(/\D/g, "").replace(/^0/, "");
      conds.push(or(ilike(users.fullName, t), ilike(users.email, t), digits.length >= 4 ? like(users.phone, `%${digits}%`) : undefined));
    }
    if (f.role) {
      const ids = tx.select({ id: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(roles.key, f.role));
      conds.push(inArray(users.id, ids));
    }
    const rows = await tx
      .select({
        id: users.id, fullName: users.fullName, phone: users.phone, email: users.email, isStaff: users.isStaff, status: users.status,
        mfaEnabled: users.mfaEnabled, lastLoginAt: users.lastLoginAt, lockedUntil: users.lockedUntil, createdAt: users.createdAt,
      })
      .from(users)
      .where(and(...conds))
      .orderBy(desc(users.isStaff), asc(users.fullName))
      .limit(200);
    const roleRows = rows.length
      ? await tx.select({ userId: userRoles.userId, key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(inArray(userRoles.userId, rows.map((r) => r.id)))
      : [];
    const byUser = new Map<string, string[]>();
    for (const r of roleRows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.key]);
    return rows.map((r) => ({ ...r, roles: byUser.get(r.id) ?? [] }));
  });
}
export type UserListRow = Awaited<ReturnType<typeof listUsers>>[number];

const LOGIN_ACTIONS = ["user.login", "user.logout", "user.mfa_verified", "user.recover", "user.signup", "user.password_set"];

export async function userDetail(auth: Auth, id: string) {
  return read(auth, async (tx) => {
    const [u] = await tx.select(userColumns).from(users).where(eq(users.id, id)).limit(1);
    if (!u) return null;
    const [grants, allRoles, activeSessions, history, adminEvents, factors, , memberships, breakGlass] = await Promise.all([
      tx
        .select({ key: roles.key, nameAr: roles.nameAr, grantedAt: userRoles.grantedAt, grantedBy: userRoles.grantedBy })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, id)),
      tx.select({ key: roles.key, nameAr: roles.nameAr }).from(roles).where(eq(roles.scope, "global")).orderBy(asc(roles.nameAr)),
      tx
        .select({ id: sessions.id, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, ip: sessions.ip, userAgent: sessions.userAgent, mfaVerified: sessions.mfaVerified })
        .from(sessions)
        .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt), gt(sessions.absoluteExpiresAt, new Date()), gt(sessions.idleExpiresAt, new Date())))
        .orderBy(desc(sessions.lastSeenAt)),
      tx
        .select({ id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, ip: auditLogs.ip, userAgent: auditLogs.userAgent, after: auditLogs.after })
        .from(auditLogs)
        .where(and(eq(auditLogs.actorUserId, id), or(inArray(auditLogs.action, LOGIN_ACTIONS), like(auditLogs.action, "auth.%"))))
        .orderBy(desc(auditLogs.id))
        .limit(30),
      tx
        .select({ id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, actorUserId: auditLogs.actorUserId, after: auditLogs.after })
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, "user"), eq(auditLogs.entityId, id), like(auditLogs.action, "admin.%")))
        .orderBy(desc(auditLogs.id))
        .limit(30),
      // stage 11: the second factor is the authentication role's; staff see its state through a function (no secrets)
      tx.execute<{ factor_id: string | null; kind: string | null; verified_at: Date | null; last_used_at: Date | null; codes_total: number; codes_used: number }>(sql`select * from admin_mfa_state(${id}::uuid)`).then((r) => r.rows),
      Promise.resolve(null),
      tx
        .select({ waqfId: waqfMemberships.waqfId, roleKey: waqfMemberships.roleKey, status: waqfMemberships.status, name: waqfs.name, number: waqfs.internalNumber })
        .from(waqfMemberships)
        .leftJoin(waqfs, eq(waqfs.id, waqfMemberships.waqfId))
        .where(eq(waqfMemberships.userId, id)),
      tx
        .select({ id: breakGlassAccess.id, waqfId: breakGlassAccess.waqfId, status: breakGlassAccess.status, expiresAt: breakGlassAccess.expiresAt, createdAt: breakGlassAccess.createdAt, reason: breakGlassAccess.reason })
        .from(breakGlassAccess)
        .where(eq(breakGlassAccess.userId, id))
        .orderBy(desc(breakGlassAccess.createdAt))
        .limit(10),
    ]);
    const actorIds = [...new Set([...grants.map((g) => g.grantedBy), ...adminEvents.map((e) => e.actorUserId)].filter(Boolean) as string[])];
    const actors = actorIds.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, actorIds)) : [];
    return {
      user: u,
      grants,
      allRoles,
      activeSessions,
      history,
      adminEvents,
      mfa: {
        factors: factors.filter((f) => f.factor_id && f.verified_at).map((f) => ({ id: f.factor_id!, type: f.kind as "totp", verifiedAt: f.verified_at, lastUsedAt: f.last_used_at })),
        recoveryLeft: factors.length ? Number(factors[0]!.codes_total) - Number(factors[0]!.codes_used) : 0,
      },
      memberships,
      breakGlass,
      names: new Map(actors.map((a) => [a.id, a.name ?? "—"])),
    };
  });
}
export type UserDetail = NonNullable<Awaited<ReturnType<typeof userDetail>>>;

export async function globalRoleOptions(auth: Auth) {
  return read(auth, (tx) => tx.select({ key: roles.key, nameAr: roles.nameAr }).from(roles).where(eq(roles.scope, "global")).orderBy(asc(roles.nameAr)));
}

/**
 * Records that a staff member opened a client's unmasked personal data (once per viewer, account and 15 minutes),
 * so access to full phone numbers stays traceable in the audit log without flooding it.
 */
export async function recordPiiView(auth: Auth, userId: string) {
  const { ip, userAgent } = await requestInfo();
  await read(auth, async (tx) => {
    const since = new Date(Date.now() - 15 * 60_000);
    const [recent] = await tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, auth.user.id), eq(auditLogs.action, "admin.user.pii_viewed"), eq(auditLogs.entityId, userId), gt(auditLogs.at, since)))
      .limit(1);
    if (!recent) await audit(tx, { actorUserId: auth.user.id, action: "admin.user.pii_viewed", entityType: "user", entityId: userId, ip, userAgent });
  });
}
