/**
 * N9-1 attack battery (owner's order of 2026-11-09, «ثانياً»/4). Runs the round-9 shadowing attacks (T1–T4) and the
 * guard attacks (A6, A6e, B1/B2, B5, G10, reviewer grants, waqf access) with the APPLICATION role against two ISOLATED
 * local copies of the test catalog, built and dropped here:
 *   - «waqfak_shadow_temp»: TEMP still granted (as production is today) — proves the search_path fix on its own;
 *   - «waqfak_shadow_notemp»: TEMP revoked from PUBLIC (the hardening applied to the test databases) — proves both.
 * For every sensitive table read by a guard it creates a temporary table of the same name — empty, and with misleading
 * rows — grants it to PUBLIC, and re-runs every attack: in a fresh connection, after reconnecting, and on a pooled
 * connection on which the shadow was created and committed in an earlier transaction. It also tries to shadow functions.
 *
 * Each attack runs in a transaction that is rolled back. Synthetic accounts only. Local cluster only (sudo -u postgres
 * for building the copies). Usage: npx tsx --conditions=react-server scripts/security/shadow-attacks.ts [--keep-output]
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client, Pool } from "pg";

const appBase = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(appBase.hostname)) throw new Error("local cluster only");
const su = (sqlText: string, db = "postgres") => execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", db, "-c", sqlText], { stdio: ["ignore", "pipe", "pipe"] }).toString();

const ADMIN = "00000000-0000-4000-8000-0000000d0a01";
const ATTACKER = "00000000-0000-4000-8000-0000000d0a02";
const REVIEWER = "00000000-0000-4000-8000-0000000d0a03";
const PENDING = "00000000-0000-4000-8000-0000000d0a04";
const WAQF = "00000000-0000-4000-8000-0000000d0b01";

/** Tables read by a guard or a definer function (from the function bodies), each shadowed in turn. */
const SENSITIVE = ["users", "sessions", "user_roles", "roles", "permissions", "role_permissions", "waqf_memberships", "waqfs", "audit_logs",
  "kb_source_reviews", "kb_sources", "kb_chunks", "ref_match_reviews", "ref_match_runs", "ref_versions", "ref_sources", "fiqh_reviews", "fiqh_dossiers", "outputs"];

type Outcome = "refused" | "breached" | "no-effect" | "setup-failed" | "temp-refused" | "invalid-attack";
type Attack = { id: string; what: string; run: string[]; breached: string };
const sys = `select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`;
const as = (u: string) => `select set_config('app.user_id', '${u}', true), set_config('app.global_access', 'off', true)`;
const ATTACKS: Attack[] = [
  { id: "T1/A6", what: "super_admin granted from the system context while an administrator exists", run: [sys, `insert into public.user_roles (user_id, role_id) select '${ATTACKER}', id from public.roles where key = 'super_admin'`],
    breached: `select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = '${ATTACKER}' and r.key = 'super_admin')` },
  { id: "T2/A6e", what: "outputs.final_approve added to viewer from the system context", run: [sys, `insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.key = 'viewer' and p.key = 'outputs.final_approve' on conflict do nothing`],
    breached: `select exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id where r.key = 'viewer' and p.key = 'outputs.final_approve')` },
  { id: "A6e-b", what: "approvals.direct added to viewer from the system context", run: [sys, `insert into public.role_permissions (role_id, permission_id) select r.id, p.id from public.roles r, public.permissions p where r.key = 'viewer' and p.key = 'approvals.direct' on conflict do nothing`],
    breached: `select exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id join public.permissions p on p.id = rp.permission_id where r.key = 'viewer' and p.key = 'approvals.direct')` },
  { id: "T3/B1", what: "an account without a role changes the administrator's password", run: [as(ATTACKER), `update public.users set password_hash = 'attacker' where id = '${ADMIN}'`],
    breached: `select exists (select 1 from public.users where id = '${ADMIN}' and password_hash = 'attacker')` },
  { id: "B2", what: "an account without a role suspends the administrator and changes the phone", run: [as(ATTACKER), `update public.users set status = 'locked', phone = '0599990000' where id = '${ADMIN}'`],
    breached: `select exists (select 1 from public.users where id = '${ADMIN}' and phone = '0599990000')` },
  { id: "B5", what: "a pending account activates itself", run: [as(PENDING), `update public.users set status = 'active' where id = '${PENDING}'`],
    breached: `select exists (select 1 from public.users where id = '${PENDING}' and status = 'active')` },
  { id: "T4/G10", what: "the review-session guard accepts a session that does not exist", run: [`select set_config('app.session_token', 'attacker-chosen', true)`, as(REVIEWER)],
    breached: `select app_review_session('${REVIEWER}') is not null` },
  { id: "R-grant", what: "reviewer_legal granted from the system context", run: [sys, `insert into public.user_roles (user_id, role_id) select '${ATTACKER}', id from public.roles where key = 'reviewer_legal'`],
    breached: `select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = '${ATTACKER}' and r.key = 'reviewer_legal')` },
  { id: "W-access", what: "an account with no membership is let into a waqf by app_can_access_waqf", run: [as(ATTACKER)],
    breached: `select app_can_access_waqf('${WAQF}')` },
  { id: "H-holds", what: "an account with no role holds admin.users", run: [as(ATTACKER)], breached: `select app_holds('admin.users')` },
];

