"use server";

import { and, count, eq, gt, isNull, ne, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSystem, type Tx } from "../../db";
import { delegations, invitations, users, waqfKeys, waqfMemberships, waqfs, waqfTimelineEvents } from "../../db/schema";
import { normalizeSaudiMobile, maskPhone } from "../../auth/otp";
import { requireAuth } from "../../authz/context";
import { roleName } from "../../authz/catalog";
import { AGENT_CEILING, INVITABLE_ROLES, PROTECTED_ROLES, REGISTER_ROLES } from "./constants";
import { deriveSizeClass } from "../../engines/assessment";
import { env, showOtpOnScreen } from "../../env";
import { audit, nextNumber } from "../../lib/audit";
import { newDataKey, randomToken, sha256 } from "../../lib/crypto";
import { requestInfo } from "../../lib/request-info";
import { sendSms } from "../../adapters/messaging";
import { emitWaqfEvent, syncWaqfObligations } from "../compliance/events";
import { notify } from "../notify";
import { parseForm, toState, userAction, UserError, waqfAction } from "../_shared";
import { evidenceDocs } from "../establish/journey-server";
import type { ActionState } from "@/lib/utils";

// ───────────── helpers ─────────────
/** On failure, echo the submitted text values so the form can re-fill itself (React resets forms after an action). */
function keep(st: ActionState, fd: FormData): ActionState {
  if (!st.error) return st;
  const values: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string" || k.startsWith("$")) continue;
    const prev = values[k];
    values[k] = prev === undefined ? v : [...[prev].flat(), v];
  }
  return { ...st, data: { ...(st.data ?? {}), values } };
}
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const optText = (max: number) => z.string().trim().max(max, `النص أطول من ${max} حرفًا.`).optional().transform((v) => v || null);
const optDate = z
  .union([z.literal(""), z.iso.date("أدخل تاريخًا صحيحًا.")])
  .optional()
  .transform((v) => v || null);
const flag = z.string().optional().transform((v) => v === "on");
const fiscalEnd = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || "12-31")
  .refine((v) => {
    const m = /^(\d{2})-(\d{2})$/.exec(v);
    if (!m) return false;
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= days[mm - 1];
  }, "اكتب الشهر واليوم بالصيغة MM-DD، مثل 12-31.");

const ASSET_BAND = z.enum(["lt5", "5to50", "50to200", "gte200"], { error: "اختر شريحة قيمة الأصول." });
/** Changes to these roles are a change of nazara (material change). */
const NAZARA_ROLES = ["nazir", "board_chair"];

function activeNow() {
  return and(eq(waqfMemberships.status, "active"), or(isNull(waqfMemberships.endsAt), gt(waqfMemberships.endsAt, new Date())));
}

async function assertNotLast(tx: Tx, waqfId: string, m: { id: string; roleKey: string; status: string }, verb: string) {
  if (!PROTECTED_ROLES.includes(m.roleKey) || m.status !== "active") return;
  const [r] = await tx
    .select({ n: count() })
    .from(waqfMemberships)
    .where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.roleKey, m.roleKey), activeNow(), ne(waqfMemberships.id, m.id)));
  if (Number(r?.n ?? 0) === 0)
    throw new UserError(`لا يمكن ${verb} لأنه آخر «${roleName(m.roleKey)}» نشط في الوقف، ولا يبقى الوقف بلا ${roleName(m.roleKey)}. أضف من يخلفه أولًا ثم أعد المحاولة.`);
}

// ───────────── Register an existing waqf ─────────────
const registerSchema = z
  .object({
    name: z.string().trim().min(5, "اكتب اسم الوقف كما في الصك.").max(200),
    deedNo: optText(60),
    deedDate: optDate,
    deedDateHijri: optText(40),
    documentedOn: optDate,
    registeredOn: optDate,
    nationalUnifiedNumber: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.replace(/\s/g, "") : null))
      .refine((v) => v === null || /^7\d{9}$/.test(v), "الرقم الوطني الموحد من 10 أرقام ويبدأ بـ 7."),
    legalType: z.enum(["public", "private", "joint"], { error: "اختر نوع الوقف." }),
    nazirMode: z.enum(["founder", "individual", "board", "legal_entity", "gaa", "vacant"], { error: "اختر صيغة النظارة." }),
    assetBand: ASSET_BAND,
    myRole: z.enum(REGISTER_ROLES, { error: "اختر صفتك في الوقف." }),
    fiscalYearEnd: fiscalEnd,
    collectsDonations: flag,
    hasForeignParty: flag,
    hasBeneficiariesAbroad: flag,
    hasActiveLitigation: flag,
  })
  .superRefine((d, ctx) => {
    const t = todayIso();
    for (const k of ["deedDate", "documentedOn", "registeredOn"] as const)
      if (d[k] && d[k]! > t) ctx.addIssue({ code: "custom", path: [k], message: "التاريخ لا يكون في المستقبل." });
    if (d.documentedOn && d.registeredOn && d.registeredOn < d.documentedOn)
      ctx.addIssue({ code: "custom", path: ["registeredOn"], message: "تاريخ التسجيل لا يسبق تاريخ التوثيق." });
    if (d.registeredOn && !d.documentedOn && !d.deedNo)
      ctx.addIssue({ code: "custom", path: ["documentedOn"], message: "الوقف المسجّل لدى الهيئة يكون موثّقًا: أدخل تاريخ التوثيق أو رقم الصك." });
  });

