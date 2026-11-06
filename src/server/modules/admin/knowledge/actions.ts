"use server";
import { z } from "zod";
import { UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { staffAction } from "../guard";
import { recordComparisonReview, recordSourceReview, ReviewRefused } from "@/server/knowledge/review";

/**
 * Recording a human review of the knowledge base (owner's order 2026-11-06, §4). The reviewer's own session; the
 * permission of the source's field is checked in knowledge/review.ts and again by the database, and the audit entry is
 * written in the same transaction (the database refuses a review without it).
 */
const sourceSchema = z.object({
  sourceId: z.string().uuid(),
  chunkId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  decision: z.enum(["accepted", "rejected"]),
  note: z.string().trim().min(10, "اكتب ما قابلته وبماذا (عشرة أحرف على الأقل).").max(2000),
});
const runSchema = z.object({ runId: z.string().uuid(), decision: z.enum(["accepted", "rejected"]), note: z.string().trim().min(10).max(2000) });

const refused = (e: unknown) => {
  if (e instanceof ReviewRefused) throw new UserError(e.message);
  throw e;
};

export async function recordKnowledgeReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = sourceSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "البيانات غير صحيحة." };
  return staffAction("admin.access", async ({ auth, tx, ip, userAgent }) => {
    const r = await recordSourceReview(tx, { userId: auth.user.id, ip, userAgent }, p.data).catch(refused);
    return { ok: true, message: `سُجلت المراجعة (${p.data.decision === "accepted" ? "قبول" : "رفض"}) في مجال ${r!.role}، وقُيدت في سجل التدقيق.` };
  }, "/admin/knowledge");
}

export async function recordComparisonDecision(_: ActionState, fd: FormData): Promise<ActionState> {
  const p = runSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "البيانات غير صحيحة." };
  return staffAction("admin.access", async ({ auth, tx, ip, userAgent }) => {
    await recordComparisonReview(tx, { userId: auth.user.id, ip, userAgent }, p.data).catch(refused);
    return { ok: true, message: "سُجلت مراجعة المطابقة وقُيدت في سجل التدقيق." };
  }, "/admin/knowledge");
}
