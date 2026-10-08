import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "../db";
import { auditLogs, sequences } from "../db/schema";
import { sha256 } from "./crypto";

export type AuditEntry = {
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  waqfId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  before?: unknown;
  after?: unknown;
};

const SENSITIVE = /(password|secret|token|iban|national|idnumber|code_hash|codeHash|bankDetails|address)/i;

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

/** JSON round-trip so Dates/BigInts become plain values before redaction and hashing. */
const plain = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))));

export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

/** Append-only, hash-chained audit trail. Each entry hashes the previous one so tampering is detectable. */
export async function audit(tx: Tx, e: AuditEntry) {
  await tx.execute(sql`select pg_advisory_xact_lock(724501)`);
  // The previous hash is read through a SECURITY DEFINER function so the chain is linear regardless of the caller's RLS view.
  const last = await tx.execute<{ h: string | null }>(sql`select app_audit_last_hash() as h`);
  const prevHash = last.rows[0]?.h ?? "GENESIS";
  const before = redact(plain(e.before));
  const after = redact(plain(e.after));
  const at = new Date().toISOString();
  // Canonical form (sorted keys) because jsonb does not preserve key order; verifiers re-hash the same way.
  const hash = sha256(JSON.stringify(canonical([prevHash, at, e.actorUserId ?? null, e.action, e.entityType, e.entityId ?? null, e.waqfId ?? null, before ?? null, after ?? null])));
  await tx.insert(auditLogs).values({
    actorUserId: e.actorUserId ?? null,
    actorLabel: e.actorLabel ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    waqfId: e.waqfId ?? null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    before: before ?? null,
    after: after ?? null,
    prevHash,
    hash,
    at: new Date(at),
  });
}

/** Human-friendly sequential numbers (WQ-2026-000123). Uses a row lock for gap-free increments. */
export async function nextNumber(tx: Tx, prefix: string, pad = 6): Promise<string> {
  const rows = await tx
    .insert(sequences)
    .values({ key: prefix, value: 1 })
    .onConflictDoUpdate({ target: sequences.key, set: { value: sql`${sequences.value} + 1` } })
    .returning({ value: sequences.value });
  return `${prefix}-${String(rows[0].value).padStart(pad, "0")}`;
}
