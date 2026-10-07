"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSystem } from "../db";
import { consents, users } from "../db/schema";
import { clearFlow, getFlow, setFlow } from "../auth/flow-cookie";
import { issueOtp, normalizeSaudiMobile, otpErrorText, verifyOtp } from "../auth/otp";
import { createSession, destroyCurrentSession, markSessionMfa, revokeAllSessions } from "../auth/session";
import { hashPassword, passwordProblems, useRecoveryCode, verifyPassword, verifyUserTotp } from "../auth/mfa";
import { getAuth } from "../authz/context";
import { audit } from "../lib/audit";
import { RateLimitError, enforceRateLimit } from "../lib/rate-limit";
import { requestInfo } from "../lib/request-info";
import { notify } from "./notify";
import type { ActionState } from "@/lib/utils";

const TERMS_VERSION = "2026-10";

const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : undefined);

function wrap(fn: () => Promise<ActionState>): Promise<ActionState> {
  return fn().catch((e) => {
    if (e instanceof RateLimitError) return { error: e.message };
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error(e);
    return { error: "تعذر إكمال العملية. أعد المحاولة بعد قليل." };
  });
}

// ───────────── Sign up ─────────────
const signupSchema = z.object({
  fullName: z.string().trim().min(5, "اكتب الاسم الكامل كما في الهوية.").max(120),
  phone: z.string().trim().min(9, "أدخل رقم الجوال."),
  email: z.union([z.literal(""), z.email("صيغة البريد غير صحيحة.")]).optional(),
  terms: z.literal("on", { error: "يلزم الموافقة على الشروط وسياسة الخصوصية." }),
});

export async function signupStart(_: ActionState, fd: FormData): Promise<ActionState> {
  return wrap(async () => {
    const parsed = signupSchema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return { fieldErrors: fe, error: "راجع الحقول المطلوبة." };
    }
    const phone = normalizeSaudiMobile(parsed.data.phone);
    if (!phone) return { fieldErrors: { phone: "أدخل رقم جوال سعودي صحيح يبدأ بـ 05." } };
    const exists = await withSystem((tx) => tx.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1));
    if (exists.length) return { error: "هذا الرقم مسجّل مسبقًا. سجّل الدخول بدلًا من ذلك.", data: { login: true } };
    const { ip } = await requestInfo();
    const otp = await issueOtp(phone, "signup", ip, { fullName: parsed.data.fullName, email: parsed.data.email || null, marketing: fd.get("marketing") === "on" });
    await setFlow({ challengeId: otp.challengeId, target: phone, purpose: "signup", demoCode: otp.demoCode, next: safeNext(fd.get("next")) });
    redirect("/verify");
  });
}

// ───────────── Login by phone OTP ─────────────
export async function loginStart(_: ActionState, fd: FormData): Promise<ActionState> {
  return wrap(async () => {
    const phone = normalizeSaudiMobile(String(fd.get("phone") ?? ""));
    if (!phone) return { fieldErrors: { phone: "أدخل رقم جوال سعودي صحيح يبدأ بـ 05." } };
    const { ip } = await requestInfo();
    await enforceRateLimit(`login:ip:${ip}`, 30, 900);
    const [u] = await withSystem((tx) => tx.select().from(users).where(eq(users.phone, phone)).limit(1));
    if (!u || u.status === "deleted") {
      // Neutral response: do not reveal whether the number is registered.
      await setFlow({ challengeId: "00000000-0000-0000-0000-000000000000", target: phone, purpose: "login", next: safeNext(fd.get("next")) });
      redirect("/verify");
    }
    if (u.status === "locked" || (u.lockedUntil && u.lockedUntil > new Date())) return { error: "الحساب مقفل مؤقتًا لأسباب أمنية. استخدم «استعادة الحساب» أو تواصل مع الدعم." };
    const otp = await issueOtp(phone, "login", ip);
    await setFlow({ challengeId: otp.challengeId, target: phone, purpose: "login", demoCode: otp.demoCode, next: safeNext(fd.get("next")) });
    redirect("/verify");
  });
}

