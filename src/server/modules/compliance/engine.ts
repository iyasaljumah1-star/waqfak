import "server-only";
/**
 * Compliance engine runtime (DB side). Everything is data-driven from the `obligations` table:
 * an obligation added or edited in the admin panel takes effect on the next emit/sync/resyncAll
 * without code changes.
 *
 *   emit(tx, e)            regulatory event → closes / creates obligation instances
 *   sync(tx, waqfId)       standing + annual instances (current and next period), profile-derived triggers,
 *                          and retires instances that no longer apply
 *   resyncAll(tx)          sync every waqf (call after editing obligations in admin)
 *   recomputeStatuses(tx)  upcoming / due_soon / overdue by date (daily job)
 *   sendReminders(tx)      reminder / overdue notifications to waqf managers (daily job)
 *
 * All functions run inside the caller's transaction: user context (RLS-scoped) from actions,
 * system context from jobs and seeds.
 */
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  beneficialOwners, beneficiaries, facts as factsTable, assessments, holidays, obligationEvents, obligationInstances, obligations,
  penaltySchedule, permissions, portfolios, regulatoryRequirements, rolePermissions, roles, waqfMemberships, waqfs,
} from "../../db/schema";
import { dueFor } from "../../engines/compliance";
import { todayISO } from "../../engines/dates";
import { gregorian, hijri } from "../../engines/dates";
import { notify } from "../notify";
import { registerComplianceHandler, type EmitInput } from "./events";
import {
  NA_MARK, OPEN_STATUSES, PROFILE_TRIGGERS, annualPeriods, applicable, buildFacts, closureFor, isNotApplicable, isSatisfied,
  nextStatus, penaltyInfo, periodKeyFor, pickReminder, rowToDef, type ObligationRow, type WaqfFactBag,
} from "./pure";

type OblRow = typeof obligations.$inferSelect;
type InstRow = typeof obligationInstances.$inferSelect;

// ───────────── Loading ─────────────

/** Active (published) obligation definitions, straight from the DB. */
export async function loadDefinitions(tx: Tx): Promise<OblRow[]> {
  return tx.select().from(obligations).where(eq(obligations.status, "published")).orderBy(asc(obligations.code));
}

export async function loadHolidays(tx: Tx): Promise<Set<string>> {
  const rows = await tx.select({ day: holidays.day }).from(holidays);
  return new Set(rows.map((r) => r.day));
}

/** Facts about a waqf that applicability rules can reference. Returns null when the waqf is not visible. */
export async function waqfFacts(tx: Tx, waqfId: string): Promise<WaqfFactBag | null> {
  const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (!w) return null;
  // Sequential on purpose: one transaction = one connection.
  const [p] = await tx.select({ n: sql<number>`count(*)::int` }).from(portfolios).where(eq(portfolios.waqfId, waqfId));
  const [b] = await tx
    .select({ n: sql<number>`count(*)::int`, abroad: sql<number>`count(*) filter (where ${beneficiaries.residesAbroad})::int` })
    .from(beneficiaries)
    .where(and(eq(beneficiaries.waqfId, waqfId), isNull(beneficiaries.archivedAt)));
  const [bo] = await tx.select({ n: sql<number>`count(*)::int` }).from(beneficialOwners).where(and(eq(beneficialOwners.waqfId, waqfId), isNull(beneficialOwners.archivedAt)));
  const aFacts = await latestAssessmentFacts(tx, waqfId);
  return buildFacts(
    {
      id: w.id, sizeClass: w.sizeClass, legalType: w.legalType, computedType: w.computedType, status: w.status, nazirMode: w.nazirMode,
      creationMode: w.creationMode, waqfakRole: w.waqfakRole, collectsDonations: w.collectsDonations, hasForeignParty: w.hasForeignParty,
      hasBeneficiariesAbroad: w.hasBeneficiariesAbroad, hasActiveLitigation: w.hasActiveLitigation, directBenefit: w.directBenefit,
      founderAlive: w.founderAlive, fiscalYearEnd: w.fiscalYearEnd, documentedOn: w.documentedOn, registeredOn: w.registeredOn,
      registrationExpiresOn: w.registrationExpiresOn, stage: w.stage,
    },
    { portfolioCount: p?.n ?? 0, beneficiaryCount: b?.n ?? 0, beneficiariesAbroad: b?.abroad ?? 0, beneficialOwnerCount: bo?.n ?? 0, assessmentFacts: aFacts },
  );
}