/** Shadows of one table: an empty one, and one with misleading rows where a row can make an attack pass. */
function shadows(t: string): { kind: string; sql: string[] }[] {
  const empty = [`create temp table ${t} (like public.${t} including defaults)`, `grant all on pg_temp.${t} to public`];
  const out = [{ kind: "empty", sql: empty }];
  const misleading: Record<string, string[]> = {
    user_roles: [`insert into pg_temp.user_roles (user_id, role_id) select '${ATTACKER}', id from public.roles where key = 'super_admin'`],
    sessions: [`insert into pg_temp.sessions (id, user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at, created_at) values (gen_random_uuid(), '${REVIEWER}', 'attacker-chosen', true, now() + interval '1 hour', now() + interval '1 hour', now() - interval '1 minute')`],
    waqf_memberships: [`insert into pg_temp.waqf_memberships (id, waqf_id, user_id, role_key, status) values (gen_random_uuid(), '${WAQF}', '${ATTACKER}', 'nazir', 'active')`],
    users: [`insert into pg_temp.users select * from public.users where id = '${ADMIN}'`, `update pg_temp.users set id = '${ATTACKER}', phone = '0500d0a0ff'`],
  };
  if (misleading[t]) out.push({ kind: "misleading", sql: [...empty, ...misleading[t]] });
  return out;
}

async function attempt(c: Client | import("pg").PoolClient, a: Attack, before: string[]): Promise<{ o: Outcome; detail: string }> {
  await c.query("begin");
  try {
    try { for (const s of before) await c.query(s); } catch (e) { const m = (e as Error).message; return { o: /permission denied to create temporary tables/.test(m) ? "temp-refused" : "setup-failed", detail: m.slice(0, 90) }; }
    for (const s of a.run) await c.query(s);
    const r = await c.query(a.breached);
    const v = Object.values(r.rows[0] ?? {})[0];
    return { o: v === true ? "breached" : "no-effect", detail: "" };
  } catch (e) {
    const m = (e as Error).message;
    // an attack the database could not even parse proves nothing about a guard (N10-8): counted apart, never as refused
    if (/invalid input value|syntax error|does not exist|violates (?:not-null|check) constraint/.test(m) && !/guard|bound identity|permission denied|not allowed|does not (?:change|make)/i.test(m)) return { o: "invalid-attack", detail: m.slice(0, 90) };
    return { o: "refused", detail: m.slice(0, 90) };
  } finally {
    await c.query("rollback").catch(() => {});
  }
}

