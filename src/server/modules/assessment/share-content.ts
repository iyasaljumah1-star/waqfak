import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "../../db";
import { assessmentResults, assessments, reports } from "../../db/schema";
import type { ReportContent } from "../../lib/capability";

/** What a report share shows, as it is now: the report, its assessment and the result's computation time (N9-2). */
export async function reportContent(tx: Tx, reportId: string): Promise<ReportContent> {
  const [r] = await tx.select({ waqfId: reports.waqfId, number: reports.number, assessmentId: reports.assessmentId }).from(reports).where(eq(reports.id, reportId)).limit(1);
  const [a] = r?.assessmentId ? await tx.select({ waqfId: assessments.waqfId }).from(assessments).where(eq(assessments.id, r.assessmentId)).limit(1) : [];
  const [res] = r?.assessmentId ? await tx.select({ at: assessmentResults.computedAt }).from(assessmentResults).where(eq(assessmentResults.assessmentId, r.assessmentId)).limit(1) : [];
  return { reportWaqf: r?.waqfId ?? null, reportNumber: r?.number ?? "", assessmentId: r?.assessmentId ?? null, assessmentWaqf: a?.waqfId ?? null, resultAt: res?.at ? new Date(res.at).toISOString() : null };
}
