import "server-only";
import { and, asc, desc, eq, ilike, inArray, like, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import {
  contactMessages, dataSubjectRequests, invoices, serviceRequests, services, users, waqfMemberships, waqfs,
} from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { likeTerm } from "../guard";

export async function listClients(auth: Auth, q?: string) {
  return read(auth, async (tx) => {
    const conds: (SQL | undefined)[] = [eq(users.isStaff, false), notInArray(users.status, ["deleted"])];
    if (q?.trim()) {
      const digits = q.replace(/\D/g, "").replace(/^0/, "");
      conds.push(or(ilike(users.fullName, likeTerm(q)), ilike(users.email, likeTerm(q)), digits.length >= 4 ? like(users.phone, `%${digits}%`) : undefined));
    }
    const rows = await tx
      .select({ id: users.id, fullName: users.fullName, phone: users.phone, email: users.email, status: users.status, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(and(...conds))
      .orderBy(desc(users.createdAt))
      .limit(200);
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const [mem, reqs, invs] = await Promise.all([
      tx
        .select({ userId: waqfMemberships.userId, n: sql<number>`count(distinct ${waqfMemberships.waqfId})`.mapWith(Number) })
        .from(waqfMemberships)
        .where(and(inArray(waqfMemberships.userId, ids), eq(waqfMemberships.status, "active")))
        .groupBy(waqfMemberships.userId),
      tx
        .select({
          userId: serviceRequests.requesterUserId,
          total: sql<number>`count(*)`.mapWith(Number),
          open: sql<number>`count(*) filter (where ${serviceRequests.status} not in ('draft','completed','closed','cancelled','rejected'))`.mapWith(Number),
        })
        .from(serviceRequests)
        .where(inArray(serviceRequests.requesterUserId, ids))
        .groupBy(serviceRequests.requesterUserId),
      tx
        .select({
          userId: invoices.userId,
          total: sql<number>`count(*)`.mapWith(Number),
          due: sql<number>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} in ('issued','overdue')), 0)`.mapWith(Number),
        })
        .from(invoices)
        .where(inArray(invoices.userId, ids))
        .groupBy(invoices.userId),
    ]);
    const m = new Map(mem.map((x) => [x.userId, x.n]));
    const r = new Map(reqs.map((x) => [x.userId, x]));
    const i = new Map(invs.map((x) => [x.userId, x]));
    return rows.map((u) => ({
      ...u,
      waqfs: m.get(u.id) ?? 0,
      requests: r.get(u.id)?.total ?? 0,
      openRequests: r.get(u.id)?.open ?? 0,
      invoices: i.get(u.id)?.total ?? 0,
      due: i.get(u.id)?.due ?? 0,
    }));
  });
}

export async function clientDetail(auth: Auth, id: string) {
  return read(auth, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
    if (!u) return null;
    const [mems, reqs, invs, dsrs] = await Promise.all([
      tx
        .select({ waqfId: waqfMemberships.waqfId, roleKey: waqfMemberships.roleKey, status: waqfMemberships.status, startsAt: waqfMemberships.startsAt, name: waqfs.name, number: waqfs.internalNumber, waqfStatus: waqfs.status })
        .from(waqfMemberships)
        .leftJoin(waqfs, eq(waqfs.id, waqfMemberships.waqfId))
        .where(eq(waqfMemberships.userId, id))
        .orderBy(asc(waqfs.name)),
      tx
        .select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, createdAt: serviceRequests.createdAt, service: services.nameAr, waqfName: waqfs.name })
        .from(serviceRequests)
        .leftJoin(services, eq(services.id, serviceRequests.serviceId))
        .leftJoin(waqfs, eq(waqfs.id, serviceRequests.waqfId))
        .where(eq(serviceRequests.requesterUserId, id))
        .orderBy(desc(serviceRequests.createdAt))
        .limit(50),
      tx
        .select({ id: invoices.id, number: invoices.number, status: invoices.status, total: invoices.total, issuedOn: invoices.issuedOn, dueOn: invoices.dueOn })
        .from(invoices)
        .where(eq(invoices.userId, id))
        .orderBy(desc(invoices.issuedOn))
        .limit(50),
      tx.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.userId, id)).orderBy(desc(dataSubjectRequests.requestedAt)),
    ]);
    return { user: u, memberships: mems, requests: reqs, invoices: invs, dsrs };
  });
}

export const CONTACT_STATUS_LABEL: Record<string, string> = { new: "جديدة", in_progress: "قيد المتابعة", handled: "عولجت" };

export async function listContactMessages(auth: Auth, status?: string) {
  return read(auth, async (tx) => {
    const rows = await tx
      .select()
      .from(contactMessages)
      .where(status && status !== "all" ? eq(contactMessages.status, status) : undefined)
      .orderBy(sql`case ${contactMessages.status} when 'new' then 0 when 'in_progress' then 1 else 2 end`, desc(contactMessages.createdAt))
      .limit(200);
    const ids = [...new Set(rows.map((r) => r.handledBy).filter(Boolean) as string[])];
    const staff = await tx.select({ id: users.id, name: users.fullName }).from(users).where(and(eq(users.isStaff, true), eq(users.status, "active"))).orderBy(asc(users.fullName));
    const extra = ids.filter((x) => !staff.some((s) => s.id === x));
    const others = extra.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, extra)) : [];
    return { rows, staff, names: new Map([...staff, ...others].map((s) => [s.id, s.name ?? "—"])) };
  });
}

export async function newContactCount(auth: Auth) {
  const [r] = await read(auth, (tx) => tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(contactMessages).where(eq(contactMessages.status, "new")));
  return r.n;
}
