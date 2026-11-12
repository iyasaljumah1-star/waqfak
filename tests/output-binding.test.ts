/**
 * N9-9 (owner's order of 2026-11-09, «ثالثاً»): an engine-written text never travels without the run, references, basis
 * and dossier it was written with — through regeneration (mergeRegenerated), edits (applyEdits) and the final approval
 * gate on the server (finalBasisErrors → engineBlockErrors) and in the database (specialist_block_errors, part of the
 * approval guard). Part 1 is pure; part 2 runs the database guard and a full approval attempt on the development
 * database in rolled-back transactions (synthetic output on an existing synthetic request).
 */
import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { Client } from "pg";

vi.mock("server-only", () => ({}));

import { engineBlockErrors, specialistBinding, bindingInput, type SpecialistBlock } from "../src/server/modules/outputs/binding";
import { applyEdits, mergeRegenerated } from "../src/server/modules/outputs/pure";
import type { OutputSection } from "../src/server/db/schema/operations";

const C1 = "11111111-1111-4111-8111-111111111111", C2 = "22222222-2222-4222-8222-222222222222", C3 = "33333333-3333-4333-8333-333333333333";
const ref = (n: number, chunkId: string) => ({ n, refCode: "TEST-REF", version: "v1", locator: `ص${n}`, chunkId });
const bas = (chunkId: string) => ({ chunkId, refCode: "TEST-REF", locator: "ص" });
function engine(o: Partial<SpecialistBlock> = {}): SpecialistBlock {
  const b: SpecialistBlock = { type: "specialist", prompt: "اكتب التحليل", text: "يجوز الاستبدال عند تعطل المنافع [1] وبإذن الحاكم [2].", by: "engine", writer: "model", runId: "run-1",
    refs: [ref(1, C1), ref(2, C2)], basis: [bas(C1), bas(C2), bas(C3)], dossierId: "44444444-4444-4444-8444-444444444444", ...o };
  return { ...b, binding: o.binding ?? specialistBinding(b) };
}
const sec = (b: SpecialistBlock, key = "analysis:a"): OutputSection => ({ key, title: "التحليل", required: true, blocks: [b] }) as OutputSection;
const freshEmpty = sec({ type: "specialist", prompt: "اكتب التحليل", text: "" });

describe("N9-9 — binding, merge and edits (pure)", () => {
  it("a block as the run wrote it is consistent", () => {
    expect(engineBlockErrors(engine())).toEqual([]);
    expect(engineBlockErrors(engine({ writer: "template", refs: [], basis: [], text: "نص من القالب", dossierId: undefined }))).toEqual([]);
  });

  const cases: [string, Partial<SpecialistBlock>][] = [
    ["regenerated without references", { refs: [] }],
    ["regenerated with an empty basis", { basis: [] }],
    ["another dossier", { dossierId: "55555555-5555-4555-8555-555555555555" }],
    ["text of run 1 with references of run 2 (another run id)", { runId: "run-2" }],
    ["a new text with the old references", { text: "نص جديد مختلف [1] [2]." }],
    ["one reference of several lost", { refs: [ref(1, C1)] }],
    ["a reference swapped for another passage", { refs: [ref(1, C1), ref(2, C3)] }],
    ["no run id", { runId: undefined }],
    ["no writer", { writer: undefined }],
  ];
  for (const [label, change] of cases) {
    it(`refused: ${label}`, () => {
      const good = engine();
      const tampered = { ...good, ...change } as SpecialistBlock; // keeps the ORIGINAL binding
      expect(engineBlockErrors(tampered).length, label).toBeGreaterThan(0);
    });
  }
  it("refused even when re-bound: a model text with no references, no basis, a reference outside the basis, a citation without a reference", () => {
    const rebind = (o: Partial<SpecialistBlock>) => engine({ ...o, binding: specialistBinding({ ...engine(), ...o }) });
    expect(engineBlockErrors(rebind({ refs: [], text: "نص بلا استشهاد." })).join(" ")).toMatch(/بلا مراجع/);
    expect(engineBlockErrors(rebind({ basis: [] })).join(" ")).toMatch(/بلا أساس/);
    expect(engineBlockErrors(rebind({ basis: [bas(C1)] })).join(" ")).toMatch(/ليس من المقاطع المعروضة/);
    expect(engineBlockErrors(rebind({ text: "نص [1] [2] [3]." })).join(" ")).toMatch(/رقم لا مرجع له/);
  });

  it("mergeRegenerated: a manual regeneration keeps the previous engine block WHOLE (text, refs, basis, run, dossier)", () => {
    const prev = [sec(engine())];
    const m = mergeRegenerated(prev, [freshEmpty], []);
    const b = m.sections[0]!.blocks[0] as SpecialistBlock;
    expect(b).toMatchObject({ text: engine().text, runId: "run-1", dossierId: engine().dossierId, binding: engine().binding });
    expect(b.refs).toHaveLength(2);
    expect(b.basis).toHaveLength(3);
    expect(engineBlockErrors(b)).toEqual([]);
  });

  it("mergeRegenerated: the engine's new run replaces its earlier text whole — never old text with new references", () => {
    const run2 = engine({ text: "نص التشغيل الثاني [1].", runId: "run-2", refs: [ref(1, C3)], basis: [bas(C3)], dossierId: undefined });
    const m = mergeRegenerated([sec(engine())], [sec(run2)], []);
    const b = m.sections[0]!.blocks[0] as SpecialistBlock;
    expect(b).toEqual(run2);
    expect(engineBlockErrors(b)).toEqual([]);
  });

  it("mergeRegenerated: a person's text is kept whole over a new engine run (with its own references, if any)", () => {
    const person: SpecialistBlock = { type: "specialist", prompt: "اكتب التحليل", text: "كتبه المختص [1].", by: "person", refs: [ref(1, C2)], editedFromRun: "run-1" };
    const run2 = engine({ text: "نص آلي جديد [1].", runId: "run-2", refs: [ref(1, C3)], basis: [bas(C3)] });
    const b = mergeRegenerated([sec(person)], [sec(run2)], []).sections[0]!.blocks[0] as SpecialistBlock;
    expect(b).toMatchObject({ text: "كتبه المختص [1].", by: "person", refs: [ref(1, C2)] });
  });

  it("mergeRegenerated: an empty earlier block does not wipe the fresh engine text (N9-11)", () => {
    const run2 = engine({ runId: "run-2" });
    const b = mergeRegenerated([freshEmpty], [sec(run2)], []).sections[0]!.blocks[0] as SpecialistBlock;
    expect(b.text).toBe(run2.text);
    expect(engineBlockErrors(b)).toEqual([]);
  });

  it("an edited engine text becomes a person's: binding dropped, references kept (and still subject to review)", () => {
    const r = applyEdits([sec(engine())], { "spec:analysis:a:0": "صياغة المختص [1] و[2]." });
    const b = r.sections[0]!.blocks[0] as SpecialistBlock;
    expect(b).toMatchObject({ by: "person", editedFromRun: "run-1", text: "صياغة المختص [1] و[2]." });
    expect(b.binding).toBeUndefined();
    expect(b.refs).toHaveLength(2);
    expect(b.basis).toHaveLength(3);
  });
});

