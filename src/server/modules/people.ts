import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/server/db";

/**
 * Another person's contact and identity data (stage 11, N10-10). The application role reads names and standing only;
 * phones, e-mails and identity data come through these, which the database answers only for oneself, an authorized
 * staff member, or the manager of a waqf the person belongs to (security.sql app_can_see_contact). An id the caller
 * may not see is simply absent from the result.
 */
export type Contact = { phone: string | null; email: string | null };

export async function contactOf(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, Contact>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const r = await tx.execute<{ id: string; phone: string | null; email: string | null }>(sql`select * from app_user_contact(${`{${list.join(",")}}`}::uuid[])`);
  return new Map(r.rows.map((x) => [x.id, { phone: x.phone, email: x.email }]));
}

export type PrivateRecord = {
  phone: string | null; email: string | null; birthDate: string | null; idType: string | null; nationalIdEnc: string | null; residesInKsa: boolean | null;
  phoneVerifiedAt: Date | null; emailVerifiedAt: Date | null; lastLoginAt: Date | null; lockedUntil: Date | null; failedLoginCount: number; deletionRequestedAt: Date | null;
};
/** The whole private record: oneself, or staff entitled to personal data. Null otherwise. */
export async function privateOf(tx: Tx, id: string): Promise<PrivateRecord | null> {
  const r = await tx.execute<Record<string, unknown>>(sql`select * from app_user_private(${id}::uuid)`);
  const x = r.rows[0];
  if (!x) return null;
  const d = (v: unknown) => (v ? new Date(v as string) : null);
  return {
    phone: (x.phone as string) ?? null, email: (x.email as string) ?? null, birthDate: x.birth_date ? String(x.birth_date).slice(0, 10) : null, idType: (x.id_type as string) ?? null,
    nationalIdEnc: (x.national_id_enc as string) ?? null, residesInKsa: (x.resides_in_ksa as boolean) ?? null, phoneVerifiedAt: d(x.phone_verified_at), emailVerifiedAt: d(x.email_verified_at),
    lastLoginAt: d(x.last_login_at), lockedUntil: d(x.locked_until), failedLoginCount: Number(x.failed_login_count ?? 0), deletionRequestedAt: d(x.deletion_requested_at),
  };
}

/** Does an account hold this phone? Its id and name only. */
export async function userByPhone(tx: Tx, phone: string): Promise<{ id: string; fullName: string | null } | null> {
  const r = await tx.execute<{ id: string; full_name: string | null }>(sql`select * from app_user_by_phone(${phone})`);
  return r.rows[0] ? { id: r.rows[0].id, fullName: r.rows[0].full_name } : null;
}

/** Staff search by name, phone or e-mail: ids. */
export async function searchUserIds(tx: Tx, term: string): Promise<string[]> {
  const r = await tx.execute<{ id: string }>(sql`select id from app_user_search(${term})`);
  return r.rows.map((x) => x.id);
}

/**
 * A person's row as an administrator's page shows it: name and standing (readable to the application role) with the
 * private record merged in when the database allows it to this caller (fields null otherwise).
 */
export async function withPrivate<T extends { id: string }>(tx: Tx, u: T): Promise<T & PrivateRecord> {
  const p = await privateOf(tx, u.id);
  return {
    ...u,
    ...(p ?? { phone: null, email: null, birthDate: null, idType: null, nationalIdEnc: null, residesInKsa: null, phoneVerifiedAt: null, emailVerifiedAt: null, lastLoginAt: null, lockedUntil: null, failedLoginCount: 0, deletionRequestedAt: null }),
  };
}

/** An account by e-mail (staff checks of a sign-in identifier): its id. */
export async function userIdByEmail(tx: Tx, email: string): Promise<string | null> {
  const r = await tx.execute<{ id: string }>(sql`select id from app_user_by_email(${email})`);
  return r.rows[0]?.id ?? null;
}

export type AdminFields = { phone: string | null; email: string | null; lastLoginAt: Date | null; lockedUntil: Date | null; deletionRequestedAt: Date | null };
/** Staff lists: the administrative columns of many accounts (staff entitled to personal data; empty otherwise). */
export async function adminFieldsOf(tx: Tx, ids: string[]): Promise<Map<string, AdminFields>> {
  if (!ids.length) return new Map();
  const r = await tx.execute<{ id: string; phone: string | null; email: string | null; last_login_at: string | null; locked_until: string | null; deletion_requested_at: string | null }>(
    sql`select * from app_user_admin_fields(${`{${ids.join(",")}}`}::uuid[])`);
  const d = (v: string | null) => (v ? new Date(v) : null);
  return new Map(r.rows.map((x) => [x.id, { phone: x.phone, email: x.email, lastLoginAt: d(x.last_login_at), lockedUntil: d(x.locked_until), deletionRequestedAt: d(x.deletion_requested_at) }]));
}
