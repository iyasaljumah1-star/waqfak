/**
 * Review integrity (owner's order of 2026-11-08, «سادساً») on the dedicated «ke_test» database, each case in a rolled-back
 * transaction, with the APPLICATION role. Test accounts only — never human reviewers. What is checked, case by case:
 * the server counts a review only with its seal (HMAC of reviewer, session, passage, decision and the passage's text)
 * and a session valid at the review's time; the database refuses what it can refuse without the key, and where it
 * cannot (a forged session row, a missing seal), the server's refusal is what is proved — named as such.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";

vi.mock("server-only", () => ({}));

const APP = process.env.KE_TEST_DATABASE_OWNER_URL; // stage 11: cases run as the system role (SET LOCAL ROLE waqfak_system on the owner's connection, test cluster only); the fixtures reset to the owner
const enabled = !!APP && /ke_test/.test(APP) && !!process.env.KE_TEST_DATABASE_OWNER_URL;
type Tx = import("../src/server/db").Tx;

describe.skipIf(!enabled)("review integrity (dedicated test database)", () => {
  let app: Pool;
  let schema: typeof import("../src/server/db/schema");
  let C: typeof import("./knowledge/cases");
  let RV: typeof import("../src/server/knowledge/review");
  let G: typeof import("../src/server/knowledge/gate");
  beforeAll(async () => {
    app = new Pool({ connectionString: APP });
    schema = await import("../src/server/db/schema");
    C = await import("./knowledge/cases");
    RV = await import("../src/server/knowledge/review");
    G = await import("../src/server/knowledge/gate");
  });
  afterAll(async () => { await app?.end(); });

  class Rollback extends Error {}
  async function rolledBack<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const db = drizzle(app, { schema, casing: "snake_case" });
    let out: T | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
        await tx.execute(sql`set local role waqfak_system`);
        out = await fn(tx as unknown as Tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return out as T;
  }
  /** Runs a statement under a savepoint: "ACCEPTED" or the database's refusal. */
  async function attempt(tx: Tx, fn: () => Promise<unknown>): Promise<string> {
    await tx.execute(sql`savepoint t`);
    try {
      await fn();
      await tx.execute(sql`release savepoint t`);
      return "ACCEPTED";
    } catch (e) {
      await tx.execute(sql`rollback to savepoint t`);
      await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.session_token', '', true)`);
      return String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message).slice(0, 160);
    }
  }
  const R = "00000000-0000-4000-8000-00000000ae01"; // cases.ts TEST_REVIEWER
  async function passage(tx: Tx, refCode = "GASTAT-LFS") {
    const [c] = await tx.select({ id: schema.kbChunks.id, sourceId: schema.kbChunks.sourceId, text: schema.kbChunks.text, locator: schema.kbChunks.locator })
      .from(schema.kbChunks).innerJoin(schema.kbSources, eq(schema.kbSources.id, schema.kbChunks.sourceId))
      .where(and(eq(schema.kbSources.refCode, refCode), sql`${schema.kbSources.supersededAt} is null`)).limit(1);
    return c!;
  }
  /** A genuine review through the reviewers' own path; returns its id. */
  async function review(tx: Tx, c: { id: string; sourceId: string }, decision: "accepted" | "rejected" = "accepted", who = R) {
    return (await C.asUser(tx, who, () => RV.recordSourceReview(tx, C.actorOf(who), { sourceId: c.sourceId, chunkId: c.id, decision, note: "اختبار: مراجعة حساب اختبار" }))).id;
  }
  const standing = async (tx: Tx, id: string) => (await RV.passageStanding(tx, [id])).get(id);
  /** A review row inserted directly (as a database writer would), then an audit entry with the given seal. */
  async function direct(tx: Tx, c: { id: string; sourceId: string; text: string }, seal: (row: { id: string; session_id: string | null }) => string | null, o: { token?: string } = {}) {
    const { audit } = await import("../src/server/lib/audit");
    const { sessionHash, sha256 } = await import("../src/server/lib/crypto");
    const [s] = await tx.select().from(schema.kbSources).where(eq(schema.kbSources.id, c.sourceId));
    return C.asUser(tx, R, async () => {
      await tx.execute(sql`select set_config('app.session_token', ${o.token ?? sessionHash(C.actorOf(R).sessionToken)}, true)`);
      const [row] = (await tx.execute<{ id: string; session_id: string | null }>(sql`insert into kb_source_reviews (source_id, chunk_id, reviewer_user_id, reviewer_role, decision, note) values (${c.sourceId}::uuid, ${c.id}::uuid, ${R}::uuid, 'data', 'accepted', 'اختبار: إدراج مباشر') returning id, session_id`)).rows;
      await tx.execute(sql`select set_config('app.session_token', '', true)`);
      const textSha256 = sha256(RV.sourceReviewText(s!, c.text));
      const sl = seal(row!);
      await audit(tx, { actorUserId: R, action: "knowledge.review.recorded", entityType: "kb_source_review", entityId: row!.id, after: { textSha256, ...(sl ? { seal: sl } : {}) } });
      return { row: row!, textSha256 };
    });
  }

  it("a genuine review counts; its row cannot be modified (session, decision) nor deleted", async () => {
    const out = await rolledBack(async (tx) => {
      await C.testReviewer(tx, R, ["data"]);
      const c = await passage(tx);
      const id = await review(tx, c);
      return {
        approved: await standing(tx, c.id),
        session: await attempt(tx, () => tx.execute(sql`update kb_source_reviews set session_id = null where id = ${id}::uuid`)),
        decision: await attempt(tx, () => tx.execute(sql`update kb_source_reviews set decision = 'rejected' where id = ${id}::uuid`)),
        passage: await attempt(tx, () => tx.execute(sql`update kb_source_reviews set chunk_id = null where id = ${id}::uuid`)),
        deleted: await attempt(tx, () => tx.execute(sql`delete from kb_source_reviews where id = ${id}::uuid`)),
        after: await standing(tx, c.id),
      };
    });
    expect(out.approved).toBe("approved");
    for (const k of ["session", "decision", "passage", "deleted"] as const) expect(out[k], k).not.toBe("ACCEPTED");
    expect(out.after).toBe("approved");
  }, 90_000);

  it("seal: missing, wrong, for another session, or for another text — none counts", async () => {
    const out = await rolledBack(async (tx) => {
      await C.testReviewer(tx, R, ["data"]);
      const c = await passage(tx);
      const seal = (textSha256: string, session: (s: string | null) => string | null) => (row: { id: string; session_id: string | null }) =>
        RV.reviewSeal({ kind: "kb_source_review", id: row.id, reviewer: R, decision: "accepted", target: `${c.sourceId}|${c.id}`, role: "data", textSha256, sessionId: session(row.session_id) });
      const { sha256 } = await import("../src/server/lib/crypto");
      const [s] = await tx.select().from(schema.kbSources).where(eq(schema.kbSources.id, c.sourceId));
      const right = sha256(RV.sourceReviewText(s!, c.text));
      await direct(tx, c, () => null); // missing
      const missing = await standing(tx, c.id);
      await direct(tx, c, () => "A".repeat(43)); // wrong
      const wrong = await standing(tx, c.id);
      await direct(tx, c, seal(right, () => "00000000-0000-4000-8000-000000000000")); // another session
      const otherSession = await standing(tx, c.id);
      await direct(tx, c, seal("0".repeat(64), (x) => x)); // another text (the passage as it was, or another passage)
      const otherText = await standing(tx, c.id);
      // control: the same direct path with the right seal does count (the refusals above are the seal's)
      await direct(tx, c, seal(right, (x) => x));
      const control = await standing(tx, c.id);
      return { missing, wrong, otherSession, otherText, control };
    });
    expect(out).toMatchObject({ missing: "unreviewed", wrong: "unreviewed", otherSession: "unreviewed", otherText: "unreviewed", control: "approved" });
  }, 90_000);

  it("a session forged in the database (row + token hash set by the application role): the server does not count the review", async () => {
    const out = await rolledBack(async (tx) => {
      await C.testReviewer(tx, R, ["data"]);
      const c = await passage(tx);
      // the database cannot tell this session from a real one (no key): it records the review — the server's seal is
      // what refuses it (the residual named in the report: closing it in the database needs the role separation)
      // stage 11: neither the application nor the system role can write a session row; the forger here is the owner
      await C.asOwner(tx, () => tx.execute(sql`insert into sessions (user_id, token_hash, mfa_verified, idle_expires_at, absolute_expires_at) values (${R}::uuid, 'forged-hash', true, now() + interval '1 hour', now() + interval '1 hour')`));
      const ins = await attempt(tx, () => direct(tx, c, () => null, { token: "forged-hash" }));
      return { ins, standing: await standing(tx, c.id) };
    });
    expect(out.standing).toBe("unreviewed");
  }, 90_000);

  it("an impersonated review (app.user_id set to the reviewer, no valid session token) is refused by the database", async () => {
    const out = await rolledBack(async (tx) => {
      await C.testReviewer(tx, R, ["data"]);
      const c = await passage(tx);
      const r = await attempt(tx, () => C.asUser(tx, R, () => tx.execute(sql`insert into kb_source_reviews (source_id, chunk_id, reviewer_user_id, reviewer_role, decision, note) values (${c.sourceId}::uuid, ${c.id}::uuid, ${R}::uuid, 'data', 'accepted', 'اختبار: انتحال')`)));
      return { r, standing: await standing(tx, c.id) };
    });
    expect(out.r).toMatch(/authenticated session/);
    expect(out.standing).toBe("unreviewed");
  }, 90_000);

  it("a rejection by an account without the field's permission is refused; a genuine rejection withdraws the passage", async () => {
    const out = await rolledBack(async (tx) => {
      await C.testReviewer(tx, R, ["data"]);
      const X = "00000000-0000-4000-8000-0000000aa091";
      await C.testReviewer(tx, X, ["legal"]); // a reviewer, but not of this field
      const c = await passage(tx);
      await review(tx, c);
      const before = await standing(tx, c.id);
      const unauthorised = await attempt(tx, () => C.asUser(tx, X, () => RV.recordSourceReview(tx, C.actorOf(X), { sourceId: c.sourceId, chunkId: c.id, decision: "rejected", note: "اختبار: رفض من غير المختص" })));
      const afterUnauthorised = await standing(tx, c.id);
      const R2 = "00000000-0000-4000-8000-0000000aa092";
      await C.testReviewer(tx, R2, ["data"]);
      await review(tx, c, "rejected", R2);
      return { before, unauthorised, afterUnauthorised, afterGenuine: await standing(tx, c.id) };
    });
    expect(out.before).toBe("approved");
    expect(out.unauthorised).not.toBe("ACCEPTED");
    expect(out.afterUnauthorised).toBe("approved");
    expect(out.afterGenuine).toBe("rejected");
  }, 90_000);

  it("a passage is never changed in place, so a review never outlives its text; an output citing a superseded version is not approved", async () => {
    const out = await rolledBack(async (tx) => {
      await C.testReviewer(tx, R, ["data"]);
      const c = await passage(tx);
      await review(tx, c);
      const edit = await attempt(tx, () => tx.execute(sql`update kb_chunks set text = text || ' (معدل)' where id = ${c.id}::uuid`));
      const sections = [{ key: "a", title: "قسم", blocks: [{ type: "specialist", prompt: "", text: "نص", refs: [{ n: 1, refCode: "GASTAT-LFS", version: "v", locator: c.locator, chunkId: c.id }] }] }] as never;
      const okBefore = await G.finalBasisErrors(tx, sections, "2026-11-07");
      const dbBefore = (await tx.execute<{ n: number }>(sql`select sections_unreviewed_basis(${JSON.stringify(sections)}::jsonb) as n`)).rows[0]!.n;
      // the source is superseded by a new version: the reviewed passage is no longer a basis
      await tx.execute(sql`update kb_sources set superseded_at = now() where id = ${c.sourceId}::uuid`);
      const after = await G.finalBasisErrors(tx, sections, "2026-11-07");
      const dbAfter = (await tx.execute<{ n: number }>(sql`select sections_unreviewed_basis(${JSON.stringify(sections)}::jsonb) as n`)).rows[0]!.n;
      return { edit, okBefore, dbBefore, after, dbAfter };
    });
    expect(out.edit).not.toBe("ACCEPTED");
    expect(out.okBefore).toEqual([]);
    expect(out.dbBefore).toBe(0);
    expect(out.after.join(" ")).toMatch(/استُبدلت/);
    expect(out.dbAfter).toBeGreaterThan(0);
  }, 90_000);

  it("N7-14: a passage given to the model but not cited must be reviewed too (server and database)", async () => {
    const out = await rolledBack(async (tx) => {
      await C.testReviewer(tx, R, ["data"]);
      const c = await passage(tx);
      const u = await passage(tx, "SPA-CENSUS-2023"); // unreviewed
      await review(tx, c);
      const sections = [{ key: "a", title: "قسم", blocks: [{ type: "specialist", prompt: "", text: "نص [1]", refs: [{ n: 1, refCode: "GASTAT-LFS", version: "v", locator: c.locator, chunkId: c.id }], basis: [{ chunkId: c.id, refCode: "GASTAT-LFS", locator: c.locator }, { chunkId: u.id, refCode: "SPA-CENSUS-2023", locator: u.locator }] }] }] as never;
      return { server: await G.finalBasisErrors(tx, sections, "2026-11-07"), db: (await tx.execute<{ n: number }>(sql`select sections_unreviewed_basis(${JSON.stringify(sections)}::jsonb) as n`)).rows[0]!.n };
    });
    expect(out.server.join(" ")).toMatch(/SPA-CENSUS-2023/);
    expect(out.db).toBe(1);
  }, 90_000);

  it("G13: an id that is not a uuid counts as unreviewed — the guard does not fail with a cast error (fail safe)", async () => {
    const out = await rolledBack(async (tx) => {
      const sections = [{ key: "a", title: "قسم", blocks: [{ type: "specialist", prompt: "", text: "نص", dossierId: "not-a-uuid", refs: [{ n: 1, refCode: "X", version: "v", locator: "ص1", chunkId: "not-a-uuid" }] }] }];
      const db = await attempt(tx, () => tx.execute(sql`select sections_unreviewed_basis(${JSON.stringify(sections)}::jsonb) as n`));
      const n = (await tx.execute<{ n: number }>(sql`select sections_unreviewed_basis(${JSON.stringify(sections)}::jsonb) as n`)).rows[0]!.n;
      const server = await G.finalBasisErrors(tx, sections as never, "2026-11-07");
      return { db, n, server };
    });
    expect(out.db).toBe("ACCEPTED");
    expect(out.n).toBe(2);
    expect(out.server.length).toBeGreaterThan(0);
  }, 90_000);

  it("N7-15: a review's time is the database's clock, whatever the application sends", async () => {
    const out = await rolledBack(async (tx) => {
      await C.testReviewer(tx, R, ["data"]);
      const c = await passage(tx);
      const { sessionHash } = await import("../src/server/lib/crypto");
      return C.asUser(tx, R, async () => {
        await tx.execute(sql`select set_config('app.session_token', ${sessionHash(C.actorOf(R).sessionToken)}, true)`);
        const [row] = (await tx.execute<{ skew: number }>(sql`insert into kb_source_reviews (source_id, chunk_id, reviewer_user_id, reviewer_role, decision, note, at) values (${c.sourceId}::uuid, ${c.id}::uuid, ${R}::uuid, 'data', 'accepted', 'اختبار: وقت من التطبيق', '2020-01-01') returning abs(extract(epoch from (at - clock_timestamp())))::float as skew`)).rows;
        await tx.execute(sql`select set_config('app.session_token', '', true)`);
        return row!.skew;
      });
    });
    expect(out).toBeLessThan(5);
  }, 90_000);

  it("B5: an account does not change its own status (pending → active), staff flag or verification; its name it may", async () => {
    const out = await rolledBack(async (tx) => {
      const U = "00000000-0000-4000-8000-0000000aa093";
      await C.asOwner(tx, () => tx.insert(schema.users).values({ id: U, phone: "0500aa0093", fullName: "حساب اختبار", status: "pending" })); // stage 11: a fixture
      const self = (q: ReturnType<typeof sql>) => attempt(tx, () => C.asUser(tx, U, () => tx.execute(q)));
      return {
        status: await self(sql`update users set status = 'active' where id = ${U}::uuid`),
        staff: await self(sql`update users set is_staff = true where id = ${U}::uuid`),
        mfa: await self(sql`update users set mfa_enabled = true where id = ${U}::uuid`),
        counter: await self(sql`update users set failed_login_count = 0 where id = ${U}::uuid and failed_login_count <> 0 or id = ${U}::uuid and false`),
        phoneVerified: await self(sql`update users set phone_verified_at = now() where id = ${U}::uuid`),
        name: await self(sql`update users set full_name = 'اسم اختبار آخر' where id = ${U}::uuid`),
        // stage 11: the sign-in flows run on the authentication login; the system role (like the application role)
        // changes no account's standing at all (tests/db-roles.test.ts proves the authentication login can)
        system: await attempt(tx, () => tx.execute(sql`update users set status = 'active', phone_verified_at = now() where id = ${U}::uuid`)),
      };
    });
    // refused by the column privilege (stage 11) or, behind it, by the guard
    for (const k of ["status", "staff", "mfa", "phoneVerified"] as const) expect(out[k], k).toMatch(/does not (change its own|make itself)|permission denied for table users/);
    expect(out.name).toBe("ACCEPTED");
    expect(out.system).toMatch(/permission denied for table users/);
  }, 90_000);
  it("R8-10: a registry rejection counts only when sealed — an unsealed row naming a current legal holder withdraws nothing; a genuine one does", async () => {
    const { retrieve } = await import("../src/server/knowledge/retrieve");
    const Q = { question: "ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: "2026-11-01", refCodes: ["NAZARA-REG"], needBinding: true } as const;
    const out = await rolledBack(async (tx) => {
      const runId = await C.acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04"); // R holds «legal»
      const before = (await retrieve(tx, { ...Q, refCodes: [...Q.refCodes] })).citable.length;
      // an impersonation: a row naming R, inserted directly — no seal, no audit entry
      const forged = await attempt(tx, () => tx.execute(sql`insert into ref_match_reviews (run_id, reviewer_user_id, decision, note) values (${runId}::uuid, ${R}::uuid, 'rejected', 'اختبار: رفض منتحل')`));
      const afterForged = (await retrieve(tx, { ...Q, refCodes: [...Q.refCodes] })).citable.length;
      await C.asUser(tx, R, () => RV.recordComparisonReview(tx, C.actorOf(R), { runId, decision: "rejected", note: "اختبار: رفض حقيقي من حساب اختبار" }));
      const afterGenuine = (await retrieve(tx, { ...Q, refCodes: [...Q.refCodes] })).citable.length;
      return { before, forged, afterForged, afterGenuine };
    });
    expect(out.before).toBeGreaterThan(0);
    expect(out.forged).toBe("ACCEPTED"); // the table takes it (system context); the server does not count it
    expect(out.afterForged).toBe(out.before);
    expect(out.afterGenuine).toBe(0);
  }, 90_000);
});
