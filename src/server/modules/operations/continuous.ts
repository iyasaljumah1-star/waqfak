import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  serviceRequests, services, waqfs,
  assets, beneficiaries, contracts, deliverables, distributions, investmentPolicies, ledgerEntries, leases, meetings, minutes, outputs,
  outputVersions, quotes, requestItems, serviceCycles, serviceTerms, tasks, users,
} from "@/server/db/schema";
import type { PaymentTerm } from "@/server/db/schema/commerce";
import type { TermEvent } from "@/server/db/schema/operations";
import { todayISO } from "@/server/engines/dates";
import { ledgerOf } from "@/server/modules/commerce/state";
import { cycleOutputDef, type OutputDef } from "@/server/modules/outputs/catalog";
import { approvalCheck, readiness } from "@/server/modules/outputs/pure";
import { preparersOf } from "@/server/modules/outputs/server";
import type { RequestCtx } from "@/server/modules/requests/access";
import type { RequestStatus } from "@/server/modules/requests/workflow";
import type { Auth } from "@/server/authz/context";
import {
  CADENCE_AR, CONTINUOUS_CODES, continuousSpec, cycleCounts, cyclePhase, effectiveEnd, endBlockers, isLate, nextPeriodic, parseCycleKey, PHASE_AR, schedule, termState,
  TERM_AR, type ContinuousSnap, type ContinuousSpec, type CycleInput,
} from "./continuous-pure";

export type TermRow = typeof serviceTerms.$inferSelect;
export type CycleRow = typeof serviceCycles.$inferSelect;

export const specOf = (rc: Pick<RequestCtx, "service">) => continuousSpec(rc.service.code);

export async function termOf(tx: Tx, requestId: string) {
  const [t] = await tx.select().from(serviceTerms).where(eq(serviceTerms.requestId, requestId)).limit(1);
  return t ?? null;
}

export async function cyclesOf(tx: Tx, requestId: string) {
  return tx.select().from(serviceCycles).where(eq(serviceCycles.requestId, requestId)).orderBy(asc(serviceCycles.seq));
}

/** The output definition behind a cycle output key (`N01.cycle@c3`), with its cycle. */
export async function cycleOutputFor(tx: Tx, rc: RequestCtx, outputKey: string): Promise<{ def: OutputDef; cycle: CycleRow } | null> {
  const k = parseCycleKey(outputKey);
  const spec = specOf(rc);
  if (!k || !spec || k.code !== rc.service.code) return null;
  const [cycle] = await tx.select().from(serviceCycles).where(and(eq(serviceCycles.requestId, rc.req.id), eq(serviceCycles.seq, k.seq))).limit(1);
  if (!cycle || cycle.outputKey !== outputKey) return null;
  const d = k.closing ? (spec.closing ? { title: spec.closing.title, profile: spec.closing.profile, review: "independent" as const } : null)
    : spec.delivery.kind === "output" ? spec.delivery : null;
  if (!d) return null;
  return { def: cycleOutputDef(outputKey, d, cycle.label), cycle };
}

