/**
 * Stage 11: the Arabic/English retrieval set, case by case — what passes, what fails and why (documented limitations
 * included, never hidden). Pure: reads the frame and the judge, no database.
 *   npx tsx --conditions=react-server scripts/knowledge/retrieval-set-report.ts > report.md
 */
import { evaluate, RETRIEVAL_SET } from "../../tests/knowledge/retrieval-set";

async function main() {
  const rows: string[] = [];
  let pass = 0;
  const fails: string[] = [];
  for (const c of RETRIEVAL_SET) {
    const r = await evaluate(c);
    if (r.pass) pass++;
    else fails.push(c.id);
    const got = r.got as { places: string[]; context: string[]; unresolved: string[]; years: string[] };
    rows.push(`| ${c.id} | ${c.lang} | ${c.q} | ${r.pass ? "نجح" : "فشل"} | ${[got.places.length ? `مكان: ${got.places.join("، ")}` : "", got.context.length ? `سياق: ${got.context.join("، ")}` : "", got.unresolved.length ? `امتناع: ${got.unresolved.join("؛ ")}` : "", got.years.length ? `سنوات: ${got.years.join("، ")}` : ""].filter(Boolean).join(" — ").replace(/\|/g, "/")} | ${(c.limitation ?? r.problems.join("؛ ")).replace(/\|/g, "/")} |`);
  }
  console.log(`# مجموعة اختبار الاسترجاع العربية والإنجليزية (المرحلة 11)\n\nالحالات: ${RETRIEVAL_SET.length} — نجح: ${pass} — فشل: ${fails.length}${fails.length ? ` (${fails.join("، ")})` : ""}\n`);
  console.log("| الحالة | اللغة | السؤال | النتيجة | ما قرأه الإطار | سبب الفشل أو القيد الموثق |\n|---|---|---|---|---|---|");
  for (const r of rows) console.log(r);
}
main();
