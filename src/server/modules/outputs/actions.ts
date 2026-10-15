"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { deliverables, outputs, tasks } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { loadRequestCtx, type RequestCtx } from "@/server/modules/requests/access";
import type { ActCtx } from "@/server/modules/requests/engine";
import { syncTask, taskEvent } from "@/server/modules/operations/exec";
import type { ActionState } from "@/lib/utils";
import { SPECIALTY_LABEL } from "./catalog";
import { draftInputs } from "./live";
import { readSeparationPolicy } from "@/server/modules/approvals/policy";
import { applyEdits, approvalCheck, DRAFT_STATUSES, mergeRegenerated, readiness } from "./pure";
import { addVersion, ensureOutput, preparersOf, versionOf, type OutputRow } from "./server";
import { cycleOutputFor } from "@/server/modules/operations/continuous";
import { parseCycleKey } from "@/server/modules/operations/continuous-pure";

/**
 * Service outputs: generate a draft from the request's data, edit it, submit it for review, return or approve it.
 * Generation never approves; approval follows the output's review policy; every step is a version, a task event or an
 * audit entry — all internal: the client's request history shows the work only when it is handed over.
 */

const uuid = z.string().uuid("قيمة غير صالحة.");
const reval = (id: string) => [`/admin/requests/${id}`, `/app/requests/${id}`, "/admin"];
const WORKING = DRAFT_STATUSES;

async function ctxFor(c: ActCtx, requestId: string) {
  const rc = await loadRequestCtx(c.tx, c.auth, requestId, "staff");
  if (!rc.staffSide) throw new ForbiddenError();
  return rc;
}

async function loadOutput(c: ActCtx, outputId: string, requestId: string): Promise<{ o: OutputRow; rc: RequestCtx }> {
  const [o] = await c.tx.select().from(outputs).where(and(eq(outputs.id, outputId), eq(outputs.requestId, requestId))).limit(1).for("update");
  if (!o) throw new UserError("المخرج غير موجود أو لا تملك صلاحية الوصول إليه.");
  return { o, rc: await ctxFor(c, o.requestId) };
}

async function linkedTask(c: ActCtx, requestId: string, kind: string, outputKey: string) {
  const [t] = await c.tx.select().from(tasks).where(and(eq(tasks.requestId, requestId), eq(tasks.kind, kind), eq(tasks.outputKey, outputKey))).limit(1);
  return t ?? null;
}

// ───────────────────────── generate / regenerate ─────────────────────────

const genSchema = z.object({ id: uuid, outputKey: z.string().min(3).max(40), confirm: z.string().optional().default("") });

