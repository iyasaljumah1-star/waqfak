"use server";
import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  discounts, packageItems, packages, priceQuoteHistory, serviceCategories, servicePrices, services, workflowTemplates,
} from "@/server/db/schema";
import { parseForm, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { log, staffAction, type StaffCtx } from "./guard";
import { checkbox, code, formObj, optDate, optInt, optNumber, optText, reqText, uuid } from "./form-utils";
import { diffFields, overlappingPrice, parseJson, validateStages } from "./pure";

const SVC_PATHS = ["/admin/services", "/services", "/packages", "/app/services"];

async function logPrices(c: StaffCtx, entityType: string, entityId: string, before: Record<string, unknown> | null, after: Record<string, unknown>, fields: string[]) {
  const changes = diffFields(before, after, fields);
  if (changes.length) await c.tx.insert(priceQuoteHistory).values(changes.map((ch) => ({ entityType, entityId, ...ch, actorUserId: c.auth.user.id })));
  return changes;
}

// ───────────── Services ─────────────

const serviceSchema = z.object({
  id: z.string().optional(),
  code: code("رمز الخدمة بحروف إنجليزية كبيرة وأرقام، مثل T01."),
  categoryId: uuid,
  nameAr: reqText(3, "اكتب اسم الخدمة (3 أحرف على الأقل).", 200),
  summary: reqText(10, "اكتب ملخصًا للخدمة (10 أحرف على الأقل).", 500),
  description: optText(5000),
  requirements: optText(3000),
  outputs: optText(2000),
  pricingModel: z.enum(["free", "fixed", "subscription", "hourly", "percentage", "quote"], { error: "اختر نموذج التسعير." }),
  basePrice: optNumber(0, 1e10, "السعر الأساسي رقم موجب."),
  slaDays: optInt(0, 3650, "مدة الإنجاز عدد أيام صحيح."),
  departmentKey: optText(40),
  defaultSpecialistRole: optText(60),
  regulatoryRestrictions: optText(2000),
  conflictRule: z.enum(["none", "blocked_if_waqfak_nazir", "blocked_if_waqfak_controls_finance", "inside_nazara_only"], { error: "اختر قاعدة التعارض." }),
  requiresLicenseKey: optText(60),
  workflowTemplateCode: z.string().trim().min(1, "اختر قالب سير العمل."),
  audiences: z.array(z.enum(["waqif", "nazir", "board", "beneficiary", "entity"])).min(1, "اختر فئة مستهدفة واحدة على الأقل."),
  stage: optInt(1, 5, "مرحلة رحلة الوقف بين 1 و5."),
  position: optInt(0, 10000),
  isActive: checkbox,
  isPublished: checkbox,
});

export async function saveService(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(serviceSchema, formObj(fd, ["audiences"]));
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.pricingModel === "fixed" && d.basePrice === null) return { error: "راجع الحقول المظللة.", fieldErrors: { basePrice: "السعر الثابت يحتاج مبلغًا. اختر «عرض سعر» إن لم يُحدد السعر بعد." } };
  let newId: string | null = null;
  const res = await staffAction("admin.services", async (c) => {
    const [wf] = await c.tx.select({ code: workflowTemplates.code }).from(workflowTemplates).where(eq(workflowTemplates.code, d.workflowTemplateCode)).limit(1);
    if (!wf) throw new UserError("قالب سير العمل غير موجود.");
    const [cat] = await c.tx.select({ id: serviceCategories.id }).from(serviceCategories).where(eq(serviceCategories.id, d.categoryId)).limit(1);
    if (!cat) throw new UserError("الفئة غير موجودة.");
    const [dup] = await c.tx.select({ id: services.id }).from(services).where(and(eq(services.code, d.code), d.id ? ne(services.id, d.id) : undefined)).limit(1);
    if (dup) throw new UserError(`الرمز ${d.code} مستخدم لخدمة أخرى.`);
    const values = {
      code: d.code, categoryId: d.categoryId, nameAr: d.nameAr, summary: d.summary, description: d.description, requirements: d.requirements, outputs: d.outputs,
      pricingModel: d.pricingModel, basePrice: d.basePrice === null ? null : String(d.basePrice), slaDays: d.slaDays, departmentKey: d.departmentKey,
      defaultSpecialistRole: d.defaultSpecialistRole, regulatoryRestrictions: d.regulatoryRestrictions, conflictRule: d.conflictRule,
      requiresLicenseKey: d.requiresLicenseKey, workflowTemplateCode: d.workflowTemplateCode, audiences: d.audiences, stage: d.stage,
      position: d.position ?? 0, isActive: d.isActive, isPublished: d.isPublished, updatedBy: c.auth.user.id,
    };
    if (d.id) {
      const [before] = await c.tx.select().from(services).where(eq(services.id, d.id)).limit(1);
      if (!before) throw new UserError("الخدمة غير موجودة.");
      await c.tx.update(services).set(values).where(eq(services.id, d.id));
      await logPrices(c, "service", d.id, before as never, values as never, ["pricingModel", "basePrice"]);
      await log(c, "admin.service.update", "service", d.id, before, values);
      return { ok: true, message: "حُفظت الخدمة." };
    }
    const [row] = await c.tx.insert(services).values({ ...values, createdBy: c.auth.user.id }).returning({ id: services.id });
    await logPrices(c, "service", row.id, null, values as never, ["pricingModel", "basePrice"]);
    await log(c, "admin.service.create", "service", row.id, null, values);
    newId = row.id;
  }, { revalidate: [...SVC_PATHS, ...(d.id ? [`/admin/services/${d.id}`] : [])] });
  if (newId) redirect(`/admin/services/${newId}?created=1`);
  return res;
}

