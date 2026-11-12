import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { outputs } from "@/server/db/schema";
import type { RequestCtx } from "./access";

/**
 * Review state of the request's outputs, for the phase shown to the client: status and delivered flag only — never
 * the review notes, versions or reviewers. Read after the request access check (rc), as outputs are staff rows.
 */
export function outputStatesForPhase(tx: Tx, rc: RequestCtx) {
  return tx.execute<{ status: string; delivered: boolean }>(sql`select status, delivered from app_request_output_states(array[${rc.req.id}::uuid])`)
    .then((r) => r.rows.map((x) => ({ status: x.status as typeof outputs.$inferSelect.status, delivered: x.delivered })));
}
