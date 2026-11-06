/**
 * Runs the knowledge engine's acceptance cases (tests/knowledge/cases.ts) against the test database named by
 * KE_TEST_DATABASE_URL, each in a rolled-back transaction, and writes data/knowledge/reports/acceptance.{json,md}.
 *
 *   npx tsx --conditions=react-server scripts/knowledge/acceptance-report.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import { CASES, KNOWN_LIMITS, runCase, type CaseRow } from "../../tests/knowledge/cases";

async function main() {
  const url = process.env.KE_TEST_DATABASE_URL ?? "";
  if (!/ke_test/.test(url)) throw new Error("KE_TEST_DATABASE_URL must name the ke_test database");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  const rows: (CaseRow & { knownLimit: boolean })[] = [];
  for (const [list, known] of [[CASES, false], [KNOWN_LIMITS, true]] as const) {
    for (const c of list) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
        rows.push({ ...(await runCase(tx as never, c)), knownLimit: known });
        tx.rollback();
      }).catch((e) => { if (!/rollback/i.test(String(e?.message ?? e))) throw e; });
    }
  }
  await pool.end();
  const dir = path.join(process.cwd(), "data/knowledge/reports");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "acceptance.json"), JSON.stringify({ ranAt: new Date().toISOString(), rows }, null, 1));
  const yes = (b: boolean | null) => (b === null ? "—" : b ? "نعم" : "لا");
  const L = ["# نتائج اختبارات الاسترجاع والاستشهاد — محرك المعرفة الموحد", "", `شُغّلت ${new Date().toISOString().slice(0, 16)} على قاعدة اختبار محلية (waqfak_ke_test) تحمل ${"48"} مصدرًا؛ كل حالة في معاملة تُلغى بعدها. المراجعات المسجلة في الحالات اصطناعية.`, "",
    "| # | الفئة | السؤال | الخدمة | المرجع المتوقع | المرجع المسترجع | الموضع | مقتطف النص المسترجع | مطابق للأصل | أحدث نسخة | منطبق | قرار الاستشهاد | النتيجة |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of rows) L.push(`| ${r.id} | ${r.category} | ${r.question} | ${r.service ?? "—"} | ${r.expected} | ${r.retrievedRef ?? "—"} | ${r.locator ?? "—"} | ${(r.excerpt ?? "—").replace(/\|/g, "/").slice(0, 160)} | ${yes(r.matchesOriginal)} | ${yes(r.latestVersion)} | ${yes(r.applicable)} | ${r.decision.replace(/\|/g, "/").slice(0, 160)} | ${r.pass ? "ناجح" : r.knownLimit ? "فشل (قيد معروف)" : "فشل"}${r.note ? ` — ${r.note.replace(/\|/g, "/").slice(0, 160)}` : ""} |`);
  writeFileSync(path.join(dir, "acceptance.md"), L.join("\n") + "\n");
  console.log(rows.map((r) => `${r.id} ${r.pass ? "PASS" : "FAIL"} ${r.retrievedRef} ${r.locator}`).join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
