"use server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { tasks, waqfs, waqfTimelineEvents } from "@/server/db/schema";
import { asSystem } from "@/server/db/as-system";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { taskEvent } from "@/server/modules/operations/exec";
import { parseForm, UserError, userAction } from "../_shared";
import type { ActionState } from "@/lib/utils";

const schema = z.object({
  taskId: z.uuid(),
  decision: z.enum(["approve", "return"]),
  note: z.string().trim().max(1000).default(""),
});

/**
 * The team's review of a change to a waqf file: «اعتمد التعديل» closes it; «يحتاج تصحيحًا» closes it with the reason and
 * tells the person who changed the data what to correct (the data stays as saved: it is corrected in the file itself, and
 * that correction is reviewed in turn). Only staff holding «admin.waqfs.edit»; the reviewer cannot review their own change.
 */
export async function reviewFileChange(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.decision === "return" && d.note.length < 10) return { error: "اكتب ما يلزم تصحيحه (10 أحرف على الأقل).", fieldErrors: { note: "اكتب ما يلزم تصحيحه." } };
  return userAction(async ({ auth, tx, ip, userAgent }) => {
    const [t] = await asSystem(tx, () => tx.select().from(tasks).where(and(eq(tasks.id, d.taskId), eq(tasks.kind, "file_review"))).limit(1));
    if (!t || !t.waqfId) throw new UserError("المراجعة غير موجودة.");
    if (!["todo", "in_progress"].includes(t.status)) throw new UserError("رُوجع هذا التعديل مسبقًا.");
    if (t.createdBy === auth.user.id) throw new UserError("لا تراجع تعديلك بنفسك: يراجعه عضو آخر في الفريق.");
    const [w] = await tx.select({ id: waqfs.id, name: waqfs.name, stage: waqfs.stage }).from(waqfs).where(eq(waqfs.id, t.waqfId)).limit(1);
    if (!w) throw new UserError("الوقف غير موجود.");
    const result = d.decision === "approve" ? "اعتُمد التعديل" : "يحتاج التعديل تصحيحًا";
    await asSystem(tx, async () => {
      await tx.update(tasks).set({ status: "done", completedAt: new Date(), completedBy: auth.user.id, updatedBy: auth.user.id, checklist: [{ text: `${result}${d.note ? `: ${d.note}` : ""}`, done: true }] })
        .where(and(eq(tasks.id, t.id), inArray(tasks.status, ["todo", "in_progress"])));
      await taskEvent(tx, t, { action: "complete", from: t.status, to: "done", actorId: auth.user.id, note: `${result}${d.note ? ` — ${d.note}` : ""}` });
      await tx.insert(waqfTimelineEvents).values({ waqfId: w.id, type: "file_review", occurredOn: new Date().toISOString().slice(0, 10), stage: w.stage, createdBy: auth.user.id, title: `${result}: ${t.title.replace(/^مراجعة تعديل على ملف الوقف: /, "")}`, details: d.note || null });
    });
    await audit(tx, { actorUserId: auth.user.id, action: d.decision === "approve" ? "waqf.file_review_approved" : "waqf.file_review_returned", entityType: "task", entityId: t.id, waqfId: w.id, ip, userAgent, after: { note: d.note || undefined } });
    if (t.createdBy) await notify(t.createdBy, "waqf.file_review_result", { waqf: w.name, result, note: d.note }, { waqfId: w.id, link: `/app/w/${w.id}`, tx });
    return { ok: true, message: d.decision === "approve" ? "اعتُمد التعديل وأُغلقت مراجعته." : "سُجّل أن التعديل يحتاج تصحيحًا، وأُبلغ صاحبه." };
  }, { perm: "admin.waqfs.edit", revalidate: () => [`/admin/waqfs/${fd.get("waqfId")}`, `/app/w/${fd.get("waqfId")}`] });
}
