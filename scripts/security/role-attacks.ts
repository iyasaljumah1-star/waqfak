/**
 * Stage 11 (owner's decision of 2026-11-12, «أولاً»/1): attack battery for the separation of the authentication, system
 * and application roles on the FULL schema — R8-1 (impersonation, privilege escalation through the application role),
 * G10 (a session made in the database), N10-10 (another person's contact data). Runs with the APPLICATION role's own
 * login against two isolated local copies of the development database, built and dropped here:
 *   - «waqfak_roles_new»: the current security layer (src/server/db/sql/security.sql);
 *   - «waqfak_roles_control»: a copy of the development database taken before the stage's layer (CONTROL_TEMPLATE),
 *     with the base's security layer (git tag stage11-base) re-applied — the control: the battery must find the
 *     breaches there, or it proves nothing.
 * Every attack runs in its own transaction, rolled back. Synthetic accounts only (fixtures committed in the copies, which
 * are dropped). Local cluster only. Usage: npx tsx --conditions=react-server scripts/security/role-attacks.ts [--keep]
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { Client } from "pg";

const appUrl = new URL(process.env.DATABASE_URL!);
const ownerUrl = new URL(process.env.DATABASE_OWNER_URL!);
const authUrl = new URL(process.env.AUTH_DATABASE_URL!);
const sysUrl = new URL(process.env.SYSTEM_DATABASE_URL!);
for (const u of [appUrl, ownerUrl, authUrl, sysUrl]) if (!["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("local cluster only");
const su = (sqlText: string, db = "postgres") => execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", db, "-c", sqlText], { stdio: ["ignore", "pipe", "pipe"] }).toString();
const urlFor = (base: URL, db: string) => { const u = new URL(base.toString()); u.pathname = `/${db}`; return u.toString(); };
// the server's keyed hash of a session cookie (lib/crypto sessionHash) — the database never holds HASH_KEY
const sessionHash = (token: string) => createHmac("sha256", Buffer.from(process.env.HASH_KEY!, "base64")).update(`session|${token}`.trim()).digest("base64url");

const U = {
  admin: "00000000-0000-4000-8000-0000000e0a01", // super_admin, second factor verified
  adminNoMfa: "00000000-0000-4000-8000-0000000e0a02", // super_admin, session without the second factor
  client: "00000000-0000-4000-8000-0000000e0a03", // member of WAQF_A only
  other: "00000000-0000-4000-8000-0000000e0a04", // member of WAQF_B only
  victim: "00000000-0000-4000-8000-0000000e0a05", // a person with contact data, member of WAQF_B
  mlro: "00000000-0000-4000-8000-0000000e0a06", // holds mlro, second factor
};
const W = { a: "00000000-0000-4000-8000-0000000e0b01", b: "00000000-0000-4000-8000-0000000e0b02", empty: "00000000-0000-4000-8000-0000000e0b03", reg: "00000000-0000-4000-8000-0000000e0b04", draft: "00000000-0000-4000-8000-0000000e0b05" };
const INV = { client: "00000000-0000-4000-8000-0000000e0d01", other: "00000000-0000-4000-8000-0000000e0d02" };
const REP = { issued: "00000000-0000-4000-8000-0000000e0c01", draft: "00000000-0000-4000-8000-0000000e0c02" };
const TOK = Object.fromEntries(Object.keys(U).map((k) => [k, `stage11-attack-${k}-${randomBytes(8).toString("hex")}`])) as Record<keyof typeof U, string>;

async function fixtures(db: string) {
  const c = new Client({ connectionString: urlFor(ownerUrl, db) });
  await c.connect();
  try {
    await c.query("begin");
    const users: [string, string, string, boolean][] = [
      [U.admin, "0500e0a001", "مدير اختبار", true], [U.adminNoMfa, "0500e0a002", "مدير اختبار بلا عامل ثانٍ", true],
      [U.client, "0500e0a003", "عميل اختبار", false], [U.other, "0500e0a004", "عميل اختبار آخر", false],
      [U.victim, "0500e0a005", "شخص اختبار", false], [U.mlro, "0500e0a006", "مسؤول امتثال اختبار", true],
    ];
    for (const [id, phone, name, staff] of users)
      await c.query(`insert into users (id, phone, email, full_name, is_staff, status, birth_date) values ($1, $2, $3, $4, $5, 'active', '1990-01-01') on conflict (id) do nothing`, [id, phone, `${phone}@example.test`, name, staff]);
    for (const [u, r] of [[U.admin, "super_admin"], [U.adminNoMfa, "super_admin"], [U.mlro, "mlro"]])
      await c.query(`insert into user_roles (user_id, role_id) select $1, id from roles where key = $2 on conflict do nothing`, [u, r]);
    for (const [k, id] of Object.entries(U) as [keyof typeof U, string][])
      await c.query(`insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values ($1, $2, $3, now() + interval '1 hour', now() + interval '1 hour')`, [id, sessionHash(TOK[k]), k !== "adminNoMfa"]);
    for (const [w, n] of [[W.a, "وقف اختبار أ"], [W.b, "وقف اختبار ب"], [W.empty, "وقف بلا أعضاء"]])
      await c.query(`insert into waqfs (id, internal_number, name, created_by) values ($1, $2, $3, $4) on conflict (id) do nothing`, [w, `T-${w.slice(-4)}`, n, U.other]);
    for (const [w, u, r] of [[W.a, U.client, "founder"], [W.b, U.other, "nazir"], [W.b, U.victim, "beneficiary"]])
      await c.query(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, $3, 'active') on conflict do nothing`, [w, u, r]);
    // another person's private rows (for T1)
    await c.query(`insert into consents (user_id, kind, version, granted) values ($1, 'privacy', 'v1', true)`, [U.victim]);
    await c.query(`insert into data_subject_requests (user_id, kind, details) values ($1, 'access', 'اختبار')`, [U.victim]);
    await c.query(`insert into notification_preferences (user_id, type, in_app, email, sms) values ($1, 'invitation', true, false, false) on conflict do nothing`, [U.victim]);
    // the client's own waqfs: one registered, one still being established (for N8, P10)
    for (const [w, st] of [[W.reg, "registered"], [W.draft, "idea"]]) {
      await c.query(`insert into waqfs (id, internal_number, name, created_by, status) values ($1, $2, 'وقف اختبار', $3, $4) on conflict (id) do nothing`, [w, `T-${w.slice(-4)}`, U.client, st]);
      await c.query(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'founder', 'active') on conflict do nothing`, [w, U.client]);
    }
    // an invoice of the client's and one of another person's (for T6, P9)
    for (const [id, u] of [[INV.client, U.client], [INV.other, U.other]])
      await c.query(`insert into invoices (id, number, user_id, billed_to_name, subtotal, vat, total, status, issued_on, lines) values ($1, $2, $3, 'اختبار', 100, 15, 115, 'issued', current_date, '[]'::jsonb) on conflict (id) do nothing`, [id, `T-INV-${id.slice(-4)}`, u]);
    // an issued report and a draft awaiting approval (for C3, P8)
    for (const [id, st] of [[REP.issued, "final"], [REP.draft, "draft"]])
      await c.query(`insert into reports (id, number, waqf_id, kind, title, status, verification_code, snapshot) values ($1, $2, $3, 'nazara_periodic', 'تقرير اختبار', $4, $5, '{"v":1}') on conflict (id) do nothing`, [id, `T-REP-${id.slice(-4)}`, W.a, st, `vc${id.slice(-8)}`]);
    await c.query("commit");
  } finally {
    await c.end();
  }
}

type Ctx = { c: Client; q: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
/** breached: true (the attack worked), false (it did not); a thrown error is a refusal. */
type Attack = { id: string; finding: string; what: string; run: (x: Ctx) => Promise<boolean> };
/** Acts as that person: by binding their session (the new layer); where binding does not exist (the control), the old
 * way — declaring them in the variables — so that the control's attacks run as the same person. */
