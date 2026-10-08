import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../../db";
import { deedVersions, waqfDeeds, waqfMemberships, waqfs } from "../../db/schema";
import { normalizePlan, type WillPlan } from "./pure";

/**
 * A waqf bequest plan is stored as a future waqf (creation mode "bequest", status "idea") owned by the testator,
 * with the planner answers in its draft deed version. Only the testator (founder membership + creator) sees it.
 */
export async function myWills(tx: Tx, userId: string) {
  const rows = await tx
    .select({ id: waqfs.id, name: waqfs.name, status: waqfs.status, updatedAt: waqfs.updatedAt, internalNumber: waqfs.internalNumber })
    .from(waqfs)
    .innerJoin(waqfMemberships, and(eq(waqfMemberships.waqfId, waqfs.id), eq(waqfMemberships.userId, userId), eq(waqfMemberships.roleKey, "founder"), eq(waqfMemberships.status, "active")))
    .where(and(eq(waqfs.createdBy, userId), eq(waqfs.creationMode, "bequest"), inArray(waqfs.status, ["idea", "draft"]), isNull(waqfs.archivedAt)))
    .orderBy(desc(waqfs.updatedAt));
  const out: (typeof rows[number] & { plan: WillPlan })[] = [];
  for (const r of rows) {
    const p = await willPlan(tx, r.id);
    if (p) out.push({ ...r, plan: p.plan });
  }
  return out;
}

export async function willPlan(tx: Tx, waqfId: string) {
  const [row] = await tx
    .select({ versionId: deedVersions.id, structured: deedVersions.structured })
    .from(waqfDeeds)
    .innerJoin(deedVersions, eq(deedVersions.deedId, waqfDeeds.id))
    .where(eq(waqfDeeds.waqfId, waqfId))
    .orderBy(desc(deedVersions.version))
    .limit(1);
  if (!row || (row.structured as { kind?: string } | null)?.kind !== "will") return null;
  return { versionId: row.versionId, plan: normalizePlan(row.structured) };
}
