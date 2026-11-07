import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { kbChunks, kbSourceReviews, kbSources } from "@/server/db/schema";
import { refMatchReviews, refMatchRuns, refSources, refVersions } from "@/server/db/schema/references";
import { audit, canonical } from "@/server/lib/audit";
import { rowHash } from "@/server/modules/admin/audit/chain";
import { lookupHash, sha256 } from "@/server/lib/crypto";
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

/**
 * The seal of a review: a keyed hash (the server's secret, lib/crypto lookupHash) over what the review says. Only code
 * holding the server's key — knowledge/review.ts — can produce it; a review inserted by other means, or an audit entry
 * computed from the public formula, has no valid seal and does not count (independent review N5-2, R2).
 */
export type ReviewKind = "kb_source_review" | "ref_match_review" | "fiqh_review";
export function reviewSeal(x: { kind: ReviewKind; id: string; reviewer: string; decision: string; target: string; role: string; textSha256: string; sessionId: string | null }): string {
  return lookupHash(`knowledge-review|${x.kind}|${x.id}|${x.reviewer}|${x.decision}|${x.target}|${x.role}|${x.textSha256}|${x.sessionId ?? ""}`);
}

/** The reviewer's request: who, and the session token their request carries (the cookie's value, never stored). */
export type ReviewActor = { userId: string; sessionToken: string; ip?: string | null; userAgent?: string | null };

/**
 * Runs `fn` with the request's session token visible to the database for this transaction only (app.session_token):
 * the database binds the review to that authenticated session or refuses it (security.sql, app_review_session).
 */
export async function withSessionToken<T>(tx: Tx, token: string, fn: () => Promise<T>): Promise<T> {
  if (!token) throw new ReviewRefused("لا جلسة مصادقة لهذه المراجعة.");
  await tx.execute(sql`select set_config('app.session_token', ${token}, true)`);
  const out = await fn();
  await tx.execute(sql`select set_config('app.session_token', '', true)`);
  return out;
}

/** What a source review attests: the source as a whole (its code, version and file) or one passage's text. */
export const sourceReviewText = (s: { refCode: string; version: string; sha256: string }, chunkText?: string | null) => chunkText ?? `${s.refCode}|${s.version}|${s.sha256}`;

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
export async function recordSourceReview(tx: Tx, actor: ReviewActor, x: SourceReviewInput) {
  const [s] = await tx.select().from(kbSources).where(eq(kbSources.id, x.sourceId)).limit(1);
  if (!s) throw new ReviewRefused("المصدر غير موجود.");
  if (s.supersededAt) throw new ReviewRefused("هذه نسخة سابقة من المصدر؛ تُراجع النسخة الحالية.");
  const role = roleOf(s);
  if (!(await mayReview(tx, actor.userId, role))) throw new ReviewRefused(`لا تحمل صلاحية «${REVIEW_ROLE_AR[role]}» لهذا المصدر.`);
  if (x.note.trim().length < 10) throw new ReviewRefused("اكتب ملاحظة المراجعة (عشرة أحرف على الأقل): ما قابلته وبماذا.");
  let reviewed = sourceReviewText(s);
  let locator: string | null = null;
  if (x.chunkId) {
    const [c] = await tx.select().from(kbChunks).where(and(eq(kbChunks.id, x.chunkId), eq(kbChunks.sourceId, s.id))).limit(1);
    if (!c) throw new ReviewRefused("المقطع ليس من هذا المصدر.");
    reviewed = sourceReviewText(s, c.text);
    locator = c.locator;
  }
  const [row] = await withSessionToken(tx, actor.sessionToken, () => tx.insert(kbSourceReviews).values({ sourceId: s.id, chunkId: x.chunkId ?? null, reviewerUserId: actor.userId, reviewerRole: role, decision: x.decision, note: x.note.trim() }).returning({ id: kbSourceReviews.id, sessionId: kbSourceReviews.sessionId }));
  const textSha256 = sha256(reviewed);
  const seal = reviewSeal({ kind: "kb_source_review", id: row.id, reviewer: actor.userId, decision: x.decision, target: `${s.id}|${x.chunkId ?? ""}`, role, textSha256, sessionId: row.sessionId });
  await audit(tx, {
    actorUserId: actor.userId, action: "knowledge.review.recorded", entityType: "kb_source_review", entityId: row.id, ip: actor.ip, userAgent: actor.userAgent,
    after: { refCode: s.refCode, version: s.version, sourceId: s.id, chunkId: x.chunkId ?? null, locator, role, decision: x.decision, note: x.note.trim(), textSha256, seal },
  });
  return { id: row.id, role };
}