/** The cycle's required inputs, checked against the waqf's records for the cycle's period. */
export async function inputChecks(tx: Tx, rc: RequestCtx, cycle: CycleRow, spec: ContinuousSpec) {
  const wid = rc.req.waqfId;
  const from = cycle.periodStart ?? cycle.dueOn;
  const to = cycle.periodEnd ?? cycle.dueOn;
  const out: { key: string; label: string; ok: boolean; detail: string }[] = [];
  for (const i of spec.inputs as CycleInput[]) {
    if (!wid && i.check !== "meeting_linked") { out.push({ key: i.key, label: i.label, ok: false, detail: "الطلب غير مرتبط بملف وقف" }); continue; }
    let ok = false;
    let detail = "";
    switch (i.check) {
      case "ledger_in_period": {
        const rows = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.waqfId, wid!), gte(ledgerEntries.entryDate, from), lte(ledgerEntries.entryDate, to))).limit(500);
        ok = rows.length > 0; detail = ok ? `${rows.length} قيدًا بين ${from} و${to}` : `لا قيود بين ${from} و${to}`;
        break;
      }
      case "distribution_in_period": {
        const rows = await tx.select({ id: distributions.id }).from(distributions).where(and(eq(distributions.waqfId, wid!), gte(distributions.dueBy, from), lte(distributions.dueBy, to)));
        ok = rows.length > 0; detail = ok ? `${rows.length} دفعة صرف مستحقة في الفترة` : "لا دفعة صرف مسجلة في الفترة";
        break;
      }
      case "meeting_linked": {
        ok = !!cycle.meetingId; detail = ok ? "مرتبط باجتماع في الحوكمة" : "لم يُربط اجتماع بالدورة";
        break;
      }
      case "minutes_approved": {
        const m = cycle.meetingId ? await tx.select({ status: minutes.status }).from(minutes).where(eq(minutes.meetingId, cycle.meetingId)).orderBy(desc(minutes.version)).limit(1) : [];
        ok = !!m[0] && (m[0].status === "approved" || m[0].status === "locked"); detail = m[0] ? `حالة المحضر: ${({ draft: "مسودة", circulated: "معمم للاعتماد", approved: "معتمد", locked: "معتمد ومقفل" } as Record<string, string>)[m[0].status]}` : "لا محضر للاجتماع";
        break;
      }
      case "assets": {
        const rows = await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.waqfId, wid!), isNull(assets.archivedAt))).limit(1);
        ok = rows.length > 0; detail = ok ? "أصول مسجلة" : "لا أصول مسجلة في ملف الوقف";
        break;
      }
      case "beneficiaries": {
        const rows = await tx.select({ id: beneficiaries.id }).from(beneficiaries).where(and(eq(beneficiaries.waqfId, wid!), isNull(beneficiaries.archivedAt))).limit(1);
        ok = rows.length > 0; detail = ok ? "سجل مستفيدين قائم" : "لا مستفيدين مسجلين";
        break;
      }
      case "investment_policy": {
        const rows = await tx.select({ status: investmentPolicies.status }).from(investmentPolicies).where(eq(investmentPolicies.waqfId, wid!)).orderBy(desc(investmentPolicies.version)).limit(1);
        ok = rows[0]?.status === "approved"; detail = rows[0] ? `آخر سياسة: ${rows[0].status === "approved" ? "معتمدة" : "غير معتمدة"}` : "لا سياسة استثمار";
        break;
      }
      case "leases": {
        const rows = await tx.select({ id: leases.id }).from(leases).where(eq(leases.waqfId, wid!)).limit(1);
        ok = rows.length > 0; detail = ok ? "عقود إيجار مسجلة" : "لا عقود إيجار مسجلة";
        break;
      }
    }
    out.push({ key: i.key, label: i.label, ok, detail });
  }
  return out;
}

/** Appends an entry to the term's history (kept on the row; every change is also audited). */
export const termEvent = (t: TermRow, e: Omit<TermEvent, "at">): TermEvent[] => [...(t.history ?? []), { at: new Date().toISOString(), ...e }];

/**
 * Keeps the service term in step with the request: a hold suspends the service, resuming re-activates it, and a
 * cancellation of the request terminates the term (open cycles are skipped with the reason; nothing is deleted).
 */
export async function syncTermWithRequest(tx: Tx, requestId: string, from: RequestStatus, to: RequestStatus, actorId: string, note: string) {
  const t = await termOf(tx, requestId);
  if (!t) return;
  if (to === "on_hold" && t.status === "active") {
    await tx.update(serviceTerms).set({ status: "suspended", suspendedAt: new Date(), suspendReason: note || null, history: termEvent(t, { by: actorId, kind: "suspend", note }), updatedBy: actorId }).where(eq(serviceTerms.id, t.id));
  } else if (from === "on_hold" && to !== "cancelled" && t.status === "suspended") {
    await tx.update(serviceTerms).set({ status: "active", suspendedAt: null, suspendReason: null, history: termEvent(t, { by: actorId, kind: "resume", note: t.suspendReason }), updatedBy: actorId }).where(eq(serviceTerms.id, t.id));
  } else if (to === "cancelled" && t.status !== "terminated") {
    const today = todayISO();
    await tx.update(serviceTerms).set({
      status: "terminated", terminatedOn: today < t.endOn ? today : t.endOn, terminationReason: `إلغاء الطلب: ${note}`, terminatedBy: actorId,
      history: termEvent(t, { by: actorId, kind: "terminate", note: `إلغاء الطلب: ${note}` }), updatedBy: actorId,
    }).where(eq(serviceTerms.id, t.id));
    await tx.update(serviceCycles).set({ status: "skipped", skippedReason: `أُلغي الطلب: ${note}`, updatedBy: actorId }).where(and(eq(serviceCycles.requestId, requestId), eq(serviceCycles.status, "open")));
  }
}

