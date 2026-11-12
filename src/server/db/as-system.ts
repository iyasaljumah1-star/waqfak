import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "./index";

/**
 * Stage 11: the system context does not exist on the application's connection any more — the database ignores the
 * variables there and binds the signed-in person instead (R8-1). What used to be done here is done by narrow functions
 * that check the bound caller (security.sql, «what the former asSystem steps read»), or after commit on the system
 * login (db/index.ts afterCommit). On a system transaction (jobs, the engine), this still switches to the plain system
 * context for one step; on the application's connection it refuses, so no caller believes it was elevated.
 */
export async function asSystem<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const who = await tx.execute<{ s: string }>(sql`select session_user as s`);
  if (who.rows[0]?.s === "waqfak_app") throw new Error("asSystem: not available on the application's connection (stage 11)");
  const prev = await tx.execute<{ u: string | null; g: string | null }>(sql`select current_setting('app.user_id', true) as u, current_setting('app.global_access', true) as g`);
  const u = prev.rows[0]?.u ?? "";
  const g = prev.rows[0]?.g ?? "off";
  await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
  try {
    return await fn();
  } finally {
    await tx.execute(sql`select set_config('app.user_id', ${u}, true), set_config('app.global_access', ${g}, true)`);
  }
}
