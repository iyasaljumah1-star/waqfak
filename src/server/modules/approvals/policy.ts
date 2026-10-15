import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { settings } from "@/server/db/schema";
import type { Auth } from "@/server/authz/context";
import { makerChecker, separationPolicy, type SeparationKey } from "@/server/authz/separation";

export const SEPARATION_SETTING = "approvals.separation";

export async function readSeparationPolicy(tx: Tx) {
  const [r] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, SEPARATION_SETTING)).limit(1);
  return separationPolicy(r?.v);
}

/** The separation check for an approver in a transaction (reads the policy). */
export async function checkMaker(tx: Tx, auth: Auth, key: SeparationKey, isMaker: boolean, fallback: string) {
  return makerChecker({ key, isMaker, canDirect: auth.perms.has("approvals.direct"), policy: await readSeparationPolicy(tx), fallback });
}

/** What an audit entry records about how an approval was allowed. */
export const approvalMode = (c: { self: boolean; direct: boolean }) => (c.direct ? { approvalMode: "direct_self", note: "اعتماد مباشر من صاحب صلاحية الاعتماد المباشر لمعاملة أعدّها (لا سياسة فصل معتمدة لهذا الإجراء)" } : { approvalMode: "second_person" });

/** For pages: whether the viewer, as the preparer of a record, may approve it (and why not). */
export async function viewerMakerRules(auth: Auth) {
  const { read } = await import("@/server/modules/_shared");
  const policy = await read(auth, (tx) => readSeparationPolicy(tx));
  const direct = auth.perms.has("approvals.direct");
  return {
    policy, direct,
    check: (key: SeparationKey, isMaker: boolean, fallback: string) => makerChecker({ key, isMaker, canDirect: direct, policy, fallback }),
  };
}

/** For pages: the separation policy (read under the viewer's context). */
export async function separationFor(auth: Auth) {
  const { read } = await import("@/server/modules/_shared");
  return read(auth, (tx) => readSeparationPolicy(tx));
}
