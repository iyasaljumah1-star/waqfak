/**
 * Unified knowledge engine against a real PostgreSQL database with the project's migrations and security.sql, and the
 * knowledge base loaded from data/knowledge/catalog.json (public reference texts). Runs only when
 * KE_TEST_DATABASE_OWNER_URL and KE_TEST_DATABASE_URL point to a dedicated «ke_test» database. Every case runs in a
 * transaction that is rolled back: the synthetic reviews it records never persist. Synthetic facts only.
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

vi.mock("server-only", () => ({}));

const OWNER = process.env.KE_TEST_DATABASE_OWNER_URL;
const APP = process.env.KE_TEST_DATABASE_OWNER_URL; // stage 11: cases run as the system role (SET LOCAL ROLE waqfak_system on the owner's connection, test cluster only); the fixtures reset to the owner
const enabled = !!OWNER && !!APP && /ke_test/.test(OWNER) && /ke_test/.test(APP);

describe.skipIf(!enabled)("unified knowledge engine (dedicated test database)", () => {
  let owner: Pool;
  let app: Pool;
  let schema: typeof import("../src/server/db/schema");
  let cases: typeof import("./knowledge/cases");
  let ke: typeof import("../src/server/knowledge/retrieve");
  let ing: typeof import("../src/server/knowledge/ingest");

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    app = new Pool({ connectionString: APP });
    schema = await import("../src/server/db/schema");
    cases = await import("./knowledge/cases");
    ke = await import("../src/server/knowledge/retrieve");
    ing = await import("../src/server/knowledge/ingest");
    const cat = await import("../src/server/knowledge/catalog");
    await cat.ingestCatalog(drizzle(owner, { schema, casing: "snake_case" })); // idempotent
  }, 120_000);
  afterAll(async () => {
    await owner?.end();
    await app?.end();
  });

  class Rollback extends Error {}
  async function rolledBack<T>(fn: (tx: import("../src/server/db").Tx) => Promise<T>): Promise<T> {
    const db = drizzle(app, { schema, casing: "snake_case" });
    let out: T | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
        await tx.execute(sql`set local role waqfak_system`);
        out = await fn(tx as unknown as import("../src/server/db").Tx);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    return out as T;
  }

  it("the knowledge base holds every catalog source with units", async () => {
    const n = await rolledBack(async (tx) => (await tx.execute(sql`select count(distinct ref_code)::int as n, count(*) filter (where superseded_at is null)::int as cur from kb_sources`)).rows[0] as { n: number; cur: number });
    expect(n.n).toBeGreaterThanOrEqual(49);
    expect(n.cur).toBe(49);
  });

  it("actual state: with no review on record, no case question finds anything citable", async () => {
    const rows = await rolledBack(async (tx) => {
      const out = [];
      for (const c of cases.CASES) out.push(await cases.runActual(tx, c));
      return out;
    });
    expect(rows.filter((r) => !r.pass).map((r) => `${r.id}: ${r.top}`)).toEqual([]);
    expect(rows.reduce((n, r) => n + r.retrieved, 0)).toBeGreaterThan(0);
  }, 120_000);

  for (const id of ["1a", "1b", "1c", "2", "3", "3b", "4", "4b", "5", "6a", "6b", "7", "8", "8b", "9a", "9b", "9c", "9d", "10", "11", "11b", "12", "13", "13b", "14a", "14b", "14c", "14d", "14e"]) {
    it(`mechanism case ${id} (test account, not a human review)`, async () => {
      const c = cases.CASES.find((x) => x.id === id)!;
      const row = await rolledBack((tx) => cases.runCase(tx, c));
      expect(row.pass, `${c.category}: ${row.note} | ${row.retrievedRef} ${row.locator} | ${row.decision}`).toBe(true);
    }, 60_000);
  }

  it("14. engine-core: the admin flag «verified» on regulatory_references does not make a source citable", async () => {
    await rolledBack(async (tx) => {
      await tx.update(schema.regulatoryReferences).set({ verificationStatus: "verified" }).where(eq(schema.regulatoryReferences.code, "NAZARA-REG"));
      await tx.update(schema.kbSources).set({ verificationStatus: "verified" }).where(and(eq(schema.kbSources.refCode, "NAZARA-REG"), isNull(schema.kbSources.supersededAt)));
      const ready = await ke.readyRefCodes(tx, ["NAZARA-REG"], "2026-11-06");
      expect(ready.has("NAZARA-REG")).toBe(false);
      const r = await ke.retrieve(tx, { question: "المادة 16 استثمار الوقف", service: "I01", asOf: "2026-11-06", refCodes: ["NAZARA-REG"] });
      expect(r.results.length).toBeGreaterThan(0);
      expect(r.citable).toEqual([]);
    });
  });

  it("14. engine-core: the pipeline retrieves only through the knowledge engine (no direct KB search left)", () => {
    const run = readFileSync(path.join(process.cwd(), "src/server/engine/pipeline/run.ts"), "utf8");
    expect(run).toContain('from "@/server/knowledge/retrieve"');
    expect(run).not.toMatch(/searchKb|knowledge\/search|verificationStatus === "verified"/);
    // owner's order 2026-11-07 (§4–§5): the engine drafts from the passages usable for a draft, each with its flags;
    // nothing reaches the model unless the draft basis is sufficient, also in sections that do not require a citation
    expect(run).toMatch(/const picked = kb\.draftSufficiency\.sufficient \? kb\.usable : \[\];/);
    expect(run).toContain("DRAFT_FLAG_AR[f]");
  });

  it("a corrected text never deletes the earlier version; the earlier one stays, superseded", async () => {
    await rolledBack(async (tx) => {
      const base = { refCode: "SYN-KE", version: "v1", title: "مرجع اصطناعي", issuer: null, refKind: "official_guide" as const, services: ["C01"], origin: "اختبار", originSha256: "x", textQuality: "good" as const, qualityNote: "" };
      const u = (t: string) => [{ locator: "صفحة الملف 1", articleNo: null, paragraphNo: null, pageFile: 1, pagePrinted: null, text: t, textOrigin: "text_layer" as const }];
      await ing.ingestUnits(tx as never, { ...base, units: u("نص أول عن حوكمة الوقف الاصطناعي") });
      await ing.ingestUnits(tx as never, { ...base, units: u("نص مصحح عن حوكمة الوقف الاصطناعي") });
      const rows = await tx.select().from(schema.kbSources).where(eq(schema.kbSources.refCode, "SYN-KE"));
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.supersededAt === null)).toHaveLength(1);
      await cases.reviewSource(tx, "SYN-KE", { passages: "all" });
      const r = await ke.retrieve(tx, { question: "حوكمة الوقف الاصطناعي", service: "C01", asOf: "2026-11-06", refCodes: ["SYN-KE"] });
      expect(r.results.map((x) => x.hit.text)).toEqual(["نص مصحح عن حوكمة الوقف الاصطناعي"]);
      const hist = await ke.retrieve(tx, { question: "حوكمة الوقف الاصطناعي", service: "C01", asOf: "2026-11-06", refCodes: ["SYN-KE"], historical: true });
      expect(hist.results.length).toBe(2);
    });
  });

  it("what the engine cites is never edited in place, even in the system context", async () => {
    const msg = (e: unknown) => String((e as Error & { cause?: Error })?.cause?.message ?? e);
    const a = await rolledBack(async (tx) => { await tx.execute(sql`update kb_chunks set text = 'نص معدل' where true`); }).catch((e) => e);
    expect(msg(a)).toMatch(/append-only/);
    const b = await rolledBack(async (tx) => { await tx.execute(sql`update kb_sources set services = '{Z99}' where ref_code = 'INVEST-RULES'`); }).catch((e) => e);
    expect(msg(b)).toMatch(/only superseded_at may change/);
    const c = await rolledBack(async (tx) => { await tx.execute(sql`delete from kb_sources where ref_code = 'Q100'`); }).catch((e) => e);
    expect(msg(c)).toMatch(/delete refused/);
  });

  it("a review is accepted only from a user holding the field's permission, in their own session, with its audit entry (N3/B5/P6c)", async () => {
    const msg = (e: unknown) => String((e as Error & { cause?: Error })?.cause?.message ?? (e as Error)?.message ?? e);
    const rv = await import("../src/server/knowledge/review");
    const NOPERM = "00000000-0000-4000-8000-00000000ae02";
    const lfs = async (tx: import("../src/server/db").Tx) => (await tx.select({ id: schema.kbSources.id }).from(schema.kbSources).where(and(eq(schema.kbSources.refCode, "GASTAT-LFS"), isNull(schema.kbSources.supersededAt))).limit(1))[0]!.id;
    // P6c: a user with no role (and locked) — refused by the application and by the database
    const e0 = await rolledBack(async (tx) => {
      await cases.testReviewer(tx, NOPERM, []);
      await cases.asOwner(tx, () => tx.execute(sql`update users set locked_until = now() + interval '1 day' where id = ${NOPERM}::uuid`)); // stage 11: a fixture
      const id = await lfs(tx);
      await cases.asUser(tx, NOPERM, () => rv.recordSourceReview(tx, cases.actorOf(NOPERM), { sourceId: id, decision: "accepted", note: "مراجعة من مستخدم بلا دور ومقفل" }));
    }).catch((e) => e);
    expect(msg(e0)).toMatch(/لا تحمل صلاحية/);
    const e1 = await rolledBack(async (tx) => {
      await cases.testReviewer(tx, NOPERM, []);
      const id = await lfs(tx);
      await cases.asUser(tx, NOPERM, () => tx.insert(schema.kbSourceReviews).values({ sourceId: id, reviewerUserId: NOPERM, reviewerRole: "data", decision: "accepted", note: "إدراج مباشر بلا صلاحية" }));
    }).catch((e) => e);
    expect(msg(e1)).toMatch(/lacks knowledge.review.data/);
    const e2 = await rolledBack(async (tx) => {
      await cases.testReviewer(tx, NOPERM, ["data"]);
      await cases.asOwner(tx, () => tx.execute(sql`update users set locked_until = now() + interval '1 day' where id = ${NOPERM}::uuid`)); // stage 11: a fixture
      const id = await lfs(tx);
      await cases.asUser(tx, NOPERM, () => tx.insert(schema.kbSourceReviews).values({ sourceId: id, reviewerUserId: NOPERM, reviewerRole: "data", decision: "accepted", note: "إدراج مباشر من مستخدم مقفل" }));
    }).catch((e) => e);
    expect(msg(e2)).toMatch(/not an active user/);
    // from the system context (seed, scripts, the engine): refused
    const e3 = await rolledBack(async (tx) => {
      await cases.testReviewer(tx);
      await tx.insert(schema.kbSourceReviews).values({ sourceId: await lfs(tx), reviewerUserId: cases.TEST_REVIEWER, reviewerRole: "data", decision: "accepted", note: "إدراج من سياق النظام" });
    }).catch((e) => e);
    expect(msg(e3)).toMatch(/recorded only by the reviewer/);
    // on another's behalf: refused
    const e4 = await rolledBack(async (tx) => {
      await cases.testReviewer(tx);
      await cases.testReviewer(tx, NOPERM, ["data"]);
      const id = await lfs(tx);
      await cases.asUser(tx, NOPERM, () => tx.insert(schema.kbSourceReviews).values({ sourceId: id, reviewerUserId: cases.TEST_REVIEWER, reviewerRole: "data", decision: "accepted", note: "إدراج باسم غيري" }));
    }).catch((e) => e);
    expect(msg(e4)).toMatch(/recorded only by the reviewer/);
    // without its audit entry: the database refuses to commit it (deferred check fired here)
    const e5 = await rolledBack(async (tx) => {
      await cases.testReviewer(tx);
      const id = await lfs(tx);
      await cases.asUser(tx, cases.TEST_REVIEWER, async () => {
        // in the reviewer's authenticated session (its token), so that what refuses it is the missing audit entry
        await tx.execute(sql`select set_config('app.session_token', ${(await import("../src/server/lib/crypto")).sessionHash(cases.actorOf(cases.TEST_REVIEWER).sessionToken)}, true)`);
        await tx.insert(schema.kbSourceReviews).values({ sourceId: id, reviewerUserId: cases.TEST_REVIEWER, reviewerRole: "data", decision: "accepted", note: "إدراج دون قيد في سجل التدقيق" });
      });
      await cases.checkDeferred(tx);
    }).catch((e) => e);
    expect(msg(e5)).toMatch(/has no audit entry/);
    // a registry acceptance from the system context or without permission: refused
    const e6 = await rolledBack(async (tx) => {
      const db = await import("../src/server/references/db-store");
      const reg = await import("../src/server/references/registry");
      const sid = await db.registerSource(tx, reg.getEntry("NZR")!);
      const snap = (await import("../src/server/references/snapshots"));
      const vid = await db.appendVersion(tx, sid, snap.versionFromSnapshot(snap.loadManifest().find((m) => m.id === "NZR/uqn-p18926")!, "2022-02-04", "اختبار"));
      const run = await db.appendMatchRun(tx, vid, { id: "r", versionId: vid, candidateLabel: "c", candidateSha256: "s", outcome: "identical", perArticle: { م16: "identical" }, ranAt: "2026-11-06T00:00:00Z" }, {});
      await db.appendReview(tx, run, { reviewer: "x", reviewerUserId: cases.TEST_REVIEWER, at: "2026-11-06T00:00:00Z", decision: "accepted", note: "قبول من سياق النظام" });
    }).catch((e) => e);
    // refused from the system context: no authenticated session (owner's order 2026-11-07), nor the reviewer's own session
    expect(msg(e6)).toMatch(/recorded only by the reviewer|authenticated session/);
    // the audit entry carries the reviewed text's fingerprint, on the hash chain
    await rolledBack(async (tx) => {
      await cases.reviewSource(tx, "GASTAT-LFS");
      const [a] = (await tx.execute(sql`select after, prev_hash, hash from audit_logs where action = 'knowledge.review.recorded' order by id desc limit 1`)).rows as { after: { textSha256: string; refCode: string }; prev_hash: string; hash: string }[];
      expect(a!.after.refCode).toBe("GASTAT-LFS");
      expect(a!.after.textSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a!.prev_hash).toBeTruthy();
    });
    // a review loses its effect when the permission is withdrawn, and when the account is disabled
    for (const withdraw of [sql`delete from user_roles where user_id = ${cases.TEST_REVIEWER}::uuid`, sql`update users set status = 'locked' where id = ${cases.TEST_REVIEWER}::uuid`, sql`update users set locked_until = now() + interval '1 hour' where id = ${cases.TEST_REVIEWER}::uuid`]) {
      await rolledBack(async (tx) => {
        await cases.reviewSource(tx, "GASTAT-LFS");
        const q = { question: "كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", service: "T02", asOf: "2026-11-06", kinds: ["statistical_source" as const] };
        expect((await ke.retrieve(tx, q)).citable.length).toBeGreaterThan(0);
        await cases.asOwner(tx, () => tx.execute(withdraw)); // stage 11: a fixture (the system role writes no identity rows)
        expect((await ke.retrieve(tx, q)).citable).toEqual([]);
      });
    }
    // a registry comparison: the same at use
    await rolledBack(async (tx) => {
      await cases.acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04");
      const q = { question: "ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: "2026-11-06", refCodes: ["NAZARA-REG"] };
      expect((await ke.retrieve(tx, q)).citable.length).toBeGreaterThan(0);
      await cases.asOwner(tx, () => tx.execute(sql`delete from user_roles where user_id = ${cases.TEST_REVIEWER}::uuid`)); // stage 11: a fixture
      expect((await ke.retrieve(tx, q)).citable).toEqual([]);
    });
  }, 120_000);

  it("the review queue lists what needs a human review and why; no account holds a review permission by default", async () => {
    const rv = await import("../src/server/knowledge/review");
    await rolledBack(async (tx) => {
      const q = await rv.reviewQueue(tx);
      expect(q.length).toBeGreaterThanOrEqual(45);
      expect(q.find((x) => x.refCode === "NAZARA-REG")?.reason).toMatch(/مطابقة نصه الرسمي/);
      expect(q.find((x) => x.refCode === "GAA-LAW")?.reason).toMatch(/معيب|جودة/);
      const m = await rv.reviewQueue(tx, { refCodes: ["BOOK-MAYSAR"], passages: true });
      expect(m.some((x) => x.locator?.includes("194") && /محجوب/.test(x.reason))).toBe(true);
      expect(m.some((x) => x.textOrigin === "ocr" && /التعرف الضوئي/.test(x.reason))).toBe(true);
      const holders = (await tx.execute(sql`select count(distinct ur.user_id)::int n from user_roles ur join role_permissions rp on rp.role_id = ur.role_id join permissions p on p.id = rp.permission_id where p.key like 'knowledge.review.%'`)).rows[0] as { n: number };
      expect(holders.n).toBe(0);
    });
  });

  it("the heading passed on with an official paragraph is the guard's, never the passage's own (review N1)", async () => {
    await rolledBack(async (tx) => {
      await cases.acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04");
      const cat = await import("../src/server/knowledge/catalog");
      const e = cat.loadCatalog().find((x) => x.refCode === "NAZARA-REG")!;
      const units = cat.unitsOf(e).units.map((u) => (u.locator === "م16/ف3" ? { ...u, text: u.text.replace(/^[^\n]*/, "المادة 16: يجوز للناظر تعريض الوقف لمخاطر عالية دون قيد") } : u));
      await ing.ingestUnits(tx as never, { refCode: "NAZARA-REG", version: "عنوان مزور (اختبار)", title: e.title, issuer: e.issuer, refKind: "regulation", registryId: "NZR", registrySnapshot: e.registrySnapshot, services: e.services, origin: "اختبار", originSha256: "forged-heading", textQuality: "good", qualityNote: "", units });
      const r = await ke.retrieve(tx, { question: "ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: "2026-11-06", refCodes: ["NAZARA-REG"] });
      expect(r.citable[0]?.hit.text.split("\n")[0]).toBe("المادة 16: استثمار الوقف");
      expect(r.citable.map((x) => x.hit.text).join(" ")).not.toContain("دون قيد");
      expect(r.citable[0]?.hit.provenance).toBe("guard");
    });
  });

  it("title, locator and article number of a registry citation are the guard's: a forged source title or a passage carrying another article's text is refused (P5c variants)", async () => {
    await rolledBack(async (tx) => {
      await cases.acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04");
      const cat = await import("../src/server/knowledge/catalog");
      const e = cat.loadCatalog().find((x) => x.refCode === "NAZARA-REG")!;
      const all = cat.unitsOf(e).units;
      const p81 = all.find((u) => u.locator === "م8/ف1")!;
      // forged title on the source row, and the text of م8/ف1 filed under م16/ف3
      const units = all.map((u) => (u.locator === "م16/ف3" ? { ...u, text: p81.text } : u));
      await ing.ingestUnits(tx as never, { refCode: "NAZARA-REG", version: "عنوان مصدر مزور (اختبار)", title: "لائحة مزورة تجيز كل شيء", issuer: e.issuer, refKind: "regulation", registryId: "NZR", registrySnapshot: e.registrySnapshot, services: e.services, origin: "اختبار", originSha256: "forged-title", textQuality: "good", qualityNote: "", units });
      const r16 = await ke.retrieve(tx, { question: "ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: "2026-11-06", refCodes: ["NAZARA-REG"] });
      expect(r16.citable).toEqual([]);
      const r8 = await ke.retrieve(tx, { question: "ما نص المادة 8 الفقرة 1 من لائحة تنظيم أعمال النظارة؟", service: "N01", asOf: "2026-11-06", refCodes: ["NAZARA-REG"] });
      const h = r8.citable[0]!;
      expect(h.hit.title).toBe("لائحة تنظيم أعمال النظارة");
      expect(h.hit.locator).toBe("م8/ف1");
      expect((h.decision as { label: string }).label).not.toContain("مزورة");
    });
  });

  it("a source review must name a real user, a known field and a decision", async () => {
    const msg = (e: unknown) => String((e as Error & { cause?: Error })?.cause?.message ?? e);
    const e1 = await rolledBack(async (tx) => {
      const [s] = await tx.select({ id: schema.kbSources.id }).from(schema.kbSources).limit(1);
      await tx.insert(schema.kbSourceReviews).values({ sourceId: s!.id, reviewerUserId: "00000000-0000-4000-8000-00000000dead", reviewerRole: "sharia", decision: "accepted", note: "مراجعة بلا مستخدم حقيقي" });
    }).catch((e) => e);
    expect(msg(e1)).toMatch(/foreign key|not an active user|recorded only by the reviewer/);
    const e2 = await rolledBack(async (tx) => {
      await cases.reviewSource(tx, "Q100");
      const [s] = await tx.select({ id: schema.kbSources.id }).from(schema.kbSources).limit(1);
      await cases.asUser(tx, cases.TEST_REVIEWER, () => tx.execute(sql`insert into kb_source_reviews (source_id, reviewer_user_id, reviewer_role, decision, note) values (${s!.id}, ${cases.TEST_REVIEWER}::uuid, 'anyone', 'maybe', 'مراجعة بقيم غير مقبولة')`));
    }).catch((e) => e);
    expect(msg(e2)).toMatch(/check constraint|lacks knowledge.review/);
  });

  it("source reviews are append-only, and a user session cannot write the knowledge base", async () => {
    const err = await rolledBack(async (tx) => {
      await cases.reviewSource(tx, "Q100");
      await tx.execute(sql`update kb_source_reviews set decision = 'accepted'`);
    }).catch((e: Error & { cause?: Error }) => e);
    expect(String((err as Error & { cause?: Error })?.cause?.message ?? err)).toMatch(/append-only|permission denied/);
    const db = drizzle(app, { schema, casing: "snake_case" });
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`set local role waqfak_system`); // stage 11: a writer that is not the owner
      await tx.execute(sql`select set_config('app.user_id', '00000000-0000-4000-8000-000000000001', true), set_config('app.global_access', '', true)`);
      await tx.update(schema.kbChunks).set({ text: "عبث" }).where(sql`true`);
      const [r] = (await tx.execute(sql`select count(*)::int as n from kb_chunks where text = 'عبث'`)).rows as { n: number }[];
      if (r!.n > 0) throw new Error("user session altered the knowledge base");
      throw new Rollback();
    })).rejects.toThrow(Rollback);
  });
});
