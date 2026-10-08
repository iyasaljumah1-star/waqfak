/** Writes docs/DATABASE.md from the live catalog: every table, column, type, nullability, RLS status, policies. */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  const cols = (await pool.query(`
    select c.table_schema s, c.table_name t, c.column_name n, c.data_type ty, c.udt_name udt, c.is_nullable nul, c.column_default def
    from information_schema.columns c join information_schema.tables x using (table_schema, table_name)
    where c.table_schema in ('public','restricted') and x.table_type = 'BASE TABLE' and c.table_name not like '__drizzle%'
    order by c.table_schema, c.table_name, c.ordinal_position`)).rows;
  const rls = new Map((await pool.query(`select n.nspname||'.'||c.relname k, c.relrowsecurity r from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r'`)).rows.map((r) => [r.k, r.r]));
  const pol = (await pool.query(`select schemaname||'.'||tablename k, string_agg(policyname||' ('||cmd||')', ', ' order by policyname) p from pg_policies group by 1`)).rows;
  const pols = new Map(pol.map((r) => [r.k, r.p]));
  const fks = (await pool.query(`select tc.table_schema||'.'||tc.table_name k, kcu.column_name c, ccu.table_name ft from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name where tc.constraint_type = 'FOREIGN KEY'`)).rows;
  const fk = new Map(fks.map((r) => [`${r.k}.${r.c}`, r.ft]));
  await pool.end();
  const tables = [...new Set(cols.map((c) => `${c.s}.${c.t}`))];
  const out = [
    "# Database schema — وقفك",
    "",
    `PostgreSQL 16 · ${tables.length} tables · generated ${new Date().toISOString().slice(0, 10)} from the live catalog (scripts/export-schema.ts).`,
    "Definitions live in `src/server/db/schema/*.ts` (Drizzle) → migrations in `drizzle/` → security (roles, grants, RLS, triggers) in `src/server/db/sql/security.sql`.",
    "",
    "Roles: `waqfak_owner` (migrations), `waqfak_app` (runtime, subject to RLS), `waqfak_mlro` (only role that reaches the `restricted` schema).",
    "Isolation: every table with a `waqf_id` column carries the `waqf_isolation` policy → `app_can_access_waqf(waqf_id)`.",
    "",
    "## Tables",
    "",
    tables.map((t) => `[${t}](#${t.replace(".", "")})`).join(" · "),
    "",
  ];
  for (const t of tables) {
    out.push(`### ${t}`, "", `RLS: ${rls.get(t) ? "enabled" : "off"}${pols.get(t) ? ` — ${pols.get(t)}` : ""}`, "", "| Column | Type | Null | Default / FK |", "|---|---|---|---|");
    for (const c of cols.filter((c) => `${c.s}.${c.t}` === t)) {
      const ty = c.ty === "USER-DEFINED" ? c.udt : c.ty === "ARRAY" ? `${c.udt.replace(/^_/, "")}[]` : c.ty;
      const ref = fk.get(`${t}.${c.n}`);
      out.push(`| ${c.n} | ${ty} | ${c.nul === "YES" ? "yes" : ""} | ${[c.def ? `\`${String(c.def).slice(0, 40)}\`` : "", ref ? `→ ${ref}` : ""].filter(Boolean).join(" ")} |`);
    }
    out.push("");
  }
  writeFileSync("docs/DATABASE.md", out.join("\n"));
  console.log(`schema exported: ${tables.length} tables → docs/DATABASE.md`);
}
main().catch((e) => { console.error(e); process.exit(1); });
