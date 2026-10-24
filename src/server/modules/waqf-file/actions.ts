"use server";

/** Identity & registration, classification history, timeline, and parties (founders, nazara, successions, bodies). */
import { and, eq, gte, isNull, or } from "drizzle-orm";
import type { Tx } from "../../db";
import { z } from "zod";
import {
  bodies, bodyMemberships, founders, successions, trusteeAppointments, trustees, waqfClassifications, waqfRegistrations, waqfs,
 waqfMemberships,
} from "../../db/schema";
import { deriveSizeClass, deriveType } from "../../engines/assessment";
import { audit } from "../../lib/audit";
import { emitWaqfEvent, syncWaqfObligations } from "../compliance/events";
import { UserError } from "../_shared";
import { bandForValue } from "../assets/pure";
import type { ActionState } from "@/lib/utils";
import { flag, optDate, optText, reqDate, reqText, todayIso } from "./form";
import { addTimeline, assertFound, fileAction, materialChange } from "./guard";

const meta = (c: { ip: string; userAgent: string }) => ({ ip: c.ip, userAgent: c.userAgent });

// ───────────── Identity extras ─────────────
const extrasSchema = z.object({
  registrationCertNo: optText(60),
  deedIssuer: optText(120),
  fieldOfWork: optText(120),
  geographicScope: optText(120),
  domicile: optText(120),
  creationMode: z.enum(["inter_vivos", "bequest"], { error: "اختر صيغة إنشاء الوقف." }),
  directBenefit: flag,
});

