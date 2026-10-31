import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withContext } from "@/server/db";
import {
  documents, outputVersions, outputs, processingJobs, processingRuns, processingSteps, requestEvents, requestItems, serviceRequests, services, tasks, users, waqfs,
} from "@/server/db/schema";
import { ForbiddenError, type Auth } from "@/server/authz/context";
import { PROFESSIONAL_REQUIREMENTS } from "../constants";

/**
 * The system administrator's screen (read side). Everything an approval rests on, in one place: the request and its
 * inputs, what the client was asked, the processing record (steps, rules, sources, model), the output and its versions,
 * the verification, and the request's log. Staff only, «outputs.final_approve» to act.
 */

const ENGINE_OPEN = ["submitted", "triage", "awaiting_client", "in_progress", "quality_review"] as const;

export type QueueGroup = "ready" | "processing" | "client" | "blocked" | "approved";

export async function reviewQueue(auth: Auth) {
  if (!auth.isStaff || !auth.perms.has("admin.requests.all")) throw new ForbiddenError();
  return withContext(auth.db, async (tx) => {
    const rows = await tx.select({ r: serviceRequests, service: services.nameAr, code: services.code, waqf: waqfs.name, requester: users.fullName })
      .from(serviceRequests).innerJoin(services, eq(services.id, serviceRequests.serviceId)).leftJoin(waqfs, eq(waqfs.id, serviceRequests.waqfId)).leftJoin(users, eq(users.id, serviceRequests.requesterUserId))
      .where(and(eq(serviceRequests.processingMode, "engine"), inArray(serviceRequests.status, [...ENGINE_OPEN, "completed"]))).orderBy(desc(serviceRequests.updatedAt)).limit(300);
    const ids = rows.map((x) => x.r.id);
    const runs = ids.length ? await tx.select().from(processingRuns).where(inArray(processingRuns.requestId, ids)).orderBy(desc(processingRuns.startedAt)) : [];
    const jobs = ids.length ? await tx.select().from(processingJobs).where(inArray(processingJobs.requestId, ids)).orderBy(desc(processingJobs.createdAt)) : [];
    return rows.map((x) => {
      const last = runs.find((r) => r.requestId === x.r.id) ?? null;
      const job = jobs.find((j) => j.requestId === x.r.id) ?? null;
      const active = job && ["queued", "running"].includes(job.status);
      const group: QueueGroup = x.r.status === "completed" ? "approved"
        : x.r.status === "quality_review" ? "ready"
        : x.r.status === "awaiting_client" ? "client"
        : active ? "processing"
        : job?.status === "dead" || last?.status === "blocked" || last?.status === "failed" || last?.status === "waiting" ? "blocked"
        : "processing";
      return {
        id: x.r.id, number: x.r.number, status: x.r.status, service: x.service, code: x.code, waqf: x.waqf, requester: x.requester, updatedAt: x.r.updatedAt, submittedAt: x.r.submittedAt,
        group, lastRun: last ? { status: last.status, at: last.finishedAt ?? last.startedAt, outcome: last.outcome } : null, job: job ? { status: job.status, attempts: job.attempts, lastError: job.lastError } : null,
      };
    });
  });
}

export async function reviewDetail(auth: Auth, id: string) {
  if (!auth.isStaff || !auth.perms.has("admin.requests.all")) throw new ForbiddenError();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withContext(auth.db, async (tx) => {
    const [x] = await tx.select({ r: serviceRequests, service: services, waqf: waqfs, requester: users.fullName })
      .from(serviceRequests).innerJoin(services, eq(services.id, serviceRequests.serviceId)).leftJoin(waqfs, eq(waqfs.id, serviceRequests.waqfId)).leftJoin(users, eq(users.id, serviceRequests.requesterUserId))
      .where(eq(serviceRequests.id, id)).limit(1);
    if (!x) return null;
    const [docs, items, outs, runs, jobs, events, corrections] = await Promise.all([
      tx.select({ id: documents.id, title: documents.title, docType: documents.docType, approvalStatus: documents.approvalStatus, createdAt: documents.createdAt }).from(documents).where(eq(documents.requestId, id)).orderBy(asc(documents.createdAt)),
      tx.select().from(requestItems).where(eq(requestItems.requestId, id)).orderBy(asc(requestItems.seq)),
      tx.select().from(outputs).where(eq(outputs.requestId, id)).orderBy(asc(outputs.createdAt)),
      tx.select().from(processingRuns).where(eq(processingRuns.requestId, id)).orderBy(desc(processingRuns.startedAt)).limit(20),
      tx.select().from(processingJobs).where(eq(processingJobs.requestId, id)).orderBy(desc(processingJobs.createdAt)).limit(20),
      tx.select({ e: requestEvents, actor: users.fullName }).from(requestEvents).leftJoin(users, eq(users.id, requestEvents.actorUserId)).where(eq(requestEvents.requestId, id)).orderBy(desc(requestEvents.at)).limit(100),
      tx.select().from(tasks).where(and(eq(tasks.requestId, id), eq(tasks.kind, "correction_request"))).orderBy(desc(tasks.createdAt)),
    ]);
    const lastRun = runs[0] ?? null;
    const steps = lastRun ? await tx.select().from(processingSteps).where(eq(processingSteps.runId, lastRun.id)).orderBy(asc(processingSteps.seq)) : [];
    const versions = outs.length ? await tx.select({ outputId: outputVersions.outputId, version: outputVersions.version, origin: outputVersions.origin, note: outputVersions.note, createdAt: outputVersions.createdAt, createdBy: outputVersions.createdBy, sections: outputVersions.sections, gaps: outputVersions.gaps })
      .from(outputVersions).where(inArray(outputVersions.outputId, outs.map((o) => o.id))).orderBy(desc(outputVersions.version)) : [];
    return {
      request: x.r, service: x.service, waqf: x.waqf, requester: x.requester, docs, items, outputs: outs, versions, runs, steps, jobs, corrections,
      events: events.map((e) => ({ ...e.e, actor: e.actor })),
      professional: PROFESSIONAL_REQUIREMENTS[x.service.code] ?? null,
      canApprove: auth.perms.has("outputs.final_approve"),
    };
  });
}
