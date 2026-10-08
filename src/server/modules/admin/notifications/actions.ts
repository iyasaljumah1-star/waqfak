"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { dataSubjectRequests, notificationTemplates, outboxMessages, sessions, users, waqfMemberships } from "@/server/db/schema";
import { sendEmail, sendSms } from "@/server/adapters/messaging";
import { audit } from "@/server/lib/audit";
import { parseForm, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { notifyIfTemplate, staffAction } from "../guard";
import { RETENTION_DEFAULTS, type RetentionPolicy } from "../settings/defs";
import { settings } from "@/server/db/schema";
import { isOtpMessage } from "./queries";

const vars = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

// ───────────── templates ─────────────
const tplSchema = z.object({
  key: z.string().min(1),
  titleAr: z.string().trim().min(3, "العنوان قصير جدًا.").max(160, "العنوان طويل؛ رسائل SMS تقتطع ما زاد."),
  bodyAr: z.string().trim().max(600),
  severity: z.enum(["critical", "important", "info"]),
  email: z.string().optional(),
  sms: z.string().optional(),
});

export async function saveTemplate(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(tplSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return staffAction("admin.notifications", async ({ auth, tx, ip, userAgent }) => {
    const [t] = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.key, d.key)).limit(1).for("update");
    if (!t) throw new UserError("القالب غير موجود.");
    // The code fills only the variables the template was designed with; unknown ones would print empty.
    const known = new Set([...vars(t.titleAr), ...vars(t.bodyAr)]);
    const unknown = [...vars(d.titleAr), ...vars(d.bodyAr)].filter((v) => !known.has(v));
    if (unknown.length) return { error: "راجع الحقول المظللة.", fieldErrors: { bodyAr: `متغيرات غير معروفة لهذا القالب: {${unknown.join("}، {")}}. المتاح: ${known.size ? [...known].map((k) => `{${k}}`).join("، ") : "لا شيء"}.` } };
    const channels = ["in_app", ...(d.email === "on" ? ["email"] : []), ...(d.sms === "on" ? ["sms"] : [])];
    if (t.locked) {
      const dropped = t.channels.filter((c) => !channels.includes(c));
      if (dropped.length) throw new UserError("هذا قالب أمني أو نظامي مقفل: لا يمكن إيقاف أي من قنواته.");
      if (t.severity === "critical" && d.severity !== "critical") throw new UserError("لا تُخفض أهمية قالب مقفل.");
    }
    const after = { titleAr: d.titleAr, bodyAr: d.bodyAr, severity: d.severity, channels };
    await tx.update(notificationTemplates).set({ ...after, updatedAt: new Date() }).where(eq(notificationTemplates.key, t.key));
    await audit(tx, {
      actorUserId: auth.user.id, action: "admin.notification_template.updated", entityType: "notification_template", entityId: t.key, ip, userAgent,
      before: { titleAr: t.titleAr, bodyAr: t.bodyAr, severity: t.severity, channels: t.channels }, after,
    });
    return { ok: true, message: "حُفظ القالب. يسري على الإشعارات الجديدة." };
  }, "/admin/notifications");
}

// ───────────── outbox ─────────────
export async function resendOutbox(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "معرّف غير صالح." };
  let msg: typeof outboxMessages.$inferSelect | undefined;
  const res = await staffAction("admin.notifications", async ({ auth, tx, ip, userAgent }) => {
    [msg] = await tx.select().from(outboxMessages).where(eq(outboxMessages.id, id)).limit(1).for("update");
    if (!msg) throw new UserError("الرسالة غير موجودة.");
    if (isOtpMessage(msg.body)) throw new UserError("رموز التحقق لا يعاد إرسالها؛ انتهت صلاحيتها. يطلب المستخدم رمزًا جديدًا من صفحة الدخول.");
    if (msg.channel !== "sms" && msg.channel !== "email") throw new UserError("إعادة الإرسال متاحة للرسائل النصية والبريد فقط.");
    await tx.update(outboxMessages).set({ attempts: msg.attempts + 1 }).where(eq(outboxMessages.id, id));
    await audit(tx, { actorUserId: auth.user.id, action: "admin.outbox.resend", entityType: "outbox_message", entityId: String(id), ip, userAgent, after: { channel: msg.channel, attempts: msg.attempts + 1 } });
  });
  if (res.error || !msg) return res;
  // The adapter writes a fresh outbox row with the provider result.
  if (msg.channel === "sms") await sendSms(msg.toAddress, msg.body);
  else await sendEmail(msg.toAddress, msg.subject ?? "وقفك", msg.body);
  return { ok: true, message: "أُعيد الإرسال؛ تظهر النتيجة في أعلى القائمة." };
}

// ───────────── data subject requests (PDPL) ─────────────
const dsrSchema = z.object({
  id: z.string().uuid(),
  op: z.enum(["start", "complete", "reject"]),
  note: z.string().trim().max(1000).optional(),
});

const NAZARA_ROLES = ["nazir", "board_chair", "board_member", "board_secretary", "executive", "delegated_manager"];

