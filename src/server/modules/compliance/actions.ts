"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { documentLinks, documents, obligationEvents, obligationInstances, obligations, penaltySchedule, reports, violations } from "../../db/schema";
import { audit, nextNumber } from "../../lib/audit";
import { randomToken } from "../../lib/crypto";
import { todayISO } from "../../engines/dates";
import { UserError, parseForm, waqfAction } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { emitWaqfEvent } from "./events";
import { MANUAL_OBLIGATION } from "./manual";
import { NA_MARK, OPEN_STATUSES, nextStatus, MANUAL_CODE } from "./pure";
import { buildAnnualSnapshot, buildBoSnapshot, buildCsvSnapshot, type ReportPackage } from "./reports";
import "./engine"; // registers the engine handler for emitWaqfEvent

const uuid = z.string().uuid("معرّف غير صالح.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "أدخل تاريخًا صحيحًا.");
const paths = (waqfId: string) => [`/app/w/${waqfId}/compliance`, `/app/w/${waqfId}/compliance/violations`, "/app/calendar"];

async function loadInstance(tx: Parameters<Parameters<typeof waqfAction>[2]>[0]["tx"], waqfId: string, instanceId: string) {
  const [row] = await tx.select().from(obligationInstances).where(and(eq(obligationInstances.id, instanceId), eq(obligationInstances.waqfId, waqfId))).limit(1);
  if (!row) throw new UserError("لم يُعثر على الالتزام في هذا الوقف. حدّث الصفحة وأعد المحاولة.");
  return row;
}

// ───────────── Instances ─────────────

const completeSchema = z.object({
  waqfId: uuid,
  instanceId: uuid,
  documentId: z.string().uuid("اختر وثيقة الدليل أو ارفعها أولًا."),
  note: z.string().trim().max(500, "الملاحظة أطول من 500 حرف.").optional().default(""),
});

/** Marks an instance done with a linked evidence document. */
export async function completeInstance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(completeSchema, fd);
  if ("state" in r) return r.state;
  const { waqfId, instanceId, documentId, note } = r.data;
  return waqfAction(
    waqfId,
    "compliance.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const inst = await loadInstance(tx, waqfId, instanceId);
      if (inst.status === "done") throw new UserError("هذا الالتزام منجز مسبقًا.");
      const [doc] = await tx.select({ id: documents.id, title: documents.title, status: documents.status }).from(documents).where(and(eq(documents.id, documentId), eq(documents.waqfId, waqfId))).limit(1);
      if (!doc) throw new UserError("الوثيقة المختارة غير موجودة في ملف هذا الوقف.");
      if (doc.status !== "active") throw new UserError("الوثيقة لم تجتز الفحص بعد. انتظر اكتمال الفحص أو اختر وثيقة أخرى.");
      await tx.insert(documentLinks).values({ documentId, entityType: "obligation_instance", entityId: instanceId, waqfId }).onConflictDoNothing();
      await tx
        .update(obligationInstances)
        .set({ status: "done", completedAt: new Date(), completedBy: auth.user.id, evidenceDocumentId: documentId, waivedReason: null, updatedBy: auth.user.id })
        .where(eq(obligationInstances.id, instanceId));
      await tx.insert(obligationEvents).values({ instanceId, waqfId, action: "evidence", note: doc.title, actorUserId: auth.user.id });
      await tx.insert(obligationEvents).values({ instanceId, waqfId, action: "completed", note: note || null, actorUserId: auth.user.id });
      await audit(tx, { actorUserId: auth.user.id, action: "compliance.complete", entityType: "obligation_instance", entityId: instanceId, waqfId, ip, userAgent, before: { status: inst.status }, after: { status: "done", evidenceDocumentId: documentId, note } });
      return { ok: true, message: "سُجّل الالتزام منجزًا مع الدليل." };
    },
    paths(waqfId),
  );
}

const waiveSchema = z.object({ waqfId: uuid, instanceId: uuid, reason: z.string().trim().min(10, "اكتب سبب الإعفاء (10 أحرف على الأقل).").max(500, "السبب أطول من 500 حرف.") });

