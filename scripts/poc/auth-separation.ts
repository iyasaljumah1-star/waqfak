/**
 * PROOF OF CONCEPT runner — owner's order of 2026-11-08 («ثانياً»/1). Builds an ISOLATED local database
 * (waqfak_authpoc, copied from the local test catalog waqfak_ke_test), applies scripts/poc/auth-separation.sql, and runs
 * the attacks of the independent review (R8-1: A6e, A7, A7g, B4, B7, session forging) with the APPLICATION role, then
 * the legitimate path (a session created by the authentication role, bound by the application). Synthetic accounts.
 *
 * Refuses to run against anything but localhost and the database name waqfak_authpoc; it needs the local cluster's
 * superuser through `sudo -u postgres` (the throwaway container cluster). Never touches development, staging or
 * production. Usage: npx tsx --conditions=react-server scripts/poc/auth-separation.ts
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { sessionHash } from "../../src/server/lib/crypto";

const DB = "waqfak_authpoc";
const appUrl = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(appUrl.hostname)) throw new Error("PoC runs on the local cluster only");
appUrl.pathname = `/${DB}`;
const svcUrl = new URL(appUrl.toString());
svcUrl.username = "waqfak_authsvc";
svcUrl.password = "poc-local-only";

const su = (sqlText: string, db = "postgres") => execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", db, "-c", sqlText], { stdio: ["ignore", "pipe", "pipe"] }).toString();

const ADMIN = "00000000-0000-4000-8000-0000000c0a01";
const ATTACKER = "00000000-0000-4000-8000-0000000c0a02";
const TARGET = "00000000-0000-4000-8000-0000000c0a03";

async function main() {
  su(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  su(`CREATE DATABASE ${DB} TEMPLATE waqfak_ke_test`);
  // synthetic accounts, created as the owner (as the seed would), before the PoC
  su(`INSERT INTO users (id, phone, full_name, is_staff, status) VALUES ('${ADMIN}', '0500c0a001', 'مدير اختبار (PoC)', true, 'active'), ('${ATTACKER}', '0500c0a002', 'مهاجم اختبار (PoC)', true, 'active'), ('${TARGET}', '0500c0a003', 'حساب هدف (PoC)', false, 'active');
      INSERT INTO user_roles (user_id, role_id) SELECT '${ADMIN}', id FROM roles WHERE key = 'super_admin';`, DB);
  su(readFileSync(path.join(process.cwd(), "scripts/poc/auth-separation.sql"), "utf8"), DB);

  const app = new Pool({ connectionString: appUrl.toString(), max: 1 });
  const svc = new Pool({ connectionString: svcUrl.toString(), max: 1 });
  const rows: { case: string; expect: "refused" | "allowed"; got: string; ok: boolean }[] = [];
  const run = async (pool: Pool, label: string, expect: "refused" | "allowed", stmts: string[], check?: (r: unknown) => boolean) => {
    const c = await pool.connect();
    let got = "allowed";
    try {
      await c.query("begin");
      let last: unknown;
      for (const s of stmts) last = (await c.query(s)).rows;
      if (check && !check(last)) got = `allowed but ineffective: ${JSON.stringify(last).slice(0, 120)}`;
      await c.query("rollback");
    } catch (e) {
      got = `refused: ${(e as Error).message.slice(0, 140)}`;
      await c.query("rollback").catch(() => {});
    } finally {
      c.release();
    }
    rows.push({ case: label, expect, got, ok: expect === "refused" ? got.startsWith("refused") || got.startsWith("allowed but ineffective") : got === "allowed" });
  };
  const imp = `select set_config('app.user_id', '${ADMIN}', true)`;
  const sys = `select set_config('app.user_id', '', true)`;

  // ── attacks with the application role ──
  await run(app, "A7: app.user_id = the administrator, then grant reviewer_legal", "refused", [imp, `insert into user_roles (user_id, role_id) select '${ATTACKER}', id from roles where key = 'reviewer_legal'`]);
  await run(app, "A7 through the definer function, impersonating by app.user_id", "refused", [imp, `select auth_grant_role('${ATTACKER}', 'reviewer_legal')`]);
  await run(app, "A7g: impersonated administrator grants super_admin", "refused", [imp, `insert into user_roles (user_id, role_id) select '${ATTACKER}', id from roles where key = 'super_admin'`]);
  await run(app, "A6e: system context adds outputs.final_approve to viewer", "refused", [sys, `insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.key = 'viewer' and p.key = 'outputs.final_approve'`]);
  await run(app, "A6e: system context adds approvals.direct to viewer", "refused", [sys, `insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.key = 'viewer' and p.key = 'approvals.direct'`]);
  await run(app, "A6d: system context grants nazara_manager", "refused", [sys, `insert into user_roles (user_id, role_id) select '${ATTACKER}', id from roles where key = 'nazara_manager'`]);
  await run(app, "B4: system context reactivates an account and changes its phone", "refused", [sys, `update users set status = 'active', phone = '0599999999' where id = '${TARGET}'`]);
  await run(app, "B7: impersonated administrator sets another's password", "refused", [imp, `update users set password_hash = 'x' where id = '${TARGET}'`]);
  await run(app, "email of another account (impersonated administrator)", "refused", [imp, `update users set email = 'x@example.invalid' where id = '${TARGET}'`, `select email from users where id = '${TARGET}'`], (r) => (r as { email: string | null }[])[0]?.email === "x@example.invalid");
  await run(app, "email of another account (system context)", "refused", [sys, `update users set email = 'x@example.invalid' where id = '${TARGET}'`, `select email from users where id = '${TARGET}'`], (r) => (r as { email: string | null }[])[0]?.email === "x@example.invalid");
  await run(app, "a session created for another account", "refused", [sys, `insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values ('${ADMIN}', 'forged', true, now() + interval '1 hour', now() + interval '1 hour')`]);
  await run(app, "sessions modified (un-revoke, extend)", "refused", [sys, `update sessions set revoked_at = null, absolute_expires_at = now() + interval '30 days'`]);
  await run(app, "session token hashes read", "refused", [sys, `select token_hash from sessions limit 1`]);
  await run(app, "password hashes read", "refused", [sys, `select password_hash from users limit 1`]);
  await run(app, "the binding table written directly", "refused", [`insert into auth_context (pid, xact, user_id, session_id, mfa) values (pg_backend_pid(), pg_current_xact_id(), '${ADMIN}', gen_random_uuid(), true)`]);
  await run(app, "a guessed token hash bound", "refused", [`select auth_bind('guess') as u`, `select app_current_user() as u`], (r) => (r as { u: string | null }[])[0]?.u === ADMIN);

  // ── the legitimate path: the authentication role creates the session at login; the application binds it ──
  const token = "poc-admin-cookie-value";
  const nomfa = "poc-admin-cookie-nomfa";
  const atk = "poc-attacker-cookie";
  const c = await svc.connect();
  await c.query(`insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values ($1, $2, true, now() + interval '1 hour', now() + interval '1 hour'), ($1, $3, false, now() + interval '1 hour', now() + interval '1 hour'), ($4, $5, true, now() + interval '1 hour', now() + interval '1 hour')`, [ADMIN, sessionHash(token), sessionHash(nomfa), ATTACKER, sessionHash(atk)]);
  const atkSid = (await c.query(`select id from sessions where user_id = $1 limit 1`, [ATTACKER])).rows[0].id as string;
  c.release();
  await run(app, "legit: bound administrator (MFA) grants reviewer_legal to another account", "allowed", [`select auth_bind('${sessionHash(token)}')`, `select auth_grant_role('${TARGET}', 'reviewer_legal')`, `select count(*)::int as n from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = '${TARGET}' and r.key = 'reviewer_legal'`], (r) => (r as { n: number }[])[0]?.n === 1);
  await run(app, "bound administrator WITHOUT the second factor grants a role", "refused", [`select auth_bind('${sessionHash(nomfa)}')`, `select auth_grant_role('${TARGET}', 'reviewer_legal')`]);
  await run(app, "bound administrator grants to themselves", "refused", [`select auth_bind('${sessionHash(token)}')`, `select auth_grant_role('${ADMIN}', 'reviewer_legal')`]);
  await run(app, "binding does not outlive its transaction", "refused", [`select auth_bind('${sessionHash(token)}')`, `commit`, `begin`, `select app_current_user() as u`], (r) => (r as { u: string | null }[])[0]?.u === ADMIN);
  await run(app, "binding is not set by app.user_id", "refused", [imp, `select app_current_user() as u`], (r) => (r as { u: string | null }[])[0]?.u === ADMIN);
  await run(app, "legit: a person edits their own name (bound)", "allowed", [`select auth_bind('${sessionHash(token)}')`, `update users set full_name = 'مدير اختبار (PoC) — اسم معدل' where id = '${ADMIN}'`]);
  await run(app, "bound non-administrator revokes another's session", "refused", [`select auth_bind('${sessionHash(atk)}')`, `select auth_revoke_session((select id from sessions where user_id = '${ADMIN}' limit 1), 'x') as ok`], (r) => (r as { ok: boolean }[])[0]?.ok === true);
  await run(app, "bound non-administrator grants a role", "refused", [`select auth_bind('${sessionHash(atk)}')`, `select auth_grant_role('${TARGET}', 'super_admin')`]);
  await run(app, "legit: a bound person revokes their own session (logout)", "allowed", [`select auth_bind('${sessionHash(atk)}')`, `select auth_revoke_session((select id from sessions where user_id = '${ATTACKER}' limit 1), 'logout') as ok`], (r) => (r as { ok: boolean }[])[0]?.ok === true);
  // (a bound administrator does not even see another's session rows: RLS sessions_own; the id comes from the admin view)
  await run(app, "legit: bound administrator revokes another's session", "allowed", [`select auth_bind('${sessionHash(token)}')`, `select auth_revoke_session('${atkSid}', 'admin') as ok`], (r) => (r as { ok: boolean }[])[0]?.ok === true);

  await app.end();
  await svc.end();
  su(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"} | ${r.expect.padEnd(7)} | ${r.case} | ${r.got}`);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} as designed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
