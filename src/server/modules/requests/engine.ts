import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { deliverables, holidays, quotes, requestEvents, requestItems, requestStages, roles, serviceRequests, services, userRoles, users, workflowTemplates } from "@/server/db/schema";
import { prestartUnpaid } from "@/server/modules/commerce/state";
import { blocking } from "./items-pure";
import { addBusinessDays, todayISO } from "@/server/engines/dates";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { UserError } from "@/server/modules/_shared";
import type { Auth } from "@/server/authz/context";
import { contractState, loadRequestCtx, type RequestCtx } from "./access";
import {
  advanceStage, availableTransitions, findTransition, guardTransition, planStages, STATUS_LABEL, WAITING_ON_CLIENT,
  type PlanStage, type RequestStatus,
} from "./workflow";

export type ActCtx = { auth: Auth; tx: Tx; ip: string; userAgent: string };

export async function holidaySet(tx: Tx) {
  const rows = await tx.select({ day: holidays.day }).from(holidays);
  return new Set(rows.map((r) => r.day));
}

/** End of the business day (Riyadh) for an ISO date. */
export const endOfDay = (iso: string) => new Date(`${iso}T23:59:59+03:00`);

/**
 * Recomputes SLA due dates: the active stage gets `slaDays` business days from today (or keeps its date if
 * it already has one), and pending stages follow cumulatively. The request SLA = the active stage's due date
 * (5 business days for triage when the template has no stages).
 */
export async function recomputeSla(tx: Tx, requestId: string, opts: { restartActive?: boolean } = {}) {
  const hol = await holidaySet(tx);
  const rows = await tx.select().from(requestStages).where(eq(requestStages.requestId, requestId)).orderBy(asc(requestStages.position));
  const [req] = await tx.select({ status: serviceRequests.status }).from(serviceRequests).where(eq(serviceRequests.id, requestId));
  let cursor = todayISO();
  let requestDue: Date | null = null;
  let currentKey: string | null = null;
  const defs = await stageDefs(tx, requestId);
  for (const st of rows) {
    if (st.status === "done" || st.status === "skipped") continue;
    const days = defs.get(st.stageKey) ?? 5;
    let due: Date;
    if (st.status === "active" && st.slaDueAt && !opts.restartActive) {
      due = st.slaDueAt;
      cursor = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(st.slaDueAt);
    } else {
      cursor = addBusinessDays(cursor, days, hol);
      due = endOfDay(cursor);
    }
    if (st.status === "active") {
      requestDue = due;
      currentKey = st.stageKey;
    }
    await tx.update(requestStages).set({ slaDueAt: due }).where(eq(requestStages.id, st.id));
  }
  if (!rows.length) requestDue = endOfDay(addBusinessDays(todayISO(), 5, hol));
  if (req && ["completed", "closed", "cancelled", "rejected"].includes(req.status)) requestDue = null;
  await tx.update(serviceRequests).set({ slaDueAt: requestDue, currentStageKey: currentKey }).where(eq(serviceRequests.id, requestId));
}

async function stageDefs(tx: Tx, requestId: string) {
  const [r] = await tx
    .select({ stages: workflowTemplates.stages })
    .from(serviceRequests)
    .innerJoin(services, eq(services.id, serviceRequests.serviceId))
    .innerJoin(workflowTemplates, eq(workflowTemplates.code, services.workflowTemplateCode))
    .where(eq(serviceRequests.id, requestId));
  return new Map((r?.stages ?? []).map((s) => [s.key, s.slaDays]));
}

/** Creates request_stages from the workflow template (first stage active) and computes SLA. */
export async function createStages(tx: Tx, requestId: string, waqfId: string | null, defs: RequestCtx["stagesDef"]) {
  if (defs.length) {
    const plan = planStages(defs.map((d) => ({ ...d, status: "pending" as const })), "draft", "submitted");
    await tx.insert(requestStages).values(
      defs.map((d, i) => ({ requestId, waqfId, stageKey: d.key, name: d.name, position: i, status: plan[i], startedAt: plan[i] === "active" ? new Date() : null })),
    );
  }
  await recomputeSla(tx, requestId, { restartActive: true });
}

async function applyStagePlan(tx: Tx, requestId: string, next: string[], actorId: string) {
  const rows = await tx.select().from(requestStages).where(eq(requestStages.requestId, requestId)).orderBy(asc(requestStages.position));
  let restart = false;
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const to = next[i];
    if (!to || to === cur.status) continue;
    const patch: Partial<typeof requestStages.$inferInsert> = { status: to };
    if (to === "active") {
      patch.startedAt = new Date();
      patch.slaDueAt = null;
      restart = true;
    }
    if (to === "done") {
      patch.completedAt = new Date();
      patch.completedBy = actorId;
    }
    if (to === "pending") {
      patch.completedAt = null;
      patch.completedBy = null;
      patch.startedAt = null;
    }
    await tx.update(requestStages).set(patch).where(eq(requestStages.id, cur.id));
  }
  return restart;
}

