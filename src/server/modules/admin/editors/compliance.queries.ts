import "server-only";
import { asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  complianceSettingsAudit, obligationInstances, obligations, penaltySchedule, recommendationRules, regulatoryReferences, regulatoryRequirements, users, waqfs,
  criticalFlagDefs,
} from "@/server/db/schema";
import { waqfFacts } from "@/server/modules/compliance/engine";
import { applicable, explain, type ObligationRow, type WaqfFactBag } from "@/server/modules/compliance/pure";
import { buildRtm, type RtmRow } from "./pure";

export async function listObligations(tx: Tx) {
  const rows = await tx
    .select({ o: obligations, req: regulatoryRequirements.code })
    .from(obligations)
    .leftJoin(regulatoryRequirements, eq(regulatoryRequirements.id, obligations.requirementId))
    .orderBy(asc(obligations.code));
  const counts = await tx
    .select({ id: obligationInstances.obligationId, waqfs: sql<number>`count(distinct ${obligationInstances.waqfId})::int`, open: sql<number>`count(*) filter (where ${obligationInstances.status} in ('upcoming','due_soon','overdue'))::int` })
    .from(obligationInstances)
    .groupBy(obligationInstances.obligationId);
  const by = new Map(counts.map((c) => [c.id, c]));
  return rows.map((r) => ({ ...r, waqfs: by.get(r.o.id)?.waqfs ?? 0, open: by.get(r.o.id)?.open ?? 0 }));
}

export async function loadObligation(tx: Tx, id: string) {
  const [o] = await tx.select().from(obligations).where(eq(obligations.id, id)).limit(1);
  if (!o) return null;
  const log = await changeLog(tx, { entityId: id, limit: 20 });
  return { o, log };
}

export async function obligationFormOptions(tx: Tx) {
  const reqs = await tx.select({ id: regulatoryRequirements.id, code: regulatoryRequirements.code, title: regulatoryRequirements.title }).from(regulatoryRequirements).orderBy(asc(regulatoryRequirements.code));
  const pens = await tx.select({ code: penaltySchedule.code, titleAr: penaltySchedule.titleAr }).from(penaltySchedule).orderBy(asc(penaltySchedule.code));
  return { reqs, pens };
}

export async function listRequirements(tx: Tx) {
  return tx
    .select({ r: regulatoryRequirements, ref: regulatoryReferences.code, refName: regulatoryReferences.sourceName })
    .from(regulatoryRequirements)
    .leftJoin(regulatoryReferences, eq(regulatoryReferences.id, regulatoryRequirements.referenceId))
    .orderBy(asc(regulatoryRequirements.code));
}

export async function loadRequirement(tx: Tx, id: string) {
  const [r] = await tx.select().from(regulatoryRequirements).where(eq(regulatoryRequirements.id, id)).limit(1);
  if (!r) return null;
  const linked = await tx.select({ id: obligations.id, code: obligations.code, titleAr: obligations.titleAr }).from(obligations).where(eq(obligations.requirementId, id));
  const log = await changeLog(tx, { entityId: id, limit: 20 });
  return { r, linked, log };
}

export async function referenceOptions(tx: Tx) {
  return tx.select({ id: regulatoryReferences.id, code: regulatoryReferences.code, sourceName: regulatoryReferences.sourceName }).from(regulatoryReferences).orderBy(asc(regulatoryReferences.code));
}

export async function listReferences(tx: Tx) {
  const refs = await tx.select().from(regulatoryReferences).orderBy(asc(regulatoryReferences.code));
  const use = await tx.select({ id: regulatoryRequirements.referenceId, n: sql<number>`count(*)::int` }).from(regulatoryRequirements).groupBy(regulatoryRequirements.referenceId);
  const by = new Map(use.map((u) => [u.id, u.n]));
  return refs.map((r) => ({ r, requirements: by.get(r.id) ?? 0 }));
}

export async function loadReference(tx: Tx, id: string) {
  const [r] = await tx.select().from(regulatoryReferences).where(eq(regulatoryReferences.id, id)).limit(1);
  if (!r) return null;
  const reqs = await tx.select({ id: regulatoryRequirements.id, code: regulatoryRequirements.code, title: regulatoryRequirements.title }).from(regulatoryRequirements).where(eq(regulatoryRequirements.referenceId, id)).orderBy(asc(regulatoryRequirements.code));
  const log = await changeLog(tx, { entityId: id, limit: 20 });
  return { r, reqs, log };
}

