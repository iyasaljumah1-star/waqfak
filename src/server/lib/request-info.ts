import "server-only";
import { headers } from "next/headers";

export async function requestInfo() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : h.get("x-real-ip")) ?? "local";
  return { ip: ip.trim(), userAgent: h.get("user-agent")?.slice(0, 300) ?? "" };
}