/** Records the review of a registry comparison (accepting or rejecting the match of a stored official text). */
export async function recordComparisonReview(tx: Tx, actor: ReviewActor, x: { runId: string; decision: "accepted" | "rejected"; note: string }) {
  if (!(await mayReview(tx, actor.userId, "legal"))) throw new ReviewRefused("لا تحمل صلاحية «المراجعة النظامية».");
  if (x.note.trim().length < 10) throw new ReviewRefused("اكتب ملاحظة المراجعة (عشرة أحرف على الأقل).");
  const [run] = await tx.select({ r: refMatchRuns, v: refVersions, code: refSources.code }).from(refMatchRuns)
    .innerJoin(refVersions, eq(refVersions.id, refMatchRuns.versionId)).innerJoin(refSources, eq(refSources.id, refVersions.sourceId))
    .where(eq(refMatchRuns.id, x.runId)).limit(1);
  if (!run) throw new ReviewRefused("المقارنة غير موجودة.");
  const [row] = await withSessionToken(tx, actor.sessionToken, () => tx.insert(refMatchReviews).values({ runId: x.runId, reviewerUserId: actor.userId, decision: x.decision, note: x.note.trim(), reviewedAt: new Date() }).returning({ id: refMatchReviews.id, sessionId: refMatchReviews.sessionId }));
  const seal = reviewSeal({ kind: "ref_match_review", id: row.id, reviewer: actor.userId, decision: x.decision, target: x.runId, role: "legal", textSha256: run.v.sha256, sessionId: row.sessionId });
  await audit(tx, {
    actorUserId: actor.userId, action: "knowledge.review.recorded", entityType: "ref_match_review", entityId: row.id, ip: actor.ip, userAgent: actor.userAgent,
    after: { refId: run.code, versionId: run.v.id, versionLabel: run.v.label, versionSha256: run.v.sha256, runId: x.runId, decision: x.decision, note: x.note.trim(), textSha256: run.v.sha256, seal },
  });
  return { id: row.id };
}

/** A review as stored, and the sha256 of the text it must attest now (null: not checked here — the caller checks it). */
export type ReviewRef = { id: string; reviewerUserId: string; decision: string; target: string; role: string; sessionId: string | null; expectedTextSha256?: string | null };

/**
 * Which of these reviews are genuine (owner's order 2026-11-07, §2.2–2.3). All of:
 *  - its audit entry, by the reviewer, whose hash recomputes (lib/audit.ts writes it canonically: R1d);
 *  - the seal in that entry — the server's keyed hash over the review, including its session — matches the review as
 *    stored (N5-2): a row inserted by other means, or an entry computed from the public formula, has none;
 *  - the session it names existed, belonged to the reviewer and was valid when the review was made (R2);
 *  - the text it attests is the text as it stands now (a review of another text, or a tampered textSha256, does not
 *    carry over).
 * Anything short of that is not a review: it neither approves nor rejects.
 */
export async function auditedReviewIds(tx: Tx, kind: ReviewKind, reviews: ReviewRef[]): Promise<Set<string>> {
  if (!reviews.length) return new Set();
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const r = await tx.execute<{ id: string; at: Date | string; actor_user_id: string | null; action: string; entity_type: string; entity_id: string; waqf_id: string | null; before: unknown; after: unknown; prev_hash: string | null; hash: string; actor_roles: string[] | null }>(
    sql`select * from knowledge_audited_reviews(${kind}, ${sql.raw(`array[${reviews.map((x) => `'${x.id.replace(/[^0-9a-f-]/gi, "")}'::uuid`).join(",")}]`)})`,
  );
  const idList = sql.raw(`array[${reviews.map((x) => `'${x.id.replace(/[^0-9a-f-]/gi, "")}'::uuid`).join(",")}]`);
  const sess = await tx.execute<{ id: string; ok: boolean }>(sql`select * from knowledge_review_sessions(${kind}, ${idList})`);
  const sessionOk = new Set(sess.rows.filter((x) => x.ok).map((x) => x.id));
  const ok = new Set<string>();
  for (const a of r.rows) {
    const rv = byId.get(a.entity_id);
    if (!rv || a.actor_user_id !== rv.reviewerUserId) continue;
    if (!rv.sessionId || !sessionOk.has(rv.id)) continue;
    const row = { id: Number(a.id), at: new Date(a.at), actorUserId: a.actor_user_id, action: a.action, entityType: a.entity_type, entityId: a.entity_id, waqfId: a.waqf_id, before: a.before, after: a.after, prevHash: a.prev_hash, hash: a.hash, actorRoles: a.actor_roles };
    if (rowHash(row, canonical) !== a.hash) continue;
    const after = (a.after ?? {}) as { seal?: string; textSha256?: string };
    if (!after.seal || !after.textSha256) continue;
    if (rv.expectedTextSha256 !== undefined && rv.expectedTextSha256 !== null && after.textSha256 !== rv.expectedTextSha256) continue;
    if (reviewSeal({ kind, id: rv.id, reviewer: rv.reviewerUserId, decision: rv.decision, target: rv.target, role: rv.role, textSha256: after.textSha256, sessionId: rv.sessionId }) !== after.seal) continue;
    ok.add(rv.id);
  }
  return ok;
}

