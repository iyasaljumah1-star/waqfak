"use server";

/** Assets, properties, leases, valuations, maintenance, investments, portfolios, policies and encumbrances. */
import { and, eq, isNull, max } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Tx } from "../../db";
import {
  approvals, assets, encumbrances, investmentPolicies, investments, leases, maintenancePlans, portfolios, properties, valuations, waqfs,
} from "../../db/schema";
import { audit } from "../../lib/audit";
import { emitWaqfEvent, syncWaqfObligations } from "../compliance/events";
import { UserError } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { flag, optDate, optInt, optMoney, optPct, optText, readRows, reqDate, reqMoney, reqText, todayIso } from "../waqf-file/form";
import { addTimeline, assertFound, fileAction, materialChange } from "../waqf-file/guard";
import { assetValue, suggestSizeClass } from "./pure";
import { ASSET_TYPES, checkAsset } from "./types";

const FINANCIAL: string[] = ["cash", "shares", "fund_units", "portfolio", "sukuk"];

const meta = (c: { ip: string; userAgent: string }) => ({ ip: c.ip, userAgent: c.userAgent });
const optUuid = z.union([z.literal(""), z.uuid()]).optional().transform((v) => v || null);
const sections = (waqfId: string, assetId?: string | null) => [`/app/w/${waqfId}/assets`, ...(assetId ? [`/app/w/${waqfId}/assets/${assetId}`] : []), `/app/w/${waqfId}/identity`, `/app/w/${waqfId}`];
const CATEGORIES = ["real_estate", "movable", "usufruct", "intellectual_property", "cash", "shares", "fund_units", "portfolio", "sukuk"] as const;

/** Keeps waqfs.assetsEstimatedValue equal to the sum of active assets (feeds the size-class suggestion). */
async function refreshTotals(tx: Tx, waqfId: string) {
  const rows = await tx.select({ marketValue: assets.marketValue, bookValue: assets.bookValue }).from(assets).where(and(eq(assets.waqfId, waqfId), isNull(assets.archivedAt)));
  const total = rows.reduce((s, a) => s + assetValue(a), 0);
  await tx.update(waqfs).set({ assetsEstimatedValue: total.toFixed(2) }).where(eq(waqfs.id, waqfId));
  return total;
}

async function loadAsset(tx: Tx, waqfId: string, assetId: string) {
  const [a] = await tx.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.waqfId, waqfId))).limit(1);
  return assertFound(a, "لم نجد هذا الأصل في الوقف.");
}

// ───────────── Assets ─────────────
const assetSchema = z.object({
  assetId: optUuid,
  category: z.enum(CATEGORIES, { error: "اختر نوع الأصل." }),
  subject: z.enum(["corpus", "value"]).default("corpus"),
  title: reqText(200, "اكتب وصفًا مميزًا للأصل."),
  ownershipDocNo: optText(80),
  inWaqfName: flag,
  sharePct: optPct,
  bookValue: optMoney,
  marketValue: optMoney,
  status: z.enum(["income", "vacant", "development", "idle", "disputed"]).default("income"),
  annualIncome: optMoney,
  acquiredOn: optDate,
  notes: optText(2000),
});

