import "server-only";
import { revalidatePath } from "next/cache";
import { withContext, type Tx } from "@/server/db";
import { ForbiddenError, requireAuth, type Auth } from "@/server/authz/context";
import type { Permission } from "@/server/authz/catalog";
import { requestInfo } from "@/server/lib/request-info";
import { audit } from "@/server/lib/audit";
import { toState } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";

export type StaffCtx = { auth: Auth; tx: Tx; ip: string; userAgent: string };

function assertStaff(auth: Auth, perm: Permission) {
  if (!auth.isStaff || !auth.perms.has(perm)) throw new ForbiddenError("ليست لديك صلاحية لهذا الإجراء في لوحة الإدارة.");
  if (!auth.user.mfaEnabled) throw new ForbiddenError("فعّل التحقق الثنائي لحسابك قبل تعديل إعدادات المنصة.");
}

/**
 * Staff configuration mutation (catalog, question bank, rules, compliance definitions, content).
 * Same checks as requireStaff (staff + permission + MFA), runs in the user's RLS context.
 * `opts.global` runs the transaction with global access — only for edits that must re-sync every waqf
 * (compliance obligations), as the compliance engine requires.
 */
export async function staffAction(
  perm: Permission,
  fn: (c: StaffCtx) => Promise<ActionState | void>,
  opts: { revalidate?: string | string[]; global?: boolean } = {},
): Promise<ActionState> {
  try {
    const auth = await requireAuth();
    assertStaff(auth, perm);
    const { ip, userAgent } = await requestInfo();
    const db = opts.global ? { ...auth.db, globalAccess: true } : auth.db;
    const res = await withContext(db, (tx) => fn({ auth, tx, ip, userAgent }));
    for (const p of [opts.revalidate ?? []].flat()) revalidatePath(p);
    return res ?? { ok: true, message: "تم الحفظ." };
  } catch (e) {
    return toState(e);
  }
}

/** Audit helper with the actor/ip filled in. */
export function log(c: StaffCtx, action: string, entityType: string, entityId: string | null, before?: unknown, after?: unknown) {
  return audit(c.tx, { actorUserId: c.auth.user.id, action, entityType, entityId, ip: c.ip, userAgent: c.userAgent, before, after });
}

/** Postgres unique-violation → readable error. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}
