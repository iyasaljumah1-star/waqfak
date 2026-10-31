import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { users } from "@/server/db/schema";
import type { Auth } from "@/server/authz/context";
import { ENGINE_USER_ID } from "./constants";

/**
 * The platform's processing account. It exists so that every record the engine writes names its author («المنصة —
 * المعالجة الآلية») like any team member's work, and so that the existing actions and their checks can run unchanged.
 *
 * It cannot sign in: it has no password, its «phone» is not a phone number, and its status is locked. It holds no role
 * in the database — its capacities exist only inside the engine process (below) — so even a forged session would carry
 * no permission. It never approves an output: the final approval needs «outputs.final_approve», which it does not hold
 * (enforced again by the output trigger in security.sql).
 */
export const ENGINE_PERMS = ["admin.requests.all", "admin.waqfs.all", "staff.requests.assigned", "staff.deliver"] as const;

export async function engineAuth(tx: Tx): Promise<Auth> {
  const [u] = await tx.select().from(users).where(eq(users.id, ENGINE_USER_ID)).limit(1);
  if (!u) throw new Error("engine account missing: run the seed");
  return {
    user: u,
    session: { id: "00000000-0000-0000-0000-000000000000" } as Auth["session"],
    globalRoles: ["platform_engine"],
    perms: new Set(ENGINE_PERMS),
    globalAccess: true,
    isStaff: true,
    db: { userId: ENGINE_USER_ID, globalAccess: true, roles: ["platform_engine"] },
  };
}