export async function listPenalties(tx: Tx) {
  return tx.select().from(penaltySchedule).orderBy(asc(penaltySchedule.code));
}

export async function loadPenalty(tx: Tx, id: string) {
  const [p] = await tx.select().from(penaltySchedule).where(eq(penaltySchedule.id, id)).limit(1);
  if (!p) return null;
  const linked = await tx.select({ id: obligations.id, code: obligations.code, titleAr: obligations.titleAr }).from(obligations).where(eq(obligations.penaltyCode, p.code));
  const log = await changeLog(tx, { entityId: id, limit: 20 });
  return { p, linked, log };
}

export async function changeLog(tx: Tx, opts: { entityId?: string; limit?: number } = {}) {
  const q = tx
    .select({ l: complianceSettingsAudit, actor: users.fullName })
    .from(complianceSettingsAudit)
    .leftJoin(users, eq(users.id, complianceSettingsAudit.actorUserId))
    .$dynamic();
  if (opts.entityId) q.where(eq(complianceSettingsAudit.entityId, opts.entityId));
  return q.orderBy(desc(complianceSettingsAudit.at)).limit(opts.limit ?? 100);
}

export type ApplicabilityRow = { id: string; name: string; sizeClass: string | null; legalType: string | null; status: string; applies: boolean; reasons: string[] };

/** Applicability of one obligation definition across every waqf visible in the context (call with global access). */
export async function applicabilityAcrossWaqfs(tx: Tx, def: ObligationRow): Promise<ApplicabilityRow[]> {
  const ws = await tx.select({ id: waqfs.id, name: waqfs.name }).from(waqfs).where(isNull(waqfs.archivedAt)).orderBy(asc(waqfs.name));
  const out: ApplicabilityRow[] = [];
  for (const w of ws) {
    const f: WaqfFactBag | null = await waqfFacts(tx, w.id);
    if (!f) continue;
    out.push({ id: w.id, name: w.name, sizeClass: f.sizeClass, legalType: f.legalType, status: f.status, applies: applicable(def, f), reasons: explain(def, f) });
  }
  return out;
}

export async function instanceCounts(tx: Tx, obligationId: string) {
  const rows = await tx
    .select({ waqfId: obligationInstances.waqfId, status: obligationInstances.status })
    .from(obligationInstances)
    .where(eq(obligationInstances.obligationId, obligationId));
  const open = rows.filter((r) => ["upcoming", "due_soon", "overdue"].includes(r.status));
  return { total: rows.length, open: open.length, waqfs: new Set(open.map((r) => r.waqfId)).size };
}

export async function loadRtm(tx: Tx): Promise<RtmRow[]> {
  const requirements = await tx.select().from(regulatoryRequirements).orderBy(asc(regulatoryRequirements.code));
  const references = await tx.select({ id: regulatoryReferences.id, code: regulatoryReferences.code, sourceName: regulatoryReferences.sourceName, verificationStatus: regulatoryReferences.verificationStatus }).from(regulatoryReferences);
  const obls = await tx.select({ id: obligations.id, code: obligations.code, titleAr: obligations.titleAr, requirementId: obligations.requirementId, status: obligations.status }).from(obligations);
  const rules = await tx.select({ code: recommendationRules.code, titleAr: recommendationRules.titleAr, reference: recommendationRules.reference, status: recommendationRules.status }).from(recommendationRules).where(inArray(recommendationRules.status, ["published", "draft"]));
  const flags = await tx.select({ code: criticalFlagDefs.code, titleAr: criticalFlagDefs.titleAr, active: criticalFlagDefs.active }).from(criticalFlagDefs);
  return buildRtm({
    requirements: requirements.map((r) => ({ id: r.id, code: r.code, title: r.title, article: r.article, featureArea: r.featureArea, status: r.status, verificationStatus: r.verificationStatus, referenceId: r.referenceId, implementedAs: r.implementedAs ?? [] })),
    references, obligations: obls, rules, flags,
  });
}