const DEV = process.env.DATABASE_OWNER_URL; // stage 11: cases run as the system role (SET LOCAL ROLE waqfak_system on the owner's connection, test cluster only); the fixtures reset to the owner
describe.skipIf(!DEV || !/waqfak_dev/.test(DEV))("N9-9 — the database guard and a full approval attempt (development database, rolled back)", () => {
  async function inTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: DEV }); await c.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
    await c.query(`set local role waqfak_system`);
      return await fn(c);
    } finally { await c.query("rollback").catch(() => {}); await c.end(); }
  }
  const errs = (c: Client, secs: OutputSection[]) => c.query(`select specialist_block_errors($1::jsonb) as n`, [JSON.stringify(secs)]).then((r) => r.rows[0].n as number);

  it("the database recomputes the same binding as the server (Arabic text, several references, basis order)", async () => {
    const n = await inTx(async (c) => {
      const b = engine({ basis: [bas(C3), bas(C1), bas(C2), bas(C1)] });
      const db = await c.query(`select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [bindingInput(b)]);
      expect(db.rows[0].h).toBe(b.binding);
      return errs(c, [sec(b)]);
    });
    expect(n).toBe(0);
  });

  it("the database counts every tampered block the server refuses", async () => {
    const out = await inTx(async (c) => {
      const r: Record<string, number> = {};
      r.refsDropped = await errs(c, [sec({ ...engine(), refs: [] })]);
      r.basisEmpty = await errs(c, [sec({ ...engine(), basis: [] })]);
      r.otherDossier = await errs(c, [sec({ ...engine(), dossierId: C3 })]);
      r.otherRun = await errs(c, [sec({ ...engine(), runId: "run-2" })]);
      r.newText = await errs(c, [sec({ ...engine(), text: "نص جديد [1] [2]." })]);
      r.oneLost = await errs(c, [sec({ ...engine(), refs: [ref(1, C1)] })]);
      r.noBinding = await errs(c, [sec({ ...engine(), binding: undefined })]);
      const rebound = (o: Partial<SpecialistBlock>) => engine({ ...o, binding: specialistBinding({ ...engine(), ...o }) });
      r.reboundNoRefs = await errs(c, [sec(rebound({ refs: [], text: "نص بلا استشهاد." }))]);
      r.reboundOutsideBasis = await errs(c, [sec(rebound({ basis: [bas(C1)] }))]);
      r.personCitesNothing = await errs(c, [sec({ type: "specialist", prompt: "x", text: "كتبه المختص [1].", by: "person" })]);
      return r;
    });
    for (const [k, v] of Object.entries(out)) expect(v, k).toBe(1);
  });

  it("a full approval: refused for an engine text that lost its references; allowed for a consistent template text", async () => {
    const run = (b: SpecialistBlock) => inTx(async (c) => {
      const req = (await c.query(`select id from service_requests order by created_at limit 1`)).rows[0]?.id;
      if (!req) return "no request in the development database";
      const o = (await c.query(`insert into outputs (number, request_id, output_key, title, specialty, review_policy, status) values ('TEST-N99-' || substr(md5(random()::text), 1, 6), $1, 'test:n9-9', 'مخرج اختبار', 'legal', 'none', 'draft') returning id`, [req])).rows[0].id;
      await c.query(`insert into output_versions (output_id, request_id, version, origin, sections, gaps) values ($1, $2, 1, 'generated', $3::jsonb, '[]'::jsonb)`, [o, req, JSON.stringify([sec(b)])]);
      try {
        await c.query(`update outputs set current_version = 1, status = 'approved', approved_version = 1 where id = $1`, [o]);
        return "approved";
      } catch (e) { return `refused: ${(e as Error).message}`; }
    });
    const lost = await run({ ...engine(), refs: [], basis: [] });
    expect(lost).toMatch(/refused: output_guard/);
    const template = engine({ writer: "template", refs: [], basis: [], text: "نص من القالب.", dossierId: undefined });
    const ok = await run(template);
    expect(ok).toBe("approved");
  });
});
