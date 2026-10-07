import "server-only";
import { and, asc, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  actionPlans, assessmentAnswers, assessmentAxes, assessmentQuestions, assessmentResults, assessments, axisScores, criticalFlagDefs,
  criticalFlags, facts, needs, packageItems, packages, questionBankVersions, recommendations, reportShares, reports, services, users, waqfs,
} from "../../db/schema";
import { suggestPackage, type Recommendation } from "../../engines/recommendations";
import type { Answer, Axis, Question } from "../../engines/assessment";
import { loadWaqfAccess, myWaqfIds, type Auth } from "../../authz/context";
import { read } from "../_shared";
import type { AssessmentRow, Viewer } from "./access";
import { CONFIDENCE_LABEL, type ConfidenceLevel } from "./facts";

export type BankAxis = Axis & { description: string | null; position: number };
export type BankQuestion = Question & { helpAr: string | null; position: number };

export const assessmentNumber = (id: string) => `TQ-${id.slice(0, 8).toUpperCase()}`;

export async function activeBankVersionId(tx: Tx): Promise<string | null> {
  const [v] = await tx
    .select({ id: questionBankVersions.id })
    .from(questionBankVersions)
    .where(eq(questionBankVersions.status, "published"))
    .orderBy(desc(questionBankVersions.version))
    .limit(1);
  return v?.id ?? null;
}

export async function loadBank(tx: Tx, bankVersionId: string): Promise<{ axes: BankAxis[]; questions: BankQuestion[] }> {
  const ax = await tx.select().from(assessmentAxes).where(eq(assessmentAxes.bankVersionId, bankVersionId)).orderBy(asc(assessmentAxes.position));
  const qs = await tx.select().from(assessmentQuestions).where(eq(assessmentQuestions.bankVersionId, bankVersionId)).orderBy(asc(assessmentQuestions.position));
  return {
    axes: ax.map((a) => ({
      code: a.code, nameAr: a.nameAr, description: a.description, position: a.position,
      weightSmall: Number(a.weightSmall), weightMedium: Number(a.weightMedium), weightLarge: Number(a.weightLarge),
    })),
    questions: qs.map((q) => ({
      code: q.code, axisCode: q.axisCode, textAr: q.textAr, helpAr: q.helpAr, answerType: q.answerType, options: q.options ?? null,
      weight: q.weight, referenceText: q.referenceText, criticalFlagCode: q.criticalFlagCode, criticalWhen: q.criticalWhen ?? null,
      showIf: q.showIf ?? null, factKey: q.factKey, depth: q.depth, position: q.position,
    })),
  };
}

export async function loadAnswers(tx: Tx, assessmentId: string): Promise<Record<string, Answer>> {
  const rows = await tx.select().from(assessmentAnswers).where(eq(assessmentAnswers.assessmentId, assessmentId));
  return Object.fromEntries(rows.map((r) => [r.questionCode, { value: r.value, evidenceLevel: r.evidenceLevel }]));
}

export type ReviewData = { summary?: string; axes?: Record<string, string> };
export function parseReview(raw: string | null): ReviewData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as ReviewData) : { summary: raw };
  } catch {
    return { summary: raw };
  }
}

export type RecView = {
  id: string;
  ruleCode: string;
  needCode: string;
  needTitle: string;
  severity: "critical" | "high" | "medium" | "low";
  priority: number;
  wave: number;
  titleAr: string;
  reasonAr: string;
  whyItMattersAr: string | null;
  reference: string | null;
  selfServiceHintAr: string | null;
  status: string;
  suppressedNote: string | null;
  dismissReason: string | null;
  serviceRequestId: string | null;
  services: { code: string; nameAr: string }[];
  removed: { code: string; nameAr: string; why: string }[];
  manual: boolean;
};

export type FlagView = {
  code: string; titleAr: string; referenceText: string; penaltyText: string | null; penaltyCode: string | null;
  actionAr: string | null; severity: string; questionCode: string | null; axisCode: string | null;
};

