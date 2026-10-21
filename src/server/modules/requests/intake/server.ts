import "server-only";
import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { documents, nazaraEvents, recommendations, serviceRequests, services, users, waqfs, workflowTemplates } from "@/server/db/schema";
import { ensureIntakeTask } from "@/server/modules/operations/exec";
import { ensureGapTasks } from "../gap-tasks";
import { linkRequest } from "@/server/modules/operations/links";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { UserError } from "@/server/modules/_shared";
import { openEngagementTx } from "@/server/modules/nazara/engine";
import { nazaraManagerIds } from "@/server/modules/nazara/queries";
import type { RequestCtx } from "../access";
import { flagMap, readSetting, serviceAvailability, type License } from "../catalog";
import { createStages, logEvent, opsManagerIds, type ActCtx } from "../engine";
import { evaluateConflict } from "../workflow";
import { checkIntake, sanitizeAnswers, summaryText, type Answers, type DocMap, type PrefillKey, type ServiceForm } from "./engine";
import { formFor } from "./forms";
import { contextFor } from "../context/map";
import { waqfModeOf, type WaqfMode } from "../waqf-mode";

export type IntakeData = { preferredContact?: string; formVersion?: number; waqfMode?: WaqfMode; answers?: Answers; docs?: DocMap };

export const intakeOf = (req: { intake: unknown }): IntakeData => ((req.intake ?? {}) as IntakeData);

export function serviceForm(svc: Pick<typeof services.$inferSelect, "code" | "audiences" | "requiredDocuments">): ServiceForm {
  return formFor({ code: svc.code, audiences: svc.audiences, requiredDocuments: svc.requiredDocuments });
}

/** Values the waqf file and the account hold for the prefill keys (read live; also used to show where an answer came from). */
export async function prefillSources(tx: Tx, userId: string | null, waqfId: string | null): Promise<Record<PrefillKey, string | null | undefined>> {
  const [u] = userId ? await tx.select({ fullName: users.fullName, phone: users.phone, email: users.email }).from(users).where(eq(users.id, userId)).limit(1) : [];
  const [w] = waqfId
    ? await tx.select({ name: waqfs.name, sizeClass: waqfs.sizeClass, deedNo: waqfs.deedNo, registrationCertNo: waqfs.registrationCertNo, fiscalYearEnd: waqfs.fiscalYearEnd, nationalUnifiedNumber: waqfs.nationalUnifiedNumber, domicile: waqfs.domicile, hasForeignParty: waqfs.hasForeignParty, hasBeneficiariesAbroad: waqfs.hasBeneficiariesAbroad, collectsDonations: waqfs.collectsDonations }).from(waqfs).where(eq(waqfs.id, waqfId)).limit(1)
    : [];
  const yn = (b: boolean | null | undefined) => (b === null || b === undefined ? undefined : b ? "yes" : "no");
  return {
    "user.fullName": u?.fullName, "user.phone": u?.phone?.replace(/^\+966/, "0"), "user.email": u?.email,
    "waqf.name": w?.name, "waqf.sizeClass": w?.sizeClass, "waqf.deedNo": w?.deedNo, "waqf.registrationCertNo": w?.registrationCertNo,
    "waqf.fiscalYearEnd": w?.fiscalYearEnd, "waqf.nationalUnifiedNumber": w?.nationalUnifiedNumber, "waqf.domicile": w?.domicile,
    "waqf.hasForeignParty": yn(w?.hasForeignParty), "waqf.hasBeneficiariesAbroad": yn(w?.hasBeneficiariesAbroad), "waqf.collectsDonations": yn(w?.collectsDonations),
  };
}

/**
 * Answers prefilled from the account and the waqf file (only where the form asks for them), and whether the request has
 * waqf-file records to show (the «بيانات الوقف المسجلة» step appears only then).
 */
export async function prefillAnswers(tx: Tx, form: ServiceForm, userId: string, waqfId: string | null, mode: WaqfMode = waqfId ? "registered" : "none"): Promise<Answers> {
  const src = await prefillSources(tx, userId, waqfId);
  const a: Answers = { preferredContact: "platform", priority: "normal", waqfMode: mode };
  if (waqfId && contextFor(form.code).length) a.waqfContext = "yes";
  for (const st of form.steps) for (const f of st.fields) if (f.prefill && src[f.prefill]) a[f.key] = String(src[f.prefill]);
  return sanitizeAnswers(form, a);
}

/**
 * Answers the server owns are set by the server on every save and submission (never trusted from the client): which
 * waqf the request concerns (registered / unregistered / none) and whether it has waqf-file records to confirm.
 */
export function withServerAnswers(form: ServiceForm, req: { waqfId: string | null; intake: unknown }, raw: unknown): Answers {
  const a = { ...((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>) };
  a.waqfMode = waqfModeOf(req);
  if (req.waqfId && contextFor(form.code).length) a.waqfContext = "yes";
  else delete a.waqfContext;
  return sanitizeAnswers(form, a);
}

/** Keeps only attachments that still exist, are not archived and belong to this request or its waqf. */
export async function validDocMap(tx: Tx, requestId: string, waqfId: string | null, map: DocMap | undefined): Promise<DocMap> {
  const ids = [...new Set(Object.values(map ?? {}).flat())].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return {};
  const scope = waqfId ? or(eq(documents.requestId, requestId), eq(documents.waqfId, waqfId))! : eq(documents.requestId, requestId);
  const rows = await tx.select({ id: documents.id }).from(documents).where(and(inArray(documents.id, ids), isNull(documents.archivedAt), notInArray(documents.status, ["rejected"]), scope));
  const ok = new Set(rows.map((r) => r.id));
  const out: DocMap = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    const keep = v.filter((x) => ok.has(x));
    if (keep.length) out[k] = keep;
  }
  return out;
}

