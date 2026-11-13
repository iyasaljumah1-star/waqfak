/* eslint-disable @typescript-eslint/no-explicit-any -- a probe script printing what retrieve() returns */
/** Stage 11.1: the Stage 11 independent review's end-to-end retrieve() probes on waqfak_ke_test, plus the stage 11.1 cases; every call in a ROLLED-BACK transaction. Synthetic questions. Run: npx tsx --conditions=react-server scripts/knowledge/probes/retrieve-e2e-s111.ts */
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
const URL = process.env.KE_TEST_DATABASE_OWNER_URL!;
if (!/ke_test/.test(URL)) throw new Error("not the ke_test database");
async function main() {
const schema = await import("../../../src/server/db/schema");
const K = await import("../../../src/server/knowledge/retrieve");
  const pool = new Pool({ connectionString: URL });
class Rollback extends Error {}
async function ask(question: string) {
  const db = drizzle(pool, { schema, casing: "snake_case" });
  let out: any;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
      await tx.execute(sql`set local role waqfak_system`);
      out = await K.retrieve(tx as never, { question, service: "*", asOf: "2026-11-07" });
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  return out;
}
const pairs: [string, string, string][] = [
  ["B-base", "ما حكم بيع الوقف إذا تعطلت منافعه عند الحنابلة؟", "baseline (P13)"],
  ["B-kamil", "ما حكم بيع الوقف إذا تعطلت منافعه بالكامل عند الحنابلة؟", "same + «بالكامل» (fully)"],
  ["B-adid", "ما حكم بيع الوقف إذا تعطلت منافعه في العديد من الحالات عند الحنابلة؟", "same + «في العديد من»"],
  ["B-banin", "هل يجوز الوقف على البنين دون البنات؟", "core waqf question"],
  ["B-maghrib", "ما حكم بيع الوقف إذا تعطلت منافعه بعد صلاة المغرب عند الحنابلة؟", "«المغرب» prayer"],
  ["C-base", "كم بلغ إجمالي عدد سكان المملكة في تعداد 2022؟", "baseline (7L-draft)"],
  ["C-dubai", "كم بلغ إجمالي عدد سكان دبي في تعداد 2022؟", "Dubai — must not answer with the Kingdom"],
  ["C-madina", "كم بلغ إجمالي عدد سكان المدينة في تعداد 2022؟", "«المدينة» (Madinah) — must not answer with the Kingdom"],
  ["C-cairo-en", "What was the total population of Cairo in the 2022 census?", "Cairo — must not answer with the Kingdom"],
  ["D-base", "كم بلغ معدل البطالة بين السعوديين في 2025 مقارنة بعام 2024؟", "baseline (P10)"],
  ["D-fa2it", "كم بلغ معدل البطالة بين السعوديين في العام الفائت؟", "relative date (N10-6 Z5)"],
  ["D-mundh", "كم بلغ معدل البطالة بين السعوديين منذ عامين؟", "relative date"],
  ["D-en", "What was the unemployment rate among Saudis two years ago?", "relative date en"],
  ["P-base", "ما المدة التي يجب على الناظر خلالها تسجيل الوقف والأصول الموقوفة لدى الهيئة؟", "baseline (P6)"],
  ["S-fes", "كم بلغ إجمالي عدد سكان فاس في تعداد 2022؟", "unlisted Arab city, no place word — must not answer with the Kingdom"],
  ["S-tetouan", "كم عدد الأوقاف في تطوان؟", "unlisted city"],
  ["S-zarqa", "ما نسبة البطالة في الزرقاء عام 2024؟", "unlisted city (Jordan)"],
  ["S-month", "كم بلغ معدل البطالة بين السعوديين في رجب 1446؟", "Hijri month: a year figure must not answer"],
  ["S-long", "أعمل على إعداد دراسة عن سوق العمل في المملكة وأحتاج رقمًا محددًا وموثوقًا من مصدر رسمي أستند إليه في الدراسة، ولذلك أسأل كم بلغ إجمالي عدد سكان دبي في تعداد 2022 مع ذكر المصدر وتاريخ النشر لو تكرمتم؟", "long (>25 words): Dubai must still limit"],
  ["S-long-ksa", "أعمل على إعداد دراسة عن سوق العمل في المملكة وأحتاج رقمًا محددًا وموثوقًا من مصدر رسمي أستند إليه في الدراسة، ولذلك أسأل كم بلغ إجمالي عدد سكان المملكة في تعداد 2022 مع ذكر المصدر وتاريخ النشر لو تكرمتم؟", "long control: the Kingdom"],
  ["P-amount", "ما المدة التي يجب على الناظر خلالها تسجيل الوقف والأصول الموقوفة لدى الهيئة إذا بلغت قيمتها 2000 ريال؟", "amount read as a year"],
];
for (const [id, q, why] of pairs) {
  const r = await ask(q);
  console.log(`[${id}] ${why}\n   Q: ${q}\n   usable=${r.usable.length} citable=${r.citable.length} draftSufficiency=${JSON.stringify(r.draftSufficiency).slice(0, 220)}\n   top=${r.usable.slice(0, 2).map((u: any) => `${u.hit.refCode} ${u.hit.locator} «${u.hit.text.slice(0, 70)}»`).join(" | ")}`);
}
await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
