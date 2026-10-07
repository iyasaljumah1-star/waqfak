/**
 * One-off data patch for the compliance engine runtime (idempotent; safe to re-run).
 * Run: npx tsx --conditions=react-server scripts/jobs/patch-obligations.ts
 *
 * The seeded obligations carry trigger, offset, recurrence, applicability (sizeClasses/flags) and reminders,
 * but not closure semantics. This patch adds them as DATA inside obligations.applies_to (the obligation's jsonb config):
 *   - closesOn:      events that close open instances (scope: all_open | other_periods | earliest_open)
 *   - satisfiedWhen: JSON-logic on waqf facts; when true the instance is created/kept as done
 * and creates the generic OB-MAN-00 definition used by manually added one-off obligations
 * (status "retired" so the engine never auto-creates it; the per-item title lives on the instance's "created" event).
 *
 * INTEGRATOR: fold these values into src/server/seed/data/compliance.ts (OBLIGATIONS[].appliesTo) and add OB-MAN-00.
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { withSystem } from "../../src/server/db";
import { obligations } from "../../src/server/db/schema";
import { MANUAL_OBLIGATION } from "../../src/server/modules/compliance/manual";

export const OBLIGATION_PATCH: Record<string, Record<string, unknown>> = {
  "OB-REG-01": { closesOn: ["registration"], satisfiedWhen: { "!!": { var: "registered" } } },
  "OB-REG-03": { closesOn: [{ event: "cert_expiry", scope: "other_periods" }] },
  "OB-DON-01": { closesOn: [{ event: "donation_license_expiry", scope: "other_periods" }] },
  "OB-PRD-01": { closesOn: ["portfolio_certificate"] },
  "OB-PRD-02": { closesOn: ["portfolio_created"] },
  "OB-FIN-02": { closesOn: [{ event: "statements_final", scope: "earliest_open" }] },
  "OB-FIN-03": { closesOn: [{ event: "statements_final", scope: "earliest_open" }] },
};



async function main() {
  await withSystem(async (tx) => {
    for (const [code, patch] of Object.entries(OBLIGATION_PATCH)) {
      const r = await tx
        .update(obligations)
        .set({ appliesTo: sql`${obligations.appliesTo} || ${JSON.stringify(patch)}::jsonb` })
        .where(eq(obligations.code, code))
        .returning({ code: obligations.code, appliesTo: obligations.appliesTo });
      console.log(r.length ? `✓ ${code} ${JSON.stringify(r[0].appliesTo)}` : `✗ ${code} not found`);
    }
    const ins = await tx.insert(obligations).values(MANUAL_OBLIGATION).onConflictDoNothing().returning({ id: obligations.id });
    console.log(ins.length ? "✓ OB-MAN-00 created" : "• OB-MAN-00 already present");
  });
}

if (process.argv[1]?.includes("patch-obligations")) {
  main().then(() => process.exit(0), (e) => {
    console.error(e);
    process.exit(1);
  });
}
