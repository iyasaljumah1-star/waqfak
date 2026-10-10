"use server";

/** Beneficiary classes, register, entitlements, distributions (maker ≠ approver) and the beneficial-owner register. */
import { and, count, eq, isNull } from "drizzle-orm";
import type { Tx } from "../../db";
import { z } from "zod";
import {
  bankAccounts, beneficialOwners, beneficiaries, beneficiaryClasses, distributionLines, distributions, entitlements, ledgerEntries, waqfs,
} from "../../db/schema";
import { audit } from "../../lib/audit";
import { encryptString, lookupHash } from "../../lib/crypto";
import { emitWaqfEvent, syncWaqfObligations } from "../compliance/events";
import { UserError } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { flag, optDate, optInt, optPct, optText, readRows, reqDate, reqMoney, reqText, todayIso } from "../waqf-file/form";
import { assertFound, fileAction, materialChange } from "../waqf-file/guard";
import { computeShares, splitAmount, tierShareIssues } from "./pure";

const meta = (c: { ip: string; userAgent: string }) => ({ ip: c.ip, userAgent: c.userAgent });
const optUuid = z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null);
const SECTION = "beneficiaries";

// ───────────── Classes (المصارف) ─────────────
const classSchema = z.object({
  classId: optUuid,
  name: reqText(200, "اكتب اسم المصرف أو وصف المستحقين."),
  kind: z.enum(["public", "private"], { error: "اختر نوع المصرف." }),
  specifiedBy: z.enum(["name", "description"]).default("description"),
  tier: z.coerce.number({ error: "أدخل رقم الطبقة." }).int().min(1, "الطبقة من 1.").max(30),
  position: z.coerce.number().int().min(0).max(999).default(0),
  relation: z.enum(["then", "and"], { error: "اختر علاقة الطبقة بما قبلها." }),
  sharePct: optPct,
  divisionRule: z.union([z.literal(""), z.enum(["equal", "male_double"])]).optional().transform((v) => v || null),
  substitutionRule: z.union([z.literal(""), z.enum(["tier_blocking", "branch_replaces"])]).optional().transform((v) => v || null),
  alternateMasraf: optText(500),
  isFinalDestination: flag,
  need: flag,
  student: flag,
  includesDaughtersChildren: flag,
  criteriaOther: optText(500),
});

export async function saveClass(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, classSchema, "beneficiaries.edit", async (c, d) => {
    const w = c.access.waqf;
    const { classId, need, student, includesDaughtersChildren, criteriaOther, ...rest } = d;
    const values = { ...rest, criteria: { need, student, includesDaughtersChildren, other: criteriaOther ?? undefined }, updatedBy: c.auth.user.id };
    const existing = await c.tx.select().from(beneficiaryClasses).where(eq(beneficiaryClasses.waqfId, w.id));
    const next = existing.filter((x) => x.id !== classId).map((x) => ({ tier: x.tier, relation: x.relation, sharePct: x.sharePct, name: x.name }));
    next.push({ tier: d.tier, relation: d.relation, sharePct: d.sharePct, name: d.name });
    const issue = tierShareIssues(next).find((i) => i.includes("يتجاوز"));
    if (issue) return { error: issue, fieldErrors: { sharePct: "النسبة تجعل مجموع الطبقة فوق 100%." } };
    let id = classId;
    let before: unknown = null;
    if (classId) {
      const cur = existing.find((x) => x.id === classId);
      before = assertFound(cur);
      await c.tx.update(beneficiaryClasses).set(values).where(eq(beneficiaryClasses.id, classId));
    } else {
      const [n] = await c.tx.insert(beneficiaryClasses).values({ ...values, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: beneficiaryClasses.id });
      id = n.id;
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: classId ? "beneficiaries.class_updated" : "beneficiaries.class_added", entityType: "beneficiary_class", entityId: id, waqfId: w.id, ...meta(c), before, after: values });
    await materialChange(c.tx, w, "beneficiaries", c.auth.user.id, { classId: id });
    return { ok: true, message: classId ? "حُفظ المصرف." : "أُضيف المصرف." };
  }, SECTION);
}