/**
 * Turns a complete draft into a submitted request: re-checks availability, the waqf permission and the whole form,
 * runs the independence check, opens the workflow stages, and notifies operations. Single place for submission.
 */
export async function submitDraft(c: ActCtx, rc: RequestCtx, answersRaw: unknown) {
  const { tx, auth } = c;
  const svc = rc.service;
  if (!svc.isPublished) throw new UserError("الخدمة لم تعد متاحة.");
  const avail = serviceAvailability(svc, await flagMap(tx), await readSetting<License[]>(tx, "company.licenses", []));
  if (!avail.available) throw new UserError(`الخدمة غير متاحة حاليًا: ${avail.reason}`);
  const form = serviceForm(svc);
  const answers = withServerAnswers(form, rc.req, answersRaw);
  const docs = await validDocMap(tx, rc.req.id, rc.req.waqfId, intakeOf(rc.req).docs);
  const check = checkIntake(form, answers, docs);
  if (!check.fieldsComplete || !check.docsComplete) return { ok: false as const, check, answers };

  let openCodes: string[] = [];
  if (rc.waqf) {
    const open = await tx
      .select({ code: services.code })
      .from(serviceRequests)
      .innerJoin(services, eq(services.id, serviceRequests.serviceId))
      .where(and(eq(serviceRequests.waqfId, rc.waqf.id), notInArray(serviceRequests.status, ["closed", "cancelled", "rejected", "draft"])));
    openCodes = open.map((o) => o.code);
  }
  const conflict = svc.conflictRule === "none" ? { result: "passed" as const, note: null } : evaluateConflict({ rule: svc.conflictRule, waqfakRole: rc.waqf?.waqfakRole ?? null, openServiceCodes: openCodes, hasWaqf: !!rc.waqf });
  const priority = ["low", "normal", "high", "urgent"].includes(String(answers.priority)) ? String(answers.priority) : "normal";
  const now = new Date();
  await tx.update(serviceRequests).set({
    status: "submitted", submittedAt: now, priority, details: summaryText(form, answers),
    intake: { ...intakeOf(rc.req), preferredContact: String(answers.preferredContact ?? "platform"), formVersion: form.version, answers, docs },
    intakeFormVersion: form.version, conflictCheck: conflict.result, conflictNote: conflict.note, updatedBy: auth.user.id,
  }).where(and(eq(serviceRequests.id, rc.req.id), eq(serviceRequests.status, "draft")));

  const [wf] = await tx.select().from(workflowTemplates).where(eq(workflowTemplates.code, svc.workflowTemplateCode)).limit(1);
  await createStages(tx, rc.req.id, rc.req.waqfId, wf?.stages ?? []);
  await logEvent(tx, rc.req, auth.user.id, conflict.result === "blocked" ? "أُرسل الطلب وأُحيل إلى مدير التشغيل لمراجعة الاستقلالية" : "أُرسل الطلب مكتمل البيانات والمستندات", "draft", "submitted");
  if (rc.req.source === "recommendation" && rc.req.sourceRef)
    await tx.update(recommendations).set({ status: "converted", serviceRequestId: rc.req.id }).where(eq(recommendations.id, rc.req.sourceRef));
  await ensureIntakeTask(tx, rc.req, auth.user.id);
  await ensureGapTasks(tx, rc.req, svc.code, answers, auth.user.id);
  if (svc.code === "N01" && rc.waqf) {
    // One open nazara file per waqf: the request opens it, or is linked to the file already open (never a duplicate).
    const eng = await openEngagementTx(tx, { waqfId: rc.waqf.id, requestId: rc.req.id, actorId: auth.user.id, ip: c.ip, userAgent: c.userAgent });
    await linkRequest(tx, { requestId: rc.req.id, waqfId: rc.waqf.id, entityType: "nazara_engagement", entityId: eng.id, relation: eng.created ? "origin" : "related", actorId: auth.user.id });
    if (!eng.created)
      await tx.insert(nazaraEvents).values({ engagementId: eng.id, waqfId: rc.waqf.id, action: "request_linked", note: `رُبط به الطلب ${rc.req.number} (الملف مفتوح مسبقًا لهذا الوقف)`, actorUserId: auth.user.id });
    await logEvent(tx, rc.req, auth.user.id, eng.created ? `فُتح ملف النظارة ${eng.number} لهذا الطلب` : `رُبط الطلب بملف النظارة المفتوح ${eng.number}`);
    for (const mid of await nazaraManagerIds(tx))
      await notify(mid, "nazara.update", { number: eng.number, status: eng.created ? "طلب نظارة جديد" : "طلب جديد على ملف مفتوح", waqf: "", note: `من الطلب ${rc.req.number}` }, { waqfId: rc.waqf.id, link: `/admin/nazara/${eng.id}`, tx });
  }
  await audit(tx, {
    actorUserId: auth.user.id, action: "requests.submit", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent,
    before: { status: "draft" }, after: { number: rc.req.number, service: svc.code, priority, formVersion: form.version, conflictCheck: conflict.result, documents: Object.values(docs).flat().length },
  });
  for (const opsId of await opsManagerIds(tx))
    await notify(opsId, "request.status", { number: rc.req.number, status: `طلب جديد بانتظار التوزيع — ${svc.nameAr}${conflict.result === "blocked" ? " (تعارض استقلال)" : ""}` }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}`, tx });
  return { ok: true as const };
}