export async function updateIdentityExtras(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, extrasSchema, "waqf.edit", async (c, d) => {
    const w = c.access.waqf;
    let sizeClass = w.sizeClass;
    if (d.directBenefit !== w.directBenefit && !w.sizeClassLocked) {
      const band = w.assetsEstimatedValue ? bandForValue(Number(w.assetsEstimatedValue)) : null;
      sizeClass = d.directBenefit ? "direct_benefit" : band ? deriveSizeClass({ asset_band: band, direct_benefit: "no" }) : w.sizeClass === "direct_benefit" ? null : w.sizeClass;
    }
    const before = { registrationCertNo: w.registrationCertNo, deedIssuer: w.deedIssuer, fieldOfWork: w.fieldOfWork, geographicScope: w.geographicScope, domicile: w.domicile, creationMode: w.creationMode, directBenefit: w.directBenefit, sizeClass: w.sizeClass };
    const after = { ...d, sizeClass };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
    if (!changed.length) return { ok: true, message: "لا تغيير." };
    await c.tx.update(waqfs).set({ ...after, updatedBy: c.auth.user.id }).where(eq(waqfs.id, w.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.identity_updated", entityType: "waqf", entityId: w.id, waqfId: w.id, ...meta(c), before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])) });
    if (changed.includes("sizeClass")) await syncWaqfObligations(c.tx, w.id);
    return { ok: true, message: changed.includes("sizeClass") ? "حُفظت البيانات وتغيرت فئة الوقف، فأُعيد حساب الالتزامات." : "حُفظت البيانات التعريفية." };
  }, "identity");
}

// ───────────── Classification (with history) ─────────────
const classifySchema = z
  .object({
    beneficiaryKind: z.enum(["public", "private", "both"], { error: "اختر على من تُصرف الغلة." }),
    charitableQualifier: z.enum(["yes", "no", ""]).optional(),
    thenToCharity: z.enum(["yes", "no", ""]).optional(),
    legalType: z.enum(["public", "private", "joint"], { error: "اختر النوع المعتمد." }),
    reason: optText(1000),
    effectiveFrom: reqDate("أدخل تاريخ سريان التصنيف."),
  });

export async function classifyWaqf(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, classifySchema, "waqf.edit", async (c, d) => {
    const w = c.access.waqf;
    const computed = deriveType({
      beneficiary_kind: d.beneficiaryKind,
      charitable_qualifier: d.beneficiaryKind === "private" ? d.charitableQualifier || null : null,
      then_to_charity: d.beneficiaryKind === "private" ? d.thenToCharity || null : null,
    });
    if (computed.type && computed.type !== d.legalType && !d.reason)
      return { error: "النوع المعتمد يخالف النوع المحسوب من شرط الواقف: اذكر السبب (مثل رأي مختص أو حكم قضائي).", fieldErrors: { reason: "اذكر سبب المخالفة." } };
    const reason = [computed.reason, d.reason].filter(Boolean).join(" — ");
    const [row] = await c.tx
      .insert(waqfClassifications)
      .values({ waqfId: w.id, legalType: d.legalType, computedType: computed.type, reason, effectiveFrom: d.effectiveFrom, decidedBy: c.auth.user.id })
      .returning({ id: waqfClassifications.id });
    await c.tx.update(waqfs).set({ legalType: d.legalType, computedType: computed.type, computedTypeReason: reason, updatedBy: c.auth.user.id }).where(eq(waqfs.id, w.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.classified", entityType: "waqf_classification", entityId: row.id, waqfId: w.id, ...meta(c), before: { legalType: w.legalType, computedType: w.computedType }, after: { legalType: d.legalType, computedType: computed.type, answers: { beneficiaryKind: d.beneficiaryKind, charitableQualifier: d.charitableQualifier, thenToCharity: d.thenToCharity } } });
    await addTimeline(c.tx, w, c.auth.user.id, "classification", "تصنيف نوع الوقف", reason, d.effectiveFrom);
    if (w.legalType && w.legalType !== d.legalType) await materialChange(c.tx, w, "classification", c.auth.user.id, { from: w.legalType, to: d.legalType });
    await syncWaqfObligations(c.tx, w.id);
    return { ok: true, message: "سُجّل التصنيف في السجل التاريخي." };
  }, "identity");
}

// ───────────── Registrations with GAA ─────────────
const regSchema = z.object({
  registrationId: z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null),
  requestType: z.enum(["issue", "renew", "amend"], { error: "اختر نوع الطلب." }),
  status: z.enum(["draft", "submitted", "under_review", "issued", "rejected"], { error: "اختر الحالة." }),
  submittedOn: optDate,
  certNo: optText(60),
  issuedOn: optDate,
  expiresOn: optDate,
  notes: optText(1000),
}).superRefine((d, ctx) => {
  if (d.status === "issued" && !d.issuedOn) ctx.addIssue({ code: "custom", path: ["issuedOn"], message: "أدخل تاريخ صدور الشهادة." });
  if (d.status === "issued" && !d.certNo) ctx.addIssue({ code: "custom", path: ["certNo"], message: "أدخل رقم الشهادة." });
  if (d.expiresOn && d.issuedOn && d.expiresOn <= d.issuedOn) ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "تاريخ الانتهاء بعد تاريخ الصدور." });
  if (d.issuedOn && d.issuedOn > todayIso()) ctx.addIssue({ code: "custom", path: ["issuedOn"], message: "تاريخ الصدور لا يكون في المستقبل." });
});