/** Facts of the latest computed/published assessment of the waqf (exposed to rules as `assessment.<key>`). */
async function latestAssessmentFacts(tx: Tx, waqfId: string): Promise<Record<string, unknown>> {
  const [a] = await tx
    .select({ id: assessments.id })
    .from(assessments)
    .where(and(eq(assessments.waqfId, waqfId), inArray(assessments.status, ["computed", "published", "completed"])))
    .orderBy(sql`coalesce(${assessments.completedAt}, ${assessments.startedAt}) desc`)
    .limit(1);
  if (!a) return {};
  const rows = await tx.select({ key: factsTable.key, value: factsTable.value }).from(factsTable).where(eq(factsTable.assessmentId, a.id));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ───────────── Instance writes ─────────────

const noonRiyadh = (iso: string) => new Date(`${iso}T12:00:00+03:00`);
/** Profile-satisfied instances are stamped on time (the actual completion date is not known). */
const satisfiedAt = (due: string | null, today: string) => noonRiyadh(due && due < today ? due : today);

async function logEvent(tx: Tx, inst: { id: string; waqfId: string }, action: string, note: string | null, actorUserId?: string | null) {
  await tx.insert(obligationEvents).values({ instanceId: inst.id, waqfId: inst.waqfId, action, note, actorUserId: actorUserId ?? null });
}

type Ctx = { tx: Tx; waqfId: string; facts: WaqfFactBag; defs: OblRow[]; hol: Set<string>; today: string; actor: string | null };

type Upsert = { def: OblRow; periodKey: string; triggerDate: string | null; due: string | null; immediate: boolean; triggerNote: string };

/** Creates the instance if missing; refreshes the due date of open ones; re-opens ones retired as "not applicable". */
async function upsertInstance(c: Ctx, u: Upsert): Promise<"created" | "updated" | "reopened" | "unchanged"> {
  const { tx, waqfId } = c;
  const satisfied = isSatisfied(u.def as ObligationRow, c.facts);
  const [existing] = await tx
    .select()
    .from(obligationInstances)
    .where(and(eq(obligationInstances.waqfId, waqfId), eq(obligationInstances.obligationId, u.def.id), eq(obligationInstances.periodKey, u.periodKey)))
    .limit(1);
  if (!existing) {
    const status = satisfied ? "done" : nextStatus(u.due, c.today);
    const [row] = await tx
      .insert(obligationInstances)
      .values({
        waqfId, obligationId: u.def.id, periodKey: u.periodKey, triggerDate: u.triggerDate, dueOn: u.due, dueImmediately: u.immediate, status,
        completedAt: satisfied ? satisfiedAt(u.due, c.today) : null, createdBy: c.actor,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return "unchanged";
    await logEvent(tx, row, "created", u.triggerNote, c.actor);
    if (satisfied) await logEvent(tx, row, "completed", "مستوفى وفق بيانات ملف الوقف", c.actor);
    return "created";
  }
  if (isNotApplicable(existing.status, existing.waivedReason)) {
    await tx
      .update(obligationInstances)
      .set({ status: nextStatus(u.due, c.today), waivedReason: null, dueOn: u.due, triggerDate: u.triggerDate, dueImmediately: u.immediate, updatedBy: c.actor })
      .where(eq(obligationInstances.id, existing.id));
    await logEvent(tx, existing, "reopened", "عاد الالتزام منطبقًا بعد تحديث بيانات الوقف", c.actor);
    return "reopened";
  }
  const open = (OPEN_STATUSES as readonly string[]).includes(existing.status);
  if (open && (existing.dueOn !== u.due || existing.triggerDate !== u.triggerDate)) {
    await tx
      .update(obligationInstances)
      .set({ dueOn: u.due, triggerDate: u.triggerDate, dueImmediately: u.immediate, status: nextStatus(u.due, c.today), updatedBy: c.actor })
      .where(eq(obligationInstances.id, existing.id));
    await logEvent(tx, existing, "updated", `الموعد: ${existing.dueOn ?? "—"} ← ${u.due ?? "—"}`, c.actor);
    return "updated";
  }
  return "unchanged";
}

async function closeInstance(tx: Tx, inst: Pick<InstRow, "id" | "waqfId">, o: { date?: string; note: string; evidenceDocumentId?: string | null; actor: string | null; action?: string }) {
  await tx
    .update(obligationInstances)
    .set({
      status: "done", completedAt: o.date ? noonRiyadh(o.date) : new Date(), completedBy: o.actor,
      ...(o.evidenceDocumentId ? { evidenceDocumentId: o.evidenceDocumentId } : {}), updatedBy: o.actor,
    })
    .where(eq(obligationInstances.id, inst.id));
  await logEvent(tx, inst, o.action ?? "closed_by_event", o.note, o.actor);
}

async function openInstancesOf(tx: Tx, waqfId: string, obligationId: string) {
  return tx
    .select()
    .from(obligationInstances)
    .where(and(eq(obligationInstances.waqfId, waqfId), eq(obligationInstances.obligationId, obligationId), inArray(obligationInstances.status, [...OPEN_STATUSES])))
    .orderBy(sql`${obligationInstances.dueOn} asc nulls last`, sql`${obligationInstances.triggerDate} asc nulls last`, asc(obligationInstances.createdAt));
}

const EVENT_AR: Record<string, string> = {
  documentation: "توثيق الوقف", registration: "تسجيل الوقف لدى الهيئة", material_change: "تغيير جوهري", cert_expiry: "انتهاء شهادة التسجيل",
  asset_substitution: "استبدال أصل", mortgage: "رهن أصل", fiscal_year_end: "نهاية السنة المالية", bo_change: "تغيير في المستفيد الحقيقي",
  nazara_end: "انتهاء النظارة", conflict_declared: "إقرار تعارض مصالح", gaa_request: "طلب من الهيئة", violation_decision: "قرار مخالفة",
  suspension_decision: "قرار إيقاف أو عزل", statements_final: "اعتماد القوائم المالية", portfolio_deed: "وقف المحفظة", portfolio_certificate: "شهادة تسجيل المحفظة",
  portfolio_created: "إنشاء المحفظة", product_change: "تغيير جوهري في المنتج", donation_license_expiry: "انتهاء ترخيص جمع التبرعات",
  donation_collection_end: "انتهاء مدة جمع التبرعات", standing: "التزام دائم",
};
export const eventLabel = (e: string) => EVENT_AR[e] ?? e;

/** Applies one event: closures first (data: closesOn), then creates/updates triggered instances. */
async function applyEvent(c: Ctx, e: Pick<EmitInput, "event" | "date" | "refId" | "meta" | "dueOverride">) {
  const evidence = typeof e.meta?.documentId === "string" ? (e.meta.documentId as string) : null;
  const result = { created: 0, updated: 0, closed: 0 };
  for (const def of c.defs) {
    const scope = closureFor(def as ObligationRow, e.event);
    if (!scope) continue;
    const newKey = def.triggerEvent === e.event ? periodKeyFor(def, e) : null;
    let open = await openInstancesOf(c.tx, c.waqfId, def.id);
    if (scope === "other_periods") open = open.filter((i) => i.periodKey !== newKey);
    if (scope === "earliest_open") open = open.slice(0, 1);
    for (const i of open) {
      await closeInstance(c.tx, i, { date: e.date <= c.today ? e.date : c.today, note: `أُغلق تلقائيًا بحدث: ${eventLabel(e.event)} (${e.date})`, evidenceDocumentId: evidence, actor: c.actor });
      result.closed++;
    }
  }
  for (const def of c.defs) {
    if (def.triggerEvent !== e.event) continue;
    if (!applicable(def as ObligationRow, c.facts)) continue;
    const d = rowToDef(def as ObligationRow);
    const { due, immediate } = e.dueOverride ? { due: e.dueOverride, immediate: false } : dueFor(d, e.date, c.hol);
    const r = await upsertInstance(c, { def, periodKey: periodKeyFor(def, e), triggerDate: e.date, due, immediate, triggerNote: `${eventLabel(e.event)} بتاريخ ${e.date}` });
    if (r === "created" || r === "reopened") result.created++;
    if (r === "updated") result.updated++;
  }
  return result;
}

async function context(tx: Tx, waqfId: string, actor: string | null = null): Promise<Ctx | null> {
  const facts = await waqfFacts(tx, waqfId);
  if (!facts) return null;
  const defs = await loadDefinitions(tx);
  const hol = await loadHolidays(tx);
  return { tx, waqfId, facts, defs, hol, today: todayISO(), actor };
}

// ───────────── Public API ─────────────

/** Records a regulatory event for a waqf (registered as the events.ts handler). */
export async function emit(tx: Tx, e: EmitInput) {
  const c = await context(tx, e.waqfId, e.actorUserId ?? null);
  if (!c) return { created: 0, updated: 0, closed: 0 };
  return applyEvent(c, e);
}

/**
 * Materialises standing and annual instances (current + next period), profile-derived triggers,
 * closes instances whose `satisfiedWhen` now holds, and retires instances that no longer apply.
 * Idempotent: running it twice changes nothing the second time.
 */
export async function sync(tx: Tx, waqfId: string, actor: string | null = null) {
  const c = await context(tx, waqfId, actor);
  const stats = { created: 0, updated: 0, closed: 0, retired: 0, deleted: 0 };
  if (!c) return stats;
  const f = c.facts;
  for (const def of c.defs) {
    if (!applicable(def as ObligationRow, f)) continue;
    const d = rowToDef(def as ObligationRow);
    let r: Awaited<ReturnType<typeof upsertInstance>> | null = null;
    if (def.triggerEvent === "standing") {
      if (!f.documented) continue;
      r = await upsertInstance(c, { def, periodKey: "standing", triggerDate: f.documentedOn, due: null, immediate: false, triggerNote: "التزام دائم منذ توثيق الوقف" });
      count(stats, r);
    } else if (def.recurrence === "annual" && def.triggerEvent === "fiscal_year_end") {
      if (!f.documented) continue;
      for (const fye of annualPeriods(f.fiscalYearEnd, c.today, f.documentedOn)) {
        const { due, immediate } = dueFor(d, fye, c.hol);
        r = await upsertInstance(c, { def, periodKey: periodKeyFor(def, { event: "fiscal_year_end", date: fye }), triggerDate: fye, due, immediate, triggerNote: `نهاية السنة المالية ${fye}` });
        count(stats, r);
      }
    }
  }
  // Profile fields acting as triggers (documentation date, certificate expiry) — same path as emit (closures included).
  for (const [event, pick] of Object.entries(PROFILE_TRIGGERS)) {
    const date = pick(f);
    if (!date) continue;
    if (!c.defs.some((d) => d.triggerEvent === event || closureFor(d as ObligationRow, event))) continue;
    const r = await applyEvent(c, { event: event as EmitInput["event"], date });
    stats.created += r.created;
    stats.updated += r.updated;
    stats.closed += r.closed;
  }
  // Review open instances: satisfied → done; not applicable any more → retire.
  const defById = new Map(c.defs.map((d) => [d.id, d]));
  const open = await tx
    .select({ i: obligationInstances, type: obligations.obligationType, code: obligations.code })
    .from(obligationInstances)
    .innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId))
    .where(and(eq(obligationInstances.waqfId, waqfId), inArray(obligationInstances.status, [...OPEN_STATUSES])));
  for (const { i, type } of open) {
    if (type === "manual") continue;
    const def = defById.get(i.obligationId);
    if (def && applicable(def as ObligationRow, f)) {
      if (isSatisfied(def as ObligationRow, f)) {
        await closeInstance(tx, i, { date: i.dueOn && i.dueOn < c.today ? i.dueOn : c.today, note: "مستوفى وفق بيانات ملف الوقف", actor, action: "completed" });
        stats.closed++;
      }
      continue;
    }
    const reason = def ? "تغيّرت بيانات الوقف فلم يعد الالتزام منطبقًا" : "أُوقف الالتزام في إعدادات الامتثال";
    if (await isUntouched(tx, i)) {
      await tx.delete(obligationInstances).where(eq(obligationInstances.id, i.id));
      stats.deleted++;
    } else {
      await tx.update(obligationInstances).set({ status: "waived", waivedReason: NA_MARK + reason, updatedBy: actor }).where(eq(obligationInstances.id, i.id));
      await logEvent(tx, i, "not_applicable", reason, actor);
      stats.retired++;
    }
  }
  return stats;
}

function count(s: { created: number; updated: number }, r: string | null) {
  if (r === "created" || r === "reopened") s.created++;
  if (r === "updated") s.updated++;
}

async function isUntouched(tx: Tx, i: InstRow) {
  if (i.evidenceDocumentId || (Array.isArray(i.remindersSent) && i.remindersSent.length) || i.assigneeUserId) return false;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(obligationEvents)
    .where(and(eq(obligationEvents.instanceId, i.id), notInArray(obligationEvents.action, ["created", "updated", "status"])));
  return (r?.n ?? 0) === 0;
}

/** Re-syncs every waqf visible in the current context (the admin panel calls this after editing obligations). */
export async function resyncAll(tx: Tx, actor: string | null = null) {
  const ws = await tx.select({ id: waqfs.id }).from(waqfs).where(isNull(waqfs.archivedAt));
  const total = { waqfs: 0, created: 0, updated: 0, closed: 0, retired: 0, deleted: 0 };
  for (const w of ws) {
    const s = await sync(tx, w.id, actor);
    total.waqfs++;
    total.created += s.created;
    total.updated += s.updated;
    total.closed += s.closed;
    total.retired += s.retired;
    total.deleted += s.deleted;
  }
  return total;
}

/**
 * Public entry point for the admin obligation editor: after creating/editing/retiring an obligation definition,
 * call `await resyncAllWaqfs(tx)` inside the same transaction so every waqf picks up the change (scenario 6:
 * an admin-added obligation with a JSON-logic `rule` in applies_to applies with no code change).
 * Run it under a context that can see all waqfs (staff global access or system) — RLS limits it otherwise.
 */
export const resyncAllWaqfs = (tx: Tx, actor: string | null = null) => resyncAll(tx, actor);

/** Moves open instances between upcoming / due_soon / overdue according to today's date. */
export async function recomputeStatuses(tx: Tx, today = todayISO()) {
  const rows = await tx.select().from(obligationInstances).where(inArray(obligationInstances.status, [...OPEN_STATUSES]));
  let changed = 0;
  for (const i of rows) {
    const s = nextStatus(i.dueOn, today);
    if (s === i.status) continue;
    await tx.update(obligationInstances).set({ status: s }).where(eq(obligationInstances.id, i.id));
    await logEvent(tx, i, "status", `${i.status} → ${s}`, null);
    changed++;
  }
  return { checked: rows.length, changed };
}

/**
 * Roles whose members receive compliance reminders: roles granted compliance.view or compliance.manage in the DB
 * role → permission map (queried directly so the engine stays free of Next.js runtime imports for scripts).
 */
export async function managerRoleKeys(tx: Tx): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ role: roles.key })
    .from(rolePermissions)
    .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(permissions.key, ["compliance.view", "compliance.manage"]));
  return rows.map((r) => r.role);
}