export async function waiveInstance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(waiveSchema, fd);
  if ("state" in r) return r.state;
  const { waqfId, instanceId, reason } = r.data;
  return waqfAction(
    waqfId,
    "compliance.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const inst = await loadInstance(tx, waqfId, instanceId);
      if (!(OPEN_STATUSES as readonly string[]).includes(inst.status)) throw new UserError("يمكن الإعفاء من الالتزامات المفتوحة فقط.");
      await tx.update(obligationInstances).set({ status: "waived", waivedReason: reason, updatedBy: auth.user.id }).where(eq(obligationInstances.id, instanceId));
      await tx.insert(obligationEvents).values({ instanceId, waqfId, action: "waived", note: reason, actorUserId: auth.user.id });
      await audit(tx, { actorUserId: auth.user.id, action: "compliance.waive", entityType: "obligation_instance", entityId: instanceId, waqfId, ip, userAgent, before: { status: inst.status }, after: { status: "waived", reason } });
      return { ok: true, message: "سُجّل الإعفاء مع سببه في سجل العمليات." };
    },
    paths(waqfId),
  );
}

const reopenSchema = z.object({ waqfId: uuid, instanceId: uuid, reason: z.string().trim().max(500).optional().default("") });

export async function reopenInstance(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reopenSchema, fd);
  if ("state" in r) return r.state;
  const { waqfId, instanceId, reason } = r.data;
  return waqfAction(
    waqfId,
    "compliance.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const inst = await loadInstance(tx, waqfId, instanceId);
      if ((OPEN_STATUSES as readonly string[]).includes(inst.status)) throw new UserError("الالتزام مفتوح أصلًا.");
      if (inst.status === "waived" && inst.waivedReason?.startsWith(NA_MARK)) throw new UserError("هذا الالتزام لا ينطبق على الوقف حاليًا؛ يعود تلقائيًا إذا تغيّرت بيانات الوقف.");
      const status = nextStatus(inst.dueOn, todayISO());
      await tx
        .update(obligationInstances)
        .set({ status, completedAt: null, completedBy: null, evidenceDocumentId: null, waivedReason: null, updatedBy: auth.user.id })
        .where(eq(obligationInstances.id, instanceId));
      await tx.insert(obligationEvents).values({ instanceId, waqfId, action: "reopened", note: reason || null, actorUserId: auth.user.id });
      await audit(tx, { actorUserId: auth.user.id, action: "compliance.reopen", entityType: "obligation_instance", entityId: instanceId, waqfId, ip, userAgent, before: { status: inst.status, evidenceDocumentId: inst.evidenceDocumentId, waivedReason: inst.waivedReason }, after: { status } });
      return { ok: true, message: "أُعيد فتح الالتزام." };
    },
    paths(waqfId),
  );
}

const manualSchema = z.object({
  waqfId: uuid,
  title: z.string().trim().min(5, "اكتب عنوانًا واضحًا (5 أحرف على الأقل).").max(160, "العنوان أطول من 160 حرفًا."),
  dueOn: isoDate,
  details: z.string().trim().max(1000, "الوصف أطول من 1000 حرف.").optional().default(""),
  reference: z.string().trim().max(200, "المرجع أطول من 200 حرف.").optional().default(""),
});

