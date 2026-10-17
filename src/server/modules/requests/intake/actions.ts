"use server";

import { redirect } from "next/navigation";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { documents, recommendations, serviceRequests, services, waqfs } from "@/server/db/schema";
import { ForbiddenError, loadWaqfAccess } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { loadRequestCtx, memberCan } from "../access";
import { flagMap, readSetting, serviceAvailability, type License } from "../catalog";
import { logEvent, type ActCtx } from "../engine";
import { sanitizeAnswers, validateStep, visibleSteps } from "./engine";
import { withServerAnswers } from "./server";
import { intakeOf, prefillAnswers, serviceForm, submitDraft, validDocMap } from "./server";

const uuid = z.string().uuid("قيمة غير صالحة.");
const reval = (id: string) => [`/app/requests/${id}`, `/app/requests/${id}/intake`, "/app/requests"];

// ───────────────────────── Start (creates the draft) ─────────────────────────

const startSchema = z.object({ service: z.string().min(2, "اختر الخدمة."), waqf: z.string().optional().default(""), rec: z.string().optional().default("") });

/** Opens (or resumes) a draft request for a service. The draft carries the answers and the uploaded documents. */
export async function startRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(startSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let id = "";
  let existingOpen = "";
  const res = await userAction(async ({ auth, tx, ip, userAgent }) => {
    const [svc] = await tx.select().from(services).where(and(eq(services.code, d.service.toUpperCase()), eq(services.isPublished, true))).limit(1);
    if (!svc) throw new UserError("الخدمة غير موجودة.");
    const avail = serviceAvailability(svc, await flagMap(tx), await readSetting<License[]>(tx, "company.licenses", []));
    if (!avail.available) throw new UserError(`الخدمة غير متاحة حاليًا: ${avail.reason}`);
    let waqfId: string | null = null;
    if (svc.code === "N01" && (!d.waqf || d.waqf === "none")) throw new UserError("اختر الوقف المطلوب تولي نظارته. إن لم يكن له ملف بعد، أنشئه من «أوقافي» ثم قدّم الطلب.");
    if (d.waqf && d.waqf !== "none") {
      if (!uuid.safeParse(d.waqf).success) throw new UserError("اختر وقفًا صحيحًا.");
      if (!(await memberCan(tx, auth, d.waqf, "requests.create"))) throw new ForbiddenError("لا تملك صلاحية طلب خدمات لهذا الوقف.");
      const [w] = await tx.select({ id: waqfs.id }).from(waqfs).where(eq(waqfs.id, d.waqf)).limit(1);
      if (!w) throw new ForbiddenError("لا يمكنك الوصول إلى هذا الوقف.");
      waqfId = w.id;
    } else if (!d.waqf) throw new UserError("اختر الوقف، أو «لا يوجد وقف بعد» إن كانت الخدمة قبل إنشائه.");

    // Resume an open draft for the same service and waqf instead of piling up drafts.
    const [existing] = await tx
      .select({ id: serviceRequests.id, waqfId: serviceRequests.waqfId })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.requesterUserId, auth.user.id), eq(serviceRequests.serviceId, svc.id), eq(serviceRequests.status, "draft")))
      .orderBy(desc(serviceRequests.updatedAt));
    if (existing && existing.waqfId === waqfId) {
      id = existing.id;
      return;
    }
    // A waqf being established has one request per establishment service: an open one is continued, not duplicated.
    if (waqfId && /^T0\d$/.test(svc.code)) {
      const [w] = await tx.select({ status: waqfs.status }).from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
      if (w && ["idea", "draft", "documenting"].includes(w.status)) {
        const [open] = await tx.select({ id: serviceRequests.id }).from(serviceRequests)
          .where(and(eq(serviceRequests.serviceId, svc.id), eq(serviceRequests.waqfId, waqfId), notInArray(serviceRequests.status, ["draft", "closed", "cancelled", "rejected", "completed"])))
          .orderBy(desc(serviceRequests.createdAt)).limit(1);
        if (open) { existingOpen = open.id; return; }
      }
    }

    let recId: string | null = null;
    if (d.rec) {
      if (!uuid.safeParse(d.rec).success) throw new UserError("التوصية غير صالحة.");
      const [rec] = await tx.select().from(recommendations).where(eq(recommendations.id, d.rec)).limit(1);
      if (!rec) throw new UserError("التوصية غير موجودة.");
      if (rec.waqfId && rec.waqfId !== waqfId) throw new UserError("التوصية تخص وقفًا آخر.");
      recId = rec.id;
    }
    const form = serviceForm(svc);
    const answers = await prefillAnswers(tx, form, auth.user.id, waqfId);
    const number = await nextNumber(tx, "REQ");
    const [req] = await tx.insert(serviceRequests).values({
      number, serviceId: svc.id, waqfId, requesterUserId: auth.user.id, status: "draft", priority: "normal",
      source: recId ? "recommendation" : "manual", sourceRef: recId, details: null,
      intake: { preferredContact: "platform", formVersion: form.version, answers, docs: {} }, intakeFormVersion: form.version,
      departmentKey: svc.departmentKey, createdBy: auth.user.id,
    }).returning();
    id = req.id;
    await logEvent(tx, req, auth.user.id, "أُنشئت مسودة الطلب");
    await audit(tx, { actorUserId: auth.user.id, action: "requests.draft", entityType: "service_request", entityId: req.id, waqfId, ip, userAgent, after: { number, service: svc.code, source: recId ? "recommendation" : "manual" } });
  });
  if (res.error) return res;
  if (existingOpen) redirect(`/app/requests/${existingOpen}?existing=1`);
  redirect(`/app/requests/${id}/intake`);
}

