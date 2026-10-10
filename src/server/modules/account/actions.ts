"use server";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  consents, dataSubjectRequests, mfaFactors, notificationPreferences, notifications, notificationTemplates, sessions, users,
} from "../../db/schema";
import { confirmTotpEnrollment, disableMfa, hashPassword, passwordProblems, startTotpEnrollment, verifyPassword, verifyUserTotp } from "../../auth/mfa";
import { revokeAllSessions } from "../../auth/session";
import { audit } from "../../lib/audit";
import { enforceRateLimit } from "../../lib/rate-limit";
import { parseForm, userAction, UserError } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { DSR_KINDS, PRIVACY_VERSION } from "./constants";

const isUniqueViolation = (e: unknown) => !!e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505";

// ───────────── Profile ─────────────
const profileSchema = z.object({
  fullName: z.string().trim().min(5, "اكتب الاسم الكامل كما في الهوية.").max(120),
  email: z.union([z.literal(""), z.email("صيغة البريد غير صحيحة.")]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  calendarPref: z.enum(["hijri", "gregorian", "both"], { error: "اختر التقويم." }),
  numeralStyle: z.enum(["latn", "arab"], { error: "اختر شكل الأرقام." }),
});

export async function updateProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(profileSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      const u = auth.user;
      if (!d.email && u.passwordHash && u.email) throw new UserError("بريدك مستخدم للدخول بكلمة المرور؛ لا يمكن حذفه. يمكنك تغييره إلى بريد آخر.");
      const before = { fullName: u.fullName, email: u.email, calendarPref: u.calendarPref, numeralStyle: u.numeralStyle };
      const after = { fullName: d.fullName, email: d.email, calendarPref: d.calendarPref, numeralStyle: d.numeralStyle };
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
      if (!changed.length) return { ok: true, message: "لا تغيير." };
      try {
        await tx
          .update(users)
          .set({ ...after, ...(d.email !== u.email ? { emailVerifiedAt: null } : {}), updatedBy: u.id })
          .where(eq(users.id, u.id));
      } catch (e) {
        if (isUniqueViolation(e)) return { error: "راجع الحقول المظللة.", fieldErrors: { email: "هذا البريد مرتبط بحساب آخر." } };
        throw e;
      }
      await audit(tx, {
        actorUserId: u.id, action: "account.profile_updated", entityType: "user", entityId: u.id, ip, userAgent,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
      return { ok: true, message: "حُفظ ملفك." };
    },
    { revalidate: ["/app/profile", "/app"] },
  );
}

// ───────────── Two-factor authentication (TOTP) ─────────────
export async function startTotp(): Promise<ActionState> {
  return userAction(async ({ auth, tx }) => {
    if (auth.user.mfaEnabled) throw new UserError("التحقق بخطوتين مفعّل مسبقًا.");
    // drop abandoned, never-confirmed enrollments
    await tx.delete(mfaFactors).where(and(eq(mfaFactors.userId, auth.user.id), isNull(mfaFactors.verifiedAt)));
    const label = auth.user.email ?? auth.user.phone;
    const { factorId, secret, qr } = await startTotpEnrollment(auth.user.id, label);
    return { ok: true, data: { factorId, secret, qr } };
  });
}

export async function confirmTotp(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ factorId: z.uuid(), code: z.string().trim().regex(/^\d{6}$/, "أدخل الرمز المكوّن من 6 أرقام.") }), fd);
  if ("state" in r) return { ...r.state, data: { factorId: fd.get("factorId"), secret: fd.get("secret"), qr: fd.get("qr") } };
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      await enforceRateLimit(`mfa-enroll:${auth.user.id}`, 10, 900);
      const codes = await confirmTotpEnrollment(auth.user.id, r.data.factorId, r.data.code);
      if (!codes) return { error: "الرمز غير صحيح. تأكد من ضبط الوقت في جوالك وأدخل الرمز الظاهر الآن.", data: { factorId: r.data.factorId, secret: fd.get("secret"), qr: fd.get("qr") } };
      await audit(tx, { actorUserId: auth.user.id, action: "auth.mfa_enabled", entityType: "user", entityId: auth.user.id, ip, userAgent, after: { method: "totp" } });
      return { ok: true, message: "فُعّل التحقق بخطوتين.", data: { codes } };
    },
    { revalidate: "/app/security" },
  );
}