export async function saveAsset(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  const res = await fileAction(fd, assetSchema, "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    const { assetId, ...values } = d;
    // the type decides the asset's fields: data of another type is never kept, and formats are checked here
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(String(fd.get("details") ?? "{}")) ?? {}; } catch { raw = {}; }
    const chk = checkAsset({ category: d.category, title: d.title, value: d.marketValue ?? "", ownershipDocNo: d.ownershipDocNo ?? "", sharePct: d.sharePct ?? "", held: "off", details: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? "")])) });
    if (chk.errors.length) return { error: chk.errors.join(" "), fieldErrors: { details: chk.errors.join(" ") } };
    const spec = ASSET_TYPES[d.category];
    const typed = { ...values, ownershipDocNo: spec.ownershipDoc ? values.ownershipDocNo : null, sharePct: spec.share ? values.sharePct : null, details: chk.asset.details,
      status: FINANCIAL.includes(d.category) && !["income", "idle", "disputed"].includes(values.status) ? "income" as const : values.status };
    const tail = chk.missing.length ? ` ينقصه لاكتماله: ${chk.missing.join("، ")}.` : "";
    let id = assetId;
    if (assetId) {
      const cur = await loadAsset(c.tx, w.id, assetId);
      await c.tx.update(assets).set({ ...typed, updatedBy: c.auth.user.id }).where(eq(assets.id, assetId));
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.updated", entityType: "asset", entityId: assetId, waqfId: w.id, ...meta(c), before: { category: cur.category, title: cur.title, marketValue: cur.marketValue, bookValue: cur.bookValue, status: cur.status, inWaqfName: cur.inWaqfName, details: cur.details }, after: typed });
    } else {
      const [a] = await c.tx.insert(assets).values({ ...typed, waqfId: w.id, createdBy: c.auth.user.id, updatedBy: c.auth.user.id }).returning({ id: assets.id });
      id = a.id;
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.added", entityType: "asset", entityId: a.id, waqfId: w.id, ...meta(c), after: typed });
      await addTimeline(c.tx, w, c.auth.user.id, "asset", `إضافة أصل: ${d.title}`);
      await materialChange(c.tx, w, "assets", c.auth.user.id, { action: "added", assetId: a.id });
    }
    // real estate also keeps its property record (leases, maintenance) in step with the asset's own data
    if (d.category === "real_estate") {
      const p = { deedNo: typed.ownershipDocNo ?? null, city: chk.asset.details.city ?? null, district: chk.asset.details.district ?? null, usage: chk.asset.details.usage ?? null, areaSqm: chk.asset.details.areaSqm ? Number(chk.asset.details.areaSqm).toFixed(2) : null };
      await c.tx.insert(properties).values({ assetId: id!, waqfId: w.id, ...p, createdBy: c.auth.user.id }).onConflictDoUpdate({ target: properties.assetId, set: { ...p, updatedBy: c.auth.user.id } });
    }
    await refreshTotals(c.tx, w.id);
    return { ok: true, message: (assetId ? "حُفظ الأصل." : "أُضيف الأصل.") + tail, data: { assetId: id } };
  }, (id) => sections(id, String(fd.get("assetId") || "") || null));
  if (res.ok && typeof res.data?.assetId === "string" && fd.get("open") === "1") redirect(`/app/w/${waqfId}/assets/${res.data.assetId}`);
  return res;
}

export async function archiveAsset(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ assetId: z.uuid(), reason: reqText(300, "اذكر سبب الإخراج (بيع بإذن، هلاك، نزع ملكية…).") }), "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    const a = await loadAsset(c.tx, w.id, d.assetId);
    if (a.archivedAt) throw new UserError("الأصل مؤرشف مسبقًا.");
    await c.tx.update(assets).set({ archivedAt: new Date(), archiveReason: d.reason, updatedBy: c.auth.user.id }).where(eq(assets.id, a.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.archived", entityType: "asset", entityId: a.id, waqfId: w.id, ...meta(c), after: { reason: d.reason } });
    await refreshTotals(c.tx, w.id);
    await addTimeline(c.tx, w, c.auth.user.id, "asset", `إخراج أصل من السجل: ${a.title}`, d.reason);
    await materialChange(c.tx, w, "assets", c.auth.user.id, { action: "archived", assetId: a.id });
    return { ok: true, message: "أُرشف الأصل." };
  }, (id) => sections(id, d_assetId(fd)));
}
const d_assetId = (fd: FormData) => String(fd.get("assetId") || "") || null;

const substituteSchema = z.object({
  assetId: z.uuid(),
  approvalId: z.uuid({ error: "اختر إذن الاستبدال الصادر من الجهة المختصة." }),
  newTitle: reqText(200, "صف الأصل البديل."),
  newCategory: z.enum(CATEGORIES, { error: "اختر نوع الأصل البديل." }),
  newValue: reqMoney("أدخل قيمة الأصل البديل."),
  newOwnershipDocNo: optText(80),
  substitutedOn: reqDate("أدخل تاريخ الاستبدال."),
});

