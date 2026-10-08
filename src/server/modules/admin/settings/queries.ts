import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import { featureFlags, services, settings, users } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { serviceAvailability, type License as CatalogLicense } from "@/server/modules/requests/catalog";
import { GENERAL_SETTINGS, RETENTION_DEFAULTS, type RetentionPolicy } from "./defs";

export type License = { key: string; nameAr: string; issuer?: string; number?: string; expiresOn?: string; active?: boolean };
export type CompanyProfile = Record<string, string>;

export async function loadSettings(auth: Auth) {
  return read(auth, async (tx) => {
    const keys = ["company.profile", "company.licenses", "retention.policy", ...GENERAL_SETTINGS.map((g) => g.key)];
    const [rows, flags, n01] = await Promise.all([
      tx.select().from(settings).where(inArray(settings.key, keys)),
      tx.select().from(featureFlags).orderBy(asc(featureFlags.key)),
      tx.select({ code: services.code, requiresLicenseKey: services.requiresLicenseKey, isActive: services.isActive, nameAr: services.nameAr }).from(services).where(eq(services.code, "N01")).limit(1),
    ]);
    const get = (k: string) => rows.find((r) => r.key === k);
    const profile = (get("company.profile")?.value ?? {}) as CompanyProfile;
    const licenses = (get("company.licenses")?.value ?? []) as License[];
    const retention = { ...RETENTION_DEFAULTS, ...((get("retention.policy")?.value ?? {}) as Partial<RetentionPolicy>) };
    const general = Object.fromEntries(GENERAL_SETTINGS.map((g) => [g.key, Number(get(g.key)?.value ?? g.fallback)]));
    const updaterIds = [...new Set([...rows.map((r) => r.updatedBy), ...flags.map((f) => f.updatedBy)].filter(Boolean) as string[])];
    const people = updaterIds.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, updaterIds)) : [];
    const flagMap = new Map(flags.map((f) => [f.key, { enabled: f.enabled, reason: f.reason }]));
    const nazara = n01[0]
      ? { name: n01[0].nameAr, availability: serviceAvailability(n01[0], flagMap, licenses as CatalogLicense[]) }
      : null;
    return {
      profile, licenses, retention, general, flags, nazara,
      meta: new Map(rows.map((r) => [r.key, { updatedAt: r.updatedAt, updatedBy: r.updatedBy }])),
      names: new Map(people.map((p) => [p.id, p.name ?? "—"])),
    };
  });
}
export type SettingsData = Awaited<ReturnType<typeof loadSettings>>;
