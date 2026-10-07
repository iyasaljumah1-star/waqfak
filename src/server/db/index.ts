import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __waqfakPool?: Pool };

const pool =
  globalForDb.__waqfakPool ??
  new Pool({ connectionString: env.DATABASE_URL, max: 15, idleTimeoutMillis: 30_000 });
if (env.NODE_ENV !== "production") globalForDb.__waqfakPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

export type DbContext = { userId: string | null; globalAccess: boolean; mlro?: boolean };

/**
 * Every data access runs inside a transaction that carries the caller identity into PostgreSQL,
 * where row-level security policies enforce waqf isolation independently of application code.
 */
export async function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${ctx.userId ?? ""}, true), set_config('app.global_access', ${ctx.globalAccess ? "on" : "off"}, true)`,
    );
    if (ctx.mlro) await tx.execute(sql`set local role waqfak_mlro`);
    return fn(tx);
  });
}

/** System context for background jobs, authentication flows and public catalog reads. */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext({ userId: null, globalAccess: true }, fn);
}