export async function turnOffMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  const code = String(fd.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) return { fieldErrors: { code: "أدخل الرمز الحالي من تطبيق المصادقة (6 أرقام)." } };
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      if (auth.isStaff) throw new UserError("التحقق بخطوتين إلزامي لموظفي وقفك ولا يمكن إيقافه.");
      if (!auth.user.mfaEnabled) throw new UserError("التحقق بخطوتين غير مفعّل.");
      await enforceRateLimit(`mfa:${auth.user.id}`, 10, 900);
      if (!(await verifyUserTotp(auth.user.id, code))) return { fieldErrors: { code: "الرمز غير صحيح." } };
      await disableMfa(auth.user.id);
      await audit(tx, { actorUserId: auth.user.id, action: "auth.mfa_disabled", entityType: "user", entityId: auth.user.id, ip, userAgent });
      return { ok: true, message: "أُوقف التحقق بخطوتين. ننصح بإعادة تفعيله لحماية أوقافك." };
    },
    { revalidate: "/app/security" },
  );
}

// ───────────── Password ─────────────
export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const current = String(fd.get("current") ?? "");
  const pw = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      const u = auth.user;
      await enforceRateLimit(`pw-change:${u.id}`, 8, 900);
      if (u.passwordHash && !(await verifyPassword(u.passwordHash, current))) return { fieldErrors: { current: "كلمة المرور الحالية غير صحيحة." } };
      const problem = passwordProblems(pw);
      if (problem) return { fieldErrors: { password: problem } };
      if (pw !== confirm) return { fieldErrors: { confirm: "كلمتا المرور غير متطابقتين." } };
      const setEmail = !u.email;
      if (setEmail && !z.email().safeParse(email).success) return { fieldErrors: { email: "أدخل بريدًا صحيحًا؛ ستدخل به مع كلمة المرور." } };
      try {
        await tx
          .update(users)
          .set({ passwordHash: await hashPassword(pw), ...(setEmail ? { email } : {}), updatedBy: u.id })
          .where(eq(users.id, u.id));
      } catch (e) {
        if (isUniqueViolation(e)) return { fieldErrors: { email: "هذا البريد مرتبط بحساب آخر." } };
        throw e;
      }
      await audit(tx, { actorUserId: u.id, action: "auth.password_changed", entityType: "user", entityId: u.id, ip, userAgent, after: { first: !u.passwordHash } });
      await revokeAllSessions(u.id, "password_change", auth.session.id);
      return { ok: true, message: u.passwordHash ? "غُيّرت كلمة المرور، وأُنهيت جلساتك الأخرى." : "عُيّنت كلمة المرور، وأُنهيت جلساتك الأخرى." };
    },
    { revalidate: "/app/security" },
  );
}

// ───────────── Sessions ─────────────
export async function revokeSession(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ sessionId: z.uuid() }), fd);
  if ("state" in r) return r.state;
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      if (r.data.sessionId === auth.session.id) throw new UserError("هذه جلستك الحالية؛ استخدم «تسجيل الخروج» لإنهائها.");
      const [s] = await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokeReason: "user_revoked" })
        .where(and(eq(sessions.id, r.data.sessionId), eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      if (!s) throw new UserError("الجلسة منتهية مسبقًا.");
      await audit(tx, { actorUserId: auth.user.id, action: "auth.session_revoked", entityType: "session", entityId: s.id, ip, userAgent });
      return { ok: true, message: "أُنهيت الجلسة." };
    },
    { revalidate: "/app/security" },
  );
}

