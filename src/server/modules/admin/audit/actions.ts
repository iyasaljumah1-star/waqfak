"use server";

import { asc, gt } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import type { ActionState } from "@/lib/utils";
import { staffAction } from "../guard";
import { createChainVerifier, type ChainReport } from "./chain";

const BATCH = 5000;

/**
 * Recomputes the whole audit hash chain. Integrity checking must see every row regardless of the viewer's waqf access,
 * so the read runs in system context; only counts and the id of the first broken row are returned (no row content).
 */
export async function verifyAuditChain(_: ActionState, __?: FormData): Promise<ActionState> {
  return staffAction("admin.audit", async ({ auth, tx, ip, userAgent }) => {
    const started = Date.now();
    const v = createChainVerifier();
    let after = 0;
    for (;;) {
      const rows = await withSystem((s) =>
        s
          .select({
            id: auditLogs.id, at: auditLogs.at, actorUserId: auditLogs.actorUserId, action: auditLogs.action, entityType: auditLogs.entityType,
            entityId: auditLogs.entityId, waqfId: auditLogs.waqfId, before: auditLogs.before, after: auditLogs.after, prevHash: auditLogs.prevHash, hash: auditLogs.hash,
          })
          .from(auditLogs)
          .where(gt(auditLogs.id, after))
          .orderBy(asc(auditLogs.id))
          .limit(BATCH),
      );
      for (const r of rows) v.push(r);
      if (rows.length < BATCH) break;
      after = rows[rows.length - 1].id;
    }
    const report: ChainReport & { ms: number; checkedAt: string } = { ...v.report(), ms: Date.now() - started, checkedAt: new Date().toISOString() };
    await audit(tx, {
      actorUserId: auth.user.id, action: "admin.audit.chain_verified", entityType: "audit_log", ip, userAgent,
      after: { total: report.total, verified: report.verified, unverifiable: report.unverifiable, forks: report.forks, brokenCount: report.brokenCount, firstBrokenId: report.firstBroken?.id ?? null },
    });
    return report.firstBroken
      ? { error: `السلسلة مكسورة عند السجل رقم ${report.firstBroken.id}.`, data: report }
      : { ok: true, message: "السجل سليم: لا روابط مقطوعة ولا محتوى معدّل فيما يمكن التحقق منه.", data: report };
  });
}
