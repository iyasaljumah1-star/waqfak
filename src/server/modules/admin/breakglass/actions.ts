"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSystem } from "@/server/db";
import { breakGlassAccess, roles, userRoles, users, waqfMemberships, waqfs } from "@/server/db/schema";
import { requireAuth, rolePermissionMap } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { parseForm, toState, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { assertStaff, notifyIfTemplate, staffAction } from "../guard";
import { revalidatePath } from "next/cache";

const PATH = "/admin/users/break-glass";

/** The admin layout shows a standing banner while grants are active, so every decision refreshes the whole admin tree. */
function done(r: ActionState) {
  if (r.ok) revalidatePath("/admin", "layout");
  return r;
}

const requestSchema = z.object({
  waqfNumber: z.string().trim().min(3, "أدخل الرقم الداخلي للوقف (مثل WQF-000001)."),
  reason: z.string().trim().min(20, "اشرح سبب الوصول الطارئ في 20 حرفًا على الأقل.").max(1000),
});

/**
 * Any staff member may ask for emergency, time-limited access to a waqf they are not assigned to.
 * The waqf is invisible to the requester under RLS, so this single insert runs in system context: it resolves the waqf
 * by its exact internal number, writes the request and its audit entry, and returns nothing about the waqf.
 */
export async function requestBreakGlass(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(requestSchema, fd);
  if ("state" in r) return r.state;
  try {
    const auth = await requireAuth();
    assertStaff(auth);
    if (!auth.perms.has("admin.access")) throw new UserError("ليست لديك صلاحية لهذا الإجراء.");
    if (auth.globalAccess) throw new UserError("دورك يتيح الاطلاع على كل الأوقاف؛ لا تحتاج وصولًا طارئًا.");
    const { ip, userAgent } = await requestInfo();
    const number = r.data.waqfNumber.toUpperCase();
    const approverRoles = [...(await rolePermissionMap()).entries()].filter(([, ps]) => ps.has("breakglass.approve")).map(([k]) => k);
    const res = await withSystem(async (tx) => {
      const [w] = await tx.select({ id: waqfs.id }).from(waqfs).where(eq(waqfs.internalNumber, number)).limit(1);
      if (!w) throw new UserError("لا يوجد وقف بهذا الرقم. تحقق من الرقم الداخلي كما يظهر في الطلب أو المراسلة.");
      const dup = await tx
        .select({ id: breakGlassAccess.id })
        .from(breakGlassAccess)
        .where(and(eq(breakGlassAccess.userId, auth.user.id), eq(breakGlassAccess.waqfId, w.id), eq(breakGlassAccess.status, "requested")))
        .limit(1);
      if (dup.length) throw new UserError("لديك طلب قائم على هذا الوقف بانتظار الاعتماد.");
      const [row] = await tx.insert(breakGlassAccess).values({ userId: auth.user.id, waqfId: w.id, reason: r.data.reason }).returning({ id: breakGlassAccess.id });
      await audit(tx, {
        actorUserId: auth.user.id, action: "breakglass.requested", entityType: "break_glass_access", entityId: row.id, waqfId: w.id, ip, userAgent,
        after: { reason: r.data.reason },
      });
      const approvers = approverRoles.length
        ? await tx
            .selectDistinct({ id: users.id })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .innerJoin(users, eq(users.id, userRoles.userId))
            .where(and(inArray(roles.key, approverRoles), eq(users.status, "active")))
        : [];
      for (const a of approvers)
        if (a.id !== auth.user.id) await notifyIfTemplate(tx, a.id, "breakglass.requested", { name: auth.user.fullName ?? "", waqf: number }, { link: PATH });
      return { ok: true, message: "أُرسل الطلب. يصلك إشعار عند اعتماده، ويبدأ الوصول من لحظة الاعتماد." } satisfies ActionState;
    });
    revalidatePath("/admin", "layout");
    return res;
  } catch (e) {
    return toState(e);
  }
}

const decideSchema = z.object({
  id: z.string().uuid(),
  hours: z.coerce.number().int().refine((h) => [1, 4, 8, 24].includes(h), "اختر مدة من القائمة.").optional(),
  note: z.string().trim().max(500).optional(),
});

export async function approveBreakGlass(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(decideSchema, fd);
  if ("state" in r) return r.state;
  const hours = r.data.hours ?? 4;
  return staffAction("breakglass.approve", async ({ auth, tx, ip, userAgent }) => {
    const [g] = await tx.select().from(breakGlassAccess).where(eq(breakGlassAccess.id, r.data.id)).limit(1).for("update");
    if (!g) throw new UserError("الطلب غير موجود.");
    if (g.status !== "requested") throw new UserError("بُتّ في هذا الطلب مسبقًا.");
    if (g.userId === auth.user.id) throw new UserError("لا يعتمد الشخص طلب وصوله الطارئ بنفسه. يعتمده مسؤول آخر.");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 3_600_000);
    await tx.update(breakGlassAccess).set({ status: "approved", approvedBy: auth.user.id, approvedAt: now, expiresAt }).where(eq(breakGlassAccess.id, g.id));
    await audit(tx, {
      actorUserId: auth.user.id, action: "breakglass.approved", entityType: "break_glass_access", entityId: g.id, waqfId: g.waqfId, ip, userAgent,
      before: { status: g.status }, after: { status: "approved", grantee: g.userId, hours, expiresAt: expiresAt.toISOString(), note: r.data.note ?? null },
    });
    const [w] = await tx.select({ number: waqfs.internalNumber, name: waqfs.name }).from(waqfs).where(eq(waqfs.id, g.waqfId)).limit(1);
    await notifyIfTemplate(tx, g.userId, "breakglass.approved", { waqf: w?.number ?? "", hours }, { link: `/admin/waqfs/${g.waqfId}` });
    // Transparency: the waqf's nazirs are told that emergency access was opened on their file.
    const nazirs = await tx
      .select({ userId: waqfMemberships.userId })
      .from(waqfMemberships)
      .where(and(eq(waqfMemberships.waqfId, g.waqfId), inArray(waqfMemberships.roleKey, ["nazir", "board_chair"]), eq(waqfMemberships.status, "active")));
    for (const n of nazirs) await notifyIfTemplate(tx, n.userId, "breakglass.waqf_notice", { waqf: w?.name ?? "", hours }, { waqfId: g.waqfId, link: `/app/w/${g.waqfId}/audit` });
    return { ok: true, message: `اعتُمد الوصول الطارئ لمدة ${hours} ساعة.` };
  }, PATH).then(done);
}