export async function revokeOtherSessions(): Promise<ActionState> {
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      const rows = await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokeReason: "user_revoked_others" })
        .where(and(eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt), ne(sessions.id, auth.session.id)))
        .returning({ id: sessions.id });
      await audit(tx, { actorUserId: auth.user.id, action: "auth.sessions_revoked_others", entityType: "user", entityId: auth.user.id, ip, userAgent, after: { count: rows.length } });
      return { ok: true, message: rows.length ? `أُنهيت ${rows.length} جلسة أخرى.` : "لا جلسات أخرى مفتوحة." };
    },
    { revalidate: "/app/security" },
  );
}

// ───────────── Privacy (PDPL) ─────────────
export async function setMarketingConsent(_: ActionState, fd: FormData): Promise<ActionState> {
  const granted = fd.get("granted") === "true";
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      const [c] = await tx.insert(consents).values({ userId: auth.user.id, kind: "marketing", version: PRIVACY_VERSION, granted, ip }).returning({ id: consents.id });
      await audit(tx, { actorUserId: auth.user.id, action: granted ? "privacy.consent_granted" : "privacy.consent_withdrawn", entityType: "consent", entityId: c.id, ip, userAgent, after: { kind: "marketing", granted } });
      return { ok: true, message: granted ? "سجّلنا موافقتك على الرسائل التسويقية." : "سحبنا موافقتك. لن تصلك رسائل تسويقية، وتستمر الإشعارات اللازمة لحسابك." };
    },
    { revalidate: "/app/privacy" },
  );
}

const dsrSchema = z.object({
  kind: z.enum(DSR_KINDS, { error: "اختر نوع الطلب." }),
  details: z.string().trim().max(2000).optional().transform((v) => v || null),
});

export async function createDataRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(dsrSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if ((d.kind === "correct" || d.kind === "object") && !d.details)
    return { error: "راجع الحقول المظللة.", fieldErrors: { details: d.kind === "correct" ? "اذكر البيان المطلوب تصحيحه وقيمته الصحيحة." : "اذكر المعالجة التي تعترض عليها وسببك." } };
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      const [open] = await tx
        .select({ id: dataSubjectRequests.id })
        .from(dataSubjectRequests)
        .where(and(eq(dataSubjectRequests.userId, auth.user.id), eq(dataSubjectRequests.kind, d.kind), inArray(dataSubjectRequests.status, ["received", "in_progress"])))
        .limit(1);
      if (open) throw new UserError("لديك طلب من النوع نفسه قيد المعالجة. سنرد عليه قبل موعده.");
      const [row] = await tx
        .insert(dataSubjectRequests)
        .values({ userId: auth.user.id, kind: d.kind, details: d.details, dueAt: new Date(Date.now() + 30 * 86_400_000) })
        .returning({ id: dataSubjectRequests.id });
      await audit(tx, { actorUserId: auth.user.id, action: "privacy.request_created", entityType: "data_subject_request", entityId: row.id, ip, userAgent, after: { kind: d.kind } });
      return { ok: true, message: "استلمنا طلبك. نرد عليه خلال 30 يومًا كحد أقصى، وتجد حالته أدناه." };
    },
    { revalidate: "/app/privacy" },
  );
}

export async function requestAccountDeletion(_: ActionState, fd: FormData): Promise<ActionState> {
  if (fd.get("confirm") !== "on") return { fieldErrors: { confirm: "أكّد أنك قرأت ما يُحتفظ به." } };
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      if (auth.user.deletionRequestedAt) throw new UserError("طلب الحذف مسجّل مسبقًا.");
      const now = new Date();
      await tx.update(users).set({ deletionRequestedAt: now, updatedBy: auth.user.id }).where(eq(users.id, auth.user.id));
      const [row] = await tx
        .insert(dataSubjectRequests)
        .values({
          userId: auth.user.id, kind: "delete", details: String(fd.get("reason") ?? "").slice(0, 1000) || null, dueAt: new Date(now.getTime() + 30 * 86_400_000),
          retainedDataNote: "تُحفظ سجلات الأوقاف والعمليات والفواتير المطلوبة نظامًا طوال مدة الحفظ المقررة.",
        })
        .returning({ id: dataSubjectRequests.id });
      await audit(tx, { actorUserId: auth.user.id, action: "privacy.deletion_requested", entityType: "user", entityId: auth.user.id, ip, userAgent, after: { requestId: row.id } });
      return { ok: true, message: "سجّلنا طلب حذف حسابك. يمكنك إلغاؤه قبل التنفيذ." };
    },
    { revalidate: "/app/privacy" },
  );
}