// ───────────────────────── Save (draft) ─────────────────────────

async function editableDraft(c: ActCtx, id: string) {
  const rc = await loadRequestCtx(c.tx, c.auth, id, "client");
  if (!rc.isRequester && !rc.memberCreate) throw new ForbiddenError("لا تملك صلاحية تعديل هذا الطلب.");
  if (rc.req.status !== "draft") throw new UserError("أُرسل الطلب، ولا تُعدّل بياناته من النموذج. استخدم سجل النواقص أو المراسلات.");
  return rc;
}

function parseAnswers(fd: FormData): unknown {
  try {
    return JSON.parse(String(fd.get("answers") ?? "{}"));
  } catch {
    return {};
  }
}

/**
 * Saves the answers of the draft. With `step`, also validates that step and returns its field errors (the answers
 * are saved either way, so nothing typed is lost).
 */
export async function saveIntake(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  const stepKey = String(fd.get("step") ?? "");
  if (!uuid.safeParse(id).success) return { error: "طلب غير صالح." };
  const raw = parseAnswers(fd);
  return userAction(async (c) => {
    const rc = await editableDraft(c, id);
    const form = serviceForm(rc.service);
    const answers = withServerAnswers(form, rc.req.waqfId, raw);
    const intake = intakeOf(rc.req) as ReturnType<typeof intakeOf> & { dropped?: { at: string; by: string; values: Record<string, unknown> }[] };
    // answers that no longer apply after a change (hidden by the form rules) are kept with their values, not lost
    const rawObj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const prev = intake.answers ?? {};
    const droppedNow = Object.fromEntries(Object.entries(prev).filter(([k, v]) => v !== undefined && v !== "" && answers[k] === undefined && rawObj[k] !== undefined && rawObj[k] !== ""));
    const dropped = Object.keys(droppedNow).length ? [...(intake.dropped ?? []), { at: new Date().toISOString(), by: c.auth.user.id, values: droppedNow }].slice(-20) : intake.dropped;
    await c.tx.update(serviceRequests).set({ intake: { ...intake, answers, formVersion: form.version, ...(dropped ? { dropped } : {}) }, intakeFormVersion: form.version, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, id));
    const step = stepKey ? visibleSteps(form, answers).find((s) => s.key === stepKey) : null;
    const fieldErrors = step ? validateStep(step, answers) : {};
    if (Object.keys(fieldErrors).length) return { error: "حُفظت المسودة. أكمل الحقول المظللة للمتابعة.", fieldErrors };
    return { ok: true, message: "حُفظت المسودة.", data: { savedAt: new Date().toISOString() } };
  }, { revalidate: reval(id) });
}

// ───────────────────────── Documents of the draft ─────────────────────────

const attachSchema = z.object({ id: uuid, slot: z.string().regex(/^[A-Za-z0-9_]{1,40}$/, "خانة غير صالحة."), documentId: uuid, mode: z.enum(["add", "remove"]).default("add") });

