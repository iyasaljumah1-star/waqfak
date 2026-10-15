import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { readSeparationPolicy } from "@/server/modules/approvals/policy";
import {
  serviceRequests, services, waqfs,
  assets, beneficiaries, contracts, deliverables, distributions, investmentPolicies, ledgerEntries, leases, meetings, minutes, outputs,
  outputVersions, quotes, requestItems, serviceCycles, serviceTerms, settings, tasks, users,
} from "@/server/db/schema";
import type { PaymentTerm } from "@/server/db/schema/commerce";
import type { TermEvent } from "@/server/db/schema/operations";
import { addDays, daysBetween, todayISO, toISO } from "@/server/engines/dates";
import { ledgerOf } from "@/server/modules/commerce/state";
import { cycleOutputDef, type OutputDef } from "@/server/modules/outputs/catalog";
import { approvalCheck, readiness } from "@/server/modules/outputs/pure";
import { preparersOf } from "@/server/modules/outputs/server";
import type { RequestCtx } from "@/server/modules/requests/access";
import type { RequestStatus } from "@/server/modules/requests/workflow";
import type { Auth } from "@/server/authz/context";
import {
  CADENCE_AR, closeBlockers, CONTINUOUS_CODES, continuousSpec, cycleCounts, cyclePhase, effectiveEnd, endBlockers, isLate, nextPeriodic, parseCycleKey, PHASE_AR,
  recordOutputKey, schedule, termState, TERM_AR, type ClientAcceptance, type ContinuousSnap, type ContinuousSpec, type CycleInput, type TermLike,
} from "./continuous-pure";
import type { DeliveryRecordFacts } from "@/server/modules/outputs/build";
import { notify } from "@/server/modules/notify";

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

export const termLike = (t: TermRow): TermLike => ({
  cadence: t.cadence, startOn: t.startOn, endOn: t.endOn, dueOffsetDays: t.dueOffsetDays, status: t.status, terminatedOn: t.terminatedOn, customDates: t.customDates,
});

/** The output definition behind a cycle output key (`N01.cycle@c3`, `N01.record@c3`), with its cycle. */
export async function cycleOutputFor(tx: Tx, rc: RequestCtx, outputKey: string): Promise<{ def: OutputDef; cycle: CycleRow; record: boolean } | null> {
  const k = parseCycleKey(outputKey);
  const spec = specOf(rc);
  if (!k || !spec || k.code !== rc.service.code) return null;
  const [cycle] = await tx.select().from(serviceCycles).where(and(eq(serviceCycles.requestId, rc.req.id), eq(serviceCycles.seq, k.seq))).limit(1);
  if (!cycle) return null;
  if (k.record) {
    if (!spec.deliveryRecord || outputKey !== recordOutputKey(spec.code, cycle.seq)) return null;
    return { def: cycleOutputDef(outputKey, { title: "محضر تسليم", profile: "delivery_record", review: "self_allowed" }, cycle.label), cycle, record: true };
  }
  if (cycle.outputKey !== outputKey) return null;
  const d = k.closing ? (spec.closing ? { title: spec.closing.title, profile: spec.closing.profile, review: "independent" as const } : null)
    : spec.delivery.kind === "output" ? spec.delivery : null;
  if (!d) return null;
  return { def: cycleOutputDef(outputKey, d, cycle.label), cycle, record: false };
}

/**
 * Facts of one delivery for its record («محضر التسليم»), from what the platform recorded: the approved output and its
 * versions, the files made available, who delivered and who received, the internal review and the client's decision,
 * the notes and revision requests. Nothing is assumed: what is missing stays missing.
 */
