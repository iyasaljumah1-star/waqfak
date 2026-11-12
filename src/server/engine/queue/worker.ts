import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { serviceRequests } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { ENGINE_USER_ID, ENGINE_VERSION } from "../constants";
import { finalApproverIds, processRequest } from "../pipeline/run";
import { retryable, safeError } from "./pure";
import { claimNext, finishJob } from "./queue";

/**
 * Drains due jobs. Used by the independent worker process (scripts/worker.ts, polling) and, right after a submission,
 * by the web process (next/server `after`) so that processing starts at once; both pick with SKIP LOCKED, never twice.
 * The client's page plays no part: closing it changes nothing.
 */
export async function drain(opts: { max?: number; workerId?: string } = {}): Promise<number> {
  const workerId = opts.workerId ?? `web-${process.pid}-${randomUUID().slice(0, 8)}`;
  let done = 0;
  for (let i = 0; i < (opts.max ?? 5); i++) {
    const job = await claimNext(workerId);
    if (!job) break;
    try {
      await processRequest(job);
      await finishJob(job, { ok: true });
    } catch (e) {
      // the error is kept without personal data; data errors are not retried endlessly
      const { dead } = await finishJob(job, { ok: false, error: e, retry: retryable(e) || job.attempts < 3 });
      if (dead) await reportDead(job, e).catch(() => undefined);
      console.error(`[engine] job ${job.id} attempt ${job.attempts} failed: ${e instanceof Error ? e.constructor.name : "Error"}`);
    }
    done++;
  }
  return done;
}

/** A job that gave up after its last attempt is never silent: recorded in the audit log, and the final approvers are told. */
async function reportDead(job: { id: string; requestId: string; waqfId: string | null; attempts: number }, e: unknown) {
  await withSystem(async (tx) => {
    const [r] = await tx.select({ number: serviceRequests.number }).from(serviceRequests).where(eq(serviceRequests.id, job.requestId)).limit(1);
    await audit(tx, { actorUserId: ENGINE_USER_ID, action: "engine.job_dead", entityType: "service_request", entityId: job.requestId, waqfId: job.waqfId, ip: "engine", userAgent: ENGINE_VERSION, after: { job: job.id, attempts: job.attempts, error: safeError(e) } });
    if (!r) return;
    for (const uid of await finalApproverIds(tx))
      await notify(uid, "request.status", { number: r.number, status: "توقفت المعالجة الآلية بعد محاولاتها — تلزم إعادة المحاولة أو المعالجة اليدوية" }, { waqfId: job.waqfId, link: `/admin/review/${job.requestId}`, tx });
  });
}

/** Fire-and-forget kick from the web process (errors are already recorded on the job). */
export function kick() {
  void drain({ max: 1 }).catch(() => undefined);
}