/** What the request guards and the execution plan need about the continuous service. */
export async function continuousFacts(tx: Tx, rc: RequestCtx) {
  const spec = specOf(rc);
  if (!spec) return null;
  const today = todayISO();
  const t = await termOf(tx, rc.req.id);
  const cs = t ? await cyclesOf(tx, rc.req.id) : [];
  const like = t ? { cadence: t.cadence, startOn: t.startOn, endOn: t.endOn, dueOffsetDays: t.dueOffsetDays, status: t.status, terminatedOn: t.terminatedOn } : null;
  return { spec, term: t, cycles: cs, endBlockers: endBlockers(spec, like, cs, today), state: like ? termState(like, today) : null, today };
}

// ───────────────────────── Snapshot for the execution plan ─────────────────────────


export async function continuousSnapshot(tx: Tx, auth: Auth, rc: RequestCtx): Promise<ContinuousSnap | null> {
  const f = await continuousFacts(tx, rc);
  if (!f) return null;
  const { spec, term: t, cycles: cs, today } = f;
  const keys = cs.map((c) => c.outputKey).filter((x): x is string => !!x);
  const outs = keys.length ? await tx.select().from(outputs).where(and(eq(outputs.requestId, rc.req.id), inArray(outputs.outputKey, keys))) : [];
  const vers = outs.length ? await tx.select().from(outputVersions).where(inArray(outputVersions.outputId, outs.map((o) => o.id))) : [];
  const like = t ? { cadence: t.cadence, startOn: t.startOn, endOn: t.endOn, dueOffsetDays: t.dueOffsetDays, status: t.status, terminatedOn: t.terminatedOn } : null;
  const ts = like ? termState(like, today) : null;
  const rows: ContinuousSnap["cycles"] = [];
  for (const c of cs) {
    const o = c.outputKey ? outs.find((x) => x.outputKey === c.outputKey) ?? null : null;
    const v = o ? vers.find((x) => x.outputId === o.id && x.version === o.currentVersion) : null;
    const ready = v ? readiness(v.sections, v.gaps) : null;
    const kind = c.kind === "closing" ? "output" : spec.delivery.kind;
    const phase = cyclePhase(c, o ? { status: o.status } : null, kind);
    let viewerCanApprove = false;
    let reason: string | undefined;
    if (o?.status === "in_review") {
      const ck = approvalCheck({ policy: o.reviewPolicy, approverId: auth.user.id, preparers: await preparersOf(tx, o), canReview: auth.perms.has("staff.quality_review"), isManager: auth.perms.has("admin.requests.all") });
      viewerCanApprove = ck.ok;
      if (!ck.ok) reason = ck.error;
    }
    const missing = c.status === "open" ? (await inputChecks(tx, rc, c, spec)).filter((x) => !x.ok).map((x) => `${x.label}: ${x.detail}`) : [];
    rows.push({
      id: c.id, seq: c.seq, label: c.label, due: c.dueOn, late: !!ts && isLate(c, today, ts), phase, kind: c.kind,
      outputKey: c.outputKey, outputId: o?.id ?? null, outputStatus: o?.status ?? null, returnedNote: o?.status === "returned" ? o.reviewNote : null,
      blocking: (ready?.blocking ?? []).map((g) => g.label), unwritten: (ready?.unwritten ?? []).map((u) => u.section),
      viewerCanApprove, approveBlockedReason: reason, inputsMissing: missing, checklistOpen: (c.checklist ?? []).filter((x) => !x.done).length,
    });
  }
  const nxt = like ? nextPeriodic(like, cs) : null;
  const finished = ts === "ended" || ts === "terminated";
  return {
    hasTerm: !!t, termState: ts, termLabel: ts ? TERM_AR[ts] : null, cadence: CADENCE_AR[t?.cadence ?? spec.cadence], deliveryKind: spec.delivery.kind,
    next: nxt ? { label: nxt.label, due: nxt.due } : null,
    // A periodic cycle may be opened once its period has started (no deliveries ahead of their period).
    canOpenNext: !!nxt && ts !== "suspended" && nxt.from <= today,
    closingDue: !!spec.closing && finished && !cs.some((c) => c.kind === "closing"),
    cycles: rows,
    endBlockers: f.endBlockers,
  };
}

// ───────────────────────── Dashboard ─────────────────────────

