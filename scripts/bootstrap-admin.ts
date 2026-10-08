/**
 * Creates the FIRST platform administrator securely (no default passwords exist anywhere in the code).
 *
 *   npx tsx --conditions=react-server scripts/bootstrap-admin.ts --email you@waqfak.sa --phone 05XXXXXXXX --name "الاسم"
 *   (in Docker:  docker compose run --rm migrate npx tsx --conditions=react-server scripts/bootstrap-admin.ts ...)
 *
 * It prints ONCE: a random one-time password, a TOTP secret (+ otpauth URI to add to an authenticator app)
 * and 8 recovery codes. Nothing is written to disk. Change the password after first sign-in.
 * Refuses to run when a super_admin already exists (use --additional to add another one deliberately).
 */
import "./jobs/_shim";
import "dotenv/config";
import { eq } from "drizzle-orm";
import { generateSecret, generateURI } from "otplib";
import { withSystem } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { encryptString, lookupHash, randomToken } from "../src/server/lib/crypto";
import { hashPassword } from "../src/server/auth/mfa";
import { normalizeSaudiMobile } from "../src/server/auth/otp";
import { audit } from "../src/server/lib/audit";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const phone = normalizeSaudiMobile(arg("phone") ?? "");
  const name = arg("name") ?? "مدير المنصة";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email is required (valid address)");
  if (!phone) throw new Error("--phone is required (Saudi mobile, 05XXXXXXXX)");

  const out = await withSystem(async (tx) => {
    const [role] = await tx.select().from(s.roles).where(eq(s.roles.key, "super_admin"));
    if (!role) throw new Error("Roles are not seeded. Run: npm run db:seed");
    const existing = await tx.select({ id: s.userRoles.userId }).from(s.userRoles).where(eq(s.userRoles.roleId, role.id));
    if (existing.length && !process.argv.includes("--additional")) throw new Error("A super_admin already exists. Pass --additional to create another one.");
    const clash = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.phone, phone));
    if (clash.length) throw new Error("A user with this phone already exists.");

    const password = `${randomToken(12)}-${randomToken(6)}`;
    const secret = generateSecret();
    const codes = Array.from({ length: 8 }, () => randomToken(6).replace(/[-_]/g, "x").slice(0, 10).toUpperCase());
    const [u] = await tx
      .insert(s.users)
      .values({ phone, email, fullName: name, isStaff: true, mfaEnabled: true, passwordHash: await hashPassword(password), phoneVerifiedAt: new Date(), residesInKsa: true })
      .returning({ id: s.users.id });
    await tx.insert(s.userRoles).values({ userId: u.id, roleId: role.id });
    await tx.insert(s.mfaFactors).values({ userId: u.id, type: "totp", secretEnc: encryptString(secret), label: "تطبيق المصادقة", verifiedAt: new Date() });
    await tx.insert(s.recoveryCodes).values(codes.map((c) => ({ userId: u.id, codeHash: lookupHash(`rc:${c}`) })));
    await audit(tx, { actorUserId: null, actorLabel: "bootstrap-admin (CLI)", action: "admin.bootstrap", entityType: "user", entityId: u.id, after: { email, role: "super_admin" } });
    return { password, secret, codes, uri: generateURI({ issuer: "Waqfak وقفك", label: email, secret }) };
  });

  console.log(`
══════════════ Waqfak — first administrator (shown once) ══════════════
Sign in at  : ${process.env.APP_URL ?? ""}/login  → tab "البريد وكلمة المرور"
Email       : ${email}
Password    : ${out.password}
TOTP secret : ${out.secret}
TOTP URI    : ${out.uri}
Recovery    : ${out.codes.join("  ")}
Add the TOTP secret to an authenticator app now, store the recovery codes offline,
then change the password from /app/security after the first sign-in.
═══════════════════════════════════════════════════════════════════════`);
}

main().then(() => process.exit(0), (e) => { console.error(String(e?.message ?? e)); process.exit(1); });
