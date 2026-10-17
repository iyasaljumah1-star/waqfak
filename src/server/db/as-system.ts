import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "./index";

/**
 * Runs one step with the system context inside the caller's transaction, then restores the caller's identity. For
 * writes the caller is entitled to trigger but the row-level policy reserves to staff (e.g. a client's completion
 * marking a field «to review»): the action checks the caller's rights first; this only performs the bookkeeping.
 */
export async function asSystem<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
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
