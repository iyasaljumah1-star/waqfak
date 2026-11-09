/**
 * N9-1 invariants (owner's order of 2026-11-09, «ثانياً»), on the dedicated test database with the APPLICATION role:
 * every function of schema public runs with search_path «pg_catalog, public, pg_temp» (the caller's temporary schema
 * last), the application role cannot create temporary tables or objects in public, and no function shadow is reachable.
 * The full attack battery (every sensitive table shadowed, empty and misleading, fresh / reconnected / pooled, with and
 * without TEMP) is scripts/security/shadow-attacks.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const APP = process.env.KE_TEST_DATABASE_URL;
const enabled = !!APP && /ke_test/.test(APP);

describe.skipIf(!enabled)("database hardening (dedicated test database)", () => {
  let c: Client;
  beforeAll(async () => { c = new Client({ connectionString: APP }); await c.connect(); });
  afterAll(async () => { await c?.end(); });
  const fails = async (q: string) => { try { await c.query(q); return null; } catch (e) { return (e as Error).message; } };

  it("every plpgsql/sql function of schema public has search_path = pg_catalog, public, pg_temp", async () => {
    const r = await c.query(`select p.oid::regprocedure::text as f, p.prosecdef as definer, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang where n.nspname = 'public' and l.lanname in ('plpgsql', 'sql')`);
    expect(r.rows.length).toBeGreaterThan(40);
    const bad = r.rows.filter((x) => !(x.proconfig ?? []).includes("search_path=pg_catalog, public, pg_temp"));
    expect(bad.map((x) => x.f)).toEqual([]);
    expect(r.rows.filter((x) => x.definer).length).toBeGreaterThanOrEqual(22);
  });

  it("the application role holds no TEMPORARY (directly or through PUBLIC or a membership) and cannot create a temporary table", async () => {
    const r = await c.query(`select has_database_privilege(current_user, current_database(), 'TEMP') as temp, has_schema_privilege(current_user, 'public', 'CREATE') as create_public`);
    expect(r.rows[0]).toEqual({ temp: false, create_public: false });
    const via = await c.query(`select r.rolname, has_database_privilege(r.rolname, current_database(), 'TEMP') as temp from pg_auth_members m join pg_roles r on r.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = current_user`);
    expect(via.rows.filter((x) => x.temp)).toEqual([]);
    expect(await fails(`create temp table user_roles (user_id uuid, role_id uuid)`)).toMatch(/permission denied to create temporary tables/);
    expect(await fails(`create function public.app_holds_shadow(text) returns boolean language sql as 'select true'`)).toMatch(/permission denied/);
  });

  it("a function in pg_temp is never found by an unqualified call", async () => {
    // creating one needs TEMP, which is refused; and were it granted, pg_temp is never searched for functions
    expect(await fails(`create function pg_temp.app_holds(text) returns boolean language sql as 'select true'`)).toMatch(/permission denied/);
  });
});