export async function rejectBreakGlass(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(decideSchema, fd);
  if ("state" in r) return r.state;
  if (!r.data.note || r.data.note.length < 5) return { error: "راجع الحقول المظللة.", fieldErrors: { note: "اذكر سبب الرفض." } };
  return staffAction("breakglass.approve", async ({ auth, tx, ip, userAgent }) => {
    const [g] = await tx.select().from(breakGlassAccess).where(eq(breakGlassAccess.id, r.data.id)).limit(1).for("update");
    if (!g) throw new UserError("الطلب غير موجود.");
    if (g.status !== "requested") throw new UserError("بُتّ في هذا الطلب مسبقًا.");
    await tx.update(breakGlassAccess).set({ status: "rejected", approvedBy: auth.user.id, approvedAt: new Date() }).where(eq(breakGlassAccess.id, g.id));
    await audit(tx, {
      actorUserId: auth.user.id, action: "breakglass.rejected", entityType: "break_glass_access", entityId: g.id, waqfId: g.waqfId, ip, userAgent,
      before: { status: g.status }, after: { status: "rejected", note: r.data.note },
    });
    return { ok: true, message: "رُفض الطلب." };
  }, PATH).then(done);
}

export async function revokeBreakGlass(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(decideSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("breakglass.approve", async ({ auth, tx, ip, userAgent }) => {
    const [g] = await tx.select().from(breakGlassAccess).where(eq(breakGlassAccess.id, r.data.id)).limit(1).for("update");
    if (!g) throw new UserError("الطلب غير موجود.");
    if (g.status !== "approved" || !g.expiresAt || g.expiresAt <= new Date()) throw new UserError("هذا الوصول غير نشط.");
    await tx.update(breakGlassAccess).set({ status: "revoked", expiresAt: new Date() }).where(eq(breakGlassAccess.id, g.id));
    await audit(tx, {
      actorUserId: auth.user.id, action: "breakglass.revoked", entityType: "break_glass_access", entityId: g.id, waqfId: g.waqfId, ip, userAgent,
      before: { status: g.status, expiresAt: g.expiresAt }, after: { status: "revoked", note: r.data.note ?? null },
    });
    return { ok: true, message: "أُنهي الوصول الطارئ فورًا." };
  }, PATH).then(done);
}
