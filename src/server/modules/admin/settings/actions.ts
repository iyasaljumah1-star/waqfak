"use server";

import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/server/db";
import { featureFlags, otpChallenges, outboxMessages, rateLimits, sessions, settings } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { parseForm, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { staffAction } from "../guard";
import { COMPANY_FIELDS, GENERAL_SETTINGS, RETENTION_DEFAULTS, RETENTION_FIELDS, type RetentionPolicy } from "./defs";
import type { License } from "./queries";

const PATH = "/admin/settings";
const NAZARA_LICENSE = "gaa_nazara_license";

async function readValue<T>(tx: Tx, key: string, fallback: T): Promise<T> {
  const [r] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, key)).limit(1).for("update");
  return (r?.v as T) ?? fallback;
}

async function writeValue(tx: Tx, key: string, value: unknown, userId: string, description?: string) {
  await tx
    .insert(settings)
    .values({ key, value, description: description ?? null, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}

const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

// ───────────── company profile ─────────────
export async function saveCompanyProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const fieldErrors: Record<string, string> = {};
  const next: Record<string, string> = {};
  for (const f of COMPANY_FIELDS) {
    const v = String(fd.get(f.key) ?? "").trim().slice(0, 300);
    next[f.key] = v;
  }
  if (!next.nameAr) fieldErrors.nameAr = "الاسم التجاري مطلوب.";
  if (next.email && !z.string().email().safeParse(next.email).success) fieldErrors.email = "البريد الإلكتروني غير صحيح.";
  if (next.vatNumber && !/^3\d{13}3$/.test(next.vatNumber)) fieldErrors.vatNumber = "الرقم الضريبي 15 رقمًا يبدأ وينتهي بالرقم 3.";
  if (next.crNumber && !/^\d{10}$/.test(next.crNumber)) fieldErrors.crNumber = "رقم السجل التجاري 10 أرقام.";
  if (next.unifiedNumber && !/^7\d{9}$/.test(next.unifiedNumber)) fieldErrors.unifiedNumber = "الرقم الوطني الموحد 10 أرقام يبدأ بالرقم 7.";
  if (next.vatRegistration && !["registered", "not_registered"].includes(next.vatRegistration)) fieldErrors.vatRegistration = "اختر حالة التسجيل.";
  if (next.vatRegistration === "registered" && !next.vatNumber) fieldErrors.vatNumber = "أدخل الرقم الضريبي للشركة المسجلة.";
  if (next.vatRegistration === "not_registered" && next.vatNumber) fieldErrors.vatNumber = "الشركة غير مسجلة: احذف الرقم الضريبي أو غيّر حالة التسجيل.";
  next.iban = next.iban.replace(/\s+/g, "").toUpperCase();
  if (next.iban && !/^SA\d{22}$/.test(next.iban)) fieldErrors.iban = "الآيبان السعودي يبدأ بـ SA ويتبعه 22 رقمًا.";
  if (Object.keys(fieldErrors).length) return { error: "راجع الحقول المظللة.", fieldErrors };
  return staffAction("admin.settings", async ({ auth, tx, ip, userAgent }) => {
    const before = await readValue<Record<string, string>>(tx, "company.profile", {});
    const value = { ...before, ...next };
    await writeValue(tx, "company.profile", value, auth.user.id);
    await audit(tx, { actorUserId: auth.user.id, action: "admin.settings.company_profile", entityType: "setting", entityId: "company.profile", ip, userAgent, before, after: value });
    return { ok: true, message: "حُفظت بيانات الشركة. تظهر في التذييل والعقود والتقارير الجديدة." };
  }, PATH);
}

// ───────────── licenses ─────────────
const licenseSchema = z.object({
  key: z.string().min(1),
  number: z.string().trim().max(60),
  issuer: z.string().trim().max(120),
  expiresOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح.")]),
  active: z.string().optional(),
  alsoFlag: z.string().optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function saveLicense(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(licenseSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const active = d.active === "on";
  if (active) {
    const fe: Record<string, string> = {};
    if (!d.number) fe.number = "لا يُفعّل ترخيص بلا رقم.";
    if (!d.expiresOn) fe.expiresOn = "أدخل تاريخ انتهاء الترخيص.";
    else if (d.expiresOn <= todayISO()) fe.expiresOn = "الترخيص منتهٍ؛ جدده قبل التفعيل.";
    if (Object.keys(fe).length) return { error: "راجع الحقول المظللة.", fieldErrors: fe };
  }
  return staffAction("admin.settings", async ({ auth, tx, ip, userAgent }) => {
    const list = await readValue<License[]>(tx, "company.licenses", []);
    const idx = list.findIndex((l) => l.key === d.key);
    if (idx < 0) throw new UserError("الترخيص غير معروف.");
    const before = list[idx];
    const after: License = { ...before, number: d.number, issuer: d.issuer || before.issuer, expiresOn: d.expiresOn, active };
    const next = list.map((l, i) => (i === idx ? after : l));
    await writeValue(tx, "company.licenses", next, auth.user.id);
    await audit(tx, { actorUserId: auth.user.id, action: "admin.settings.license", entityType: "setting", entityId: `company.licenses:${d.key}`, ip, userAgent, before, after });
    // The nazara licence no longer switches N01 intake on or off: it gates the start of nazara on real waqfs
    // (activation of an engagement), checked at that moment against this record.
    const extra = d.key === NAZARA_LICENSE ? (active ? " يمكن الآن مباشرة النظارة على الأوقاف المقبولة." : " تبقى طلبات النظارة تُستقبل وتُدرس، وتتوقف مباشرة نظارات جديدة حتى تفعيله.") : "";
    return { ok: true, message: `حُفظ «${before.nameAr}».${extra}` };
  }, PATH);
}

// ───────────── feature flags ─────────────
const flagSchema = z.object({
  key: z.string().min(1),
  enabled: z.enum(["on", "off"]),
  reason: z.string().trim().min(10, "اذكر سبب التغيير في 10 أحرف على الأقل؛ يظهر للفريق ويُحفظ في السجل.").max(500),
});

export async function setFeatureFlag(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(flagSchema, fd);
  if ("state" in r) return r.state;
  const enabled = r.data.enabled === "on";
  return staffAction("admin.settings", async ({ auth, tx, ip, userAgent }) => {
    const [flag] = await tx.select().from(featureFlags).where(eq(featureFlags.key, r.data.key)).limit(1).for("update");
    if (!flag) throw new UserError("الخاصية غير معروفة.");
    if (flag.enabled === enabled) return { ok: true, message: "لا تغيير." };
    await tx.update(featureFlags).set({ enabled, reason: r.data.reason, updatedBy: auth.user.id, updatedAt: new Date() }).where(eq(featureFlags.key, flag.key));
    await audit(tx, {
      actorUserId: auth.user.id, action: "admin.flag.toggled", entityType: "feature_flag", entityId: flag.key, ip, userAgent,
      before: { enabled: flag.enabled, reason: flag.reason }, after: { enabled, reason: r.data.reason },
    });
    return { ok: true, message: `${enabled ? "فُعّلت" : "أُوقفت"} «${flag.description}».` };
  }, `${PATH}/flags`);
}

// ───────────── general ─────────────
export async function saveGeneralSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const fieldErrors: Record<string, string> = {};
  const values: Record<string, number> = {};
  for (const g of GENERAL_SETTINGS) {
    const raw = String(fd.get(g.key) ?? "").trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) fieldErrors[g.key] = "أدخل رقمًا.";
    else if (n < g.min || n > g.max) fieldErrors[g.key] = `القيمة بين ${g.min} و${g.max}.`;
    else if (!g.step && !Number.isInteger(n)) fieldErrors[g.key] = "أدخل عددًا صحيحًا.";
    else values[g.key] = n;
  }
  if (Object.keys(fieldErrors).length) return { error: "راجع الحقول المظللة.", fieldErrors };
  return staffAction("admin.settings", async ({ auth, tx, ip, userAgent }) => {
    const changed: string[] = [];
    for (const g of GENERAL_SETTINGS) {
      const before = Number(await readValue<number>(tx, g.key, g.fallback));
      if (before === values[g.key]) continue;
      await writeValue(tx, g.key, values[g.key], auth.user.id, g.label);
      await audit(tx, { actorUserId: auth.user.id, action: "admin.settings.general", entityType: "setting", entityId: g.key, ip, userAgent, before: { value: before }, after: { value: values[g.key] } });
      changed.push(g.label);
    }
    return { ok: true, message: changed.length ? `حُفظ: ${changed.join("، ")}.` : "لا تغيير." };
  }, `${PATH}/general`);
}

// ───────────── retention ─────────────
export async function saveRetention(_: ActionState, fd: FormData): Promise<ActionState> {
  const fieldErrors: Record<string, string> = {};
  const next = { ...RETENTION_DEFAULTS };
  for (const f of RETENTION_FIELDS) {
    const n = Number(String(fd.get(f.key) ?? "").trim());
    if (!Number.isInteger(n)) fieldErrors[f.key] = "أدخل عددًا صحيحًا.";
    else if (n < f.min || n > f.max) fieldErrors[f.key] = `القيمة بين ${f.min} و${f.max}.`;
    else next[f.key] = n;
  }
  if (Object.keys(fieldErrors).length) return { error: "راجع الحقول المظللة.", fieldErrors };
  return staffAction("admin.settings", async ({ auth, tx, ip, userAgent }) => {
    const before = { ...RETENTION_DEFAULTS, ...(await readValue<Partial<RetentionPolicy>>(tx, "retention.policy", {})) };
    await writeValue(tx, "retention.policy", next, auth.user.id, "سياسة الاحتفاظ بالبيانات");
    await audit(tx, { actorUserId: auth.user.id, action: "admin.settings.retention", entityType: "setting", entityId: "retention.policy", ip, userAgent, before, after: next });
    return { ok: true, message: "حُفظت سياسة الاحتفاظ." };
  }, `${PATH}/general`);
}

/** Applies the retention policy now to system tables (sessions, OTP challenges, outbox, rate-limit windows). */
export async function runRetention(_: ActionState, __?: FormData): Promise<ActionState> {
  return staffAction("admin.settings", async ({ auth, tx, ip, userAgent }) => {
    const p = { ...RETENTION_DEFAULTS, ...(await readValue<Partial<RetentionPolicy>>(tx, "retention.policy", {})) };
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    const s = await tx
      .delete(sessions)
      .where(or(and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, ago(p.sessionsDays))), lt(sessions.absoluteExpiresAt, ago(p.sessionsDays))))
      .returning({ id: sessions.id });
    const o = await tx.delete(otpChallenges).where(lt(otpChallenges.expiresAt, ago(p.otpDays))).returning({ id: otpChallenges.id });
    const m = await tx.delete(outboxMessages).where(lt(outboxMessages.createdAt, ago(p.outboxDays))).returning({ id: outboxMessages.id });
    const rl = await tx.delete(rateLimits).where(lt(rateLimits.windowStart, ago(1))).returning({ key: rateLimits.key });
    const after = { sessions: s.length, otpChallenges: o.length, outbox: m.length, rateLimitWindows: rl.length, policy: p };
    await audit(tx, { actorUserId: auth.user.id, action: "admin.retention.run", entityType: "setting", entityId: "retention.policy", ip, userAgent, after });
    return { ok: true, message: `نُفذت السياسة: حُذفت ${s.length} جلسة، و${o.length} رمز تحقق، و${m.length} رسالة صادرة.` };
  }, `${PATH}/general`);
}
