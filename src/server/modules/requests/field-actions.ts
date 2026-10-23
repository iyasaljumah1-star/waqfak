"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { roles, tasks, userRoles, users } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { notify } from "@/server/modules/notify";
import type { ActionState } from "@/lib/utils";
import { assignableRoleKeys, loadRequestCtx, type RequestCtx } from "./access";
import { contextFor } from "./context/map";
import { resolveContext } from "./context/resolve";
import { isCtxField, periodFor, type ContextKey } from "./context/types";
import { findField, validateField, visibleFields, visibleSteps } from "./intake/engine";
import { intakeOf, serviceForm } from "./intake/server";
import { todayISO } from "@/server/engines/dates";
import { recordFieldState } from "./field-state";
import { FIELD_REVIEW_SERVICES, isEssential } from "./field-policy";
import { logEvent } from "./engine";
import type { Tx } from "@/server/db";

/**
 * Field-level review of a request by the team: approving one field (or one waqf-file block) after reviewing it,
 * reopening it for review, and creating a task tied to it. Approving a field never approves another field or the
 * request; editing a field (staffEditIntake) or a client's completion puts it back to review.
 */

const reval = (id: string) => [`/admin/requests/${id}`, `/app/requests/${id}`];
const FIELD = z.string().trim().min(1).max(80).regex(/^(ctx:[a-z.]+|[A-Za-z][A-Za-z0-9_]*)$/, "حقل غير صالح.");

/** Current value of a field, or the fingerprint of a waqf-file block: what an approval is attached to. */
async function currentValue(tx: Tx, rc: RequestCtx, key: string): Promise<{ label: string; value: unknown; error: string | null }> {
  const form = serviceForm(rc.service);
  const answers = intakeOf(rc.req).answers ?? {};
  if (isCtxField(key)) {
    const k = key.slice(4) as ContextKey;
    if (!contextFor(rc.service.code).includes(k) || !rc.req.waqfId) throw new UserError("هذه البيانات ليست من بيانات هذه الخدمة.");
    const [b] = await resolveContext(tx, rc.req.waqfId, [k], periodFor(answers, todayISO()), { serviceCode: rc.service.code, requestId: rc.req.id });
    if (!b) throw new UserError("تعذرت قراءة البيانات من ملف الوقف.");
    return { label: b.title, value: b.fingerprint, error: b.status === "missing" ? "لا سجلات في ملف الوقف لهذا البند؛ لا يُعتمد ما لم يُسجَّل." : null };
  }
  const found = findField(form, key);
  if (!found) throw new UserError("الحقل غير موجود في نموذج الخدمة.");
  if (!visibleSteps(form, answers).some((st) => st.key === found.step.key && visibleFields(st, answers).some((x) => x.key === key))) throw new UserError("الحقل غير ظاهر بحسب الإجابات الحالية.");
  return { label: found.field.label, value: answers[key] ?? null, error: validateField(found.field, answers[key], answers) };
}

const stateSchema = z.object({
  id: z.string().uuid(),
  field: FIELD,
  decision: z.enum(["approve", "reopen"]),
  note: z.string().trim().max(1000).optional().default(""),
});

export async function setFieldState(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(stateSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("مراجعة الحقول واعتمادها للمسند أو لمدير التشغيل.");
    if (["draft", "closed", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("لا تُراجع حقول طلب مسودة أو منتهٍ.");
    const cur = await currentValue(c.tx, rc, d.field);
    if (d.decision === "approve") {
      if (cur.error) throw new UserError(`لا يُعتمد «${cur.label}»: ${cur.error}`);
      if (cur.value === null || cur.value === "") throw new UserError(`لا يُعتمد «${cur.label}» وهو فارغ.`);
      await recordFieldState(c.tx, rc, d.field, { at: new Date().toISOString(), by: c.auth.user.id, action: "approve", note: d.note || null, value: cur.value }, "approved", cur.value);
    } else {
      if (d.note.length < 5) return { error: "اذكر سبب إعادة المراجعة.", fieldErrors: { note: "اذكر سبب إعادة المراجعة." } };
      await recordFieldState(c.tx, rc, d.field, { at: new Date().toISOString(), by: c.auth.user.id, action: "reopen", note: d.note }, "needs_review");
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: d.decision === "approve" ? "requests.field_approved" : "requests.field_reopened", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { field: d.field, note: d.note || null } });
    return { ok: true, message: d.decision === "approve" ? `اعتُمد «${cur.label}». لا يمتد الاعتماد إلى غيره من الحقول ولا إلى الطلب.` : `أُعيد «${cur.label}» للمراجعة.` };
  }, { revalidate: reval(d.id) });
}

const taskSchema = z.object({
  id: z.string().uuid(),
  field: FIELD,
  title: z.string().trim().min(5, "اكتب عنوان المهمة.").max(300),
  assigneeUserId: z.string().uuid().optional().or(z.literal("")).default(""),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).default(""),
});