/** Links an uploaded document (of this request or its waqf) to a document slot of the form, or unlinks it. */
export async function attachIntakeDoc(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(attachSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await editableDraft(c, d.id);
    const form = serviceForm(rc.service);
    const slot = form.docs.find((s) => s.key === d.slot);
    if (!slot) throw new UserError("خانة المستند غير معروفة.");
    const intake = intakeOf(rc.req);
    const docs = { ...(intake.docs ?? {}) };
    if (d.mode === "add") {
      const [doc] = await c.tx.select({ id: documents.id, requestId: documents.requestId, waqfId: documents.waqfId, confidentiality: documents.confidentiality }).from(documents).where(eq(documents.id, d.documentId)).limit(1);
      let belongs = !!doc && doc.requestId === d.id;
      if (doc && !belongs && rc.req.waqfId && doc.waqfId === rc.req.waqfId) {
        // A document from the waqf file: only one the user may see there.
        const access = await loadWaqfAccess(c.tx, c.auth, rc.req.waqfId);
        belongs = !!access?.perms.has("documents.view") && (doc.confidentiality === "internal" || (doc.confidentiality === "confidential" && access.perms.has("documents.view_confidential")));
      }
      if (!belongs) throw new UserError("الوثيقة ليست من وثائق هذا الطلب أو وقفه.");
      docs[d.slot] = [...new Set([...(docs[d.slot] ?? []), d.documentId])];
    } else {
      docs[d.slot] = (docs[d.slot] ?? []).filter((x) => x !== d.documentId);
      if (!docs[d.slot].length) delete docs[d.slot];
    }
    const valid = await validDocMap(c.tx, d.id, rc.req.waqfId, docs);
    await c.tx.update(serviceRequests).set({ intake: { ...intake, docs: valid }, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    return { ok: true, message: d.mode === "add" ? `أُرفقت الوثيقة في «${slot.label}».` : "أُزيلت الوثيقة من الخانة." };
  }, { revalidate: reval(d.id) });
}

// ───────────────────────── Submit ─────────────────────────

export async function submitIntake(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "طلب غير صالح." };
  if (fd.get("confirm") !== "on") return { error: "أكّد صحة البيانات قبل الإرسال.", fieldErrors: { confirm: "أكّد صحة البيانات قبل الإرسال." } };
  const raw = parseAnswers(fd);
  let ok = false;
  const res = await userAction(async (c) => {
    const rc = await editableDraft(c, id);
    const out = await submitDraft(c, rc, raw);
    if (!out.ok) {
      // Keep what was typed, report every gap at once.
      const form = serviceForm(rc.service);
      await c.tx.update(serviceRequests).set({ intake: { ...intakeOf(rc.req), answers: out.answers }, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, id));
      const missing = out.check.missingDocs.map((m) => m.label);
      const n = Object.keys(out.check.errors).length;
      return {
        error: [n ? `${n} حقل يحتاج إكمالًا أو تصحيحًا` : "", missing.length ? `مستندات مطلوبة لم تُرفق: ${missing.join("، ")}` : ""].filter(Boolean).join(". ") + ".",
        fieldErrors: out.check.errors,
        data: { firstStep: out.check.firstStep ?? (missing.length ? "documents" : null), missingDocs: out.check.missingDocs.map((m) => m.key), formSteps: visibleSteps(form, out.answers).map((s) => s.key) },
      };
    }
    ok = true;
  }, { revalidate: [...reval(id), "/admin/requests"] });
  if (!ok) return res;
  redirect(`/app/requests/${id}?created=1`);
}

/** Discards a draft (status → cancelled; nothing is deleted). */
export async function discardDraft(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "طلب غير صالح." };
  const res = await userAction(async (c) => {
    const rc = await editableDraft(c, id);
    await c.tx.update(serviceRequests).set({ status: "cancelled", cancelReason: "ألغى العميل المسودة قبل إرسالها", updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, id));
    await logEvent(c.tx, rc.req, c.auth.user.id, "أُلغيت المسودة قبل إرسالها", "draft", "cancelled");
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.draft_discard", entityType: "service_request", entityId: id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: "draft" }, after: { status: "cancelled" } });
  }, { revalidate: reval(id) });
  if (res.error) return res;
  redirect("/app/requests");
}