export async function saveRegistration(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, regSchema, "waqf.edit", async (c, d) => {
    const w = c.access.waqf;
    const values = { requestType: d.requestType, status: d.status, submittedOn: d.submittedOn, certNo: d.certNo, issuedOn: d.issuedOn, expiresOn: d.expiresOn, notes: d.notes, updatedBy: c.auth.user.id };
    let id = d.registrationId;
    let before: unknown = null;
    if (id) {
      const [r] = await c.tx.select().from(waqfRegistrations).where(and(eq(waqfRegistrations.id, id), eq(waqfRegistrations.waqfId, w.id))).limit(1);
      before = assertFound(r);
      await c.tx.update(waqfRegistrations).set(values).where(eq(waqfRegistrations.id, id));
    } else {
      const [r] = await c.tx.insert(waqfRegistrations).values({ ...values, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: waqfRegistrations.id });
      id = r.id;
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: d.registrationId ? "waqf.registration_updated" : "waqf.registration_created", entityType: "waqf_registration", entityId: id, waqfId: w.id, ...meta(c), before, after: values });
    const prevStatus = (before as { status?: string } | null)?.status;
    if (d.status === "issued" && prevStatus !== "issued") {
      const patch: Partial<typeof waqfs.$inferInsert> = { registrationCertNo: d.certNo, updatedBy: c.auth.user.id };
      if (d.expiresOn) patch.registrationExpiresOn = d.expiresOn;
      if (d.requestType === "issue" && !w.registeredOn) {
        patch.registeredOn = d.issuedOn!;
        if (["idea", "draft", "documenting", "documented"].includes(w.status)) patch.status = "registered";
        patch.stage = Math.max(w.stage, 3);
      }
      await c.tx.update(waqfs).set(patch).where(eq(waqfs.id, w.id));
      await addTimeline(c.tx, w, c.auth.user.id, "registered", d.requestType === "issue" ? "صدور شهادة تسجيل الوقف" : d.requestType === "renew" ? "تجديد شهادة التسجيل" : "تعديل بيانات التسجيل", d.certNo ? `رقم الشهادة ${d.certNo}` : null, d.issuedOn!);
      if (patch.registeredOn) await emitWaqfEvent(c.tx, { waqfId: w.id, event: "registration", date: d.issuedOn!, refId: id, actorUserId: c.auth.user.id });
      if (d.expiresOn) await emitWaqfEvent(c.tx, { waqfId: w.id, event: "cert_expiry", date: d.expiresOn, actorUserId: c.auth.user.id });
      await syncWaqfObligations(c.tx, w.id);
      return { ok: true, message: "سُجّلت الشهادة وحُدّث ملف الوقف والتزاماته." };
    }
    if (!d.registrationId) await addTimeline(c.tx, w, c.auth.user.id, "registration_request", "طلب لدى الهيئة العامة للأوقاف", null, d.submittedOn ?? undefined);
    return { ok: true, message: "حُفظ الطلب." };
  }, "identity");
}

const timelineSchema = z.object({ occurredOn: reqDate("أدخل تاريخ الحدث."), title: reqText(200, "اكتب عنوان الحدث."), details: optText(1000) });

export async function addTimelineEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, timelineSchema, "waqf.edit", async (c, d) => {
    await addTimeline(c.tx, c.access.waqf, c.auth.user.id, "note", d.title, d.details, d.occurredOn);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.timeline_added", entityType: "waqf", entityId: c.access.waqf.id, waqfId: c.access.waqf.id, ...meta(c), after: d });
    return { ok: true, message: "أُضيف الحدث إلى السجل الزمني." };
  }, "identity");
}

// ───────────── Founders ─────────────
const founderSchema = z.object({
  founderId: z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null),
  displayName: reqText(200, "اكتب اسم الواقف."),
  nationality: optText(60),
  isAlive: flag,
  canInterpret: flag,
  canAmendNazara: flag,
  canDismissNazir: flag,
  canAddAssets: flag,
});

export async function saveFounder(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, founderSchema, "waqf.edit", async (c, d) => {
    const w = c.access.waqf;
    const values = {
      displayName: d.displayName, nationality: d.nationality, isAlive: d.isAlive,
      powers: { canInterpret: d.canInterpret, canAmendNazara: d.canAmendNazara, canDismissNazir: d.canDismissNazir, canAddAssets: d.canAddAssets },
      updatedBy: c.auth.user.id,
    };
    let id = d.founderId;
    let before: unknown = null;
    if (id) {
      const [f] = await c.tx.select().from(founders).where(and(eq(founders.id, id), eq(founders.waqfId, w.id))).limit(1);
      before = assertFound(f);
      await c.tx.update(founders).set(values).where(eq(founders.id, id));
    } else {
      const [f] = await c.tx.insert(founders).values({ ...values, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: founders.id });
      id = f.id;
    }
    // founderAlive on the waqf profile mirrors the founders list (any founder alive).
    const all = await c.tx.select({ isAlive: founders.isAlive }).from(founders).where(eq(founders.waqfId, w.id));
    await c.tx.update(waqfs).set({ founderAlive: all.some((f) => f.isAlive) }).where(eq(waqfs.id, w.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: d.founderId ? "waqf.founder_updated" : "waqf.founder_added", entityType: "founder", entityId: id, waqfId: w.id, ...meta(c), before, after: values });
    return { ok: true, message: "حُفظت بيانات الواقف." };
  }, "parties");
}

