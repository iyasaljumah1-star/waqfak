import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { kbChunks, kbSourceReviews, kbSources } from "@/server/db/schema";
import { refMatchReviews, refMatchRuns, refSources, refVersions } from "@/server/db/schema/references";
import { audit } from "@/server/lib/audit";
import { sha256 } from "@/server/lib/crypto";
import { DEFAULT_REVIEW_ROLE, type RefKind, type ReviewRole } from "./policy";

/**
 * Human review of the knowledge base (owner's order 2026-11-06, §2.3 and §4). A review is what lets a text be cited,
 * so it is recorded only:
 *  - by a person, in their own session (the database refuses a review recorded from the system context or for another);
 *  - who is active, unlocked and holds «knowledge.review.<field>» for the field the source requires (checked here, again
 *    by the database at insertion, and again at every use — a review loses its effect when the permission is withdrawn
 *    or the account is disabled);
 *  - together with its entry in the hash-chained, append-only audit trail, which carries the sha256 of the very text
 *    reviewed (the database refuses to commit a review without that entry).
 * Reviewer permissions are granted to no account by default: the owner names reviewers by giving them one of the roles
 * «مراجع …» (authz/catalog.ts) from the users page.
 */
export const REVIEW_ROLES: readonly ReviewRole[] = ["legal", "sharia", "accounting", "data", "investment"];
export const REVIEW_ROLE_AR: Record<ReviewRole, string> = {
  legal: "المراجعة النظامية", sharia: "المراجعة الشرعية", accounting: "المراجعة المحاسبية", data: "مراجعة البيانات والإحصاء", investment: "مراجعة الاستثمار",
};

export class ReviewRefused extends Error {}