/** Substitution (استبدال) with the competent authority's permission; notify GAA within 10 business days (OB-AST-01). */
export async function substituteAsset(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, substituteSchema, "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    const old = await loadAsset(c.tx, w.id, d.assetId);
    if (old.archivedAt) throw new UserError("الأصل مؤرشف.");
    const [ap] = await c.tx.select().from(approvals).where(and(eq(approvals.id, d.approvalId), eq(approvals.waqfId, w.id))).limit(1);
    assertFound(ap, "لم نجد الإذن.");
    if (ap!.kind !== "substitution" || ap!.status !== "granted") throw new UserError("الإذن المختار ليس إذن استبدال صادرًا. سجّله من صفحة الوثيقة والشروط ← الأذونات.");
    if (d.substitutedOn > todayIso()) return { error: "تاريخ الاستبدال لا يكون في المستقبل.", fieldErrors: { substitutedOn: "تاريخ غير صحيح." } };
    const [n] = await c.tx
      .insert(assets)
      .values({ waqfId: w.id, category: d.newCategory, subject: old.subject, title: d.newTitle, ownershipDocNo: d.newOwnershipDocNo, marketValue: d.newValue, acquiredOn: d.substitutedOn, inWaqfName: true, notes: `بديل عن «${old.title}» بموجب الإذن ${ap!.refNo ?? ""}`.trim(), createdBy: c.auth.user.id })
      .returning({ id: assets.id });
    await c.tx.update(assets).set({ archivedAt: new Date(), archiveReason: `استُبدل بأصل آخر بموجب الإذن ${ap!.refNo ?? ap!.id.slice(0, 8)}`, updatedBy: c.auth.user.id }).where(eq(assets.id, old.id));
    await c.tx.update(approvals).set({ assetId: old.id }).where(eq(approvals.id, ap!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.substituted", entityType: "asset", entityId: old.id, waqfId: w.id, ...meta(c), before: { assetId: old.id, title: old.title }, after: { newAssetId: n.id, title: d.newTitle, value: d.newValue, approvalId: ap!.id } });
    await refreshTotals(c.tx, w.id);
    await addTimeline(c.tx, w, c.auth.user.id, "asset", `استبدال أصل: ${old.title} ← ${d.newTitle}`, ap!.refNo ? `الإذن ${ap!.refNo}` : null, d.substitutedOn);
    await emitWaqfEvent(c.tx, { waqfId: w.id, event: "asset_substitution", date: d.substitutedOn, refId: n.id, actorUserId: c.auth.user.id, meta: { from: old.id, to: n.id } });
    await materialChange(c.tx, w, "assets", c.auth.user.id, { action: "substituted" });
    return { ok: true, message: "سُجّل الاستبدال. أشعر الهيئة ببيانات الأصل البديل خلال 10 أيام عمل (أُضيف الالتزام)." };
  }, (id) => sections(id, d_assetId(fd)));
}