// ───────────── Nazara: trustees, appointments, successions ─────────────
const appointSchema = z.object({
  kind: z.enum(["individual", "board_member", "legal_entity", "founder", "gaa"], { error: "اختر صفة الناظر." }),
  displayName: reqText(200, "اكتب اسم الناظر أو الجهة."),
  nationality: optText(60),
  isIndependent: flag,
  isChair: flag,
  residesInKsa: flag,
  specialty: optText(120),
  licenseNo: optText(60),
  licenseExpiresOn: optDate,
  startsOn: reqDate("أدخل تاريخ بدء النظارة."),
  decisionNo: optText(60),
  decisionDate: optDate,
  authority: z.enum(["competent_authority", "gaa", "court", "notary", "internal"], { error: "اختر جهة التعيين." }),
  powers: optText(2000),
  fees: optText(500),
  responsibilities: optText(2000),
}).superRefine((d, ctx) => {
  if (d.kind === "legal_entity" && !d.licenseNo) ctx.addIssue({ code: "custom", path: ["licenseNo"], message: "الناظر الاعتباري يلزمه ترخيص من الهيئة: أدخل رقمه." });
});

export async function appointTrustee(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, appointSchema, "waqf.edit", async (c, d) => {
    const w = c.access.waqf;
    const [t] = await c.tx
      .insert(trustees)
      .values({
        waqfId: w.id, kind: d.kind, displayName: d.displayName, nationality: d.nationality, isIndependent: d.isIndependent, isChair: d.isChair,
        residesInKsa: d.residesInKsa, specialty: d.specialty, licenseNo: d.licenseNo, licenseExpiresOn: d.licenseExpiresOn, startsOn: d.startsOn,
        status: "active", createdBy: c.auth.user.id, updatedBy: c.auth.user.id,
      })
      .returning({ id: trustees.id });
    const [a] = await c.tx
      .insert(trusteeAppointments)
      .values({ trusteeId: t.id, waqfId: w.id, decisionNo: d.decisionNo, decisionDate: d.decisionDate, authority: d.authority, powers: d.powers, fees: d.fees, responsibilities: d.responsibilities, createdBy: c.auth.user.id })
      .returning({ id: trusteeAppointments.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.trustee_appointed", entityType: "trustee", entityId: t.id, waqfId: w.id, ...meta(c), after: { ...d, appointmentId: a.id } });
    await addTimeline(c.tx, w, c.auth.user.id, "nazara_changed", `تعيين ناظر: ${d.displayName}`, d.decisionNo ? `قرار رقم ${d.decisionNo}` : null, d.startsOn);
    await materialChange(c.tx, w, "nazara", c.auth.user.id, { action: "appointed", trusteeId: t.id });
    return { ok: true, message: w.registeredOn ? "سُجّل التعيين. تغيير النظارة تغيير جوهري: أُضيف التزام تحديث بيانات الوقف لدى الهيئة." : "سُجّل التعيين." };
  }, "parties");
}

const updateTrusteeSchema = z.object({
  trusteeId: z.uuid(),
  displayName: reqText(200, "اكتب اسم الناظر أو الجهة."),
  nationality: optText(60),
  isIndependent: flag,
  isChair: flag,
  residesInKsa: flag,
  specialty: optText(120),
  licenseNo: optText(60),
  licenseExpiresOn: optDate,
  startsOn: reqDate("أدخل تاريخ بدء النظارة."),
});

/** Corrects the record of an active nazir (name, licence, dates…). Ending or replacing the nazara has its own actions. */
export async function updateTrustee(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, updateTrusteeSchema, "waqf.edit", async (c, d) => {
    const w = c.access.waqf;
    const [t] = await c.tx.select().from(trustees).where(and(eq(trustees.id, d.trusteeId), eq(trustees.waqfId, w.id))).limit(1);
    assertFound(t);
    if (t!.status !== "active") throw new UserError("لا تُعدّل بيانات نظارة منتهية.");
    if (t!.kind === "legal_entity" && !d.licenseNo) return { error: "الناظر الاعتباري يلزمه ترخيص من الهيئة.", fieldErrors: { licenseNo: "أدخل رقم الترخيص." } };
    const { trusteeId, ...values } = d;
    const before = { displayName: t!.displayName, nationality: t!.nationality, isIndependent: t!.isIndependent, isChair: t!.isChair, residesInKsa: t!.residesInKsa, specialty: t!.specialty, licenseNo: t!.licenseNo, licenseExpiresOn: t!.licenseExpiresOn, startsOn: t!.startsOn };
    await c.tx.update(trustees).set({ ...values, updatedBy: c.auth.user.id }).where(eq(trustees.id, trusteeId));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.trustee_updated", entityType: "trustee", entityId: trusteeId, waqfId: w.id, ...meta(c), before, after: values });
    return { ok: true, message: "حُفظت بيانات الناظر." };
  }, "parties");
}

