import "server-only";
import { and, desc, eq, gte, ilike, inArray, isNull, like, lt, lte, or, type SQL } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import type { Tx } from "@/server/db";
import { auditLogs, users, waqfs } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { likeTerm } from "../guard";

export type AuditFilter = { actor?: string; action?: string; entity?: string; entityId?: string; waqf?: string; from?: string; to?: string; before?: string };

export const PAGE_SIZE = 50;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Filtered page of the global audit trail (newest first, keyset-paginated by id). RLS still applies. */
export async function auditPage(auth: Auth, f: AuditFilter) {
  return read(auth, async (tx) => {
    const conds: (SQL | undefined)[] = [];
    if (f.actor?.trim()) {
      if (f.actor === "system") conds.push(isNull(auditLogs.actorUserId));
      else if (UUID.test(f.actor)) conds.push(eq(auditLogs.actorUserId, f.actor));
      else {
        const ids = tx.select({ id: users.id }).from(users).where(or(ilike(users.fullName, likeTerm(f.actor)), ilike(users.email, likeTerm(f.actor))));
        conds.push(inArray(auditLogs.actorUserId, ids));
      }
    }
    if (f.action?.trim()) {
      const a = f.action.trim();
      conds.push(a.endsWith(".") || !a.includes(".") ? like(auditLogs.action, `${a.replace(/\.$/, "")}.%`) : eq(auditLogs.action, a));
    }
    if (f.entity?.trim()) conds.push(eq(auditLogs.entityType, f.entity.trim()));
    if (f.entityId?.trim()) conds.push(eq(auditLogs.entityId, f.entityId.trim()));
    if (f.waqf?.trim()) {
      const w = f.waqf.trim();
      if (UUID.test(w)) conds.push(eq(auditLogs.waqfId, w));
      else conds.push(inArray(auditLogs.waqfId, tx.select({ id: waqfs.id }).from(waqfs).where(or(ilike(waqfs.internalNumber, likeTerm(w)), ilike(waqfs.name, likeTerm(w))))));
    }
    if (f.from && ISO_DAY.test(f.from)) conds.push(gte(auditLogs.at, new Date(`${f.from}T00:00:00+03:00`)));
    if (f.to && ISO_DAY.test(f.to)) conds.push(lte(auditLogs.at, new Date(`${f.to}T23:59:59.999+03:00`)));
    if (f.before && /^\d+$/.test(f.before)) conds.push(lt(auditLogs.id, Number(f.before)));
    const rows = await tx
      .select({
        id: auditLogs.id, at: auditLogs.at, actorUserId: auditLogs.actorUserId, actorLabel: auditLogs.actorLabel, action: auditLogs.action,
        entityType: auditLogs.entityType, entityId: auditLogs.entityId, waqfId: auditLogs.waqfId, ip: auditLogs.ip,
      })
      .from(auditLogs)
      .where(and(...conds))
      .orderBy(desc(auditLogs.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const [names, waqfNames] = await lookups(tx, page);
    return { rows: page, hasMore: rows.length > PAGE_SIZE, names, waqfNames };
  });
}

async function lookups(tx: Tx, rows: { actorUserId: string | null; waqfId: string | null }[]) {
  const uids = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean) as string[])];
  const wids = [...new Set(rows.map((r) => r.waqfId).filter(Boolean) as string[])];
  const [u, w] = await Promise.all([
    uids.length ? tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, uids)) : [],
    wids.length ? tx.select({ id: waqfs.id, name: waqfs.name, number: waqfs.internalNumber }).from(waqfs).where(inArray(waqfs.id, wids)) : [],
  ]);
  return [new Map(u.map((x) => [x.id, x.name ?? "—"])), new Map(w.map((x) => [x.id, { name: x.name, number: x.number }]))] as const;
}

export async function auditEntry(auth: Auth, id: number) {
  return read(auth, async (tx) => {
    const [row] = await tx.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);
    if (!row) return null;
    const [names, waqfNames] = await lookups(tx, [row]);
    const [prev] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(lt(auditLogs.id, id)).orderBy(desc(auditLogs.id)).limit(1);
    const [next] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(gte(auditLogs.id, id + 1)).orderBy(auditLogs.id).limit(1);
    return { row, actor: row.actorUserId ? names.get(row.actorUserId) ?? null : null, waqf: row.waqfId ? waqfNames.get(row.waqfId) ?? null : null, prevId: prev?.id ?? null, nextId: next?.id ?? null };
  });
}

/** Distinct entity types and action prefixes for filter dropdowns. */
export async function auditFacets(auth: Auth) {
  return read(auth, async (tx) => {
    const [ents, acts] = await Promise.all([
      tx.selectDistinct({ v: auditLogs.entityType }).from(auditLogs).limit(100),
      tx.selectDistinct({ v: auditLogs.action }).from(auditLogs).limit(500),
    ]);
    const prefixes = [...new Set(acts.map((a) => a.v.split(".")[0]))].sort();
    return { entities: ents.map((e) => e.v).sort(), prefixes, actions: acts.map((a) => a.v).sort() };
  });
}
