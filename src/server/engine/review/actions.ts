"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { deliverables, outputs, requestStages, serviceRequests, tasks } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { notify } from "@/server/modules/notify";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { logEvent } from "@/server/modules/requests/engine";
import { releaseApprovedOutputs, versionOf } from "@/server/modules/outputs/server";
import { transitionGate } from "@/server/modules/outputs/quality";
import type { ActionState } from "@/lib/utils";
import { PROFESSIONAL_REQUIREMENTS } from "../constants";
import { enqueueProcessing, retryDead } from "../queue/queue";
import { kick } from "../queue/worker";
import { finalApproverIds } from "../pipeline/run";

/**
 * The system administrator's decisions on an engine-processed request (owner's order of 2026-11-01): final approval
 * (the only way an output reaches the client), regeneration with written guidance, reopening for an edit, re-checking
 * after an edit, asking the client, and retrying a failed processing. All checked on the server: «outputs.final_approve»
 * (system administrator), plus the database trigger on the output itself.
 */

const uuid = z.string().uuid();
const reval = (id: string) => ["/admin/review", `/admin/review/${id}`, `/admin/requests/${id}`, `/app/requests/${id}`, "/app/requests", "/app"];

async function engineRequest(c: Parameters<Parameters<typeof userAction>[0]>[0], id: string) {
  if (!c.auth.perms.has("outputs.final_approve")) throw new ForbiddenError("الاعتماد النهائي لمدير النظام وحده.");
  const rc = await loadRequestCtx(c.tx, c.auth, id, "staff");
  if (rc.req.processingMode !== "engine") throw new UserError("هذا الطلب على مسار الفريق، لا على المعالجة الآلية.");
  return rc;
}

const approveSchema = z.object({
  id: uuid,
  note: z.string().trim().max(2000).optional().default(""),
  professionalName: z.string().trim().max(200).optional().default(""),
  professionalLicense: z.string().trim().max(100).optional().default(""),
  confirm: z.string().optional().default(""),
});

/**
 * Final approval: every output of the request is approved at its current version (fixed — any later change is a new
 * version), released to the client as a PDF, the request becomes «معتمد», the client is told; who approved, when and
 * which version are recorded. A professional requirement of the service is satisfied first; the approval does not
 * replace it.
 */