export type ResultBundle = {
  row: AssessmentRow;
  number: string;
  waqf: { id: string; name: string; internalNumber: string } | null;
  result: {
    overallScore: number; maturityScore: number; maturityLevel: string; status: string; confidence: ConfidenceLevel; evidenceRatio: number;
    knowledgeGaps: number; sizeClass: string | null; computedType: string | null; computedAt: Date;
    strengths: { code: string; text: string; axis: string }[]; weaknesses: { code: string; text: string; axis: string; reference?: string }[];
  };
  confidenceReasons: string[];
  completeness: number | null;
  computedTypeReason: string | null;
  axes: { code: string; nameAr: string; description: string | null; score: number | null; capped: boolean; applicableCount: number; answeredCount: number; weight: number | null }[];
  flags: FlagView[];
  recs: RecView[];
  pkg: { code: string; nameAr: string; description: string | null; covers: number } | null;
  review: ReviewData | null;
  reviewerName: string | null;
  actionPlan: { id: string; generatedAt: Date } | null;
};

/** Everything the result page, the PDF and the share view need. Runs under the viewer's RLS context. */
export async function loadResultBundle(tx: Tx, row: AssessmentRow): Promise<ResultBundle | null> {
  const [res] = await tx.select().from(assessmentResults).where(eq(assessmentResults.assessmentId, row.id)).limit(1);
  if (!res) return null;
  const [waqf] = row.waqfId ? await tx.select({ id: waqfs.id, name: waqfs.name, internalNumber: waqfs.internalNumber }).from(waqfs).where(eq(waqfs.id, row.waqfId)).limit(1) : [];
  const axRows = await tx.select().from(assessmentAxes).where(eq(assessmentAxes.bankVersionId, row.bankVersionId)).orderBy(asc(assessmentAxes.position));
  const scoreRows = await tx.select().from(axisScores).where(eq(axisScores.assessmentId, row.id));
  const flagRows = await tx
    .select({ code: criticalFlags.flagCode, questionCode: criticalFlags.questionCode, def: criticalFlagDefs })
    .from(criticalFlags)
    .leftJoin(criticalFlagDefs, eq(criticalFlagDefs.code, criticalFlags.flagCode))
    .where(eq(criticalFlags.assessmentId, row.id));
  const recRows = await tx.select().from(recommendations).where(eq(recommendations.assessmentId, row.id)).orderBy(asc(recommendations.wave), desc(recommendations.priority));
  const metaRows = await tx.select().from(facts).where(and(eq(facts.assessmentId, row.id), or(like(facts.key, "meta.%"), eq(facts.key, "computed_type_reason"))));
  const meta = new Map(metaRows.map((m) => [m.key, m.value]));
  const svcRows = await tx.select({ code: services.code, nameAr: services.nameAr }).from(services);
  const svcName = new Map(svcRows.map((s) => [s.code, s.nameAr]));
  const needCodes = [...new Set(recRows.map((r) => r.needCode))];
  const needRows = needCodes.length ? await tx.select().from(needs).where(inArray(needs.code, needCodes)) : [];
  const needTitle = new Map(needRows.map((n) => [n.code, n.titleAr]));
  const [plan] = await tx.select({ id: actionPlans.id, generatedAt: actionPlans.generatedAt }).from(actionPlans).where(eq(actionPlans.assessmentId, row.id)).limit(1);
  let reviewerName: string | null = null;
  if (row.reviewedBy) {
    // Reviewer names are shown as a capacity, not personal data; users table has no RLS.
    const [u] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, row.reviewedBy)).limit(1);
    reviewerName = u?.name ?? null;
  }

  const wKey = res.sizeClass === "large" ? "weightLarge" : res.sizeClass === "medium" ? "weightMedium" : "weightSmall";
  const used = (res.weightsUsed ?? {}) as Record<string, number>;
  const axes = axRows.map((a) => {
    const s = scoreRows.find((x) => x.axisCode === a.code);
    return {
      code: a.code, nameAr: a.nameAr, description: a.description,
      score: s?.score === null || s?.score === undefined ? null : Number(s.score),
      capped: !!s?.capped, applicableCount: s?.applicableCount ?? 0, answeredCount: s?.answeredCount ?? 0,
      weight: used[a.code] ?? (s?.score != null ? Number(a[wKey]) : null),
    };
  });

  const recs: RecView[] = recRows.map((r) => {
    const removed = (meta.get(`meta.removed.${r.ruleCode}`) as { code: string; why: string }[] | undefined) ?? [];
    return {
      id: r.id, ruleCode: r.ruleCode, needCode: r.needCode, needTitle: needTitle.get(r.needCode) ?? r.titleAr, severity: r.severity, priority: Number(r.priority),
      wave: r.wave, titleAr: r.titleAr, reasonAr: r.reasonAr, whyItMattersAr: r.whyItMattersAr, reference: r.reference, selfServiceHintAr: r.selfServiceHintAr,
      status: r.status, suppressedNote: r.suppressedNote, dismissReason: r.dismissReason, serviceRequestId: r.serviceRequestId,
      services: r.serviceCodes.map((c) => ({ code: c, nameAr: svcName.get(c) ?? c })),
      removed: removed.map((x) => ({ ...x, nameAr: svcName.get(x.code) ?? x.code })),
      manual: r.ruleCode.startsWith("MANUAL"),
    };
  });

  // Suggested package (deterministic from open recommendations + catalog).
  const pkgRows = await tx.select().from(packages).where(eq(packages.isActive, true)).orderBy(asc(packages.position));
  const items = await tx.select({ packageId: packageItems.packageId, code: services.code }).from(packageItems).innerJoin(services, eq(services.id, packageItems.serviceId));
  const engineRecs = recs
    .filter((r) => r.status === "open" || r.status === "accepted")
    .map((r) => ({ status: "open", serviceCodes: r.services.map((s) => s.code) }) as unknown as Recommendation);
  const waqfakRole = (meta.get("meta.waqfak_role") as string | undefined) ?? "none";
  const best = suggestPackage(
    engineRecs,
    pkgRows.map((p) => ({ code: p.code, nameAr: p.nameAr, serviceCodes: items.filter((i) => i.packageId === p.id).map((i) => i.code), targetSizeClasses: p.targetSizeClasses, isClosed: p.isClosed })),
    res.sizeClass,
    waqfakRole,
  );
  const pkgRow = best ? pkgRows.find((p) => p.code === best.code) : null;

  const conf = meta.get("meta.confidence") as { level: ConfidenceLevel; completeness: number; reasons: string[] } | undefined;

  return {
    row,
    number: assessmentNumber(row.id),
    waqf: waqf ?? null,
    result: {
      overallScore: Number(res.overallScore), maturityScore: Number(res.maturityScore), maturityLevel: res.maturityLevel, status: res.status,
      confidence: (res.confidence as ConfidenceLevel) ?? "low", evidenceRatio: Number(res.evidenceRatio ?? 0), knowledgeGaps: res.knowledgeGaps,
      sizeClass: res.sizeClass, computedType: res.computedType, computedAt: res.computedAt, strengths: res.strengths ?? [], weaknesses: res.weaknesses ?? [],
    },
    confidenceReasons: conf?.reasons ?? [],
    completeness: conf?.completeness ?? null,
    computedTypeReason: (meta.get("computed_type_reason") as string | undefined) ?? null,
    axes,
    flags: flagRows.map((f) => ({
      code: f.code, titleAr: f.def?.titleAr ?? f.code, referenceText: f.def?.referenceText ?? "", penaltyText: f.def?.penaltyText ?? null,
      penaltyCode: f.def?.penaltyCode ?? null, actionAr: f.def?.actionAr ?? null, severity: f.def?.severity ?? "critical", questionCode: f.questionCode, axisCode: f.def?.axisCode ?? null,
    })).sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1) || a.code.localeCompare(b.code)),
    recs,
    pkg: best && pkgRow ? { code: pkgRow.code, nameAr: pkgRow.nameAr, description: pkgRow.description, covers: best.covers } : null,
    review: parseReview(row.reviewNotes),
    reviewerName,
    actionPlan: plan ?? null,
  };
}

