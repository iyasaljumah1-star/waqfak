"use server";

import { and, eq, isNull, ne, notInArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Tx } from "@/server/db";
import { mfaFactors, recoveryCodes, roles, sessions, userRoles, users } from "@/server/db/schema";
import { rolePermissionMap, type Auth } from "@/server/authz/context";
import { normalizeSaudiMobile } from "@/server/auth/otp";
import { sendSms } from "@/server/adapters/messaging";
import { audit } from "@/server/lib/audit";
import { parseForm, UserError } from "@/server/modules/_shared";
import { env } from "@/server/env";
import type { ActionState } from "@/lib/utils";
import { isSuperAdmin, notifyIfTemplate, staffAction } from "../guard";

const uuid = z.string().uuid("معرّف غير صالح.");
const reason = z.string().trim().min(10, "اكتب سببًا واضحًا لا يقل عن 10 أحرف.").max(500, "السبب طويل جدًا.");

async function loadTarget(tx: Tx, id: string) {
  const [u] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw new UserError("لم نجد هذا المستخدم.");
  return u;
}

async function roleKeysOf(tx: Tx, userId: string) {
  const rows = await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.key);
}

/** Number of active super admins other than `exceptUserId`. */
async function otherActiveSuperAdmins(tx: Tx, exceptUserId: string) {
  const rows = await tx
    .select({ id: users.id })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, "super_admin"), ne(users.id, exceptUserId), notInArray(users.status, ["locked", "deleted"])));
  return rows.length;
}

/**
 * Privilege-escalation guard: only a super admin may grant or remove `super_admin`; anyone else may grant a role only
 * if they already hold every permission it carries.
 */
async function assertCanManageRole(auth: Auth, roleKey: string) {
  if (isSuperAdmin(auth)) return;
  if (roleKey === "super_admin") throw new UserError("منح دور «مسؤول النظام الأعلى» أو سحبه مقصور على مسؤول نظام أعلى.");
  const map = await rolePermissionMap();
  const missing = [...(map.get(roleKey) ?? [])].filter((p) => !auth.perms.has(p));
  if (missing.length) throw new UserError(`لا يمكنك منح دور يتضمن صلاحيات لا تملكها (${missing.slice(0, 3).join("، ")}${missing.length > 3 ? "…" : ""}).`);
}

async function revokeSessions(tx: Tx, userId: string, why: string) {
  const rows = await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokeReason: why })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

// ───────────── roles ─────────────
const roleSchema = z.object({ userId: uuid, roleKey: z.string().min(1, "اختر الدور.") });

export async function grantRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(roleSchema, fd);
  if ("state" in r) return r.state;
  const { userId, roleKey } = r.data;
  return staffAction("admin.roles", async ({ auth, tx, ip, userAgent }) => {
    const target = await loadTarget(tx, userId);
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
    if (!role || role.scope !== "global") throw new UserError("هذا ليس دورًا لفريق وقفك. أدوار الأوقاف تُمنح من ملف الوقف.");
    await assertCanManageRole(auth, roleKey);
    if (target.status === "deleted") throw new UserError("الحساب محذوف؛ لا يمكن منحه أدوارًا.");
    const before = await roleKeysOf(tx, userId);
    if (before.includes(roleKey)) throw new UserError("المستخدم يحمل هذا الدور مسبقًا.");
    await tx.insert(userRoles).values({ userId, roleId: role.id, grantedBy: auth.user.id });
    // A global role makes the account a staff account; staff must enroll MFA before reaching the admin panel.
    if (!target.isStaff) await tx.update(users).set({ isStaff: true, updatedBy: auth.user.id }).where(eq(users.id, userId));
    await audit(tx, {
      actorUserId: auth.user.id, action: "admin.user.role_granted", entityType: "user", entityId: userId, ip, userAgent,
      before: { roles: before }, after: { roles: [...before, roleKey], granted: roleKey, madeStaff: !target.isStaff },
    });
    return { ok: true, message: `مُنح دور «${role.nameAr}».` };
  }, `/admin/users/${userId}`);
}