export async function deliveryRecordFacts(tx: Tx, rc: RequestCtx, cycle: CycleRow, acceptance: ClientAcceptance): Promise<DeliveryRecordFacts> {
  const [o] = cycle.outputKey ? await tx.select().from(outputs).where(and(eq(outputs.requestId, rc.req.id), eq(outputs.outputKey, cycle.outputKey))).limit(1) : [];
  const vers = o ? await tx.select().from(outputVersions).where(eq(outputVersions.outputId, o.id)).orderBy(asc(outputVersions.version)) : [];
  const dels = await tx.select().from(deliverables).where(and(eq(deliverables.requestId, rc.req.id), eq(deliverables.cycleId, cycle.id))).orderBy(asc(deliverables.version));
  const ids = [...new Set([o?.approvedBy, cycle.sentBy, cycle.clientDecisionBy, rc.req.requesterUserId, ...(cycle.clientEvents ?? []).map((e) => e.by)].filter((x): x is string => !!x))];
  const people = ids.length ? new Map((await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids))).map((p) => [p.id, p.name ?? "—"])) : new Map<string, string>();
  const approvedV = o?.approvedVersion ? vers.find((v) => v.version === o.approvedVersion) : null;
  const intake = (rc.req.intake ?? {}) as { answers?: Record<string, unknown> };
  const CAP: Record<string, string> = { nazir: "ناظر الوقف", waqif: "الواقف", agent: "وكيل", entity_rep: "ممثل جهة اعتبارية", board_member: "عضو مجلس النظارة" };
  const capacity = CAP[String(intake.answers?.capacity ?? "")] ?? null;
  const recipientId = cycle.clientDecision === "approved" ? cycle.clientDecisionBy : rc.req.requesterUserId;
  const d = (x: Date | null | undefined) => (x ? toISO(x) : null);
  return {
    requestNumber: rc.req.number, cycleSeq: cycle.seq, cycleLabel: cycle.label, periodFrom: cycle.periodStart, periodTo: cycle.periodEnd, dueOn: cycle.dueOn,
    output: o ? { title: o.title, number: o.number, version: o.approvedVersion, preparedOn: approvedV ? toISO(approvedV.createdAt) : null, approvedBy: o.approvedBy ? people.get(o.approvedBy) ?? "—" : null, approvedOn: d(o.approvedAt) } : null,
    availableOn: d(cycle.sentAt), viewedOn: d(cycle.viewedAt),
    deliverer: { name: cycle.sentBy ? people.get(cycle.sentBy) ?? null : null, capacity: "عن «وقفك» بصفتها مقدم الخدمة" },
    recipient: { name: recipientId ? people.get(recipientId) ?? null : null, capacity: capacity ?? "العميل مقدّم الطلب" },
    acceptance,
    client: { decision: cycle.clientDecision ?? null, by: cycle.clientDecisionBy ? people.get(cycle.clientDecisionBy) ?? null : null, on: d(cycle.clientDecisionAt), version: cycle.clientApprovedVersion, note: cycle.clientDecisionNote },
    files: dels.filter((x) => x.releasedAt).map((x) => ({ title: x.title, version: x.version, on: d(x.releasedAt)! })),
    reservations: approvedV ? (approvedV.gaps ?? []).map((g) => `${g.severity === "blocking" ? "نقص جوهري" : "تحفظ"}: ${g.label}`) : [],
    notes: [
      ...(cycle.clientEvents ?? []).filter((e) => e.kind === "revision_requested" || (e.kind === "approved" && e.note)).map((e) => ({ on: e.at.slice(0, 10), who: e.by ? people.get(e.by) ?? "العميل" : "العميل", text: `${e.kind === "revision_requested" ? "طلب تعديل" : "ملاحظة مع الاعتماد"}: ${e.note ?? ""}` })),
      ...(o?.reviewNote ? [{ on: "—", who: "المراجعة الداخلية", text: `آخر ملاحظة مراجعة: ${o.reviewNote}` }] : []),
    ],
    versions: vers.map((v) => ({ version: v.version, origin: ({ generated: "مسودة أولى", regenerated: "إعادة توليد", edited: "تعديل بشري" } as Record<string, string>)[v.origin] ?? v.origin, on: toISO(v.createdAt), note: v.note })),
  };
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
  const like = t ? termLike(t) : null;
  return { spec, term: t, cycles: cs, endBlockers: endBlockers(spec, like, cs, today), state: like ? termState(like, today) : null, today };
}

