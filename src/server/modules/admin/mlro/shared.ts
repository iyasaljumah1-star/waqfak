import "server-only";
import { sql } from "drizzle-orm";
import { withContext, type Tx } from "@/server/db";
import { requireAuth, ForbiddenError, type Auth } from "@/server/authz/context";
import { decryptNullable, encryptString } from "@/server/lib/crypto";
import { requestInfo } from "@/server/lib/request-info";
import { toState } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { assertStaff } from "../guard";

export const SR_STATUS_LABEL: Record<string, string> = {
  internal_review: "قيد المراجعة الداخلية",
  reported: "أُبلغت الإدارة العامة للتحريات المالية",
  closed_no_action: "أُغلق دون إبلاغ",
};
export const SCREEN_STATUS_LABEL: Record<string, string> = {
  clear: "لا تطابق", potential_match: "تطابق محتمل", confirmed_match: "تطابق مؤكد", error: "تعذر الفحص",
};
export const INDICATORS: Record<string, string> = {
  unusual_donations: "تبرعات أو إيرادات غير معتادة الحجم أو المصدر",
  foreign_party: "طرف أو مستفيد خارج المملكة دون مبرر واضح",
  bo_opacity: "غموض المستفيد الحقيقي أو رفض الإفصاح",
  structuring: "تجزئة مبالغ لتفادي الحدود",
  sanctions: "تشابه مع قوائم العقوبات",
  mismatch: "عدم اتساق النشاط مع غرض الوقف",
  other: "مؤشر آخر",
};

export type TimelineEntry = { at: string; by: string; byName: string; text: string; status?: string };
export type SuspicionPayload = { v: 2; summary: string; waqfNumber: string | null; waqfName: string | null; indicators: string[]; timeline: TimelineEntry[]; fiuReference?: string };

export function readPayload(enc: string): SuspicionPayload {
  const plain = decryptNullable(enc) ?? "";
  try {
    const p = JSON.parse(plain);
    if (p && p.v === 2) return p as SuspicionPayload;
  } catch {}
  // legacy rows: the summary was stored as plain text
  return { v: 2, summary: plain || "(تعذر فك التشفير)", waqfNumber: null, waqfName: null, indicators: [], timeline: [] };
}
export const writePayload = (p: SuspicionPayload) => encryptString(JSON.stringify(p));

/**
 * Runs `fn` as PostgreSQL role `waqfak_mlro` (the only role granted the `restricted` schema), then switches back
 * to the application role so the audit entry can be written in the same transaction.
 * Audit entries carry no waqf id: a waqf's own audit trail must never reveal that a report exists (tipping-off).
 */
export async function withMlro<T>(auth: Auth, fn: (tx: Tx) => Promise<T>, after?: (tx: Tx, result: T) => Promise<void>): Promise<T> {
  if (!auth.perms.has("mlro.access")) throw new ForbiddenError();
  assertStaff(auth);
  return withContext({ ...auth.db, mlro: true }, async (tx) => {
    const res = await fn(tx);
    if (after) {
      await tx.execute(sql`reset role`);
      await after(tx, res);
    }
    return res;
  });
}

export async function mlroAction(fn: (c: { auth: Auth; ip: string; userAgent: string }) => Promise<ActionState | void>): Promise<ActionState> {
  try {
    const auth = await requireAuth();
    if (!auth.perms.has("mlro.access")) throw new ForbiddenError();
    assertStaff(auth);
    const { ip, userAgent } = await requestInfo();
    return (await fn({ auth, ip, userAgent })) ?? { ok: true, message: "تم الحفظ." };
  } catch (e) {
    return toState(e);
  }
}
