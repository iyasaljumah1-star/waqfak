import "server-only";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { assessmentResults, assessments, needs, recommendationRules, services, users, waqfs } from "@/server/db/schema";

export async function listRules(tx: Tx) {
  const rows = await tx.select().from(recommendationRules).orderBy(asc(recommendationRules.code), desc(recommendationRules.version));
  const by = new Map<string, { latest: (typeof rows)[number]; published: (typeof rows)[number] | null; draft: (typeof rows)[number] | null; versions: number }>();
  for (const r of rows) {
    const e = by.get(r.code) ?? { latest: r, published: null, draft: null, versions: 0 };
    e.versions++;
    if (r.status === "published" && (!e.published || e.published.version < r.version)) e.published = r;
    if (r.status === "draft" && (!e.draft || e.draft.version < r.version)) e.draft = r;
    by.set(r.code, e);
  }
  return [...by.values()];
}

export async function loadRuleVersions(tx: Tx, code: string) {
  return tx
    .select({ r: recommendationRules, author: users.fullName })
    .from(recommendationRules)
    .leftJoin(users, eq(users.id, recommendationRules.updatedBy))
    .where(eq(recommendationRules.code, code))
    .orderBy(desc(recommendationRules.version));
}

export async function listNeeds(tx: Tx) {
  const ns = await tx.select().from(needs).orderBy(asc(needs.groupCode), asc(needs.code));
  const use = await tx.select({ code: recommendationRules.needCode, n: sql<number>`count(distinct ${recommendationRules.code})::int` }).from(recommendationRules).groupBy(recommendationRules.needCode);
  const by = new Map(use.map((u) => [u.code, u.n]));
  return ns.map((n) => ({ n, rules: by.get(n.code) ?? 0 }));
}

export async function serviceCodeOptions(tx: Tx) {
  return tx.select({ code: services.code, nameAr: services.nameAr, isActive: services.isActive }).from(services).orderBy(asc(services.code));
}

/** Recent computed assessments the staff member can see (RLS), to feed the rule test panel. */
export async function demoAssessments(tx: Tx) {
  const rows = await tx
    .select({ id: assessments.id, status: assessments.status, kind: assessments.kind, label: assessments.waqfLabel, waqf: waqfs.name, at: assessments.startedAt, score: assessmentResults.overallScore })
    .from(assessments)
    .innerJoin(assessmentResults, eq(assessmentResults.assessmentId, assessments.id))
    .leftJoin(waqfs, eq(waqfs.id, assessments.waqfId))
    .where(inArray(assessments.status, ["completed", "computed", "under_review", "published"]))
    .orderBy(desc(assessments.startedAt))
    .limit(20);
  return rows;
}
