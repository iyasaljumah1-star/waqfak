import { createHash, timingSafeEqual } from "node:crypto";
import { runDailyJob } from "@/server/modules/compliance/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const notFound = () => new Response("Not Found", { status: 404 });

/** Constant-time comparison (hashing first removes the length side channel). */
function secretMatches(given: string | null, expected: string) {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * POST /api/jobs/daily — runs the daily compliance job.
 * Enabled only when JOB_SECRET is set; the caller must send `x-job-secret: <JOB_SECRET>`. Otherwise 404.
 */
export async function POST(req: Request) {
  const secret = process.env.JOB_SECRET;
  if (!secret || secret.length < 16) return notFound();
  if (!secretMatches(req.headers.get("x-job-secret"), secret)) return notFound();
  const r = await runDailyJob({ trigger: "http" });
  return Response.json({ id: r.id, status: r.status, detail: r.detail }, { status: r.status === "failed" ? 500 : 200 });
}

export function GET() {
  return notFound();
}
