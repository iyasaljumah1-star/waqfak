/**
 * DEMO DATA ONLY — clearly fictional people and waqfs, all marked "(تجريبي)" and isDemo=true.
 * Run: npm run db:seed-demo            (creates if missing)
 *      npm run db:seed-demo -- --reset (deletes previous demo data first)
 *
 * Credentials (generated randomly at run time, never stored in code) are written to
 * storage/demo-credentials.json (git-ignored). Staff accounts get a password + TOTP secret.
 *
 * Feature teams add their own demo data in scripts/demo/<area>.ts exporting
 *   `export default async function (tx: Tx, ctx: DemoCtx): Promise<void>`
 * — those files are run in alphabetical order after the core data below.
 */
import "dotenv/config";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { generateSecret } from "otplib";
import { withSystem, type Tx } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { encryptString, randomToken } from "../src/server/lib/crypto";
import { hashPassword } from "../src/server/auth/mfa";
import { nextNumber } from "../src/server/lib/audit";
import { syncWaqfObligations } from "../src/server/modules/compliance/events";

export type DemoUserKey =
  | "admin" | "ops" | "emp1" | "emp2" | "mlro" | "editor"
  | "nazir" | "waqif" | "chair" | "member1" | "member2" | "secretary" | "beneficiary" | "outsider";
export type DemoCtx = {
  users: Record<DemoUserKey, string>; // user ids
  waqfs: { A: string; B: string; C: string };
  services: Map<string, string>; // code -> id
};

const PHONE_PREFIX = "+96655500"; // demo range
const DEMO_USERS: { key: DemoUserKey; n: number; name: string; staff?: string; email?: string }[] = [
  { key: "admin", n: 1001, name: "مدير المنصة (تجريبي)", staff: "super_admin", email: "admin@demo.waqfak.test" },
  { key: "ops", n: 1002, name: "مدير العمليات (تجريبي)", staff: "ops_manager", email: "ops@demo.waqfak.test" },
  { key: "emp1", n: 1003, name: "موظف أول (تجريبي)", staff: "employee", email: "emp1@demo.waqfak.test" },
  { key: "emp2", n: 1004, name: "موظف ثانٍ (تجريبي)", staff: "employee", email: "emp2@demo.waqfak.test" },
  { key: "mlro", n: 1005, name: "مسؤول الالتزام (تجريبي)", staff: "mlro", email: "mlro@demo.waqfak.test" },
  { key: "editor", n: 1006, name: "محرر المحتوى (تجريبي)", staff: "content_editor", email: "editor@demo.waqfak.test" },
  { key: "nazir", n: 2001, name: "ناظر تجريبي — عبدالله", email: "nazir@demo.waqfak.test" },
  { key: "waqif", n: 2002, name: "واقف تجريبي — سالم" },
  { key: "chair", n: 2003, name: "رئيس مجلس تجريبي — فهد" },
  { key: "member1", n: 2004, name: "عضو مجلس تجريبي — نورة" },
  { key: "member2", n: 2005, name: "عضو مستقل تجريبي — خالد" },
  { key: "secretary", n: 2006, name: "أمين سر تجريبي — هند" },
  { key: "beneficiary", n: 2007, name: "مستفيد تجريبي — ريم" },
  { key: "outsider", n: 2008, name: "مستخدم بلا وقف (تجريبي)" },
];

const reset = process.argv.includes("--reset");
const phoneOf = (n: number) => `${PHONE_PREFIX}${n}`;
const localPhone = (n: number) => `055500${n}`;

async function wipe(tx: Tx) {
  const demoW = await tx.select({ id: s.waqfs.id }).from(s.waqfs).where(eq(s.waqfs.isDemo, true));
  const ids = demoW.map((w) => w.id);
  const demoU = await tx.select({ id: s.users.id }).from(s.users).where(like(s.users.phone, `${PHONE_PREFIX}%`));
  const uids = demoU.map((u) => u.id);
  // Tables with a waqf_id column: delete rows of demo waqfs (cascade handles most).
  if (ids.length) {
    const tables = await tx.execute<{ table_name: string }>(sql`
      select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and c.column_name = 'waqf_id' and t.table_type = 'BASE TABLE'
        and c.table_name not in ('audit_logs','document_access_log')`);
    for (const t of tables.rows) {
      await tx.execute(sql`delete from ${sql.identifier(t.table_name)} where waqf_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`).catch(() => undefined);
    }
    await tx.delete(s.waqfs).where(inArray(s.waqfs.id, ids));
  }
  if (uids.length) {
    await tx.delete(s.serviceRequests).where(inArray(s.serviceRequests.requesterUserId, uids)).catch(() => undefined);
    await tx.delete(s.users).where(inArray(s.users.id, uids));
  }
}