export async function processDsr(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(dsrSchema, fd);
  if ("state" in r) return r.state;
  const { id, op } = r.data;
  const note = r.data.note ?? "";
  if (op !== "start" && note.length < 10) return { error: "راجع الحقول المظللة.", fieldErrors: { note: op === "reject" ? "اذكر سبب الرفض وسنده النظامي." : "صِف ما نُفذ وما احتُفظ به ولماذا." } };
  return staffAction("admin.notifications", async ({ auth, tx, ip, userAgent }) => {
    const [d] = await tx.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.id, id)).limit(1).for("update");
    if (!d) throw new UserError("الطلب غير موجود.");
    if (!["received", "in_progress"].includes(d.status)) throw new UserError("أُغلق هذا الطلب مسبقًا.");
    const now = new Date();
    if (op === "start") {
      if (d.status === "in_progress") return { ok: true, message: "الطلب قيد المعالجة مسبقًا." };
      await tx.update(dataSubjectRequests).set({ status: "in_progress" }).where(eq(dataSubjectRequests.id, id));
      await audit(tx, { actorUserId: auth.user.id, action: "admin.dsr.started", entityType: "data_subject_request", entityId: id, ip, userAgent, before: { status: d.status }, after: { status: "in_progress" } });
      return { ok: true, message: "بدأت المعالجة." };
    }
    if (op === "reject") {
      await tx.update(dataSubjectRequests).set({ status: "rejected", retainedDataNote: note, completedAt: now }).where(eq(dataSubjectRequests.id, id));
      if (d.kind === "delete") await tx.update(users).set({ deletionRequestedAt: null, updatedBy: auth.user.id }).where(eq(users.id, d.userId));
      await audit(tx, { actorUserId: auth.user.id, action: "admin.dsr.rejected", entityType: "data_subject_request", entityId: id, ip, userAgent, before: { status: d.status }, after: { status: "rejected", note } });
      await notifyIfTemplate(tx, d.userId, "privacy.request_closed", { status: "مرفوض", note }, { link: "/app/privacy" });
      return { ok: true, message: "رُفض الطلب وأُبلغ صاحبه." };
    }
    // complete
    let extra = {};
    if (d.kind === "delete") {
      const [rp] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, "retention.policy")).limit(1);
      const grace = ({ ...RETENTION_DEFAULTS, ...((rp?.v ?? {}) as Partial<RetentionPolicy>) }).deletedAccountGraceDays;
      const readyAt = new Date(d.requestedAt.getTime() + grace * 86_400_000);
      if (readyAt > now) throw new UserError(`لم تنقضِ مهلة التراجع (${grace} يومًا). يمكن التنفيذ بعد ${readyAt.toLocaleDateString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" })}.`);
      const [u] = await tx.select().from(users).where(eq(users.id, d.userId)).limit(1);
      if (!u) throw new UserError("الحساب غير موجود.");
      if (u.isStaff) throw new UserError("حساب موظف: أنهِ أدواره وسلّم أعماله أولًا ثم نفّذ الحذف.");
      const held = await tx
        .select({ roleKey: waqfMemberships.roleKey })
        .from(waqfMemberships)
        .where(and(eq(waqfMemberships.userId, d.userId), eq(waqfMemberships.status, "active"), inArray(waqfMemberships.roleKey, NAZARA_ROLES)));
      if (held.length) throw new UserError("يحمل صاحب الطلب دور نظارة أو إدارة في وقف قائم. تُنقل النظارة أو تُنهى العضوية من ملف الوقف أولًا، ثم يُنفذ الحذف.");
      // Anonymize the person; waqf records that reference the account are regulated records and are retained.
      const ended = await tx.update(waqfMemberships).set({ status: "ended", endsAt: now, updatedBy: auth.user.id }).where(and(eq(waqfMemberships.userId, d.userId), eq(waqfMemberships.status, "active"))).returning({ id: waqfMemberships.id });
      await tx
        .update(users)
        .set({
          status: "deleted", fullName: "حساب محذوف", email: null, phone: `deleted:${u.id}`, passwordHash: null, nationalIdEnc: null, nationalIdHash: null,
          birthDate: null, mfaEnabled: false, updatedBy: auth.user.id,
        })
        .where(eq(users.id, d.userId));
      await tx.update(sessions).set({ revokedAt: now, revokeReason: "account_deleted" }).where(eq(sessions.userId, d.userId));
      extra = { anonymized: true, membershipsEnded: ended.length };
    }
    await tx.update(dataSubjectRequests).set({ status: "completed", retainedDataNote: note, completedAt: now }).where(eq(dataSubjectRequests.id, id));
    await audit(tx, { actorUserId: auth.user.id, action: "admin.dsr.completed", entityType: "data_subject_request", entityId: id, ip, userAgent, before: { status: d.status }, after: { status: "completed", kind: d.kind, note, ...extra } });
    if (d.kind !== "delete") await notifyIfTemplate(tx, d.userId, "privacy.request_closed", { status: "مكتمل", note }, { link: "/app/privacy" });
    return { ok: true, message: d.kind === "delete" ? "نُفذ الحذف: أُخفيت هوية الحساب وأُنهيت جلساته، واحتُفظ بسجلات الأوقاف النظامية." : "أُغلق الطلب مكتملًا وأُبلغ صاحبه." };
  }, "/admin/notifications/privacy");
}