export async function deleteClass(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ classId: z.uuid() }), "beneficiaries.edit", async (c, d) => {
    const [n] = await c.tx.select({ n: count() }).from(beneficiaries).where(and(eq(beneficiaries.classId, d.classId), isNull(beneficiaries.archivedAt)));
    if (Number(n?.n ?? 0) > 0) throw new UserError("في هذا المصرف مستحقون مسجلون: انقلهم أو أنهِ استحقاقهم أولًا.");
    const [row] = await c.tx.delete(beneficiaryClasses).where(and(eq(beneficiaryClasses.id, d.classId), eq(beneficiaryClasses.waqfId, c.access.waqf.id))).returning();
    assertFound(row);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "beneficiaries.class_deleted", entityType: "beneficiary_class", entityId: d.classId, waqfId: c.access.waqf.id, ...meta(c), before: row });
    return { ok: true, message: "حُذف المصرف." };
  }, SECTION);
}

// ───────────── Beneficiaries register ─────────────
const benSchema = z.object({
  beneficiaryId: optUuid,
  displayName: reqText(200, "اكتب اسم المستفيد أو الجهة."),
  classId: optUuid,
  status: z.enum(["active", "suspended", "ended"]).default("active"),
  sharePct: z.string().optional().transform((v) => (v ? v.replace(/,/g, "") : "")).refine((v) => v === "" || (Number(v) >= 0 && Number(v) <= 100), "الحصة نسبة بين 0 و100.").transform((v) => (v === "" ? null : (Number(v) / 100).toFixed(6))),
  generation: optInt(1, 30),
  residesAbroad: flag,
  lastVerifiedOn: optDate,
});

async function syncAbroadFlag(tx: Tx, w: typeof waqfs.$inferSelect) {
  const [r] = await tx.select({ n: count() }).from(beneficiaries).where(and(eq(beneficiaries.waqfId, w.id), eq(beneficiaries.residesAbroad, true), eq(beneficiaries.status, "active"), isNull(beneficiaries.archivedAt)));
  const abroad = Number(r?.n ?? 0) > 0;
  if (abroad !== w.hasBeneficiariesAbroad) {
    await tx.update(waqfs).set({ hasBeneficiariesAbroad: abroad }).where(eq(waqfs.id, w.id));
    await syncWaqfObligations(tx, w.id);
  }
}

export async function saveBeneficiary(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, benSchema, "beneficiaries.edit", async (c, d) => {
    const w = c.access.waqf;
    if (d.classId) {
      const [cl] = await c.tx.select({ id: beneficiaryClasses.id }).from(beneficiaryClasses).where(and(eq(beneficiaryClasses.id, d.classId), eq(beneficiaryClasses.waqfId, w.id))).limit(1);
      assertFound(cl, "المصرف المختار ليس من هذا الوقف.");
    }
    const values = { displayName: d.displayName, classId: d.classId, status: d.status, entitlementShare: d.sharePct, generation: d.generation, residesAbroad: d.residesAbroad, lastVerifiedOn: d.lastVerifiedOn, updatedBy: c.auth.user.id };
    let id = d.beneficiaryId;
    let before: unknown = null;
    if (id) {
      const [cur] = await c.tx.select().from(beneficiaries).where(and(eq(beneficiaries.id, id), eq(beneficiaries.waqfId, w.id))).limit(1);
      before = assertFound(cur);
      await c.tx.update(beneficiaries).set({ ...values, archivedAt: d.status === "ended" ? new Date() : null, archiveReason: d.status === "ended" ? "انتهى الاستحقاق" : null }).where(eq(beneficiaries.id, id));
    } else {
      const [n] = await c.tx.insert(beneficiaries).values({ ...values, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: beneficiaries.id });
      id = n.id;
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: d.beneficiaryId ? "beneficiaries.updated" : "beneficiaries.added", entityType: "beneficiary", entityId: id, waqfId: w.id, ...meta(c), before, after: values });
    await syncAbroadFlag(c.tx, w);
    await materialChange(c.tx, w, "beneficiaries", c.auth.user.id, { beneficiaryId: id });
    return { ok: true, message: d.beneficiaryId ? "حُفظت بيانات المستفيد." : "أُضيف المستفيد." };
  }, SECTION);
}