async function main() {
  const creds: Record<string, unknown> = {};
  const ctx = await withSystem(async (tx) => {
    if (reset) await wipe(tx);
    const existing = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.phone, phoneOf(1001)));
    if (existing.length) {
      console.log("Demo data already present. Use --reset to recreate (new credentials will be generated).");
      return null;
    }

    const roleRows = await tx.select().from(s.roles);
    const roleId = new Map(roleRows.map((r) => [r.key, r.id]));
    const users = {} as Record<DemoUserKey, string>;

    for (const u of DEMO_USERS) {
      const staff = !!u.staff;
      const password = staff ? `Wq-${randomToken(9)}` : null;
      const totp = staff ? generateSecret() : null;
      const [row] = await tx
        .insert(s.users)
        .values({
          phone: phoneOf(u.n), email: u.email ?? null, fullName: u.name, isStaff: staff, mfaEnabled: staff,
          passwordHash: password ? await hashPassword(password) : null, phoneVerifiedAt: new Date(), residesInKsa: true,
        })
        .returning({ id: s.users.id });
      users[u.key] = row.id;
      if (u.staff) {
        await tx.insert(s.userRoles).values({ userId: row.id, roleId: roleId.get(u.staff)! });
        await tx.insert(s.mfaFactors).values({ userId: row.id, type: "totp", secretEnc: encryptString(totp!), label: "تطبيق المصادقة", verifiedAt: new Date() });
      }
      await tx.insert(s.consents).values([{ userId: row.id, kind: "terms", version: "2026-10", granted: true }, { userId: row.id, kind: "privacy", version: "2026-10", granted: true }]);
      creds[u.key] = { name: u.name, phone: localPhone(u.n), email: u.email, role: u.staff ?? "client", password, totpSecret: totp };
    }

    // ── Waqfs ──
    const mk = async (v: Partial<typeof s.waqfs.$inferInsert> & { name: string }) => {
      const [w] = await tx.insert(s.waqfs).values({ internalNumber: await nextNumber(tx, "WQF"), isDemo: true, createdBy: users.admin, ...v }).returning({ id: s.waqfs.id });
      return w.id;
    };
    const A = await mk({
      name: "وقف النور التعليمي (تجريبي)", legalType: "public", computedType: "public", sizeClass: "medium", assetsEstimatedValue: "18500000",
      status: "registered", nazirMode: "individual", stage: 3, deedNo: "DEMO-4410-001", deedIssuer: "محكمة تجريبية", deedDate: "2023-03-14",
      documentedOn: "2023-03-14", registeredOn: "2023-05-02", nationalUnifiedNumber: "7000000001", registrationCertNo: "DEMO-REG-001",
      registrationExpiresOn: "2027-05-01", fieldOfWork: "التعليم", geographicScope: "الرياض", founderAlive: false,
    });
    const B = await mk({
      name: "وقف آل سالم الأهلي (تجريبي)", legalType: "private", computedType: "private", sizeClass: "small", assetsEstimatedValue: "3200000",
      status: "registered", nazirMode: "founder", stage: 2, deedNo: "DEMO-4445-014", deedDate: "2024-09-02", documentedOn: "2024-09-02",
      registeredOn: "2024-11-20", nationalUnifiedNumber: "7000000002", founderAlive: true, fieldOfWork: "ذرية الواقف",
    });
    const C = await mk({
      name: "وقف الإحسان الصحي (تجريبي)", legalType: "public", computedType: "public", sizeClass: "large", assetsEstimatedValue: "240000000",
      status: "active", nazirMode: "board", stage: 4, deedNo: "DEMO-4438-207", deedDate: "2017-01-10", documentedOn: "2017-01-10",
      registeredOn: "2017-04-01", nationalUnifiedNumber: "7000000003", fieldOfWork: "الصحة", geographicScope: "المملكة", founderAlive: false,
      collectsDonations: true,
    });

    const member = (waqfId: string, userId: string, roleKey: string, isIndependent = false) =>
      tx.insert(s.waqfMemberships).values({ waqfId, userId, roleKey, isIndependent, createdBy: users.admin });
    await member(A, users.nazir, "nazir");
    await member(B, users.waqif, "founder");
    await member(B, users.waqif, "nazir");
    await member(B, users.beneficiary, "beneficiary");
    await member(C, users.chair, "board_chair");
    await member(C, users.member1, "board_member");
    await member(C, users.member2, "board_member", true);
    await member(C, users.secretary, "board_secretary");

    // Beneficiary entitlement on B
    const [cls] = await tx.insert(s.beneficiaryClasses).values({ waqfId: B, name: "أولاد الواقف وذريتهم", kind: "private", specifiedBy: "description", tier: 1, divisionRule: "equal" }).returning({ id: s.beneficiaryClasses.id });
    const [ben] = await tx.insert(s.beneficiaries).values({ waqfId: B, classId: cls.id, displayName: "مستفيد تجريبي — ريم", userId: users.beneficiary, entitlementShare: "0.25", generation: 1, lastVerifiedOn: "2026-01-15" }).returning({ id: s.beneficiaries.id });
    await tx.insert(s.beneficiaries).values([
      { waqfId: B, classId: cls.id, displayName: "مستفيد تجريبي — ماجد", entitlementShare: "0.25", generation: 1 },
      { waqfId: B, classId: cls.id, displayName: "مستفيد تجريبي — لمى", entitlementShare: "0.25", generation: 1 },
      { waqfId: B, classId: cls.id, displayName: "مستفيد تجريبي — يوسف", entitlementShare: "0.25", generation: 1, residesAbroad: true },
    ]);
    await tx.insert(s.entitlements).values([
      { waqfId: B, beneficiaryId: ben.id, period: "2025", amount: "21500", basis: "ربع صافي الغلة القابلة للتوزيع لعام 2025", expectedPayOn: "2026-02-15" },
      { waqfId: B, beneficiaryId: ben.id, period: "2026", amount: "23000", basis: "تقدير: ربع صافي الغلة المتوقعة لعام 2026", expectedPayOn: "2027-02-15" },
    ]);

    // Services + assigned requests (scenario 5: each employee sees only their assigned waqf)
    const svc = await tx.select({ id: s.services.id, code: s.services.code }).from(s.services);
    const services = new Map(svc.map((x) => [x.code, x.id]));
    const req = async (waqfId: string, requester: string, code: string, assignee: string, status: (typeof s.serviceRequests.$inferInsert)["status"], details: string) =>
      tx.insert(s.serviceRequests).values({
        number: await nextNumber(tx, "REQ"), serviceId: services.get(code)!, waqfId, requesterUserId: requester, status, assignedToUserId: assignee,
        details, source: "manual", conflictCheck: "passed", submittedAt: new Date(), createdBy: requester,
      });
    await req(A, users.nazir, "C03", users.emp1, "in_progress", "طلب تجريبي: تقرير جاهزية الفحص قبل نهاية السنة المالية.");
    await req(C, users.chair, "G01", users.emp2, "triage", "طلب تجريبي: تحديث اللوائح حسب حجم الوقف الكبير.");

    return { users, waqfs: { A, B, C }, services } satisfies DemoCtx;
  });
  if (!ctx) return;

  // Standing obligations for each demo waqf (no-op until the compliance engine is present).
  await withSystem(async (tx) => {
    for (const w of Object.values(ctx.waqfs)) await syncWaqfObligations(tx, w);
  });

  // Feature-team demo data
  const dir = path.join(__dirname, "demo");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
  } catch {}
  for (const f of files) {
    const mod = await import(path.join(dir, f));
    await withSystem((tx) => mod.default(tx, ctx));
    console.log(`  ✓ demo/${f}`);
  }

  mkdirSync("storage", { recursive: true });
  writeFileSync("storage/demo-credentials.json", JSON.stringify({ note: "DEMO ONLY — fictional accounts. Phone login shows the OTP on screen while SMS is not connected. Staff: email + password + TOTP.", waqfs: ctx.waqfs, users: { ...creds, ...Object.fromEntries(Object.entries(ctx.users).map(([k, id]) => [k, { ...(creds[k] as object), id }])) } }, null, 2), { mode: 0o600 });
  console.log("Demo data created. Credentials → storage/demo-credentials.json");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
void and;
