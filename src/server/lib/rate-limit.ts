import "server-only";
import { sql } from "drizzle-orm";
import { withSystem } from "../db";
import { rateLimits } from "../db/schema";

/**
 * Fixed-window rate limiter backed by PostgreSQL (works across multiple app instances).
 * Returns true when the action is allowed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await withSystem((tx) =>
    tx
      .insert(rateLimits)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
      .returning({ count: rateLimits.count }),
  );
  return rows[0].count <= limit;
}

export class RateLimitError extends Error {
  constructor(message = "عدد المحاولات كبير. انتظر قليلًا ثم أعد المحاولة.") {
    super(message);
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  if (!(await rateLimit(key, limit, windowSeconds))) throw new RateLimitError();
}