export async function generateOutput(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(genSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    if (!c.auth.perms.has("staff.deliver")) throw new ForbiddenError("إعداد المخرجات يتطلب صلاحية التسليم.");
    const rc = await ctxFor(c, d.id);
    if (!WORKING.includes(rc.req.status)) throw new UserError("تُعد المسودة ما دام الطلب مفتوحًا قبل تسليمه (من استلامه حتى مراجعة الجودة). للاطلاع على مخرج طلب منتهٍ افتح معاينته.");
    const inp = await draftInputs(c.tx, rc, d.outputKey);
    if (!inp) throw new UserError("هذا المخرج غير معرّف لهذه الخدمة.");
    const { def, cyc } = inp;
    if (cyc && !cyc.record && cyc.cycle.status !== "open") throw new UserError("الدورة ليست مفتوحة: أُتيح تسليمها أو أُقفلت أو تُجووزت.");
    if (cyc?.record && cyc.cycle.status !== "sent") throw new UserError("يُعدّ محضر التسليم بعد إتاحة التسليم للعميل وقبل إقفال الدورة.");
    if (cyc && rc.req.status !== "in_progress") throw new UserError("تُعد مخرجات الدورات أثناء سريان الخدمة (لا أثناء التعليق).");
    const prepTask = await linkedTask(c, rc.req.id, "prepare_output", def.key);
    const o = await ensureOutput(c.tx, rc, def, c.auth.user.id, prepTask?.id ?? null);
    const fresh = inp.draft;
    let version: number;
    let kept = 0;
    if (!o.currentVersion) {
      version = await addVersion(c.tx, o, { origin: "generated", sections: fresh.sections, gaps: fresh.gaps, sources: fresh.sources, inputsHash: fresh.inputsHash, basedOn: null, actorId: c.auth.user.id, note: "مسودة أولى من بيانات الطلب والوقف" });
    } else {
      const cur = await versionOf(c.tx, o.id, o.currentVersion);
      if (cur?.inputsHash === fresh.inputsHash && cur.origin !== "edited") return { ok: true, message: "لم تتغير البيانات منذ آخر توليد؛ المسودة الحالية مطابقة." };
      if (cur?.origin === "edited" && d.confirm !== "on")
        return { error: "النسخة الحالية فيها تعديلات بشرية. أكّد إعادة التوليد: تبقى النسخة الحالية في السجل، وتُنقل التعديلات والنصوص المكتوبة إلى النسخة الجديدة.", data: { needConfirm: true } };
      const merged = cur ? mergeRegenerated(cur.sections, fresh.sections, fresh.gaps) : { sections: fresh.sections, gaps: fresh.gaps, kept: 0 };
      kept = merged.kept;
      version = await addVersion(c.tx, { ...o, status: o.status === "returned" ? "draft" : o.status }, { origin: "regenerated", sections: merged.sections, gaps: merged.gaps, sources: fresh.sources, inputsHash: fresh.inputsHash, basedOn: o.currentVersion, actorId: c.auth.user.id, note: kept ? `أُعيد التوليد مع الإبقاء على ${kept} من التعديلات البشرية` : "أُعيد التوليد من البيانات الحالية" });
    }
    if (prepTask && prepTask.status === "todo") await syncTask(c.tx, rc.req.id, "prepare_output", { outputKey: def.key }, "in_progress", c.auth.user.id, "بدأ إعداد المسودة");
    if (prepTask) await taskEvent(c.tx, prepTask, { action: "output", actorId: c.auth.user.id, note: `${version === 1 ? "وُلّدت المسودة" : "أُعيد توليد المسودة"} (نسخة ${version})`, outputId: o.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: version === 1 ? "outputs.generate" : "outputs.regenerate", entityType: "output", entityId: o.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, version, gaps: fresh.gaps.length, keptEdits: kept } });
    return { ok: true, message: version === 1 ? "أُعدّت المسودة من بيانات الطلب والوقف. راجعها وأكمل ما يكتبه المختص." : `أُعيد توليد المسودة (نسخة ${version}).`, data: { outputId: o.id } };
  }, { revalidate: reval(d.id) });
}

// ───────────────────────── edit ─────────────────────────

export async function saveOutputEdits(_: ActionState, fd: FormData): Promise<ActionState> {
  const outputId = String(fd.get("outputId") ?? "");
  const requestId = String(fd.get("requestId") ?? "");
  const base = Number(fd.get("baseVersion"));
  if (!uuid.safeParse(outputId).success || !uuid.safeParse(requestId).success || !Number.isInteger(base)) return { error: "طلب غير صالح." };
  const fields: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && /^(spec|fact|note|drop|clause):|^new_(title|body)$/.test(k)) fields[k] = v;
  return userAction(async (c) => {
    if (!c.auth.perms.has("staff.deliver") && !c.auth.perms.has("staff.quality_review")) throw new ForbiddenError("تعديل المخرجات لمن يعدّها أو يراجعها.");
    const { o } = await loadOutput(c, outputId, requestId);
    if (o.currentVersion !== base) throw new UserError("عُدّلت المسودة بعد فتحك لها. حدّث الصفحة ثم أعد التعديل.");
    const cur = await versionOf(c.tx, o.id, o.currentVersion);
    if (!cur) throw new UserError("لا مسودة لتعديلها. ولّد المسودة أولًا.");
    const edited = applyEdits(cur.sections, fields);
    if (!edited.changed) return { ok: true, message: "لا تغييرات للحفظ." };
    const version = await addVersion(c.tx, o, { origin: "edited", sections: edited.sections, gaps: cur.gaps.filter((g) => !g.key.startsWith("conflict:")), sources: cur.sources, inputsHash: cur.inputsHash, basedOn: cur.version, actorId: c.auth.user.id, note: String(fd.get("note") ?? "").slice(0, 500) || null });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.edit", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, version } });
    return { ok: true, message: `حُفظت التعديلات في نسخة جديدة (${version}).` };
  }, { revalidate: reval(requestId) });
}

