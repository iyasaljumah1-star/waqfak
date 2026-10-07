import "server-only";
import { eq, lt, or, sql } from "drizzle-orm";
import { withSystem, type Tx } from "../../db";
import { jobRuns, otpChallenges, rateLimits, sessions } from "../../db/schema";
import { recomputeStatuses, resyncAll, sendReminders } from "./engine";

type Step = { name: string; run: (tx: Tx) => Promise<unknown> };

/** Removes expired auth artefacts (kept one day after expiry for troubleshooting). */
async function cleanup(tx: Tx) {
  const s = await tx
    .delete(sessions)
    .where(or(lt(sessions.absoluteExpiresAt, sql`now() - interval '1 day'`), lt(sessions.idleExpiresAt, sql`now() - interval '1 day'`)))
    .returning({ id: sessions.id });
  const o = await tx.delete(otpChallenges).where(lt(otpChallenges.expiresAt, sql`now() - interval '1 day'`)).returning({ id: otpChallenges.id });
  const r = await tx.delete(rateLimits).where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`)).returning({ key: rateLimits.key });
  return { sessions: s.length, otpChallenges: o.length, rateLimits: r.length };
}

/** Document expiry reminders are owned by the documents module; called only if it exposes them. */
async function documentExpiry(tx: Tx) {
  try {
    const mod = (await import("../documents/service")) as Record<string, unknown>;
    const fn = mod.documentExpiryReminders;
    if (typeof fn !== "function") return { skipped: "documentExpiryReminders غير متاح بعد" };
    return (await (fn as (tx: Tx) => Promise<unknown>)(tx)) ?? { ok: true };
  } catch (e) {
    return { skipped: `documents module unavailable: ${(e as Error).message.slice(0, 120)}` };
  }
}

export const DAILY_STEPS: Step[] = [
  { name: "resyncAll", run: (tx) => resyncAll(tx) },
  { name: "recomputeStatuses", run: (tx) => recomputeStatuses(tx) },
  { name: "sendReminders", run: (tx) => sendReminders(tx) },
  { name: "documentExpiryReminders", run: documentExpiry },
  { name: "cleanup", run: cleanup },
];

/**
 * Runs the daily job in system context. Each step has its own transaction so one failure
 * does not roll back the others; the outcome is recorded in job_runs.
 */
export async function runDailyJob(opts: { trigger?: string } = {}) {
  const [run] = await withSystem((tx) => tx.insert(jobRuns).values({ job: "daily", status: "running", detail: { trigger: opts.trigger ?? "script" } }).returning());
  const detail: Record<string, unknown> = { trigger: opts.trigger ?? "script" };
  let failed = 0;
  for (const step of DAILY_STEPS) {
    const t0 = Date.now();
    try {
      const out = await withSystem((tx) => step.run(tx));
      detail[step.name] = { ok: true, ms: Date.now() - t0, result: out };
    } catch (e) {
      failed++;
      detail[step.name] = { ok: false, ms: Date.now() - t0, error: (e as Error).message.slice(0, 500) };
      console.error(`[job daily] ${step.name} failed`, e);
    }
  }
  const status = failed === 0 ? "succeeded" : failed === DAILY_STEPS.length ? "failed" : "partial";
  await withSystem((tx) => tx.update(jobRuns).set({ finishedAt: new Date(), status, detail }).where(eq(jobRuns.id, run.id)));
  return { id: run.id, status, detail };
}
