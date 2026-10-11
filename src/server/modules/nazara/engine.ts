import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { nazaraEngagements, nazaraEvents, settings } from "@/server/db/schema";
import type { NazaraChecklistItem } from "@/server/db/schema/nazara";
import { audit, nextNumber } from "@/server/lib/audit";
import { freshChecklist } from "./pure";

async function readSettingValue<T>(tx: Tx, key: string, fallback: T): Promise<T> {
  const [r] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return (r?.v as T) ?? fallback;
}

/**
 * Opens the intake of a nazara engagement for a waqf (used by the N01 request flow and by staff).
 * Returns the existing open engagement when there is one.
 */
export async function openEngagementTx(tx: Tx, opts: { waqfId: string; requestId?: string | null; actorId: string; ip?: string; userAgent?: string }) {
  const [open] = await tx
    .select({ id: nazaraEngagements.id, number: nazaraEngagements.number })
    .from(nazaraEngagements)
    .where(and(eq(nazaraEngagements.waqfId, opts.waqfId), notInArray(nazaraEngagements.status, ["rejected", "ended"])))
    .limit(1);
  if (open) return { id: open.id, number: open.number, created: false };
  const extra = await readSettingValue<Omit<NazaraChecklistItem, "status">[]>(tx, "nazara.intake_checklist", []);
  const number = await nextNumber(tx, "NZR");
  const [e] = await tx
    .insert(nazaraEngagements)
    .values({ number, waqfId: opts.waqfId, requestId: opts.requestId ?? null, status: "intake", checklist: freshChecklist(extra), createdBy: opts.actorId, updatedBy: opts.actorId })
    .returning();
  await tx.insert(nazaraEvents).values({ engagementId: e.id, waqfId: e.waqfId, action: "open", toStatus: "intake", note: opts.requestId ? "فُتح من طلب الخدمة N01" : "فُتح من لوحة النظارة", actorUserId: opts.actorId });
  await audit(tx, { actorUserId: opts.actorId, action: "nazara.open", entityType: "nazara_engagement", entityId: e.id, waqfId: e.waqfId, ip: opts.ip, userAgent: opts.userAgent, after: { number, requestId: opts.requestId ?? null } });
  return { id: e.id, number, created: true };
}