export async function applySizeSuggestion(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({}), "waqf.edit", async (c) => {
    const w = c.access.waqf;
    if (w.sizeClassLocked) throw new UserError("فئة الحجم مثبّتة من إدارة المنصة ولا تتغير من هنا.");
    const total = await refreshTotals(c.tx, w.id);
    const s = suggestSizeClass(total, w.directBenefit);
    if (!s || s === w.sizeClass) return { ok: true, message: "الفئة الحالية مطابقة للمقترحة." };
    await c.tx.update(waqfs).set({ sizeClass: s, updatedBy: c.auth.user.id }).where(eq(waqfs.id, w.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.size_class_applied", entityType: "waqf", entityId: w.id, waqfId: w.id, ...meta(c), before: { sizeClass: w.sizeClass }, after: { sizeClass: s, assetsTotal: total } });
    if (w.registeredOn) await emitWaqfEvent(c.tx, { waqfId: w.id, event: "material_change", date: todayIso(), meta: { kind: "assets", from: w.sizeClass, to: s }, actorUserId: c.auth.user.id });
    await syncWaqfObligations(c.tx, w.id);
    return { ok: true, message: "اعتُمدت الفئة المقترحة وأُعيد حساب الالتزامات." };
  }, (id) => sections(id));
}

// ───────────── Property & investment details ─────────────
const propertySchema = z.object({
  assetId: z.uuid(),
  deedNo: optText(80), city: optText(80), district: optText(80),
  usage: z.union([z.literal(""), z.enum(["residential", "commercial", "agricultural", "mosque", "mixed", "land"])]).optional().transform((v) => v || null),
  areaSqm: optMoney, unitsCount: optInt(0, 100000), occupiedUnits: optInt(0, 100000),
  technicalCondition: z.union([z.literal(""), z.enum(["good", "fair", "poor"])]).optional().transform((v) => v || null),
  annualMaintenanceCost: optMoney, maintenanceReserve: optMoney, estimatedRent: optMoney,
}).superRefine((d, ctx) => {
  if (d.unitsCount !== null && d.occupiedUnits !== null && d.occupiedUnits > d.unitsCount) ctx.addIssue({ code: "custom", path: ["occupiedUnits"], message: "الوحدات المؤجرة لا تزيد على عدد الوحدات." });
});

export async function saveProperty(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, propertySchema, "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    const a = await loadAsset(c.tx, w.id, d.assetId);
    if (a.category !== "real_estate") throw new UserError("بيانات العقار تخص الأصول العقارية فقط.");
    const { assetId, ...v } = d;
    const [cur] = await c.tx.select().from(properties).where(eq(properties.assetId, assetId)).limit(1);
    if (cur) await c.tx.update(properties).set({ ...v, updatedBy: c.auth.user.id }).where(eq(properties.assetId, assetId));
    else await c.tx.insert(properties).values({ ...v, assetId, waqfId: w.id, createdBy: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.property_saved", entityType: "property", entityId: assetId, waqfId: w.id, ...meta(c), before: cur ?? null, after: v });
    // one source for the identifying data: the asset's own fields follow the property record
    const det = { ...((a.details as Record<string, string>) ?? {}) };
    for (const [k, val] of [["city", v.city], ["district", v.district], ["areaSqm", v.areaSqm], ...(["residential", "commercial", "mixed", "agricultural"].includes(String(v.usage ?? "")) ? [["usage", v.usage]] : [])] as [string, unknown][]) {
      if (val != null && val !== "") det[k] = String(val); else delete det[k];
    }
    await c.tx.update(assets).set({ details: det, ...(v.deedNo ? { ownershipDocNo: v.deedNo } : {}), updatedBy: c.auth.user.id }).where(eq(assets.id, assetId));
    return { ok: true, message: "حُفظت بيانات العقار." };
  }, (id) => sections(id, d_assetId(fd)));
}

const investmentSchema = z.object({
  assetId: z.uuid(),
  instrumentType: z.enum(["shares", "fund_units", "portfolio", "sukuk", "direct", "deposit"], { error: "اختر نوع الأداة." }),
  issuerName: optText(160), quantity: optMoney, costBasis: optMoney,
  bonusSharesTreatment: z.union([z.literal(""), z.enum(["corpus", "yield"])]).optional().transform((v) => v || null),
  managerName: optText(160), managerCmaLicense: optText(60), custodyAccount: optText(60), feePct: optPct, benchmark: optText(120),
});

export async function saveInvestment(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, investmentSchema, "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    await loadAsset(c.tx, w.id, d.assetId);
    const { assetId, ...v } = d;
    if (v.managerName && !v.managerCmaLicense) return { error: "مدير الاستثمار يلزم أن يكون مرخصًا من هيئة السوق المالية: أدخل رقم ترخيصه.", fieldErrors: { managerCmaLicense: "مطلوب مع اسم المدير." } };
    const [cur] = await c.tx.select().from(investments).where(eq(investments.assetId, assetId)).limit(1);
    if (cur) await c.tx.update(investments).set({ ...v, updatedBy: c.auth.user.id }).where(eq(investments.assetId, assetId));
    else await c.tx.insert(investments).values({ ...v, assetId, waqfId: w.id, createdBy: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.investment_saved", entityType: "investment", entityId: assetId, waqfId: w.id, ...meta(c), before: cur ?? null, after: v });
    return { ok: true, message: "حُفظت بيانات الاستثمار." };
  }, (id) => sections(id, d_assetId(fd)));
}

// ───────────── Leases ─────────────
const leaseSchema = z.object({
  assetId: z.uuid(),
  tenantName: reqText(200, "اكتب اسم المستأجر."),
  ejarContractNo: optText(60),
  startsOn: reqDate("أدخل تاريخ بداية العقد."),
  endsOn: reqDate("أدخل تاريخ نهاية العقد."),
  annualRent: reqMoney("أدخل الأجرة السنوية."),
  collectedToDate: optMoney,
  arrears: optMoney,
}).superRefine((d, ctx) => {
  if (d.endsOn <= d.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "نهاية العقد بعد بدايته." });
});