async function battery(db: string) {
  const url = new URL(appBase.toString());
  url.pathname = `/${db}`;
  const rows: { db: string; mode: string; table: string; shadow: string; attack: string; o: Outcome; detail: string }[] = [];
  const fresh = async () => { const c = new Client({ connectionString: url.toString() }); await c.connect(); return c; };

  // baseline: no shadow (the GUC-trust attacks, A6d/A7…, are measured by the PoC, not here)
  for (const a of ATTACKS) { const c = await fresh(); rows.push({ db, mode: "fresh", table: "-", shadow: "none", attack: a.id, ...(await attempt(c, a, [])) }); await c.end(); }
  // every sensitive table × shadow kind × attack, in a fresh session, inside the attack's transaction
  for (const t of SENSITIVE) for (const s of shadows(t)) for (const a of ATTACKS) {
    const c = await fresh();
    rows.push({ db, mode: "fresh", table: t, shadow: s.kind, attack: a.id, ...(await attempt(c, a, s.sql)) });
    await c.end();
  }
  // all misleading shadows at once, then reconnect and retry (temp tables die with the session)
  const all = SENSITIVE.flatMap((t) => (shadows(t).find((x) => x.kind === "misleading") ?? shadows(t)[0]!).sql);
  for (const a of ATTACKS) { const c = await fresh(); rows.push({ db, mode: "all-shadows", table: "*", shadow: "misleading", attack: a.id, ...(await attempt(c, a, all)) }); await c.end(); }
  // pooled connection: the shadows are created and COMMITTED on a pooled connection, which is then reused
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  {
    const c = await pool.connect();
    try { for (const s of all) await c.query(s); } catch (e) { rows.push({ db, mode: "pooled-setup", table: "*", shadow: "misleading", attack: "-", o: "refused", detail: (e as Error).message.slice(0, 90) }); }
    c.release();
    for (const a of ATTACKS) { const c2 = await pool.connect(); rows.push({ db, mode: "pooled-reuse", table: "*", shadow: "committed", attack: a.id, ...(await attempt(c2, a, [])) }); c2.release(); }
  }
  await pool.end();
  // function shadowing: pg_temp functions are never found implicitly; public is not writable
  for (const [id, s] of [
    ["F1", `create function pg_temp.app_holds(text) returns boolean language sql as 'select true'`],
    ["F2", `create function public.app_holds_x(text) returns boolean language sql as 'select true'`],
    ["F3", `create type pg_temp.role_scope as enum ('global')`],
  ] as const) {
    const c = await fresh();
    const a: Attack = { id, what: "function/type shadow", run: [as(ATTACKER), s], breached: `select app_holds('admin.users')` };
    rows.push({ db, mode: "fresh", table: "(function)", shadow: s.slice(0, 40), attack: id, ...(await attempt(c, a, [])) });
    await c.end();
  }
  return rows;
}

