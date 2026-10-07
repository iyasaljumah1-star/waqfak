import "server-only";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  assessmentResults, assessments, axisScores, criticalFlagDefs, criticalFlags, facts, holidays, recommendationRules, recommendations,
  serviceRequests, services, settings, waqfs,
} from "../../db/schema";
import { computeAssessment, scoreAnswer, type AssessmentOutput, type MaturityBand } from "../../engines/assessment";
import { runRules, type RecContext, type Rule, type ServiceInfo } from "../../engines/recommendations";
import { todayISO } from "../../engines/dates";
import { audit } from "../../lib/audit";
import { notify } from "../notify";
import { combinedConfidence, deriveBaseFacts, factsObject, STATUS_VIEW, type WaqfProfile } from "./facts";
import { loadAnswers, loadBank } from "./queries";

type Lic = { key: string; number?: string; active?: boolean; expiresOn?: string };

/** Licenses that unlock license-gated services: active (not explicitly false), with a number, not expired. */
export function activeLicenseKeys(value: unknown, today: string): string[] {
  if (!Array.isArray(value)) return [];
  return (value as Lic[]).filter((l) => l && l.key && l.active !== false && !!l.number && (!l.expiresOn || l.expiresOn >= today)).map((l) => l.key);
}

/** Latest published version of each rule, in a stable order (by code). */
export async function loadActiveRules(tx: Tx): Promise<{ rules: Rule[]; maxVersion: number }> {
  const rows = await tx.select().from(recommendationRules).where(eq(recommendationRules.status, "published"));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.code) || latest.get(r.code)!.version < r.version) latest.set(r.code, r);
  const rules = [...latest.values()]
    .sort((a, b) => a.code.localeCompare(b.code, "en"))
    .map<Rule>((r) => ({
      id: r.id, code: r.code, version: r.version, titleAr: r.titleAr, condition: r.condition, needCode: r.needCode, severity: r.severity,
      urgencyDays: r.urgencyDays, leverage: Number(r.leverage), reasonAr: r.reasonAr, whyItMattersAr: r.whyItMattersAr, reference: r.reference,
      serviceCodes: r.serviceCodes ?? [], suppressIf: r.suppressIf ?? null, selfServiceHintAr: r.selfServiceHintAr,
    }));
  return { rules, maxVersion: Math.max(0, ...rules.map((r) => r.version)) };
}

export type ComputeSummary = { overallScore: number; status: AssessmentOutput["status"]; flags: number; recommendations: number };

/**
 * Computes an assessment from the database and persists every derived row. Deterministic and idempotent:
 * previous results/axis scores/flags/facts/engine recommendations of this assessment are replaced.
 * Reviewer work survives a recompute: manual recommendations stay and dismissals carry over by rule code.
 */
