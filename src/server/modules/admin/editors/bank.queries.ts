import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { assessmentAxes, assessmentQuestions, assessments, criticalFlagDefs, questionBankVersions, users } from "@/server/db/schema";

export async function listBankVersions(tx: Tx) {
  const vs = await tx
    .select({ v: questionBankVersions, publisher: users.fullName })
    .from(questionBankVersions)
    .leftJoin(users, eq(users.id, questionBankVersions.publishedBy))
    .orderBy(desc(questionBankVersions.version));
  const q = await tx.select({ id: assessmentQuestions.bankVersionId, n: sql<number>`count(*)::int` }).from(assessmentQuestions).groupBy(assessmentQuestions.bankVersionId);
  const a = await tx.select({ id: assessments.bankVersionId, n: sql<number>`count(*)::int` }).from(assessments).groupBy(assessments.bankVersionId);
  const qn = new Map(q.map((x) => [x.id, x.n]));
  const an = new Map(a.map((x) => [x.id, x.n]));
  return vs.map((r) => ({ ...r, questions: qn.get(r.v.id) ?? 0, assessments: an.get(r.v.id) ?? 0 }));
}

export async function loadBankVersion(tx: Tx, id: string) {
  const [v] = await tx.select().from(questionBankVersions).where(eq(questionBankVersions.id, id)).limit(1);
  if (!v) return null;
  const axes = await tx.select().from(assessmentAxes).where(eq(assessmentAxes.bankVersionId, id)).orderBy(asc(assessmentAxes.position));
  const questions = await tx.select().from(assessmentQuestions).where(eq(assessmentQuestions.bankVersionId, id)).orderBy(asc(assessmentQuestions.position));
  const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(assessments).where(eq(assessments.bankVersionId, id));
  return { v, axes, questions, assessments: used?.n ?? 0 };
}

export async function loadQuestion(tx: Tx, id: string) {
  const [q] = await tx.select().from(assessmentQuestions).where(eq(assessmentQuestions.id, id)).limit(1);
  return q ?? null;
}

export async function listFlagDefs(tx: Tx) {
  return tx.select().from(criticalFlagDefs).orderBy(asc(criticalFlagDefs.code));
}

export async function loadFlagDef(tx: Tx, code: string) {
  const [f] = await tx.select().from(criticalFlagDefs).where(eq(criticalFlagDefs.code, code)).limit(1);
  return f ?? null;
}