export async function registerWaqf(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(registerSchema, fd);
  if ("state" in r) return keep(r.state, fd);
  const d = r.data;
  const res = await userAction(
    async ({ auth, tx, ip, userAgent }) => {
      const sizeClass = deriveSizeClass({ asset_band: d.assetBand });
      const internalNumber = await nextNumber(tx, "WQF");
      const status = d.registeredOn ? "registered" : d.documentedOn || d.deedNo ? "documented" : "documenting";
      const stage = d.registeredOn ? 3 : 2;
      const [w] = await tx
        .insert(waqfs)
        .values({
          internalNumber, name: d.name, deedNo: d.deedNo, deedDate: d.deedDate, deedDateHijri: d.deedDateHijri, documentedOn: d.documentedOn,
          registeredOn: d.registeredOn, nationalUnifiedNumber: d.nationalUnifiedNumber, legalType: d.legalType, nazirMode: d.nazirMode, sizeClass,
          fiscalYearEnd: d.fiscalYearEnd, collectsDonations: d.collectsDonations, hasForeignParty: d.hasForeignParty,
          hasBeneficiariesAbroad: d.hasBeneficiariesAbroad, hasActiveLitigation: d.hasActiveLitigation, status, stage,
          createdBy: auth.user.id, updatedBy: auth.user.id,
        })
        .returning({ id: waqfs.id });
      // A founder who is also the nazir holds both roles (as in the deed).
      const roles = d.myRole === "founder" && d.nazirMode === "founder" ? ["founder", "nazir"] : [d.myRole];
      await tx.insert(waqfMemberships).values(roles.map((roleKey) => ({ waqfId: w.id, userId: auth.user.id, roleKey, createdBy: auth.user.id })));
      await tx.insert(waqfKeys).values({ waqfId: w.id, wrappedKey: newDataKey().wrapped });
      const t = todayIso();
      const events: (typeof waqfTimelineEvents.$inferInsert)[] = [
        { waqfId: w.id, type: "platform_registered", occurredOn: t, title: "فتح ملف الوقف في منصة وقفك", details: `سجّله ${auth.user.fullName ?? "مستخدم"} بصفة ${roles.map(roleName).join(" و")}.`, stage, createdBy: auth.user.id },
      ];
      if (d.documentedOn || d.deedDate)
        events.push({ waqfId: w.id, type: "documented", occurredOn: (d.documentedOn ?? d.deedDate)!, title: "توثيق صك الوقف", details: d.deedNo ? `رقم الصك ${d.deedNo}` : null, stage: 2, createdBy: auth.user.id });
      if (d.registeredOn)
        events.push({ waqfId: w.id, type: "registered", occurredOn: d.registeredOn, title: "تسجيل الوقف لدى الهيئة العامة للأوقاف", details: d.nationalUnifiedNumber ? `الرقم الوطني الموحد ${d.nationalUnifiedNumber}` : null, stage: 2, createdBy: auth.user.id });
      await tx.insert(waqfTimelineEvents).values(events);
      await audit(tx, {
        actorUserId: auth.user.id, action: "waqf.register", entityType: "waqf", entityId: w.id, waqfId: w.id, ip, userAgent,
        after: { internalNumber, name: d.name, legalType: d.legalType, nazirMode: d.nazirMode, sizeClass, status, roles, fiscalYearEnd: d.fiscalYearEnd },
      });
      if (d.documentedOn) await emitWaqfEvent(tx, { waqfId: w.id, event: "documentation", date: d.documentedOn, actorUserId: auth.user.id });
      if (d.registeredOn) await emitWaqfEvent(tx, { waqfId: w.id, event: "registration", date: d.registeredOn, actorUserId: auth.user.id });
      await syncWaqfObligations(tx, w.id);
      return { ok: true, data: { id: w.id } };
    },
    { revalidate: ["/app", "/app/waqfs"] },
  );
  if (res.ok && typeof res.data?.id === "string") redirect(`/app/w/${res.data.id}`);
  return keep(res, fd);
}

// ───────────── Members ─────────────
const memberSchema = z.object({
  waqfId: z.uuid(),
  membershipId: z.uuid(),
  roleKey: z.enum(INVITABLE_ROLES, { error: "اختر دورًا." }),
  isIndependent: flag,
});