/** Recomputes entitlement shares inside one class by its division rule (gender is used for the calculation only, not stored). */
export async function recomputeClassShares(_: ActionState, fd: FormData): Promise<ActionState> {
  const rows = readRows(fd, "g", ["id", "gender"]);
  return fileAction(fd, z.object({ classId: z.uuid() }), "beneficiaries.edit", async (c, d) => {
    const w = c.access.waqf;
    const [cl] = await c.tx.select().from(beneficiaryClasses).where(and(eq(beneficiaryClasses.id, d.classId), eq(beneficiaryClasses.waqfId, w.id))).limit(1);
    assertFound(cl);
    const people = await c.tx.select({ id: beneficiaries.id }).from(beneficiaries).where(and(eq(beneficiaries.classId, d.classId), eq(beneficiaries.status, "active"), isNull(beneficiaries.archivedAt)));
    const g = new Map(rows.map((r) => [r.id, r.gender as "m" | "f" | ""]));
    const r = computeShares(people.map((p) => ({ id: p.id, gender: g.get(p.id) ?? "" })), cl!.divisionRule ?? "equal");
    if (!r.ok) return { error: r.error };
    const factor = cl!.sharePct ? Number(cl!.sharePct) / 100 : 1;
    for (const [bid, s] of Object.entries(r.shares)) await c.tx.update(beneficiaries).set({ entitlementShare: (s * factor).toFixed(6), updatedBy: c.auth.user.id }).where(eq(beneficiaries.id, bid));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "beneficiaries.shares_recomputed", entityType: "beneficiary_class", entityId: d.classId, waqfId: w.id, ...meta(c), after: { rule: cl!.divisionRule ?? "equal", count: people.length, factor } });
    return { ok: true, message: `أُعيد حساب حصص ${people.length} مستحق.` };
  }, SECTION);
}

const entSchema = z.object({
  beneficiaryId: z.uuid({ error: "اختر المستفيد." }),
  period: z.string().trim().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "اكتب الفترة بصيغة 2026 أو 2026-06."),
  amount: reqMoney("أدخل مبلغ الاستحقاق."),
  basis: optText(500),
  expectedPayOn: optDate,
});

export async function addEntitlement(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, entSchema, "beneficiaries.edit", async (c, d) => {
    const [b] = await c.tx.select({ id: beneficiaries.id }).from(beneficiaries).where(and(eq(beneficiaries.id, d.beneficiaryId), eq(beneficiaries.waqfId, c.access.waqf.id))).limit(1);
    assertFound(b);
    const [e] = await c.tx.insert(entitlements).values({ ...d, waqfId: c.access.waqf.id, createdBy: c.auth.user.id }).returning({ id: entitlements.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "beneficiaries.entitlement_added", entityType: "entitlement", entityId: e.id, waqfId: c.access.waqf.id, ...meta(c), after: d });
    return { ok: true, message: "سُجّل الاستحقاق." };
  }, SECTION);
}

// ───────────── Distributions ─────────────
const distSchema = z.object({
  period: z.string().trim().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "اكتب الفترة بصيغة 2026 أو 2026-06."),
  totalAmount: reqMoney("أدخل إجمالي المبلغ المراد صرفه."),
  dueBy: optDate,
  bankAccountId: optUuid,
  classId: optUuid,
  basis: z.enum(["shares", "equal"]).default("shares"),
});

export async function createDistribution(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, distSchema, "finance.edit", async (c, d) => {
    const w = c.access.waqf;
    if (d.bankAccountId) {
      const [ba] = await c.tx.select().from(bankAccounts).where(and(eq(bankAccounts.id, d.bankAccountId), eq(bankAccounts.waqfId, w.id))).limit(1);
      assertFound(ba, "الحساب البنكي ليس من حسابات هذا الوقف.");
      if (!ba!.inWaqfName) throw new UserError("يكون الصرف من حساب باسم الوقف. اختر حسابًا باسمه.");
    }
    const people = await c.tx
      .select({ id: beneficiaries.id, share: beneficiaries.entitlementShare })
      .from(beneficiaries)
      .where(and(eq(beneficiaries.waqfId, w.id), eq(beneficiaries.status, "active"), isNull(beneficiaries.archivedAt), d.classId ? eq(beneficiaries.classId, d.classId) : undefined));
    if (!people.length) return { error: "لا مستحقين نشطين لتوزيع المبلغ عليهم. أضف المستفيدين أولًا." };
    const weights = people.map((p) => ({ id: p.id, weight: d.basis === "equal" ? 1 : Number(p.share ?? 0) }));
    if (d.basis === "shares" && weights.every((x) => x.weight <= 0)) return { error: "لم تُحدد حصص المستفيدين. حدّدها أو اختر التوزيع بالتساوي." };
    const lines = splitAmount(Number(d.totalAmount), weights);
    const [{ n }] = await c.tx.select({ n: count() }).from(distributions).where(eq(distributions.waqfId, w.id));
    const ref = `${w.internalNumber}-D${String(Number(n) + 1).padStart(3, "0")}`;
    const [dist] = await c.tx
      .insert(distributions)
      .values({ waqfId: w.id, period: d.period, totalAmount: d.totalAmount, dueBy: d.dueBy, bankAccountId: d.bankAccountId, status: "planned", createdBy: c.auth.user.id })
      .returning({ id: distributions.id });
    await c.tx.insert(distributionLines).values(lines.map((l, i) => ({ distributionId: dist.id, waqfId: w.id, beneficiaryId: l.id, amount: l.amount.toFixed(2), referenceNo: `${ref}-${String(i + 1).padStart(3, "0")}`, createdBy: c.auth.user.id })));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "distribution.created", entityType: "distribution", entityId: dist.id, waqfId: w.id, ...meta(c), after: { ...d, ref, lines: lines.length } });
    return { ok: true, message: `أُعدّ كشف الصرف ${ref} بـ${lines.length} سطرًا. يعتمده عضو آخر يملك صلاحية الاعتماد.` };
  }, SECTION);
}

