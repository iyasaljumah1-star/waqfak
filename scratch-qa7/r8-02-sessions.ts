/**
 * QA round 8 (re-run on 2ee5db0) — N5-2/R2 session binding, R1d. APP role on waqfak_ke_test; each scenario rolled back.
 * Server-side code (holding HASH_KEY) is used only where marked SERVER; attacker steps use SQL / lib/audit (public formula).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import * as schema from "@/server/db/schema";
import type { Tx } from "@/server/db";
import { audit } from "@/server/lib/audit";
import { recordSourceReview, authorisedReviews, sourceReviewText } from "@/server/knowledge/review";
import { retrieve } from "@/server/knowledge/retrieve";
import { asUser, testReviewer, testSession, actorOf } from "../tests/knowledge/cases";
import { sessionHash } from "@/server/lib/crypto";

const APP = process.env.KE_TEST_DATABASE_URL!;
if (!/ke_test/.test(APP)) throw new Error("not the ke_test database");
const pool = new Pool({ connectionString: APP });
const db = drizzle(pool, { schema, casing: "snake_case" });
const R = "00000000-0000-4000-8000-0000000072d1";
const R2 = "00000000-0000-4000-8000-0000000072d2";
const Q = { question: "كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", service: "T02", refCodes: ["GASTAT-LFS"], asOf: "2026-11-06" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
class Rollback extends Error {}
const note = "مراجعة اختبار QA الجولة السابعة";
const msg = (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message).slice(0, 220);

async function run(name: string, fn: (tx: Tx) => Promise<unknown>) {
  let out: unknown;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
      out = await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) out = { ERROR: msg(e) }; }
  console.log(name, JSON.stringify(out));
}
async function attempt(tx: Tx, fn: () => Promise<unknown>) {
  await tx.execute(sql`savepoint qa`);
  try { const v = await fn(); await tx.execute(sql`release savepoint qa`); return { ok: true, v }; }
  catch (e) { await tx.execute(sql`rollback to savepoint qa`); return { ok: false, err: msg(e) }; }
}
const lfs = async (tx: Tx) => (await tx.select().from(schema.kbSources).where(and(eq(schema.kbSources.refCode, "GASTAT-LFS"), isNull(schema.kbSources.supersededAt))).limit(1))[0]!;
const chunksOf = async (tx: Tx, sid: string) => tx.select({ id: schema.kbChunks.id, text: schema.kbChunks.text, locator: schema.kbChunks.locator }).from(schema.kbChunks).where(eq(schema.kbChunks.sourceId, sid));
const citable = async (tx: Tx) => {
  await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true), set_config('app.session_token', '', true)`);
  const r = await retrieve(tx, Q as never);
  return { citable: r.citable.length, first: r.citable[0] ? `${r.citable[0].hit.refCode} ${r.citable[0].hit.locator}` : null, usableDraft: r.usable.length };
};
/** SERVER: legit review of one chunk through recordSourceReview with the given token. */
const legit = (tx: Tx, uid: string, token: string, sourceId: string, chunkId: string | null, decision: "accepted" | "rejected" = "accepted") =>
  asUser(tx, uid, () => recordSourceReview(tx, { userId: uid, sessionToken: token }, { sourceId, chunkId, decision, note }));
async function reviewAll(tx: Tx, uid: string, token: string) {
  const s = await lfs(tx);
  const ids: string[] = [];
  for (const c of await chunksOf(tx, s.id)) ids.push((await legit(tx, uid, token, s.id, c.id)).id);
  return { s, ids };
}
/** ATTACKER: direct insert (with a token whose session the attacker made) + audit entry by the public formula. */
async function forge(tx: Tx, uid: string, sourceId: string, chunkId: string, token: string, seal: string | undefined, textSha: string) {
  return asUser(tx, uid, async () => {
    await tx.execute(sql`select set_config('app.session_token', ${token}, true)`); // attacker: the value stored in sessions.token_hash
    const [row] = (await tx.execute(sql`insert into kb_source_reviews (source_id, chunk_id, reviewer_user_id, reviewer_role, decision, note) values (${sourceId}::uuid, ${chunkId}::uuid, ${uid}::uuid, 'data', 'accepted', ${note}) returning id, session_id`)).rows as { id: string; session_id: string }[];
    const after: Record<string, unknown> = { sourceId, chunkId, role: "data", decision: "accepted", note, textSha256: textSha };
    if (seal !== undefined) after.seal = seal;
    await audit(tx, { actorUserId: uid, action: "knowledge.review.recorded", entityType: "kb_source_review", entityId: row!.id, after });
    await tx.execute(sql`set constraints all immediate`);
    await tx.execute(sql`set constraints all deferred`);
    return row;
  });
}

