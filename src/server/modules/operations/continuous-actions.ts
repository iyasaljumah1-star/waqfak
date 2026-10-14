"use server";

import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { deliverables, documents, meetings, outputs, quotes, serviceCycles, serviceTerms, tasks } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { addDays, addMonths, todayISO } from "@/server/engines/dates";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { contractState, loadRequestCtx, type RequestCtx } from "@/server/modules/requests/access";
import { logEvent, transition, type ActCtx } from "@/server/modules/requests/engine";
import { notify } from "@/server/modules/notify";
import { releaseOutput } from "@/server/modules/outputs/server";
import type { ActionState } from "@/lib/utils";
import { syncTask, taskEvent } from "./exec";
import { cyclesOf, inputChecks, specOf, termEvent, termOf, type CycleRow } from "./continuous";
import { CADENCE_AR, checklistOf, cycleOutputKey, effectiveEnd, nextPeriodic, termState } from "./continuous-pure";

/**
 * Continuous services: term setup, renewal, termination, and the life of each delivery cycle.
 * Every action re-checks the caller's capacity on the request (the assigned specialist or an authorized manager),
 * the request's state (cycles move only while the service runs, not while suspended), and writes an audit entry.
 * No action here creates an invoice, sends anything outside the platform, or changes the request's status except
 * ending the service, which goes through the request state machine and its guards.
 */

const uuid = z.string().uuid("قيمة غير صالحة.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح.");
const reval = (id: string) => [`/admin/requests/${id}`, `/app/requests/${id}`, "/admin/continuous", "/admin"];

async function load(c: ActCtx, id: string) {
  const rc = await loadRequestCtx(c.tx, c.auth, id, "staff");
  if (!rc.staffSide) throw new ForbiddenError();
  const spec = specOf(rc);
  if (!spec) throw new UserError("هذه الخدمة ليست خدمة مستمرة.");
  return { rc, spec };
}

function worker(rc: RequestCtx) {
  if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("ينفّذ هذا الإجراء المختص المسند إليه الطلب أو مدير مخوّل.");
}

function manager(rc: RequestCtx) {
  if (!rc.isOps) throw new ForbiddenError("هذا الإجراء لمدير التشغيل أو الإدارة (صلاحية إدارة الطلبات).");
}

function running(rc: RequestCtx) {
  if (rc.req.status === "on_hold") throw new UserError("الخدمة معلّقة: تُستأنف أولًا ثم تُدار دوراتها.");
  if (rc.req.status !== "in_progress") throw new UserError("تُدار دورات التسليم أثناء سريان الخدمة (الطلب قيد التنفيذ).");
}

async function lockCycle(c: ActCtx, cycleId: string) {
  const [cy] = await c.tx.select().from(serviceCycles).where(eq(serviceCycles.id, cycleId)).limit(1).for("update");
  if (!cy) throw new UserError("الدورة غير موجودة أو لا تملك صلاحية الوصول إليها.");
  const { rc, spec } = await load(c, cy.requestId);
  return { cy, rc, spec };
}

const cycleTaskKey = (code: string, seq: number) => `${code}.cycle-task@c${seq}`;

// ───────────────────────── Term ─────────────────────────

const termSchema = z.object({
  id: uuid, startOn: isoDate, endOn: isoDate,
  cadence: z.enum(["monthly", "quarterly", "semiannual", "annual", "event"], { message: "اختر دورية التسليم." }),
  dueOffsetDays: z.coerce.number().int().min(0, "أيام الاستحقاق لا تقل عن صفر.").max(90, "أيام الاستحقاق لا تزيد على 90."),
  note: z.string().trim().max(1000).optional().default(""),
});