export async function approveDistribution(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ distributionId: z.uuid() }), "distributions.approve", async (c, d) => {
    const w = c.access.waqf;
    const [dist] = await c.tx.select().from(distributions).where(and(eq(distributions.id, d.distributionId), eq(distributions.waqfId, w.id))).limit(1);
    assertFound(dist);
    if (dist!.status !== "planned") throw new UserError("الكشف ليس بانتظار الاعتماد.");
    if (dist!.createdBy === c.auth.user.id) throw new UserError("يعتمد الكشفَ عضوٌ آخر غير من أعدّه، يملك صلاحية اعتماد الصرف (فصل المهام).");
    await c.tx.update(distributions).set({ status: "approved", updatedBy: c.auth.user.id }).where(eq(distributions.id, dist!.id));
    // Each line becomes the beneficiary's entitlement for the period (what /app/b shows to the beneficiary).
    const lines = await c.tx.select().from(distributionLines).where(eq(distributionLines.distributionId, dist!.id));
    if (lines.length)
      await c.tx.insert(entitlements).values(lines.map((l) => ({ waqfId: w.id, beneficiaryId: l.beneficiaryId, period: dist!.period, amount: l.amount, basis: `كشف صرف معتمد — المرجع ${l.referenceNo}`, expectedPayOn: dist!.dueBy, createdBy: c.auth.user.id })));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "distribution.approved", entityType: "distribution", entityId: dist!.id, waqfId: w.id, ...meta(c), before: { status: "planned", maker: dist!.createdBy }, after: { status: "approved" } });
    return { ok: true, message: "اعتُمد كشف الصرف." };
  }, SECTION);
}

export async function markDistributionPaid(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ distributionId: z.uuid(), paidOn: reqDate("أدخل تاريخ الصرف.") }), "finance.edit", async (c, d) => {
    const w = c.access.waqf;
    if (d.paidOn > todayIso()) return { error: "تاريخ الصرف لا يكون في المستقبل.", fieldErrors: { paidOn: "تاريخ غير صحيح." } };
    const [dist] = await c.tx.select().from(distributions).where(and(eq(distributions.id, d.distributionId), eq(distributions.waqfId, w.id))).limit(1);
    assertFound(dist);
    if (dist!.status !== "approved") throw new UserError(dist!.status === "planned" ? "اعتمد الكشف قبل تسجيل الصرف." : "سُجّل صرف هذا الكشف مسبقًا.");
    await c.tx.update(distributions).set({ status: "paid", paidOn: d.paidOn, updatedBy: c.auth.user.id }).where(eq(distributions.id, dist!.id));
    await c.tx.update(distributionLines).set({ status: "paid", paidOn: d.paidOn, updatedBy: c.auth.user.id }).where(eq(distributionLines.distributionId, dist!.id));
    const ref = `DIST-${dist!.id.slice(0, 8)}`;
    await c.tx.insert(ledgerEntries).values([
      { waqfId: w.id, entryDate: d.paidOn, accountCode: "5400", description: `صرف غلة الفترة ${dist!.period}`, debit: dist!.totalAmount, credit: "0", referenceNo: ref, createdBy: c.auth.user.id },
      { waqfId: w.id, entryDate: d.paidOn, accountCode: "1100", description: `صرف غلة الفترة ${dist!.period}`, debit: "0", credit: dist!.totalAmount, referenceNo: ref, createdBy: c.auth.user.id },
    ]);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "distribution.paid", entityType: "distribution", entityId: dist!.id, waqfId: w.id, ...meta(c), before: { status: "approved" }, after: { status: "paid", paidOn: d.paidOn, journal: ref } });
    return { ok: true, message: "سُجّل الصرف وقُيّد في الدفاتر." };
  }, SECTION);
}