/** The cadence agreed in the accepted quote, if the quote fixed one. */
export async function quoteCadence(tx: Tx, requestId: string) {
  const [q] = await tx.select({ s: quotes.deliverySchedule }).from(quotes).where(and(eq(quotes.requestId, requestId), eq(quotes.kind, "initial"), eq(quotes.status, "accepted"))).orderBy(desc(quotes.version)).limit(1);
  return q?.s ?? null;
}

// ───────────────────────── Snapshot for the execution plan ─────────────────────────

export async function continuousSnapshot(tx: Tx, auth: Auth, rc: RequestCtx): Promise<ContinuousSnap | null> {
  const f = await continuousFacts(tx, rc);
  if (!f) return null;
  const { spec, term: t, cycles: cs, today } = f;
  const recordKeys = spec.deliveryRecord ? cs.map((c) => recordOutputKey(spec.code, c.seq)) : [];
  const keys = [...cs.map((c) => c.outputKey).filter((x): x is string => !!x), ...recordKeys];
  const outs = keys.length ? await tx.select().from(outputs).where(and(eq(outputs.requestId, rc.req.id), inArray(outputs.outputKey, keys))) : [];
  const vers = outs.length ? await tx.select().from(outputVersions).where(inArray(outputVersions.outputId, outs.map((o) => o.id))) : [];
  const like = t ? termLike(t) : null;
  const ts = like ? termState(like, today) : null;
  const acceptance = t?.clientAcceptance ?? spec.acceptance.mode;
  const separation = await readSeparationPolicy(tx);
  const approve = async (o: typeof outs[number]) => {
    if (o.status !== "in_review") return { ok: false, reason: undefined as string | undefined };
    const ck = approvalCheck({ policy: o.reviewPolicy, approverId: auth.user.id, preparers: await preparersOf(tx, o), canReview: auth.perms.has("staff.quality_review"), isManager: auth.perms.has("admin.requests.all"), direct: auth.perms.has("approvals.direct"), separation });
    return { ok: ck.ok, reason: ck.ok ? undefined : ck.error };
  };
  const ready = (o: typeof outs[number] | null) => {
    const v = o ? vers.find((x) => x.outputId === o.id && x.version === o.currentVersion) : null;
    return v ? readiness(v.sections, v.gaps) : null;
  };
  const rows: ContinuousSnap["cycles"] = [];
  for (const c of cs) {
    const o = c.outputKey ? outs.find((x) => x.outputKey === c.outputKey) ?? null : null;
    const r = ready(o);
    const kind = c.kind === "closing" ? "output" : spec.delivery.kind;
    const reapproved = !!(o?.approvedAt && c.clientDecisionAt && o.approvedAt > c.clientDecisionAt);
    const phase = cyclePhase(c, o ? { status: o.status, reapproved } : null, kind);
    const ap = o ? await approve(o) : { ok: false, reason: undefined };
    const missing = c.status === "open" ? (await inputChecks(tx, rc, c, spec)).filter((x) => !x.ok).map((x) => `${x.label}: ${x.detail}`) : [];
    const recKey = spec.deliveryRecord && c.kind !== "closing" ? recordOutputKey(spec.code, c.seq) : null;
    const rec = recKey ? outs.find((x) => x.outputKey === recKey) ?? null : null;
    const rr = ready(rec);
    const recAp = rec ? await approve(rec) : { ok: false };
    const needsOutput = kind === "output" || kind === "minutes";
    rows.push({
      id: c.id, seq: c.seq, label: c.label, due: c.dueOn, late: !!ts && isLate(c, today, ts), phase, kind: c.kind,
      outputKey: c.outputKey, outputId: o?.id ?? null, outputStatus: o?.status ?? null, returnedNote: o?.status === "returned" ? o.reviewNote : null,
      blocking: (r?.blocking ?? []).map((g) => g.label), unwritten: (r?.unwritten ?? []).map((u) => u.section),
      viewerCanApprove: ap.ok, approveBlockedReason: ap.reason, inputsMissing: missing, checklistOpen: (c.checklist ?? []).filter((x) => !x.done).length,
      clientNote: c.clientDecision === "revision_requested" ? c.clientDecisionNote : null,
      closeBlockers: closeBlockers(c, { acceptance: kind === "followup" ? "info" : acceptance, needsOutput, recordRequired: !!recKey, recordApproved: rec?.status === "approved" }),
      record: recKey ? { key: recKey, outputId: rec?.id ?? null, status: rec?.status ?? null, viewerCanApprove: recAp.ok, blocking: (rr?.blocking ?? []).map((g) => g.label), unwritten: (rr?.unwritten ?? []).map((u) => u.section) } : null,
    });
  }
  const nxt = like ? nextPeriodic(like, cs) : null;
  const finished = ts === "ended" || ts === "terminated";
  const qc = t ? null : await quoteCadence(tx, rc.req.id);
  return {
    hasTerm: !!t, cadenceUnset: !t && !spec.cadence && !qc?.cadence, termState: ts, termLabel: ts ? TERM_AR[ts] : null,
    cadence: t ? CADENCE_AR[t.cadence] : qc?.cadence ? CADENCE_AR[qc.cadence as keyof typeof CADENCE_AR] ?? "—" : spec.cadence ? CADENCE_AR[spec.cadence] : "غير محددة",
    deliveryKind: spec.delivery.kind, acceptance,
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
    return { key: pt.key, label: pt.label, percent: pt.percent, due: pt.due, dueOn: pt.dueOn ?? null, milestone: pt.milestone ?? null, invoices: invs.map((i) => ({ id: i.id, number: i.number, status: i.status, total: Number(i.total), dueOn: i.dueOn, einvoiceStatus: i.einvoiceStatus })) };
  }) : [];
  const dels = await tx.select().from(deliverables).where(and(eq(deliverables.requestId, rc.req.id)));
  const meetingIds = cs.map((c) => c.meetingId).filter((x): x is string => !!x);
  const mts = meetingIds.length ? await tx.select({ id: meetings.id, title: meetings.title, at: meetings.scheduledAt, status: meetings.status }).from(meetings).where(inArray(meetings.id, meetingIds)) : [];
  const waqfMeetings = rc.req.waqfId ? await tx.select({ id: meetings.id, title: meetings.title, at: meetings.scheduledAt, status: meetings.status }).from(meetings).where(eq(meetings.waqfId, rc.req.waqfId)).orderBy(desc(meetings.scheduledAt)).limit(30) : [];
  const ids = [...new Set(cs.flatMap((c) => [c.assigneeUserId, c.sentBy, c.closedBy, c.clientDecisionBy]).filter((x): x is string => !!x))];
  const people = ids.length ? new Map((await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids))).map((p) => [p.id, p.name ?? "—"])) : new Map<string, string>();
  const outs = cs.length ? await tx.select({ id: outputs.id, key: outputs.outputKey, status: outputs.status, version: outputs.currentVersion, approvedVersion: outputs.approvedVersion, approvedBy: outputs.approvedBy, approvedAt: outputs.approvedAt, documentId: outputs.documentId, number: outputs.number }).from(outputs).where(eq(outputs.requestId, rc.req.id)) : [];
  const appr = [...new Set(outs.map((o) => o.approvedBy).filter((x): x is string => !!x))];
  if (appr.length) for (const p of await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, appr))) people.set(p.id, p.name ?? "—");
  const items = await tx.select({ status: requestItems.status, visibility: requestItems.visibility, required: requestItems.required }).from(requestItems).where(eq(requestItems.requestId, rc.req.id));
  const openTasks = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.requestId, rc.req.id), inArray(tasks.status, ["todo", "in_progress"])));
  const cycles = [];
  for (const c of cs) {
    const s = snap.cycles.find((x) => x.id === c.id)!;
    const o = c.outputKey ? outs.find((x) => x.key === c.outputKey) ?? null : null;
    const rec = s.record ? outs.find((x) => x.key === s.record!.key) ?? null : null;
    const files = dels.filter((x) => x.cycleId === c.id && x.releasedAt).sort((a, b) => b.version - a.version);
    const m = c.meetingId ? mts.find((x) => x.id === c.meetingId) ?? null : null;
    cycles.push({
      ...c, phase: s.phase, phaseLabel: PHASE_AR[s.phase], late: s.late, inputs: c.status === "open" ? await inputChecks(tx, rc, c, spec) : [],
      blocking: s.blocking, unwritten: s.unwritten, outputStatus: s.outputStatus, returnedNote: s.returnedNote, closeBlockers: s.closeBlockers ?? [],
      output: o ? { id: o.id, number: o.number, version: o.version, approvedVersion: o.approvedVersion, approvedBy: o.approvedBy ? people.get(o.approvedBy) ?? "—" : null, approvedAt: o.approvedAt, documentId: o.documentId } : null,
      record: s.record ? { ...s.record, number: rec?.number ?? null, approvedBy: rec?.approvedBy ? people.get(rec.approvedBy) ?? "—" : null, approvedAt: rec?.approvedAt ?? null, documentId: rec?.documentId ?? null } : null,
      files: files.map((x) => ({ id: x.id, title: x.title, version: x.version, documentId: x.documentId, releasedAt: x.releasedAt, status: x.status, revisionNote: x.revisionNote })),
      deliverable: files[0] ? { id: files[0].id, documentId: files[0].documentId, releasedAt: files[0].releasedAt } : null,
      meeting: m, assignee: c.assigneeUserId ? people.get(c.assigneeUserId) ?? "—" : null, sentByName: c.sentBy ? people.get(c.sentBy) ?? "—" : null, closedByName: c.closedBy ? people.get(c.closedBy) ?? "—" : null,
      clientDecisionByName: c.clientDecisionBy ? people.get(c.clientDecisionBy) ?? "—" : null,
    });
  }
  const like = t ? termLike(t) : null;
  const ts = like ? termState(like, today) : null;
  const counts = cycleCounts(cycles.map((c) => ({ c, phase: c.phase })), today, ts ?? "active");
  const open = cycles.filter((c) => c.status === "open" || c.status === "sent");
  const current = open[0] ?? null;
  const qc = q?.deliverySchedule ?? null;
  return {
    spec, term: t, termState: ts, termLabel: ts ? TERM_AR[ts] : null, effectiveEnd: like ? effectiveEnd(like) : null, acceptance: snap.acceptance ?? spec.acceptance.mode,
    quoteCadence: qc, cadenceUnset: snap.cadenceUnset,
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
  const qs = await tx.select({ requestId: quotes.requestId, s: quotes.deliverySchedule }).from(quotes).where(and(inArray(quotes.requestId, reqs.map((r) => r.id)), eq(quotes.kind, "initial"), eq(quotes.status, "accepted")));
  const today = todayISO();
  return reqs.map((req) => {
    const t = terms.find((x) => x.requestId === req.id);
    const spec = continuousSpec(req.serviceCode)!;
    if (!t) {
      const qc = qs.find((x) => x.requestId === req.id)?.s?.cadence ?? null;
      const unset = !spec.cadence && !qc;
      return { req, term: null, state: null, stateLabel: unset ? "الدورية غير محددة" : "لم تُفعَّل المدة", cadenceUnset: unset, cadence: qc ? CADENCE_AR[qc as keyof typeof CADENCE_AR] : spec.cadence ? CADENCE_AR[spec.cadence] : null, open: [], late: 0, done: 0, awaitingClient: 0, next: null };
    }
    const like = termLike(t);
    const ts = termState(like, today);
    const mine = cs.filter((c) => c.requestId === t.requestId);
    const open = mine.filter((c) => c.status === "open" || c.status === "sent");
    const nxt = nextPeriodic(like, mine);
    return {
      req, term: t, state: ts, stateLabel: TERM_AR[ts], cadenceUnset: false, cadence: CADENCE_AR[t.cadence], open, late: mine.filter((c) => isLate(c, today, ts)).length,
      done: mine.filter((c) => c.status === "closed").length, awaitingClient: mine.filter((c) => c.status === "sent" && c.clientDecision !== "approved").length,
      next: nxt ? { label: nxt.label, due: nxt.due, from: nxt.from } : null,
    };
  });
}