export const confidenceText = (c: ConfidenceLevel) => CONFIDENCE_LABEL[c] ?? c;

// ───────────── lists ─────────────

export type AssessmentListItem = {
  id: string; number: string; kind: string; status: string; waqfId: string | null; waqfName: string | null; waqfLabel: string | null;
  startedAt: Date; completedAt: Date | null; reviewedAt: Date | null; overallScore: number | null; resultStatus: string | null; maturityLevel: string | null; userId: string | null;
};

async function listWhere(tx: Tx, where: ReturnType<typeof and>) {
  const rows = await tx
    .select({
      a: assessments, waqfName: waqfs.name, overall: assessmentResults.overallScore, rstatus: assessmentResults.status, maturity: assessmentResults.maturityLevel,
    })
    .from(assessments)
    .leftJoin(waqfs, eq(waqfs.id, assessments.waqfId))
    .leftJoin(assessmentResults, eq(assessmentResults.assessmentId, assessments.id))
    .where(where)
    .orderBy(desc(assessments.startedAt))
    .limit(200);
  return rows.map<AssessmentListItem>((r) => ({
    id: r.a.id, number: assessmentNumber(r.a.id), kind: r.a.kind, status: r.a.status, waqfId: r.a.waqfId, waqfName: r.waqfName, waqfLabel: r.a.waqfLabel,
    startedAt: r.a.startedAt, completedAt: r.a.completedAt, reviewedAt: r.a.reviewedAt, overallScore: r.overall === null ? null : Number(r.overall),
    resultStatus: r.rstatus, maturityLevel: r.maturity, userId: r.a.userId,
  }));
}

