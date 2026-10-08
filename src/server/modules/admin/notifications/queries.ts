import "server-only";
import { and, asc, desc, eq, ilike, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import { dataSubjectRequests, notificationTemplates, outboxMessages, users, waqfMemberships } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { likeTerm } from "../guard";

export async function listTemplates(auth: Auth) {
  return read(auth, (tx) => tx.select().from(notificationTemplates).orderBy(desc(notificationTemplates.locked), asc(notificationTemplates.key)));
}

/** OTP codes and links with tokens never appear in full on staff screens. */
export function redactMessage(body: string) {
  return body
    .replace(/(رمز[^\n:：]*[:：]\s*)\d{4,8}/g, "$1••••••")
    .replace(/(token=|\/invitations\/|\/r\/)[A-Za-z0-9_-]{8,}/g, "$1••••••");
}
export const isOtpMessage = (body: string) => /رمز[^\n]*:\s*\d{4,8}/.test(body);

export type OutboxFilter = { channel?: string; status?: string; q?: string; before?: string };

export async function outboxPage(auth: Auth, f: OutboxFilter) {
  return read(auth, async (tx) => {
    const conds: (SQL | undefined)[] = [];
    if (f.channel) conds.push(eq(outboxMessages.channel, f.channel as typeof outboxMessages.$inferSelect.channel));
    if (f.status) conds.push(eq(outboxMessages.status, f.status as typeof outboxMessages.$inferSelect.status));
    if (f.q?.trim()) conds.push(ilike(outboxMessages.toAddress, likeTerm(f.q.replace(/^0/, ""))));
    if (f.before && /^\d+$/.test(f.before)) conds.push(lt(outboxMessages.id, Number(f.before)));
    const rows = await tx.select().from(outboxMessages).where(and(...conds)).orderBy(desc(outboxMessages.id)).limit(51);
    const [counts] = await tx
      .select({
        queued: sql<number>`count(*) filter (where ${outboxMessages.status} = 'queued')`.mapWith(Number),
        sent: sql<number>`count(*) filter (where ${outboxMessages.status} = 'sent')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${outboxMessages.status} = 'failed')`.mapWith(Number),
      })
      .from(outboxMessages);
    return {
      rows: rows.slice(0, 50).map((r) => ({ ...r, body: redactMessage(r.body), otp: isOtpMessage(r.body) })),
      hasMore: rows.length > 50,
      counts,
    };
  });
}

export async function dsrQueue(auth: Auth, status?: string) {
  return read(auth, async (tx) => {
    const open = !status || status === "open";
    const rows = await tx
      .select({
        id: dataSubjectRequests.id, userId: dataSubjectRequests.userId, kind: dataSubjectRequests.kind, status: dataSubjectRequests.status,
        details: dataSubjectRequests.details, retainedDataNote: dataSubjectRequests.retainedDataNote, requestedAt: dataSubjectRequests.requestedAt,
        dueAt: dataSubjectRequests.dueAt, completedAt: dataSubjectRequests.completedAt,
        name: users.fullName, phone: users.phone, userStatus: users.status, deletionRequestedAt: users.deletionRequestedAt,
      })
      .from(dataSubjectRequests)
      .leftJoin(users, eq(users.id, dataSubjectRequests.userId))
      .where(open ? inArray(dataSubjectRequests.status, ["received", "in_progress"]) : status === "all" ? undefined : eq(dataSubjectRequests.status, status))
      .orderBy(open ? asc(dataSubjectRequests.dueAt) : desc(dataSubjectRequests.requestedAt))
      .limit(200);
    const ids = rows.filter((r) => r.kind === "delete").map((r) => r.userId);
    const holders = ids.length
      ? await tx
          .select({ userId: waqfMemberships.userId, roleKey: waqfMemberships.roleKey })
          .from(waqfMemberships)
          .where(and(inArray(waqfMemberships.userId, ids), eq(waqfMemberships.status, "active")))
      : [];
    const rolesBy = new Map<string, string[]>();
    for (const h of holders) rolesBy.set(h.userId, [...(rolesBy.get(h.userId) ?? []), h.roleKey]);
    return rows.map((r) => ({ ...r, activeRoles: rolesBy.get(r.userId) ?? [] }));
  });
}
