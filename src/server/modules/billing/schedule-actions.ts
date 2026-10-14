"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { paymentSchedule, settings } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { logEvent } from "@/server/modules/requests/engine";
import type { ActionState } from "@/lib/utils";
import { DUE_ALERTS_KEY } from "./schedule";
import { dueAlertSettings } from "./schedule-pure";

const dueSchema = z.object({
  scheduleId: z.string().uuid(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "حدّد تاريخ الاستحقاق."),
  reason: z.string().trim().min(5, "اكتب سبب تحديد الموعد أو تغييره ومرجعه.").max(1000),
});

/**
 * Sets the due date of an installment tied to a milestone when it is reached, or changes a contractual date by a
 * written agreement. Finance or an authorized manager; the old and new dates and the reason are kept on the row.
 */
export async function setInstallmentDue(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(dueSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let rid = "";
  return userAction(async (c) => {
    if (!c.auth.perms.has("admin.finance") && !c.auth.perms.has("admin.requests.all")) throw new ForbiddenError("تحديد مواعيد الدفعات للمالية أو لمدير مخوّل.");
    const [s] = await c.tx.select().from(paymentSchedule).where(eq(paymentSchedule.id, d.scheduleId)).limit(1).for("update");
    if (!s) throw new UserError("الدفعة غير موجودة.");
    const rc = await loadRequestCtx(c.tx, c.auth, s.requestId, "staff");
    rid = rc.req.id;
    if (s.dueOn === d.dueOn) return { ok: true, message: "الموعد كما هو." };
    const kind = s.dueOn ? "due_changed" : "due_set";
    await c.tx.update(paymentSchedule).set({
      dueOn: d.dueOn, alerts: [], updatedBy: c.auth.user.id,
      history: [...(s.history ?? []), { at: new Date().toISOString(), by: c.auth.user.id, kind, from: s.dueOn, to: d.dueOn, note: d.reason }],
    }).where(eq(paymentSchedule.id, s.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `${kind === "due_set" ? "حُدد" : "عُدّل"} استحقاق الدفعة «${s.label}»: ${d.dueOn}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: `billing.schedule.${kind}`, entityType: "payment_schedule", entityId: s.id, waqfId: s.waqfId, ip: c.ip, userAgent: c.userAgent, before: { dueOn: s.dueOn }, after: { dueOn: d.dueOn, reason: d.reason } });
    return { ok: true, message: `${kind === "due_set" ? "حُدد" : "عُدّل"} موعد الاستحقاق.` };
  }, { revalidate: () => [`/admin/requests/${rid}`, `/app/requests/${rid}`, "/admin/finance"] });
}

const alertSchema = z.object({
  beforeDays: z.coerce.number().int().min(0, "من صفر إلى 90 يومًا.").max(90, "من صفر إلى 90 يومًا."),
  overdueDays: z.string().trim().regex(/^\d{1,3}(\s*[,،]\s*\d{1,3})*$/, "أيام التأخر أرقام مفصولة بفاصلة، مثل 1، 7، 30."),
});

/** Timing of the finance alerts (before the due date, and after it when unpaid). Finance only. */
export async function saveDueAlertSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(alertSchema, fd);
  if ("state" in r) return r.state;
  const value = dueAlertSettings({ beforeDays: r.data.beforeDays, overdueDays: r.data.overdueDays.split(/[,،]/).map((x) => Number(x.trim())) });
  return userAction(async (c) => {
    const [old] = await c.tx.select().from(settings).where(eq(settings.key, DUE_ALERTS_KEY)).limit(1);
    await c.tx.insert(settings).values({ key: DUE_ALERTS_KEY, value, description: "تنبيهات استحقاق الدفعات للمالية", updatedBy: c.auth.user.id })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: c.auth.user.id, updatedAt: new Date() } });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "settings.update", entityType: "setting", entityId: DUE_ALERTS_KEY, ip: c.ip, userAgent: c.userAgent, before: old?.value as Record<string, unknown> | undefined, after: value });
    return { ok: true, message: "حُفظ توقيت التنبيهات." };
  }, { perm: "admin.finance", revalidate: "/admin/finance" });
}
