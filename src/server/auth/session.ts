import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { withSystem } from "../db";
import { sessions, users } from "../db/schema";
import { cookieSecure } from "../env";
import { randomToken, sha256 } from "../lib/crypto";

export const SESSION_COOKIE = cookieSecure ? "__Host-wqf" : "wqf_s";
const IDLE_MS = 30 * 60_000;
const STAFF_IDLE_MS = 15 * 60_000;
const ABSOLUTE_MS = 12 * 60 * 60_000;

export async function createSession(userId: string, opts: { isStaff: boolean; mfaVerified: boolean; ip: string; userAgent: string }) {
  const token = randomToken(32);
  const now = Date.now();
  await withSystem(async (tx) => {
    await tx.insert(sessions).values({
      userId,
      tokenHash: sha256(token),
      mfaVerified: opts.mfaVerified,
      ip: opts.ip,
      userAgent: opts.userAgent,
      idleExpiresAt: new Date(now + (opts.isStaff ? STAFF_IDLE_MS : IDLE_MS)),
      absoluteExpiresAt: new Date(now + ABSOLUTE_MS),
    });
    await tx.update(users).set({ lastLoginAt: new Date(), failedLoginCount: 0 }).where(eq(users.id, userId));
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: ABSOLUTE_MS / 1000,
  });
}

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;

export async function readSession(): Promise<{ session: SessionRow; user: UserRow } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const hash = sha256(token);
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hash), isNull(sessions.revokedAt)))
      .limit(1);
    if (!row) return null;
    const now = Date.now();
    if (row.session.idleExpiresAt.getTime() < now || row.session.absoluteExpiresAt.getTime() < now) {
      await tx.update(sessions).set({ revokedAt: new Date(), revokeReason: "expired" }).where(eq(sessions.id, row.session.id));
      return null;
    }
    if (row.user.status === "locked" || row.user.status === "deleted") return null;
    // sliding idle window, throttled to one write per minute
    if (now - row.session.lastSeenAt.getTime() > 60_000) {
      const idle = row.user.isStaff ? STAFF_IDLE_MS : IDLE_MS;
      await tx
        .update(sessions)
        .set({ lastSeenAt: new Date(), idleExpiresAt: new Date(Math.min(now + idle, row.session.absoluteExpiresAt.getTime())) })
        .where(eq(sessions.id, row.session.id));
    }
    return row;
  });
}

export async function markSessionMfa(sessionId: string) {
  await withSystem((tx) => tx.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId)));
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await withSystem((tx) =>
      tx.update(sessions).set({ revokedAt: new Date(), revokeReason: "logout" }).where(eq(sessions.tokenHash, sha256(token))),
    );
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string, reason: string, exceptSessionId?: string) {
  await withSystem((tx) =>
    tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined)),
  );
}
