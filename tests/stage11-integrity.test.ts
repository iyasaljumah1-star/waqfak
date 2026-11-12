/**
 * Stage 11, batch C on the development database: what the engine wrote is recorded by the engine alone (N10-16), a
 * citation in Arabic-Indic digits is a citation (N10-15), an engine block's run is never empty, the reference data is
 * not written from a user session, and an issued report does not change. Synthetic rows only; the registry rows these
 * tests add are left (the registry is append-only for the application and the system, by design).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

vi.mock("server-only", () => ({}));

const APP = process.env.DATABASE_URL;
const SYS = process.env.SYSTEM_DATABASE_URL;
const OWNER = process.env.DATABASE_OWNER_URL;
const enabled = !!APP && !!SYS && !!OWNER && /waqfak_dev/.test(APP);

describe("stage 11 C — pure: citations in any digits, an empty run", async () => {
  const { citedNumbers, engineBlockErrors, specialistBinding, blockTextSha } = await import("../src/server/modules/outputs/binding");
  it("«[3]», «[٣]» and «[۳]» are the same citation", () => {
    expect([...citedNumbers("أ [3] ب [٣] ج [۱۲]")].sort()).toEqual([12, 3]);
  });
  it("a cited number in Arabic-Indic digits without its reference is caught", () => {
    const b = { type: "specialist" as const, text: "نص [٢]", by: "engine" as const, runId: randomUUID(), writer: "model" as const, refs: [{ n: 1, refCode: "X", version: "1", locator: "م1", chunkId: "c1", status: "reviewed", flags: [] }], basis: [{ chunkId: "c1", refCode: "X", locator: "م1" }], prompt: "" };
    const withBinding = { ...b, binding: specialistBinding(b) };
    expect(engineBlockErrors(withBinding as never)).toContain("النص يستشهد برقم لا مرجع له");
  });
  it("a run id of spaces is no run id", () => {
    const b = { type: "specialist" as const, text: "نص", by: "engine" as const, runId: "  ", writer: "template" as const, refs: [], basis: [], prompt: "" };
    expect(engineBlockErrors({ ...b, binding: specialistBinding(b) } as never)).toContain("نص آلي بلا معرّف تشغيل");
  });
  it("the text fingerprint ignores spacing and joiners only", () => {
    expect(blockTextSha("نص  الوقف\nالأول")).toBe(blockTextSha("نص الوقف الأول‌"));
    expect(blockTextSha("نص الوقف الأول")).not.toBe(blockTextSha("نص الوقف الثاني"));
  });
});

describe.skipIf(!enabled)("stage 11 C — database (development)", () => {
  let app: Client, sys: Client, owner: Client;
  const tryQ = async (c: Client, q: string, p: unknown[] = []) => {
    await c.query("savepoint s");
    try {
      const r = await c.query(q, p);
      await c.query("release savepoint s");
      return { ok: true as const, rows: r.rows };
    } catch (e) {
      await c.query("rollback to savepoint s");
      return { ok: false as const, err: String((e as Error).message) };
    }
  };
  const reports: string[] = [];
  beforeAll(async () => {
    app = new Client({ connectionString: APP }); sys = new Client({ connectionString: SYS }); owner = new Client({ connectionString: OWNER });
    await Promise.all([app.connect(), sys.connect(), owner.connect()]);
    await Promise.all([app.query("begin"), sys.query("begin")]);
    await sys.query(`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
  });
  afterAll(async () => {
    await Promise.all([app?.query("rollback").catch(() => null), sys?.query("rollback").catch(() => null)]);
    if (reports.length) await owner.query(`delete from reports where id = any($1::uuid[])`, [reports]).catch(() => null);
    await Promise.all([app?.end(), sys?.end(), owner?.end()]);
  });

  it("the database fingerprints a text exactly as the server does", async () => {
    const { blockTextSha } = await import("../src/server/modules/outputs/binding");
    for (const t of ["نص  الوقف\nالأول", "a b c　d﻿", "\tمادة (٣)\r\n"]) {
      const { rows } = await owner.query(`select block_text_sha($1) h`, [t]);
      expect(rows[0].h, JSON.stringify(t)).toBe(blockTextSha(t));
    }
  });

  it("the application role cannot read, add, change or remove the engine registry; the system adds only", async () => {
    const row = [randomUUID().replace(/-/g, ""), "a".repeat(64), randomUUID(), "model"];
    expect((await tryQ(app, `insert into engine_blocks (binding, text_sha256, run_id, writer) values ($1, $2, $3, $4)`, row)).err).toMatch(/permission denied/);
    expect((await tryQ(app, `select 1 from engine_blocks limit 1`)).err).toMatch(/permission denied/);
    expect((await tryQ(sys, `insert into engine_blocks (binding, text_sha256, run_id, writer) values ($1, $2, $3, $4)`, row)).ok).toBe(true);
    expect((await tryQ(sys, `update engine_blocks set writer = 'template' where binding = $1`, [row[0]])).err).toMatch(/permission denied/);
    expect((await tryQ(sys, `delete from engine_blocks where binding = $1`, [row[0]])).err).toMatch(/permission denied/);
  });

  it("the reference texts are not written from a user session, nor from the application connection at all", async () => {
    const q: string[] = [];
    for (const t of ["kb_sources", "kb_chunks", "ref_sources", "ref_versions", "ref_units", "ref_match_runs", "ref_fetch_attempts"])
      q.push(`insert into ${t} select * from ${t} where false`, `update ${t} set id = id where false`, `delete from ${t} where false`);
    for (const x of q) expect((await tryQ(app, x)).err, x).toMatch(/permission denied/);
  });

  it("the gate: an engine block must be in the registry; relabelled engine text is refused; an empty run is refused", async () => {
    const { specialistBinding, blockTextSha } = await import("../src/server/modules/outputs/binding");
    const run = randomUUID();
    const text = `نص كتبه المحرك للاختبار ${randomUUID()}`;
    const b = { type: "specialist", text, by: "engine", runId: run, writer: "template", refs: [], basis: [], prompt: "" };
    const block = { ...b, binding: specialistBinding(b as never) };
    const errs = async (blocks: unknown[]) => (await sys.query(`select specialist_block_errors($1::jsonb) n`, [JSON.stringify([{ key: "s", title: "s", blocks }])])).rows[0].n as number;
    // a block labelled as the engine's that the engine never wrote (written from a request, with a valid binding)
    expect(await errs([block])).toBe(1);
    await sys.query(`insert into engine_blocks (binding, text_sha256, run_id, writer) values ($1, $2, $3, 'template')`, [block.binding, blockTextSha(text), run]);
    expect(await errs([block])).toBe(0);
    // the engine's text relabelled as a person's, as a template of another run, or re-spaced
    expect(await errs([{ type: "specialist", text, by: "person", prompt: "" }])).toBe(1);
    expect(await errs([{ type: "specialist", text: text.replace(/ /g, "  "), by: "human", prompt: "" }])).toBe(1);
    const other = { ...b, runId: randomUUID() };
    expect(await errs([{ ...other, binding: specialistBinding(other as never) }])).toBe(1);
    // a person's own text is not affected
    expect(await errs([{ type: "specialist", text: "نص كتبه المختص بنفسه", by: "person", prompt: "" }])).toBe(0);
    // an empty run id
    const empty = { ...b, runId: " " };
    expect(await errs([{ ...empty, binding: specialistBinding(empty as never) }])).toBe(1);
    // a citation in Arabic-Indic digits without its reference, by anyone
    expect(await errs([{ type: "specialist", text: "رأي المختص [٢]", by: "person", refs: [], prompt: "" }])).toBe(1);
    expect(await errs([{ type: "specialist", text: "رأي المختص [٢]", by: "person", refs: [{ n: 2, chunkId: "c" }], prompt: "" }])).toBe(0);
  });

  it("an issued report does not change; a draft is approved once and the approval stays", async () => {
    const id = randomUUID();
    reports.push(id);
    await owner.query(`insert into reports (id, number, kind, title, status, verification_code, snapshot) values ($1, $2, 'nazara_periodic', 'تقرير اختبار', 'draft', $3, '{"a":1}')`, [id, `S11-${id.slice(0, 8)}`, id.slice(0, 12)]);
    for (const q of [`update reports set title = 'آخر' where id = $1`, `update reports set snapshot = '{"a":2}' where id = $1`, `update reports set kind = 'annual' where id = $1`, `update reports set waqf_id = gen_random_uuid() where id = $1`])
      expect((await tryQ(sys, q, [id])).err, q).toMatch(/issued report does not change/);
    expect((await tryQ(sys, `update reports set status = 'approved' where id = $1`, [id])).err).toMatch(/approved once/);
    expect((await tryQ(sys, `update reports set status = 'approved', approved_by = gen_random_uuid(), approved_at = now() where id = $1`, [id])).ok).toBe(true);
    expect((await tryQ(sys, `update reports set status = 'draft', approved_by = null, approved_at = null where id = $1`, [id])).err).toMatch(/approved once/);
    expect((await tryQ(sys, `update reports set revoked_at = now() where id = $1`, [id])).ok).toBe(true);
  });
});
