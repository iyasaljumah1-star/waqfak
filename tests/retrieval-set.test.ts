/**
 * Stage 11: the Arabic and English retrieval set (tests/knowledge/retrieval-set.ts). Every case not marked as a
 * documented limitation must pass; a limitation that starts passing is reported, so that its mark is removed. The full
 * table of successes and failures is written by scripts/knowledge/retrieval-set-report.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluate, RETRIEVAL_SET } from "./knowledge/retrieval-set";

describe("stage 11 retrieval set (Arabic and English)", () => {
  for (const c of RETRIEVAL_SET.filter((x) => !x.limitation)) {
    it(`${c.id} (${c.lang}): ${c.q}`, async () => {
      const r = await evaluate(c);
      expect(r.problems, JSON.stringify(r.got)).toEqual([]);
    });
  }
  it("the documented limitations still fail (when one passes, its mark is to be removed)", async () => {
    for (const c of RETRIEVAL_SET.filter((x) => x.limitation)) expect((await evaluate(c)).pass, `${c.id} now passes: remove its limitation mark`).toBe(false);
  });
});