const priceSchema = z.object({
  serviceId: uuid,
  priceId: z.string().optional(),
  sizeClass: z.enum(["", "large", "medium", "small", "direct_benefit"]).transform((v) => (v ? v : null)),
  price: z.string().trim().min(1, "أدخل السعر.").transform(Number).refine((v) => Number.isFinite(v) && v >= 0 && v <= 1e10, "السعر رقم موجب."),
  validFrom: optDate,
  validTo: optDate,
});

/** Adds or edits a price row (per size class, with an effective period). Overlaps are rejected. */
export async function savePrice(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(priceSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.validFrom && d.validTo && d.validTo < d.validFrom) return { error: "تاريخ النهاية قبل تاريخ البداية.", fieldErrors: { validTo: "يجب أن يكون بعد تاريخ البداية." } };
  return staffAction("admin.pricing", async (c) => {
    const rows = await c.tx.select().from(servicePrices).where(eq(servicePrices.serviceId, d.serviceId));
    const clash = overlappingPrice(rows, { id: d.priceId || undefined, sizeClass: d.sizeClass, validFrom: d.validFrom, validTo: d.validTo });
    if (clash) throw new UserError(`تتداخل فترة السعر مع سعر قائم لنفس الفئة (${clash.validFrom ?? "بلا بداية"} — ${clash.validTo ?? "مفتوح"}). أنهِ السعر القائم أولًا بتاريخ نهاية.`);
    const values = { sizeClass: d.sizeClass, price: String(d.price), validFrom: d.validFrom, validTo: d.validTo, updatedBy: c.auth.user.id };
    if (d.priceId) {
      const before = rows.find((x) => x.id === d.priceId);
      if (!before) throw new UserError("السعر غير موجود.");
      await c.tx.update(servicePrices).set(values).where(eq(servicePrices.id, d.priceId));
      await logPrices(c, "service_price", d.priceId, before as never, values, ["sizeClass", "price", "validFrom", "validTo"]);
      await log(c, "admin.price.update", "service_price", d.priceId, before, values);
      return { ok: true, message: "عُدّل السعر وسُجّل التغيير." };
    }
    const [row] = await c.tx.insert(servicePrices).values({ serviceId: d.serviceId, ...values, createdBy: c.auth.user.id }).returning({ id: servicePrices.id });
    await logPrices(c, "service_price", row.id, null, values, ["sizeClass", "price", "validFrom", "validTo"]);
    await log(c, "admin.price.create", "service_price", row.id, null, { serviceId: d.serviceId, ...values });
    return { ok: true, message: "أُضيف السعر وسُجّل في سجل تغييرات الأسعار." };
  }, { revalidate: [`/admin/services/${d.serviceId}`, ...SVC_PATHS] });
}

export async function deletePrice(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("priceId") ?? "");
  const serviceId = String(fd.get("serviceId") ?? "");
  return staffAction("admin.pricing", async (c) => {
    const [before] = await c.tx.select().from(servicePrices).where(and(eq(servicePrices.id, id), eq(servicePrices.serviceId, serviceId))).limit(1);
    if (!before) throw new UserError("السعر غير موجود.");
    await c.tx.delete(servicePrices).where(eq(servicePrices.id, id));
    await c.tx.insert(priceQuoteHistory).values({ entityType: "service_price", entityId: id, field: "deleted", oldValue: `${before.sizeClass ?? "all"}:${before.price}`, newValue: null, actorUserId: c.auth.user.id });
    await log(c, "admin.price.delete", "service_price", id, before, null);
    return { ok: true, message: "حُذف السعر." };
  }, { revalidate: [`/admin/services/${serviceId}`, ...SVC_PATHS] });
}

