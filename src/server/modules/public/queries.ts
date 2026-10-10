import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { withSystem } from "@/server/db";
import {
  contentItems, faqs, featureFlags, glossaryTerms, holidays, packageItems, packages, serviceCategories, services, settings,
} from "@/server/db/schema";

/**
 * Public catalog reads for the marketing site. These tables hold no waqf data, so they are read under the
 * system context (allowed by CONVENTIONS: "public catalog reads"). Only published/active rows are returned.
 */

// ───────────── settings & flags ─────────────
export type CompanyProfile = {
  nameAr?: string; nameEn?: string; legalForm?: string; email?: string; phone?: string; website?: string;
  crNumber?: string; unifiedNumber?: string; vatNumber?: string; nationalAddress?: string;
};
export type License = { key: string; nameAr: string; issuer?: string; number?: string; expiresOn?: string; active?: boolean };

export const getCompany = cache(async () => {
  const rows = await withSystem((tx) => tx.select().from(settings).where(inArray(settings.key, ["company.profile", "company.licenses"])));
  const profile = (rows.find((r) => r.key === "company.profile")?.value ?? {}) as CompanyProfile;
  const licenses = (rows.find((r) => r.key === "company.licenses")?.value ?? []) as License[];
  return { profile, licenses };
});

export const getFlags = cache(async () => {
  const rows = await withSystem((tx) => tx.select({ key: featureFlags.key, enabled: featureFlags.enabled }).from(featureFlags));
  return new Map(rows.map((r) => [r.key, r.enabled]));
});

// ───────────── services ─────────────
export type PublicService = typeof services.$inferSelect & { availability: Availability };
export type Availability = { available: boolean; label: string | null; reason: string | null };

/** A service is offered only when active, its required license is active, and its feature flag (if any) is on. */
function availability(s: typeof services.$inferSelect, licenses: License[], flags: Map<string, boolean>): Availability {
  if (!s.isActive) return { available: false, label: "غير متاحة حاليًا", reason: "توقف استقبال طلبات هذه الخدمة مؤقتًا." };
  if (s.requiresLicenseKey) {
    const lic = licenses.find((l) => l.key === s.requiresLicenseKey);
    const flagKey = s.requiresLicenseKey === "gaa_nazara_license" ? "service.nazara" : null;
    const flagOff = flagKey ? flags.get(flagKey) === false : false;
    if (!lic?.active || flagOff)
      return {
        available: false,
        label: "تُتاح بعد اعتماد الترخيص",
        reason: `تتطلب هذه الخدمة ${lic?.nameAr ?? "ترخيصًا نظاميًا"}${lic?.issuer ? ` من ${lic.issuer}` : ""}، وتُتاح بعد صدوره.`,
      };
  }
  return { available: true, label: null, reason: null };
}

export const getCatalog = cache(async () => {
  const [{ licenses }, flags] = await Promise.all([getCompany(), getFlags()]);
  const { cats, svcs } = await withSystem(async (tx) => ({
    cats: await tx.select().from(serviceCategories).orderBy(asc(serviceCategories.position)),
    svcs: await tx.select().from(services).where(eq(services.isPublished, true)).orderBy(asc(services.position), asc(services.code)),
  }));
  const all: PublicService[] = svcs.map((s) => ({ ...s, availability: availability(s, licenses, flags) }));
  return {
    categories: cats.map((c) => ({ ...c, services: all.filter((s) => s.categoryId === c.id) })).filter((c) => c.services.length),
    services: all,
  };
});

export async function getService(code: string) {
  const { categories, services: all } = await getCatalog();
  const s = all.find((x) => x.code.toLowerCase() === code.toLowerCase());
  if (!s) return null;
  const category = categories.find((c) => c.id === s.categoryId)!;
  const related = category.services.filter((x) => x.id !== s.id).slice(0, 4);
  const inPackages = await withSystem((tx) =>
    tx
      .select({ code: packages.code, nameAr: packages.nameAr })
      .from(packageItems)
      .innerJoin(packages, eq(packages.id, packageItems.packageId))
      .where(and(eq(packageItems.serviceId, s.id), eq(packages.isActive, true))),
  );
  return { service: s, category, related, inPackages };
}