const endSchema = z.object({ trusteeId: z.uuid(), endsOn: reqDate("أدخل تاريخ انتهاء النظارة."), reason: reqText(500, "اذكر سبب الانتهاء (وفاة، اعتذار، عزل، انتهاء المدة…).") });

export async function endTrustee(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, endSchema, "waqf.edit", async (c, d) => {
    const w = c.access.waqf;
    const [t] = await c.tx.select().from(trustees).where(and(eq(trustees.id, d.trusteeId), eq(trustees.waqfId, w.id))).limit(1);
    assertFound(t);
    if (t!.status === "ended") throw new UserError("النظارة منتهية مسبقًا.");
    if (t!.startsOn && d.endsOn < t!.startsOn) return { error: "تاريخ الانتهاء يسبق تاريخ البدء.", fieldErrors: { endsOn: "تاريخ غير صحيح." } };
    await c.tx.update(trustees).set({ status: "ended", endsOn: d.endsOn, updatedBy: c.auth.user.id }).where(eq(trustees.id, t!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.trustee_ended", entityType: "trustee", entityId: t!.id, waqfId: w.id, ...meta(c), before: { status: t!.status }, after: { status: "ended", endsOn: d.endsOn, reason: d.reason } });
    await addTimeline(c.tx, w, c.auth.user.id, "nazara_changed", `انتهاء نظارة: ${t!.displayName}`, d.reason, d.endsOn);
    // BO standard art. 7/4: the outgoing nazir hands over original documents immediately (OB-BO-03).
    await emitWaqfEvent(c.tx, { waqfId: w.id, event: "nazara_end", date: d.endsOn, refId: t!.id, actorUserId: c.auth.user.id, meta: { trustee: t!.displayName } });
    await materialChange(c.tx, w, "nazara", c.auth.user.id, { action: "ended", trusteeId: t!.id });
    const [still] = await c.tx.select({ id: trustees.id }).from(trustees).where(and(eq(trustees.waqfId, w.id), eq(trustees.status, "active"))).limit(1);
    return { ok: true, message: still ? "سُجّل انتهاء النظارة وأُضيف التزام تسليم المستندات للناظر الجديد." : "سُجّل انتهاء النظارة. لا ناظر نشط الآن: عيّن ناظرًا أو اطلب من الجهة المختصة إقامة ناظر." };
  }, "parties");
}

const successionSchema = z.object({ ruleText: reqText(1000, "اكتب قاعدة انتقال النظارة كما في شرط الواقف."), successorName: optText(200), position: z.coerce.number().int().min(1).max(50).default(1) });

export async function addSuccession(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, successionSchema, "waqf.edit", async (c, d) => {
    const [s] = await c.tx.insert(successions).values({ waqfId: c.access.waqf.id, ...d, createdBy: c.auth.user.id }).returning({ id: successions.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.succession_added", entityType: "succession", entityId: s.id, waqfId: c.access.waqf.id, ...meta(c), after: d });
    return { ok: true, message: "أُضيفت قاعدة الخلافة." };
  }, "parties");
}

export async function removeSuccession(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ successionId: z.uuid() }), "waqf.edit", async (c, d) => {
    const [s] = await c.tx.delete(successions).where(and(eq(successions.id, d.successionId), eq(successions.waqfId, c.access.waqf.id))).returning();
    assertFound(s);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.succession_removed", entityType: "succession", entityId: d.successionId, waqfId: c.access.waqf.id, ...meta(c), before: s });
    return { ok: true, message: "حُذفت القاعدة." };
  }, "parties");
}