/** Records the service term from the contract: start, end, cadence (within what the service allows), due offset. */
export async function setupTerm(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(termSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const { rc, spec } = await load(c, d.id);
    worker(rc);
    if (!["in_progress", "on_hold"].includes(rc.req.status)) throw new UserError("تُحدد مدة الخدمة بعد بدء التنفيذ.");
    if (await termOf(c.tx, rc.req.id)) throw new UserError("حُددت مدة الخدمة من قبل. التمديد أو الإنهاء من إجراءاتهما.");
    if (!spec.allowed.includes(d.cadence)) throw new UserError(`دورية غير متاحة لهذه الخدمة. المتاح: ${spec.allowed.map((x) => CADENCE_AR[x]).join("، ")}.`);
    if (d.endOn <= d.startOn) throw new UserError("تاريخ النهاية يلي تاريخ البداية.");
    if (d.endOn > addMonths(d.startOn, 60)) throw new UserError("المدة أطول من خمس سنوات: راجع العقد.");
    const cs = await contractState(c.tx, rc.req.id);
    const [q] = await c.tx.select({ id: quotes.id }).from(quotes).where(and(eq(quotes.requestId, rc.req.id), eq(quotes.kind, "initial"), eq(quotes.status, "accepted"))).limit(1);
    const [t] = await c.tx.insert(serviceTerms).values({
      requestId: rc.req.id, waqfId: rc.req.waqfId, serviceCode: rc.service.code, contractId: cs.executed ? cs.contract?.id ?? null : null, quoteId: q?.id ?? null,
      cadence: d.cadence, startOn: d.startOn, endOn: d.endOn, dueOffsetDays: d.dueOffsetDays, status: rc.req.status === "on_hold" ? "suspended" : "active",
      history: [{ at: new Date().toISOString(), by: c.auth.user.id, kind: "setup", note: d.note || null, after: { startOn: d.startOn, endOn: d.endOn, cadence: d.cadence, dueOffsetDays: d.dueOffsetDays } }],
      createdBy: c.auth.user.id, updatedBy: c.auth.user.id,
    }).returning();
    await logEvent(c.tx, rc.req, c.auth.user.id, `حُددت مدة الخدمة من ${d.startOn} إلى ${d.endOn}، ودورية التسليم ${CADENCE_AR[d.cadence]}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.term_setup", entityType: "service_term", entityId: t.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { startOn: d.startOn, endOn: d.endOn, cadence: d.cadence, contractId: t.contractId, quoteId: t.quoteId, note: d.note || undefined } });
    return { ok: true, message: `حُددت مدة الخدمة ودوريتها (${CADENCE_AR[d.cadence]}).` };
  }, { revalidate: reval(d.id) });
}

const extendSchema = z.object({ id: uuid, endOn: isoDate, reason: z.string().trim().min(5, "اكتب سبب التمديد.").max(1000), reference: z.string().trim().min(3, "اذكر مرجع الاتفاق المكتوب (ملحق أو عقد).").max(200) });

/** Renewal or extension: only on a written agreement (the continuous-service contract renews only that way). */
export async function extendTerm(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(extendSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const { rc } = await load(c, d.id);
    manager(rc);
    const t = await termOf(c.tx, rc.req.id);
    if (!t) throw new UserError("لم تُحدد مدة الخدمة بعد.");
    if (t.status === "terminated") throw new UserError("أُنهيت الخدمة؛ لا تُمدد. تُطلب خدمة جديدة بعقد جديد.");
    if (!["in_progress", "on_hold"].includes(rc.req.status)) throw new UserError("يُمدد العقد والطلب ما زال قائمًا.");
    if (d.endOn <= t.endOn) throw new UserError(`التاريخ الجديد يلي النهاية الحالية (${t.endOn}).`);
    await c.tx.update(serviceTerms).set({ endOn: d.endOn, history: termEvent(t, { by: c.auth.user.id, kind: "extend", note: `${d.reason} — المرجع: ${d.reference}`, before: { endOn: t.endOn }, after: { endOn: d.endOn } }), updatedBy: c.auth.user.id }).where(eq(serviceTerms.id, t.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `مُددت مدة الخدمة إلى ${d.endOn} (المرجع: ${d.reference})`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.term_extend", entityType: "service_term", entityId: t.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before: { endOn: t.endOn }, after: { endOn: d.endOn, reason: d.reason, reference: d.reference } });
    return { ok: true, message: `مُددت المدة إلى ${d.endOn}.` };
  }, { revalidate: reval(d.id) });
}

const terminateSchema = z.object({
  id: uuid, effectiveOn: isoDate,
  initiatedBy: z.enum(["client", "company", "mutual"], { message: "حدّد من طلب الإنهاء." }),
  reason: z.string().trim().min(10, "اكتب سبب الإنهاء (10 أحرف على الأقل).").max(2000),
  reference: z.string().trim().min(3, "اذكر مرجع الإنهاء المكتوب (إشعار أو ملحق أو قرار).").max(200),
});
const INITIATOR: Record<string, string> = { client: "بطلب العميل", company: "بقرار «وقفك»", mutual: "باتفاق الطرفين" };

/**
 * Early termination of the contract: recorded with reason, initiator and written reference. The service runs until the
 * effective date; cycles whose period starts after it are skipped with the reason. Nothing is deleted, and the
 * contract record is not altered (its termination is this recorded decision).
 */
export async function terminateService(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(terminateSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const { rc } = await load(c, d.id);
    manager(rc);
    const t = await termOf(c.tx, rc.req.id);
    if (!t) throw new UserError("لم تُحدد مدة الخدمة بعد.");
    if (t.status === "terminated") throw new UserError("سُجل إنهاء الخدمة من قبل.");
    if (!["in_progress", "on_hold"].includes(rc.req.status)) throw new UserError("يُسجل الإنهاء والطلب قائم.");
    if (d.effectiveOn < t.startOn || d.effectiveOn > t.endOn) throw new UserError(`تاريخ النفاذ بين ${t.startOn} و${t.endOn}.`);
    const reason = `${INITIATOR[d.initiatedBy]}: ${d.reason}`;
    await c.tx.update(serviceTerms).set({
      status: "terminated", terminatedOn: d.effectiveOn, terminationReason: reason, terminationRef: d.reference, terminatedBy: c.auth.user.id, suspendedAt: null, suspendReason: null,
      history: termEvent(t, { by: c.auth.user.id, kind: "terminate", note: `${reason} — المرجع: ${d.reference}`, before: { status: t.status, endOn: t.endOn }, after: { terminatedOn: d.effectiveOn } }), updatedBy: c.auth.user.id,
    }).where(eq(serviceTerms.id, t.id));
    const later = (await cyclesOf(c.tx, rc.req.id)).filter((x) => x.status === "open" && x.kind !== "closing" && (x.periodStart ?? x.dueOn) > d.effectiveOn);
    for (const x of later) await skip(c, rc, x, `أُنهيت الخدمة قبل بدء الفترة (${reason})`);
    await logEvent(c.tx, rc.req, c.auth.user.id, `سُجل إنهاء الخدمة ${INITIATOR[d.initiatedBy]}، نافذًا في ${d.effectiveOn} (المرجع: ${d.reference})`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.terminate", entityType: "service_term", entityId: t.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: t.status, endOn: t.endOn }, after: { effectiveOn: d.effectiveOn, initiatedBy: d.initiatedBy, reason: d.reason, reference: d.reference, skippedCycles: later.length } });
    if (rc.req.requesterUserId !== c.auth.user.id)
      await notify(rc.req.requesterUserId, "request.status", { number: rc.req.number, status: "إنهاء الخدمة", note: `نافذ في ${d.effectiveOn}` }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}`, tx: c.tx });
    return { ok: true, message: `سُجل الإنهاء نافذًا في ${d.effectiveOn}${later.length ? `، وتُجووزت ${later.length} دورة لاحقة` : ""}.` };
  }, { revalidate: reval(d.id) });
}

