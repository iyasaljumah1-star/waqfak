/**
 * Loads the catalog of the unified knowledge engine into the knowledge base of the database named by
 * DATABASE_OWNER_URL. Idempotent; never deletes (a changed text becomes a new current row, the earlier one is kept).
 *
 *   npx tsx scripts/knowledge/ingest.ts
 *
 * Refuses to run against a database whose name does not end in «_test» unless KNOWLEDGE_INGEST_ALLOW is set: the
 * production database is never written from here.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import { ingestCatalog } from "../../src/server/knowledge/catalog";

async function main() {
  const url = process.env.DATABASE_OWNER_URL ?? "";
  const name = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/_test$/.test(name) && !process.env.KNOWLEDGE_INGEST_ALLOW) throw new Error(`refusing to write to «${name}»: not a test database`);
  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool, { schema, casing: "snake_case" });
    const r = await ingestCatalog(db);
    for (const x of r) console.log(`${x.status.padEnd(9)} ${x.refCode.padEnd(26)} ${String(x.units).padStart(4)} units  ${x.quality}`);
    console.log(`${r.length} sources, ${r.reduce((n, x) => n + x.units, 0)} units`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