export async function continuousView(tx: Tx, auth: Auth, rc: RequestCtx) {
  const f = await continuousFacts(tx, rc);
  if (!f) return null;
  const snap = (await continuousSnapshot(tx, auth, rc))!;
  const { spec, term: t, cycles: cs, today } = f;
  const [k] = await tx.select({ id: contracts.id, number: contracts.number, status: contracts.status, executedAt: contracts.executedAt, signedAt: contracts.signedAt })
    .from(contracts).where(and(eq(contracts.requestId, rc.req.id), isNull(contracts.parentContractId), ne(contracts.status, "void"))).orderBy(desc(contracts.createdAt)).limit(1);
  const [q] = await tx.select().from(quotes).where(and(eq(quotes.requestId, rc.req.id), eq(quotes.kind, "initial"), eq(quotes.status, "accepted"))).orderBy(desc(quotes.version)).limit(1);
  const ledger = await ledgerOf(tx, rc.req.id);
  const installments = q ? (q.paymentTerms as PaymentTerm[]).map((pt) => {
    const invs = ledger.invoices.filter((i) => i.quoteId === q.id && i.installmentKey === pt.key && i.status !== "void" && i.kind !== "credit_note");
    return { key: pt.key, label: pt.label, percent: pt.percent, due: pt.due, invoices: invs.map((i) => ({ id: i.id, number: i.number, status: i.status, total: Number(i.total), dueOn: i.dueOn, einvoiceStatus: i.einvoiceStatus })) };
  }) : [];
  const dels = await tx.select().from(deliverables).where(and(eq(deliverables.requestId, rc.req.id)));
  const meetingIds = cs.map((c) => c.meetingId).filter((x): x is string => !!x);
  const mts = meetingIds.length ? await tx.select({ id: meetings.id, title: meetings.title, at: meetings.scheduledAt, status: meetings.status }).from(meetings).where(inArray(meetings.id, meetingIds)) : [];
  const waqfMeetings = rc.req.waqfId ? await tx.select({ id: meetings.id, title: meetings.title, at: meetings.scheduledAt, status: meetings.status }).from(meetings).where(eq(meetings.waqfId, rc.req.waqfId)).orderBy(desc(meetings.scheduledAt)).limit(30) : [];
  const ids = [...new Set(cs.flatMap((c) => [c.assigneeUserId, c.sentBy, c.closedBy]).filter((x): x is string => !!x))];
  const people = ids.length ? new Map((await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids))).map((p) => [p.id, p.name ?? "—"])) : new Map<string, string>();
  const outs = cs.some((c) => c.outputKey) ? await tx.select({ id: outputs.id, key: outputs.outputKey, version: outputs.currentVersion, approvedVersion: outputs.approvedVersion, approvedBy: outputs.approvedBy, approvedAt: outputs.approvedAt, documentId: outputs.documentId, number: outputs.number }).from(outputs).where(eq(outputs.requestId, rc.req.id)) : [];
  const appr = [...new Set(outs.map((o) => o.approvedBy).filter((x): x is string => !!x))];
  if (appr.length) for (const p of await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, appr))) people.set(p.id, p.name ?? "—");
  const items = await tx.select({ status: requestItems.status, visibility: requestItems.visibility, required: requestItems.required }).from(requestItems).where(eq(requestItems.requestId, rc.req.id));
  const openTasks = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.requestId, rc.req.id), inArray(tasks.status, ["todo", "in_progress"])));
  const cycles = [];
  for (const c of cs) {
    const s = snap.cycles.find((x) => x.id === c.id)!;
    const o = c.outputKey ? outs.find((x) => x.key === c.outputKey) ?? null : null;
    const d = dels.find((x) => x.cycleId === c.id && x.releasedAt) ?? null;
    const m = c.meetingId ? mts.find((x) => x.id === c.meetingId) ?? null : null;
    cycles.push({
      ...c, phase: s.phase, phaseLabel: PHASE_AR[s.phase], late: s.late, inputs: c.status === "open" ? await inputChecks(tx, rc, c, spec) : [],
      blocking: s.blocking, unwritten: s.unwritten, outputStatus: s.outputStatus, returnedNote: s.returnedNote,
      output: o ? { id: o.id, number: o.number, version: o.version, approvedVersion: o.approvedVersion, approvedBy: o.approvedBy ? people.get(o.approvedBy) ?? "—" : null, approvedAt: o.approvedAt, documentId: o.documentId } : null,
      deliverable: d ? { id: d.id, documentId: d.documentId, releasedAt: d.releasedAt } : null,
      meeting: m, assignee: c.assigneeUserId ? people.get(c.assigneeUserId) ?? "—" : null, sentByName: c.sentBy ? people.get(c.sentBy) ?? "—" : null, closedByName: c.closedBy ? people.get(c.closedBy) ?? "—" : null,
    });
  }
  const like = t ? { cadence: t.cadence, startOn: t.startOn, endOn: t.endOn, dueOffsetDays: t.dueOffsetDays, status: t.status, terminatedOn: t.terminatedOn } : null;
  const ts = like ? termState(like, today) : null;
  const counts = cycleCounts(cycles.map((c) => ({ c, phase: c.phase })), today, ts ?? "active");
  const open = cycles.filter((c) => c.status === "open" || c.status === "sent");
  const current = open[0] ?? null;
  return {
    spec, term: t, termState: ts, termLabel: ts ? TERM_AR[ts] : null, effectiveEnd: like ? effectiveEnd(like) : null,
    contract: k ?? null, quote: q ? { id: q.id, number: q.number, version: q.version, scope: q.scope, deliverables: q.deliverables, durationDays: q.durationDays, total: Number(q.total) } : null,
    installments, cycles, current, next: snap.next, canOpenNext: snap.canOpenNext, closingDue: snap.closingDue, counts, endBlockers: snap.endBlockers,
    items: { clientOpen: items.filter((i) => i.visibility === "client" && (i.status === "open" || i.status === "answered")).length, internalOpen: items.filter((i) => i.visibility === "internal" && i.status === "open").length },
    openTasks: openTasks.length, waqfMeetings, today,
  };
}