/** Whether a user may review a field now: active, not locked, holding the permission. */
export async function mayReview(tx: Tx, userId: string, role: ReviewRole): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from users u join user_roles ur on ur.user_id = u.id
    join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id
    where u.id = ${userId}::uuid and u.status = 'active' and (u.locked_until is null or u.locked_until < now())
    and p.key = ${`knowledge.review.${role}`}) as ok`);
  return !!r.rows[0]?.ok;
}

/** The field a source's reviewer must belong to. */
export function roleOf(s: { refKind: string; meta: unknown }): ReviewRole {
  return ((s.meta ?? {}) as { reviewRole?: ReviewRole }).reviewRole ?? DEFAULT_REVIEW_ROLE[s.refKind as RefKind] ?? "legal";
}

export type SourceReviewInput = { sourceId: string; chunkId?: string | null; decision: "accepted" | "rejected"; note: string };

/** Records a review of a source (or of one passage of it) by the session's user. */
export async function recordSourceReview(tx: Tx, actor: { userId: string; ip?: string | null; userAgent?: string | null }, x: SourceReviewInput) {
  const [s] = await tx.select().from(kbSources).where(eq(kbSources.id, x.sourceId)).limit(1);
  if (!s) throw new ReviewRefused("المصدر غير موجود.");
  if (s.supersededAt) throw new ReviewRefused("هذه نسخة سابقة من المصدر؛ تُراجع النسخة الحالية.");
  const role = roleOf(s);
  if (!(await mayReview(tx, actor.userId, role))) throw new ReviewRefused(`لا تحمل صلاحية «${REVIEW_ROLE_AR[role]}» لهذا المصدر.`);
  if (x.note.trim().length < 10) throw new ReviewRefused("اكتب ملاحظة المراجعة (عشرة أحرف على الأقل): ما قابلته وبماذا.");
  let reviewed = `${s.refCode}|${s.version}|${s.sha256}`;
  let locator: string | null = null;
  if (x.chunkId) {
    const [c] = await tx.select().from(kbChunks).where(and(eq(kbChunks.id, x.chunkId), eq(kbChunks.sourceId, s.id))).limit(1);
    if (!c) throw new ReviewRefused("المقطع ليس من هذا المصدر.");
    reviewed = c.text;
    locator = c.locator;
  }
  const [row] = await tx.insert(kbSourceReviews).values({ sourceId: s.id, chunkId: x.chunkId ?? null, reviewerUserId: actor.userId, reviewerRole: role, decision: x.decision, note: x.note.trim() }).returning({ id: kbSourceReviews.id });
  await audit(tx, {
    actorUserId: actor.userId, action: "knowledge.review.recorded", entityType: "kb_source_review", entityId: row.id, ip: actor.ip, userAgent: actor.userAgent,
    after: { refCode: s.refCode, version: s.version, sourceId: s.id, chunkId: x.chunkId ?? null, locator, role, decision: x.decision, note: x.note.trim(), textSha256: sha256(reviewed) },
  });
  return { id: row.id, role };
}

/** Records the review of a registry comparison (accepting or rejecting the match of a stored official text). */
export async function recordComparisonReview(tx: Tx, actor: { userId: string; ip?: string | null; userAgent?: string | null }, x: { runId: string; decision: "accepted" | "rejected"; note: string }) {
  if (!(await mayReview(tx, actor.userId, "legal"))) throw new ReviewRefused("لا تحمل صلاحية «المراجعة النظامية».");
  if (x.note.trim().length < 10) throw new ReviewRefused("اكتب ملاحظة المراجعة (عشرة أحرف على الأقل).");
  const [run] = await tx.select({ r: refMatchRuns, v: refVersions, code: refSources.code }).from(refMatchRuns)
    .innerJoin(refVersions, eq(refVersions.id, refMatchRuns.versionId)).innerJoin(refSources, eq(refSources.id, refVersions.sourceId))
    .where(eq(refMatchRuns.id, x.runId)).limit(1);
  if (!run) throw new ReviewRefused("المقارنة غير موجودة.");
  const [row] = await tx.insert(refMatchReviews).values({ runId: x.runId, reviewerUserId: actor.userId, decision: x.decision, note: x.note.trim(), reviewedAt: new Date() }).returning({ id: refMatchReviews.id });
  await audit(tx, {
    actorUserId: actor.userId, action: "knowledge.review.recorded", entityType: "ref_match_review", entityId: row.id, ip: actor.ip, userAgent: actor.userAgent,
    after: { refId: run.code, versionId: run.v.id, versionLabel: run.v.label, versionSha256: run.v.sha256, runId: x.runId, decision: x.decision, note: x.note.trim() },
  });
  return { id: row.id };
}

/** Which of these reviews have their audit entry (the read-time proof; see security.sql knowledge_audited_reviews). */
export async function auditedReviewIds(tx: Tx, kind: "kb_source_review" | "ref_match_review", ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const r = await tx.execute<{ id: string }>(sql`select knowledge_audited_reviews(${kind}, ${sql.raw(`array[${ids.map((x) => `'${x.replace(/[^0-9a-f-]/gi, "")}'::uuid`).join(",")}]`)}) as id`);
  return new Set(r.rows.map((x) => x.id));
}

export type QueueItem = { sourceId: string; chunkId: string | null; refCode: string; title: string; refKind: string; version: string; role: ReviewRole; locator: string | null; textOrigin: string | null; reason: string; services: string[] };

/**
 * What needs a human review before it can be cited, and why: each current source with no accepted review by its field,
 * and each passage taken from a file's text layer that also needs its own review (compared with its page). Passages
 * that can never be cited (OCR, degraded text, blocked pages) are listed with that reason instead.
 */
export async function reviewQueue(tx: Tx, opts: { refCodes?: string[]; passages?: boolean } = {}): Promise<QueueItem[]> {
  const sources = await tx.select().from(kbSources).where(opts.refCodes?.length ? and(isNull(kbSources.supersededAt), inArray(kbSources.refCode, opts.refCodes)) : isNull(kbSources.supersededAt));
  const reviews = sources.length ? await tx.select().from(kbSourceReviews).where(inArray(kbSourceReviews.sourceId, sources.map((s) => s.id))) : [];
  const out: QueueItem[] = [];
  for (const s of sources.sort((a, b) => a.refCode.localeCompare(b.refCode))) {
    const role = roleOf(s);
    const base = { sourceId: s.id, refCode: s.refCode, title: s.title, refKind: s.refKind, version: s.version, role, services: s.services };
    if (s.registryId) {
      const bad = s.textQuality !== "good" ? ` ونص الملف المحمّل معيب (${s.textQuality}): يلزم نص رسمي سليم.` : "";
      out.push({ ...base, chunkId: null, locator: null, textOrigin: "official_text", reason: `نص نظامي مسجل: يُعتمد بمراجعة مطابقة نصه الرسمي (مراجعة نظامية)، ولا يُستشهد إلا بنص حارس الاستشهاد.${bad}` });
      continue;
    }
    if (s.textQuality !== "good") {
      out.push({ ...base, chunkId: null, locator: null, textOrigin: null, reason: `جودة النص «${s.textQuality}»: لا يُستشهد به حتى يُستبدل بنص سليم (${s.qualityNote ?? ""})`.trim() });
      continue;
    }
    const mine = reviews.filter((r) => r.sourceId === s.id && r.reviewerRole === role);
    if (!mine.some((r) => r.chunkId === null && r.decision === "accepted")) out.push({ ...base, chunkId: null, locator: null, textOrigin: null, reason: `لا مراجعة مقبولة للمصدر من «${REVIEW_ROLE_AR[role]}».` });
    if (opts.passages) {
      const chunks = await tx.select({ id: kbChunks.id, locator: kbChunks.locator, origin: kbChunks.textOrigin, page: kbChunks.pagePrinted }).from(kbChunks).where(eq(kbChunks.sourceId, s.id));
      const blocked = ((s.meta ?? {}) as { blockedPages?: string[] }).blockedPages ?? [];
      for (const c of chunks) {
        if (c.page && blocked.includes(c.page)) out.push({ ...base, chunkId: c.id, locator: c.locator, textOrigin: c.origin, reason: "محجوب بملاحظة مختص: لا يُستشهد به." });
        else if (c.origin === "ocr") out.push({ ...base, chunkId: c.id, locator: c.locator, textOrigin: c.origin, reason: "نص بالتعرف الضوئي: لا يُستشهد به؛ يلزم نص سليم للصفحة." });
        else if (c.origin === "text_layer" && !mine.some((r) => r.chunkId === c.id && r.decision === "accepted")) out.push({ ...base, chunkId: c.id, locator: c.locator, textOrigin: c.origin, reason: "مستخرج من طبقة نص الملف: يلزم مقابلته بصورة الصفحة ومراجعته." });
      }
    }
  }
  return out;
}

export type ComparisonItem = { runId: string; refId: string; versionLabel: string; outcome: string; ranAt: string; reviews: { decision: string; at: string }[] };

/** Comparisons of stored official texts and what reviews they have (accepted only counts with authority and audit). */
export async function comparisonQueue(tx: Tx): Promise<ComparisonItem[]> {
  const runs = await tx.select({ r: refMatchRuns, label: refVersions.label, code: refSources.code }).from(refMatchRuns)
    .innerJoin(refVersions, eq(refVersions.id, refMatchRuns.versionId)).innerJoin(refSources, eq(refSources.id, refVersions.sourceId));
  const reviews = runs.length ? await tx.select().from(refMatchReviews).where(inArray(refMatchReviews.runId, runs.map((x) => x.r.id))) : [];
  return runs.map((x) => ({
    runId: x.r.id, refId: x.code, versionLabel: x.label, outcome: x.r.outcome, ranAt: x.r.ranAt.toISOString(),
    reviews: reviews.filter((v) => v.runId === x.r.id).map((v) => ({ decision: v.decision, at: v.reviewedAt.toISOString() })),
  }));
}
