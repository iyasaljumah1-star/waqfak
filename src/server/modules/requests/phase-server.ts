import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { asSystem } from "@/server/db/as-system";
import { outputs } from "@/server/db/schema";
import type { RequestCtx } from "./access";

/**
 * Review state of the request's outputs, for the phase shown to the client: status and delivered flag only — never
 * the review notes, versions or reviewers. Read after the request access check (rc), as outputs are staff rows.
 */
export function outputStatesForPhase(tx: Tx, rc: RequestCtx) {
  return asSystem(tx, () => tx.select({ status: outputs.status, deliverableId: outputs.deliverableId }).from(outputs).where(eq(outputs.requestId, rc.req.id)))
    .then((xs) => xs.map((x) => ({ status: x.status, delivered: !!x.deliverableId })));
}
