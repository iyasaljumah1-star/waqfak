/**
 * Demo: one completed basic assessment for waqf A (by the demo nazir), answered with a deterministic
 * mid-maturity profile so results, flags and recommendations exist out of the box. Fictional data.
 * Idempotent: skips if waqf A already has a completed assessment.
 */
import { and, eq, ne } from "drizzle-orm";
import type { Tx } from "../../src/server/db";
import * as s from "../../src/server/db/schema";
import { scoreAnswer } from "../../src/server/engines/assessment";
import { prefillFromWaqf } from "../../src/server/modules/assessment/facts";
import { activeBankVersionId, loadBank } from "../../src/server/modules/assessment/queries";
import { computeAndPersist } from "../../src/server/modules/assessment/compute";
import type { DemoCtx } from "../seed-demo";

// Weak axes on purpose (registration/finance/BO) so the recommendation engine has something to say.
const LEVEL: Record<string, string> = { A1: "2", A2: "3", A3: "1", A4: "3", A5: "2", A6: "3", A7: "1", A8: "2", A9: "4", A10: "2", A11: "3" };

export default async function seed(tx: Tx, ctx: DemoCtx) {
  const waqfId = ctx.waqfs.A;
  const done = await tx.select({ id: s.assessments.id }).from(s.assessments).where(and(eq(s.assessments.waqfId, waqfId), ne(s.assessments.status, "draft"))).limit(1);
  if (done.length) return;
  const bank = await activeBankVersionId(tx);
  if (!bank) return;
  const [w] = await tx.select().from(s.waqfs).where(eq(s.waqfs.id, waqfId));
  const [a] = await tx
    .insert(s.assessments)
    .values({ waqfId, userId: ctx.users.nazir, kind: "basic", bankVersionId: bank, status: "draft", currentAxis: "review" })
    .returning({ id: s.assessments.id });
  const { questions } = await loadBank(tx, bank);
  const prefill = prefillFromWaqf(w as never);
  const rows = [];
  for (const q of questions) {
    let value: unknown = prefill[q.code];
    if (value === undefined) {
      const axis = (q as { axisCode?: string }).axisCode ?? q.code.split("-")[0];
      const opts = (q as { options?: { value: string }[] | null }).options ?? [];
      switch (q.answerType) {
        case "maturity": value = LEVEL[axis] ?? "2"; break;
        case "date": value = "2023-03-14"; break;
        case "number": value = 12; break;
        case "text": value = "إجابة تجريبية"; break;
        case "multiselect": value = opts.length ? [opts[0].value] : null; break;
        default: value = opts.length ? opts[Math.floor(opts.length / 2)].value : null;
      }
    }
    if (value === null || value === undefined) continue;
    const sc = scoreAnswer(q as never, { value });
    rows.push({ assessmentId: a.id, questionCode: q.code, waqfId, value: value as never, score: sc.score === null ? null : String(sc.score), isUnknown: sc.unknown, isNa: sc.na });
  }
  if (rows.length) await tx.insert(s.assessmentAnswers).values(rows);
  await computeAndPersist(tx, a.id, { userId: ctx.users.nazir });
}