async function currentPlan(tx: Tx, requestId: string, defs: RequestCtx["stagesDef"]): Promise<PlanStage[]> {
  const rows = await tx.select().from(requestStages).where(eq(requestStages.requestId, requestId)).orderBy(asc(requestStages.position));
  return rows.map((r) => {
    const d = defs.find((x) => x.key === r.stageKey);
    return { key: r.stageKey, role: d?.role ?? "employee", clientApproval: d?.clientApproval, status: r.status as PlanStage["status"] };
  });
}

/** Writes a request event (and nothing else). */
export async function logEvent(tx: Tx, r: { id: string; waqfId: string | null }, actorUserId: string, note: string, from?: string | null, to?: string | null) {
  await tx.insert(requestEvents).values({ requestId: r.id, waqfId: r.waqfId, actorUserId, note, fromStatus: from ?? null, toStatus: to ?? null });
}

export async function opsManagerIds(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, "ops_manager"), eq(users.status, "active")));
  return [...new Set(rows.map((r) => r.id))];
}

export type TransitionInput = {
  to: RequestStatus; note?: string; holdParty?: string; holdFollowUpOn?: string;
  /** Event-driven change made by the platform on behalf of the actor (e.g. all deficiencies answered). Skips the
   *  actor-capacity table, never the business guards. */
  system?: boolean;
};

/**
 * The single entry point for status changes: checks the actor's capacity against the transition table and the
 * business guards, then updates the request, its stages and SLA, and writes the event, audit and notifications.
 */
