import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonical, orderSensitive, verifyChain, type ChainRow } from "../src/server/modules/admin/audit/chain";
import { diffRows, flatten } from "../src/components/admin/diff";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Builds rows exactly as src/server/lib/audit.ts does (hash over the original JS key order). */
function build(specs: { before?: unknown; after?: unknown; prev?: "last" | "genesis" | number }[]) {
  const rows: ChainRow[] = [];
  specs.forEach((s, i) => {
    const prevHash = s.prev === "genesis" || !rows.length ? "GENESIS" : typeof s.prev === "number" ? rows[s.prev].hash : rows[rows.length - 1].hash;
    const at = new Date(Date.UTC(2026, 9, 7, 10, 0, i));
    const r = { id: i + 1, at, actorUserId: null, action: "t.x", entityType: "t", entityId: String(i), waqfId: null, before: s.before ?? null, after: s.after ?? null, prevHash };
    const hash = sha(JSON.stringify([prevHash, at.toISOString(), r.actorUserId, r.action, r.entityType, r.entityId, r.waqfId, r.before, r.after]));
    rows.push({ ...r, hash });
  });
  return rows;
}

/** jsonb returns object keys ordered by length then bytes. */
function jsonbOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonbOrder);
  if (v && typeof v === "object") {
    const keys = Object.keys(v as object).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]));
  }
  return v;
}

describe("audit chain verification", () => {
  it("accepts an intact linear chain", () => {
    const rows = build([{ after: { a: 1 } }, { after: "x" }, { before: [1, 2], after: [2] }]);
    const r = verifyChain(rows);
    expect(r).toMatchObject({ total: 3, verified: 3, brokenCount: 0, firstBroken: null, forks: 0 });
  });

  it("accepts RLS forks (link to an earlier, not immediately previous, row)", () => {
    const rows = build([{}, {}, { prev: 0 }, {}]);
    const r = verifyChain(rows);
    expect(r.firstBroken).toBeNull();
    expect(r.forks).toBe(1);
  });

  it("detects a deleted row through the dangling link of its successor", () => {
    const rows = build([{}, {}, {}, {}]);
    rows.splice(1, 1); // delete row 2
    const r = verifyChain(rows);
    expect(r.firstBroken).toEqual(expect.objectContaining({ id: 3, kind: "link" }));
  });

  it("detects tampered content when key order cannot explain the mismatch", () => {
    const rows = build([{ after: { status: "locked" } }, { after: "ok" }]);
    rows[0] = { ...rows[0], after: { status: "active" } };
    const r = verifyChain(rows);
    expect(r.firstBroken).toEqual(expect.objectContaining({ id: 1, kind: "content" }));
  });

  it("detects a recomputed hash on a tampered row through the next link", () => {
    const rows = build([{ after: "a" }, { after: "b" }]);
    const t = { ...rows[0], after: "evil" };
    t.hash = sha(JSON.stringify([t.prevHash, t.at.toISOString(), t.actorUserId, t.action, t.entityType, t.entityId, t.waqfId, t.before, t.after]));
    rows[0] = t;
    const r = verifyChain(rows);
    expect(r.firstBroken).toEqual(expect.objectContaining({ id: 2, kind: "link" }));
  });

  it("reports jsonb-reordered multi-key payloads as unverifiable, not broken", () => {
    const rows = build([{ after: { title: "x", mime: "pdf" } }]);
    rows[0] = { ...rows[0], after: jsonbOrder(rows[0].after) };
    const r = verifyChain(rows);
    expect(r).toMatchObject({ verified: 0, unverifiable: 1, brokenCount: 0 });
  });

  it("verifies rows hashed over canonical (sorted) keys", () => {
    const rows = build([{ after: canonical({ z: 1, a: { y: 2, b: 3 } }) }]);
    rows[0] = { ...rows[0], after: jsonbOrder(rows[0].after) };
    expect(verifyChain(rows).verified).toBe(1);
  });

  it("orderSensitive only flags objects with 2+ keys", () => {
    expect(orderSensitive({ a: 1 })).toBe(false);
    expect(orderSensitive([{ a: 1 }, "x"])).toBe(false);
    expect(orderSensitive({ a: { b: 1, c: 2 } })).toBe(true);
  });
});

describe("audit diff", () => {
  it("flattens nested values and classifies changes", () => {
    expect(flatten({ a: { b: 1 }, c: [1] })).toEqual({ "a.b": 1, c: [1] });
    const rows = diffRows({ status: "active", roles: ["a"] }, { status: "locked", roles: ["a"], reason: "x" });
    expect(Object.fromEntries(rows.map((r) => [r.path, r.change]))).toEqual({ reason: "added", roles: "same", status: "changed" });
  });
});
