/**
 * The independent review's adversarial probes, as a permanent suite (tests/knowledge/probes.ts), on the dedicated
 * «ke_test» database; each in a rolled-back transaction. Reviews come from a test account through the reviewers' own
 * path: they test the mechanism, not a human review.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

vi.mock("server-only", () => ({}));

const APP = process.env.KE_TEST_DATABASE_URL;
const enabled = !!APP && /ke_test/.test(APP) && !!process.env.KE_TEST_DATABASE_OWNER_URL;

describe.skipIf(!enabled)("adversarial probes of the knowledge engine (dedicated test database)", () => {
  let app: Pool;
  let schema: typeof import("../src/server/db/schema");
  let probes: typeof import("./knowledge/probes");
  beforeAll(async () => {
    app = new Pool({ connectionString: APP });
    schema = await import("../src/server/db/schema");
    probes = await import("./knowledge/probes");
  });
  afterAll(async () => { await app?.end(); });

  class Rollback extends Error {}
  async function rolledBack<T>(fn: (tx: import("../src/server/db").Tx) => Promise<T>): Promise<T> {
    const db = drizzle(app, { schema, casing: "snake_case" });
    let out: T | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
        out = await fn(tx as unknown as import("../src/server/db").Tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return out as T;
  }

  const IDS = ["R3b", "R1d", "R4b", "R5", "R6", "R6b", "H1", "H3", "Q3", "N2b", "N2c", "A2b", "N5-1", "N5-2", "N5-4", "N5-5", "P1", "P1b", "P1c", "P1d", "P1e", "P1f", "S1", "S2", "S3", "S4", "L1", "L2", "L3", "L4", "L5", "P2", "P2b", "P2c", "P4", "P4d", "B8c", "P5a", "P5b", "P5c", "P5d", "P5e", "P6", "P6b", "P6c", "P6d", "P7", "P7c", "P8", "P9", "P10", "P12", "P13", "A1", "A2", "A3"];
  it("every probe of the review is in the suite", async () => {
    const mod = await import("./knowledge/probes");
    expect(mod.PROBES.map((p) => p.id).sort()).toEqual([...IDS].sort());
  });
  for (const id of IDS) {
    it(`probe ${id}`, async () => {
      const p = probes.PROBES.find((x) => x.id === id)!;
      const r = await rolledBack((tx) => p.run(tx));
      expect(r.pass, `${p.title} — ${p.criterion}: ${JSON.stringify(r.output).slice(0, 600)}`).toBe(true);
    }, 90_000);
  }
});