/**
 * Reviews of these sources whose author still may give them — an active, unlocked user who holds, now,
 * «knowledge.review.<field>» — and that are genuine (auditedReviewIds). A review loses its effect when the permission
 * is withdrawn or the account disabled (N3).
 */
export async function authorisedReviews(tx: Tx, sourceIds: string[]) {
  if (!sourceIds.length) return [];
  const rows = await tx.select().from(kbSourceReviews).where(inArray(kbSourceReviews.sourceId, sourceIds));
  if (!rows.length) return rows;
  const okUsers = (await tx.execute(sql`select distinct u.id::text || ':' || substr(p.key, 18) as k from users u
    join user_roles ur on ur.user_id = u.id join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id
    where p.key like 'knowledge.review.%' and u.status = 'active' and (u.locked_until is null or u.locked_until < now())`)) as unknown as { rows: { k: string }[] };
  const allowed = new Set(okUsers.rows.map((r) => r.k));
  // the text each review must attest now: the passage's text, or the source's code, version and file
  const srcs = await tx.select({ id: kbSources.id, refCode: kbSources.refCode, version: kbSources.version, sha256: kbSources.sha256 }).from(kbSources).where(inArray(kbSources.id, [...new Set(rows.map((r) => r.sourceId))]));
  const chunkIds = [...new Set(rows.map((r) => r.chunkId).filter((x): x is string => !!x))];
  const chunks = chunkIds.length ? await tx.select({ id: kbChunks.id, text: kbChunks.text }).from(kbChunks).where(inArray(kbChunks.id, chunkIds)) : [];
  const srcOf = new Map(srcs.map((x) => [x.id, x]));
  const textOf = new Map(chunks.map((c) => [c.id, c.text]));
  const expected = (r: (typeof rows)[number]) => {
    const s = srcOf.get(r.sourceId);
    if (!s) return "missing";
    return sha256(sourceReviewText(s, r.chunkId ? textOf.get(r.chunkId) ?? "missing" : null));
  };
  const genuine = await auditedReviewIds(tx, "kb_source_review", rows.map((r) => ({ id: r.id, reviewerUserId: r.reviewerUserId, decision: r.decision, target: `${r.sourceId}|${r.chunkId ?? ""}`, role: r.reviewerRole, sessionId: r.sessionId, expectedTextSha256: expected(r) })));
  // a genuine rejection keeps its effect after its author loses the permission (else withdrawing a reviewer would revive
  // an acceptance they had rejected: independent review, round 6); an acceptance needs its author's permission now
  return rows.filter((r) => genuine.has(r.id) && (r.decision === "rejected" || allowed.has(`${r.reviewerUserId}:${r.reviewerRole}`)));
}

export type QueueItem = { sourceId: string; chunkId: string | null; excerpt?: string | null; refCode: string; title: string; refKind: string; version: string; role: ReviewRole; locator: string | null; textOrigin: string | null; reason: string; services: string[] };

/**
 * What needs a human review before it can be cited, and why: each current source with no accepted review by its field,
 * and each passage taken from a file's text layer that also needs its own review (compared with its page). Passages
 * that can never be cited (OCR, degraded text, blocked pages) are listed with that reason instead.
 */
export async function reviewQueue(tx: Tx, opts: { refCodes?: string[]; passages?: boolean } = {}): Promise<QueueItem[]> {
  const sources = await tx.select().from(kbSources).where(opts.refCodes?.length ? and(isNull(kbSources.supersededAt), inArray(kbSources.refCode, opts.refCodes)) : isNull(kbSources.supersededAt));
  // only reviews that still count (authorised now, genuine) mark an item done (independent review UI1)
  const reviews = await authorisedReviews(tx, sources.map((s) => s.id));
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
      const chunks = await tx.select({ id: kbChunks.id, locator: kbChunks.locator, origin: kbChunks.textOrigin, page: kbChunks.pagePrinted, text: kbChunks.text }).from(kbChunks).where(eq(kbChunks.sourceId, s.id));
      const blocked = ((s.meta ?? {}) as { blockedPages?: string[] }).blockedPages ?? [];
      for (const c of chunks) {
        if (c.page && blocked.includes(c.page)) out.push({ ...base, chunkId: c.id, excerpt: c.text.slice(0, 600), locator: c.locator, textOrigin: c.origin, reason: "محجوب بملاحظة مختص: لا يُستشهد به." });
        else if (c.origin === "ocr") out.push({ ...base, chunkId: c.id, excerpt: c.text.slice(0, 600), locator: c.locator, textOrigin: c.origin, reason: "نص بالتعرف الضوئي: لا يُستشهد به؛ يلزم نص سليم للصفحة." });
        else if (c.origin === "text_layer" && !mine.some((r) => r.chunkId === c.id && r.decision === "accepted")) out.push({ ...base, chunkId: c.id, excerpt: c.text.slice(0, 600), locator: c.locator, textOrigin: c.origin, reason: "مستخرج من طبقة نص الملف: يلزم مقابلته بصورة الصفحة ومراجعته." });
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
