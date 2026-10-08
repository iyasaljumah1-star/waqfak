import type { MetadataRoute } from "next";

const BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api", "/r/", "/s/", "/assessment/", "/login", "/signup", "/verify", "/recover"] }],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
