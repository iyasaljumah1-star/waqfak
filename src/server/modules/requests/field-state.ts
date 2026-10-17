import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { requestFieldStates } from "@/server/db/schema";
import type { FieldReviewEvent } from "@/server/db/schema/operations";
import type { RequestCtx } from "./access";

/** Upserts a field's review state with its history (shared by approve/reopen and by edits and client completions). */
export async function recordFieldState(tx: Tx, rc: Pick<RequestCtx, "req">, key: string, ev: FieldReviewEvent, status: "approved" | "needs_review" | "pending", approvedValue?: unknown) {
  const [cur] = await tx.select().from(requestFieldStates).where(and(eq(requestFieldStates.requestId, rc.req.id), eq(requestFieldStates.fieldKey, key))).limit(1);
  const history = [...(cur?.history ?? []), ev].slice(-50);
  const patch = {
    status, history, note: ev.note ?? null, updatedAt: new Date(),
    ...(status === "approved" ? { approvedValue: approvedValue ?? null, decidedBy: ev.by, decidedAt: new Date(ev.at) } : {}),
  };
  if (cur) await tx.update(requestFieldStates).set(patch).where(eq(requestFieldStates.id, cur.id));
  else await tx.insert(requestFieldStates).values({ requestId: rc.req.id, waqfId: rc.req.waqfId, fieldKey: key, ...patch });
}