// ───────────────────────── submit / return / approve ─────────────────────────

const idSchema = z.object({ outputId: uuid, requestId: uuid, note: z.string().trim().max(2000).optional().default(""), signedBy: z.string().trim().max(300).optional().default("") });

export async function submitOutput(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  return userAction(async (c) => {
    if (!c.auth.perms.has("staff.deliver")) throw new ForbiddenError("إرسال المخرج للمراجعة يتطلب صلاحية التسليم.");
    const { o, rc } = await loadOutput(c, r.data.outputId, r.data.requestId);
    if (o.status !== "draft" && o.status !== "returned") throw new UserError("المخرج ليس مسودة.");
    const cur = await versionOf(c.tx, o.id, o.currentVersion);
    if (!cur) throw new UserError("لا مسودة لإرسالها.");
    const ready = readiness(cur.sections, cur.gaps);
    if (!ready.ready) {
      const parts = [...ready.blocking.map((g) => g.label), ...ready.unwritten.map((u) => `لم يُكتب: ${u.section}`)];
      throw new UserError(`لا تُرسل المسودة للمراجعة وفيها نواقص: ${parts.slice(0, 4).join("؛ ")}${parts.length > 4 ? "…" : ""}`);
    }
    await c.tx.update(outputs).set({ status: "in_review", submittedBy: c.auth.user.id, submittedAt: new Date(), reviewNote: null, updatedBy: c.auth.user.id }).where(eq(outputs.id, o.id));
    await syncTask(c.tx, rc.req.id, "prepare_output", { outputKey: o.outputKey }, "done", c.auth.user.id, `أُرسلت المسودة (نسخة ${o.currentVersion}) للمراجعة`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.submit", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, version: o.currentVersion, warnings: ready.warnings.length } });
    return { ok: true, message: "أُرسل المخرج للمراجعة." };
  }, { revalidate: reval(r.data.requestId) });
}

export async function returnOutput(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  if (r.data.note.length < 5) return { error: "اكتب ما يلزم تعديله.", fieldErrors: { note: "اكتب سبب الإعادة (5 أحرف على الأقل)." } };
  return userAction(async (c) => {
    if (!c.auth.perms.has("staff.quality_review") && !c.auth.perms.has("admin.requests.all")) throw new ForbiddenError("إعادة المخرج للتعديل لمن يراجعه.");
    const { o, rc } = await loadOutput(c, r.data.outputId, r.data.requestId);
    if (o.status !== "in_review") throw new UserError("المخرج ليس بانتظار المراجعة.");
    await c.tx.update(outputs).set({ status: "returned", reviewNote: r.data.note, updatedBy: c.auth.user.id }).where(eq(outputs.id, o.id));
    await syncTask(c.tx, rc.req.id, "prepare_output", { outputKey: o.outputKey }, "todo", c.auth.user.id, `أُعيد المخرج للتعديل: ${r.data.note}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.return", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, note: r.data.note } });
    return { ok: true, message: "أُعيد المخرج للتعديل." };
  }, { revalidate: reval(r.data.requestId) });
}

export async function approveOutput(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  return userAction(async (c) => {
    const { o, rc } = await loadOutput(c, r.data.outputId, r.data.requestId);
    if (o.status !== "in_review") throw new UserError("يُعتمد المخرج بعد إرساله للمراجعة.");
    const check = approvalCheck({
      policy: o.reviewPolicy, approverId: c.auth.user.id, preparers: await preparersOf(c.tx, o),
      canReview: c.auth.perms.has("staff.quality_review"), isManager: c.auth.perms.has("admin.requests.all"),
      direct: c.auth.perms.has("approvals.direct"), separation: await readSeparationPolicy(c.tx),
    });
    if (!check.ok) throw new UserError(check.error);
    const cur = await versionOf(c.tx, o.id, o.currentVersion);
    if (!cur) throw new UserError("لا نسخة لاعتمادها.");
    const ready = readiness(cur.sections, cur.gaps);
    if (!ready.ready) throw new UserError("لا يُعتمد مخرج فيه نواقص جوهرية أو أجزاء لم يكتبها المختص.");
    const opinion = rc.workflowCode === "opinion" || o.specialty === "sharia";
    if (opinion && r.data.signedBy.length < 5) return { error: "الرأي المتخصص يُوقَّع باسم المستشار وصفته.", fieldErrors: { signedBy: "اكتب اسم المستشار وصفته." } };
    const now = new Date();
    await c.tx.update(outputs).set({ status: "approved", approvedVersion: o.currentVersion, approvedBy: c.auth.user.id, approvedAt: now, selfApproved: check.self, documentId: null, deliverableId: null, updatedBy: c.auth.user.id }).where(eq(outputs.id, o.id));
    // Delivery record in the request's existing flow (QA → client approval). The PDF is produced when it is released.
    const prev = await c.tx.select({ v: deliverables.version }).from(deliverables).where(and(eq(deliverables.requestId, rc.req.id), eq(deliverables.outputId, o.id)));
    const cyc = parseCycleKey(o.outputKey) ? await cycleOutputFor(c.tx, rc, o.outputKey) : null;
    const [del] = await c.tx.insert(deliverables).values({
      requestId: rc.req.id, waqfId: rc.req.waqfId, title: o.title, version: Math.max(0, ...prev.map((p) => p.v)) + 1, status: "submitted", signedBy: r.data.signedBy || null,
      submittedAt: now, outputId: o.id, createdBy: o.submittedBy ?? c.auth.user.id, cycleId: cyc?.cycle.id ?? null,
    }).returning({ id: deliverables.id });
    await c.tx.update(outputs).set({ deliverableId: del.id }).where(eq(outputs.id, o.id));
    await syncTask(c.tx, rc.req.id, "review_output", { outputKey: o.outputKey }, "done", c.auth.user.id, check.self ? "اعتماد ذاتي وفق سياسة المخرج" : "اعتُمد المخرج");
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.approve", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, after: { number: o.number, version: o.currentVersion, selfApproved: check.self, policy: o.reviewPolicy, specialty: SPECIALTY_LABEL[o.specialty], note: r.data.note || undefined } });
    const tail = cyc ? " لم يُرسل للعميل بعد: يُرسل من لوحة الخدمة المستمرة." : "";
    return { ok: true, message: (check.self ? "اعتُمد المخرج (اعتماد ذاتي مسجّل)." : "اعتُمد المخرج.") + tail };
  }, { revalidate: reval(r.data.requestId) });
}

/** After the client asks for changes, an approved output is reopened as a draft (its approval stays in the history). */
export async function reviseOutput(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(idSchema, fd);
  if ("state" in r) return r.state;
  return userAction(async (c) => {
    if (!c.auth.perms.has("staff.deliver")) throw new ForbiddenError();
    const { o, rc } = await loadOutput(c, r.data.outputId, r.data.requestId);
    if (o.status !== "approved") throw new UserError("تُفتح المراجعة على مخرج معتمد فقط.");
    if (parseCycleKey(o.outputKey)) {
      const cyc = await cycleOutputFor(c.tx, rc, o.outputKey);
      if (cyc && cyc.cycle.status !== "open") throw new UserError("أُرسل تسليم هذه الدورة للعميل: يبقى كما أُرسل، ويُعالج التصحيح في الدورة التالية أو بملاحظة موثقة.");
    }
    if (rc.req.status !== "in_progress") throw new UserError("يُعدّل المخرج المعتمد بعد إعادة الطلب للتنفيذ (طلب تعديلات من العميل أو من مراجعة الجودة).");
    await c.tx.update(outputs).set({ status: "draft", documentId: null, deliverableId: null, updatedBy: c.auth.user.id }).where(eq(outputs.id, o.id));
    await syncTask(c.tx, rc.req.id, "prepare_output", { outputKey: o.outputKey }, "todo", c.auth.user.id, `فُتحت مراجعة جديدة للمخرج${r.data.note ? `: ${r.data.note}` : ""}`);
    await syncTask(c.tx, rc.req.id, "review_output", { outputKey: o.outputKey }, "todo", c.auth.user.id, "بانتظار اعتماد المراجعة الجديدة");
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "outputs.revise", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: "approved", version: o.approvedVersion } });
    return { ok: true, message: "فُتحت مراجعة جديدة للمخرج." };
  }, { revalidate: reval(r.data.requestId) });
}