export async function changeMemberRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(memberSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(
    d.waqfId,
    "waqf.members.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const [m] = await tx.select().from(waqfMemberships).where(and(eq(waqfMemberships.id, d.membershipId), eq(waqfMemberships.waqfId, d.waqfId))).limit(1);
      if (!m) throw new UserError("لم نجد هذه العضوية في الوقف.");
      if (m.status !== "active") throw new UserError("العضوية منتهية؛ ادعُ الشخص من جديد بدلًا من تعديلها.");
      if (m.roleKey === "agent") throw new UserError("دور الوكيل يُدار من قسم الوكالات.");
      const before = { roleKey: m.roleKey, isIndependent: m.isIndependent };
      if (m.roleKey === d.roleKey) {
        if (m.isIndependent === d.isIndependent) return { ok: true, message: "لا تغيير." };
        await tx.update(waqfMemberships).set({ isIndependent: d.isIndependent, updatedBy: auth.user.id }).where(eq(waqfMemberships.id, m.id));
      } else {
        await assertNotLast(tx, d.waqfId, m, "تغيير هذا الدور");
        const [other] = await tx
          .select()
          .from(waqfMemberships)
          .where(and(eq(waqfMemberships.waqfId, d.waqfId), eq(waqfMemberships.userId, m.userId), eq(waqfMemberships.roleKey, d.roleKey)))
          .limit(1);
        if (other?.status === "active" && (!other.endsAt || other.endsAt > new Date())) throw new UserError(`لهذا العضو دور «${roleName(d.roleKey)}» قائم مسبقًا.`);
        if (other) {
          // reactivate the earlier record for that role and close the current one
          await tx.update(waqfMemberships).set({ status: "active", endsAt: null, startsAt: new Date(), isIndependent: d.isIndependent, updatedBy: auth.user.id }).where(eq(waqfMemberships.id, other.id));
          await tx.update(waqfMemberships).set({ status: "ended", endsAt: new Date(), updatedBy: auth.user.id }).where(eq(waqfMemberships.id, m.id));
        } else {
          await tx.update(waqfMemberships).set({ roleKey: d.roleKey, isIndependent: d.isIndependent, updatedBy: auth.user.id }).where(eq(waqfMemberships.id, m.id));
        }
      }
      await audit(tx, {
        actorUserId: auth.user.id, action: "waqf.member.role_changed", entityType: "waqf_membership", entityId: m.id, waqfId: d.waqfId, ip, userAgent,
        before, after: { roleKey: d.roleKey, isIndependent: d.isIndependent, userId: m.userId },
      });
      if (m.roleKey !== d.roleKey && (NAZARA_ROLES.includes(m.roleKey) || NAZARA_ROLES.includes(d.roleKey)))
        await emitWaqfEvent(tx, { waqfId: d.waqfId, event: "material_change", date: todayIso(), refId: m.id, meta: { kind: "nazara", from: m.roleKey, to: d.roleKey }, actorUserId: auth.user.id });
      return { ok: true, message: "حُفظ الدور." };
    },
    `/app/w/${d.waqfId}/settings`,
  );
}

export async function endMembership(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ waqfId: z.uuid(), membershipId: z.uuid() }), fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(
    d.waqfId,
    "waqf.members.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const [m] = await tx.select().from(waqfMemberships).where(and(eq(waqfMemberships.id, d.membershipId), eq(waqfMemberships.waqfId, d.waqfId))).limit(1);
      if (!m) throw new UserError("لم نجد هذه العضوية في الوقف.");
      if (m.status !== "active") throw new UserError("العضوية منتهية مسبقًا.");
      await assertNotLast(tx, d.waqfId, m, "إنهاء هذه العضوية");
      const now = new Date();
      await tx.update(waqfMemberships).set({ status: "ended", endsAt: now, updatedBy: auth.user.id }).where(eq(waqfMemberships.id, m.id));
      if (m.roleKey === "agent")
        await tx
          .update(delegations)
          .set({ status: "revoked", updatedBy: auth.user.id })
          .where(and(eq(delegations.waqfId, d.waqfId), eq(delegations.agentUserId, m.userId), eq(delegations.status, "active")));
      await audit(tx, {
        actorUserId: auth.user.id, action: "waqf.member.ended", entityType: "waqf_membership", entityId: m.id, waqfId: d.waqfId, ip, userAgent,
        before: { roleKey: m.roleKey, status: m.status, userId: m.userId }, after: { status: "ended", endsAt: now.toISOString() },
      });
      if (NAZARA_ROLES.includes(m.roleKey))
        await emitWaqfEvent(tx, { waqfId: d.waqfId, event: "material_change", date: todayIso(), refId: m.id, meta: { kind: "nazara", ended: m.roleKey }, actorUserId: auth.user.id });
      return { ok: true, message: "أُنهيت العضوية. احتفظنا بسجلها في سجل العمليات." };
    },
    `/app/w/${d.waqfId}/settings`,
  );
}

