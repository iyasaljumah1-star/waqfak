"use server";
import { z } from "zod";
import { tasks } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { parseForm, UserError, waqfAction } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { CHANGE_REQUEST_SECTIONS, changeRequestRefusal } from "./file-review-pure";
import { reviewerIds } from "./file-review";

const oneLine = (max: number, min: number, msg: string) => z.string().trim().transform((v) => v.replace(/\s+/g, " ")).pipe(z.string().min(min, msg).max(max));
const schema = z.object({
  waqfId: z.uuid(),
  section: z.enum(CHANGE_REQUEST_SECTIONS, { error: "اختر القسم المطلوب تعديله." }),
  details: oneLine(2000, 15, "اكتب البيانات المطلوب تغييرها: ما القيمة الحالية وما المطلوب (15 حرفًا على الأقل)."),
  reason: oneLine(1000, 10, "اكتب مبرر التعديل وسنده (10 أحرف على الأقل)."),
});

/**
 * The founder of a documented waqf asks the team to change its file (owner's decision of 2026-10-26, option «ب»): the
 * founder no longer edits a documented file directly. The request — section, what to change, why — becomes an internal
 * item for the team holding «admin.waqfs.edit», who accept and carry it out in the file (their edits keep before/after in
 * the audit trail and are reviewed by another editor) or return it with a reason. Checked on the server: founder role,
 * documented status, and no direct edit right.
 */
export async function requestFileChange(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(d.waqfId, "waqf.view", async ({ auth, access, tx, ip, userAgent }) => {
    const refusal = changeRequestRefusal({ roles: access.roles, status: access.waqf.status, canEdit: access.perms.has("waqf.edit") || access.perms.has("deed.edit") });
    if (refusal) throw new UserError(refusal);
    const w = access.waqf;
    const [t] = await tx.insert(tasks).values({
      waqfId: w.id, sourceType: "waqf", sourceId: w.id, kind: "file_change_request",
      title: `طلب تعديل من الواقف: ${d.section}`,
      description: [`${w.name} (${w.internalNumber})`, `القسم: ${d.section}`, `المطلوب: ${d.details}`, `المبرر: ${d.reason}`, `قدّمه: ${auth.user.fullName ?? "الواقف"}`].join("\n"),
      priority: "normal", visibility: "internal", createdBy: auth.user.id, updatedBy: auth.user.id,
    }).returning({ id: tasks.id });
    await audit(tx, { actorUserId: auth.user.id, action: "waqf.change_requested", entityType: "task", entityId: t.id, waqfId: w.id, ip, userAgent, after: { section: d.section, details: d.details, reason: d.reason } });
    const { asSystem } = await import("@/server/db/as-system");
    for (const u of await asSystem(tx, () => reviewerIds(tx)))
      await notify(u, "waqf.file_review_due", { waqf: w.name, what: `طلب تعديل: ${d.section}`, by: auth.user.fullName ?? "الواقف", why: d.reason }, { waqfId: w.id, link: `/admin/waqfs/${w.id}#file-reviews`, tx });
    return { ok: true, message: "أُرسل طلب التعديل إلى فريق «وقفك». تبقى بيانات الملف كما هي حتى ينفذه الفريق، وتصلك نتيجته." };
  }, [`/app/w/${d.waqfId}`, `/admin/waqfs/${d.waqfId}`]);
}