// ───────────── Login by email + password (then a second factor) ─────────────
export async function loginPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  return wrap(async () => {
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const password = String(fd.get("password") ?? "");
    const { ip, userAgent } = await requestInfo();
    await enforceRateLimit(`pw:ip:${ip}`, 20, 900);
    await enforceRateLimit(`pw:email:${email}`, 8, 900);
    const [u] = await withSystem((tx) => tx.select().from(users).where(eq(users.email, email)).limit(1));
    const generic = { error: "البريد أو كلمة المرور غير صحيحة." };
    if (!u || !u.passwordHash) return generic;
    if (u.lockedUntil && u.lockedUntil > new Date()) return { error: "الحساب مقفل مؤقتًا بعد محاولات متكررة. حاول بعد 30 دقيقة أو استخدم استعادة الحساب." };
    if (!(await verifyPassword(u.passwordHash, password))) {
      const failed = u.failedLoginCount + 1;
      await withSystem((tx) =>
        tx.update(users).set({ failedLoginCount: failed, lockedUntil: failed >= 10 ? new Date(Date.now() + 30 * 60_000) : null }).where(eq(users.id, u.id)),
      );
      return generic;
    }
    if (u.mfaEnabled) {
      await createSession(u.id, { isStaff: u.isStaff, mfaVerified: false, ip, userAgent });
      redirect(`/login/mfa${safeNext(fd.get("next")) ? `?next=${encodeURIComponent(String(fd.get("next")))}` : ""}`);
    }
    // No authenticator: the phone is the second factor.
    const otp = await issueOtp(u.phone, "step_up", ip);
    await setFlow({ challengeId: otp.challengeId, target: u.phone, purpose: "step_up", userId: u.id, demoCode: otp.demoCode, next: safeNext(fd.get("next")) });
    redirect("/verify");
  });
}

// ───────────── Verify OTP (all flows) ─────────────
export async function verifyCode(_: ActionState, fd: FormData): Promise<ActionState> {
  return wrap(async () => {
    const flow = await getFlow();
    if (!flow) return { error: "انتهت صلاحية الجلسة. ابدأ من جديد." };
    const code = String(fd.get("code") ?? "").replace(/\D/g, "");
    if (code.length !== 6) return { fieldErrors: { code: "الرمز من 6 أرقام." } };
    const res = await verifyOtp(flow.challengeId, flow.target, flow.purpose, code);
    if (!res.ok) return { error: otpErrorText(res.reason) };
    const { ip, userAgent } = await requestInfo();

    if (flow.purpose === "signup") {
      const ctx = res.context ?? {};
      const user = await withSystem(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ phone: flow.target, fullName: String(ctx.fullName ?? ""), email: (ctx.email as string) || null, phoneVerifiedAt: new Date(), status: "active" })
          .returning();
        await tx.insert(consents).values([
          { userId: u.id, kind: "terms", version: TERMS_VERSION, granted: true, ip },
          { userId: u.id, kind: "privacy", version: TERMS_VERSION, granted: true, ip },
          { userId: u.id, kind: "marketing", version: TERMS_VERSION, granted: ctx.marketing === true, ip },
        ]);
        await audit(tx, { actorUserId: u.id, action: "user.signup", entityType: "user", entityId: u.id, ip, userAgent });
        return u;
      });
      await clearFlow();
      await createSession(user.id, { isStaff: false, mfaVerified: true, ip, userAgent });
      redirect(flow.next ?? "/app?welcome=1");
    }

    const [u] = await withSystem((tx) => tx.select().from(users).where(eq(users.phone, flow.target)).limit(1));
    if (!u) return { error: "تعذر العثور على الحساب." };

    if (flow.purpose === "recover") {
      await revokeAllSessions(u.id, "recovery");
      await withSystem(async (tx) => {
        await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, u.id));
        await audit(tx, { actorUserId: u.id, action: "user.recover", entityType: "user", entityId: u.id, ip, userAgent });
      });
      await clearFlow();
      await createSession(u.id, { isStaff: u.isStaff, mfaVerified: false, ip, userAgent });
      redirect(u.mfaEnabled ? "/login/mfa?next=/app/security?recovered=1" : "/app/security?recovered=1");
    }

    // login or password step-up
    await clearFlow();
    await createSession(u.id, { isStaff: u.isStaff, mfaVerified: false, ip, userAgent });
    await withSystem((tx) => audit(tx, { actorUserId: u.id, action: "user.login", entityType: "user", entityId: u.id, ip, userAgent, after: { method: flow.purpose } }));
    await notify(u.id, "security.new_login", { device: userAgent.slice(0, 60), time: new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }) });
    if (u.mfaEnabled) redirect(`/login/mfa${flow.next ? `?next=${encodeURIComponent(flow.next)}` : ""}`);
    redirect(flow.next ?? (u.isStaff ? "/admin" : "/app"));
  });
}

