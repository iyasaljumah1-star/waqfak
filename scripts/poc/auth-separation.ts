/**
 * PROOF OF CONCEPT runner, version 2 (owner's order of 2026-11-09, «ثانياً»/5 — N9-1c). Builds an ISOLATED local
 * database (waqfak_authpoc, copied from the local test catalog waqfak_ke_test), applies the current security.sql state
 * (already in the template) plus scripts/poc/auth-separation.sql, and runs every attack of rounds 8 and 9 — A6, A6d,
 * A6e, A7, A7g, B4, B7, C1b, X1–X5, shadowing of every table the auth functions read — with the APPLICATION role, then
 * the legitimate paths. Twice: with TEMPORARY still granted to the application (so that the result does not rest on its
 * revocation) and with it revoked. Synthetic accounts. Local cluster only; the database is dropped at the end.
 *
 * Usage: npx tsx --conditions=react-server scripts/poc/auth-separation.ts
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { sessionHash } from "../../src/server/lib/crypto";

const DB = "waqfak_authpoc";
const base = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("PoC runs on the local cluster only");
const urlFor = (user: string, password: string) => { const u = new URL(base.toString()); u.pathname = `/${DB}`; u.username = user; u.password = password; return u.toString(); };
const appUrl = (() => { const u = new URL(base.toString()); u.pathname = `/${DB}`; return u.toString(); })();
const svcUrl = urlFor("waqfak_authsvc", "poc-local-only");
const sysUrl = urlFor("waqfak_system", "poc-local-only-system");
const su = (sqlText: string, db = "postgres") => execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", db, "-c", sqlText], { stdio: ["ignore", "pipe", "pipe"] }).toString();

const ADMIN = "00000000-0000-4000-8000-0000000c0a01";
const ATTACKER = "00000000-0000-4000-8000-0000000c0a02";
const TARGET = "00000000-0000-4000-8000-0000000c0a03";
const MEMBER = "00000000-0000-4000-8000-0000000c0a04";
const GLOBAL = "00000000-0000-4000-8000-0000000c0a05";
const LOCKED = "00000000-0000-4000-8000-0000000c0a06";
const W1 = "00000000-0000-4000-8000-0000000c0b01";
const W2 = "00000000-0000-4000-8000-0000000c0b02";
const DOC = "00000000-0000-4000-8000-0000000c0c01";
const T = { admin: "poc-admin", nomfa: "poc-admin-nomfa", atk: "poc-attacker", member: "poc-member", global: "poc-global", target: "poc-target" };

type Row = { variant: string; id: string; case: string; expect: "refused" | "allowed"; got: string; ok: boolean };

async function build(temp: boolean) {
  su(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  su(`CREATE DATABASE ${DB} TEMPLATE waqfak_ke_test`);
  if (temp) su(`GRANT TEMPORARY ON DATABASE ${DB} TO PUBLIC`);
  else su(`REVOKE TEMPORARY ON DATABASE ${DB} FROM PUBLIC; GRANT TEMPORARY ON DATABASE ${DB} TO waqfak_owner`);
  su(`INSERT INTO users (id, phone, full_name, is_staff, status, password_hash, locked_until) VALUES
      ('${ADMIN}', '0500c0a001', 'مدير اختبار (PoC)', true, 'active', 'h-admin', null), ('${ATTACKER}', '0500c0a002', 'مهاجم اختبار (PoC)', true, 'active', null, null),
      ('${TARGET}', '0500c0a003', 'حساب هدف (PoC)', false, 'active', 'h-target', null), ('${MEMBER}', '0500c0a004', 'عضو وقف (PoC)', false, 'active', null, null),
      ('${GLOBAL}', '0500c0a005', 'مدير تشغيل (PoC)', true, 'active', null, null), ('${LOCKED}', '0500c0a006', 'حساب مقفل (PoC)', false, 'locked', null, now() + interval '1 day');
      INSERT INTO user_roles (user_id, role_id) SELECT '${ADMIN}', id FROM roles WHERE key = 'super_admin';
      INSERT INTO user_roles (user_id, role_id) SELECT '${GLOBAL}', id FROM roles WHERE key = 'ops_manager';
      INSERT INTO waqfs (id, internal_number, name) VALUES ('${W1}', 'POC-1', 'وقف اختبار أول'), ('${W2}', 'POC-2', 'وقف اختبار ثان');
      INSERT INTO waqf_memberships (waqf_id, user_id, role_key, status) VALUES ('${W1}', '${MEMBER}', 'nazir', 'active'), ('${W2}', '${TARGET}', 'nazir', 'active');
      INSERT INTO documents (id, waqf_id, owner_user_id, doc_type, title, confidentiality) VALUES ('${DOC}', '${W2}', '${TARGET}', 'other', 'مستند سري لوقف آخر', 'secret');
      INSERT INTO document_shares (document_id, waqf_id, token_hash, created_by, expires_at, max_uses) VALUES ('${DOC}', '${W2}', 'poc-share-lookup', '${TARGET}', now() + interval '1 day', 3);`, DB);
  su(readFileSync(path.join(process.cwd(), "scripts/poc/auth-separation.sql"), "utf8"), DB);
  const svc = new Client({ connectionString: svcUrl }); await svc.connect();
  for (const [u, tok, mfa] of [[ADMIN, T.admin, true], [ADMIN, T.nomfa, false], [ATTACKER, T.atk, true], [MEMBER, T.member, true], [GLOBAL, T.global, true], [TARGET, T.target, true]] as const)
    await svc.query(`insert into public.sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values ($1, $2, $3, now() + interval '1 hour', now() + interval '1 hour')`, [u, sessionHash(tok), mfa]);
  const ids = Object.fromEntries((await svc.query(`select user_id, id from public.sessions`)).rows.map((r) => [r.user_id, r.id]));
  await svc.end();
  return ids as Record<string, string>;
}

async function variant(name: string, temp: boolean): Promise<Row[]> {
  const sid = await build(temp);
  const rows: Row[] = [];
  const pool = new Pool({ connectionString: appUrl, max: 1 });
  const run = async (conn: "app" | "sys" | "pool", id: string, label: string, expect: "refused" | "allowed", stmts: string[], effective?: (r: unknown) => boolean) => {
    const c: Client | import("pg").PoolClient = conn === "pool" ? await pool.connect() : new Client({ connectionString: conn === "sys" ? sysUrl : appUrl });
    if (!(c as { release?: unknown }).release) await (c as Client).connect();
    let got = "allowed";
    try {
      await c.query("begin");
      let last: unknown;
      for (const s of stmts) last = (await c.query(s)).rows;
      if (effective && !effective(last)) got = `ineffective: ${JSON.stringify(last).slice(0, 100)}`;
      await c.query("rollback");
    } catch (e) {
      got = `refused: ${(e as Error).message.slice(0, 120)}`;
      await c.query("rollback").catch(() => {});
    } finally {
      if ((c as { release?: () => void }).release) (c as import("pg").PoolClient).release(); else await (c as Client).end();
    }
    rows.push({ variant: name, id, case: label, expect, got, ok: expect === "refused" ? !got.startsWith("allowed") : got === "allowed" });
  };
  const imp = `select set_config('app.user_id', '${ADMIN}', true)`;
  const sys = `select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`;
  const bind = (tok: string) => `select auth_bind('${sessionHash(tok)}')`;
  const holds = (u: string, role: string) => `select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = '${u}' and r.key = '${role}') as v`;
  const isTrue = (r: unknown) => (r as { v: boolean }[])[0]?.v === true;

  // ── impersonation and grants ──
  await run("app", "A7", "app.user_id = the administrator, then grant reviewer_legal", "refused", [imp, `insert into user_roles (user_id, role_id) select '${ATTACKER}', id from roles where key = 'reviewer_legal'`]);
  await run("app", "A7-fn", "impersonation through the definer function", "refused", [imp, `select auth_grant_role('${ATTACKER}', 'reviewer_legal')`]);
  await run("app", "A7g", "impersonated administrator grants super_admin", "refused", [imp, `insert into user_roles (user_id, role_id) select '${ATTACKER}', id from roles where key = 'super_admin'`]);
  await run("app", "A6", "system context grants super_admin", "refused", [sys, `insert into user_roles (user_id, role_id) select '${ATTACKER}', id from roles where key = 'super_admin'`]);
  for (const role of ["reviewer_sharia", "reviewer_legal", "nazara_manager"])
    await run("app", `A6d-${role}`, `system context grants ${role}`, "refused", [sys, `insert into user_roles (user_id, role_id) select '${ATTACKER}', id from roles where key = '${role}'`]);
  for (const perm of ["outputs.final_approve", "approvals.direct"]) {
    await run("app", `A6e-${perm}`, `system context adds ${perm} to viewer`, "refused", [sys, `insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.key = 'viewer' and p.key = '${perm}'`]);
    await run("app", `A6e-bound-${perm}`, `bound administrator adds ${perm} to viewer directly`, "refused", [bind(T.admin), `insert into role_permissions (role_id, permission_id) select r.id, p.id from roles r, permissions p where r.key = 'viewer' and p.key = '${perm}'`]);
  }
  await run("app", "A7-nonadmin", "bound non-administrator grants a role through the function", "refused", [bind(T.atk), `select auth_grant_role('${TARGET}', 'super_admin')`]);
  await run("app", "A7-nomfa", "bound administrator without the second factor grants a role", "refused", [bind(T.nomfa), `select auth_grant_role('${TARGET}', 'reviewer_legal')`]);
  await run("app", "A7-self", "bound administrator grants to themselves", "refused", [bind(T.admin), `select auth_grant_role('${ADMIN}', 'reviewer_legal')`]);
  // ── memberships, waqf and document data ──
  await run("app", "X3", "system context makes the attacker nazir of a waqf", "refused", [sys, `insert into waqf_memberships (waqf_id, user_id, role_key) values ('${W2}', '${ATTACKER}', 'nazir')`]);
  await run("app", "X3-bound", "bound non-member makes themselves nazir of a waqf that has members", "refused", [bind(T.atk), `insert into waqf_memberships (waqf_id, user_id, role_key) values ('${W2}', '${ATTACKER}', 'nazir')`]);
  await run("app", "X3b", "system context reads every waqf and document", "refused", [sys, `select (select count(*)::int from waqfs) as w, (select count(*)::int from documents) as d`]);
  await run("app", "X3b-bound", "bound member of waqf 1 reads waqf 2 and its secret document", "refused", [bind(T.member), `select (select count(*)::int from waqfs where id = '${W2}') + (select count(*)::int from documents where id = '${DOC}') as v`], (r) => (r as { v: number }[])[0]?.v > 0);
  await run("app", "X5", "app.global_access = on (bound non-global person) reads waqf 2", "refused", [bind(T.member), `select set_config('app.global_access', 'on', true)`, `select count(*)::int as v from waqfs where id = '${W2}'`], (r) => (r as { v: number }[])[0]?.v > 0);
  await run("app", "X5b", "app.global_access = on, nothing bound: app_has_global_access()", "refused", [`select set_config('app.global_access', 'on', true)`, `select app_has_global_access() as v`], isTrue);
  // ── accounts and sessions ──
  await run("app", "X4", "system context deletes an account", "refused", [sys, `delete from users where id = '${TARGET}'`]);
  await run("app", "X4-bound", "bound administrator deletes an account directly", "refused", [bind(T.admin), `delete from users where id = '${TARGET}'`]);
  await run("app", "X4-fn-nonadmin", "bound non-administrator deletes an account through the function", "refused", [bind(T.atk), `select auth_delete_user('${TARGET}')`]);
  await run("app", "B4", "system context reactivates a locked account and changes its phone", "refused", [sys, `update users set status = 'active', locked_until = null, phone = '0599999999' where id = '${LOCKED}'`]);
  await run("app", "B4-bound", "bound administrator reactivates a locked account directly", "refused", [bind(T.admin), `update users set status = 'active', locked_until = null where id = '${LOCKED}'`]);
  await run("app", "B7", "impersonated administrator sets another's password", "refused", [imp, `update users set password_hash = 'x' where id = '${TARGET}'`]);
  await run("app", "B7-bound", "bound administrator sets another's password directly", "refused", [bind(T.admin), `update users set password_hash = 'x' where id = '${TARGET}'`]);
  await run("app", "B1", "bound non-administrator changes another's e-mail", "refused", [bind(T.atk), `update users set email = 'x@example.invalid' where id = '${TARGET}'`, `select email = 'x@example.invalid' as v from users where id = '${TARGET}'`], isTrue);
  await run("app", "B1-sys", "system context changes an e-mail", "refused", [sys, `update users set email = 'x@example.invalid' where id = '${TARGET}'`]);
  await run("app", "C1b", "a session created for another account", "refused", [sys, `insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values ('${ADMIN}', 'forged', true, now() + interval '1 hour', now() + interval '1 hour')`]);
  await run("app", "C1c", "sessions modified (un-revoke, extend)", "refused", [bind(T.atk), `update sessions set revoked_at = null, absolute_expires_at = now() + interval '30 days'`]);
  await run("app", "C1d", "session token hashes read", "refused", [bind(T.atk), `select token_hash from sessions limit 1`]);
  await run("app", "C1e", "password hashes read", "refused", [bind(T.atk), `select password_hash from users limit 1`]);
  await run("app", "C1f", "a bound person revokes another's session", "refused", [bind(T.atk), `select auth_revoke_session('${sid[ADMIN]}', 'x') as v`], isTrue);
  for (const t of ["mfa_factors", "recovery_codes", "otp_challenges"]) {
    await run("app", `M-read-${t}`, `${t} read (bound attacker)`, "refused", [bind(T.atk), `select count(*) from ${t}`]);
    await run("app", `M-write-${t}`, `${t} emptied for the administrator (system context)`, "refused", [sys, `delete from ${t}`]);
  }
  // ── the binding itself ──
  await run("app", "X0", "the binding table is written directly", "refused", [`insert into auth.context (pid, xact, user_id, session_id, mfa) values (pg_backend_pid(), pg_current_xact_id(), '${ADMIN}', gen_random_uuid(), true)`]);
  await run("app", "X0b", "a guessed token hash binds", "refused", [`select auth_bind('guess') as u`, `select app_current_user() = '${ADMIN}' as v`], isTrue);
  await run("app", "X0c", "binding set by app.user_id", "refused", [imp, `select app_current_user() = '${ADMIN}' as v`], isTrue);
  await run("pool", "X0d-setup", "pooled connection: bind and COMMIT (setup)", "allowed", [bind(T.admin)]);
  await run("pool", "X0d", "pooled connection reused: the earlier binding does not carry over", "refused", [`select app_current_user() = '${ADMIN}' as v`], isTrue);
  // ── shadowing (only possible in the TEMP-granted variant) ──
  const shadowCtx = [`create temp table context (pid integer, xact xid8, user_id uuid, session_id uuid, mfa boolean)`, `grant all on pg_temp.context to public`, `insert into pg_temp.context values (pg_backend_pid(), pg_current_xact_id(), '${ADMIN}', gen_random_uuid(), true)`];
  await run("app", "X1", "temporary «context» / «auth_context» with the administrator, then grant super_admin", "refused", [...shadowCtx, `create temp table auth_context (like pg_temp.context)`, `insert into pg_temp.auth_context select * from pg_temp.context`, `select auth_grant_role('${ATTACKER}', 'super_admin')`]);
  await run("app", "X1b", "temporary «context»: app_current_user() returns the administrator?", "refused", [...shadowCtx, `select app_current_user() = '${ADMIN}' as v`], isTrue);
  await run("app", "X2", "temporary sessions/users: auth_bind('anything') binds the administrator", "refused", [
    // explicit columns (LIKE public.sessions would need the token_hash column, which is no longer readable)
    `create temp table sessions (id uuid default gen_random_uuid(), user_id uuid, token_hash text, mfa_verified boolean, revoked_at timestamptz, idle_expires_at timestamptz, absolute_expires_at timestamptz)`,
    `create temp table users (id uuid, status text, locked_until timestamptz)`, `grant all on pg_temp.sessions, pg_temp.users to public`,
    `insert into pg_temp.sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values ('${ADMIN}', 'anything', true, now() + interval '1 hour', now() + interval '1 hour')`,
    `insert into pg_temp.users (id, status) values ('${ADMIN}', 'active')`,
    `select auth_bind('anything')`, `select app_current_user() = '${ADMIN}' as v`], isTrue);
  for (const t of ["user_roles", "roles", "role_permissions", "permissions", "global_roles", "waqf_memberships", "users"])
    await run("app", `X2-${t}`, `temporary «${t}» shadow, bound attacker: global access / admin.roles`, "refused", [
      `create temp table ${t} (role_key text, user_id uuid, role_id uuid, id uuid, key text, permission_id uuid, waqf_id uuid, status text, locked_until timestamptz, is_staff boolean)`, `grant all on pg_temp.${t} to public`,
      `insert into pg_temp.${t} (role_key, user_id, role_id, id, key, status, waqf_id) select 'super_admin', '${ATTACKER}', r.id, r.id, 'super_admin', 'active', '${W2}' from public.roles r where r.key = 'super_admin'`,
      bind(T.atk), `select (app_has_global_access() or app_holds('admin.roles') or app_can_access_waqf('${W2}')) as v`], isTrue);
  // ── the system role ──
  await run("sys", "S1", "system role reads waqfs directly", "refused", [`select count(*) from public.waqfs`]);
  await run("sys", "S2", "system role inserts a membership", "refused", [`insert into public.waqf_memberships (waqf_id, user_id, role_key) values ('${W2}', '${ATTACKER}', 'nazir')`]);
  await run("sys", "S3", "system role reads sessions", "refused", [`select token_hash from public.sessions limit 1`]);
  await run("sys", "S4", "system role grants a role", "refused", [`select auth_grant_role('${ATTACKER}', 'super_admin')`]);
  // ── legitimate paths ──
  await run("app", "L1", "bound administrator (MFA) grants reviewer_legal to another", "allowed", [bind(T.admin), `select auth_grant_role('${TARGET}', 'reviewer_legal')`, holds(TARGET, "reviewer_legal")], isTrue);
  await run("app", "L2", "bound member reads their own waqf", "allowed", [bind(T.member), `select count(*)::int = 1 as v from waqfs where id = '${W1}'`], isTrue);
  await run("app", "L3", "bound global role (ops_manager) reads every waqf", "allowed", [bind(T.global), `select count(*)::int >= 2 as v from waqfs where id in ('${W1}', '${W2}')`], isTrue);
  await run("app", "L4", "bound person edits their own name", "allowed", [bind(T.atk), `update users set full_name = 'اسم معدل' where id = '${ATTACKER}'`, `select full_name = 'اسم معدل' as v from users where id = '${ATTACKER}'`], isTrue);
  await run("app", "L5", "bound person revokes their own session (logout)", "allowed", [bind(T.atk), `select auth_revoke_session('${sid[ATTACKER]}', 'logout') as v`], isTrue);
  await run("app", "L6", "bound administrator revokes another's session", "allowed", [bind(T.admin), `select auth_revoke_session('${sid[ATTACKER]}', 'admin') as v`], isTrue);
  await run("app", "L7", "bound administrator (MFA) deletes an account through the function", "allowed", [bind(T.admin), `select auth_delete_user('${LOCKED}') as v`], isTrue);
  await run("sys", "L8", "system role views one share through its function", "allowed", [`select count(*)::int = 1 as v from sys_view_share('poc-share-lookup')`], isTrue);
  await pool.end();
  su(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  return rows;
}

async function main() {
  const rows = [...(await variant("TEMP granted", true)), ...(await variant("TEMP revoked", false))];
  for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"} | ${r.variant.padEnd(12)} | ${r.id.padEnd(24)} | ${r.expect.padEnd(7)} | ${r.case} | ${r.got}`);
  const failed = rows.filter((r) => !r.ok && r.id !== "X0d-setup").length;
  console.log(`\n${rows.length - failed}/${rows.length} as designed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); try { su(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); } catch { /* */ } process.exit(1); });
