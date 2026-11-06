/**
 * Reference registry against a real PostgreSQL database with the project's migrations and security.sql applied.
 * Runs only when REFS_TEST_DATABASE_OWNER_URL and REFS_TEST_DATABASE_URL point to a dedicated test database
 * (never the development or production database). Synthetic reference codes only.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

vi.mock("server-only", () => ({}));

const OWNER = process.env.REFS_TEST_DATABASE_OWNER_URL;
const APP = process.env.REFS_TEST_DATABASE_URL;
const enabled = !!OWNER && !!APP && /refs_test/.test(OWNER) && /refs_test/.test(APP);

describe.skipIf(!enabled)("reference registry (dedicated test database)", () => {
  let owner: Pool;
  let app: Pool;
  let schema: typeof import("../src/server/db/schema");
  let store: typeof import("../src/server/references/db-store");
  let reg: typeof import("../src/server/references/registry");
  let snaps: typeof import("../src/server/references/snapshots");
  let seg: typeof import("../src/server/references/segment");
  let ver: typeof import("../src/server/references/versions");

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    app = new Pool({ connectionString: APP });
    schema = await import("../src/server/db/schema");
    store = await import("../src/server/references/db-store");
    reg = await import("../src/server/references/registry");
    snaps = await import("../src/server/references/snapshots");
    seg = await import("../src/server/references/segment");
    ver = await import("../src/server/references/versions");
  });
  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  class Rollback extends Error {}
  /** Runs fn as the application role in the system context, then rolls back. */
  async function asSystemRolledBack(fn: (tx: import("../src/server/db").Tx) => Promise<void>) {
    const db = drizzle(app, { schema, casing: "snake_case" });
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
        await fn(tx as unknown as import("../src/server/db").Tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  }

  const synthetic = (id: string, effectiveFrom: string, text: string) => ({
    id,
    refId: "SYN-TEST",
    label: id,
    effectiveFrom,
    source: { url: "https://www.uqn.gov.sa/details?p=0", retrievedAt: "2026-11-06T00:00:00Z", via: "relay_scrape" as const, sha256: ver.sha256(text), directConfirmed: false },
    text,
    units: seg.toUnits(seg.segment(text)),
    createdAt: "2026-11-06T00:00:00Z",
  });
  const T1 = "**المادة الأولى:**\n\n1- يجب التسجيل خلال ثلاثين يوم عمل.\n";
  const T2 = "**المادة الأولى:**\n\n1- يجب التسجيل خلال ستين يوم عمل.\n";

  it("stores the registry, the official Nazara text with its units, and answers the version in force on a date", async () => {
    await asSystemRolledBack(async (tx) => {
      const nzr = reg.getEntry("NZR")!;
      const sid = await store.registerSource(tx, nzr);
      const v = snaps.versionFromSnapshot(snaps.loadManifest().find((m) => m.id === "NZR/uqn-p18926")!, "2022-02-04", "أم القرى 1443/7/3هـ");
      const vid = await store.appendVersion(tx, sid, v);
      expect(await store.appendVersion(tx, sid, v)).toBe(vid); // same text stored once
      const units = await tx.execute<{ n: string }>(sql`select count(*)::text as n from ref_units where version_id = ${vid}`);
      expect(Number(units.rows[0]!.n)).toBe(v.units.length);
      const at = await store.versionAt(tx, "NZR", "2026-11-06");
      expect(at).toMatchObject({ id: vid, effectiveFrom: "2022-02-04", sourceUrl: "https://www.uqn.gov.sa/details?p=18926" });
      expect(await store.versionAt(tx, "NZR", "2021-01-01")).toBeNull();

      const syn = { ...nzr, id: "SYN-TEST", officialName: "مرجع اختباري" };
      const synId = await store.registerSource(tx, syn);
      const a = await store.appendVersion(tx, synId, synthetic("a", "2022-01-01", T1));
      const b = await store.appendVersion(tx, synId, synthetic("b", "2025-01-01", T2));
      expect((await store.versionAt(tx, "SYN-TEST", "2023-06-01"))!.id).toBe(a);
      expect((await store.versionAt(tx, "SYN-TEST", "2026-01-01"))!.id).toBe(b);

      const run = await store.appendMatchRun(tx, vid, { id: "r", versionId: vid, candidateLabel: "c", candidateSha256: "s", outcome: "extraction_defective", perArticle: { م1: "extraction_defective" }, ranAt: "2026-11-06T00:00:00Z" }, { note: "test" });
      await store.appendReview(tx, run, { reviewer: "x", reviewerUserId: "00000000-0000-4000-8000-000000000001", at: "2026-11-06T00:00:00Z", decision: "rejected", note: "test" });
      await store.appendFetchAttempt(tx, { refId: "GAA-LAW", url: "https://laws.boe.gov.sa/x", at: "2026-11-06T00:00:00Z", ok: false, via: "relay_scrape", failure: { kind: "access_blocked", detail: "test" } });
    });
  });

  it("refuses to update, delete or truncate stored versions, units, runs, reviews and attempts — even as the owner", async () => {
    const c = await owner.connect();
    try {
      await c.query("begin");
      const s = await c.query(`insert into ref_sources (code, official_name, kind, binding, status_recorded, facts, candidate_services) values ('SYN-TEST-2','x','regulation','binding','unknown','{}','{}') returning id`);
      const v = await c.query(`insert into ref_versions (source_id, label, effective_from, source_url, retrieved_at, via, sha256, text) values ($1,'v','2022-01-01','https://www.uqn.gov.sa/details?p=0',now(),'relay_scrape','h','t') returning id`, [s.rows[0].id]);
      await c.query(`insert into ref_units (version_id, locator, article, text) values ($1,'م1',1,'t')`, [v.rows[0].id]);
      for (const stmt of [`update ref_versions set text = 'changed' where id = '${v.rows[0].id}'`, `delete from ref_versions where id = '${v.rows[0].id}'`, `update ref_units set text = 'x'`, `delete from ref_units`, `truncate ref_match_runs cascade`, `truncate ref_versions cascade`]) {
        await c.query("savepoint sp");
        await expect(c.query(stmt)).rejects.toThrow(/append-only/);
        await c.query("rollback to savepoint sp");
      }
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("closes the tables to user contexts: a signed-in user reads nothing and writes nothing", async () => {
    const c = await app.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.global_access','on',true)`);
      await c.query(`insert into ref_sources (code, official_name, kind, binding, status_recorded, facts, candidate_services) values ('SYN-RLS','x','regulation','binding','unknown','{}','{}')`);
      await c.query(`select set_config('app.user_id','00000000-0000-4000-8000-000000000002',true), set_config('app.global_access','off',true)`);
      const r = await c.query(`select count(*)::int as n from ref_sources`);
      expect(r.rows[0].n).toBe(0);
      await c.query("savepoint sp");
      await expect(c.query(`insert into ref_sources (code, official_name, kind, binding, status_recorded, facts, candidate_services) values ('SYN-RLS-2','x','regulation','binding','unknown','{}','{}')`)).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint sp");
      await expect(c.query(`update ref_versions set text = 'x'`)).rejects.toThrow(/permission denied/);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