// ───────────────────────── Cycles ─────────────────────────

const openSchema = z.object({
  id: uuid, kind: z.enum(["periodic", "event", "closing"]).optional().default("periodic"),
  label: z.string().trim().max(200).optional().default(""),
  eventOn: z.union([z.literal(""), isoDate]).optional().default(""),
  meetingId: z.union([z.literal(""), uuid]).optional().default(""),
});

/** Opens the next cycle: the next period of the cadence, an event (meeting / disbursement), or the closing delivery. */
export async function openCycle(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(openSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const { rc, spec } = await load(c, d.id);
    worker(rc);
    running(rc);
    const t = await termOf(c.tx, rc.req.id);
    if (!t) throw new UserError("حدّد مدة الخدمة ودوريتها أولًا.");
    const today = todayISO();
    const like = { cadence: t.cadence, startOn: t.startOn, endOn: t.endOn, dueOffsetDays: t.dueOffsetDays, status: t.status, terminatedOn: t.terminatedOn };
    const ts = termState(like, today);
    const end = effectiveEnd(like);
    const existing = await cyclesOf(c.tx, rc.req.id);
    let row: { kind: "periodic" | "event" | "closing"; label: string; periodStart: string | null; periodEnd: string | null; dueOn: string; meetingId: string | null };
    if (d.kind === "closing") {
      if (!spec.closing) throw new UserError("لا تسليم نهاية لهذه الخدمة.");
      if (ts !== "ended" && ts !== "terminated") throw new UserError("يُفتح تسليم نهاية الخدمة بعد انتهاء مدتها أو تسجيل إنهائها.");
      if (existing.some((x) => x.kind === "closing" && x.status !== "skipped")) throw new UserError("فُتح تسليم نهاية الخدمة من قبل.");
      row = { kind: "closing", label: spec.closing.title, periodStart: t.startOn, periodEnd: end, dueOn: addDays(end, t.dueOffsetDays), meetingId: null };
    } else {
      // After the end, only periods that started within the term can still be opened (a late delivery), no events after it.
      if (t.cadence === "event") {
        if (d.label.length < 3) throw new UserError("اكتب وصف الدورة (الاجتماع أو دفعة الصرف).");
        if (!d.eventOn) throw new UserError("حدّد تاريخ الحدث.");
        if (d.eventOn < t.startOn || d.eventOn > end) throw new UserError(`تاريخ الحدث داخل مدة الخدمة (${t.startOn} إلى ${end}).`);
        let meetingId: string | null = null;
        if (d.meetingId) {
          const [m] = rc.req.waqfId ? await c.tx.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.id, d.meetingId), eq(meetings.waqfId, rc.req.waqfId))).limit(1) : [];
          if (!m) throw new UserError("الاجتماع ليس من اجتماعات هذا الوقف.");
          meetingId = m.id;
        }
        row = { kind: "event", label: d.label, periodStart: d.eventOn, periodEnd: d.eventOn, dueOn: addDays(d.eventOn, t.dueOffsetDays), meetingId };
      } else {
        const nxt = nextPeriodic(like, existing);
        if (!nxt) throw new UserError("لا فترات متبقية في مدة الخدمة.");
        if (nxt.from > today) throw new UserError(`تبدأ الفترة التالية في ${nxt.from}؛ لا يُفتح تسليم قبل فترته.`);
        row = { kind: "periodic", label: nxt.label, periodStart: nxt.from, periodEnd: nxt.to, dueOn: nxt.due, meetingId: null };
      }
    }
    const [{ m }] = await c.tx.select({ m: max(serviceCycles.seq) }).from(serviceCycles).where(eq(serviceCycles.requestId, rc.req.id));
    const seq = (m ?? 0) + 1;
    const hasOutput = row.kind === "closing" || spec.delivery.kind === "output";
    const outputKey = hasOutput ? cycleOutputKey(rc.service.code, seq, row.kind) : null;
    const assignee = rc.req.assignedToUserId ?? c.auth.user.id;
    const [cy] = await c.tx.insert(serviceCycles).values({
      requestId: rc.req.id, waqfId: rc.req.waqfId, termId: t.id, seq, kind: row.kind, label: row.label, periodStart: row.periodStart, periodEnd: row.periodEnd,
      dueOn: row.dueOn, assigneeUserId: assignee, outputKey, meetingId: row.meetingId, checklist: checklistOf(spec, row.kind), createdBy: c.auth.user.id, updatedBy: c.auth.user.id,
    }).returning();
    // Tasks: the cycle itself (closed with the cycle), and the prepare/review pair of its output.
    const planned = [
      { kind: "cycle", outputKey: cycleTaskKey(rc.service.code, seq), title: `دورة تسليم: ${row.label}` },
      ...(outputKey ? [
        { kind: "prepare_output", outputKey, title: `إعداد مسودة: ${row.label}` },
        { kind: "review_output", outputKey, title: `مراجعة واعتماد: ${row.label}` },
      ] : []),
    ];
    const made = await c.tx.insert(tasks).values(planned.map((p) => ({
      waqfId: rc.req.waqfId, requestId: rc.req.id, sourceType: "request", sourceId: rc.req.id, kind: p.kind, stageKey: null, outputKey: p.outputKey, title: p.title,
      description: rc.req.number, assigneeUserId: assignee, priority: rc.req.priority, visibility: "internal", dueOn: row.dueOn, createdBy: c.auth.user.id, updatedBy: c.auth.user.id,
    }))).onConflictDoNothing().returning();
    for (const tk of made) await taskEvent(c.tx, tk, { action: "create", to: tk.status, actorId: c.auth.user.id, note: `فُتحت الدورة ${seq}` });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.cycle_open", entityType: "service_cycle", entityId: cy.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { seq, kind: row.kind, label: row.label, dueOn: row.dueOn, outputKey } });
    return { ok: true, message: `فُتحت دورة «${row.label}» (تستحق ${row.dueOn}).`, data: { cycleId: cy.id } };
  }, { revalidate: reval(d.id) });
}