/** Sends due reminders (before the deadline) and overdue notices; deduped per instance + offset. */
export async function sendReminders(tx: Tx, today = todayISO()) {
  const rows = await tx
    .select({ i: obligationInstances, o: obligations, waqfName: waqfs.name, sizeClass: waqfs.sizeClass })
    .from(obligationInstances)
    .innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId))
    .innerJoin(waqfs, eq(waqfs.id, obligationInstances.waqfId))
    .where(and(inArray(obligationInstances.status, [...OPEN_STATUSES]), sql`${obligationInstances.dueOn} is not null`));
  if (!rows.length) return { sent: 0, notifications: 0 };
  const roleKeys = await managerRoleKeys(tx);
  const waqfIds = [...new Set(rows.map((r) => r.i.waqfId))];
  const mems = roleKeys.length
    ? await tx
        .select({ waqfId: waqfMemberships.waqfId, userId: waqfMemberships.userId })
        .from(waqfMemberships)
        .where(and(inArray(waqfMemberships.waqfId, waqfIds), inArray(waqfMemberships.roleKey, roleKeys), eq(waqfMemberships.status, "active"), or(isNull(waqfMemberships.endsAt), sql`${waqfMemberships.endsAt} > now()`)))
    : [];
  const recipients = new Map<string, Set<string>>();
  for (const m of mems) {
    if (!recipients.has(m.waqfId)) recipients.set(m.waqfId, new Set());
    recipients.get(m.waqfId)!.add(m.userId);
  }
  const pens = new Map((await tx.select().from(penaltySchedule)).map((p) => [p.code, p]));
  const refLabels = await referenceLabels(tx);
  let sent = 0;
  let notifications = 0;
  for (const { i, o, waqfName, sizeClass } of rows) {
    const sentBefore = (Array.isArray(i.remindersSent) ? i.remindersSent : []).map(Number);
    const pick = pickReminder(i.dueOn, today, rowToDef(o as ObligationRow).reminderOffsetsDays, sentBefore);
    if (!pick) continue;
    const [dup] = await tx
      .select({ id: obligationEvents.id })
      .from(obligationEvents)
      .where(and(eq(obligationEvents.instanceId, i.id), eq(obligationEvents.action, "reminder"), eq(obligationEvents.note, `offset:${pick.offset}`)))
      .limit(1);
    const covered = [...new Set([...sentBefore, ...pick.covered])];
    if (!dup) {
      const pen = penaltyInfo(o.penaltyCode ? pens.get(o.penaltyCode) : null, o.severity, sizeClass);
      const vars = {
        title: o.titleAr,
        waqf: waqfName,
        due: `${gregorian(i.dueOn)} (${hijri(i.dueOn)})`,
        reference: refLabels.get(o.id) ?? o.referenceText,
        penalty: pen?.text ?? "لا يوجد بند جزاء مرتبط في الجدول",
      };
      for (const userId of recipients.get(i.waqfId) ?? []) {
        await notify(userId, pick.kind === "overdue" ? "obligation.overdue" : "obligation.reminder", vars, { waqfId: i.waqfId, link: `/app/w/${i.waqfId}/compliance#i-${i.id}`, tx });
        notifications++;
      }
      await logEvent(tx, i, "reminder", `offset:${pick.offset}`, null);
      sent++;
    }
    await tx.update(obligationInstances).set({ remindersSent: covered, lastReminderAt: new Date() }).where(eq(obligationInstances.id, i.id));
  }
  return { sent, notifications };
}

/**
 * Reference label per obligation id: the obligation's own reference text (source + article, the most precise),
 * followed by the requirement code when traced (e.g. "لائحة تنظيم أعمال النظارة م8/1 · REQ-001").
 */
export async function referenceLabels(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: obligations.id, text: obligations.referenceText, req: regulatoryRequirements.code })
    .from(obligations)
    .leftJoin(regulatoryRequirements, eq(regulatoryRequirements.id, obligations.requirementId));
  return new Map(rows.map((r) => [r.id, r.req ? `${r.text} · ${r.req}` : r.text]));
}

registerComplianceHandler({
  emit: async (tx, e) => {
    await emit(tx, e);
  },
  sync: async (tx, waqfId) => {
    await sync(tx, waqfId);
  },
});