// ───────────── Invitations ─────────────
async function createInvitation(
  tx: Tx,
  o: { waqfId: string; waqfName: string; phone: string; roleKey: string; invitedBy: string; scope?: Record<string, unknown>; note?: string | null },
) {
  // A fresh invitation replaces any still-open one for the same phone and role.
  await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.waqfId, o.waqfId), eq(invitations.phone, o.phone), eq(invitations.roleKey, o.roleKey), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  const token = randomToken(24);
  const [inv] = await tx
    .insert(invitations)
    .values({
      waqfId: o.waqfId, phone: o.phone, roleKey: o.roleKey, tokenHash: sha256(token), invitedBy: o.invitedBy,
      expiresAt: new Date(Date.now() + 7 * 86_400_000), scope: o.scope ?? null, note: o.note ?? null,
    })
    .returning({ id: invitations.id });
  const link = `/app/invitations/${token}`;
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, o.phone)).limit(1);
  if (existing) {
    // waqfId stays null on purpose: the invitee cannot see this waqf's rows (RLS) until they accept.
    await notify(existing.id, "invitation", { waqf: o.waqfName, role: roleName(o.roleKey) }, { link, tx });
  } else {
    await sendSms(o.phone, `وقفك: دُعيت إلى «${o.waqfName}» بصفة ${roleName(o.roleKey)}. افتح الرابط وسجّل بهذا الرقم للقبول (صالح 7 أيام): ${env.APP_URL}${link}`);
  }
  return { id: inv.id, link, existingUser: !!existing };
}

const inviteSchema = z.object({
  waqfId: z.uuid(),
  phone: z.string().trim().min(9, "أدخل رقم الجوال."),
  roleKey: z.enum(INVITABLE_ROLES, { error: "اختر الدور." }),
  note: optText(300),
});

export async function inviteMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(inviteSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const phone = normalizeSaudiMobile(d.phone);
  if (!phone) return { error: "راجع الحقول المظللة.", fieldErrors: { phone: "أدخل رقم جوال سعودي صحيح يبدأ بـ 05." } };
  return waqfAction(
    d.waqfId,
    "waqf.members.manage",
    async ({ auth, access, tx, ip, userAgent }) => {
      const [already] = await tx
        .select({ id: waqfMemberships.id })
        .from(waqfMemberships)
        .innerJoin(users, eq(users.id, waqfMemberships.userId))
        .where(and(eq(waqfMemberships.waqfId, d.waqfId), eq(users.phone, phone), eq(waqfMemberships.roleKey, d.roleKey), activeNow()))
        .limit(1);
      if (already) throw new UserError(`صاحب هذا الرقم عضو في الوقف بدور «${roleName(d.roleKey)}» مسبقًا.`);
      const inv = await createInvitation(tx, { waqfId: d.waqfId, waqfName: access.waqf.name, phone, roleKey: d.roleKey, invitedBy: auth.user.id, note: d.note });
      await audit(tx, {
        actorUserId: auth.user.id, action: "waqf.invitation.created", entityType: "invitation", entityId: inv.id, waqfId: d.waqfId, ip, userAgent,
        after: { phone: maskPhone(phone), roleKey: d.roleKey, existingUser: inv.existingUser },
      });
      return {
        ok: true,
        message: inv.existingUser ? "أُرسلت الدعوة برسالة نصية وإشعار داخل المنصة." : "أُرسلت الدعوة برسالة نصية. صلاحية الرابط 7 أيام.",
        data: showOtpOnScreen ? { link: inv.link } : undefined,
      };
    },
    `/app/w/${d.waqfId}/settings`,
  );
}

export async function revokeInvitation(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ waqfId: z.uuid(), invitationId: z.uuid() }), fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(
    d.waqfId,
    "waqf.members.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const [inv] = await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.id, d.invitationId), eq(invitations.waqfId, d.waqfId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning({ id: invitations.id, roleKey: invitations.roleKey });
      if (!inv) throw new UserError("الدعوة مقبولة أو ملغاة مسبقًا.");
      await audit(tx, { actorUserId: auth.user.id, action: "waqf.invitation.revoked", entityType: "invitation", entityId: inv.id, waqfId: d.waqfId, ip, userAgent, after: { roleKey: inv.roleKey } });
      return { ok: true, message: "أُلغيت الدعوة، ولن يعمل رابطها." };
    },
    `/app/w/${d.waqfId}/settings`,
  );
}

// ───────────── Delegations (powers of attorney) ─────────────
const delegationSchema = z
  .object({
    waqfId: z.uuid(),
    phone: z.string().trim().min(9, "أدخل رقم جوال الوكيل."),
    validFrom: z.iso.date("أدخل تاريخ البداية."),
    validTo: z.iso.date("أدخل تاريخ النهاية."),
    poaNo: z.string().trim().min(3, "أدخل رقم الوكالة كما في صكها.").max(60),
    notes: optText(500),
  })
  .superRefine((d, ctx) => {
    if (d.validTo < d.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "تاريخ النهاية لا يسبق تاريخ البداية." });
    if (d.validTo < todayIso()) ctx.addIssue({ code: "custom", path: ["validTo"], message: "الوكالة منتهية في هذا التاريخ؛ أدخل تاريخًا لاحقًا." });
  });