export async function revokeRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(roleSchema, fd);
  if ("state" in r) return r.state;
  const { userId, roleKey } = r.data;
  return staffAction("admin.roles", async ({ auth, tx, ip, userAgent }) => {
    await loadTarget(tx, userId);
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey)).limit(1);
    if (!role) throw new UserError("الدور غير موجود.");
    await assertCanManageRole(auth, roleKey);
    if (roleKey === "super_admin") {
      if (userId === auth.user.id) throw new UserError("لا يمكنك سحب دور «مسؤول النظام الأعلى» من نفسك. اطلب ذلك من مسؤول أعلى آخر.");
      // serialize concurrent revocations so two admins cannot remove the last two super admins at once
      await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, "super_admin")).for("update");
      if ((await otherActiveSuperAdmins(tx, userId)) < 1) throw new UserError("يجب أن يبقى مسؤول نظام أعلى واحد نشط على الأقل.");
    }
    const before = await roleKeysOf(tx, userId);
    if (!before.includes(roleKey)) throw new UserError("المستخدم لا يحمل هذا الدور.");
    await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)));
    await audit(tx, {
      actorUserId: auth.user.id, action: "admin.user.role_revoked", entityType: "user", entityId: userId, ip, userAgent,
      before: { roles: before }, after: { roles: before.filter((k) => k !== roleKey), revoked: roleKey },
    });
    return { ok: true, message: `سُحب دور «${role.nameAr}».` };
  }, `/admin/users/${userId}`);
}

// ───────────── account status & sessions ─────────────
const reasonSchema = z.object({ userId: uuid, reason });

export async function lockUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reasonSchema, fd);
  if ("state" in r) return r.state;
  const { userId, reason: why } = r.data;
  return staffAction("admin.users", async ({ auth, tx, ip, userAgent }) => {
    if (userId === auth.user.id) throw new UserError("لا يمكنك قفل حسابك.");
    const u = await loadTarget(tx, userId);
    if (u.status === "locked") throw new UserError("الحساب مقفل مسبقًا.");
    if (u.status === "deleted") throw new UserError("الحساب محذوف.");
    const keys = await roleKeysOf(tx, userId);
    if (keys.includes("super_admin")) {
      if (!isSuperAdmin(auth)) throw new UserError("قفل حساب مسؤول نظام أعلى مقصور على مسؤول نظام أعلى.");
      if ((await otherActiveSuperAdmins(tx, userId)) < 1) throw new UserError("هذا آخر مسؤول نظام أعلى نشط؛ لا يمكن قفله.");
    }
    await tx.update(users).set({ status: "locked", updatedBy: auth.user.id }).where(eq(users.id, userId));
    const n = await revokeSessions(tx, userId, "admin_lock");
    await audit(tx, { actorUserId: auth.user.id, action: "admin.user.locked", entityType: "user", entityId: userId, ip, userAgent, before: { status: u.status }, after: { status: "locked", reason: why, sessionsRevoked: n } });
    return { ok: true, message: `قُفل الحساب وأُنهيت ${n} من جلساته.` };
  }, `/admin/users/${userId}`);
}

export async function unlockUser(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reasonSchema, fd);
  if ("state" in r) return r.state;
  const { userId, reason: why } = r.data;
  return staffAction("admin.users", async ({ auth, tx, ip, userAgent }) => {
    const u = await loadTarget(tx, userId);
    if (u.status !== "locked" && !(u.lockedUntil && u.lockedUntil > new Date())) throw new UserError("الحساب غير مقفل.");
    await tx.update(users).set({ status: "active", lockedUntil: null, failedLoginCount: 0, updatedBy: auth.user.id }).where(eq(users.id, userId));
    await audit(tx, { actorUserId: auth.user.id, action: "admin.user.unlocked", entityType: "user", entityId: userId, ip, userAgent, before: { status: u.status, lockedUntil: u.lockedUntil }, after: { status: "active", reason: why } });
    return { ok: true, message: "فُتح الحساب. يستطيع صاحبه الدخول الآن." };
  }, `/admin/users/${userId}`);
}

export async function forceSignOut(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reasonSchema, fd);
  if ("state" in r) return r.state;
  const { userId, reason: why } = r.data;
  return staffAction("admin.users", async ({ auth, tx, ip, userAgent }) => {
    if (userId === auth.user.id) throw new UserError("لإنهاء جلساتك استخدم صفحة «الأمان والجلسات» في حسابك.");
    await loadTarget(tx, userId);
    const n = await revokeSessions(tx, userId, "admin_force_signout");
    await audit(tx, { actorUserId: auth.user.id, action: "admin.user.signed_out", entityType: "user", entityId: userId, ip, userAgent, after: { sessionsRevoked: n, reason: why } });
    return { ok: true, message: n ? `أُنهيت ${n} جلسة. سيُطلب منه الدخول من جديد.` : "لا توجد جلسات نشطة لهذا المستخدم." };
  }, `/admin/users/${userId}`);
}