export async function addLease(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, leaseSchema, "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    await loadAsset(c.tx, w.id, d.assetId);
    const years = (new Date(d.endsOn).getTime() - new Date(d.startsOn).getTime()) / (365.25 * 86_400_000);
    const [l] = await c.tx.insert(leases).values({ ...d, waqfId: w.id, status: "active", createdBy: c.auth.user.id }).returning({ id: leases.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.lease_added", entityType: "lease", entityId: l.id, waqfId: w.id, ...meta(c), after: d });
    return { ok: true, message: years > 3 ? "سُجّل العقد. مدته طويلة: تأكد من إذن الجهة المختصة للتأجير الطويل إن اقتضاه شرط الواقف أو النظام." : "سُجّل عقد الإيجار." };
  }, (id) => sections(id, d_assetId(fd)));
}

export async function updateLease(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ assetId: z.uuid(), leaseId: z.uuid(), collectedToDate: optMoney, arrears: optMoney, status: z.enum(["active", "ended", "terminated"]) }), "assets.edit", async (c, d) => {
    const [l] = await c.tx.select().from(leases).where(and(eq(leases.id, d.leaseId), eq(leases.waqfId, c.access.waqf.id))).limit(1);
    assertFound(l);
    await c.tx.update(leases).set({ collectedToDate: d.collectedToDate, arrears: d.arrears, status: d.status, updatedBy: c.auth.user.id }).where(eq(leases.id, d.leaseId));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.lease_updated", entityType: "lease", entityId: d.leaseId, waqfId: c.access.waqf.id, ...meta(c), before: { collectedToDate: l!.collectedToDate, arrears: l!.arrears, status: l!.status }, after: d });
    return { ok: true, message: "حُدّث العقد." };
  }, (id) => sections(id, d_assetId(fd)));
}

// ───────────── Valuations ─────────────
const valuationSchema = z.object({
  assetId: z.uuid(),
  valuer: reqText(160, "اكتب اسم المقيّم."),
  valuerLicense: optText(60),
  method: optText(120),
  value: reqMoney("أدخل القيمة."),
  valuedOn: reqDate("أدخل تاريخ التقييم."),
});

