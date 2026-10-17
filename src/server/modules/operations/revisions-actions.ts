"use server";

import { collectContext } from "@/server/modules/outputs/collect";
import { syncConflicts } from "@/server/modules/outputs/quality";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { contracts, invoices, outputs, quotes, requestRevisions, requestStages, serviceRequests } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { loadRequestCtx, type RequestCtx } from "@/server/modules/requests/access";
import { applyStagePlan, recomputeSla, transition, type ActCtx } from "@/server/modules/requests/engine";
import { findField, sanitizeAnswers, tableRows, validateField, visibleFields, visibleSteps, type Answers } from "@/server/modules/requests/intake/engine";
import { intakeOf, serviceForm } from "@/server/modules/requests/intake/server";
import { syncStageTasks, syncTask } from "./exec";
import { recordFieldState } from "@/server/modules/requests/field-state";
import { workStages } from "./exec-pure";
import { reopenStagePlan, revisionImpact, rollbackOptions, type RollbackTarget } from "./revisions-pure";
import type { ActionState } from "@/lib/utils";

/**
 * Controlled corrections of a request by the team: going back to an earlier point, or correcting/completing the
 * client's answers. Each is a recorded revision (who, why, before/after, impact). Nothing is erased: approvals, sent
 * quotes, signed contracts and issued invoices stay, and the impact list names the correction path for each.
 */

const reval = (id: string) => [`/admin/requests/${id}`, `/app/requests/${id}`];

async function impactOf(c: ActCtx, rc: RequestCtx, kind: Parameters<typeof revisionImpact>[1]) {
  const id = rc.req.id;
  const [o, q, k, i] = await Promise.all([
    c.tx.select({ id: outputs.id, title: outputs.title, status: outputs.status }).from(outputs).where(eq(outputs.requestId, id)),
    c.tx.select({ id: quotes.id, number: quotes.number, status: quotes.status, kind: quotes.kind }).from(quotes).where(eq(quotes.requestId, id)),
    c.tx.select({ id: contracts.id, number: contracts.number, status: contracts.status }).from(contracts).where(eq(contracts.requestId, id)),
    c.tx.select({ id: invoices.id, number: invoices.number, status: invoices.status, kind: invoices.kind }).from(invoices).where(eq(invoices.requestId, id)),
  ]);
  return revisionImpact({ outputs: o, quotes: q, contracts: k, invoices: i, verified: !!rc.req.intakeVerifiedAt, accepted: !!rc.req.acceptedAt }, kind);
}

// ───────────────────────── Going back ─────────────────────────

const rollbackSchema = z.object({
  id: z.string().uuid(),
  target: z.string().regex(/^(intake|scope|execution|stage:[a-z0-9_-]{1,40})$/, "اختر النقطة المراد الرجوع إليها."),
  reason: z.string().trim().min(10, "اكتب سبب الرجوع (10 أحرف على الأقل).").max(1000),
});