/** Adds a one-off obligation entered by the waqf manager (e.g. a deadline from a GAA letter). */
export async function addManualObligation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(manualSchema, fd);
  if ("state" in r) return r.state;
  const { waqfId, title, dueOn, details, reference } = r.data;
  return waqfAction(
    waqfId,
    "compliance.manage",
    async ({ auth, tx, ip, userAgent }) => {
      let [def] = await tx.select({ id: obligations.id }).from(obligations).where(eq(obligations.code, MANUAL_CODE)).limit(1);
      if (!def) [def] = await tx.insert(obligations).values(MANUAL_OBLIGATION).onConflictDoNothing().returning({ id: obligations.id });
      if (!def) [def] = await tx.select({ id: obligations.id }).from(obligations).where(eq(obligations.code, MANUAL_CODE)).limit(1);
      const [inst] = await tx
        .insert(obligationInstances)
        .values({ waqfId, obligationId: def.id, periodKey: `manual:${randomToken(8)}`, triggerDate: todayISO(), dueOn, status: nextStatus(dueOn, todayISO()), createdBy: auth.user.id })
        .returning();
      await tx.insert(obligationEvents).values({ instanceId: inst.id, waqfId, action: "created", note: JSON.stringify({ title, details: details || undefined, reference: reference || undefined }), actorUserId: auth.user.id });
      await audit(tx, { actorUserId: auth.user.id, action: "compliance.add_manual", entityType: "obligation_instance", entityId: inst.id, waqfId, ip, userAgent, after: { title, dueOn, reference } });
      return { ok: true, message: "أُضيف الالتزام إلى قائمة الوقف وتقويمه." };
    },
    paths(waqfId),
  );
}

// ───────────── Violations register ─────────────

const violationSchema = z.object({
  waqfId: uuid,
  penaltyCode: z.string().regex(/^\d-\d{1,2}$/, "اختر بند المخالفة من الجدول."),
  noticedOn: isoDate,
  authorityRef: z.string().trim().min(2, "أدخل رقم قرار الهيئة كما ورد في الإشعار.").max(80),
  sanction: z.string().trim().max(300, "النص أطول من 300 حرف.").optional().default(""),
  correctiveDeadline: z.union([isoDate, z.literal("")]).optional().default(""),
  documentId: z.union([uuid, z.literal("")]).optional().default(""),
});

/** Records a GAA violation notice and starts the objection-deadline obligation (event violation_decision). */
export async function recordViolation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(violationSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.noticedOn > todayISO()) return { error: "تاريخ الإشعار في المستقبل. أدخل التاريخ الوارد في إشعار الهيئة.", fieldErrors: { noticedOn: "تاريخ في المستقبل." } };
  return waqfAction(
    d.waqfId,
    "compliance.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const [p] = await tx.select().from(penaltySchedule).where(eq(penaltySchedule.code, d.penaltyCode)).limit(1);
      if (!p) throw new UserError("بند المخالفة غير موجود في الجدول.");
      if (d.documentId) {
        const [doc] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, d.documentId), eq(documents.waqfId, d.waqfId))).limit(1);
        if (!doc) throw new UserError("الوثيقة المختارة غير موجودة في ملف هذا الوقف.");
      }
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(violations).where(and(eq(violations.waqfId, d.waqfId), eq(violations.penaltyCode, d.penaltyCode)));
      const [v] = await tx
        .insert(violations)
        .values({
          waqfId: d.waqfId, penaltyCode: d.penaltyCode, occurrence: (n ?? 0) + 1, noticedOn: d.noticedOn, authorityRef: d.authorityRef, sanction: d.sanction || null,
          correctiveDeadline: d.correctiveDeadline || null, documentId: d.documentId || null, status: "open", createdBy: auth.user.id,
        })
        .returning();
      if (d.documentId) await tx.insert(documentLinks).values({ documentId: d.documentId, entityType: "violation", entityId: v.id, waqfId: d.waqfId }).onConflictDoNothing();
      await emitWaqfEvent(tx, { waqfId: d.waqfId, event: "violation_decision", date: d.noticedOn, refId: v.id, actorUserId: auth.user.id, meta: { penaltyCode: d.penaltyCode } });
      await audit(tx, { actorUserId: auth.user.id, action: "compliance.violation_record", entityType: "violation", entityId: v.id, waqfId: d.waqfId, ip, userAgent, after: { penaltyCode: d.penaltyCode, occurrence: v.occurrence, noticedOn: d.noticedOn, authorityRef: d.authorityRef, sanction: d.sanction } });
      return { ok: true, message: `سُجّلت المخالفة (التكرار ${v.occurrence}) وأُضيف موعد التظلم إلى الالتزامات.` };
    },
    paths(d.waqfId),
  );
}