export async function addValuation(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, valuationSchema, "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    const a = await loadAsset(c.tx, w.id, d.assetId);
    if (d.valuedOn > todayIso()) return { error: "تاريخ التقييم لا يكون في المستقبل.", fieldErrors: { valuedOn: "تاريخ غير صحيح." } };
    const [v] = await c.tx.insert(valuations).values({ ...d, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: valuations.id });
    if (!a.lastValuationOn || d.valuedOn >= a.lastValuationOn)
      await c.tx.update(assets).set({ marketValue: d.value, lastValuationOn: d.valuedOn, valuer: d.valuer, updatedBy: c.auth.user.id }).where(eq(assets.id, a.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.valuation_added", entityType: "valuation", entityId: v.id, waqfId: w.id, ...meta(c), before: { marketValue: a.marketValue }, after: d });
    const total = await refreshTotals(c.tx, w.id);
    const s = suggestSizeClass(total, w.directBenefit);
    const hint = s && s !== w.sizeClass && !w.sizeClassLocked ? " تغيرت فئة الحجم المقترحة؛ راجعها في صفحة الأصول." : "";
    return { ok: true, message: `سُجّل التقييم وحُدّثت القيمة السوقية.${d.valuerLicense ? "" : " يُفضّل مقيّم معتمد من «تقييم»."}${hint}` };
  }, (id) => sections(id, d_assetId(fd)));
}

// ───────────── Maintenance ─────────────
const maintSchema = z.object({
  assetId: z.uuid(),
  item: reqText(200, "اكتب بند الصيانة."),
  frequency: z.union([z.literal(""), z.enum(["monthly", "quarterly", "annual", "once"])]).optional().transform((v) => v || null),
  nextDueOn: optDate,
  estimatedCost: optMoney,
});

export async function addMaintenance(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, maintSchema, "assets.edit", async (c, d) => {
    await loadAsset(c.tx, c.access.waqf.id, d.assetId);
    const [m] = await c.tx.insert(maintenancePlans).values({ ...d, waqfId: c.access.waqf.id, createdBy: c.auth.user.id }).returning({ id: maintenancePlans.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.maintenance_added", entityType: "maintenance_plan", entityId: m.id, waqfId: c.access.waqf.id, ...meta(c), after: d });
    return { ok: true, message: "أُضيف بند الصيانة." };
  }, (id) => sections(id, d_assetId(fd)));
}

const NEXT: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };
export async function completeMaintenance(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ assetId: z.uuid(), planId: z.uuid() }), "assets.edit", async (c, d) => {
    const [m] = await c.tx.select().from(maintenancePlans).where(and(eq(maintenancePlans.id, d.planId), eq(maintenancePlans.waqfId, c.access.waqf.id))).limit(1);
    assertFound(m);
    const months = m!.frequency ? NEXT[m!.frequency] : undefined;
    let nextDueOn: string | null = null;
    if (months) {
      const base = new Date(`${m!.nextDueOn ?? todayIso()}T12:00:00Z`);
      base.setUTCMonth(base.getUTCMonth() + months);
      nextDueOn = base.toISOString().slice(0, 10);
    }
    await c.tx.update(maintenancePlans).set(months ? { nextDueOn, status: "planned", updatedBy: c.auth.user.id } : { status: "done", updatedBy: c.auth.user.id }).where(eq(maintenancePlans.id, m!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.maintenance_done", entityType: "maintenance_plan", entityId: m!.id, waqfId: c.access.waqf.id, ...meta(c), before: { nextDueOn: m!.nextDueOn, status: m!.status }, after: { nextDueOn, done: todayIso() } });
    return { ok: true, message: months ? "سُجّل التنفيذ وحُدّد الموعد التالي." : "سُجّل التنفيذ." };
  }, (id) => sections(id, d_assetId(fd)));
}

// ───────────── Encumbrances ─────────────
const encSchema = z.object({
  assetId: z.uuid(),
  kind: z.enum(["mortgage", "seizure", "dispute", "encroachment", "lien"], { error: "اختر نوع القيد." }),
  details: optText(1000),
  since: reqDate("أدخل تاريخ نشوء القيد."),
  approvalRef: optText(120),
}).superRefine((d, ctx) => {
  if (d.kind === "mortgage" && !d.approvalRef) ctx.addIssue({ code: "custom", path: ["approvalRef"], message: "رهن أصل الوقف يحتاج إذن الجهة المختصة: أدخل رقم الإذن." });
});

