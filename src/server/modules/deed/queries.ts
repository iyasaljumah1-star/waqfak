import "server-only";
import { asc, desc, eq, isNull, and } from "drizzle-orm";
import type { Tx } from "../../db";
import { approvals, assets, conditionInterpretations, conditions, deedVersions, revenueAllocations, users, waqfDeeds, waqfExceptions } from "../../db/schema";

export async function deedData(tx: Tx, waqfId: string) {
  const [deed] = await tx.select().from(waqfDeeds).where(eq(waqfDeeds.waqfId, waqfId)).orderBy(desc(waqfDeeds.createdAt)).limit(1);
  const [versions, conds, interps, exceptions, alloc, apprs, assetOpts] = await Promise.all([
    deed
      ? tx.select({ v: deedVersions, by: users.fullName }).from(deedVersions).leftJoin(users, eq(users.id, deedVersions.createdBy)).where(eq(deedVersions.deedId, deed.id)).orderBy(desc(deedVersions.version))
      : Promise.resolve([]),
    tx.select().from(conditions).where(eq(conditions.waqfId, waqfId)).orderBy(asc(conditions.category), asc(conditions.position), asc(conditions.createdAt)),
    tx.select().from(conditionInterpretations).where(eq(conditionInterpretations.waqfId, waqfId)).orderBy(desc(conditionInterpretations.createdAt)),
    tx.select().from(waqfExceptions).where(eq(waqfExceptions.waqfId, waqfId)).orderBy(asc(waqfExceptions.createdAt)),
    tx.select().from(revenueAllocations).where(eq(revenueAllocations.waqfId, waqfId)).limit(1),
    tx.select().from(approvals).where(eq(approvals.waqfId, waqfId)).orderBy(desc(approvals.createdAt)),
    tx.select({ id: assets.id, title: assets.title }).from(assets).where(and(eq(assets.waqfId, waqfId), isNull(assets.archivedAt))).orderBy(asc(assets.title)),
  ]);
  return { deed: deed ?? null, versions, conditions: conds, interpretations: interps, exceptions, allocation: alloc[0] ?? null, approvals: apprs, assetOpts };
}