/** My assessments (as respondent) plus those of waqfs where I hold assessment.view. */
export async function listMyAssessments(auth: Auth, waqfIdsWithView: string[]) {
  return read(auth, (tx) =>
    listWhere(tx, and(or(eq(assessments.userId, auth.user.id), waqfIdsWithView.length ? inArray(assessments.waqfId, waqfIdsWithView) : undefined), isNull(assessments.supersededBy))),
  );
}

export async function listWaqfAssessments(tx: Tx, waqfId: string) {
  return listWhere(tx, and(eq(assessments.waqfId, waqfId)));
}

export async function listReviewQueue(tx: Tx) {
  return listWhere(tx, and(eq(assessments.kind, "deep"), inArray(assessments.status, ["under_review", "published", "completed"])));
}

export async function listShares(tx: Tx, assessmentId: string) {
  return tx
    .select({ id: reportShares.id, expiresAt: reportShares.expiresAt, revokedAt: reportShares.revokedAt, views: reportShares.views, createdAt: reportShares.createdAt })
    .from(reportShares)
    .innerJoin(reports, eq(reports.id, reportShares.reportId))
    .where(eq(reports.assessmentId, assessmentId))
    .orderBy(desc(reportShares.createdAt));
}

export type { Viewer };

/** Waqfs where the user holds a waqf-level permission (memberships only; staff assignment is not "my waqf"). */
export async function myWaqfsWith(auth: Auth, perm: string): Promise<{ id: string; name: string; number: string }[]> {
  return read(auth, async (tx) => {
    const mems = await myWaqfIds(tx, auth.user.id);
    const out: { id: string; name: string; number: string }[] = [];
    for (const id of [...new Set(mems.map((m) => m.waqfId))]) {
      const acc = await loadWaqfAccess(tx, auth, id);
      if (acc && acc.perms.has(perm) && !acc.isBeneficiaryOnly) out.push({ id, name: acc.waqf.name, number: acc.waqf.internalNumber });
    }
    return out;
  });
}

/** Question counts for the start page (basic vs deep, profile excluded). */
export async function bankCounts(tx: Tx) {
  const id = await activeBankVersionId(tx);
  if (!id) return { quick: 0, deep: 0 };
  const qs = await tx.select({ depth: assessmentQuestions.depth, axis: assessmentQuestions.axisCode }).from(assessmentQuestions).where(eq(assessmentQuestions.bankVersionId, id));
  return { quick: qs.filter((q) => q.depth === "basic").length, deep: qs.length };
}