export const getPackages = cache(async () => {
  const { services: all } = await getCatalog();
  const { pkgs, items } = await withSystem(async (tx) => ({
    pkgs: await tx.select().from(packages).where(eq(packages.isActive, true)).orderBy(asc(packages.position)),
    items: await tx.select().from(packageItems),
  }));
  return pkgs.map((p) => ({
    ...p,
    services: items
      .filter((i) => i.packageId === p.id)
      .map((i) => ({ note: i.note, service: all.find((s) => s.id === i.serviceId) }))
      .filter((x): x is { note: string | null; service: PublicService } => !!x.service)
      .sort((a, b) => a.service.code.localeCompare(b.service.code)),
  }));
});

// ───────────── content ─────────────
export const LIBRARY_KINDS = ["article", "guide", "regulation", "study", "template"] as const;
export type ContentRow = typeof contentItems.$inferSelect;
export type ContentCard = Pick<ContentRow, "id" | "kind" | "slug" | "titleAr" | "summary" | "audience" | "topic" | "readingMinutes" | "publishedAt" | "lastVerifiedAt" | "updatedAt">;

const cardCols = {
  id: contentItems.id, kind: contentItems.kind, slug: contentItems.slug, titleAr: contentItems.titleAr, summary: contentItems.summary,
  audience: contentItems.audience, topic: contentItems.topic, readingMinutes: contentItems.readingMinutes, publishedAt: contentItems.publishedAt,
  lastVerifiedAt: contentItems.lastVerifiedAt, updatedAt: contentItems.updatedAt,
};

/** Published library items (pages excluded). Filtering by topic/audience/search is done in memory: the library is small. */
export const getLibrary = cache(async (): Promise<ContentCard[]> =>
  withSystem((tx) =>
    tx
      .select(cardCols)
      .from(contentItems)
      .where(and(eq(contentItems.status, "published"), ne(contentItems.kind, "page")))
      .orderBy(desc(contentItems.publishedAt), asc(contentItems.titleAr)),
  ),
);

export function filterLibrary(items: ContentCard[], f: { kind?: string; topic?: string; audience?: string; q?: string }) {
  const q = normalizeAr(f.q ?? "");
  return items.filter(
    (i) =>
      (!f.kind || i.kind === f.kind) &&
      (!f.topic || i.topic === f.topic) &&
      (!f.audience || i.audience.includes(f.audience)) &&
      (!q || normalizeAr(`${i.titleAr} ${i.summary ?? ""}`).includes(q)),
  );
}

/** Full-text search fallback also scans the body when the title/summary has no hit. */
export async function searchLibraryBodies(q: string): Promise<Set<string>> {
  const n = normalizeAr(q);
  if (!n) return new Set();
  const rows = await withSystem((tx) =>
    tx.select({ id: contentItems.id, body: contentItems.bodyMd }).from(contentItems).where(and(eq(contentItems.status, "published"), ne(contentItems.kind, "page"))),
  );
  return new Set(rows.filter((r) => normalizeAr(r.body).includes(n)).map((r) => r.id));
}

export async function getContent(slug: string, kinds: readonly string[] = LIBRARY_KINDS): Promise<ContentRow | null> {
  const [row] = await withSystem((tx) =>
    tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.slug, slug), eq(contentItems.status, "published"), inArray(contentItems.kind, [...kinds])))
      .limit(1),
  );
  return row ?? null;
}

export const getPage = (slug: string) => getContent(slug, ["page"]);

// ───────────── FAQ & glossary ─────────────
export const getFaqs = cache(async () =>
  withSystem((tx) => tx.select().from(faqs).where(eq(faqs.status, "published")).orderBy(asc(faqs.topic), asc(faqs.position))),
);

export const getGlossary = cache(async () =>
  withSystem((tx) => tx.select().from(glossaryTerms).where(eq(glossaryTerms.status, "published")).orderBy(asc(glossaryTerms.term))),
);

// ───────────── holidays (for the registration deadline tool) ─────────────
export async function getHolidays(fromISO: string, toISO: string) {
  return withSystem((tx) => tx.select().from(holidays).where(and(gte(holidays.day, fromISO), lte(holidays.day, toISO))).orderBy(asc(holidays.day)));
}

// ───────────── helpers ─────────────
/** Normalizes Arabic for search: strips diacritics/tatweel, unifies alef/ya/ta marbuta forms. */
export function normalizeAr(s: string) {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}
