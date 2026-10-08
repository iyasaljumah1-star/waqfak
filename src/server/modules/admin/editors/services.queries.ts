import "server-only";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  discounts, packageItems, packages, priceQuoteHistory, serviceCategories, servicePrices, serviceRequests, services, users, workflowTemplates,
} from "@/server/db/schema";

export async function listServices(tx: Tx) {
  return tx
    .select({ s: services, cat: serviceCategories.nameAr, catCode: serviceCategories.code })
    .from(services)
    .innerJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
    .orderBy(asc(serviceCategories.position), asc(services.position), asc(services.code));
}

export async function serviceFormOptions(tx: Tx) {
  const [cats, wfs] = [
    await tx.select().from(serviceCategories).orderBy(asc(serviceCategories.position)),
    await tx.select({ code: workflowTemplates.code, nameAr: workflowTemplates.nameAr }).from(workflowTemplates).orderBy(asc(workflowTemplates.code)),
  ];
  return { cats, wfs };
}

export async function loadService(tx: Tx, id: string) {
  const [s] = await tx.select().from(services).where(eq(services.id, id)).limit(1);
  if (!s) return null;
  const prices = await tx.select().from(servicePrices).where(eq(servicePrices.serviceId, id)).orderBy(asc(servicePrices.sizeClass), desc(servicePrices.validFrom));
  const priceIds = prices.map((p) => p.id);
  const log = await tx
    .select({ l: priceQuoteHistory, actor: users.fullName })
    .from(priceQuoteHistory)
    .leftJoin(users, eq(users.id, priceQuoteHistory.actorUserId))
    .where(inArray(priceQuoteHistory.entityId, [id, ...priceIds]))
    .orderBy(desc(priceQuoteHistory.at))
    .limit(50);
  const [usage] = await tx.select({ n: sql<number>`count(*)::int` }).from(serviceRequests).where(eq(serviceRequests.serviceId, id));
  const inPackages = await tx
    .select({ code: packages.code, nameAr: packages.nameAr, id: packages.id })
    .from(packageItems)
    .innerJoin(packages, eq(packages.id, packageItems.packageId))
    .where(eq(packageItems.serviceId, id));
  return { s, prices, log, requests: usage?.n ?? 0, inPackages };
}

export async function listPackages(tx: Tx) {
  const pk = await tx.select().from(packages).orderBy(asc(packages.position), asc(packages.code));
  const items = await tx.select({ packageId: packageItems.packageId, code: services.code }).from(packageItems).innerJoin(services, eq(services.id, packageItems.serviceId));
  const by = new Map<string, string[]>();
  for (const i of items) by.set(i.packageId, [...(by.get(i.packageId) ?? []), i.code]);
  return pk.map((p) => ({ p, services: (by.get(p.id) ?? []).sort() }));
}

export async function loadPackage(tx: Tx, id: string) {
  const [p] = await tx.select().from(packages).where(eq(packages.id, id)).limit(1);
  if (!p) return null;
  const items = await tx.select({ serviceId: packageItems.serviceId, note: packageItems.note, code: services.code, nameAr: services.nameAr }).from(packageItems).innerJoin(services, eq(services.id, packageItems.serviceId)).where(eq(packageItems.packageId, id)).orderBy(asc(services.code));
  const log = await tx
    .select({ l: priceQuoteHistory, actor: users.fullName })
    .from(priceQuoteHistory)
    .leftJoin(users, eq(users.id, priceQuoteHistory.actorUserId))
    .where(eq(priceQuoteHistory.entityId, id))
    .orderBy(desc(priceQuoteHistory.at))
    .limit(30);
  return { p, items, log };
}

export async function serviceOptions(tx: Tx) {
  return tx.select({ id: services.id, code: services.code, nameAr: services.nameAr, isActive: services.isActive }).from(services).orderBy(asc(services.code));
}

export async function listDiscounts(tx: Tx) {
  return tx.select().from(discounts).orderBy(desc(discounts.isActive), asc(discounts.code));
}

export async function loadDiscount(tx: Tx, id: string) {
  const [d] = await tx.select().from(discounts).where(eq(discounts.id, id)).limit(1);
  if (!d) return null;
  const log = await tx
    .select({ l: priceQuoteHistory, actor: users.fullName })
    .from(priceQuoteHistory)
    .leftJoin(users, eq(users.id, priceQuoteHistory.actorUserId))
    .where(eq(priceQuoteHistory.entityId, id))
    .orderBy(desc(priceQuoteHistory.at))
    .limit(30);
  return { d, log };
}

export async function listWorkflows(tx: Tx) {
  const wfs = await tx.select().from(workflowTemplates).orderBy(asc(workflowTemplates.code));
  const use = await tx.select({ code: services.workflowTemplateCode, n: sql<number>`count(*)::int` }).from(services).groupBy(services.workflowTemplateCode);
  const by = new Map(use.map((u) => [u.code, u.n]));
  return wfs.map((w) => ({ w, services: by.get(w.code) ?? 0 }));
}

export async function loadWorkflow(tx: Tx, code: string) {
  const [w] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.code, code)).limit(1);
  if (!w) return null;
  const svc = await tx.select({ id: services.id, code: services.code, nameAr: services.nameAr }).from(services).where(eq(services.workflowTemplateCode, code)).orderBy(asc(services.code));
  return { w, services: svc };
}
