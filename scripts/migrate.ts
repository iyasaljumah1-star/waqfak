import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is required");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const securitySql = readFileSync(path.join(process.cwd(), "src/server/db/sql/security.sql"), "utf8");
  await pool.query(securitySql);
  await pool.end();
  console.log("migrations + security policies applied");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