export async function rollbackRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(rollbackSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const target = d.target as RollbackTarget;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("الرجوع إلى مرحلة سابقة للمسند أو لمدير التشغيل.");
    const stageRows = await c.tx.select().from(requestStages).where(eq(requestStages.requestId, d.id)).orderBy(asc(requestStages.position));
    const work = new Set(workStages(rc.stagesDef).map((s) => s.key));
    const hasSentQuote = (await c.tx.select({ s: quotes.status }).from(quotes).where(eq(quotes.requestId, d.id))).some((q) => ["sent", "accepted"].includes(q.s));
    const opt = rollbackOptions({ status: rc.req.status, hasSentQuote, workStages: stageRows.filter((s) => work.has(s.stageKey)).map((s) => ({ key: s.stageKey, name: s.name, status: s.status })) }).find((o) => o.target === target);
    if (!opt) throw new UserError("لا يمكن الرجوع إلى هذه النقطة في حالة الطلب الحالية (تغيّرت الحالة، أو صار للطلب عرض مرسل: يُصحَّح بنسخة جديدة).");
    if (opt.opsOnly && !rc.isOps) throw new ForbiddenError("سحب ما أُرسل للعميل لمدير التشغيل.");
    const impact = await impactOf(c, rc, target);
    const before = { status: rc.req.status, verified: !!rc.req.intakeVerifiedAt, accepted: !!rc.req.acceptedAt, stages: stageRows.map((s) => ({ key: s.stageKey, status: s.status })) };

    if (target === "intake") {
      await c.tx.update(serviceRequests).set({ intakeVerifiedAt: null, intakeVerifiedBy: null, acceptedAt: null, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
      await syncTask(c.tx, d.id, "intake", {}, "todo", c.auth.user.id, `أُعيدت مراجعة البيانات: ${d.reason}`);
    } else if (target === "scope") {
      await transition(c, rc, { to: "triage", note: `إعادة دراسة النطاق: ${d.reason}` });
    } else if (target === "execution") {
      // Pulling work back from quality review or from the client is a recorded team decision; guards still apply.
      await transition(c, rc, { to: "in_progress", note: `أعاد الفريق الطلب للتنفيذ للتصحيح: ${d.reason}`, system: true });
    } else {
      const key = target.slice("stage:".length);
      const next = reopenStagePlan(stageRows.map((s) => ({ key: s.stageKey, status: s.status })), key);
      if (!next) throw new UserError("المرحلة ليست منجزة قبل المرحلة الحالية.");
      await applyStagePlan(c.tx, d.id, next, c.auth.user.id);
      await recomputeSla(c.tx, d.id, { restartActive: true });
      await syncStageTasks(c.tx, d.id, c.auth.user.id, `أُعيد فتح المرحلة: ${d.reason}`, { reopen: true });
    }
    const [after] = await c.tx.select({ status: serviceRequests.status, verified: serviceRequests.intakeVerifiedAt, accepted: serviceRequests.acceptedAt }).from(serviceRequests).where(eq(serviceRequests.id, d.id));
    await c.tx.insert(requestRevisions).values({ requestId: d.id, waqfId: rc.req.waqfId, kind: "rollback", target, reason: d.reason, before, after: { status: after.status, verified: !!after.verified, accepted: !!after.accepted }, impact, actorUserId: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.rollback", entityType: "service_request", entityId: d.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before, after: { target, reason: d.reason, impact: impact.length } });
    return { ok: true, message: `تم الرجوع: ${opt.label}.${impact.length ? ` راجع ${impact.length} من الآثار المسجلة.` : ""}` };
  }, { revalidate: reval(d.id) });
}

// ───────────────────────── Correcting the client's answers ─────────────────────────

const editSchema = z.object({
  id: z.string().uuid(),
  field: z.string().min(1).max(60),
  value: z.string().max(20_000).optional().default(""),
  values: z.array(z.string().max(200)).optional(),
  reason: z.string().trim().min(10, "اكتب سبب التصحيح ومصدره (10 أحرف على الأقل).").max(1000),
});

/**
 * Staff correct or complete one answer of the form (with the reason and its source). The value is validated by the
 * field's own rules; the previous value is kept in the revision record; drafts based on the old answers are flagged
 * for regeneration through the impact list.
 */
export async function staffEditIntake(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(editSchema, { id: fd.get("id"), field: fd.get("field"), value: fd.get("value") ?? "", values: fd.getAll("values").map(String), reason: fd.get("reason") });
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("تصحيح بيانات الطلب للمسند أو لمدير التشغيل.");
    if (["draft", "completed", "closed", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("لا تُصحَّح بيانات طلب مسودة أو منتهٍ.");
    const form = serviceForm(rc.service);
    const intake = intakeOf(rc.req);
    if (!intake.formVersion) throw new UserError("طلب سابق لنماذج الخدمات: تُستكمل بياناته عبر سجل النواقص.");
    const found = findField(form, d.field);
    if (!found) throw new UserError("الحقل غير موجود في نموذج الخدمة.");
    const f = found.field;
    const answers: Answers = { ...(intake.answers ?? {}) };
    if (!visibleSteps(form, answers).some((st) => st.key === found.step.key && visibleFields(st, answers).some((x) => x.key === f.key))) throw new UserError("الحقل غير ظاهر بحسب الإجابات الحالية.");
    let value: Answers[string];
    if (f.type === "checkboxes") value = d.values ?? [];
    else if (f.type === "table") value = tableRows(d.value).length ? d.value : "";
    else value = d.value.trim();
    const next = sanitizeAnswers(form, { ...answers, [f.key]: value });
    const err = validateField(f, next[f.key], next);
    if (err) return { error: err, fieldErrors: { value: err } };
    const before = answers[f.key] ?? null;
    if (JSON.stringify(before) === JSON.stringify(next[f.key] ?? null)) return { ok: true, message: "القيمة لم تتغير." };
    // a correction that makes other answers inapplicable is confirmed first, naming them
    const willDrop = Object.keys(answers).filter((k) => k !== f.key && answers[k] !== undefined && answers[k] !== "" && next[k] === undefined);
    if (willDrop.length && fd.get("confirmDrop") !== "on")
      return { error: `هذا التصحيح يجعل إجابات أخرى غير منطبقة: ${willDrop.map((k) => findField(form, k)?.field.label ?? k).join("، ")}. أكّد التصحيح لتُحفظ قيمها في سجل التعديلات وتُسقط من الطلب.`, data: { needConfirm: true } };
    await c.tx.update(serviceRequests).set({ intake: { ...intake, answers: next }, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    const impact = await impactOf(c, rc, "intake_edit");
    // answers that depended on this one and are no longer shown are cleared by the form rules: they are recorded in the
    // revision with their previous value (nothing disappears without a trace, and they can be restored)
    const dropped = Object.keys(answers).filter((k) => k !== f.key && answers[k] !== undefined && answers[k] !== "" && next[k] === undefined);
    await c.tx.insert(requestRevisions).values({
      requestId: d.id, waqfId: rc.req.waqfId, kind: "intake_edit", target: f.key, reason: d.reason,
      before: { [f.key]: before, ...Object.fromEntries(dropped.map((k) => [k, answers[k]])) }, after: { [f.key]: next[f.key] ?? null, ...Object.fromEntries(dropped.map((k) => [k, null])) },
      impact, actorUserId: c.auth.user.id,
    });
    // the audit keeps the values too (identity and phone numbers masked; the full values stay in the revision record)
    const shown = (v: unknown) => (["idnumber", "phone"].includes(f.type) && typeof v === "string" ? `••••${v.slice(-4)}` : v);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.intake_edit", entityType: "service_request", entityId: d.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before: { field: f.key, value: shown(before) }, after: { field: f.key, value: shown(next[f.key] ?? null), reason: d.reason } });
    // an edit is not an approval: the field goes back to review (and an earlier approval no longer covers it)
    await recordFieldState(c.tx, rc, f.key, { at: new Date().toISOString(), by: c.auth.user.id, action: "changed", note: d.reason, value: next[f.key] ?? null }, "needs_review");
    // validation runs again on the corrected data: conflicts it removed are resolved (by this correction), new ones open
    const fresh = { ...rc, req: { ...rc.req, intake: { ...intake, answers: next } } };
    const ctx = await collectContext(c.tx, fresh);
    const sync = await syncConflicts(c.tx, fresh, ctx.conflicts ?? [], { actorId: c.auth.user.id, ip: c.ip, userAgent: c.userAgent, reason: `تصحيح «${f.label}»: ${d.reason}` });
    const conflictLine = [sync.resolved.length ? ` زال ${sync.resolved.length} تعارض.` : "", sync.opened.length ? ` ظهر ${sync.opened.length} تعارض جديد.` : "", sync.open.length ? ` التعارضات القائمة: ${sync.open.length}.` : ""].join("");
    const droppedLine = dropped.length ? ` أُسقطت ${dropped.length} من الإجابات المرتبطة التي لم تعد تنطبق (محفوظة بقيمها في سجل التعديلات): ${dropped.map((k) => findField(form, k)?.field.label ?? k).join("، ")}.` : "";
    return { ok: true, message: `صُحّح «${f.label}».${droppedLine}${conflictLine}${impact.some((x) => x.kind === "output") ? " أعد توليد المخرجات المبنية على البيانات السابقة." : ""}` };
  }, { revalidate: reval(d.id) });
}