// ───────────── Beneficial owners (معايير المستفيد الحقيقي م5) ─────────────
const boSchema = z.object({
  boId: optUuid,
  subjectType: z.enum(["person", "organization"]).default("person"),
  role: z.enum(["controlling_founder", "nazir", "controller", "beneficiary", "service_provider", "director"], { error: "اختر صفة المستفيد الحقيقي." }),
  fullName: reqText(200, "اكتب الاسم كاملًا."),
  nationality: optText(60),
  birthDate: optDate,
  birthPlace: optText(120),
  address: optText(300),
  contact: optText(120),
  idType: z.union([z.literal(""), z.enum(["national_id", "iqama", "passport", "gcc_id", "cr", "other"])]).optional().transform((v) => v || null),
  idNumber: z.string().trim().max(40).optional().transform((v) => (v ? v.replace(/\s/g, "") : null)),
  acquiredOn: optDate,
  bankDetails: optText(120),
  relationToWaqf: optText(300),
  entitlementDesc: optText(300),
  legalForm: optText(120),
  nationalAddress: optText(300),
  directorsText: optText(3000),
  powers: optText(1000),
  residesInKsa: flag,
  verificationSource: z.union([z.literal(""), z.enum(["deed", "registration_certificate", "other"])]).optional().transform((v) => v || null),
  riskLevel: z.enum(["low", "standard", "high"]).default("standard"),
}).superRefine((d, ctx) => {
  if (d.idNumber && !d.idType) ctx.addIssue({ code: "custom", path: ["idType"], message: "اختر نوع مستند الهوية." });
  if (d.idType === "national_id" && d.idNumber && !/^1\d{9}$/.test(d.idNumber)) ctx.addIssue({ code: "custom", path: ["idNumber"], message: "رقم الهوية الوطنية 10 أرقام يبدأ بـ 1." });
  if (d.idType === "iqama" && d.idNumber && !/^2\d{9}$/.test(d.idNumber)) ctx.addIssue({ code: "custom", path: ["idNumber"], message: "رقم الإقامة 10 أرقام يبدأ بـ 2." });
  if (d.birthDate && d.birthDate > todayIso()) ctx.addIssue({ code: "custom", path: ["birthDate"], message: "تاريخ الميلاد لا يكون في المستقبل." });
});

function parseDirectors(text: string | null) {
  if (!text) return null;
  return text
    .split("\n")
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((p) => p[0])
    .map(([name, birthDate, birthPlace, nationality]) => ({ name, birthDate: birthDate || undefined, birthPlace: birthPlace || undefined, nationality: nationality || undefined }));
}