export async function addEncumbrance(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, encSchema, "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    const a = await loadAsset(c.tx, w.id, d.assetId);
    const details = [d.details, d.approvalRef ? `الإذن: ${d.approvalRef}` : null].filter(Boolean).join(" — ") || null;
    const [e] = await c.tx.insert(encumbrances).values({ assetId: a.id, waqfId: w.id, kind: d.kind, details, since: d.since, createdBy: c.auth.user.id }).returning({ id: encumbrances.id });
    if (d.kind === "dispute" || d.kind === "seizure") await c.tx.update(assets).set({ status: "disputed" }).where(eq(assets.id, a.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.encumbrance_added", entityType: "encumbrance", entityId: e.id, waqfId: w.id, ...meta(c), after: d });
    if (d.kind === "mortgage") {
      // لائحة تنظيم أعمال النظارة م19: notify GAA of the mortgage after the competent authority's permission (OB-AST-02).
      await emitWaqfEvent(c.tx, { waqfId: w.id, event: "mortgage", date: d.since, refId: e.id, actorUserId: c.auth.user.id, meta: { assetId: a.id } });
      await addTimeline(c.tx, w, c.auth.user.id, "asset", `رهن أصل: ${a.title}`, details, d.since);
      return { ok: true, message: "سُجّل الرهن. أشعر الهيئة به فورًا (أُضيف الالتزام)." };
    }
    return { ok: true, message: "سُجّل القيد." };
  }, (id) => sections(id, d_assetId(fd)));
}

export async function resolveEncumbrance(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ assetId: z.uuid(), encumbranceId: z.uuid(), resolvedOn: reqDate("أدخل تاريخ الفك.") }), "assets.edit", async (c, d) => {
    const [e] = await c.tx.select().from(encumbrances).where(and(eq(encumbrances.id, d.encumbranceId), eq(encumbrances.waqfId, c.access.waqf.id))).limit(1);
    assertFound(e);
    if (e!.since && d.resolvedOn < e!.since) return { error: "تاريخ الفك يسبق تاريخ نشوء القيد." };
    await c.tx.update(encumbrances).set({ resolvedOn: d.resolvedOn, updatedBy: c.auth.user.id }).where(eq(encumbrances.id, e!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.encumbrance_resolved", entityType: "encumbrance", entityId: e!.id, waqfId: c.access.waqf.id, ...meta(c), after: d });
    return { ok: true, message: "سُجّل فك القيد." };
  }, (id) => sections(id, d_assetId(fd)));
}

// ───────────── Portfolios & investment policy ─────────────
const portfolioSchema = z.object({
  accountNo: optText(60), custodian: optText(160), managerName: optText(160), managerCmaLicense: optText(60), strategy: optText(500),
  riskLevel: z.union([z.literal(""), z.enum(["low", "medium", "high"])]).optional().transform((v) => v || null),
  waqfDeedOn: optDate, registeredWithGaaOn: optDate, accountOpenedOn: optDate, recordedWithGaaOn: optDate,
}).superRefine((d, ctx) => {
  if (d.managerName && !d.managerCmaLicense) ctx.addIssue({ code: "custom", path: ["managerCmaLicense"], message: "مدير المحفظة يلزمه ترخيص هيئة السوق المالية." });
});

export async function addPortfolio(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, portfolioSchema, "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    const [p] = await c.tx.insert(portfolios).values({ ...d, waqfId: w.id, createdBy: c.auth.user.id }).returning({ id: portfolios.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.portfolio_added", entityType: "portfolio", entityId: p.id, waqfId: w.id, ...meta(c), after: d });
    // لائحة المنتجات الاستثمارية الوقفية م21–23: deed → register (5 bd); certificate → open account (5 bd); account → record with GAA (5 bd).
    if (d.waqfDeedOn) await emitWaqfEvent(c.tx, { waqfId: w.id, event: "portfolio_deed", date: d.waqfDeedOn, refId: p.id, actorUserId: c.auth.user.id });
    if (d.registeredWithGaaOn) await emitWaqfEvent(c.tx, { waqfId: w.id, event: "portfolio_certificate", date: d.registeredWithGaaOn, refId: p.id, actorUserId: c.auth.user.id });
    if (d.accountOpenedOn) await emitWaqfEvent(c.tx, { waqfId: w.id, event: "portfolio_created", date: d.accountOpenedOn, refId: p.id, actorUserId: c.auth.user.id });
    await syncWaqfObligations(c.tx, w.id);
    return { ok: true, message: "أُضيفت المحفظة وحُسبت مواعيدها النظامية." };
  }, (id) => sections(id));
}