const vStatusSchema = z.object({ waqfId: uuid, violationId: uuid, status: z.enum(["open", "corrective_plan", "appealed", "closed"], "اختر حالة صحيحة.") });

export async function updateViolationStatus(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(vStatusSchema, fd);
  if ("state" in r) return r.state;
  const { waqfId, violationId, status } = r.data;
  return waqfAction(
    waqfId,
    "compliance.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const [v] = await tx.select().from(violations).where(and(eq(violations.id, violationId), eq(violations.waqfId, waqfId))).limit(1);
      if (!v) throw new UserError("المخالفة غير موجودة في هذا الوقف.");
      if (v.status === status) return { ok: true, message: "لا تغيير." };
      await tx.update(violations).set({ status, updatedBy: auth.user.id }).where(eq(violations.id, violationId));
      await audit(tx, { actorUserId: auth.user.id, action: "compliance.violation_status", entityType: "violation", entityId: violationId, waqfId, ip, userAgent, before: { status: v.status }, after: { status } });
      return { ok: true, message: "حُدّثت حالة المخالفة." };
    },
    paths(waqfId),
  );
}

// ───────────── GAA export packages ─────────────

const reportSchema = z.object({
  waqfId: uuid,
  pkg: z.enum(["annual", "bo", "obligations_csv"], "اختر نوع الحزمة."),
  fy: z.union([z.string().regex(/^\d{4}$/), z.literal("")]).optional().default(""),
});

const REPORT_KIND: Record<ReportPackage, string> = { annual: "annual", bo: "gaa_package", obligations_csv: "compliance" };

/** Generates (or regenerates) an export package and stores it as a reports row with an immutable snapshot. */
export async function generateReport(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reportSchema, fd);
  if ("state" in r) return r.state;
  const { waqfId, pkg, fy } = r.data;
  return waqfAction(
    waqfId,
    "reports.generate",
    async ({ auth, access, tx, ip, userAgent }) => {
      const snapshot =
        pkg === "annual" ? await buildAnnualSnapshot(tx, waqfId, access.perms, fy ? Number(fy) : null) : pkg === "bo" ? await buildBoSnapshot(tx, waqfId) : await buildCsvSnapshot(tx, waqfId);
      const number = await nextNumber(tx, "RPT");
      const [row] = await tx
        .insert(reports)
        .values({ number, waqfId, kind: REPORT_KIND[pkg], title: snapshot.title, verificationCode: randomToken(12), snapshot, generatedBy: auth.user.id })
        .returning({ id: reports.id });
      await audit(tx, { actorUserId: auth.user.id, action: "reports.generate", entityType: "report", entityId: row.id, waqfId, ip, userAgent, after: { number, package: pkg, title: snapshot.title } });
      return { ok: true, message: `جُهّزت الحزمة ${number}.`, data: { reportId: row.id, href: `/app/w/${waqfId}/reports/${row.id}/download` } };
    },
    `/app/w/${waqfId}/reports`,
  );
}

const revokeSchema = z.object({ waqfId: uuid, reportId: uuid });

export async function revokeReport(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(revokeSchema, fd);
  if ("state" in r) return r.state;
  const { waqfId, reportId } = r.data;
  return waqfAction(
    waqfId,
    "reports.generate",
    async ({ auth, tx, ip, userAgent }) => {
      const res = await tx.update(reports).set({ revokedAt: new Date() }).where(and(eq(reports.id, reportId), eq(reports.waqfId, waqfId), inArray(reports.kind, Object.values(REPORT_KIND)))).returning({ id: reports.id });
      if (!res.length) throw new UserError("الحزمة غير موجودة.");
      await audit(tx, { actorUserId: auth.user.id, action: "reports.revoke", entityType: "report", entityId: reportId, waqfId, ip, userAgent });
      return { ok: true, message: "أُلغيت الحزمة ولن تكون متاحة للتنزيل." };
    },
    `/app/w/${waqfId}/reports`,
  );
}