// ───────────── Bodies & memberships ─────────────
const bodySchema = z.object({ kind: z.enum(["board", "committee", "general_assembly"], { error: "اختر نوع الجهاز." }), name: reqText(160, "اكتب اسم الجهاز."), charter: optText(2000) });

export async function addBody(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, bodySchema, "governance.manage", async (c, d) => {
    const [b] = await c.tx.insert(bodies).values({ waqfId: c.access.waqf.id, ...d, createdBy: c.auth.user.id }).returning({ id: bodies.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.body_added", entityType: "body", entityId: b.id, waqfId: c.access.waqf.id, ...meta(c), after: d });
    return { ok: true, message: "أُضيف الجهاز." };
  }, "parties");
}

const memberFields = {
  personName: reqText(200, "اكتب اسم العضو."),
  role: z.enum(["chair", "vice_chair", "member", "secretary", "observer"], { error: "اختر الدور." }),
  capacity: optText(200),
  isIndependent: flag,
  hasVote: flag,
  isExecutive: flag,
  canSign: flag,
  startsOn: optDate,
  endsOn: optDate,
  contactEmail: z.union([z.literal(""), z.email("بريد غير صحيح.")]).optional().transform((v) => v || null),
  contactPhone: optText(20),
  appointmentRef: optText(200),
  userId: z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null),
};
const termCheck = (d: { startsOn: string | null; endsOn: string | null }, ctx: z.RefinementCtx) => {
  if (d.startsOn && d.endsOn && d.endsOn <= d.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "نهاية العضوية بعد بدايتها." });
};
const memberSchema = z.object({ bodyId: z.uuid({ error: "اختر الجهاز." }), ...memberFields }).superRefine(termCheck);
const memberEditSchema = z.object({ membershipId: z.uuid(), ...memberFields, status: z.enum(["active", "suspended"]).default("active") }).superRefine(termCheck);

/** A member's platform account must be an active member of this waqf (so invitations, votes and signatures reach them). */
async function checkMemberUser(c: { tx: Tx; access: { waqf: { id: string } } }, userId: string | null) {
  if (!userId) return;
  const [m] = await c.tx.select({ id: waqfMemberships.id }).from(waqfMemberships).where(and(eq(waqfMemberships.waqfId, c.access.waqf.id), eq(waqfMemberships.userId, userId), eq(waqfMemberships.status, "active"))).limit(1);
  if (!m) throw new UserError("الحساب المختار ليس عضوًا في الوقف. ادعُه من «الأعضاء والإعدادات» أولًا.");
}

export async function addBodyMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, memberSchema, "governance.manage", async (c, d) => {
    const w = c.access.waqf;
    const [b] = await c.tx.select().from(bodies).where(and(eq(bodies.id, d.bodyId), eq(bodies.waqfId, w.id))).limit(1);
    assertFound(b, "لم نجد هذا الجهاز في الوقف.");
    if (d.role === "observer" && d.hasVote) return { error: "المراقب لا يصوّت: ألغِ خيار حق التصويت." };
    await checkMemberUser(c, d.userId);
    if (d.role === "chair") {
      const [chair] = await c.tx.select({ id: bodyMemberships.id }).from(bodyMemberships).where(and(eq(bodyMemberships.bodyId, d.bodyId), eq(bodyMemberships.role, "chair"), eq(bodyMemberships.status, "active"), or(isNull(bodyMemberships.endsOn), gte(bodyMemberships.endsOn, todayIso())))).limit(1);
      if (chair) return { error: "للمجلس رئيس قائم: أنهِ عضويته أو غيّر دوره أولًا." };
    }
    const [m] = await c.tx.insert(bodyMemberships).values({ ...d, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: bodyMemberships.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.body_member_added", entityType: "body_membership", entityId: m.id, waqfId: w.id, ...meta(c), after: { ...d, contactEmail: d.contactEmail ? "•••" : null, contactPhone: d.contactPhone ? "•••" : null } });
    if (b!.kind === "board") {
      await addTimeline(c.tx, w, c.auth.user.id, "governance", `عضو جديد في ${b!.name}: ${d.personName}`);
      if (w.nazirMode === "board") await materialChange(c.tx, w, "nazara", c.auth.user.id, { action: "board_member_added" });
    }
    return { ok: true, message: d.userId ? "أُضيف العضو وربط بحسابه." : "أُضيف العضو. لا حساب له في المنصة: يُبلَّغ بالدعوات على بريده إن أُدخل، ويُسجَّل حضوره وصوته يدويًا." };
  }, "parties");
}

