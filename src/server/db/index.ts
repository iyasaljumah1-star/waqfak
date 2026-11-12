import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

/**
 * Stage 11 (R8-1, G10): three logins, three pools.
 *  - `waqfak_app` (DATABASE_URL) serves requests. It names nobody: each transaction BINDS the signed-in person with
 *    `auth_bind(keyed hash of the session cookie)`; unbound, it is an anonymous visitor. It cannot be the system.
 *  - `waqfak_system` (SYSTEM_DATABASE_URL): jobs, public catalog reads, link pages — the former «system context».
 *  - `waqfak_auth` (AUTH_DATABASE_URL): sign-in, sessions, one-time codes, second factor, account creation.
 * An injected query or a leaked credential of the application's pool gives neither of the other two.
 */
const globalForDb = globalThis as unknown as { __waqfakPools?: { app: Pool; system: Pool; auth: Pool } };

const pools =
  globalForDb.__waqfakPools ??
  {
    app: new Pool({ connectionString: env.DATABASE_URL, max: 15, idleTimeoutMillis: 30_000 }),
    system: new Pool({ connectionString: env.SYSTEM_DATABASE_URL, max: 8, idleTimeoutMillis: 30_000 }),
    auth: new Pool({ connectionString: env.AUTH_DATABASE_URL, max: 5, idleTimeoutMillis: 30_000 }),
  };
if (env.NODE_ENV !== "production") globalForDb.__waqfakPools = pools;

export const db = drizzle(pools.app, { schema, casing: "snake_case" });
const systemDb = drizzle(pools.system, { schema, casing: "snake_case" });
const authDb = drizzle(pools.auth, { schema, casing: "snake_case" });
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

/**
 * `sessionHash`: the keyed hash of the signed-in person's session cookie (lib/crypto sessionHash) — what the database
 * binds. `userId` is what the server believes; the binding must yield the same person or the transaction is refused.
 * `roles`: the caller's global roles (shown in the audit; the database records the bound person's own).
 */
export type DbContext = {
  userId: string | null; globalAccess: boolean; mlro?: boolean; roles?: string[]; sessionHash?: string | null;
  /** The engine's own account (engine/actor.ts): it has no session; it runs on the system role, which may declare it. */
  systemActor?: true;
};

export class UnboundIdentityError extends Error {
  constructor() {
    super("the session could not be bound in the database");
    this.name = "UnboundIdentityError";
  }
}

/**
 * Every request's data access runs inside a transaction of the application role that carries the BOUND person into
 * PostgreSQL, where row-level security enforces waqf isolation independently of application code. A context with a
 * person needs that person's live session; a context without one is an anonymous visitor (never the system).
 */
export async function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (ctx.systemActor && ctx.userId) return withSystemAs({ userId: ctx.userId, globalAccess: ctx.globalAccess, roles: ctx.roles }, fn);
  if (!ctx.userId && ctx.globalAccess) throw new Error("withContext: the system context is withSystem(), on its own login");
  const hooks: (() => Promise<unknown>)[] = [];
  const out = await db.transaction(async (tx) => {
    afterCommitHooks.set(tx, hooks);
    if (ctx.userId) {
      if (!ctx.sessionHash) throw new UnboundIdentityError();
      const r = await tx.execute<{ u: string | null }>(sql`select auth_bind(${ctx.sessionHash}) as u`);
      if (r.rows[0]?.u !== ctx.userId) throw new UnboundIdentityError();
    }
    if (ctx.mlro) await tx.execute(sql`set local role waqfak_mlro`);
    return fn(tx);
  });
  await runAfterCommit(hooks);
  return out;
}

const afterCommitHooks = new WeakMap<object, (() => Promise<unknown>)[]>();
async function runAfterCommit(hooks: (() => Promise<unknown>)[]) {
  for (const h of hooks) {
    try {
      await h();
    } catch (e) {
      console.error("[after-commit] a system step failed", e);
    }
  }
}

/**
 * A system step that follows a request's own transaction once it COMMITTED (stage 11): bookkeeping the row-level
 * policy reserves to staff, triggered by a client's authorized act (e.g. an installment that becomes due when the
 * client approves the work). It runs on the system login — never on the application's — and must be idempotent: a
 * failure is logged and the step is repeated by its own sweep. Outside a request transaction it runs at once.
 */
export function afterCommit(tx: Tx, step: () => Promise<unknown>): void {
  const hooks = afterCommitHooks.get(tx);
  if (hooks) hooks.push(step);
  else void step().catch((e) => console.error("[after-commit] a system step failed", e));
}

/** System context — background jobs, public catalog reads, link pages — on the system role's own login. */
export function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return systemDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true), set_config('app.actor_roles', '', true)`);
    return fn(tx);
  });
}

/**
 * A job that acts for a named account (the engine's): on the system role, which the database trusts to declare it.
 * Never reachable from a request's own connection.
 */
export function withSystemAs<T>(ctx: { userId: string; globalAccess: boolean; roles?: string[] }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return systemDb.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.user_id', ${ctx.userId}, true), set_config('app.global_access', ${ctx.globalAccess ? "on" : "off"}, true), set_config('app.actor_roles', ${(ctx.roles ?? []).join(",")}, true)`,
    );
    return fn(tx);
  });
}

/** The sign-in flows: sessions, one-time codes, second factor, account creation — on the authentication role. */
export function withAuth<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return authDb.transaction(fn);
}