// ───────────── Packages ─────────────

const packageSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,39}$/, "رمز الباقة بحروف إنجليزية صغيرة، مثل governance."),
  nameAr: reqText(2, "اكتب اسم الباقة.", 120),
  description: optText(2000),
  audience: optText(200),
  targetSizeClasses: z.array(z.enum(["large", "medium", "small", "direct_benefit"])),
  monthlyPrice: optNumber(0, 1e9, "السعر الشهري رقم موجب."),
  annualPrice: optNumber(0, 1e10, "السعر السنوي رقم موجب."),
  termsAr: optText(5000),
  isActive: checkbox,
  isClosed: checkbox,
  position: optInt(0, 10000),
  services: z.array(uuid),
});

export async function savePackage(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(packageSchema, formObj(fd, ["targetSizeClasses", "services"]));
  if ("state" in r) return r.state;
  const d = r.data;
  let newId: string | null = null;
  const res = await staffAction("admin.services", async (c) => {
    const [dup] = await c.tx.select({ id: packages.id }).from(packages).where(and(eq(packages.code, d.code), d.id ? ne(packages.id, d.id) : undefined)).limit(1);
    if (dup) throw new UserError(`الرمز ${d.code} مستخدم لباقة أخرى.`);
    const notes = new Map<string, string | null>();
    for (const sid of d.services) notes.set(sid, String(fd.get(`note_${sid}`) ?? "").trim() || null);
    const values = {
      code: d.code, nameAr: d.nameAr, description: d.description, audience: d.audience, targetSizeClasses: d.targetSizeClasses,
      monthlyPrice: d.monthlyPrice === null ? null : String(d.monthlyPrice), annualPrice: d.annualPrice === null ? null : String(d.annualPrice),
      termsAr: d.termsAr, isActive: d.isActive, isClosed: d.isClosed, position: d.position ?? 0, updatedBy: c.auth.user.id,
    };
    let id = d.id ?? null;
    let before: Record<string, unknown> | null = null;
    if (id) {
      const [b] = await c.tx.select().from(packages).where(eq(packages.id, id)).limit(1);
      if (!b) throw new UserError("الباقة غير موجودة.");
      before = b as unknown as Record<string, unknown>;
      await c.tx.update(packages).set(values).where(eq(packages.id, id));
    } else {
      const [row] = await c.tx.insert(packages).values({ ...values, createdBy: c.auth.user.id }).returning({ id: packages.id });
      id = row.id;
      newId = id;
    }
    const prevItems = id ? await c.tx.select().from(packageItems).where(eq(packageItems.packageId, id)) : [];
    await c.tx.delete(packageItems).where(eq(packageItems.packageId, id));
    if (d.services.length) await c.tx.insert(packageItems).values(d.services.map((serviceId) => ({ packageId: id!, serviceId, note: notes.get(serviceId) ?? null })));
    await logPrices(c, "package", id, before, values as never, ["monthlyPrice", "annualPrice"]);
    await log(c, before ? "admin.package.update" : "admin.package.create", "package", id, before ? { ...before, services: prevItems.map((i) => i.serviceId) } : null, { ...values, services: d.services });
    return { ok: true, message: "حُفظت الباقة وخدماتها." };
  }, { revalidate: [...SVC_PATHS, ...(d.id ? [`/admin/services/packages/${d.id}`] : [])] });
  if (newId) redirect(`/admin/services/packages/${newId}?created=1`);
  return res;
}

// ───────────── Discounts ─────────────

const discountSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, "رمز الخصم من 3 إلى 30 حرفًا إنجليزيًا أو رقمًا، مثل RAMADAN26."),
  kind: z.enum(["percent", "fixed"], { error: "اختر نوع الخصم." }),
  value: z.string().trim().min(1, "أدخل قيمة الخصم.").transform(Number).refine((v) => Number.isFinite(v) && v > 0, "قيمة الخصم رقم أكبر من صفر."),
  validFrom: optDate,
  validTo: optDate,
  maxUses: optInt(1, 1e7, "الحد الأقصى للاستخدام عدد صحيح موجب."),
  isActive: checkbox,
  services: z.array(z.string()),
  packages: z.array(z.string()),
});

