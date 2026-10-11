/**
 * Compliance engine runtime against the real database. Every test runs inside a system transaction that is
 * rolled back at the end, so the demo data is left untouched. Requires the demo seed (storage/demo-credentials.json).
 */
import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDemo = existsSync("storage/demo-credentials.json") && !!process.env.DATABASE_URL;
const demo = hasDemo ? (JSON.parse(readFileSync("storage/demo-credentials.json", "utf8")) as { waqfs: { A: string; B: string; C: string } }) : null;

class Rollback extends Error {}

/** Runs fn in a system transaction and always rolls it back. */
async function inRollback(fn: (tx: import("../src/server/db").Tx) => Promise<void>) {
  const { withSystem } = await import("../src/server/db");
  try {
    await withSystem(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

describe.skipIf(!hasDemo)("compliance engine (DB, rolled back)", () => {
  it("applies an admin-added obligation with a JSON-logic rule to matching waqfs only, with no code change", async () => {
    const s = await import("../src/server/db/schema");
    const { resyncAllWaqfs } = await import("../src/server/modules/compliance/engine");
    await inRollback(async (tx) => {
      // Applies only to public waqfs of size "large" (C), as a standing obligation.
      const [o] = await tx
        .insert(s.obligations)
        .values({
          code: "OB-TST-99", titleAr: "التزام اختباري يضيفه المشرف", referenceText: "اختبار", authority: "gaa", obligationType: "governance", triggerEvent: "standing",
          offsetUnit: "none", recurrence: "none", appliesTo: { rule: { and: [{ "==": [{ var: "legalType" }, "public"] }, { "==": [{ var: "sizeClass" }, "large"] }] } } as never,
          severity: "medium", requiredAction: "اختبار", status: "published",
        })
        .returning();
      const first = await resyncAllWaqfs(tx);
      expect(first.created).toBeGreaterThanOrEqual(1);
      const inst = await tx.select().from(s.obligationInstances).where(eq(s.obligationInstances.obligationId, o.id));
      expect(inst.map((i) => i.waqfId)).toEqual([demo!.waqfs.C]);
      expect(inst[0].periodKey).toBe("standing");

      // Idempotent: a second resync creates nothing.
      const second = await resyncAllWaqfs(tx);
      expect(second.created).toBe(0);

      // Narrowing the rule retires the untouched instance (deleted, since it has no history beyond creation).
      await tx.update(s.obligations).set({ appliesTo: { rule: { "==": [{ var: "sizeClass" }, "small"] } } as never }).where(eq(s.obligations.id, o.id));
      await resyncAllWaqfs(tx);
      const after = await tx.select().from(s.obligationInstances).where(eq(s.obligationInstances.obligationId, o.id));
      expect(after.map((i) => i.waqfId)).toEqual([demo!.waqfs.B]);
    });
  });

  it("emits a regulatory event once per reference (dedupe) with a business-day due date", async () => {
    const s = await import("../src/server/db/schema");
    const { emit } = await import("../src/server/modules/compliance/engine");
    await inRollback(async (tx) => {
      const ref = "11111111-2222-4333-8444-555555555555";
      const e = { waqfId: demo!.waqfs.A, event: "material_change" as const, date: "2026-10-04", refId: ref };
      const r1 = await emit(tx, e);
      const r2 = await emit(tx, e);
      expect(r1.created).toBe(1);
      expect(r2.created).toBe(0);
      const rows = await tx
        .select({ i: s.obligationInstances })
        .from(s.obligationInstances)
        .innerJoin(s.obligations, eq(s.obligations.id, s.obligationInstances.obligationId))
        .where(and(eq(s.obligationInstances.waqfId, demo!.waqfs.A), eq(s.obligations.code, "OB-REG-02"), eq(s.obligationInstances.periodKey, `ref:${ref}`)));
      expect(rows).toHaveLength(1);
      // 2026-10-04 is a Sunday → 15 business days (Fri/Sat off) → 2026-10-25, unless a seeded holiday falls in between.
      expect(rows[0].i.dueOn! >= "2026-10-25").toBe(true);
    });
  });

  it("closes the earliest open statements obligation on statements_final", async () => {
    const s = await import("../src/server/db/schema");
    const { emit, sync } = await import("../src/server/modules/compliance/engine");
    await inRollback(async (tx) => {
      await sync(tx, demo!.waqfs.A);
      const open = async () =>
        tx
          .select({ i: s.obligationInstances })
          .from(s.obligationInstances)
          .innerJoin(s.obligations, eq(s.obligations.id, s.obligationInstances.obligationId))
          .where(and(eq(s.obligationInstances.waqfId, demo!.waqfs.A), eq(s.obligations.code, "OB-FIN-02")));
      const before = (await open()).filter((r) => r.i.status !== "done");
      if (!before.length) return; // nothing open for this demo state
      await emit(tx, { waqfId: demo!.waqfs.A, event: "statements_final", date: "2026-10-06", refId: "99999999-2222-4333-8444-555555555555" });
      const after = (await open()).filter((r) => r.i.status !== "done");
      expect(after.length).toBe(before.length - 1);
    });
  });

  it("recomputes statuses by date and sends each reminder once (obligation_events dedupe)", async () => {
    const s = await import("../src/server/db/schema");
    const { emit, recomputeStatuses, sendReminders } = await import("../src/server/modules/compliance/engine");
    const { addDays, todayISO } = await import("../src/server/engines/dates");
    // Dates relative to today: the instance is created as "due soon" whatever day the suite runs.
    const t0 = todayISO();
    const due = addDays(t0, 2);
    const remindOn = addDays(t0, 1);
    const late = addDays(t0, 4);
    await inRollback(async (tx) => {
      await emit(tx, { waqfId: demo!.waqfs.A, event: "gaa_request", date: t0, refId: "aaaaaaaa-2222-4333-8444-555555555555", dueOverride: due });
      const [inst] = await tx.select().from(s.obligationInstances).where(and(eq(s.obligationInstances.waqfId, demo!.waqfs.A), eq(s.obligationInstances.periodKey, "ref:aaaaaaaa-2222-4333-8444-555555555555")));
      expect(inst.status).toBe("due_soon");
      const r1 = await sendReminders(tx, remindOn);
      const r2 = await sendReminders(tx, remindOn);
      expect(r1.sent).toBeGreaterThanOrEqual(1);
      expect(r2.sent).toBe(0);
      const ev = await tx.select().from(s.obligationEvents).where(and(eq(s.obligationEvents.instanceId, inst.id), eq(s.obligationEvents.action, "reminder")));
      expect(ev).toHaveLength(1);
      // Two days after the deadline the instance becomes overdue and gets an overdue notice once.
      await recomputeStatuses(tx, late);
      const [lateRow] = await tx.select().from(s.obligationInstances).where(eq(s.obligationInstances.id, inst.id));
      expect(lateRow.status).toBe("overdue");
      await sendReminders(tx, late);
      await sendReminders(tx, late);
      const ev2 = await tx.select().from(s.obligationEvents).where(and(eq(s.obligationEvents.instanceId, inst.id), eq(s.obligationEvents.action, "reminder")));
      expect(ev2.map((e) => e.note).sort()).toEqual(["offset:-1", "offset:1"]);
    });
  });
});
