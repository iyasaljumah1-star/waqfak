/**
 * Stage 11.1 (S11-19): the step a client's approval defers to after its commit has a sweep in the daily job, and the
 * sweep is idempotent (a second run adds nothing). Development database, system login, rolled back by hand: the sweep
 * runs inside one system transaction that is aborted at the end.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const enabled = !!process.env.SYSTEM_DATABASE_URL && /waqfak_dev/.test(process.env.DATABASE_URL ?? "");

describe.skipIf(!enabled)("stage 11.1 S11-19 — the deferred step has its sweep", () => {
  it("the daily job runs the sweep, and a second run within the same state adds nothing", async () => {
    const { DAILY_STEPS } = await import("../src/server/modules/compliance/jobs");
    expect(DAILY_STEPS.map((s) => s.name)).toContain("dueInstallmentsSweep");
    const { withSystem } = await import("../src/server/db");
    const { dueInstallmentsSweep } = await import("../src/server/modules/billing/schedule");
    class Rollback extends Error {}
    let first: { requests: number; tasksMade: number } | undefined, second: typeof first;
    await withSystem(async (tx) => {
      first = await dueInstallmentsSweep(tx);
      second = await dueInstallmentsSweep(tx);
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
    expect(first!.requests).toBeGreaterThanOrEqual(0);
    expect(second!.tasksMade).toBe(0);
  }, 120_000);
});