export async function createDelegation(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(delegationSchema, fd);
  if ("state" in r) return keep(r.state, fd);
  const d = r.data;
  const scope = [...new Set(fd.getAll("perm").map(String))].filter((p) => AGENT_CEILING.includes(p));
  if (!scope.length) return keep({ error: "حدّد صلاحية واحدة على الأقل ضمن نطاق الوكالة.", fieldErrors: { perm: "اختر صلاحية واحدة على الأقل." } }, fd);
  if (!scope.includes("waqf.view")) scope.unshift("waqf.view"); // the agent must be able to open the file at all
  const phone = normalizeSaudiMobile(d.phone);
  if (!phone) return keep({ error: "راجع الحقول المظللة.", fieldErrors: { phone: "أدخل رقم جوال سعودي صحيح يبدأ بـ 05." } }, fd);
  const res = await waqfAction(
    d.waqfId,
    "waqf.members.manage",
    async ({ auth, access, tx, ip, userAgent }) => {
      const [agent] = await tx.select({ id: users.id, name: users.fullName }).from(users).where(eq(users.phone, phone)).limit(1);
      if (agent?.id === auth.user.id) throw new UserError("لا يمكنك توكيل نفسك.");
      const terms = { permissions: scope, validFrom: d.validFrom, validTo: d.validTo, poaNo: d.poaNo, notes: d.notes, principalName: auth.user.fullName };
      if (!agent) {
        const inv = await createInvitation(tx, { waqfId: d.waqfId, waqfName: access.waqf.name, phone, roleKey: "agent", invitedBy: auth.user.id, scope: terms, note: d.notes });
        await audit(tx, {
          actorUserId: auth.user.id, action: "waqf.delegation.invited", entityType: "invitation", entityId: inv.id, waqfId: d.waqfId, ip, userAgent,
          after: { phone: maskPhone(phone), ...terms },
        });
        return {
          ok: true,
          message: "صاحب الرقم ليس مسجّلًا بعد؛ أرسلنا إليه دعوة، وتبدأ الوكالة عند قبوله.",
          data: showOtpOnScreen ? { link: inv.link } : undefined,
        };
      }
      const delegationId = await activateDelegation(tx, { waqfId: d.waqfId, agentUserId: agent.id, principalUserId: auth.user.id, ...terms });
      await notify(agent.id, "invitation", { waqf: access.waqf.name, role: roleName("agent") }, { link: `/app/w/${d.waqfId}`, tx });
      await audit(tx, {
        actorUserId: auth.user.id, action: "waqf.delegation.created", entityType: "delegation", entityId: delegationId, waqfId: d.waqfId, ip, userAgent,
        after: { agentUserId: agent.id, ...terms },
      });
      return { ok: true, message: `سُجّلت الوكالة لـ${agent.name ?? "الوكيل"} وتعمل ضمن النطاق والمدة المحددين.` };
    },
    `/app/w/${d.waqfId}/settings`,
  );
  return keep(res, fd);
}

/** Creates an active delegation and the matching agent membership (used on creation and on invitation acceptance). */
async function activateDelegation(
  tx: Tx,
  o: { waqfId: string; agentUserId: string; principalUserId: string | null; principalName?: string | null; permissions: string[]; validFrom: string; validTo: string; poaNo: string },
) {
  const [dl] = await tx
    .insert(delegations)
    .values({
      waqfId: o.waqfId, agentUserId: o.agentUserId, principalUserId: o.principalUserId, principalName: o.principalName ?? null, powerOfAttorneyNo: o.poaNo,
      scope: o.permissions.filter((p) => AGENT_CEILING.includes(p)), validFrom: o.validFrom, validTo: o.validTo, status: "active",
      verifiedBy: o.principalUserId, verifiedAt: new Date(), createdBy: o.principalUserId,
    })
    .returning({ id: delegations.id });
  await tx
    .insert(waqfMemberships)
    .values({ waqfId: o.waqfId, userId: o.agentUserId, roleKey: "agent", invitedBy: o.principalUserId, createdBy: o.principalUserId })
    .onConflictDoUpdate({
      target: [waqfMemberships.waqfId, waqfMemberships.userId, waqfMemberships.roleKey],
      set: { status: "active", endsAt: null, startsAt: new Date(), updatedBy: o.principalUserId },
    });
  return dl.id;
}

