import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { withSystem } from "../db";
import { otpChallenges } from "../db/schema";
import { sendSms } from "../adapters/messaging";
import { showOtpOnScreen } from "../env";
import { lookupHash, numericCode, safeEqual } from "../lib/crypto";
import { enforceRateLimit } from "../lib/rate-limit";

export type OtpPurpose = "signup" | "login" | "recover" | "change_phone" | "delete_account" | "sign_contract" | "step_up";

const PURPOSE_TEXT: Record<OtpPurpose, string> = {
  signup: "تأكيد التسجيل",
  login: "الدخول",
  recover: "استعادة الحساب",
  change_phone: "تغيير رقم الجوال",
  delete_account: "تأكيد حذف الحساب",
  sign_contract: "توقيع العقد",
  step_up: "تأكيد العملية",
};

/** Normalizes Saudi mobile numbers to +9665XXXXXXXX. Returns null when invalid. */
export function normalizeSaudiMobile(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "").replace(/^00/, "");
  let local = digits;
  if (local.startsWith("966")) local = local.slice(3);
  if (local.startsWith("0")) local = local.slice(1);
  if (!/^5\d{8}$/.test(local)) return null;
  return `+966${local}`;
}

export const maskPhone = (p: string) => `${p.slice(0, 6)}•••${p.slice(-3)}`;

export type IssuedOtp = { challengeId: string; demoCode?: string };

export async function issueOtp(target: string, purpose: OtpPurpose, ip: string, context?: Record<string, unknown>): Promise<IssuedOtp> {
  await enforceRateLimit(`otp:target:${target}`, 4, 600);
  await enforceRateLimit(`otp:ip:${ip}`, 20, 600);
  const code = numericCode(6);
  const rows = await withSystem((tx) =>
    tx
      .insert(otpChallenges)
      .values({
        target,
        purpose,
        codeHash: lookupHash(`${target}:${purpose}:${code}`),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        ip,
        context: context ?? null,
      })
      .returning({ id: otpChallenges.id }),
  );
  await sendSms(target, `رمز ${PURPOSE_TEXT[purpose]} في وقفك: ${code}\nصالح 5 دقائق. لا تشاركه مع أحد.`);
  return { challengeId: rows[0].id, demoCode: showOtpOnScreen ? code : undefined };
}

export type OtpResult = { ok: true; context: Record<string, unknown> | null } | { ok: false; reason: "invalid" | "expired" | "locked" };

export async function verifyOtp(challengeId: string, target: string, purpose: OtpPurpose, code: string): Promise<OtpResult> {
  return withSystem(async (tx) => {
    const [ch] = await tx
      .select()
      .from(otpChallenges)
      .where(and(eq(otpChallenges.id, challengeId), eq(otpChallenges.target, target), eq(otpChallenges.purpose, purpose), isNull(otpChallenges.consumedAt)))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1)
      .for("update");
    if (!ch) return { ok: false, reason: "invalid" } as const;
    if (ch.expiresAt < new Date()) return { ok: false, reason: "expired" } as const;
    if (ch.attempts >= ch.maxAttempts) return { ok: false, reason: "locked" } as const;
    const expected = lookupHash(`${target}:${purpose}:${code.trim()}`);
    if (!safeEqual(expected, ch.codeHash)) {
      await tx.update(otpChallenges).set({ attempts: ch.attempts + 1 }).where(eq(otpChallenges.id, ch.id));
      return { ok: false, reason: ch.attempts + 1 >= ch.maxAttempts ? "locked" : "invalid" } as const;
    }
    await tx.update(otpChallenges).set({ consumedAt: new Date() }).where(and(eq(otpChallenges.id, ch.id), gt(otpChallenges.expiresAt, new Date())));
    return { ok: true, context: (ch.context as Record<string, unknown>) ?? null } as const;
  });
}

export const otpErrorText = (reason: "invalid" | "expired" | "locked") =>
  reason === "expired"
    ? "انتهت صلاحية الرمز. اطلب رمزًا جديدًا."
    : reason === "locked"
      ? "تجاوزت عدد المحاولات لهذا الرمز. اطلب رمزًا جديدًا."
      : "الرمز غير صحيح.";