export async function saveDiscount(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(discountSchema, formObj(fd, ["services", "packages"]));
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.kind === "percent" && d.value > 100) return { error: "راجع الحقول المظللة.", fieldErrors: { value: "النسبة لا تتجاوز 100%." } };
  if (d.validFrom && d.validTo && d.validTo < d.validFrom) return { error: "راجع الحقول المظللة.", fieldErrors: { validTo: "تاريخ النهاية قبل تاريخ البداية." } };
  let newId: string | null = null;
  const res = await staffAction("admin.pricing", async (c) => {
    const [dup] = await c.tx.select({ id: discounts.id }).from(discounts).where(and(eq(discounts.code, d.code), d.id ? ne(discounts.id, d.id) : undefined)).limit(1);
    if (dup) throw new UserError(`رمز الخصم ${d.code} مستخدم.`);
    const values = {
      code: d.code, kind: d.kind, value: String(d.value), validFrom: d.validFrom, validTo: d.validTo, maxUses: d.maxUses, isActive: d.isActive,
      appliesTo: { ...(d.services.length ? { services: d.services } : {}), ...(d.packages.length ? { packages: d.packages } : {}) }, updatedBy: c.auth.user.id,
    };
    if (d.id) {
      const [before] = await c.tx.select().from(discounts).where(eq(discounts.id, d.id)).limit(1);
      if (!before) throw new UserError("الخصم غير موجود.");
      if (d.maxUses !== null && d.maxUses < before.uses) throw new UserError(`استُخدم الخصم ${before.uses} مرة؛ لا يقل الحد الأقصى عن ذلك.`);
      await c.tx.update(discounts).set(values).where(eq(discounts.id, d.id));
      await logPrices(c, "discount", d.id, before as never, values as never, ["kind", "value", "validFrom", "validTo", "maxUses", "isActive"]);
      await log(c, "admin.discount.update", "discount", d.id, before, values);
      return { ok: true, message: "حُفظ الخصم." };
    }
    const [row] = await c.tx.insert(discounts).values({ ...values, createdBy: c.auth.user.id }).returning({ id: discounts.id });
    await logPrices(c, "discount", row.id, null, values as never, ["kind", "value", "validFrom", "validTo", "maxUses", "isActive"]);
    await log(c, "admin.discount.create", "discount", row.id, null, values);
    newId = row.id;
  }, { revalidate: ["/admin/services", ...(d.id ? [`/admin/services/discounts/${d.id}`] : [])] });
  if (newId) redirect(`/admin/services/discounts/${newId}?created=1`);
  return res;
}

// ───────────── Workflow templates ─────────────

const workflowSchema = z.object({
  isNew: z.string().optional(),
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,39}$/, "رمز القالب بحروف إنجليزية صغيرة، مثل standard."),
  nameAr: reqText(3, "اكتب اسم القالب.", 120),
  stages: z.string(),
});

export async function saveWorkflow(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(workflowSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const j = parseJson(d.stages, "المراحل");
  if (!j.ok) return { error: j.error, fieldErrors: { stages: j.error } };
  const v = validateStages(j.value);
  if (!v.ok) return { error: v.error, fieldErrors: { stages: v.error } };
  let created = false;
  const res = await staffAction("admin.services", async (c) => {
    const [before] = await c.tx.select().from(workflowTemplates).where(eq(workflowTemplates.code, d.code)).limit(1);
    if (d.isNew && before) throw new UserError(`يوجد قالب بالرمز ${d.code}.`);
    if (before) {
      await c.tx.update(workflowTemplates).set({ nameAr: d.nameAr, stages: v.value, updatedBy: c.auth.user.id }).where(eq(workflowTemplates.code, d.code));
      await log(c, "admin.workflow.update", "workflow_template", before.id, before, { nameAr: d.nameAr, stages: v.value });
      return { ok: true, message: "حُفظ القالب. يُطبّق على الطلبات الجديدة فقط؛ الطلبات القائمة تحتفظ بمراحلها." };
    }
    const [row] = await c.tx.insert(workflowTemplates).values({ code: d.code, nameAr: d.nameAr, stages: v.value, createdBy: c.auth.user.id }).returning({ id: workflowTemplates.id });
    await log(c, "admin.workflow.create", "workflow_template", row.id, null, { code: d.code, nameAr: d.nameAr, stages: v.value });
    created = true;
  }, { revalidate: ["/admin/services", `/admin/services/workflows/${d.code}`] });
  if (created) redirect(`/admin/services/workflows/${d.code}?created=1`);
  return res;
}