/** Edits a member: role, capacity, flags, term, contact, status, and the link to their platform account. */
export async function updateBodyMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, memberEditSchema, "governance.manage", async (c, d) => {
    const w = c.access.waqf;
    const [m] = await c.tx.select().from(bodyMemberships).where(and(eq(bodyMemberships.id, d.membershipId), eq(bodyMemberships.waqfId, w.id))).limit(1);
    assertFound(m);
    if (m!.status === "ended") throw new UserError("العضوية منتهية؛ أضف عضوية جديدة إن عاد العضو.");
    if (d.role === "observer" && d.hasVote) return { error: "المراقب لا يصوّت: ألغِ خيار حق التصويت." };
    await checkMemberUser(c, d.userId);
    if (d.role === "chair" && m!.role !== "chair") {
      const [chair] = await c.tx.select({ id: bodyMemberships.id }).from(bodyMemberships).where(and(eq(bodyMemberships.bodyId, m!.bodyId), eq(bodyMemberships.role, "chair"), eq(bodyMemberships.status, "active"), or(isNull(bodyMemberships.endsOn), gte(bodyMemberships.endsOn, todayIso())))).limit(1);
      if (chair) return { error: "للمجلس رئيس قائم: غيّر دوره أولًا." };
    }
    const { membershipId, ...v } = d;
    await c.tx.update(bodyMemberships).set({ ...v, updatedBy: c.auth.user.id }).where(eq(bodyMemberships.id, membershipId));
    const changed = (Object.keys(v) as (keyof typeof v)[]).filter((k) => String(v[k] ?? "") !== String((m as Record<string, unknown>)[k] ?? ""));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.body_member_updated", entityType: "body_membership", entityId: membershipId, waqfId: w.id, ...meta(c), after: { changed } });
    return { ok: true, message: changed.length ? "حُفظت بيانات العضو." : "لا تغيير." };
  }, "parties");
}

export async function endBodyMember(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ membershipId: z.uuid() }), "governance.manage", async (c, d) => {
    const w = c.access.waqf;
    const [m] = await c.tx.select().from(bodyMemberships).where(and(eq(bodyMemberships.id, d.membershipId), eq(bodyMemberships.waqfId, w.id))).limit(1);
    assertFound(m);
    const t = todayIso();
    if (m!.endsOn && m!.endsOn <= t) throw new UserError("العضوية منتهية مسبقًا.");
    await c.tx.update(bodyMemberships).set({ endsOn: t, status: "ended", updatedBy: c.auth.user.id }).where(eq(bodyMemberships.id, m!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.body_member_ended", entityType: "body_membership", entityId: m!.id, waqfId: w.id, ...meta(c), before: { endsOn: m!.endsOn }, after: { endsOn: t } });
    const [b] = await c.tx.select({ kind: bodies.kind }).from(bodies).where(eq(bodies.id, m!.bodyId)).limit(1);
    if (b?.kind === "board" && w.nazirMode === "board") await materialChange(c.tx, w, "nazara", c.auth.user.id, { action: "board_member_ended" });
    return { ok: true, message: "أُنهيت العضوية." };
  }, "parties");
}
