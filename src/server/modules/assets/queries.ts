import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  approvals, assets, encumbrances, investmentPolicies, investments, leases, maintenancePlans, portfolios, properties, valuations,
} from "../../db/schema";

export async function assetsOverview(tx: Tx, waqfId: string) {
  const [list, ls, encs, ports, pols, maint, subApprovals] = await Promise.all([
    tx.select().from(assets).where(eq(assets.waqfId, waqfId)).orderBy(asc(assets.archivedAt), desc(assets.marketValue)),
    tx.select({ l: leases, title: assets.title }).from(leases).innerJoin(assets, eq(assets.id, leases.assetId)).where(and(eq(leases.waqfId, waqfId), eq(leases.status, "active"))).orderBy(asc(leases.endsOn)),
    tx.select({ e: encumbrances, title: assets.title }).from(encumbrances).innerJoin(assets, eq(assets.id, encumbrances.assetId)).where(and(eq(encumbrances.waqfId, waqfId), isNull(encumbrances.resolvedOn))),
    tx.select().from(portfolios).where(eq(portfolios.waqfId, waqfId)).orderBy(desc(portfolios.createdAt)),
    tx.select().from(investmentPolicies).where(eq(investmentPolicies.waqfId, waqfId)).orderBy(desc(investmentPolicies.version)),
    tx.select({ m: maintenancePlans, title: assets.title }).from(maintenancePlans).innerJoin(assets, eq(assets.id, maintenancePlans.assetId)).where(and(eq(maintenancePlans.waqfId, waqfId), eq(maintenancePlans.status, "planned"))).orderBy(asc(maintenancePlans.nextDueOn)).limit(10),
    tx.select().from(approvals).where(and(eq(approvals.waqfId, waqfId), eq(approvals.kind, "substitution"), eq(approvals.status, "granted"))),
  ]);
  return { assets: list, leases: ls, encumbrances: encs, portfolios: ports, policies: pols, maintenance: maint, subApprovals };
}

export async function assetDetail(tx: Tx, waqfId: string, assetId: string) {
  const [a] = await tx.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.waqfId, waqfId))).limit(1);
  if (!a) return null;
  const [prop, inv, ls, vals, maint, encs, subApprovals] = await Promise.all([
    tx.select().from(properties).where(eq(properties.assetId, assetId)).limit(1),
    tx.select().from(investments).where(eq(investments.assetId, assetId)).limit(1),
    tx.select().from(leases).where(eq(leases.assetId, assetId)).orderBy(desc(leases.startsOn)),
    tx.select().from(valuations).where(eq(valuations.assetId, assetId)).orderBy(desc(valuations.valuedOn)),
    tx.select().from(maintenancePlans).where(eq(maintenancePlans.assetId, assetId)).orderBy(asc(maintenancePlans.status), asc(maintenancePlans.nextDueOn)),
    tx.select().from(encumbrances).where(eq(encumbrances.assetId, assetId)).orderBy(desc(encumbrances.since)),
    tx.select().from(approvals).where(and(eq(approvals.waqfId, waqfId), eq(approvals.kind, "substitution"), eq(approvals.status, "granted"))),
  ]);
  return { asset: a, property: prop[0] ?? null, investment: inv[0] ?? null, leases: ls, valuations: vals, maintenance: maint, encumbrances: encs, subApprovals };
}
