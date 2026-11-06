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
const APP = process.env.KE_TEST_DATABASE_URL;
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

  for (const id of ["1a", "1b", "1c", "2", "3", "3b", "4", "4b", "5", "6a", "6b", "7", "8", "8b", "9a", "9b", "9c", "10", "11", "11b", "12", "13", "13b"]) {
    it(`case ${id}`, async () => {
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
    expect(run).toContain("kb.citable.map");
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

  it("a review counts only from an active user holding «knowledge.review.<field>» (review N3)", async () => {
    const msg = (e: unknown) => String((e as Error & { cause?: Error })?.cause?.message ?? e);
    const NOPERM = "00000000-0000-4000-8000-00000000ae02";
    const e1 = await rolledBack(async (tx) => {
      await cases.syntheticReviewer(tx, NOPERM, []);
      const [s] = await tx.select({ id: schema.kbSources.id }).from(schema.kbSources).where(eq(schema.kbSources.refCode, "GASTAT-LFS")).limit(1);
      await tx.insert(schema.kbSourceReviews).values({ sourceId: s!.id, reviewerUserId: NOPERM, reviewerRole: "data", decision: "accepted", note: "مراجعة من مستخدم بلا صلاحية" });
    }).catch((e) => e);
    expect(msg(e1)).toMatch(/lacks knowledge.review.data/);
    const e2 = await rolledBack(async (tx) => {
      await cases.syntheticReviewer(tx, NOPERM, ["data"]);
      await tx.execute(sql`update users set locked_until = now() + interval '1 day' where id = ${NOPERM}::uuid`);
      const [s] = await tx.select({ id: schema.kbSources.id }).from(schema.kbSources).where(eq(schema.kbSources.refCode, "GASTAT-LFS")).limit(1);
      await tx.insert(schema.kbSourceReviews).values({ sourceId: s!.id, reviewerUserId: NOPERM, reviewerRole: "data", decision: "accepted", note: "مراجعة من مستخدم مقفل" });
    }).catch((e) => e);
    expect(msg(e2)).toMatch(/not an active user/);
    // a review loses its effect when the reviewer's permission is withdrawn
    await rolledBack(async (tx) => {
      await cases.reviewSource(tx, "GASTAT-LFS");
      const q = { question: "كم بلغ معدل البطالة بين السعوديين في الربع الأول من عام 2025؟", service: "T02", asOf: "2026-11-06", kinds: ["statistical_source" as const] };
      expect((await ke.retrieve(tx, q)).citable.length).toBeGreaterThan(0);
      await tx.execute(sql`delete from user_roles where user_id = ${cases.SYNTHETIC_REVIEWER}::uuid`);
      expect((await ke.retrieve(tx, q)).citable).toEqual([]);
    });
    // a registry comparison accepted by someone without «knowledge.review.legal» does not authorise a citation
    await rolledBack(async (tx) => {
      await cases.acceptRegistry(tx, "NZR", "NZR/uqn-p18926", [8, 16], "2022-02-04");
      await tx.execute(sql`delete from user_roles where user_id = ${cases.SYNTHETIC_REVIEWER}::uuid`);
      const r = await ke.retrieve(tx, { question: "ما نص المادة 16 الفقرة 3 من لائحة تنظيم أعمال النظارة؟", service: "I01", asOf: "2026-11-06", refCodes: ["NAZARA-REG"] });
      expect(r.citable).toEqual([]);
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
    });
  });

  it("a source review must name a real user, a known field and a decision", async () => {
    const msg = (e: unknown) => String((e as Error & { cause?: Error })?.cause?.message ?? e);
    const e1 = await rolledBack(async (tx) => {
      const [s] = await tx.select({ id: schema.kbSources.id }).from(schema.kbSources).limit(1);
      await tx.insert(schema.kbSourceReviews).values({ sourceId: s!.id, reviewerUserId: "00000000-0000-4000-8000-00000000dead", reviewerRole: "sharia", decision: "accepted", note: "مراجعة بلا مستخدم حقيقي" });
    }).catch((e) => e);
    expect(msg(e1)).toMatch(/foreign key|not an active user/);
    const e2 = await rolledBack(async (tx) => {
      await cases.reviewSource(tx, "Q100");
      const [s] = await tx.select({ id: schema.kbSources.id }).from(schema.kbSources).limit(1);
      await tx.execute(sql`insert into kb_source_reviews (source_id, reviewer_user_id, reviewer_role, decision, note) values (${s!.id}, ${cases.SYNTHETIC_REVIEWER}::uuid, 'anyone', 'maybe', 'مراجعة بقيم غير مقبولة')`);
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
      await tx.execute(sql`select set_config('app.user_id', '00000000-0000-4000-8000-000000000001', true), set_config('app.global_access', '', true)`);
      await tx.update(schema.kbChunks).set({ text: "عبث" }).where(sql`true`);
      const [r] = (await tx.execute(sql`select count(*)::int as n from kb_chunks where text = 'عبث'`)).rows as { n: number }[];
      if (r!.n > 0) throw new Error("user session altered the knowledge base");
      throw new Rollback();
    })).rejects.toThrow(Rollback);
  });
});