/** The continuous services portfolio: every open continuous request the viewer may see (RLS applies). */
export async function continuousPortfolio(tx: Tx, auth: Auth) {
  const all = auth.perms.has("admin.requests.all");
  const reqs = await tx.select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, assignedTo: serviceRequests.assignedToUserId, serviceCode: services.code, serviceName: services.nameAr, waqfName: waqfs.name })
    .from(serviceRequests).innerJoin(services, eq(services.id, serviceRequests.serviceId)).leftJoin(waqfs, eq(waqfs.id, serviceRequests.waqfId))
    .where(and(inArray(services.code, CONTINUOUS_CODES), notInArray(serviceRequests.status, ["draft", "cancelled", "rejected", "closed"]), all ? undefined : eq(serviceRequests.assignedToUserId, auth.user.id)));
  if (!reqs.length) return [];
  const terms = await tx.select().from(serviceTerms).where(inArray(serviceTerms.requestId, reqs.map((r) => r.id)));
  const cs = terms.length ? await tx.select().from(serviceCycles).where(inArray(serviceCycles.requestId, terms.map((t) => t.requestId))).orderBy(asc(serviceCycles.seq)) : [];
  const today = todayISO();
  return reqs.map((req) => {
    const t = terms.find((x) => x.requestId === req.id);
    if (!t) return { req, term: null, state: null, stateLabel: "لم تُحدد المدة", cadence: null, open: [], late: 0, done: 0, next: null };
    const like = { cadence: t.cadence, startOn: t.startOn, endOn: t.endOn, dueOffsetDays: t.dueOffsetDays, status: t.status, terminatedOn: t.terminatedOn };
    const ts = termState(like, today);
    const mine = cs.filter((c) => c.requestId === t.requestId);
    const open = mine.filter((c) => c.status === "open" || c.status === "sent");
    const nxt = nextPeriodic(like, mine);
    return {
      req, term: t, state: ts, stateLabel: TERM_AR[ts], cadence: CADENCE_AR[t.cadence], open, late: mine.filter((c) => isLate(c, today, ts)).length,
      done: mine.filter((c) => c.status === "closed" || c.status === "sent").length, next: nxt ? { label: nxt.label, due: nxt.due, from: nxt.from } : null,
    };
  });
}

/** What the client sees of the continuous service: the term, the deliveries sent to them, and the next due date. */
export async function clientContinuous(tx: Tx, rc: RequestCtx) {
  const spec = specOf(rc);
  if (!spec) return null;
  const t = await termOf(tx, rc.req.id);
  if (!t) return { spec, term: null, sent: [], nextDue: null, stateLabel: null };
  const sent = (await tx.select({ id: serviceCycles.id, label: serviceCycles.label, deliveredOn: serviceCycles.deliveredOn, status: serviceCycles.status, sentAt: serviceCycles.sentAt })
    .from(serviceCycles).where(eq(serviceCycles.requestId, rc.req.id)).orderBy(desc(serviceCycles.seq))).filter((c) => !!c.sentAt);
  const today = todayISO();
  const like = { cadence: t.cadence, startOn: t.startOn, endOn: t.endOn, dueOffsetDays: t.dueOffsetDays, status: t.status, terminatedOn: t.terminatedOn };
  const ts = termState(like, today);
  const nextDue = ts === "active" ? schedule(like).find((p) => p.to >= today) ?? null : null;
  return { spec, term: { startOn: t.startOn, endOn: effectiveEnd(like), cadence: CADENCE_AR[t.cadence], terminated: t.status === "terminated" ? { on: t.terminatedOn, reason: t.terminationReason } : null }, sent, nextDue, stateLabel: TERM_AR[ts] };
}
