import "server-only";
import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { documents, recommendations, serviceRequests, services, users, waqfs, workflowTemplates } from "@/server/db/schema";
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

export type IntakeData = { preferredContact?: string; formVersion?: number; answers?: Answers; docs?: DocMap };

export const intakeOf = (req: { intake: unknown }): IntakeData => ((req.intake ?? {}) as IntakeData);

export function serviceForm(svc: Pick<typeof services.$inferSelect, "code" | "audiences" | "requiredDocuments">): ServiceForm {
  return formFor({ code: svc.code, audiences: svc.audiences, requiredDocuments: svc.requiredDocuments });
}

/** Answers prefilled from the account and the waqf file (only where the form asks for them). */
export async function prefillAnswers(tx: Tx, form: ServiceForm, userId: string, waqfId: string | null): Promise<Answers> {
  const [u] = await tx.select({ fullName: users.fullName, phone: users.phone, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const [w] = waqfId
    ? await tx.select({ name: waqfs.name, sizeClass: waqfs.sizeClass, deedNo: waqfs.deedNo, registrationCertNo: waqfs.registrationCertNo, fiscalYearEnd: waqfs.fiscalYearEnd, nationalUnifiedNumber: waqfs.nationalUnifiedNumber }).from(waqfs).where(eq(waqfs.id, waqfId)).limit(1)
    : [];
  const src: Record<PrefillKey, string | null | undefined> = {
    "user.fullName": u?.fullName, "user.phone": u?.phone?.replace(/^\+966/, "0"), "user.email": u?.email,
    "waqf.name": w?.name, "waqf.sizeClass": w?.sizeClass, "waqf.deedNo": w?.deedNo, "waqf.registrationCertNo": w?.registrationCertNo,
    "waqf.fiscalYearEnd": w?.fiscalYearEnd, "waqf.nationalUnifiedNumber": w?.nationalUnifiedNumber,
  };
  const a: Answers = { preferredContact: "platform", priority: "normal" };
  for (const st of form.steps) for (const f of st.fields) if (f.prefill && src[f.prefill]) a[f.key] = String(src[f.prefill]);
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
  const answers = sanitizeAnswers(form, answersRaw);
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
  if (svc.code === "N01" && rc.waqf) {
    const eng = await openEngagementTx(tx, { waqfId: rc.waqf.id, requestId: rc.req.id, actorId: auth.user.id, ip: c.ip, userAgent: c.userAgent });
    for (const mid of await nazaraManagerIds(tx))
      await notify(mid, "nazara.update", { number: eng.number, status: "طلب نظارة جديد", waqf: "", note: `من الطلب ${rc.req.number}` }, { waqfId: rc.waqf.id, link: `/admin/nazara/${eng.id}`, tx });
  }
  await audit(tx, {
    actorUserId: auth.user.id, action: "requests.submit", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: c.ip, userAgent: c.userAgent,
    before: { status: "draft" }, after: { number: rc.req.number, service: svc.code, priority, formVersion: form.version, conflictCheck: conflict.result, documents: Object.values(docs).flat().length },
  });
  for (const opsId of await opsManagerIds(tx))
    await notify(opsId, "request.status", { number: rc.req.number, status: `طلب جديد بانتظار التوزيع — ${svc.nameAr}${conflict.result === "blocked" ? " (تعارض استقلال)" : ""}` }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}`, tx });
  return { ok: true as const };
}
