import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/** Liveness + database readiness for the load balancer / container healthcheck. Reveals nothing sensitive. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
