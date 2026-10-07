import "server-only";
import type { Tx } from "../../db";

/**
 * Contract between feature modules and the compliance engine.
 * Feature modules call these when something with regulatory consequences happens;
 * the compliance module turns them into obligation instances (with due dates, reminders and evidence).
 */
export type WaqfEvent =
  | "documentation" // waqf documented (date = documentation date)
  | "registration" // registered with GAA (closes OB-REG-01)
  | "material_change" // asset / nazir / beneficiaries changed
  | "cert_expiry" // registration certificate expiry date known
  | "asset_substitution"
  | "mortgage"
  | "fiscal_year_end"
  | "bo_change" // beneficial owner data changed
  | "nazara_end"
  | "conflict_declared"
  | "gaa_request"
  | "violation_decision"
  | "suspension_decision"
  | "statements_final"
  | "portfolio_deed"
  | "portfolio_certificate"
  | "portfolio_created"
  | "product_change"
  | "donation_license_expiry"
  | "donation_collection_end";

export type EmitInput = { waqfId: string; event: WaqfEvent; date: string; refId?: string; meta?: Record<string, unknown>; actorUserId?: string | null; dueOverride?: string };

// Implementation is registered by the compliance module (see ./engine.ts) to avoid import cycles.
type Handler = { emit: (tx: Tx, e: EmitInput) => Promise<void>; sync: (tx: Tx, waqfId: string) => Promise<void> };
let handler: Handler | null = null;
export const registerComplianceHandler = (h: Handler) => {
  handler = h;
};

/** Record a regulatory event for a waqf (creates/updates obligation instances). */
export async function emitWaqfEvent(tx: Tx, e: EmitInput) {
  await ensureLoaded();
  if (handler) await handler.emit(tx, e);
}

/** Recompute recurring/standing obligations after the waqf profile changes (size class, fiscal year, flags). */
export async function syncWaqfObligations(tx: Tx, waqfId: string) {
  await ensureLoaded();
  if (handler) await handler.sync(tx, waqfId);
}

async function ensureLoaded() {
  if (!handler) {
    try {
      await import("./engine");
    } catch {
      /* engine not built yet */
    }
  }
}
