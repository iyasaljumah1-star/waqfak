/**
 * Fiqh research examples on the test knowledge base (synthetic matters and facts; public texts). Prints and writes
 * data/knowledge/reports/fiqh-examples.{json,md}. Read-only: runs in a rolled-back transaction.
 *   KE_TEST_DATABASE_URL=… npx tsx --conditions=react-server scripts/knowledge/fiqh-examples.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import { research } from "../../src/server/knowledge/fiqh/research";
import { KIND_AR, POLARITY_AR, RANK_AR, type Fact } from "../../src/server/knowledge/fiqh/types";
import { FIQH_CASES } from "../../tests/knowledge/fiqh-cases";

async function main() {
  const url = process.env.KE_TEST_DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url)) throw new Error("KE_TEST_DATABASE_URL must name a _test database");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  const out: unknown[] = [];
  const L: string[] = ["# أمثلة البحث الفقهي من بيئة الاختبار", "", "مسائل ووقائع اصطناعية؛ النصوص من قاعدة المعرفة (كتب منشورة). لا مراجعة بشرية: كل النصوص «غير مراجعة».", ""];
  try {
    await db.transaction(async (tx) => {
      for (const c of FIQH_CASES.filter((x) => x.kb !== false)) {
        const d = await research(tx as never, { question: c.question, facts: c.facts as Fact[], asOf: "2026-11-07", stage: "preliminary", refCodes: c.refCodes });
        out.push({ id: c.id, title: c.title, dossier: d });
        L.push(`## ${c.id}. ${c.title}`, "", `**المسألة:** ${c.question}`, "", `**الوقائع:** ${c.facts.length ? c.facts.map((f) => `${f.status === "assumed" ? "مفترض: " : ""}${f.text}`).join("؛ ") : "لا شيء"}`, "");
        L.push(`**الباب:** ${d.issue.topic ?? "غير متبين"}؛ **الناقص المؤثر:** ${d.issue.missing.join("؛ ") || "لا شيء"}`, "");
        L.push("| # | المصدر والموضع | النوع | المرتبة | النسبة | الحكم (على الوقائع) | الانطباق | النص (مقتطف) |", "|---|---|---|---|---|---|---|---|");
        for (const s of d.statements) L.push(`| ${s.id} | ${s.source.title} — ${s.source.locator} | ${KIND_AR[s.kind]} | ${RANK_AR[s.rank]} | ${s.attributedTo ?? "—"} | ${POLARITY_AR[s.effective]} | ${s.applies} | ${s.text.replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 160)} |`);
        const w = d.weighing!;
        L.push("", w.status === "weighed" ? `**الترجيح المبدئي:** ${POLARITY_AR[w.leaning]} (${w.statementIds.join("، ")}) — الثقة ${w.confidence}${w.differsFromMutamad ? " — يخالف المعتمد" : ""}. ${w.reasons.join(" ")}` : `**لا ترجيح (${w.status}):** ${w.reasons.join(" ")} ${w.unresolved.length ? `— ${w.unresolved.join("؛ ")}` : ""}`, "");
        L.push(`**يحتاج مراجعة بشرية:** ${w.humanReview.join("؛ ")}`, "");
      }
      throw new Error("rollback");
    }).catch((e) => { if ((e as Error).message !== "rollback") throw e; });
  } finally {
    await pool.end();
  }
  const dir = path.join(process.cwd(), "data/knowledge/reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "fiqh-examples.json"), JSON.stringify(out, null, 1));
  writeFileSync(path.join(dir, "fiqh-examples.md"), L.join("\n") + "\n");
  console.log(L.join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