async function bind(x: Ctx, k: keyof typeof U): Promise<string | null> {
  await x.q("savepoint b");
  try {
    const r = await x.q(`select auth_bind($1) as u`, [sessionHash(TOK[k])]);
    await x.q("release savepoint b");
    return (r.rows[0]?.u as string) ?? null;
  } catch {
    await x.q("rollback to savepoint b");
    // as the base application set them: global access for a holder of a global role (the administrators), not otherwise
    await x.q(`select set_config('app.user_id', $1, true), set_config('app.global_access', $2, true)`, [U[k], k === "admin" || k === "adminNoMfa" ? "on" : "off"]);
    return U[k];
  }
}
const declare = (x: Ctx, id: string, global = "on") => x.q(`select set_config('app.user_id', $1, true), set_config('app.global_access', $2, true)`, [id, global]);
const asSystemVars = (x: Ctx) => x.q(`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
const n = (r: { rows: Record<string, unknown>[] }) => Number(Object.values(r.rows[0] ?? { n: 0 })[0] ?? 0);

const ATTACKS: Attack[] = [
  // ── R8-1: declaring a person, or the system, through variables ──
  { id: "A1", finding: "R8-1", what: "declare the administrator in app.user_id: is the database convinced?", run: async (x) => { await declare(x, U.admin); return (await x.q(`select app_current_user() = $1::uuid as ok`, [U.admin])).rows[0]?.ok === true; } },
  { id: "A2", finding: "R8-1", what: "declare global access in app.global_access", run: async (x) => { await declare(x, U.client, "on"); return (await x.q(`select app_has_global_access() as g`)).rows[0]?.g === true; } },
  { id: "A3", finding: "R8-1", what: "the «system context» (empty user, global on) reads every waqf", run: async (x) => { await asSystemVars(x); return n(await x.q(`select count(*) from waqfs where id = any($1::uuid[])`, [[W.a, W.b]])) === 2; } },
  { id: "A4", finding: "R8-1 A7", what: "grant super_admin to the client by inserting into user_roles, as a declared administrator", run: async (x) => { await declare(x, U.admin); return ((await x.q(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'super_admin' on conflict do nothing`, [U.client])).rowCount ?? 0) > 0; } },
  { id: "A5", finding: "R8-1 A7", what: "grant super_admin from the «system context»", run: async (x) => { await asSystemVars(x); return ((await x.q(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'super_admin' on conflict do nothing`, [U.client])).rowCount ?? 0) > 0; } },
  { id: "A6", finding: "R8-1 A6d", what: "add outputs.final_approve to the viewer role (declared administrator)", run: async (x) => { await declare(x, U.admin); return ((await x.q(`insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.key = 'viewer' and p.key = 'outputs.final_approve' on conflict do nothing`)).rowCount ?? 0) > 0; } },
  { id: "A7", finding: "R8-1", what: "create an account (insert into users)", run: async (x) => { await asSystemVars(x); return ((await x.q(`insert into users (phone, full_name, is_staff, status) values ('0500e0affe', 'حساب مزروع', true, 'active')`)).rowCount ?? 0) > 0; } },
  { id: "A8", finding: "R8-1 B4", what: "reactivate/unlock an account, make it staff (declared administrator)", run: async (x) => { await declare(x, U.admin); return ((await x.q(`update users set status = 'active', locked_until = null, is_staff = true where id = $1`, [U.client])).rowCount ?? 0) > 0; } },
  { id: "A9", finding: "R8-1 B7", what: "change another person's phone (the sign-in identifier), declared administrator", run: async (x) => { await declare(x, U.admin); return ((await x.q(`update users set phone = '0599999999' where id = $1`, [U.victim])).rowCount ?? 0) > 0; } },
  { id: "A10", finding: "R8-1", what: "delete an account", run: async (x) => { await asSystemVars(x); return ((await x.q(`delete from users where id = $1`, [U.victim])).rowCount ?? 0) > 0; } },
  { id: "A11", finding: "R8-1", what: "forge an audit entry in the administrator's name while bound as the client", run: async (x) => { await bind(x, "client"); await x.q(`select pg_advisory_xact_lock(724501)`); await x.q(`insert into audit_logs (actor_user_id, action, entity_type, prev_hash, hash) values ($1, 'admin.user.role_granted', 'user', app_audit_last_hash(), md5(random()::text))`, [U.admin]); return true; } },
  // ── G10: sessions ──
  { id: "G1", finding: "G10", what: "make a session row for the administrator (then bind with its hash)", run: async (x) => { const t = "forged-" + randomBytes(6).toString("hex"); await x.q(`insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values ($1, $2, true, now() + interval '1 hour', now() + interval '1 hour')`, [U.admin, sessionHash(t)]); return (await x.q(`select auth_bind($1) as u`, [sessionHash(t)])).rows[0]?.u === U.admin; } },
  { id: "G2", finding: "G10", what: "read the stored token hashes (to bind as another person)", run: async (x) => n(await x.q(`select count(token_hash) from sessions`)) > 0 },
  { id: "G3", finding: "G10", what: "bind with a guessed / stale hash", run: async (x) => (await x.q(`select auth_bind($1) as u`, [sessionHash("not-a-session")])).rows[0]?.u != null },
  { id: "G4", finding: "G10", what: "revive an ended session or extend it", run: async (x) => { await bind(x, "client"); await x.q(`update sessions set revoked_at = now() where user_id = $1`, [U.client]); return ((await x.q(`update sessions set revoked_at = null, idle_expires_at = now() + interval '30 days' where user_id = $1`, [U.client])).rowCount ?? 0) > 0; } },
  { id: "G5", finding: "G10", what: "mark one's own session as having passed the second factor", run: async (x) => { await bind(x, "adminNoMfa"); return ((await x.q(`update sessions set mfa_verified = true where user_id = $1`, [U.adminNoMfa])).rowCount ?? 0) > 0; } },
  { id: "G6", finding: "G10", what: "a binding outlives its transaction (committed, then reused on the same pooled connection)", run: async (x) => { await bind(x, "admin"); await x.q("commit"); await x.q("begin"); return (await x.q(`select app_current_user() as u`)).rows[0]?.u != null; } },
  { id: "G7", finding: "G10", what: "read or replace the second-factor secrets, recovery codes or one-time codes", run: async (x) => { await asSystemVars(x); return n(await x.q(`select (select count(*) from mfa_factors) + (select count(*) from recovery_codes) + (select count(*) from otp_challenges)`)) >= 0; } },
  { id: "G8", finding: "G10", what: "become another role: SET ROLE waqfak_system / waqfak_auth / waqfak_owner", run: async (x) => { for (const r of ["waqfak_system", "waqfak_auth", "waqfak_owner"]) { try { await x.q(`savepoint r`); await x.q(`set local role ${r}`); return true; } catch { await x.q(`rollback to savepoint r`); } } return false; } },
  { id: "G9", finding: "G10", what: "MLRO's restricted rows after SET ROLE waqfak_mlro, bound as a client", run: async (x) => { await bind(x, "client"); await x.q(`set local role waqfak_mlro`); await x.q(`insert into restricted.suspicion_reports (waqf_id, summary_enc, created_by, status) values ($1, 'x', $2, 'draft')`, [W.a, U.client]); return true; } },
  // ── an administrator's functions without the administrator ──
  { id: "F1", finding: "R8-1", what: "admin_grant_role unbound (the «system» is not reachable)", run: async (x) => { await asSystemVars(x); return (await x.q(`select admin_grant_role($1, 'super_admin') as ok`, [U.client])).rows[0]?.ok === true; } },
  { id: "F2", finding: "R8-1", what: "admin_grant_role bound as the client", run: async (x) => { await bind(x, "client"); return (await x.q(`select admin_grant_role($1, 'super_admin') as ok`, [U.client])).rows[0]?.ok === true; } },
  { id: "F3", finding: "R8-1", what: "admin_grant_role bound as an administrator WITHOUT the second factor", run: async (x) => { await bind(x, "adminNoMfa"); return (await x.q(`select admin_grant_role($1, 'super_admin') as ok`, [U.client])).rows[0]?.ok === true; } },
  { id: "F4", finding: "R8-1", what: "admin_create_user / admin_set_standing bound as the client", run: async (x) => { await bind(x, "client"); await x.q(`select admin_create_user('0500e0afff', 'x', null, true)`); return true; } },
  // ── data isolation for a bound person (N10-10 on the users table is batch B) ──
  { id: "D1", finding: "R8-1", what: "bound as the client: read the other waqf", run: async (x) => { await bind(x, "client"); return n(await x.q(`select count(*) from waqfs where id = $1`, [W.b])) > 0; } },
  { id: "D2", finding: "R8-1", what: "bound as the client: global access", run: async (x) => { await bind(x, "client"); return (await x.q(`select app_has_global_access() as g`)).rows[0]?.g === true; } },
  // ── N10-10: another person's contact data; N10-11: making oneself a member (nazir) ──
  { id: "N1", finding: "N10-10", what: "bound as a client: read another person's phone and e-mail from users", run: async (x) => { await bind(x, "client"); return (await x.q(`select phone, email from users where id = $1`, [U.victim])).rows.length > 0; } },
  { id: "N2", finding: "N10-10", what: "bound as a client: read every account's phone (the whole table)", run: async (x) => { await bind(x, "client"); return n(await x.q(`select count(phone) from users`)) > 1; } },
  { id: "N3", finding: "N10-10", what: "bound as a client: another person's contact through app_user_contact", run: async (x) => { await bind(x, "client"); return (await x.q(`select * from app_user_contact(array[$1]::uuid[])`, [U.victim])).rows.length > 0; } },
  { id: "N4", finding: "N10-10", what: "bound as a client: another person's birth date / identity through app_user_private", run: async (x) => { await bind(x, "client"); return (await x.q(`select * from app_user_private($1)`, [U.victim])).rows.length > 0; } },
  { id: "N5", finding: "N10-11", what: "bound as a client: make oneself nazir of a waqf that has no members", run: async (x) => { await bind(x, "client"); return ((await x.q(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'nazir', 'active')`, [W.empty, U.client])).rowCount ?? 0) > 0; } },
  { id: "N6", finding: "N10-11", what: "bound as a client: make oneself nazir of another person's waqf", run: async (x) => { await bind(x, "client"); return ((await x.q(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'nazir', 'active')`, [W.b, U.client])).rowCount ?? 0) > 0; } },
  { id: "N7", finding: "N10-11", what: "bound as a beneficiary of a waqf: appoint someone its nazir", run: async (x) => { await bind(x, "victim"); return ((await x.q(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'nazir', 'active')`, [W.b, U.client])).rowCount ?? 0) > 0; } },
  // ── the tables without row-level security ──
  { id: "N8", finding: "N10-11", what: "bound as the founder of a REGISTERED waqf: make oneself its nazir (outside the establishment wizard)", run: async (x) => { await bind(x, "client"); return ((await x.q(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'nazir', 'active')`, [W.reg, U.client])).rowCount ?? 0) > 0; } },
  { id: "T1", finding: "no-RLS", what: "bound as a client: read other people's consents, payments, privacy requests, preferences", run: async (x) => { await bind(x, "client"); return n(await x.q(`select (select count(*) from consents where user_id <> $1) + (select count(*) from payments where user_id <> $1) + (select count(*) from data_subject_requests where user_id <> $1) + (select count(*) from notification_preferences where user_id <> $1)`, [U.client])) > 0; } },
  { id: "T2", finding: "no-RLS", what: "bound as a client: change a service, a setting or a feature flag", run: async (x) => { await bind(x, "client"); const a = (await x.q(`update services set name_ar = name_ar where true`)).rowCount ?? 0; const b = (await x.q(`update settings set value = value where true`)).rowCount ?? 0; const c = (await x.q(`update feature_flags set enabled = enabled where true`)).rowCount ?? 0; return a + b + c > 0; } },
  { id: "T3", finding: "no-RLS", what: "bound as a client: read the outbox (other people's SMS and e-mails) or the rate limits", run: async (x) => { await bind(x, "client"); return n(await x.q(`select (select count(*) from outbox_messages) + (select count(*) from rate_limits)`)) > 0; } },
  { id: "T4", finding: "no-RLS", what: "bound as a client: read KYC records, persons, organizations, devices", run: async (x) => { await bind(x, "client"); return n(await x.q(`select (select count(*) from kyc_records) + (select count(*) from persons) + (select count(*) from organizations) + (select count(*) from devices)`)) >= 0; } },
  { id: "T6", finding: "no-RLS", what: "bound as a client: record a «paid» payment on one's own invoice, or any payment on another person's", run: async (x) => { await bind(x, "client"); let n = 0; for (const [inv, st] of [[INV.client, "paid"], [INV.other, "initiated"]]) { await x.q("savepoint p"); try { n += (await x.q(`insert into payments (invoice_id, user_id, provider, amount, status) values ($1, $2, 'mock', 115, $3)`, [inv, U.client, st])).rowCount ?? 0; await x.q("release savepoint p"); } catch { await x.q("rollback to savepoint p"); } } return n > 0; } },
  // ── stage 11, H: the independent review's findings (S11-1, S11-4, S11-18) ──
  { id: "M1", finding: "S11-1", what: "bound as a beneficiary: turn one's own membership into nazir (UPDATE role_key)", run: async (x) => { await bind(x, "victim"); return ((await x.q(`update waqf_memberships set role_key = 'nazir' where waqf_id = $1 and user_id = $2`, [W.b, U.victim])).rowCount ?? 0) > 0; } },
  { id: "M2", finding: "S11-1", what: "bound as a beneficiary: end the real nazir's membership", run: async (x) => { await bind(x, "victim"); return ((await x.q(`update waqf_memberships set status = 'ended', ends_at = now() where waqf_id = $1 and user_id = $2`, [W.b, U.other])).rowCount ?? 0) > 0; } },
  { id: "M3", finding: "S11-1", what: "bound as the founder of a registered waqf: set it back to draft (to reopen the wizard branch)", run: async (x) => { await bind(x, "client"); return ((await x.q(`update waqfs set status = 'draft' where id = $1`, [W.reg])).rowCount ?? 0) > 0; } },
  { id: "M4", finding: "S11-1", what: "bound as a beneficiary: plant an invitation already accepted by oneself as nazir", run: async (x) => { await bind(x, "victim"); return ((await x.q(`insert into invitations (waqf_id, phone, role_key, invited_by, expires_at, accepted_by, accepted_at, token_hash) values ($1, '0500e0a005', 'nazir', $2, now() + interval '1 day', $2, now(), md5(random()::text))`, [W.b, U.victim])).rowCount ?? 0) > 0; } },
  { id: "A12", finding: "S11-4", what: "bound as a client: read other people's sign-in audit entries (no waqf: IP and user agent)", run: async (x) => { await bind(x, "client"); return n(await x.q(`select count(*) from audit_logs where waqf_id is null and actor_user_id is distinct from $1`, [U.client])) > 0; } },
  { id: "T7", finding: "S11-18", what: "bound as a client: change the amount and invoice of one's own initiated payment", run: async (x) => { await bind(x, "client"); const id = (await x.q(`insert into payments (invoice_id, user_id, provider, amount, status) values ($1, $2, 'sandbox', 115, 'initiated') returning id`, [INV.client, U.client])).rows[0]!.id; return ((await x.q(`update payments set amount = 1 where id = $1`, [id])).rowCount ?? 0) > 0; } },
  // ── stage 11, C: what the engine wrote, the reference data, issued reports ──
  { id: "C1", finding: "N10-16", what: "bound administrator: record a text as the engine's (the gate's registry of engine texts)", run: async (x) => { await bind(x, "admin"); return ((await x.q(`insert into engine_blocks (binding, text_sha256, run_id, writer) values (md5(random()::text), md5(random()::text), gen_random_uuid(), 'model')`)).rowCount ?? 0) > 0; } },
  { id: "C2", finding: "ref-data", what: "bound administrator (global access): retire every knowledge source (the engine then cites nothing)", run: async (x) => { await bind(x, "admin"); const a = (await x.q(`update kb_sources set superseded_at = now() where superseded_at is null`)).rowCount ?? 0; return a > 0; } },
  { id: "C3", finding: "reports", what: "bound administrator: rewrite an issued report's title and snapshot (its link and code stay)", run: async (x) => { await bind(x, "admin"); return ((await x.q(`update reports set title = 'عنوان مزور', snapshot = '{"v":2}' where id = $1`, [REP.issued])).rowCount ?? 0) > 0; } },
  { id: "C4", finding: "reports", what: "bound administrator: withdraw an approval (approved → draft) on an approved report", run: async (x) => { await bind(x, "admin"); await x.q(`update reports set status = 'approved', approved_by = $1, approved_at = now() where id = $2`, [U.admin, REP.draft]); return ((await x.q(`update reports set status = 'draft', approved_by = null, approved_at = null where id = $1`, [REP.draft])).rowCount ?? 0) > 0; } },
  { id: "T5", finding: "no-RLS", what: "bound as a client: plant a contact message or a notification template", run: async (x) => { await bind(x, "client"); await x.q(`update notification_templates set title_ar = title_ar where true`).then((r) => { if ((r.rowCount ?? 0) === 0) throw new Error("no rows"); }); return true; } },
];

/** Must work on the new layer: the legitimate paths still open. */
const CONTROLS: Attack[] = [
  { id: "P10", finding: "—", what: "the founder of a waqf being established names themselves its nazir (the establishment wizard)", run: async (x) => { await bind(x, "client"); return ((await x.q(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'nazir', 'active')`, [W.draft, U.client])).rowCount ?? 0) > 0; } },
  { id: "P9", finding: "—", what: "a bound client starts the checkout of their own invoice (an «initiated» payment) and sets its provider reference", run: async (x) => { await bind(x, "client"); const id = (await x.q(`insert into payments (invoice_id, user_id, provider, amount, status) values ($1, $2, 'mock', 115, 'initiated') returning id`, [INV.client, U.client])).rows[0]!.id; return ((await x.q(`update payments set provider_ref = 'ref-1' where id = $1`, [id])).rowCount ?? 0) > 0; } },
  { id: "P8", finding: "—", what: "a bound administrator approves a draft report in their own name (draft → approved, once)", run: async (x) => { await bind(x, "admin"); return ((await x.q(`update reports set status = 'approved', approved_by = $1, approved_at = now() where id = $2 and status = 'draft'`, [U.admin, REP.draft])).rowCount ?? 0) > 0; } },
  { id: "P1", finding: "—", what: "bound administrator with the second factor grants a role through admin_grant_role", run: async (x) => { await bind(x, "admin"); return (await x.q(`select admin_grant_role($1, 'employee') as ok`, [U.client])).rows[0]?.ok === true; } },
  { id: "P2", finding: "—", what: "bound client reads their own waqf and changes their own name", run: async (x) => { await bind(x, "client"); const r = n(await x.q(`select count(*) from waqfs where id = $1`, [W.a])); const u = (await x.q(`update users set full_name = 'اسم جديد' where id = $1`, [U.client])).rowCount; return r === 1 && u === 1; } },
  { id: "P3", finding: "—", what: "bound client ends their own session", run: async (x) => { await bind(x, "client"); return ((await x.q(`update sessions set revoked_at = now(), revoke_reason = 'logout' where user_id = $1`, [U.client])).rowCount ?? 0) > 0; } },
  { id: "P4", finding: "—", what: "bound administrator has global access; the binding names them", run: async (x) => { const u = await bind(x, "admin"); return u === U.admin && (await x.q(`select app_has_global_access() as g`)).rows[0]?.g === true; } },
  { id: "P5", finding: "—", what: "the waqf's nazir sees its beneficiary's phone (app_user_contact); the client sees their own", run: async (x) => { await bind(x, "other"); const a = (await x.q(`select phone from app_user_contact(array[$1]::uuid[])`, [U.victim])).rows.length; await x.q("commit"); await x.q("begin"); await bind(x, "client"); const b = (await x.q(`select phone from app_user_contact(array[$1]::uuid[])`, [U.client])).rows.length; return a === 1 && b === 1; } },
  { id: "P6", finding: "—", what: "the waqf's nazir adds a member; a creator becomes the first member of the waqf they create, in that transaction", run: async (x) => { await bind(x, "other"); const a = (await x.q(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'viewer', 'active') on conflict do nothing`, [W.b, U.client])).rowCount; await x.q("commit"); await x.q("begin"); await bind(x, "client"); const w = (await x.q(`insert into waqfs (internal_number, name, created_by) values ('T-NEW', 'وقف جديد', $1) returning id`, [U.client])).rows[0]!.id; const b = (await x.q(`insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'founder', 'active')`, [w, U.client])).rowCount; return a === 1 && b === 1; } },
  { id: "P7", finding: "—", what: "a client reads the catalog (services, settings) and their own consents", run: async (x) => { await bind(x, "client"); const a = n(await x.q(`select count(*) from services`)); const b = n(await x.q(`select count(*) from settings`)); await x.q(`select count(*) from consents where user_id = $1`, [U.client]); return a > 0 && b > 0; } },
];

async function battery(db: string, set: Attack[]) {
  const out: { id: string; finding: string; what: string; result: "BREACHED" | "refused" | "no effect" | "worked" | "failed"; detail: string }[] = [];
  for (const a of set) {
    const c = new Client({ connectionString: urlFor(appUrl, db) });
    await c.connect();
    const x: Ctx = { c, q: (t, p) => c.query(t, p as unknown[]) as never };
    try {
      await c.query("begin");
      const b = await a.run(x);
      out.push({ id: a.id, finding: a.finding, what: a.what, result: set === CONTROLS ? (b ? "worked" : "failed") : b ? "BREACHED" : "no effect", detail: "" });
    } catch (e) {
      out.push({ id: a.id, finding: a.finding, what: a.what, result: set === CONTROLS ? "failed" : "refused", detail: String((e as Error).message).slice(0, 110) });
    } finally {
      await c.query("rollback").catch(() => {});
      await c.end();
    }
  }
  return out;
}

async function main() {
  const keep = process.argv.includes("--keep");
  const base = execFileSync("git", ["show", "stage11-base:src/server/db/sql/security.sql"]).toString();
  const dbs = { new: "waqfak_roles_new", control: "waqfak_roles_control" };
  // the control is built from a copy taken BEFORE the stage's layer was applied (CONTROL_TEMPLATE, default
  // waqfak_e2ebase), so none of the new functions, triggers or revocations linger in it
  const tpl = { new: "waqfak_dev", control: process.env.CONTROL_TEMPLATE ?? "waqfak_e2ebase" };
  for (const [k, d] of Object.entries(dbs) as [keyof typeof dbs, string][]) {
    su(`drop database if exists ${d} with (force)`);
    su(`create database ${d} template ${tpl[k]} owner waqfak_owner`);
    su(`grant connect on database ${d} to waqfak_app, waqfak_auth, waqfak_system`, d);
  }
  // the control: the base's security layer over the same data (its grants and variable-based identity come back)
  const tmp = `/tmp/stage11-base-security-${process.pid}.sql`;
  (await import("node:fs")).writeFileSync(tmp, base);
  execFileSync("psql", [urlFor(ownerUrl, dbs.control), "-v", "ON_ERROR_STOP=1", "-q", "-f", tmp], { stdio: ["ignore", "pipe", "pipe"] });
  for (const d of Object.values(dbs)) await fixtures(d);
  const results: Record<string, Awaited<ReturnType<typeof battery>>> = {};
  for (const [k, d] of Object.entries(dbs)) results[k] = await battery(d, ATTACKS);
  const controls = await battery(dbs.new, CONTROLS);
  console.log("id   | finding   | control (stage11-base) | new layer | attack");
  for (const a of ATTACKS) {
    const c = results.control.find((r) => r.id === a.id)!; const nw = results.new.find((r) => r.id === a.id)!;
    console.log(`${a.id.padEnd(4)} | ${a.finding.padEnd(9)} | ${c.result.padEnd(22)} | ${nw.result.padEnd(9)} | ${a.what}${nw.detail ? `  [${nw.detail}]` : ""}`);
  }
  console.log("\nlegitimate paths on the new layer:");
  for (const r of controls) console.log(`${r.id.padEnd(4)} | ${r.result.padEnd(7)} | ${r.what}${r.detail ? `  [${r.detail}]` : ""}`);
  const breachedNew = results.new.filter((r) => r.result === "BREACHED");
  const breachedCtl = results.control.filter((r) => r.result === "BREACHED");
  console.log(`\ncontrol: ${breachedCtl.length} of ${ATTACKS.length} attacks breached; new layer: ${breachedNew.length} breached; legitimate paths: ${controls.filter((r) => r.result === "worked").length} of ${controls.length} worked`);
  if (!keep) for (const d of Object.values(dbs)) su(`drop database if exists ${d} with (force)`);
  process.exit(breachedNew.length || controls.some((r) => r.result !== "worked") ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