export async function cancelAccountDeletion(): Promise<ActionState> {
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      if (!auth.user.deletionRequestedAt) throw new UserError("لا يوجد طلب حذف قائم.");
      await tx.update(users).set({ deletionRequestedAt: null, updatedBy: auth.user.id }).where(eq(users.id, auth.user.id));
      await tx
        .update(dataSubjectRequests)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(and(eq(dataSubjectRequests.userId, auth.user.id), eq(dataSubjectRequests.kind, "delete"), inArray(dataSubjectRequests.status, ["received", "in_progress"])));
      await audit(tx, { actorUserId: auth.user.id, action: "privacy.deletion_cancelled", entityType: "user", entityId: auth.user.id, ip, userAgent });
      return { ok: true, message: "ألغينا طلب الحذف، وحسابك يعمل كالمعتاد." };
    },
    { revalidate: "/app/privacy" },
  );
}

// ───────────── Notifications ─────────────
export async function markNotificationRead(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ id: z.uuid() }), fd);
  if ("state" in r) return r.state;
  return userAction(
    async ({ auth, tx }) => {
      await tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, r.data.id), eq(notifications.userId, auth.user.id), isNull(notifications.readAt)));
      return { ok: true };
    },
    { revalidate: ["/app/notifications", "/app"] },
  );
}

export async function markAllNotificationsRead(): Promise<ActionState> {
  return userAction(
    async ({ auth, tx }) => {
      const rows = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, auth.user.id), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return { ok: true, message: rows.length ? "عُلّمت كل الإشعارات مقروءة." : "لا إشعارات غير مقروءة." };
    },
    { revalidate: ["/app/notifications", "/app"] },
  );
}

export async function saveNotificationPreferences(_: ActionState, fd: FormData): Promise<ActionState> {
  return userAction(
    async ({ auth, tx, ip, userAgent }) => {
      const templates = await tx.select().from(notificationTemplates);
      const existing = await tx.select().from(notificationPreferences).where(eq(notificationPreferences.userId, auth.user.id));
      const changes: Record<string, { inApp: boolean; email: boolean; sms: boolean }> = {};
      for (const t of templates) {
        if (t.locked) continue; // critical/security notices cannot be switched off
        const pref = {
          inApp: true, // the in-app record is always kept; only outside channels can be switched off
          email: t.channels.includes("email") ? fd.get(`${t.key}:email`) === "on" : false,
          sms: t.channels.includes("sms") ? fd.get(`${t.key}:sms`) === "on" : false,
        };
        const cur = existing.find((e) => e.type === t.key);
        const curv = cur ?? { inApp: true, email: t.channels.includes("email"), sms: t.channels.includes("sms") };
        if (curv.inApp === pref.inApp && curv.email === pref.email && curv.sms === pref.sms) continue;
        await tx
          .insert(notificationPreferences)
          .values({ userId: auth.user.id, type: t.key, ...pref })
          .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.type], set: pref });
        changes[t.key] = pref;
      }
      if (!Object.keys(changes).length) return { ok: true, message: "لا تغيير." };
      await audit(tx, { actorUserId: auth.user.id, action: "account.notification_prefs_updated", entityType: "user", entityId: auth.user.id, ip, userAgent, after: changes });
      return { ok: true, message: "حُفظت تفضيلات الإشعارات." };
    },
    { revalidate: "/app/notifications" },
  );
}