export async function finalApprove(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(approveSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.confirm !== "on") return { error: "أكّد أنك راجعت المخرج كاملًا قبل اعتماده.", fieldErrors: { confirm: "أكّد المراجعة." } };
  return userAction(async (c) => {
    await c.tx.execute(sqlLock(d.id));
    const rc = await engineRequest(c, d.id);
    if (rc.req.status !== "quality_review") throw new UserError(rc.req.status === "completed" || rc.req.status === "closed" ? "اعتُمد هذا الطلب مسبقًا." : "لا مخرج مكتمل بانتظار الاعتماد في هذا الطلب.");
    const prof = PROFESSIONAL_REQUIREMENTS[rc.service.code];
    if (prof && (d.professionalName.length < 5 || d.professionalLicense.length < 3))
      return { error: `شرط مهني لهذه الخدمة لا يغني عنه الاعتماد: ${prof}. اكتب اسم المختص المرخص وصفته ورقم ترخيصه.`, fieldErrors: { professionalName: "مطلوب", professionalLicense: "مطلوب" } };
    const outs = (await c.tx.select().from(outputs).where(eq(outputs.requestId, rc.req.id)).for("update")).filter((o) => !o.outputKey.includes("@c"));
    if (!outs.length) throw new UserError("لا مخرج في الطلب.");
    const pending = outs.filter((o) => o.status !== "in_review" && o.status !== "approved");
    if (pending.length) throw new UserError(`مخرج لم يكتمل بعد: ${pending.map((o) => o.title).join("، ")}. أعد التحقق بعد التعديل أو أعد التوليد.`);
    const now = new Date();
    const meta = { actorId: c.auth.user.id, ip: c.ip, userAgent: c.userAgent };
    const approved: { output: string; version: number }[] = [];
    for (const o of outs.filter((x) => x.status === "in_review")) {
      const cur = await versionOf(c.tx, o.id, o.currentVersion);
      if (!cur) throw new UserError(`${o.title}: لا نسخة.`);
      const gate = await transitionGate(c.tx, rc, o, cur, "approve", meta);
      if (gate.errors.length) {
        await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.final_approve_blocked", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, version: o.currentVersion, reasons: gate.errors.slice(0, 10) } });
        return { error: `لا يُعتمد «${o.title}»: ${gate.errors.slice(0, 4).join("؛ ")}${gate.errors.length > 4 ? `… (${gate.errors.length})` : ""}` };
      }
      const signedBy = prof ? `${d.professionalName} — ترخيص ${d.professionalLicense}` : null;
      await c.tx.update(outputs).set({ status: "approved", approvedVersion: o.currentVersion, approvedBy: c.auth.user.id, approvedAt: now, selfApproved: false, documentId: null, updatedBy: c.auth.user.id }).where(eq(outputs.id, o.id));
      const prev = await c.tx.select({ v: deliverables.version }).from(deliverables).where(and(eq(deliverables.requestId, rc.req.id), eq(deliverables.outputId, o.id)));
      const [del] = await c.tx.insert(deliverables).values({
        requestId: rc.req.id, waqfId: rc.req.waqfId, title: o.title, version: Math.max(0, ...prev.map((p) => p.v)) + 1, status: "approved", signedBy,
        submittedAt: o.submittedAt ?? now, approvedAt: now, approvedBy: c.auth.user.id, outputId: o.id, createdBy: o.submittedBy ?? c.auth.user.id, releasedAt: now,
      }).returning({ id: deliverables.id });
      await c.tx.update(outputs).set({ deliverableId: del.id }).where(eq(outputs.id, o.id));
      approved.push({ output: o.number, version: o.currentVersion });
    }
    // the approved versions become the client's documents (PDF in the vault, approved), and only now
    const released = await releaseApprovedOutputs(c.tx, rc, c.auth.user.id, { ip: c.ip, userAgent: c.userAgent });
    await c.tx.update(serviceRequests).set({ status: "completed", completedAt: now, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, rc.req.id));
    // the client's approval is not a step of an engine request: recorded as skipped, never as done by someone else
    await c.tx.update(requestStages).set({ status: "skipped" }).where(and(eq(requestStages.requestId, rc.req.id), eq(requestStages.stageKey, "client_review"), inArray(requestStages.status, ["pending", "active"])));
    await c.tx.update(requestStages).set({ status: "done", completedAt: now, completedBy: c.auth.user.id }).where(and(eq(requestStages.requestId, rc.req.id), inArray(requestStages.status, ["pending", "active"])));
    await logEvent(c.tx, rc.req, c.auth.user.id, "اعتُمدت النتيجة نهائيًا وأُتيحت للعميل", "quality_review", "completed");
    await audit(c.tx, {
      actorUserId: c.auth.user.id, action: "outputs.final_approved", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent,
      before: { status: "quality_review" }, after: { status: "completed", approved, released, professional: prof ? { name: d.professionalName, license: d.professionalLicense } : undefined, note: d.note || undefined },
    });
    await notify(rc.req.requesterUserId, "request.status", { number: rc.req.number, status: "معتمد — النتيجة متاحة لك في حسابك" }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}`, tx: c.tx });
    return { ok: true, message: `اعتُمدت النتيجة (${approved.map((a) => `${a.output} نسخة ${a.version}`).join("، ")}) وأُتيحت للعميل وأُشعر بذلك.` };
  }, { revalidate: reval(d.id) });
}

const regenSchema = z.object({ id: uuid, instruction: z.string().trim().min(10, "اكتب التوجيه (10 أحرف على الأقل).").max(2000) });

/** Regenerates the output with the administrator's written guidance (recorded on the run that uses it). */
export async function regenerateWithInstruction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(regenSchema, fd);
  if ("state" in r) return r.state;
  const res = await userAction(async (c) => {
    const rc = await engineRequest(c, r.data.id);
    if (!["quality_review", "in_progress"].includes(rc.req.status)) throw new UserError("تُعاد الصياغة قبل الاعتماد فقط.");
    await enqueueProcessing(c.tx, { requestId: rc.req.id, waqfId: rc.req.waqfId, reason: "إعادة توليد بتوجيه مدير النظام", requestedBy: c.auth.user.id, instruction: r.data.instruction });
    await logEvent(c.tx, rc.req, c.auth.user.id, `طلب مدير النظام إعادة التوليد: ${r.data.instruction}`, null, null, { internal: true });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "engine.regenerate", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { instruction: r.data.instruction } });
    return { ok: true, message: "أُدرج طلب إعادة التوليد في المعالجة؛ تظهر النسخة الجديدة هنا حين تكتمل." };
  }, { revalidate: reval(r.data.id) });
  if (res.ok) after(() => kick());
  return res;
}

const idSchema = z.object({ id: uuid });

/** Reopens the outputs for a direct edit in the output editor (they leave «awaiting approval»; versions are kept). */
export async function reopenForEdit(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  return userAction(async (c) => {
    const rc = await engineRequest(c, r.data.id);
    if (rc.req.status !== "quality_review") throw new UserError("يُفتح المخرج للتعديل وهو بانتظار الاعتماد.");
    await c.tx.update(outputs).set({ status: "returned", reviewNote: "فتحه مدير النظام للتعديل", updatedBy: c.auth.user.id }).where(and(eq(outputs.requestId, rc.req.id), eq(outputs.status, "in_review")));
    await c.tx.update(serviceRequests).set({ status: "in_progress", updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, rc.req.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, "فتح مدير النظام المخرج للتعديل قبل الاعتماد", "quality_review", "in_progress", { internal: true });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "engine.reopen_for_edit", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent });
    return { ok: true, message: "فُتح المخرج للتعديل. عدّله من محرر المخرج، ثم اطلب «أعد التحقق» هنا." };
  }, { revalidate: reval(r.data.id) });
}

/** After an edit: the engine verifies the edited version (no regeneration) and hands it back for the final approval. */
export async function verifyAfterEdit(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  const res = await userAction(async (c) => {
    const rc = await engineRequest(c, r.data.id);
    if (rc.req.status !== "in_progress") throw new UserError("لا تعديل مفتوح للتحقق منه.");
    await enqueueProcessing(c.tx, { requestId: rc.req.id, waqfId: rc.req.waqfId, reason: "التحقق بعد تعديل مدير النظام", requestedBy: c.auth.user.id, kind: "verify" });
    return { ok: true, message: "يُتحقق من النسخة المعدّلة الآن." };
  }, { revalidate: reval(r.data.id) });
  if (res.ok) after(() => kick());
  return res;
}

/** Retries a processing that failed after its attempts (the history of the failed attempts stays). */
export async function retryProcessing(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  const res = await userAction(async (c) => {
    const rc = await engineRequest(c, r.data.id);
    const ok = await retryDead(c.tx, rc.req.id, c.auth.user.id);
    if (!ok) await enqueueProcessing(c.tx, { requestId: rc.req.id, waqfId: rc.req.waqfId, reason: "إعادة المعالجة بطلب مدير النظام", requestedBy: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "engine.retry", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent });
    return { ok: true, message: "أُعيدت المعالجة إلى الطابور." };
  }, { revalidate: reval(r.data.id) });
  if (res.ok) after(() => kick());
  return res;
}

// ───────────────────────── the client: a correction request after approval ─────────────────────────

const corrSchema = z.object({ id: uuid, details: z.string().trim().min(10, "اكتب ما يلزم تصحيحه (10 أحرف على الأقل).").max(3000) });

/**
 * After the final approval, the client may ask for a correction (owner's decision of 2026-11-01, item 3). It does not
 * reopen or change the approved document: it is a separate request to the system administrator, recorded and tracked;
 * an accepted correction produces a new version through a new review, never by editing the approved one.
 */
export async function requestCorrection(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(corrSchema, fd);
  if ("state" in r) return r.state;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, r.data.id, "client");
    if (!rc.isRequester && !rc.memberCreate) throw new ForbiddenError("لا تملك صلاحية طلب تصحيح على هذا الطلب.");
    if (!["completed", "closed"].includes(rc.req.status)) throw new UserError("يُطلب التصحيح بعد اعتماد النتيجة.");
    const { asSystem } = await import("@/server/db/as-system");
    await asSystem(c.tx, async () => {
      await c.tx.insert(tasks).values({
        requestId: rc.req.id, waqfId: rc.req.waqfId, kind: "correction_request", title: `طلب تصحيح من العميل على الطلب ${rc.req.number}`,
        description: r.data.details, status: "todo", priority: "high", visibility: "internal", createdBy: c.auth.user.id,
      } as typeof tasks.$inferInsert);
      for (const uid of await finalApproverIds(c.tx))
        await notify(uid, "request.status", { number: rc.req.number, status: "طلب تصحيح من العميل بعد الاعتماد" }, { waqfId: rc.req.waqfId, link: `/admin/review/${rc.req.id}`, tx: c.tx });
    });
    await logEvent(c.tx, rc.req, c.auth.user.id, "قدّم العميل طلب تصحيح على النتيجة المعتمدة");
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.correction_requested", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { details: r.data.details } });
    return { ok: true, message: "وصل طلب التصحيح إلى مدير النظام، وتصلك نتيجته. تبقى الوثيقة المعتمدة كما هي حتى يُعتمد تصحيحها بنسخة جديدة." };
  }, { revalidate: [`/app/requests/${r.data.id}`, `/admin/review/${r.data.id}`] });
}

/** The request row is locked for the whole approval (two approvals at once cannot both run). */
function sqlLock(id: string) {
  return sql`select 1 from service_requests where id = ${id} for update`;
}