const checkSchema = z.object({ cycleId: uuid, key: z.string().min(1).max(20), done: z.string().optional() });

export async function toggleCycleCheck(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(checkSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let rid = "";
  return userAction(async (c) => {
    const { cy, rc } = await lockCycle(c, d.cycleId);
    rid = rc.req.id;
    worker(rc);
    running(rc);
    if (cy.status === "closed" || cy.status === "skipped") throw new UserError("الدورة مقفلة.");
    const on = d.done === "on";
    const list = (cy.checklist ?? []).map((x) => (x.key === d.key ? { ...x, done: on, by: on ? c.auth.user.id : null, at: on ? new Date().toISOString() : null } : x));
    if (!list.some((x) => x.key === d.key)) throw new UserError("بند غير موجود.");
    await c.tx.update(serviceCycles).set({ checklist: list, updatedBy: c.auth.user.id }).where(eq(serviceCycles.id, cy.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.cycle_check", entityType: "service_cycle", entityId: cy.id, waqfId: cy.waqfId, ip: c.ip, userAgent: c.userAgent, after: { key: d.key, done: on } });
    return { ok: true, message: on ? "أُنجز البند." : "أُعيد البند." };
  }, { revalidate: () => reval(rid) });
}

const meetingSchema = z.object({ cycleId: uuid, meetingId: uuid });

export async function linkCycleMeeting(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(meetingSchema, fd);
  if ("state" in r) return r.state;
  let rid = "";
  return userAction(async (c) => {
    const { cy, rc } = await lockCycle(c, r.data.cycleId);
    rid = rc.req.id;
    worker(rc);
    running(rc);
    if (cy.status !== "open") throw new UserError("الدورة ليست مفتوحة.");
    const [m] = rc.req.waqfId ? await c.tx.select({ id: meetings.id, title: meetings.title }).from(meetings).where(and(eq(meetings.id, r.data.meetingId), eq(meetings.waqfId, rc.req.waqfId))).limit(1) : [];
    if (!m) throw new UserError("الاجتماع ليس من اجتماعات هذا الوقف.");
    await c.tx.update(serviceCycles).set({ meetingId: m.id, updatedBy: c.auth.user.id }).where(eq(serviceCycles.id, cy.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.cycle_meeting", entityType: "service_cycle", entityId: cy.id, waqfId: cy.waqfId, ip: c.ip, userAgent: c.userAgent, after: { meetingId: m.id } });
    return { ok: true, message: `رُبطت الدورة باجتماع «${m.title}».` };
  }, { revalidate: () => reval(rid) });
}

const dueSchema = z.object({ cycleId: uuid, dueOn: isoDate, reason: z.string().trim().min(5, "اكتب سبب تغيير الموعد.").max(1000) });

/** Moves a cycle's due date (e.g. after a suspension or by agreement). Managers only; the change is kept on the cycle. */
export async function rescheduleCycle(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(dueSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let rid = "";
  return userAction(async (c) => {
    const { cy, rc } = await lockCycle(c, d.cycleId);
    rid = rc.req.id;
    manager(rc);
    if (cy.status !== "open") throw new UserError("يُغيَّر موعد دورة مفتوحة فقط.");
    if (d.dueOn === cy.dueOn) return { ok: true, message: "الموعد كما هو." };
    await c.tx.update(serviceCycles).set({ dueOn: d.dueOn, dueChanges: [...(cy.dueChanges ?? []), { at: new Date().toISOString(), by: c.auth.user.id, from: cy.dueOn, to: d.dueOn, reason: d.reason }], updatedBy: c.auth.user.id }).where(eq(serviceCycles.id, cy.id));
    await c.tx.update(tasks).set({ dueOn: d.dueOn, updatedBy: c.auth.user.id }).where(and(eq(tasks.requestId, rc.req.id), eq(tasks.outputKey, cycleTaskKey(rc.service.code, cy.seq))));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.cycle_reschedule", entityType: "service_cycle", entityId: cy.id, waqfId: cy.waqfId, ip: c.ip, userAgent: c.userAgent, before: { dueOn: cy.dueOn }, after: { dueOn: d.dueOn, reason: d.reason } });
    return { ok: true, message: `نُقل موعد الاستحقاق إلى ${d.dueOn}.` };
  }, { revalidate: () => reval(rid) });
}

const cycleSchema = z.object({ cycleId: uuid, note: z.string().trim().max(2000).optional().default("") });

/**
 * Sends the cycle's delivery to the client: the approved output is rendered to PDF, attached to its delivery record
 * and made visible to the client (in-platform; nothing leaves the platform). For a minutes cycle, records the
 * board-approved minutes as delivered. The request stays in progress.
 */
export async function sendCycle(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(cycleSchema, fd);
  if ("state" in r) return r.state;
  let rid = "";
  return userAction(async (c) => {
    const { cy, rc, spec } = await lockCycle(c, r.data.cycleId);
    rid = rc.req.id;
    worker(rc);
    running(rc);
    if (cy.status !== "open") throw new UserError(cy.status === "sent" ? "أُرسل تسليم هذه الدورة من قبل." : "الدورة مقفلة.");
    const now = new Date();
    let title = cy.label;
    if (cy.outputKey) {
      const [o] = await c.tx.select().from(outputs).where(and(eq(outputs.requestId, rc.req.id), eq(outputs.outputKey, cy.outputKey))).limit(1).for("update");
      if (!o || o.status !== "approved") throw new UserError("يُرسل التسليم بعد اعتماد مخرج الدورة. الإنشاء وحده لا يعدّ اعتمادًا ولا إرسالًا.");
      await releaseOutput(c.tx, rc, o, c.auth.user.id, { ip: c.ip, userAgent: c.userAgent });
      const [o2] = await c.tx.select({ deliverableId: outputs.deliverableId, documentId: outputs.documentId, title: outputs.title }).from(outputs).where(eq(outputs.id, o.id));
      if (!o2.deliverableId) throw new UserError("لا سجل تسليم للمخرج المعتمد.");
      await c.tx.update(deliverables).set({ cycleId: cy.id, releasedAt: now, updatedBy: c.auth.user.id }).where(eq(deliverables.id, o2.deliverableId));
      if (o2.documentId) await c.tx.update(documents).set({ approvalStatus: "approved" }).where(and(eq(documents.id, o2.documentId), eq(documents.approvalStatus, "in_review")));
      title = o2.title;
    } else if (spec.delivery.kind === "minutes") {
      const checks = await inputChecks(c.tx, rc, cy, spec);
      const miss = checks.filter((x) => !x.ok);
      if (miss.length) throw new UserError(`لا يُسجل تسليم المحضر قبل: ${miss.map((x) => `${x.label} (${x.detail})`).join("؛ ")}.`);
    } else {
      throw new UserError("هذه دورة متابعة بلا مستند يُرسل: أكمل مهامها وأقفلها بملاحظة المتابعة.");
    }
    await c.tx.update(serviceCycles).set({ status: "sent", sentAt: now, sentBy: c.auth.user.id, deliveredOn: todayISO(), updatedBy: c.auth.user.id }).where(eq(serviceCycles.id, cy.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `أُرسل تسليم الدورة: ${title}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.cycle_send", entityType: "service_cycle", entityId: cy.id, waqfId: cy.waqfId, ip: c.ip, userAgent: c.userAgent, after: { seq: cy.seq, label: cy.label, outputKey: cy.outputKey, channel: "in_platform" } });
    if (rc.req.requesterUserId !== c.auth.user.id)
      await notify(rc.req.requesterUserId, "request.status", { number: rc.req.number, status: "تسليم دوري", note: title }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}`, tx: c.tx });
    return { ok: true, message: "أُرسل التسليم للعميل داخل المنصة. الطلب مستمر؛ أقفل الدورة بعد إتمام مهامها." };
  }, { revalidate: () => reval(rid) });
}

/** Closes the cycle (its record, messages, attachments and output versions stay). The request stays open. */
export async function closeCycle(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(cycleSchema, fd);
  if ("state" in r) return r.state;
  const note = r.data.note;
  let rid = "";
  return userAction(async (c) => {
    const { cy, rc, spec } = await lockCycle(c, r.data.cycleId);
    rid = rc.req.id;
    worker(rc);
    running(rc);
    const followup = !cy.outputKey && spec.delivery.kind === "followup";
    if (followup ? cy.status !== "open" : cy.status !== "sent") throw new UserError(followup ? "الدورة ليست مفتوحة." : "تُقفل الدورة بعد إرسال تسليمها للعميل.");
    const open = (cy.checklist ?? []).filter((x) => !x.done);
    if (open.length) throw new UserError(`مهام الدورة غير المنجزة: ${open.map((x) => x.label).join("، ")}.`);
    if (followup) {
      if (note.length < 10) return { error: "اكتب ملاحظة المتابعة: ما حضره العضو أو نفّذه وما سجّله (10 أحرف على الأقل).", fieldErrors: { note: "اكتب ملاحظة المتابعة." } };
      const miss = (await inputChecks(c.tx, rc, cy, spec)).filter((x) => !x.ok);
      if (miss.length) throw new UserError(`لا تُقفل الدورة قبل: ${miss.map((x) => x.label).join("، ")}.`);
    }
    const now = new Date();
    await c.tx.update(serviceCycles).set({ status: "closed", closedAt: now, closedBy: c.auth.user.id, closeNote: note || null, deliveredOn: cy.deliveredOn ?? (followup ? todayISO() : null), updatedBy: c.auth.user.id }).where(eq(serviceCycles.id, cy.id));
    await syncTask(c.tx, rc.req.id, "cycle", { outputKey: cycleTaskKey(rc.service.code, cy.seq) }, "done", c.auth.user.id, `أُقفلت الدورة${note ? `: ${note}` : ""}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.cycle_close", entityType: "service_cycle", entityId: cy.id, waqfId: cy.waqfId, ip: c.ip, userAgent: c.userAgent, after: { seq: cy.seq, label: cy.label, note: note || undefined, requestStatus: rc.req.status } });
    return { ok: true, message: `أُقفلت دورة «${cy.label}». الطلب مستمر للدورة التالية.` };
  }, { revalidate: () => reval(rid) });
}

async function skip(c: ActCtx, rc: RequestCtx, cy: CycleRow, reason: string) {
  await c.tx.update(serviceCycles).set({ status: "skipped", skippedReason: reason, updatedBy: c.auth.user.id }).where(eq(serviceCycles.id, cy.id));
  await syncTask(c.tx, rc.req.id, "cycle", { outputKey: cycleTaskKey(rc.service.code, cy.seq) }, "cancelled", c.auth.user.id, reason);
  if (cy.outputKey) {
    await syncTask(c.tx, rc.req.id, "prepare_output", { outputKey: cy.outputKey }, "cancelled", c.auth.user.id, reason);
    await syncTask(c.tx, rc.req.id, "review_output", { outputKey: cy.outputKey }, "cancelled", c.auth.user.id, reason);
  }
  await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.cycle_skip", entityType: "service_cycle", entityId: cy.id, waqfId: cy.waqfId, ip: c.ip, userAgent: c.userAgent, after: { seq: cy.seq, label: cy.label, reason } });
}

const skipSchema = z.object({ cycleId: uuid, reason: z.string().trim().min(10, "اكتب سبب التجاوز (10 أحرف على الأقل).").max(2000) });

/** A cycle that will not be delivered (agreed with the client, nothing to deliver for the period…). Managers only. */
export async function skipCycle(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(skipSchema, fd);
  if ("state" in r) return r.state;
  let rid = "";
  return userAction(async (c) => {
    const { cy, rc } = await lockCycle(c, r.data.cycleId);
    rid = rc.req.id;
    manager(rc);
    if (cy.status !== "open") throw new UserError("تُتجاوز دورة مفتوحة لم يُرسل تسليمها.");
    await skip(c, rc, cy, r.data.reason);
    await logEvent(c.tx, rc.req, c.auth.user.id, `لن يُسلَّم «${cy.label}»: ${r.data.reason}`);
    return { ok: true, message: "سُجل تجاوز الدورة بسببه." };
  }, { revalidate: () => reval(rid) });
}

const endSchema = z.object({ id: uuid, note: z.string().trim().max(2000).optional().default("") });

/** Ends the service when its term is over: the request moves to «completed» through the state machine and its guards. */
export async function endService(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(endSchema, fd);
  if ("state" in r) return r.state;
  return userAction(async (c) => {
    const { rc } = await load(c, r.data.id);
    worker(rc);
    const t = await termOf(c.tx, rc.req.id);
    const note = r.data.note || (t?.status === "terminated" ? `انتهت الخدمة بالإنهاء النافذ في ${t.terminatedOn}` : `انتهت مدة الخدمة في ${t?.endOn ?? "—"}`);
    await transition(c, rc, { to: "completed", note });
    return { ok: true, message: "أُنهيت الخدمة واكتمل الطلب. يُغلق بعد أرشفة ملفه." };
  }, { revalidate: reval(r.data.id) });
}