export async function resetMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reasonSchema, fd);
  if ("state" in r) return r.state;
  const { userId, reason: why } = r.data;
  return staffAction("admin.users", async ({ auth, tx, ip, userAgent }) => {
    if (userId === auth.user.id) throw new UserError("لا يمكنك إعادة ضبط التحقق بخطوتين لحسابك من هنا. استخدم رموز الاسترداد أو اطلب ذلك من مسؤول آخر.");
    const u = await loadTarget(tx, userId);
    const keys = await roleKeysOf(tx, userId);
    if (keys.includes("super_admin") && !isSuperAdmin(auth)) throw new UserError("إعادة ضبط التحقق لمسؤول نظام أعلى مقصورة على مسؤول نظام أعلى.");
    const factors = await tx.delete(mfaFactors).where(eq(mfaFactors.userId, userId)).returning({ id: mfaFactors.id });
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.update(users).set({ mfaEnabled: false, updatedBy: auth.user.id }).where(eq(users.id, userId));
    const n = await revokeSessions(tx, userId, "admin_mfa_reset");
    await audit(tx, {
      actorUserId: auth.user.id, action: "admin.user.mfa_reset", entityType: "user", entityId: userId, ip, userAgent,
      before: { mfaEnabled: u.mfaEnabled, factors: factors.length }, after: { mfaEnabled: false, reason: why, sessionsRevoked: n },
    });
    await notifyIfTemplate(tx, userId, "security.mfa_reset", { time: new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }) });
    return { ok: true, message: u.isStaff ? "أُعيد ضبط التحقق بخطوتين. سيُطلب منه تسجيله من جديد عند الدخول التالي." : "أُعيد ضبط التحقق بخطوتين وأُنهيت جلساته." };
  }, `/admin/users/${userId}`);
}

// ───────────── invite staff ─────────────
const inviteSchema = z.object({
  fullName: z.string().trim().min(3, "اكتب الاسم الكامل.").max(120),
  phone: z.string().trim().min(1, "أدخل رقم الجوال."),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("البريد الإلكتروني غير صحيح.")]),
  roleKey: z.string().min(1, "اختر الدور."),
});

export async function inviteStaff(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(inviteSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const phone = normalizeSaudiMobile(d.phone);
  if (!phone) return { error: "راجع الحقول المظللة.", fieldErrors: { phone: "أدخل رقم جوال سعودي صحيح يبدأ بـ 05." } };
  let newId = "";
  const res = await staffAction("admin.users", async ({ auth, tx, ip, userAgent }) => {
    if (!auth.perms.has("admin.roles")) throw new UserError("دعوة موظف تتطلب صلاحية إدارة الأدوار أيضًا، لأن الدعوة تمنح دورًا.");
    const [role] = await tx.select().from(roles).where(eq(roles.key, d.roleKey)).limit(1);
    if (!role || role.scope !== "global") throw new UserError("اختر دورًا من أدوار فريق وقفك.");
    await assertCanManageRole(auth, d.roleKey);
    const [byPhone] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    if (byPhone) return { error: "هذا الرقم مسجل لحساب قائم. افتح صفحة المستخدم وامنحه الدور من هناك.", data: { existingId: byPhone.id } };
    if (d.email) {
      const [byEmail] = await tx.select({ id: users.id }).from(users).where(eq(users.email, d.email)).limit(1);
      if (byEmail) return { error: "راجع الحقول المظللة.", fieldErrors: { email: "البريد مستخدم في حساب آخر." } };
    }
    const [u] = await tx
      .insert(users)
      .values({ phone, fullName: d.fullName, email: d.email || null, isStaff: true, status: "active", createdBy: auth.user.id, updatedBy: auth.user.id })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ userId: u.id, roleId: role.id, grantedBy: auth.user.id });
    await audit(tx, {
      actorUserId: auth.user.id, action: "admin.user.staff_invited", entityType: "user", entityId: u.id, ip, userAgent,
      after: { fullName: d.fullName, email: d.email || null, role: d.roleKey },
    });
    newId = u.id;
  });
  if (res.error) return res;
  // One-time setup: the invitee signs in with an OTP to this phone, then the admin panel forces MFA enrollment.
  await sendSms(phone, `وقفك: دُعيت للانضمام إلى فريق المنصة. ادخل برقم جوالك من ${env.APP_URL}/login ثم فعّل التحقق بخطوتين لإكمال التهيئة.`);
  redirect(`/admin/users/${newId}?invited=1`);
}