/**
 * What the client sees of the continuous service: the term, each delivery made available to them (with its files,
 * versions, and the separate states «متاح» / «اطّلعت عليه» / «اعتمدته»), and the next due date.
 */
export async function clientContinuous(tx: Tx, rc: RequestCtx) {
  const spec = specOf(rc);
  if (!spec) return null;
  const t = await termOf(tx, rc.req.id);
  if (!t) return { spec, term: null, cycles: [], nextDue: null, stateLabel: null, acceptance: spec.acceptance.mode };
  const visible = await tx.select().from(serviceCycles).where(eq(serviceCycles.requestId, rc.req.id)).orderBy(desc(serviceCycles.seq));
  const dels = visible.length ? await tx.select().from(deliverables).where(and(eq(deliverables.requestId, rc.req.id), inArray(deliverables.cycleId, visible.map((c) => c.id)))) : [];
  const today = todayISO();
  const like = termLike(t);
  const ts = termState(like, today);
  const nextDue = ts === "active" ? schedule(like).find((p) => p.to >= today) ?? null : null;
  return {
    spec, acceptance: t.clientAcceptance, stateLabel: TERM_AR[ts],
    term: { startOn: t.startOn, endOn: effectiveEnd(like), cadence: CADENCE_AR[t.cadence], terminated: t.status === "terminated" ? { on: t.terminatedOn, reason: t.terminationReason } : null },
    cycles: visible.filter((c) => !!c.sentAt).map((c) => ({
      id: c.id, seq: c.seq, label: c.label, status: c.status, sentAt: c.sentAt, viewedAt: c.viewedAt, decision: c.clientDecision, decisionAt: c.clientDecisionAt, decisionNote: c.clientDecisionNote,
      approvedVersion: c.clientApprovedVersion,
      files: dels.filter((d) => d.cycleId === c.id && d.releasedAt).sort((a, b) => b.version - a.version).map((d) => ({ id: d.id, title: d.title, version: d.version, documentId: d.documentId, releasedAt: d.releasedAt, status: d.status })),
    })),
    nextDue,
  };
}