async function main() {
  await run("00 baseline (reviewer exists, no review)", async (tx) => { await testReviewer(tx, R, ["data"]); return citable(tx); });
  await run("01 SERVER legit passage reviews with the reviewer's real session token", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    const { ids } = await reviewAll(tx, R, actorOf(R).sessionToken);
    const sess = (await tx.execute(sql`select count(distinct session_id)::int n, bool_and(session_id is not null) all_bound from kb_source_reviews where id = any(${sql.raw(`array[${ids.map((i) => `'${i}'::uuid`).join(",")}]`)})`)).rows[0];
    return { reviews: ids.length, sess, ...(await citable(tx)) };
  });
  await run("01b SERVER source-level acceptance only (B13: approves no passage)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    const s = await lfs(tx);
    await legit(tx, R, actorOf(R).sessionToken, s.id, null);
    return citable(tx);
  });
  const tokenCase = async (tx: Tx, token: string) => { const s = await lfs(tx); const c = (await chunksOf(tx, s.id))[0]!; return attempt(tx, () => legit(tx, R, token, s.id, c.id)); };
  await run("02 no token", async (tx) => { await testReviewer(tx, R, ["data"]); return tokenCase(tx, ""); });
  await run("03 forged token", async (tx) => { await testReviewer(tx, R, ["data"]); return tokenCase(tx, "forged-" + "x".repeat(40)); });
  await run("04 expired session token", async (tx) => { await testReviewer(tx, R, ["data"]); return tokenCase(tx, await testSession(tx, R, { expired: true })); });
  await run("05 revoked session token", async (tx) => { await testReviewer(tx, R, ["data"]); return tokenCase(tx, await testSession(tx, R, { revoked: true })); });
  await run("06 non-MFA session token", async (tx) => { await testReviewer(tx, R, ["data"]); return tokenCase(tx, await testSession(tx, R, { mfa: false })); });
  await run("07 another user's valid token", async (tx) => {
    await testReviewer(tx, R, ["data"]); await testReviewer(tx, R2, ["data"]);
    return tokenCase(tx, actorOf(R2).sessionToken);
  });
  await run("08 the token's HASH used as the token", async (tx) => { await testReviewer(tx, R, ["data"]); return tokenCase(tx, sha(actorOf(R).sessionToken)); });
  await run("09 reviewer not staff (valid session)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await tx.execute(sql`update users set is_staff = false where id = ${R}::uuid`);
    return tokenCase(tx, actorOf(R).sessionToken);
  });
  await run("10 reviewer locked (valid session)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await tx.execute(sql`update users set locked_until = now() + interval '1 day' where id = ${R}::uuid`);
    return tokenCase(tx, actorOf(R).sessionToken);
  });
  await run("11 direct INSERT, valid token, NO audit entry", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    const s = await lfs(tx); const c = (await chunksOf(tx, s.id))[0]!;
    return attempt(tx, () => asUser(tx, R, async () => {
      await tx.execute(sql`select set_config('app.session_token', ${sessionHash(actorOf(R).sessionToken)}, true)`);
      await tx.execute(sql`insert into kb_source_reviews (source_id, chunk_id, reviewer_user_id, reviewer_role, decision, note) values (${s.id}::uuid, ${c.id}::uuid, ${R}::uuid, 'data', 'accepted', ${note})`);
      await tx.execute(sql`set constraints all immediate`);
    }));
  });
  // attacker (app role, no HASH_KEY) mints a sessions row for the reviewer with a token it knows, then inserts reviews
  const ATT = "qa7-attacker-known-token-" + "z".repeat(20);
  const ATT_STORED = sha(ATT); // attacker has no HASH_KEY: stores a hash it can compute (or any string)
  const mint = (tx: Tx) => tx.execute(sql`insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values (${R}::uuid, ${ATT_STORED}, true, now() + interval '1 hour', now() + interval '1 hour')`);
  for (const [name, seal] of [["no seal", undefined], ["random seal", "A".repeat(43)], ["sha256 of public formula", "SHA"]] as const) {
    await run(`12 ATTACKER minted session + direct insert of every passage + audit (${name})`, async (tx) => {
      await testReviewer(tx, R, ["data"]);
      await tx.execute(sql`select set_config('app.user_id', '', true)`);
      const minted = await attempt(tx, () => mint(tx));
      const s = await lfs(tx);
      let stored = 0;
      for (const c of await chunksOf(tx, s.id)) {
        const t = sha(sourceReviewText(s, c.text));
        const sl = seal === "SHA" ? sha(`knowledge-review|kb_source_review|x|${R}|accepted|${s.id}|${c.id}|data|${t}|`) : seal;
        const r = await attempt(tx, () => forge(tx, R, s.id, c.id, ATT_STORED, sl, t));
        if (r.ok) stored++; else return { minted, firstErr: r.err };
      }
      return { minted: minted.ok, stored, ...(await citable(tx)) };
    });
  }
  await run("13 ATTACKER minted session + presents its token where the server reads the cookie (SERVER code path, i.e. the web app with the minted cookie)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await tx.execute(sql`select set_config('app.user_id', '', true)`);
    await mint(tx);
    const r = await attempt(tx, () => reviewAll(tx, R, ATT));
    return { serverPathWithMintedToken: r.ok ? "ACCEPTED" : r.err, ...(await citable(tx)) };
  });
  await run("13b ATTACKER copies the reviewer's REAL session token_hash into app.session_token, direct insert + forged seal (no HASH_KEY)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await tx.execute(sql`select set_config('app.user_id', '', true)`);
    const [{ h }] = (await tx.execute(sql`select token_hash h from sessions where user_id = ${R}::uuid and revoked_at is null limit 1`)).rows as { h: string }[];
    const s = await lfs(tx); let stored = 0;
    for (const c of await chunksOf(tx, s.id)) { const t = sha(sourceReviewText(s, c.text)); const r = await attempt(tx, () => forge(tx, R, s.id, c.id, h, "A".repeat(43), t)); if (r.ok) stored++; else return { err: r.err }; }
    return { stolenHashBindsSession: stored > 0, stored, ...(await citable(tx)) };
  });
  await run("13c ATTACKER presents the stored token_hash itself as the cookie (server re-hashes)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await tx.execute(sql`select set_config('app.user_id', '', true)`);
    const [{ h }] = (await tx.execute(sql`select token_hash h from sessions where user_id = ${R}::uuid and revoked_at is null limit 1`)).rows as { h: string }[];
    const r = await attempt(tx, () => reviewAll(tx, R, h));
    return { serverPath: r.ok ? "ACCEPTED" : r.err, ...(await citable(tx)) };
  });
  await run("13d sessions RLS: reviewer session reads/changes others' sessions?", async (tx) => {
    await testReviewer(tx, R, ["data"]); await testReviewer(tx, R2, ["data"]);
    await tx.execute(sql`select set_config('app.user_id', ${R}, true), set_config('app.global_access', 'off', true)`);
    const seen = (await tx.execute(sql`select count(*)::int n, count(*) filter (where user_id <> ${R}::uuid)::int others from sessions`)).rows[0];
    const upd = await attempt(tx, () => tx.execute(sql`update sessions set revoked_at = now() where user_id = ${R2}::uuid`));
    const ins = await attempt(tx, () => tx.execute(sql`insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values (${R2}::uuid, 'x', true, now() + interval '1 hour', now() + interval '1 hour')`));
    return { seen, updateOthers: upd, insertForOther: ins };
  });
  await run("14 legit review, session revoked AFTER the review (should still count)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await reviewAll(tx, R, actorOf(R).sessionToken);
    await tx.execute(sql`update sessions set revoked_at = clock_timestamp() + interval '1 second', revoke_reason = 'qa' where user_id = ${R}::uuid`);
    return citable(tx);
  });
  await run("15 legit review, then session created_at moved after the review (attacker UPDATE on sessions)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await reviewAll(tx, R, actorOf(R).sessionToken);
    const u = await attempt(tx, () => tx.execute(sql`update sessions set created_at = clock_timestamp() + interval '1 hour' where user_id = ${R}::uuid`));
    return { update: u.ok, ...(await citable(tx)) };
  });
  await run("16 legit review, session row deleted afterwards (app role DELETE on sessions)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await reviewAll(tx, R, actorOf(R).sessionToken);
    const u = await attempt(tx, () => tx.execute(sql`delete from sessions where user_id = ${R}::uuid`));
    return { del: u, ...(await citable(tx)) };
  });
  await run("17 legit review, revoked_at set BEFORE the review time afterwards (attacker UPDATE, DoS)", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    await reviewAll(tx, R, actorOf(R).sessionToken);
    await tx.execute(sql`update sessions set revoked_at = now() - interval '1 hour' where user_id = ${R}::uuid`);
    return citable(tx);
  });
  // R1d
  await run("18 textSha256 mismatch: legit seal copied onto another passage's review", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    const s = await lfs(tx); const cs = await chunksOf(tx, s.id);
    const one = await legit(tx, R, actorOf(R).sessionToken, s.id, cs[0]!.id);
    const [a] = (await tx.execute(sql`select after from knowledge_audited_reviews('kb_source_review', array[${one.id}::uuid])`)).rows as { after: Record<string, string> }[];
    await tx.execute(sql`select set_config('app.user_id', '', true)`);
    await mint(tx);
    const others: unknown[] = [];
    for (const c of cs.slice(1)) others.push((await attempt(tx, () => forge(tx, R, s.id, c.id, ATT_STORED, a!.after.seal, a!.after.textSha256))).ok);
    const rv = await authorisedReviews(tx, [s.id]);
    return { stored: others.filter(Boolean).length, counted: rv.length, ...(await citable(tx)) };
  });
  await run("19 target mismatch: rejected review of passage A cannot be replayed as acceptance", async (tx) => {
    await testReviewer(tx, R, ["data"]);
    const s = await lfs(tx); const cs = await chunksOf(tx, s.id);
    const one = await legit(tx, R, actorOf(R).sessionToken, s.id, cs[0]!.id, "rejected");
    const [a] = (await tx.execute(sql`select after from knowledge_audited_reviews('kb_source_review', array[${one.id}::uuid])`)).rows as { after: Record<string, string> }[];
    await tx.execute(sql`select set_config('app.user_id', '', true)`);
    await mint(tx);
    await forge(tx, R, s.id, cs[0]!.id, ATT_STORED, a!.after.seal, a!.after.textSha256);
    const rv = await authorisedReviews(tx, [s.id]);
    return { counted: rv.map((r) => r.decision), ...(await citable(tx)) };
  });
  await run("20 rejection after permission loss keeps its effect", async (tx) => {
    await testReviewer(tx, R, ["data"]); await testReviewer(tx, R2, ["data"]);
    const { s } = await reviewAll(tx, R, actorOf(R).sessionToken);
    const before = await citable(tx);
    for (const c of await chunksOf(tx, s.id)) await legit(tx, R2, actorOf(R2).sessionToken, s.id, c.id, "rejected");
    const rejected = await citable(tx);
    await asUser(tx, "00000000-0000-4000-8000-00000000ad01", () => tx.execute(sql`delete from user_roles where user_id = ${R2}::uuid`));
    return { before, rejected, afterR2LosesPermission: await citable(tx) };
  });
  await run("21 source-level rejection (later) withdraws approved passages", async (tx) => {
    await testReviewer(tx, R, ["data"]); await testReviewer(tx, R2, ["data"]);
    const { s } = await reviewAll(tx, R, actorOf(R).sessionToken);
    await legit(tx, R2, actorOf(R2).sessionToken, s.id, null, "rejected");
    return citable(tx);
  });
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
