/**
 * Stage 11 (owner's decision of 2026-11-12, «أولاً»/1) on the development database: the application role names nobody
 * (it binds a live session), cannot be the system, and creates no account, role grant or session; the authentication
 * login can; the system login cannot either. Synthetic accounts only, created by the authentication login and removed
 * at the end. The full attack battery with its control is scripts/security/role-attacks.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

vi.mock("server-only", () => ({}));

const APP = process.env.DATABASE_URL;
const AUTH = process.env.AUTH_DATABASE_URL;
const SYS = process.env.SYSTEM_DATABASE_URL;
const OWNER = process.env.DATABASE_OWNER_URL;
const enabled = !!APP && !!AUTH && !!SYS && !!OWNER && /waqfak_dev/.test(APP);
const sessionHash = (token: string) => createHmac("sha256", Buffer.from(process.env.HASH_KEY ?? "", "base64")).update(`session|${token}`).digest("base64url");

describe.skipIf(!enabled)("stage 11: authentication, system and application roles (development database)", () => {
  const ID = "00000000-0000-4000-8000-0000000f1101";
  const token = `stage11-test-${randomBytes(8).toString("hex")}`;
  let app: Client, auth: Client, sys: Client;
  const tryQ = async (c: Client, q: string, p: unknown[] = []) => {
    await c.query("savepoint s");
    try {
      const r = await c.query(q, p);
      await c.query("release savepoint s");
      return { ok: true as const, r };
    } catch (e) {
      await c.query("rollback to savepoint s");
      return { ok: false as const, err: String((e as Error).message) };
    }
  };
  beforeAll(async () => {
    app = new Client({ connectionString: APP }); auth = new Client({ connectionString: AUTH }); sys = new Client({ connectionString: SYS });
    await Promise.all([app.connect(), auth.connect(), sys.connect()]);
    // the authentication login creates the account and its session, as sign-in does
    await auth.query(`insert into users (id, phone, full_name, status) values ($1, '0500f11101', 'حساب اختبار المرحلة 11', 'active') on conflict (id) do nothing`, [ID]);
    await auth.query(`insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values ($1, $2, true, now() + interval '1 hour', now() + interval '1 hour')`, [ID, sessionHash(token)]);
  });
  afterAll(async () => {
    const o = new Client({ connectionString: OWNER });
    await o.connect();
    await o.query(`delete from sessions where user_id = $1`, [ID]);
    await o.query(`delete from users where id = $1`, [ID]).catch(() => o.query(`update users set status = 'deleted' where id = $1`, [ID]));
    await o.end();
    await Promise.all([app?.end(), auth?.end(), sys?.end()]);
  });

  it("the catalog's global roles are the database's (auth.global_roles = authz/catalog globalAccess)", async () => {
    const { ROLES } = await import("../src/server/authz/catalog");
    const o = new Client({ connectionString: OWNER });
    await o.connect();
    const db = (await o.query(`select role_key from auth.global_roles order by 1`)).rows.map((r) => r.role_key);
    await o.end();
    const code = Object.entries(ROLES).filter(([, d]) => (d as { globalAccess?: boolean }).globalAccess).map(([k]) => k).sort();
    expect(db).toEqual(code);
  });

  it("the application role ignores declared identities: no person, no global access, never the system", async () => {
    await app.query("begin");
    try {
      await app.query(`select set_config('app.user_id', $1, true), set_config('app.global_access', 'on', true)`, [ID]);
      const r = (await app.query(`select app_current_user() as u, app_has_global_access() as g, app_is_system() as s`)).rows[0];
      expect(r).toEqual({ u: null, g: false, s: false });
    } finally { await app.query("rollback"); }
  });

  it("the application role binds a live session for one transaction only; a wrong hash binds nobody", async () => {
    await app.query("begin");
    const bound = (await app.query(`select auth_bind($1) as u`, [sessionHash(token)])).rows[0].u;
    const me = (await app.query(`select app_current_user() as u`)).rows[0].u;
    await app.query("commit");
    await app.query("begin");
    const after = (await app.query(`select app_current_user() as u`)).rows[0].u;
    const wrong = (await app.query(`select auth_bind($1) as u`, [sessionHash("not-" + token)])).rows[0].u;
    await app.query("rollback");
    expect([bound, me, after, wrong]).toEqual([ID, ID, null, null]);
  });

  it("the application role creates no account, grants no role, makes no session and reads no token hash or second factor", async () => {
    await app.query("begin");
    try {
      await app.query(`select auth_bind($1)`, [sessionHash(token)]);
      const out = {
        user: await tryQ(app, `insert into users (phone, full_name) values ('0500f111ff', 'x')`),
        role: await tryQ(app, `insert into user_roles (user_id, role_id) select $1, id from roles where key = 'super_admin'`, [ID]),
        session: await tryQ(app, `insert into sessions (user_id, token_hash, idle_expires_at, absolute_expires_at) values ($1, 'x', now(), now())`, [ID]),
        hash: await tryQ(app, `select token_hash from sessions limit 1`),
        mfa: await tryQ(app, `select * from mfa_factors limit 1`),
        role2: await tryQ(app, `select set_config('app.user_id', '', true); set local role waqfak_system`),
      };
      for (const [k, v] of Object.entries(out)) expect(v.ok, k).toBe(false);
      // its own name it may change (a profile column)
      expect((await tryQ(app, `update users set full_name = 'اسم آخر' where id = $1`, [ID])).ok).toBe(true);
    } finally { await app.query("rollback"); }
  });

  it("the system login cannot create accounts or sessions either; the authentication login can", async () => {
    await sys.query("begin"); await auth.query("begin");
    try {
      expect((await tryQ(sys, `insert into users (phone, full_name) values ('0500f111fe', 'x')`)).ok).toBe(false);
      expect((await tryQ(sys, `insert into sessions (user_id, token_hash, idle_expires_at, absolute_expires_at) values ($1, 'x', now(), now())`, [ID])).ok).toBe(false);
      expect((await tryQ(auth, `insert into users (phone, full_name) values ('0500f111fd', 'x')`)).ok).toBe(true);
      // the authentication login reads no waqf data
      expect((await tryQ(auth, `select count(*) from waqfs`)).ok).toBe(false);
    } finally { await sys.query("rollback"); await auth.query("rollback"); }
  });

  it("asSystem refuses on the application's connection (no step believes itself elevated)", async () => {
    const { asSystem } = await import("../src/server/db/as-system");
    const schema = await import("../src/server/db/schema");
    const c = new Client({ connectionString: APP });
    await c.connect();
    const d = drizzle(c, { schema, casing: "snake_case" });
    await expect(d.transaction((tx) => asSystem(tx as never, async () => 1))).rejects.toThrow(/not available on the application's connection/);
    await c.end();
  });
});