/**
 * Daily step (system context): deliveries made available and still awaiting the client's decision past the configured
 * number of days get a reminder to the client and to the team. Silence is never taken as approval; nothing closes.
 */
export async function deliveryResponseReminders(tx: Tx) {
  const [cfg] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, "delivery.response_reminder_days")).limit(1);
  const days = Number((cfg?.v as { days?: number } | undefined)?.days ?? 7);
  const today = todayISO();
  const rows = await tx.select({ c: serviceCycles, number: serviceRequests.number, requester: serviceRequests.requesterUserId, assignee: serviceRequests.assignedToUserId })
    .from(serviceCycles).innerJoin(serviceRequests, eq(serviceRequests.id, serviceCycles.requestId))
    .where(and(eq(serviceCycles.status, "sent"), isNull(serviceCycles.clientDecision), eq(serviceRequests.status, "in_progress")));
  let sent = 0;
  for (const { c, number, requester, assignee } of rows) {
    const since = toISO(c.sentAt!);
    const waited = daysBetween(since, today);
    if (waited < days) continue;
    const last = [...(c.clientEvents ?? [])].reverse().find((e) => e.kind === "reminder");
    if (last && daysBetween(last.at.slice(0, 10), today) < days) continue;
    await notify(requester, "delivery.response_overdue", { number, title: c.label, days: waited }, { waqfId: c.waqfId, link: `/app/requests/${c.requestId}#deliveries`, tx });
    if (assignee) await notify(assignee, "delivery.response_overdue", { number, title: c.label, days: waited }, { waqfId: c.waqfId, link: `/admin/requests/${c.requestId}#service`, tx });
    await tx.update(serviceCycles).set({ clientEvents: [...(c.clientEvents ?? []), { at: new Date().toISOString(), by: null, kind: "reminder", note: `تذكير بعد ${waited} يومًا دون رد` }] }).where(eq(serviceCycles.id, c.id));
    sent++;
  }
  return { reminders: sent, afterDays: days, since: addDays(today, -days) };
}