export async function resendCode(): Promise<ActionState> {
  return wrap(async () => {
    const flow = await getFlow();
    if (!flow) return { error: "انتهت صلاحية الجلسة. ابدأ من جديد." };
    const { ip } = await requestInfo();
    if (flow.challengeId === "00000000-0000-0000-0000-000000000000") return { ok: true, message: "إن كان الرقم مسجلًا فستصلك رسالة جديدة." };
    const otp = await issueOtp(flow.target, flow.purpose, ip);
    await setFlow({ ...flow, challengeId: otp.challengeId, demoCode: otp.demoCode });
    return { ok: true, message: "أرسلنا رمزًا جديدًا." };
  });
}

// ───────────── MFA (authenticator app or recovery code) ─────────────
export async function verifyMfa(_: ActionState, fd: FormData): Promise<ActionState> {
  return wrap(async () => {
    const auth = await getAuth();
    if (!auth) redirect("/login");
    const { ip, userAgent } = await requestInfo();
    await enforceRateLimit(`mfa:${auth.user.id}`, 10, 900);
    const code = String(fd.get("code") ?? "").trim();
    const ok = /^\d{6}$/.test(code) ? await verifyUserTotp(auth.user.id, code) : await useRecoveryCode(auth.user.id, code);
    if (!ok) return { error: "الرمز غير صحيح." };
    await markSessionMfa(auth.session.id);
    await withSystem((tx) => audit(tx, { actorUserId: auth.user.id, action: "user.mfa_verified", entityType: "user", entityId: auth.user.id, ip, userAgent }));
    redirect(safeNext(fd.get("next")) ?? (auth.isStaff ? "/admin" : "/app"));
  });
}

// ───────────── Recovery ─────────────
export async function recoverStart(_: ActionState, fd: FormData): Promise<ActionState> {
  return wrap(async () => {
    const phone = normalizeSaudiMobile(String(fd.get("phone") ?? ""));
    if (!phone) return { fieldErrors: { phone: "أدخل رقم جوال سعودي صحيح يبدأ بـ 05." } };
    const { ip } = await requestInfo();
    const [u] = await withSystem((tx) => tx.select({ id: users.id }).from(users).where(and(eq(users.phone, phone), isNull(users.deletionRequestedAt))).limit(1));
    if (!u) {
      await setFlow({ challengeId: "00000000-0000-0000-0000-000000000000", target: phone, purpose: "recover" });
      redirect("/verify");
    }
    const otp = await issueOtp(phone, "recover", ip);
    await setFlow({ challengeId: otp.challengeId, target: phone, purpose: "recover", demoCode: otp.demoCode });
    redirect("/verify");
  });
}

// ───────────── Password management (from security settings) ─────────────
export async function setPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  return wrap(async () => {
    const auth = await getAuth();
    if (!auth) redirect("/login");
    const pw = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    const problem = passwordProblems(pw);
    if (problem) return { fieldErrors: { password: problem } };
    if (pw !== confirm) return { fieldErrors: { confirm: "كلمتا المرور غير متطابقتين." } };
    if (!auth.user.email && !z.email().safeParse(email).success) return { fieldErrors: { email: "أدخل بريدًا صحيحًا لاستخدامه في الدخول." } };
    const { ip, userAgent } = await requestInfo();
    await withSystem(async (tx) => {
      await tx.update(users).set({ passwordHash: await hashPassword(pw), ...(auth.user.email ? {} : { email }) }).where(eq(users.id, auth.user.id));
      await audit(tx, { actorUserId: auth.user.id, action: "user.password_set", entityType: "user", entityId: auth.user.id, ip, userAgent });
    });
    await revokeAllSessions(auth.user.id, "password_change", auth.session.id);
    return { ok: true, message: "حُفظت كلمة المرور، وأُنهيت الجلسات الأخرى." };
  });
}

export async function logout() {
  const auth = await getAuth();
  if (auth) {
    const { ip, userAgent } = await requestInfo();
    await withSystem((tx) => audit(tx, { actorUserId: auth.user.id, action: "user.logout", entityType: "user", entityId: auth.user.id, ip, userAgent }));
  }
  await destroyCurrentSession();
  redirect("/");
}