export async function computeAndPersist(tx: Tx, assessmentId: string, actor: { userId: string | null; ip?: string; userAgent?: string }): Promise<ComputeSummary> {
  const [a] = await tx.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  if (!a) throw new Error("assessment not found");
  const today = todayISO();

  const { axes, questions } = await loadBank(tx, a.bankVersionId);
  const answers = await loadAnswers(tx, a.id);
  const flagDefRows = await tx.select().from(criticalFlagDefs).where(eq(criticalFlagDefs.active, true));
  const settingRows = await tx.select().from(settings).where(inArray(settings.key, ["assessment.maturity_bands", "company.licenses"]));
  const setting = (k: string) => settingRows.find((s) => s.key === k)?.value;
  const holidaySet = new Set((await tx.select({ day: holidays.day }).from(holidays)).map((h) => h.day));

  let waqf: (WaqfProfile & { id: string; name: string }) | null = null;
  if (a.waqfId) {
    const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, a.waqfId)).limit(1);
    if (w) waqf = { ...w, assetsEstimatedValue: w.assetsEstimatedValue };
  }

  const derived = deriveBaseFacts({ answers, waqf, holidays: holidaySet, today });
  const baseFacts = factsObject(derived);
  const bands = Array.isArray(setting("assessment.maturity_bands")) ? (setting("assessment.maturity_bands") as MaturityBand[]) : undefined;
  const depth = a.kind === "deep" ? "deep" : "basic";

  const out = computeAssessment({
    axes, questions, answers, depth, baseFacts, maturityBands: bands,
    flagDefs: flagDefRows.map((f) => ({ code: f.code, titleAr: f.titleAr, axisCode: f.axisCode, severity: f.severity })),
  });

  // ── recommendations
  const { rules, maxVersion } = await loadActiveRules(tx);
  const svcRows = await tx.select().from(services);
  const svcInfo: ServiceInfo[] = svcRows.map((s) => ({ code: s.code, nameAr: s.nameAr, conflictRule: s.conflictRule, requiresLicenseKey: s.requiresLicenseKey, isActive: s.isActive }));
  let openServiceCodes: string[] = [];
  if (a.waqfId) {
    const open = await tx
      .select({ code: services.code })
      .from(serviceRequests)
      .innerJoin(services, eq(services.id, serviceRequests.serviceId))
      .where(and(eq(serviceRequests.waqfId, a.waqfId), notInArray(serviceRequests.status, ["completed", "closed", "cancelled", "rejected"])));
    openServiceCodes = [...new Set(open.map((o) => o.code))];
  }
  const waqfakRole = (waqf?.waqfakRole ?? "none") as RecContext["waqfakRole"];
  const ctx: RecContext = {
    waqfakRole,
    activeLicenses: activeLicenseKeys(setting("company.licenses"), today),
    hasActiveLitigation: waqf ? !!waqf.hasActiveLitigation || out.facts.litigation === "yes" : out.facts.litigation === "yes",
    gaaIsNazir: waqf ? waqf.nazirMode === "gaa" : out.facts.nazir_kind === "gaa",
    openServiceCodes,
  };
  const recs = runRules(rules, { ...out.facts, waqfak_role: waqfakRole }, svcInfo, ctx);

  // ── confidence (completeness + evidence)
  const applicable = new Set(out.applicableQuestions);
  let applicableScored = 0;
  let known = 0;
  let unknown = 0;
  for (const q of questions) {
    if (!applicable.has(q.code) || q.axisCode === "P" || q.answerType === "text" || q.answerType === "date") continue;
    const s = scoreAnswer(q, answers[q.code]);
    if (s.na) continue;
    applicableScored++;
    if (s.unknown) unknown++;
    else if (s.score !== null) known++;
  }
  const conf = combinedConfidence({ engineConfidence: out.confidence, applicableScored, knownAnswered: known, unknownCount: unknown });

  // ── replace previous derived rows
  const [prevResult] = await tx.select({ id: assessmentResults.assessmentId }).from(assessmentResults).where(eq(assessmentResults.assessmentId, a.id)).limit(1);
  const prevRecs = await tx.select().from(recommendations).where(eq(recommendations.assessmentId, a.id));
  const carried = new Map(prevRecs.filter((r) => !r.ruleCode.startsWith("MANUAL")).map((r) => [r.ruleCode, r]));
  await tx.delete(assessmentResults).where(eq(assessmentResults.assessmentId, a.id));
  await tx.delete(axisScores).where(eq(axisScores.assessmentId, a.id));
  await tx.delete(criticalFlags).where(eq(criticalFlags.assessmentId, a.id));
  await tx.delete(facts).where(eq(facts.assessmentId, a.id));
  await tx.delete(recommendations).where(and(eq(recommendations.assessmentId, a.id), sql`${recommendations.ruleCode} not like 'MANUAL%'`));

  await tx.insert(assessmentResults).values({
    assessmentId: a.id, waqfId: a.waqfId, overallScore: String(out.overallScore), maturityScore: String(out.maturityScore), maturityLevel: out.maturityLevel,
    status: out.status, confidence: conf.level, evidenceRatio: String(out.evidenceRatio), knowledgeGaps: out.knowledgeGaps.length,
    sizeClass: out.sizeClass, computedType: out.computedType.type, weightsUsed: out.weightsUsed, strengths: out.strengths, weaknesses: out.weaknesses,
  });
  if (out.axisScores.length) {
    await tx.insert(axisScores).values(out.axisScores.map((s) => ({
      assessmentId: a.id, axisCode: s.axisCode, waqfId: a.waqfId, score: s.score === null ? null : String(s.score), capped: s.capped,
      applicableCount: s.applicableCount, answeredCount: s.answeredCount,
    })));
  }
  if (out.flags.length) {
    await tx.insert(criticalFlags).values(out.flags.map((f) => ({
      assessmentId: a.id, flagCode: f.code, waqfId: a.waqfId, questionCode: f.questionCode,
      evidence: f.questionCode ? `الإجابة: ${JSON.stringify(answers[f.questionCode]?.value ?? null)}` : "مستنتج من بيانات الوقف أو التواريخ",
    })));
  }

  const derivedSource = new Map(derived.map((d) => [d.key, d.source]));
  const answerKeys = new Set(questions.map((q) => q.factKey).filter(Boolean) as string[]);
  const factRows: (typeof facts.$inferInsert)[] = [];
  for (const [key, value] of Object.entries(out.facts)) {
    if (value === undefined) continue;
    const source = derivedSource.get(key) ?? (answerKeys.has(key) || /^(ans|score|unknown)_/.test(key) ? "answer" : "derived");
    factRows.push({ assessmentId: a.id, key, value: value as never, source });
  }
  factRows.push({ assessmentId: a.id, key: "computed_type_reason", value: out.computedType.reason as never, source: "derived" });
  factRows.push({ assessmentId: a.id, key: "meta.confidence", value: conf as never, source: "derived" });
  factRows.push({ assessmentId: a.id, key: "meta.waqfak_role", value: waqfakRole as never, source: waqf ? "waqf_profile" : "derived" });
  factRows.push({ assessmentId: a.id, key: "meta.rec_context", value: { ...ctx, today } as never, source: "derived" });
  for (const r of recs) if (r.removedServices.length) factRows.push({ assessmentId: a.id, key: `meta.removed.${r.ruleCode}`, value: r.removedServices as never, source: "derived" });
  for (let i = 0; i < factRows.length; i += 200) await tx.insert(facts).values(factRows.slice(i, i + 200));

  if (recs.length) {
    await tx.insert(recommendations).values(recs.map((r) => {
      const prev = carried.get(r.ruleCode);
      const keep = prev && (prev.status === "dismissed" || prev.status === "converted" || prev.status === "accepted");
      return {
        assessmentId: a.id, waqfId: a.waqfId, ruleId: r.ruleId, ruleCode: r.ruleCode, ruleVersion: r.ruleVersion, needCode: r.needCode,
        severity: r.severity, priority: String(r.priority), wave: r.wave, titleAr: r.titleAr, reasonAr: r.reasonAr, whyItMattersAr: r.whyItMattersAr,
        reference: r.reference, serviceCodes: r.serviceCodes, selfServiceHintAr: r.selfServiceHintAr,
        status: keep ? prev!.status : r.status, suppressedNote: r.suppressedNote, dismissReason: keep ? prev!.dismissReason : null,
        serviceRequestId: keep ? prev!.serviceRequestId : null,
      };
    }));
    if (!prevResult) {
      await tx.update(recommendationRules).set({ timesFired: sql`${recommendationRules.timesFired} + 1` }).where(inArray(recommendationRules.id, recs.map((r) => r.ruleId)));
    }
  }

  const newStatus = a.kind === "deep" ? (a.reviewedAt ? "published" : "under_review") : "completed";
  const respondentRole = typeof answers.P12?.value === "string" ? (answers.P12.value as string) : a.respondentRole;
  await tx.update(assessments).set({ status: newStatus, completedAt: a.completedAt ?? new Date(), ruleSetVersion: maxVersion, respondentRole, currentAxis: "done" }).where(eq(assessments.id, a.id));

  await audit(tx, {
    actorUserId: actor.userId, actorLabel: actor.userId ? null : "زائر (تقييم مجهول)", action: prevResult ? "assessment.recompute" : "assessment.compute",
    entityType: "assessment", entityId: a.id, waqfId: a.waqfId, ip: actor.ip, userAgent: actor.userAgent,
    after: { overall: out.overallScore, status: out.status, flags: out.flags.map((f) => f.code), recommendations: recs.length, bankVersionId: a.bankVersionId, ruleSetVersion: maxVersion },
  });

  if (a.userId && !prevResult) {
    await notify(a.userId, "assessment.ready", {
      waqf: waqf?.name ?? a.waqfLabel ?? "تقييمك",
      score: Math.round(out.overallScore),
      status: STATUS_VIEW[out.status]?.label ?? out.status,
    }, { waqfId: a.waqfId, link: `/app/assessments/${a.id}`, tx });
  }

  return { overallScore: out.overallScore, status: out.status, flags: out.flags.length, recommendations: recs.length };
}
