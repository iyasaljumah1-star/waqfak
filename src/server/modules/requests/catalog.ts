import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withSystem, type Tx } from "@/server/db";
import {
  featureFlags, packageItems, packages, serviceCategories, servicePrices, services, settings, workflowTemplates,
} from "@/server/db/schema";
import { todayISO } from "@/server/engines/dates";

/** Feature flags that gate specific services (besides the generic `service.<code>` convention). */
const SERVICE_FLAGS: Record<string, string> = { N01: "service.nazara" };

export type License = { key: string; nameAr?: string; number?: string; active?: boolean };
export type Availability = { available: true } | { available: false; reason: string };

export async function readSetting<T>(tx: Tx, key: string, fallback: T): Promise<T> {
  const [r] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return (r?.v as T) ?? fallback;
}

export async function flagMap(tx: Tx) {
  const rows = await tx.select().from(featureFlags);
  return new Map(rows.map((f) => [f.key, f]));
}

export async function isFlagOn(tx: Tx, key: string) {
  const [f] = await tx.select({ on: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
  return !!f?.on;
}

export function serviceAvailability(
  svc: { code: string; requiresLicenseKey: string | null; isActive: boolean },
  flags: Map<string, { enabled: boolean; reason: string | null }>,
  licenses: License[],
): Availability {
  if (!svc.isActive) return { available: false, reason: "توقف استقبال طلبات هذه الخدمة مؤقتًا." };
  for (const key of [SERVICE_FLAGS[svc.code], `service.${svc.code}`, `service.${svc.code.toLowerCase()}`]) {
    const f = key ? flags.get(key) : undefined;
    if (f && !f.enabled) return { available: false, reason: f.reason ?? "تُتاح هذه الخدمة لاحقًا." };
  }
  if (svc.requiresLicenseKey) {
    const lic = licenses.find((l) => l.key === svc.requiresLicenseKey);
    if (!lic || lic.active === false || !String(lic.number ?? "").trim()) return { available: false, reason: "تُتاح بعد اعتماد ترخيص الهيئة العامة للأوقاف للناظر الاعتباري." };
  }
  return { available: true };
}

type PriceRow = typeof servicePrices.$inferSelect;
/** Current price for a service and a waqf size class; null = determined after studying the request. */
export function priceFor(svc: { pricingModel: string; basePrice: string | null }, prices: PriceRow[], sizeClass?: string | null): number | null {
  if (svc.pricingModel === "free") return 0;
  const today = todayISO();
  const valid = prices.filter((p) => (!p.validFrom || p.validFrom <= today) && (!p.validTo || p.validTo >= today));
  const exact = sizeClass ? valid.find((p) => p.sizeClass === sizeClass) : undefined;
  const generic = valid.find((p) => !p.sizeClass);
  const hit = exact ?? generic;
  if (hit) return Number(hit.price);
  return svc.basePrice ? Number(svc.basePrice) : null;
}

export const PRICE_UNKNOWN = "عرض سعر بعد الدراسة";
export const PRICING_LABEL: Record<string, string> = {
  free: "مجانية", fixed: "سعر ثابت", subscription: "اشتراك", hourly: "بالساعة", percentage: "نسبة", quote: "بعرض سعر",
};
export const AUDIENCE_LABEL: Record<string, string> = { waqif: "الواقف", nazir: "الناظر", board: "مجلس النظارة", beneficiary: "المستفيد", entity: "الجهات" };
export const STAGE_LABEL: Record<number, string> = { 1: "الفكرة والتصميم", 2: "التوثيق والتسجيل", 3: "البناء المؤسسي", 4: "التشغيل والامتثال", 5: "التنمية والاستثمار" };

export type CatalogService = typeof services.$inferSelect & { availability: Availability; price: number | null; prices: PriceRow[] };

/** Public catalog read (no waqf data) — allowed under withSystem. */
export async function loadCatalog() {
  return withSystem(async (tx) => {
    const cats = await tx.select().from(serviceCategories).orderBy(asc(serviceCategories.position));
    const svcs = await tx.select().from(services).where(and(eq(services.isPublished, true))).orderBy(asc(services.position), asc(services.code));
    const prices = await tx.select().from(servicePrices);
    const flags = await flagMap(tx);
    const licenses = await readSetting<License[]>(tx, "company.licenses", []);
    const pkgs = await tx.select().from(packages).where(eq(packages.isActive, true)).orderBy(asc(packages.position));
    const items = pkgs.length ? await tx.select().from(packageItems).where(inArray(packageItems.packageId, pkgs.map((p) => p.id))) : [];
    const list: CatalogService[] = svcs.map((s) => {
      const ps = prices.filter((p) => p.serviceId === s.id);
      return { ...s, prices: ps, availability: serviceAvailability(s, flags, licenses), price: priceFor(s, ps) };
    });
    const byId = new Map(list.map((s) => [s.id, s]));
    return {
      categories: cats.map((c) => ({ ...c, services: list.filter((s) => s.categoryId === c.id) })).filter((c) => c.services.length),
      packages: pkgs.map((p) => ({ ...p, services: items.filter((i) => i.packageId === p.id).map((i) => byId.get(i.serviceId)).filter((x): x is CatalogService => !!x) })),
    };
  });
}

export async function loadServiceByCode(code: string) {
  return withSystem(async (tx) => {
    const [s] = await tx.select().from(services).where(and(eq(services.code, code.toUpperCase()), eq(services.isPublished, true))).limit(1);
    if (!s) return null;
    const [cat] = await tx.select().from(serviceCategories).where(eq(serviceCategories.id, s.categoryId)).limit(1);
    const [wf] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.code, s.workflowTemplateCode)).limit(1);
    const prices = await tx.select().from(servicePrices).where(eq(servicePrices.serviceId, s.id));
    const flags = await flagMap(tx);
    const licenses = await readSetting<License[]>(tx, "company.licenses", []);
    return { service: s, category: cat ?? null, workflow: wf ?? null, prices, availability: serviceAvailability(s, flags, licenses), price: priceFor(s, prices) };
  });
}
