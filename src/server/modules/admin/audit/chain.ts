/**
 * Audit hash-chain verification (pure; unit-tested in tests/admin-audit-chain.test.ts).
 *
 * `audit()` stores hash = sha256(JSON.stringify([prevHash, at, actor, action, entityType, entityId, waqfId, before, after])).
 * Two properties of the current writer shape what can be proven:
 *  1. `before`/`after` live in jsonb, which does not keep object key order. A row whose payload has an object with two or
 *     more keys can only be re-hashed if the writer happened to use jsonb's order (or sorted keys). Such rows are reported
 *     as "content unverifiable", never as tampered.
 *  2. The writer reads the previous hash under the caller's RLS context, so a user who cannot see the latest row links to
 *     the latest row they *can* see. The chain is therefore a tree: each row must point to an earlier row (or GENESIS).
 *     A pointer to a hash that does not exist earlier proves a deleted or altered predecessor.
 */
import { createHash } from "node:crypto";

export type ChainRow = {
  id: number;
  at: Date;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  waqfId: string | null;
  before: unknown;
  after: unknown;
  prevHash: string | null;
  hash: string;
};

export type ChainIssue = { id: number; at: string; action: string; kind: "link" | "content" };

export type ChainReport = {
  total: number;
  verified: number;
  unverifiable: number;
  forks: number;
  firstBroken: ChainIssue | null;
  brokenCount: number;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Recursively sorts object keys (the canonical form a future writer should hash). */
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** True when the value contains an object with 2+ keys, i.e. when key order affects JSON.stringify. */
export function orderSensitive(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(orderSensitive);
  if (v && typeof v === "object") {
    const vals = Object.values(v as object);
    return vals.length > 1 || vals.some(orderSensitive);
  }
  return false;
}

export function rowHash(r: ChainRow, transform: (v: unknown) => unknown = (v) => v) {
  return sha(JSON.stringify([r.prevHash, r.at.toISOString(), r.actorUserId, r.action, r.entityType, r.entityId, r.waqfId, transform(r.before ?? null), transform(r.after ?? null)]));
}

/** Incremental verifier: feed rows in ascending id order, then call `report()`. */
export function createChainVerifier() {
  const seen = new Set<string>();
  let lastHash: string | null = null;
  const rep: ChainReport = { total: 0, verified: 0, unverifiable: 0, forks: 0, firstBroken: null, brokenCount: 0 };
  const broken = (r: ChainRow, kind: ChainIssue["kind"]) => {
    rep.brokenCount++;
    rep.firstBroken ??= { id: r.id, at: r.at.toISOString(), action: r.action, kind };
  };
  return {
    push(r: ChainRow) {
      rep.total++;
      const prev = r.prevHash ?? "";
      const linked = prev === "GENESIS" || seen.has(prev);
      if (!linked) broken(r, "link");
      else if (lastHash !== null && prev !== lastHash) rep.forks++;
      if (linked) {
        if (rowHash(r) === r.hash || rowHash(r, canonical) === r.hash) rep.verified++;
        else if (orderSensitive(r.before) || orderSensitive(r.after)) rep.unverifiable++;
        else broken(r, "content");
      }
      seen.add(r.hash);
      lastHash = r.hash;
    },
    report: () => ({ ...rep }),
  };
}

export function verifyChain(rows: ChainRow[]): ChainReport {
  const v = createChainVerifier();
  for (const r of rows) v.push(r);
  return v.report();
}