/** A team task created from a field or block: it carries the field so everyone sees why it exists and what closes it. */
export async function createFieldTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(taskSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps) throw new ForbiddenError("إنشاء مهام الطلب للمسند أو لمدير التشغيل.");
    if (["draft", "closed", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("لا تُنشأ مهام لطلب مسودة أو منتهٍ.");
    const cur = await currentValue(c.tx, rc, d.field);
    if (d.dueOn && d.dueOn < todayISO()) throw new UserError("موعد المهمة في الماضي.");
    let assignee: string | null = null;
    if (d.assigneeUserId) {
      const keys = await assignableRoleKeys();
      const [emp] = await c.tx.select({ id: users.id }).from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(users.id, d.assigneeUserId), eq(users.isStaff, true), eq(users.status, "active"), inArray(roles.key, keys))).limit(1);
      if (!emp) throw new UserError("اختر موظفًا يحمل دورًا تشغيليًا.");
      assignee = emp.id;
    }
    const [t] = await c.tx.insert(tasks).values({
      waqfId: rc.req.waqfId, requestId: rc.req.id, sourceType: "request", sourceId: rc.req.id, title: d.title,
      description: `مرتبطة بـ«${cur.label}» في الطلب ${rc.req.number}.`, assigneeUserId: assignee ?? rc.req.assignedToUserId, dueOn: d.dueOn || null,
      priority: "normal", status: "todo", visibility: "internal", fieldKey: d.field, createdBy: c.auth.user.id, updatedBy: c.auth.user.id, // no exec kind: a request may have many field tasks
    }).returning({ id: tasks.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.field_task", entityType: "task", entityId: t.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { request: rc.req.id, field: d.field, title: d.title, assignee, dueOn: d.dueOn || null } });
    const to = assignee ?? rc.req.assignedToUserId;
    if (to && to !== c.auth.user.id) await notify(to, "task.assigned", { title: d.title, waqf: rc.waqf?.name ?? "—", due: d.dueOn || "غير محدد" }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}#work`, tx: c.tx }).catch(() => undefined);
    return { ok: true, message: `أُنشئت المهمة «${d.title}» مرتبطة بـ«${cur.label}».` };
  }, { revalidate: reval(d.id) });
}

const waiveSchema = z.object({
  id: z.string().uuid(),
  fields: z.array(FIELD).min(1, "اختر الحقول الثانوية التي يُتجاوز عن مراجعتها.").max(80),
  reason: z.string().trim().min(15, "اكتب سبب التجاوز (15 حرفًا على الأقل)."),
});

/**
 * Records that secondary fields are released without a field-by-field review (ACC-12): only by an authorized reviewer
 * (quality-review permission or operations manager), with a written reason, and never for an essential field. Each
 * waiver is attached to the field's current value (a later change reopens it) and recorded in the request log and audit.
 */
export async function waiveSecondaryFields(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(waiveSchema, { id: fd.get("id"), fields: fd.getAll("fields").map(String), reason: fd.get("reason") });
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!c.auth.perms.has("staff.quality_review") && !rc.isOps) throw new ForbiddenError("تجاوز مراجعة الحقول الثانوية لمراجع مخول (صلاحية مراجعة الجودة) أو لمدير التشغيل.");
    if (["draft", "closed", "cancelled", "rejected"].includes(rc.req.status)) throw new UserError("لا تُراجع حقول طلب مسودة أو منتهٍ.");
    if (!FIELD_REVIEW_SERVICES.includes(rc.service.code)) throw new UserError("لا تُطبَّق سياسة مراجعة الحقول على هذه الخدمة بعد.");
    const essential = d.fields.filter((k) => isEssential(rc.service.code, k));
    if (essential.length) throw new UserError(`لا يجوز تجاوز مراجعة حقل جوهري: ${essential.join("، ")}. يُراجع ويُعتمد.`);
    const labels: string[] = [];
    for (const key of [...new Set(d.fields)]) {
      const cur = await currentValue(c.tx, rc, key);
      await recordFieldState(c.tx, rc, key, { at: new Date().toISOString(), by: c.auth.user.id, action: "waive", note: d.reason, value: cur.value }, "waived", cur.value);
      labels.push(cur.label);
    }
    await logEvent(c.tx, rc.req, c.auth.user.id, `تجاوز موثق لمراجعة ${labels.length} من الحقول الثانوية: ${labels.map((l) => `«${l}»`).join("، ")} — السبب: ${d.reason}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.fields_waived", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { fields: d.fields, reason: d.reason } });
    return { ok: true, message: `سُجّل تجاوز مراجعة ${labels.length} من الحقول الثانوية بسببه.` };
  }, { revalidate: reval(d.id) });
}
