import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { withSystem, type Tx } from "@/server/db";
import { featureFlags, processingJobs, settings } from "@/server/db/schema";
import { backoffMs, safeError } from "./pure";

/**
 * The processing queue (PostgreSQL). A job is picked with FOR UPDATE SKIP LOCKED, so the web process and the
 * independent worker can both drain it without running a job twice; at most one queued or running job exists per
 * request (partial unique index), so a repeated submission or a double click never queues the work twice.
 */

/** Whether new requests of a service are processed by the engine: flag «engine.enabled» and setting «engine.services». */
export async function engineEnabledFor(tx: Tx, code: string): Promise<boolean> {
  const [f] = await tx.select({ on: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, "engine.enabled")).limit(1);
  if (!f?.on) return false;
  const [s] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, "engine.services")).limit(1);
  return Array.isArray(s?.v) && (s.v as unknown[]).includes(code);
}

/** Queues processing for a request (idempotent: an active job for the request absorbs the new one). */
export async function enqueueProcessing(tx: Tx, p: { requestId: string; waqfId: string | null; reason: string; requestedBy?: string | null; instruction?: string | null; kind?: "process" | "verify"; delayMs?: number }) {
  await tx.insert(processingJobs).values({
    requestId: p.requestId, waqfId: p.waqfId, reason: p.reason, requestedBy: p.requestedBy ?? null, instruction: p.instruction ?? null,
    kind: p.kind ?? "process", runAfter: new Date(Date.now() + (p.delayMs ?? 0)),
  }).onConflictDoNothing();
}

export type ClaimedJob = typeof processingJobs.$inferSelect;

/** Claims the next due job (or null). Jobs left «running» by a crashed process for more than 10 minutes are retaken. */
export async function claimNext(workerId: string): Promise<ClaimedJob | null> {
  return withSystem(async (tx) => {
    const stale = new Date(Date.now() - 10 * 60_000);
    const [j] = await tx.select().from(processingJobs)
      .where(sql`(${processingJobs.status} = 'queued' and ${processingJobs.runAfter} <= now()) or (${processingJobs.status} = 'running' and ${processingJobs.lockedAt} < ${stale.toISOString()}::timestamptz)`)
      .orderBy(asc(processingJobs.runAfter)).limit(1).for("update", { skipLocked: true });
    if (!j) return null;
    const [upd] = await tx.update(processingJobs).set({ status: "running", lockedAt: new Date(), lockedBy: workerId, attempts: j.attempts + 1, updatedAt: new Date() })
      .where(eq(processingJobs.id, j.id)).returning();
    return upd;
  });
}

/** Records the end of an attempt: done, or retried later with a growing delay, or given up («dead») after the last attempt. */
export async function finishJob(job: ClaimedJob, result: { ok: true } | { ok: false; error: unknown; retry: boolean }): Promise<{ dead: boolean }> {
  return withSystem(async (tx) => {
    if (result.ok) {
      await tx.update(processingJobs).set({ status: "succeeded", finishedAt: new Date(), lockedAt: null, lockedBy: null, updatedAt: new Date() }).where(eq(processingJobs.id, job.id));
      return { dead: false };
    }
    const last = !result.retry || job.attempts >= job.maxAttempts;
    await tx.update(processingJobs).set({
      status: last ? "dead" : "queued", lastError: safeError(result.error), lockedAt: null, lockedBy: null, updatedAt: new Date(),
      runAfter: new Date(Date.now() + backoffMs(job.attempts)), finishedAt: last ? new Date() : null,
    }).where(eq(processingJobs.id, job.id));
    return { dead: last };
  });
}

/** Requeues a dead or failed job by hand (system administrator), keeping its history. */
export async function retryDead(tx: Tx, requestId: string, actorId: string) {
  const dead = await tx.select().from(processingJobs).where(and(eq(processingJobs.requestId, requestId), inArray(processingJobs.status, ["dead", "failed"]))).limit(1);
  if (!dead.length) return false;
  await enqueueProcessing(tx, { requestId, waqfId: dead[0].waqfId, reason: "إعادة المحاولة بعد تعذر المعالجة", requestedBy: actorId });
  return true;
}

/** Jobs due now (for the worker's idle check and the tests). */
export async function dueCount(): Promise<number> {
  return withSystem(async (tx) => {
    const rows = await tx.select({ id: processingJobs.id }).from(processingJobs).where(and(eq(processingJobs.status, "queued"), lte(processingJobs.runAfter, new Date())));
    return rows.length;
  });
}