const ALLOC_CATS = ["real_estate", "equities", "sukuk", "funds", "deposits", "cash", "other"];
export async function saveInvestmentPolicy(_: ActionState, fd: FormData): Promise<ActionState> {
  const rows = readRows(fd, "al", ["category", "minPct", "targetPct", "maxPct"]);
  return fileAction(fd, z.object({ targetReturnPct: optPct, riskTolerance: z.union([z.literal(""), z.enum(["low", "medium", "high"])]).optional().transform((v) => v || null), prohibited: optText(2000), leveragePolicy: optText(1000), reviewDue: optDate }), "assets.edit", async (c, d) => {
    const w = c.access.waqf;
    const allocation = rows.map((r) => ({ category: r.category, minPct: Number(r.minPct || 0), targetPct: Number(r.targetPct || 0), maxPct: Number(r.maxPct || 0) }));
    for (const [i, a] of allocation.entries()) {
      if (!ALLOC_CATS.includes(a.category)) return { error: `اختر فئة الأصول في السطر ${i + 1}.` };
      if ([a.minPct, a.targetPct, a.maxPct].some((x) => !Number.isFinite(x) || x < 0 || x > 100)) return { error: `النسب في السطر ${i + 1} بين 0 و100.` };
      if (!(a.minPct <= a.targetPct && a.targetPct <= a.maxPct)) return { error: `السطر ${i + 1}: الحد الأدنى ≤ المستهدف ≤ الحد الأعلى.` };
    }
    const sum = allocation.reduce((s, a) => s + a.targetPct, 0);
    if (allocation.length && Math.abs(sum - 100) > 0.01) return { error: `مجموع النسب المستهدفة ${sum}% ويجب أن يساوي 100%.` };
    const [m] = await c.tx.select({ v: max(investmentPolicies.version) }).from(investmentPolicies).where(eq(investmentPolicies.waqfId, w.id));
    const version = Number(m?.v ?? 0) + 1;
    const [p] = await c.tx.insert(investmentPolicies).values({ ...d, allocation, version, waqfId: w.id, status: "draft", createdBy: c.auth.user.id }).returning({ id: investmentPolicies.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.policy_drafted", entityType: "investment_policy", entityId: p.id, waqfId: w.id, ...meta(c), after: { ...d, allocation, version } });
    return { ok: true, message: `حُفظت مسودة سياسة الاستثمار (الإصدار ${version}). تعتمدها جهة الاعتماد في الوقف.` };
  }, (id) => sections(id));
}

export async function approveInvestmentPolicy(_: ActionState, fd: FormData): Promise<ActionState> {
  return fileAction(fd, z.object({ policyId: z.uuid() }), "finance.approve", async (c, d) => {
    const w = c.access.waqf;
    const [p] = await c.tx.select().from(investmentPolicies).where(and(eq(investmentPolicies.id, d.policyId), eq(investmentPolicies.waqfId, w.id))).limit(1);
    assertFound(p);
    if (p!.status !== "draft") throw new UserError("السياسة ليست مسودة.");
    await c.tx.update(investmentPolicies).set({ status: "superseded" }).where(and(eq(investmentPolicies.waqfId, w.id), eq(investmentPolicies.status, "approved")));
    await c.tx.update(investmentPolicies).set({ status: "approved", updatedBy: c.auth.user.id }).where(eq(investmentPolicies.id, p!.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "assets.policy_approved", entityType: "investment_policy", entityId: p!.id, waqfId: w.id, ...meta(c), after: { version: p!.version } });
    return { ok: true, message: "اعتُمدت سياسة الاستثمار." };
  }, (id) => sections(id));
}