export async function transition(c: ActCtx, rc: RequestCtx, input: TransitionInput) {
  const { tx, auth } = c;
  const from = rc.req.status as RequestStatus;
  const to = input.to;
  const t = findTransition(from, to);
  if (!t) throw new UserError(`لا يمكن نقل الطلب من «${STATUS_LABEL[from]}» إلى «${STATUS_LABEL[to]}».`);
  const allowed = input.system || availableTransitions(from, rc.actors, { resumeTo: rc.resumeTo }).some((x) => x.to === to);
  if (!allowed) {
    if (from === "quality_review" && to === "awaiting_client_approval" && rc.deliverers.includes(auth.user.id))
      throw new UserError("مبدأ العينين الأربع: يراجع جودةَ العمل زميلٌ آخر غير من أعدّه.");
    throw new UserError("ليست لديك صلاحية لهذا الإجراء على الطلب في حالته الحالية.");
  }
  const note = input.note?.trim() ?? "";
  if (t.needsNote && note.length < 3) throw new UserError("اكتب سببًا أو ملاحظة توضح هذا الإجراء.");
  if (from === "triage" && to === "in_progress" && rc.service.pricingModel !== "free" && !rc.isOps && !input.system)
    throw new UserError("الخدمة مدفوعة: يبدأ تنفيذها بعد عرض السعر والعقد، أو بقرار من مدير التشغيل (كخدمة مشمولة بباقة).");
  if (to === "on_hold" && !input.holdParty) throw new UserError("حدّد الجهة التي ينتظرها الطلب.");

  const subs = await tx.select({ status: deliverables.status, signedBy: deliverables.signedBy }).from(deliverables).where(eq(deliverables.requestId, rc.req.id));
  const submitted = subs.filter((d) => d.status === "submitted" || d.status === "approved");
  const cs = await contractState(tx, rc.req.id);
  const items = await tx.select({ kind: requestItems.kind, status: requestItems.status, visibility: requestItems.visibility, required: requestItems.required }).from(requestItems).where(eq(requestItems.requestId, rc.req.id));
  const qs = await tx.select({ status: quotes.status }).from(quotes).where(and(eq(quotes.requestId, rc.req.id), eq(quotes.kind, "initial")));
  const err = guardTransition({
    from, to, actorUserId: auth.user.id, conflictCheck: rc.req.conflictCheck, workflowCode: rc.workflowCode, deliverers: rc.deliverers,
    submittedDeliverables: submitted.length, unsignedOpinionDeliverables: submitted.filter((d) => !d.signedBy?.trim()).length,
    contractSignedByClient: cs.clientSigned, hasContract: !!cs.contract, quoteAmount: rc.req.quoteAmount ? Number(rc.req.quoteAmount) : null,
    pricingModel: rc.service.pricingModel,
    verified: !!rc.req.intakeVerifiedAt, accepted: !!rc.req.acceptedAt, blockingItems: items.filter(blocking).length,
    hasQuotes: qs.length > 0, quoteAccepted: qs.some((q) => q.status === "accepted"),
    contractExecuted: cs.contract && cs.parties.length ? cs.executed : undefined,
    prestartUnpaid: from === "awaiting_contract" && to === "in_progress" ? await prestartUnpaid(tx, rc.req.id) : 0,
  });
  if (err) throw new UserError(err);

  const now = new Date();
  const patch: Partial<typeof serviceRequests.$inferInsert> = { status: to, updatedBy: auth.user.id };
  if (to === "on_hold") Object.assign(patch, { holdReason: note, holdParty: input.holdParty, holdFollowUpOn: input.holdFollowUpOn || null });
  if (from === "on_hold") Object.assign(patch, { holdReason: null, holdParty: null, holdFollowUpOn: null });
  if (to === "cancelled") patch.cancelReason = note || null;
  if (to === "rejected") patch.rejectReason = note || null;
  if (to === "submitted") patch.submittedAt = now;
  if (to === "completed") patch.completedAt = now;
  if (to === "closed") patch.closedAt = now;
  if (to === "awaiting_contract" && rc.req.quoteAmount && !patch.agreedPrice) patch.agreedPrice = rc.req.quoteAmount;
  if (to === "in_progress" && !rc.req.startApprovedAt) Object.assign(patch, { startApprovedAt: now, startApprovedBy: auth.user.id });
  await tx.update(serviceRequests).set(patch).where(eq(serviceRequests.id, rc.req.id));

  // Deliverable side-effects
  if (from === "awaiting_client_approval" && to === "completed")
    await tx.update(deliverables).set({ status: "approved", approvedAt: now, approvedBy: auth.user.id }).where(and(eq(deliverables.requestId, rc.req.id), eq(deliverables.status, "submitted")));
  if (from === "awaiting_client_approval" && to === "in_progress")
    await tx.update(deliverables).set({ status: "revision_requested", revisionNote: note }).where(and(eq(deliverables.requestId, rc.req.id), eq(deliverables.status, "submitted")));

  // Stages + SLA (hold/awaiting_client keep stage statuses; resuming restarts the clock of the active stage)
  const plan = await currentPlan(tx, rc.req.id, rc.stagesDef);
  const next = planStages(plan, from, to);
  const restarted = await applyStagePlan(tx, rc.req.id, next, auth.user.id);
  await recomputeSla(tx, rc.req.id, { restartActive: restarted || from === "on_hold" });

  const eventNote = [t.label, note].filter(Boolean).join(" — ");
  await logEvent(tx, rc.req, auth.user.id, eventNote, from, to);
  await audit(tx, {
    actorUserId: auth.user.id, action: `requests.transition.${to}`, entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId,
    ip: c.ip, userAgent: c.userAgent, before: { status: from }, after: { status: to, note: note || undefined, holdParty: input.holdParty },
  });

  // Notifications: the client hears about every change; staff hear about client actions.
  const link = `/app/requests/${rc.req.id}`;
  const vars = { number: rc.req.number, status: STATUS_LABEL[to], note: note || t.label };
  if (rc.req.requesterUserId !== auth.user.id) {
    if (WAITING_ON_CLIENT.includes(to)) await notify(rc.req.requesterUserId, "request.awaiting_client", vars, { waqfId: rc.req.waqfId, link, tx });
    else await notify(rc.req.requesterUserId, "request.status", vars, { waqfId: rc.req.waqfId, link, tx });
  }
  if (rc.actors.includes("client") && !rc.actors.includes("assignee") && rc.req.assignedToUserId && rc.req.assignedToUserId !== auth.user.id)
    await notify(rc.req.assignedToUserId, "request.status", vars, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}`, tx });
}

/** Completes the active work stage and activates the next one (inside in_progress). */
export async function advance(c: ActCtx, rc: RequestCtx) {
  if (rc.req.status !== "in_progress") throw new UserError("تُنقل المراحل الداخلية أثناء التنفيذ فقط.");
  if (!rc.actors.includes("assignee") && !rc.actors.includes("ops")) throw new UserError("ليست لديك صلاحية لهذا الإجراء.");
  const plan = await currentPlan(c.tx, rc.req.id, rc.stagesDef);
  const next = advanceStage(plan);
  if (!next) throw new UserError("هذه آخر مرحلة عمل. أرسل الطلب لمراجعة الجودة.");
  const a = plan.findIndex((p) => p.status === "active");
  await applyStagePlan(c.tx, rc.req.id, next, c.auth.user.id);
  await recomputeSla(c.tx, rc.req.id, { restartActive: true });
  const def = rc.stagesDef[a];
  await logEvent(c.tx, rc.req, c.auth.user.id, `اكتملت مرحلة «${def?.name ?? plan[a].key}»`);
  await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.stage_advance", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { completed: plan[a].key } });
}

/** Loads the request (staff or client side) and runs a transition. */
export async function runTransition(c: ActCtx, id: string, side: "client" | "staff", input: TransitionInput) {
  const rc = await loadRequestCtx(c.tx, c.auth, id, side);
  await transition(c, rc, input);
  return rc;
}

