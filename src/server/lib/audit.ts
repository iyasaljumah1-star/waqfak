import "server-only";
import { desc, sql } from "drizzle-orm";
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

/** Append-only, hash-chained audit trail. Each entry hashes the previous one so tampering is detectable. */
export async function audit(tx: Tx, e: AuditEntry) {
  await tx.execute(sql`select pg_advisory_xact_lock(724501)`);
  const [last] = await tx.select({ hash: auditLogs.hash }).from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
  const prevHash = last?.hash ?? "GENESIS";
  const before = redact(e.before);
  const after = redact(e.after);
  const at = new Date().toISOString();
  const hash = sha256(JSON.stringify([prevHash, at, e.actorUserId, e.action, e.entityType, e.entityId, e.waqfId, before, after]));
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
