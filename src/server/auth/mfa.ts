import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import QRCode from "qrcode";
import { withSystem } from "../db";
import { mfaFactors, recoveryCodes, users } from "../db/schema";
import { decryptString, encryptString, lookupHash, randomToken } from "../lib/crypto";

export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

export function passwordProblems(pw: string): string | null {
  if (pw.length < 12) return "كلمة المرور يجب ألا تقل عن 12 حرفًا.";
  const common = ["123456789012", "password1234", "qwertyuiop12", "waqfak123456"];
  if (common.includes(pw.toLowerCase())) return "كلمة المرور شائعة جدًا؛ اختر غيرها.";
  if (/^(.)\1+$/.test(pw)) return "كلمة المرور ضعيفة.";
  return null;
}

export async function startTotpEnrollment(userId: string, label: string) {
  const secret = generateSecret();
  const [factor] = await withSystem((tx) =>
    tx.insert(mfaFactors).values({ userId, type: "totp", secretEnc: encryptString(secret), label: "تطبيق المصادقة" }).returning({ id: mfaFactors.id }),
  );
  const uri = generateURI({ issuer: "Waqfak وقفك", label, secret });
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return { factorId: factor.id, secret, qr };
}

export async function confirmTotpEnrollment(userId: string, factorId: string, token: string): Promise<string[] | null> {
  return withSystem(async (tx) => {
    const [f] = await tx.select().from(mfaFactors).where(and(eq(mfaFactors.id, factorId), eq(mfaFactors.userId, userId))).limit(1);
    if (!f) return null;
    const res = await verifyTotp({ secret: decryptString(f.secretEnc), token: token.trim() });
    if (!res.valid) return null;
    await tx.update(mfaFactors).set({ verifiedAt: new Date() }).where(eq(mfaFactors.id, f.id));
    await tx.update(users).set({ mfaEnabled: true }).where(eq(users.id, userId));
    // fresh recovery codes
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    const codes = Array.from({ length: 8 }, () => randomToken(6).replace(/[-_]/g, "x").slice(0, 10).toUpperCase());
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: lookupHash(`rc:${c}`) })));
    return codes;
  });
}

export async function verifyUserTotp(userId: string, token: string): Promise<boolean> {
  return withSystem(async (tx) => {
    const factors = await tx.select().from(mfaFactors).where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.verifiedAt)));
    for (const f of factors) {
      const res = await verifyTotp({ secret: decryptString(f.secretEnc), token: token.trim() });
      if (res.valid) {
        await tx.update(mfaFactors).set({ lastUsedAt: new Date() }).where(eq(mfaFactors.id, f.id));
        return true;
      }
    }
    return false;
  });
}

export async function useRecoveryCode(userId: string, code: string): Promise<boolean> {
  return withSystem(async (tx) => {
    const [rc] = await tx
      .select()
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, lookupHash(`rc:${code.trim().toUpperCase()}`)), isNull(recoveryCodes.usedAt)))
      .limit(1);
    if (!rc) return false;
    await tx.update(recoveryCodes).set({ usedAt: new Date() }).where(eq(recoveryCodes.id, rc.id));
    return true;
  });
}

export async function disableMfa(userId: string) {
  await withSystem(async (tx) => {
    await tx.delete(mfaFactors).where(eq(mfaFactors.userId, userId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.update(users).set({ mfaEnabled: false }).where(eq(users.id, userId));
  });
}