async function build(db: string, temp: boolean) {
  su(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  su(`CREATE DATABASE ${db} TEMPLATE waqfak_ke_test`);
  if (temp) su(`GRANT TEMPORARY ON DATABASE ${db} TO PUBLIC`);
  else su(`REVOKE TEMPORARY ON DATABASE ${db} FROM PUBLIC; GRANT TEMPORARY ON DATABASE ${db} TO waqfak_owner`);
  su(`INSERT INTO users (id, phone, full_name, is_staff, status, password_hash) VALUES
      ('${ADMIN}', '0500d0a001', 'مدير اختبار', true, 'active', 'h-admin'), ('${ATTACKER}', '0500d0a002', 'مهاجم اختبار', true, 'active', null),
      ('${REVIEWER}', '0500d0a003', 'مراجع اختبار', true, 'active', null), ('${PENDING}', '0500d0a004', 'حساب معلق', false, 'pending', null);
      INSERT INTO user_roles (user_id, role_id) SELECT '${ADMIN}', id FROM roles WHERE key = 'super_admin';
      INSERT INTO user_roles (user_id, role_id) SELECT '${REVIEWER}', id FROM roles WHERE key = 'reviewer_legal';
      INSERT INTO waqfs (id, internal_number, name) VALUES ('${WAQF}', 'TEST-SHADOW-1', 'وقف اختبار');`, db);
}

/** --legacy: the functions as they were before the fix (definers «search_path = public», invokers unset), to show the
 * battery does catch the round-9 attacks (a control, run on a TEMP-granted copy only). */
const LEGACY = process.argv.includes("--legacy");
async function main() {
  const out: Awaited<ReturnType<typeof battery>> = [];
  const dbs = LEGACY ? ([["waqfak_shadow_legacy", true]] as const) : ([["waqfak_shadow_temp", true], ["waqfak_shadow_notemp", false]] as const);
  for (const [db, temp] of dbs) {
    await build(db, temp);
    if (LEGACY) su(`DO $$ DECLARE f record; BEGIN FOR f IN SELECT p.oid::regprocedure AS sig, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'public' AND l.lanname IN ('plpgsql','sql') LOOP
      IF f.prosecdef THEN EXECUTE format('ALTER FUNCTION %s SET search_path = public', f.sig); ELSE EXECUTE format('ALTER FUNCTION %s RESET search_path', f.sig); END IF; END LOOP; END $$`, db);
    const url = new URL(appBase.toString()); url.pathname = `/${db}`;
    const c = new Client({ connectionString: url.toString() }); await c.connect();
    const p = await c.query(`select has_database_privilege(current_user, current_database(), 'TEMP') as temp`);
    let canCreate = "yes";
    try { await c.query(`create temp table _probe (x int)`); } catch (e) { canCreate = `no: ${(e as Error).message.slice(0, 60)}`; }
    await c.end();
    console.log(`# ${db}: has TEMP = ${p.rows[0].temp}; create temp table: ${canCreate}`);
    out.push(...(await battery(db)));
    su(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  }
  const breached = out.filter((r) => r.o === "breached");
  const by = (db: string, o: Outcome) => out.filter((r) => r.db === db && r.o === o).length;
  for (const [db] of dbs) console.log(`${db}: ${out.filter((r) => r.db === db).length} attempts — refused ${by(db, "refused")}, no effect ${by(db, "no-effect")}, temp table refused ${by(db, "temp-refused")}, BREACHED ${by(db, "breached")}, setup failed ${by(db, "setup-failed")}, invalid attack ${by(db, "invalid-attack")}`);
  for (const r of breached) console.log(`BREACHED | ${r.db} | ${r.mode} | ${r.table}/${r.shadow} | ${r.attack}`);
  // one line per attack × mode, for the report
  const seen = new Set<string>();
  for (const r of out) { const k = `${r.db}|${r.mode}|${r.attack}`; if (seen.has(k)) continue; seen.add(k); const same = out.filter((x) => `${x.db}|${x.mode}|${x.attack}` === k); console.log(`${r.db} | ${r.mode.padEnd(12)} | ${r.attack.padEnd(8)} | refused ${same.filter((x) => x.o === "refused").length} · no-effect ${same.filter((x) => x.o === "no-effect").length} · breached ${same.filter((x) => x.o === "breached").length} | ${same.find((x) => x.detail)?.detail ?? ""}`); }
  const failed = out.filter((r) => r.o === "setup-failed");
  for (const r of failed.slice(0, 10)) console.log(`SETUP-FAILED | ${r.db} | ${r.mode} | ${r.table}/${r.shadow} | ${r.attack} | ${r.detail}`);
  console.log(`setup failures: ${failed.length}`);
  const invalid = out.filter((r) => r.o === "invalid-attack");
  for (const r of invalid.slice(0, 10)) console.log(`INVALID-ATTACK | ${r.db} | ${r.mode} | ${r.table}/${r.shadow} | ${r.attack} | ${r.detail}`);
  console.log(`invalid attacks: ${invalid.length}`);
  process.exit(breached.length || failed.length || invalid.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
