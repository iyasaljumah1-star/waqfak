/**
 * Staging/preview bootstrap for single-container hosts (Railway, Render, Fly…).
 * Given ONE superuser connection (DATABASE_ADMIN_URL), it prepares everything the app expects:
 *   - persistent secrets (MASTER_KEY, HASH_KEY, SESSION_SECRET, role passwords) — taken from env if set,
 *     otherwise generated once and kept in $DATA_DIR/keys.json (put DATA_DIR on a persistent volume);
 *   - least-privilege roles waqfak_owner / waqfak_app / waqfak_mlro and the database;
 *   - writes the runtime env (DATABASE_URL, DATABASE_OWNER_URL, APP_URL, …) to the file given as argv[2].
 * Never use this path for the real production server — use docker-compose.yml + deploy/install.sh there.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const out = process.argv[2] ?? "/tmp/runtime.env";
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error("DATABASE_ADMIN_URL is required (e.g. ${{Postgres.DATABASE_URL}} on Railway).");
  process.exit(1);
}
const dataDir = process.env.DATA_DIR ?? "/data";
mkdirSync(dataDir, { recursive: true });
const keyFile = `${dataDir}/keys.json`;
const stored = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")) : {};
const b64 = () => randomBytes(32).toString("base64");
const hex = () => randomBytes(18).toString("hex");
const keys = {
  MASTER_KEY: process.env.MASTER_KEY || stored.MASTER_KEY || b64(),
  HASH_KEY: process.env.HASH_KEY || stored.HASH_KEY || b64(),
  SESSION_SECRET: process.env.SESSION_SECRET || stored.SESSION_SECRET || b64(),
  OWNER_DB_PASSWORD: stored.OWNER_DB_PASSWORD || hex(),
  APP_DB_PASSWORD: stored.APP_DB_PASSWORD || hex(),
};
writeFileSync(keyFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
if (!stored.MASTER_KEY && !process.env.MASTER_KEY) console.log(`[bootstrap] generated new secrets in ${keyFile} — keep DATA_DIR on a persistent volume`);

const dbName = process.env.STAGING_DB_NAME ?? "waqfak";
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
const q = (s, p) => admin.query(s, p);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
for (const [role, pw, extra] of [["waqfak_owner", keys.OWNER_DB_PASSWORD, "CREATEDB"], ["waqfak_app", keys.APP_DB_PASSWORD, ""]]) {
  const { rowCount } = await q("select 1 from pg_roles where rolname = $1", [role]);
  await q(`${rowCount ? "ALTER" : "CREATE"} ROLE ${role} LOGIN ${extra} PASSWORD ${lit(pw)}`);
}
if (!(await q("select 1 from pg_roles where rolname = 'waqfak_mlro'")).rowCount) await q("CREATE ROLE waqfak_mlro NOLOGIN");
await q("GRANT waqfak_mlro TO waqfak_app");
if (!(await q("select 1 from pg_database where datname = $1", [dbName])).rowCount) await q(`CREATE DATABASE ${dbName} OWNER waqfak_owner`);
await admin.end();

const u = new URL(adminUrl);
const url = (user, pw) => {
  const x = new URL(u.toString());
  x.username = user;
  x.password = pw;
  x.pathname = `/${dbName}`;
  return x.toString();
};
const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_HOSTNAME;
const appUrl = process.env.APP_URL || (domain ? `https://${domain}` : "http://localhost:3000");
const env = {
  ...keys,
  DATABASE_URL: url("waqfak_app", keys.APP_DB_PASSWORD),
  DATABASE_OWNER_URL: url("waqfak_owner", keys.OWNER_DB_PASSWORD),
  APP_URL: appUrl,
  STORAGE_DIR: process.env.STORAGE_DIR || `${dataDir}/storage`,
};
writeFileSync(out, Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n", { mode: 0o600 });
console.log(`[bootstrap] database "${dbName}" ready · APP_URL=${appUrl}`);