export async function saveBeneficialOwner(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, boSchema, "bo.edit", async (c, d) => {
    const w = c.access.waqf;
    const plain = {
      subjectType: d.subjectType, role: d.role, fullName: d.fullName, nationality: d.nationality, birthDate: d.birthDate, birthPlace: d.birthPlace, contact: d.contact,
      idType: d.idType, acquiredOn: d.acquiredOn, relationToWaqf: d.relationToWaqf, entitlementDesc: d.entitlementDesc, legalForm: d.legalForm,
      nationalAddress: d.nationalAddress, directors: parseDirectors(d.directorsText), powers: d.powers, residesInKsa: d.residesInKsa,
      verificationSource: d.verificationSource, riskLevel: d.riskLevel, updatedBy: c.auth.user.id,
    };
    // Sensitive fields are encrypted at rest; a blank field on edit keeps the stored value.
    const enc: Partial<typeof beneficialOwners.$inferInsert> = {};
    if (d.address) enc.addressEnc = encryptString(d.address);
    if (d.idNumber) {
      enc.idNumberEnc = encryptString(d.idNumber);
      enc.idNumberHash = lookupHash(d.idNumber);
    }
    if (d.bankDetails) enc.bankDetailsEnc = encryptString(d.bankDetails.replace(/\s/g, ""));
    let id = d.boId;
    let before: Record<string, unknown> | null = null;
    if (id) {
      const [cur] = await c.tx.select().from(beneficialOwners).where(and(eq(beneficialOwners.id, id), eq(beneficialOwners.waqfId, w.id), isNull(beneficialOwners.archivedAt))).limit(1);
      assertFound(cur);
      before = { role: cur!.role, fullName: cur!.fullName, nationality: cur!.nationality, idType: cur!.idType, contact: cur!.contact };
      await c.tx.update(beneficialOwners).set({ ...plain, ...enc }).where(eq(beneficialOwners.id, id));
    } else {
      if (d.idNumber) {
        const [dup] = await c.tx.select({ id: beneficialOwners.id }).from(beneficialOwners).where(and(eq(beneficialOwners.waqfId, w.id), eq(beneficialOwners.idNumberHash, lookupHash(d.idNumber)), eq(beneficialOwners.role, d.role), isNull(beneficialOwners.archivedAt))).limit(1);
        if (dup) throw new UserError("هذا الشخص مسجل بالصفة نفسها في السجل. عدّل سجله بدل إضافته مرة أخرى.");
      }
      const [n] = await c.tx.insert(beneficialOwners).values({ ...plain, ...enc, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: beneficialOwners.id });
      id = n.id;
    }
    await audit(c.tx, {
      actorUserId: c.auth.user.id, action: d.boId ? "bo.updated" : "bo.added", entityType: "beneficial_owner", entityId: id, waqfId: w.id, ...meta(c),
      before, after: { ...plain, sensitiveFieldsChanged: Object.keys(enc).filter((k) => !k.endsWith("Hash")) },
    });
    // معايير المستفيد الحقيقي م6/1: update the register within 15 days of any change (OB-BO-01).
    await emitWaqfEvent(c.tx, { waqfId: w.id, event: "bo_change", date: todayIso(), actorUserId: c.auth.user.id, meta: { boId: id } });
    return { ok: true, message: "حُفظ السجل. أُضيف التزام تحديث بيانات المستفيد الحقيقي لدى الهيئة خلال 15 يومًا." };
  }, SECTION);
}

export async function verifyBeneficialOwner(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ boId: z.uuid(), verificationSource: z.enum(["deed", "registration_certificate", "other"], { error: "اختر مصدر التحقق." }) }), "bo.edit", async (c, d) => {
    const w = c.access.waqf;
    const [cur] = await c.tx.select().from(beneficialOwners).where(and(eq(beneficialOwners.id, d.boId), eq(beneficialOwners.waqfId, w.id))).limit(1);
    assertFound(cur);
    const t = todayIso();
    const next = `${Number(t.slice(0, 4)) + 1}${t.slice(4)}`;
    await c.tx.update(beneficialOwners).set({ verifiedOn: t, verificationSource: d.verificationSource, nextVerificationDue: next, updatedBy: c.auth.user.id }).where(eq(beneficialOwners.id, d.boId));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "bo.verified", entityType: "beneficial_owner", entityId: d.boId, waqfId: w.id, ...meta(c), before: { verifiedOn: cur!.verifiedOn }, after: { verifiedOn: t, source: d.verificationSource, nextVerificationDue: next } });
    return { ok: true, message: "سُجّل التحقق. التحقق التالي بعد سنة." };
  }, SECTION);
}

export async function archiveBeneficialOwner(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ boId: z.uuid(), reason: reqText(300, "اذكر سبب زوال الصفة.") }), "bo.edit", async (c, d) => {
    const w = c.access.waqf;
    const [cur] = await c.tx.select().from(beneficialOwners).where(and(eq(beneficialOwners.id, d.boId), eq(beneficialOwners.waqfId, w.id), isNull(beneficialOwners.archivedAt))).limit(1);
    assertFound(cur);
    // Records are archived, never deleted (retention 10 years — معايير المستفيد الحقيقي م7/3).
    await c.tx.update(beneficialOwners).set({ archivedAt: new Date(), archiveReason: d.reason, updatedBy: c.auth.user.id }).where(eq(beneficialOwners.id, d.boId));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "bo.archived", entityType: "beneficial_owner", entityId: d.boId, waqfId: w.id, ...meta(c), after: { reason: d.reason } });
    await emitWaqfEvent(c.tx, { waqfId: w.id, event: "bo_change", date: todayIso(), actorUserId: c.auth.user.id, meta: { boId: d.boId, archived: true } });
    return { ok: true, message: "أُرشف السجل (يُحتفظ به عشر سنوات)." };
  }, SECTION);
}

