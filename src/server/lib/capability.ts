/**
 * Capability tokens — invitations, document share links, report share links (owner's order 2026-11-08, «ثانياً»/2).
 *
 * Before: the row stored sha256(token), unkeyed. Anyone able to write the table (the application's database role, a
 * leaked backup restored elsewhere, an SQL injection) could plant a row for a token they chose, or re-point an existing
 * row to another document, recipient, role or expiry, and the link would follow.
 *
 * Now, with HASH_KEY (held in the environment, never in the database):
 *  - lookup  = HMAC(HASH_KEY, "cap|<purpose>|<token>") — the raw token is never stored, and a token of one purpose is
 *    not a token of another (an invitation token opens no share, and the reverse);
 *  - binding = HMAC(HASH_KEY, canonical {purpose, token, id, resource, recipient, issuer, expiry, limits}) — written at
 *    issue time and verified at every use: a row whose resource, recipient, role, scope, expiry or use limit was changed
 *    after issue no longer verifies and is refused. A planted row cannot be made to verify without the key.
 *
 * Single use, use limits and revocation stay as before (acceptedAt / uses < maxUses under a row lock / revokedAt); the
 * binding makes them tamper-evident where they are fixed at issue (expiry, maxUses). What it cannot do: undo a
 * revocation is not detectable from the binding (revokedAt is not bound, so that revoking stays possible); and a party
 * holding HASH_KEY and database write access together can still mint links — that is the server itself.
 *
 * Links issued before this change (unkeyed rows, binding null) are refused: they lapse (7 to 30 days) and are reissued.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { canonical } from "./audit";

export type CapabilityPurpose = "invitation" | "document_share" | "report_share";

const key = () => Buffer.from(env.HASH_KEY, "base64");

/** The token's lookup value for its purpose. */
export function capabilityLookup(purpose: CapabilityPurpose, token: string): string {
  return createHmac("sha256", key()).update(`cap|${purpose}|${token}`).digest("base64url");
}

export type CapabilityContext = Record<string, string | number | boolean | null | Record<string, unknown> | undefined>;
const norm = (ctx: CapabilityContext) => Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v ?? null]));

/** The binding of a token to what it opens, for whom, until when. */
export function capabilityBinding(purpose: CapabilityPurpose, token: string, ctx: CapabilityContext): string {
  return createHmac("sha256", key()).update(JSON.stringify(canonical({ purpose, token, ...norm(ctx) }))).digest("base64url");
}

/** Constant-time check of a stored binding against the row as it now stands. */
export function verifyCapability(purpose: CapabilityPurpose, token: string, stored: string | null | undefined, ctx: CapabilityContext): boolean {
  if (!stored) return false;
  const want = Buffer.from(capabilityBinding(purpose, token, ctx));
  const got = Buffer.from(stored);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The contexts each purpose binds (one place, so that issue and use bind the same fields). */
export const bindInvitation = (r: { id: string; waqfId: string; phone: string; roleKey: string; invitedBy: string; expiresAt: Date; scope: Record<string, unknown> | null }) =>
  ({ id: r.id, waqfId: r.waqfId, phone: r.phone, roleKey: r.roleKey, invitedBy: r.invitedBy, expiresAt: r.expiresAt.toISOString(), scope: r.scope ?? null });
export const bindDocumentShare = (r: { id: string; documentId: string; waqfId: string | null; createdBy: string; expiresAt: Date; maxUses: number }) =>
  ({ id: r.id, documentId: r.documentId, waqfId: r.waqfId, createdBy: r.createdBy, expiresAt: r.expiresAt.toISOString(), maxUses: r.maxUses });
export const bindReportShare = (r: { id: string; reportId: string; waqfId: string | null; createdBy: string; expiresAt: Date }) =>
  ({ id: r.id, reportId: r.reportId, waqfId: r.waqfId, createdBy: r.createdBy, expiresAt: r.expiresAt.toISOString() });