export async function revokeDelegation(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(z.object({ waqfId: z.uuid(), delegationId: z.uuid() }), fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(
    d.waqfId,
    "waqf.members.manage",
    async ({ auth, tx, ip, userAgent }) => {
      const [dl] = await tx
        .update(delegations)
        .set({ status: "revoked", updatedBy: auth.user.id })
        .where(and(eq(delegations.id, d.delegationId), eq(delegations.waqfId, d.waqfId), eq(delegations.status, "active")))
        .returning();
      if (!dl) throw new UserError("الوكالة ملغاة أو منتهية مسبقًا.");
      const [others] = await tx
        .select({ n: count() })
        .from(delegations)
        .where(and(eq(delegations.waqfId, d.waqfId), eq(delegations.agentUserId, dl.agentUserId), eq(delegations.status, "active")));
      if (Number(others?.n ?? 0) === 0)
        await tx
          .update(waqfMemberships)
          .set({ status: "ended", endsAt: new Date(), updatedBy: auth.user.id })
          .where(and(eq(waqfMemberships.waqfId, d.waqfId), eq(waqfMemberships.userId, dl.agentUserId), eq(waqfMemberships.roleKey, "agent")));
      await audit(tx, {
        actorUserId: auth.user.id, action: "waqf.delegation.revoked", entityType: "delegation", entityId: dl.id, waqfId: d.waqfId, ip, userAgent,
        before: { status: "active", validTo: dl.validTo }, after: { status: "revoked" },
      });
      return { ok: true, message: "أُلغيت الوكالة، وأُغلق وصول الوكيل فورًا." };
    },
    `/app/w/${d.waqfId}/settings`,
  );
}

// ───────────── Waqf profile ─────────────
const nun = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/\s/g, "") : null))
  .refine((v) => v === null || /^7\d{9}$/.test(v), "الرقم الوطني الموحد من 10 أرقام ويبدأ بـ 7.");

const profileSchema = z
  .object({
    waqfId: z.uuid(),
    name: z.string().trim().min(5, "اكتب اسم الوقف كما في الصك.").max(200),
    deedNo: optText(60),
    deedDate: optDate,
    deedDateHijri: optText(40),
    documentedOn: optDate,
    registeredOn: optDate,
    registrationExpiresOn: optDate,
    nationalUnifiedNumber: nun,
    legalType: z.enum(["public", "private", "joint"], { error: "اختر نوع الوقف." }),
    nazirMode: z.enum(["founder", "individual", "board", "legal_entity", "gaa", "vacant"], { error: "اختر صيغة النظارة." }),
    fiscalYearEnd: fiscalEnd,
    assetBand: z.union([z.literal(""), ASSET_BAND]).optional().transform((v) => v || null),
    collectsDonations: flag,
    hasForeignParty: flag,
    hasBeneficiariesAbroad: flag,
    hasActiveLitigation: flag,
  })
  .superRefine((d, ctx) => {
    const t = todayIso();
    for (const k of ["deedDate", "documentedOn", "registeredOn"] as const)
      if (d[k] && d[k]! > t) ctx.addIssue({ code: "custom", path: [k], message: "التاريخ لا يكون في المستقبل." });
    if (d.documentedOn && d.registeredOn && d.registeredOn < d.documentedOn)
      ctx.addIssue({ code: "custom", path: ["registeredOn"], message: "تاريخ التسجيل لا يسبق تاريخ التوثيق." });
    if (d.registeredOn && !d.documentedOn && !d.deedNo)
      ctx.addIssue({ code: "custom", path: ["documentedOn"], message: "الوقف المسجّل لدى الهيئة يكون موثّقًا: أدخل تاريخ التوثيق أو رقم الصك." });
    if (d.registrationExpiresOn && d.registeredOn && d.registrationExpiresOn <= d.registeredOn)
      ctx.addIssue({ code: "custom", path: ["registrationExpiresOn"], message: "تاريخ الانتهاء يلي تاريخ التسجيل." });
  });

const PRE_REGISTERED = ["idea", "draft", "documenting", "documented"];


/**
 * Edits the waqf core profile (identity, deed, classification and the flags that drive obligations).
 * Date changes emit regulatory events; every save re-syncs standing obligations.
 */
