import type { MetadataRoute } from "next";
import { LEGAL_PAGES } from "@/components/site/labels";
import { TOOLS } from "@/components/site/tools/registry";
import { getCatalog, getLibrary } from "@/server/modules/public/queries";

export const dynamic = "force-dynamic";

const BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ services }, library] = await Promise.all([getCatalog(), getLibrary()]);
  const now = new Date();
  const fixed: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["/", 1, "weekly"],
    ["/assessment", 0.9, "monthly"],
    ["/services", 0.9, "weekly"],
    ["/packages", 0.8, "monthly"],
    ["/for/waqif", 0.8, "monthly"],
    ["/for/nazir", 0.8, "monthly"],
    ["/for/beneficiary", 0.7, "monthly"],
    ["/for/entities", 0.7, "monthly"],
    ["/library", 0.8, "weekly"],
    ["/regulations", 0.8, "monthly"],
    ["/faq", 0.7, "monthly"],
    ["/glossary", 0.6, "monthly"],
    ["/tools", 0.7, "monthly"],
    ["/about", 0.5, "yearly"],
    ["/contact", 0.5, "yearly"],
  ];
  return [
    ...fixed.map(([p, priority, changeFrequency]) => ({ url: `${BASE}${p}`, lastModified: now, priority, changeFrequency })),
    ...TOOLS.map((t) => ({ url: `${BASE}/tools/${t.slug}`, lastModified: now, priority: 0.6, changeFrequency: "monthly" as const })),
    ...LEGAL_PAGES.map((l) => ({ url: `${BASE}/legal/${l.key}`, lastModified: now, priority: 0.3, changeFrequency: "yearly" as const })),
    ...services.map((s) => ({ url: `${BASE}/services/${s.code}`, lastModified: s.updatedAt, priority: 0.7, changeFrequency: "monthly" as const })),
    ...library.map((i) => ({ url: `${BASE}/library/${i.slug}`, lastModified: i.updatedAt, priority: i.kind === "regulation" ? 0.7 : 0.6, changeFrequency: "monthly" as const })),
  ];
}
