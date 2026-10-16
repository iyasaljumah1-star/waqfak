import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError, type ZodType } from "zod";
import { withContext, type Tx } from "../db";
import { ForbiddenError, loadWaqfAccess, requireAuth, type Auth, type WaqfAccess } from "../authz/context";
import type { Permission } from "../authz/catalog";
import { RateLimitError } from "../lib/rate-limit";
import { requestInfo } from "../lib/request-info";
import type { ActionState } from "@/lib/utils";

export class UserError extends Error {}

/** Parses FormData with a zod schema; returns field errors in Arabic as an ActionState. */
export function parseForm<T>(schema: ZodType<T>, fd: FormData | Record<string, unknown>): { data: T } | { state: ActionState } {
  const obj = fd instanceof FormData ? Object.fromEntries(fd) : fd;
  const r = schema.safeParse(obj);
  if (r.success) return { data: r.data };
  const fieldErrors: Record<string, string> = {};
  for (const i of (r.error as ZodError).issues) fieldErrors[String(i.path[0] ?? "_")] ??= i.message;
  return { state: { error: "راجع الحقول المظللة.", fieldErrors } };
}

export type WaqfCtx = { auth: Auth; access: WaqfAccess; tx: Tx; ip: string; userAgent: string };

/**
 * Runs a mutation scoped to one waqf: authenticates, opens a transaction carrying the user identity
 * (RLS), loads RBAC+ABAC access, checks the permission, then runs `fn`. Errors become Arabic ActionState.
 */
export async function waqfAction(waqfId: string, perm: Permission, fn: (c: WaqfCtx) => Promise<ActionState | void>, revalidate?: string | string[]): Promise<ActionState> {
  try {
    const auth = await requireAuth();
    const { ip, userAgent } = await requestInfo();
    const res = await withContext(auth.db, async (tx) => {
      const access = await loadWaqfAccess(tx, auth, waqfId);
      if (!access) throw new ForbiddenError("لا تشمل صلاحياتك هذا الوقف. اطلب من ناظره دعوتك إليه.");
      if (!access.perms.has(perm)) throw new ForbiddenError();
      const out = await fn({ auth, access, tx, ip, userAgent });
      // every change to a waqf file re-evaluates its journey stage from the records (forward or back)
      if (!out || !("error" in out && out.error)) {
        const { syncJourneyAfterChange } = await import("./establish/journey-server");
        await syncJourneyAfterChange(tx, waqfId, auth.user.id);
      }
      return out;
    });
    for (const p of [revalidate ?? []].flat()) revalidatePath(p);
    return res ?? { ok: true, message: "تم الحفظ." };
  } catch (e) {
    return toState(e);
  }
}

/** Same as waqfAction for actions that are not waqf-scoped (personal or staff actions). */
export async function userAction(fn: (c: { auth: Auth; tx: Tx; ip: string; userAgent: string }) => Promise<ActionState | void>, opts: { perm?: Permission; revalidate?: string | string[] | (() => string[]) } = {}): Promise<ActionState> {
  try {
    const auth = await requireAuth();
    if (opts.perm && !auth.perms.has(opts.perm)) throw new ForbiddenError();
    const { ip, userAgent } = await requestInfo();
    const res = await withContext(auth.db, (tx) => fn({ auth, tx, ip, userAgent }));
    // A function is read after the action ran (paths known only once the record is loaded).
    for (const p of [typeof opts.revalidate === "function" ? opts.revalidate() : opts.revalidate ?? []].flat()) if (p) revalidatePath(p);
    return res ?? { ok: true, message: "تم الحفظ." };
  } catch (e) {
    return toState(e);
  }
}

export function toState(e: unknown): ActionState {
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_")) throw e; // redirect / notFound
  if (e instanceof ForbiddenError || e instanceof UserError || e instanceof RateLimitError) return { error: e.message };
  console.error("[action]", e);
  return { error: "تعذر إكمال العملية. أعد المحاولة، وإن تكررت المشكلة تواصل مع الدعم." };
}

/** Read helper for server components: runs queries under the user's RLS context. */
export async function read<T>(auth: Auth, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext(auth.db, fn);
}