export async function updateWaqfProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(profileSchema, fd);
  if ("state" in r) return keep(r.state, fd);
  const d = r.data;
  const res = await waqfAction(
    d.waqfId,
    "waqf.edit",
    async ({ auth, access, tx, ip, userAgent }) => {
      const w = access.waqf;
      let sizeClass = w.sizeClass;
      if (d.assetBand && !w.sizeClassLocked) sizeClass = deriveSizeClass({ asset_band: d.assetBand, direct_benefit: w.directBenefit ? "yes" : "no" });
      // Status only moves forward from the pre-registration states; later states (active, suspended…) are not touched here.
      let status = w.status;
      // An entered number or date is the owner's statement; the status moves only with the instrument in the vault
      // (صك الوقف for documented, شهادة التسجيل for registered). Without it the file stays «قيد التوثيق».
      let evidenceNote = "";
      if (PRE_REGISTERED.includes(w.status)) {
        const ev = await evidenceDocs(tx, w.id);
        if (d.registeredOn && ev.registration && ev.deed) status = "registered";
        else if ((d.documentedOn || d.deedNo || d.registeredOn) && ev.deed) status = "documented";
        else if (d.documentedOn || d.deedNo || d.registeredOn) status = "documenting";
        if ((d.documentedOn || d.deedNo) && !ev.deed) evidenceNote = " لا يُعد الوقف موثقًا حتى يُرفع صك الوقف في الوثائق.";
        else if (d.registeredOn && !ev.registration) evidenceNote = " لا يُعد الوقف مسجلًا حتى تُرفع شهادة التسجيل في الوثائق.";
      }
      const stage = w.stage; // the stage follows the records (re-evaluated after the save)
      const before = {
        name: w.name, deedNo: w.deedNo, deedDate: w.deedDate, deedDateHijri: w.deedDateHijri, documentedOn: w.documentedOn, registeredOn: w.registeredOn,
        registrationExpiresOn: w.registrationExpiresOn, nationalUnifiedNumber: w.nationalUnifiedNumber, legalType: w.legalType, nazirMode: w.nazirMode,
        fiscalYearEnd: w.fiscalYearEnd, sizeClass: w.sizeClass, collectsDonations: w.collectsDonations, hasForeignParty: w.hasForeignParty,
        hasBeneficiariesAbroad: w.hasBeneficiariesAbroad, hasActiveLitigation: w.hasActiveLitigation, status: w.status, stage: w.stage,
      };
      const after: typeof before = {
        name: d.name, deedNo: d.deedNo, deedDate: d.deedDate, deedDateHijri: d.deedDateHijri, documentedOn: d.documentedOn, registeredOn: d.registeredOn,
        registrationExpiresOn: d.registrationExpiresOn, nationalUnifiedNumber: d.nationalUnifiedNumber, legalType: d.legalType, nazirMode: d.nazirMode,
        fiscalYearEnd: d.fiscalYearEnd, sizeClass, collectsDonations: d.collectsDonations, hasForeignParty: d.hasForeignParty,
        hasBeneficiariesAbroad: d.hasBeneficiariesAbroad, hasActiveLitigation: d.hasActiveLitigation, status, stage,
      };
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
      if (!changed.length) return { ok: true, message: "لا تغيير على ملف الوقف." };
      await tx.update(waqfs).set({ ...after, updatedBy: auth.user.id }).where(eq(waqfs.id, w.id));
      await audit(tx, {
        actorUserId: auth.user.id, action: "waqf.profile_updated", entityType: "waqf", entityId: w.id, waqfId: w.id, ip, userAgent,
        before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
      const t = todayIso();
      const timeline: (typeof waqfTimelineEvents.$inferInsert)[] = [];
      if (changed.includes("documentedOn") && d.documentedOn) {
        timeline.push({ waqfId: w.id, type: "documented", occurredOn: d.documentedOn, title: status === "documenting" ? "تسجيل بيانات صك الوقف (بانتظار رفع الصك)" : "توثيق صك الوقف", details: d.deedNo ? `رقم الصك ${d.deedNo}` : null, stage: 2, createdBy: auth.user.id });
        await emitWaqfEvent(tx, { waqfId: w.id, event: "documentation", date: d.documentedOn, actorUserId: auth.user.id });
      }
      if (changed.includes("registeredOn") && d.registeredOn) {
        timeline.push({ waqfId: w.id, type: "registered", occurredOn: d.registeredOn, title: status === "registered" || !PRE_REGISTERED.includes(w.status) ? "تسجيل الوقف لدى الهيئة العامة للأوقاف" : "تسجيل تاريخ التسجيل لدى الهيئة (بانتظار رفع الشهادة)", details: d.nationalUnifiedNumber ? `الرقم الوطني الموحد ${d.nationalUnifiedNumber}` : null, stage: 2, createdBy: auth.user.id });
        await emitWaqfEvent(tx, { waqfId: w.id, event: "registration", date: d.registeredOn, actorUserId: auth.user.id });
      }
      if (changed.includes("registrationExpiresOn") && d.registrationExpiresOn)
        await emitWaqfEvent(tx, { waqfId: w.id, event: "cert_expiry", date: d.registrationExpiresOn, actorUserId: auth.user.id });
      if (changed.includes("sizeClass"))
        await emitWaqfEvent(tx, { waqfId: w.id, event: "material_change", date: t, meta: { kind: "assets", from: before.sizeClass, to: sizeClass }, actorUserId: auth.user.id });
      if (changed.includes("nazirMode")) {
        timeline.push({ waqfId: w.id, type: "nazara_changed", occurredOn: t, title: "تغيير صيغة النظارة", details: null, stage: w.stage, createdBy: auth.user.id });
        await emitWaqfEvent(tx, { waqfId: w.id, event: "material_change", date: t, meta: { kind: "nazara", from: before.nazirMode, to: d.nazirMode }, actorUserId: auth.user.id });
      }
      if (timeline.length) await tx.insert(waqfTimelineEvents).values(timeline);
      await syncWaqfObligations(tx, w.id);
      const lockedNote = d.assetBand && w.sizeClassLocked ? " فئة الحجم مثبّتة من الإدارة فلم تتغير." : "";
      return { ok: true, message: `حُفظ ملف الوقف وأُعيد حساب الالتزامات.${lockedNote}${evidenceNote}`, data: { saved: true, evidence: evidenceNote ? (evidenceNote.includes("صك") ? "deed" : "reg") : "" } };
    },
    [`/app/w/${d.waqfId}`, `/app/w/${d.waqfId}/settings`, "/app", "/app/waqfs"],
  );
  if (res.ok && res.data?.saved) redirect(`/app/w/${d.waqfId}?saved=1${res.data.evidence ? `&evidence=${res.data.evidence}` : ""}`);
  return keep(res, fd);
}

// ───────────── Accept / decline an invitation (token-authorized) ─────────────
/**
 * The invitee has no access to the waqf before accepting, so RLS would hide the invitation and refuse the membership
 * insert. Authorization here is the secret token plus a verified session on the invited phone; the system context is
 * used only for these two narrow writes.
 */
async function loadInvitationForMe(token: string) {
  const auth = await requireAuth({ next: `/app/invitations/${token}` });
  const [inv] = await withSystem((tx) => tx.select().from(invitations).where(eq(invitations.tokenHash, sha256(token))).limit(1));
  if (!inv) throw new UserError("رابط الدعوة غير صحيح.");
  if (inv.acceptedAt) throw new UserError("استُخدمت هذه الدعوة مسبقًا.");
  if (inv.revokedAt) throw new UserError("أُلغيت هذه الدعوة. اطلب من ناظر الوقف دعوة جديدة.");
  if (inv.expiresAt < new Date()) throw new UserError("انتهت صلاحية الدعوة. اطلب من ناظر الوقف دعوة جديدة.");
  if (inv.phone !== auth.user.phone) throw new UserError("الدعوة مرسلة إلى رقم جوال آخر. سجّل الدخول بالرقم الذي وصلته الرسالة.");
  return { auth, inv };
}

export async function acceptInvitation(_: ActionState, fd: FormData): Promise<ActionState> {
  const token = String(fd.get("token") ?? "");
  let dest = "/app";
  try {
    const { auth, inv } = await loadInvitationForMe(token);
    const { ip, userAgent } = await requestInfo();
    await withSystem(async (tx) => {
      const [locked] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedBy: auth.user.id })
        .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning({ id: invitations.id });
      if (!locked) throw new UserError("استُخدمت هذه الدعوة مسبقًا.");
      if (inv.roleKey === "agent") {
        const s = (inv.scope ?? {}) as { permissions?: string[]; validFrom?: string; validTo?: string; poaNo?: string; principalName?: string };
        if (!s.validTo || s.validTo < todayIso()) throw new UserError("انتهت مدة الوكالة المرفقة بهذه الدعوة. اطلب من الناظر تحديثها.");
        await activateDelegation(tx, {
          waqfId: inv.waqfId, agentUserId: auth.user.id, principalUserId: inv.invitedBy, principalName: s.principalName ?? null,
          permissions: s.permissions ?? ["waqf.view"], validFrom: s.validFrom ?? todayIso(), validTo: s.validTo, poaNo: s.poaNo ?? "",
        });
      } else {
        await tx
          .insert(waqfMemberships)
          .values({ waqfId: inv.waqfId, userId: auth.user.id, roleKey: inv.roleKey, invitedBy: inv.invitedBy, createdBy: auth.user.id })
          .onConflictDoUpdate({
            target: [waqfMemberships.waqfId, waqfMemberships.userId, waqfMemberships.roleKey],
            set: { status: "active", endsAt: null, startsAt: new Date(), invitedBy: inv.invitedBy, updatedBy: auth.user.id },
          });
      }
      await audit(tx, {
        actorUserId: auth.user.id, action: "waqf.invitation.accepted", entityType: "invitation", entityId: inv.id, waqfId: inv.waqfId, ip, userAgent,
        after: { roleKey: inv.roleKey, userId: auth.user.id },
      });
    });
    dest = inv.roleKey === "beneficiary" ? `/app/b/${inv.waqfId}` : `/app/w/${inv.waqfId}`;
  } catch (e) {
    return toState(e);
  }
  redirect(dest);
}

export async function declineInvitation(_: ActionState, fd: FormData): Promise<ActionState> {
  const token = String(fd.get("token") ?? "");
  try {
    const { auth, inv } = await loadInvitationForMe(token);
    const { ip, userAgent } = await requestInfo();
    await withSystem(async (tx) => {
      await tx
        .update(invitations)
        .set({ revokedAt: new Date(), scope: { ...(inv.scope ?? {}), declinedAt: new Date().toISOString(), declinedBy: auth.user.id } })
        .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
      await audit(tx, { actorUserId: auth.user.id, action: "waqf.invitation.declined", entityType: "invitation", entityId: inv.id, waqfId: inv.waqfId, ip, userAgent, after: { roleKey: inv.roleKey } });
    });
  } catch (e) {
    return toState(e);
  }
  redirect("/app");
}
