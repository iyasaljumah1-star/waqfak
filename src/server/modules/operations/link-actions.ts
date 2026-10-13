"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requestLinks, serviceRequests, waqfKeys, waqfMemberships, waqfs, waqfTimelineEvents } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { newDataKey } from "@/server/lib/crypto";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { logEvent } from "@/server/modules/requests/engine";
import { intakeOf } from "@/server/modules/requests/intake/server";
import { syncWaqfObligations } from "@/server/modules/compliance/events";
import type { ActionState } from "@/lib/utils";
import { linkRequest } from "./links";

/**
 * Linking a request that was sent «with no waqf yet» to the waqf it concerns, without duplicates:
 *  - link to a waqf the requester already holds (active membership) — never to a waqf they have no role in;
 *  - or open the waqf file from the request (once: a second attempt finds the link and stops).
 * The request keeps its identity and history; the waqf shows the request as its origin.
 */

const uuid = z.string().uuid("قيمة غير صالحة.");
const reval = (id: string) => [`/admin/requests/${id}`, `/app/requests/${id}`, "/admin/waqfs", "/app/waqfs"];

/** Role the requester takes in a waqf opened from their request, by the capacity they declared. */
const ROLE_BY_CAPACITY: Record<string, string> = { waqif: "founder", nazir: "nazir" };

const linkSchema = z.object({ id: uuid, waqfId: uuid });

export async function linkRequestToWaqf(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(linkSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isOps && !rc.isAssignee) throw new ForbiddenError();
    if (rc.req.waqfId) throw new UserError("الطلب مرتبط بوقف مسبقًا.");
    const [m] = await c.tx.select({ role: waqfMemberships.roleKey }).from(waqfMemberships)
      .where(and(eq(waqfMemberships.waqfId, d.waqfId), eq(waqfMemberships.userId, rc.req.requesterUserId), eq(waqfMemberships.status, "active"))).limit(1);
    if (!m || m.role === "beneficiary") throw new UserError("لا يُربط الطلب إلا بوقف يملك فيه مقدّم الطلب صفة قائمة (واقف أو ناظر أو عضو).");
    const [w] = await c.tx.select({ id: waqfs.id, name: waqfs.name }).from(waqfs).where(eq(waqfs.id, d.waqfId)).limit(1);
    if (!w) throw new UserError("الوقف غير موجود.");
    await c.tx.update(serviceRequests).set({ waqfId: w.id, updatedBy: c.auth.user.id }).where(and(eq(serviceRequests.id, d.id), isNull(serviceRequests.waqfId)));
    await linkRequest(c.tx, { requestId: d.id, waqfId: w.id, entityType: "waqf", entityId: w.id, relation: "related", actorId: c.auth.user.id, note: "رُبط بوقف قائم لمقدّم الطلب" });
    await logEvent(c.tx, { id: d.id, waqfId: w.id }, c.auth.user.id, `رُبط الطلب بالوقف «${w.name}»`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.link_waqf", entityType: "service_request", entityId: d.id, waqfId: w.id, ip: c.ip, userAgent: c.userAgent, before: { waqfId: null }, after: { waqfId: w.id } });
    return { ok: true, message: `رُبط الطلب بالوقف «${w.name}».` };
  }, { revalidate: reval(d.id) });
}

const createSchema = z.object({ id: uuid, name: z.string().trim().min(3, "اكتب اسم الوقف كما سيُوثق.").max(200) });

export async function createWaqfFromRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(createSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return userAction(async (c) => {
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isOps && !rc.isAssignee) throw new ForbiddenError();
    // idempotent: a waqf already opened from this request is reused, never duplicated
    const [origin] = await c.tx.select({ id: requestLinks.entityId }).from(requestLinks).where(and(eq(requestLinks.requestId, d.id), eq(requestLinks.entityType, "waqf"), eq(requestLinks.relation, "origin"))).limit(1);
    if (origin || rc.req.waqfId) throw new UserError("الطلب مرتبط بملف وقف مسبقًا.");
    const capacity = String(intakeOf(rc.req).answers?.capacity ?? "");
    const role = ROLE_BY_CAPACITY[capacity];
    if (!role) throw new UserError("يُفتح ملف الوقف من الطلب حين يكون مقدّمه الواقف أو الناظر. للوكيل أو ممثل الجهة: يفتح صاحب الشأن ملف الوقف من حسابه ثم يُربط به الطلب.");
    const internalNumber = await nextNumber(c.tx, "WQF");
    const establishing = ["T", "W"].includes(rc.service.code[0]);
    const [w] = await c.tx.insert(waqfs).values({
      internalNumber, name: d.name, status: establishing ? "idea" : "documenting", stage: establishing ? 1 : 2, creationMode: rc.service.code === "W05" ? "bequest" : undefined,
      createdBy: c.auth.user.id, updatedBy: c.auth.user.id,
    }).returning({ id: waqfs.id });
    await c.tx.insert(waqfMemberships).values({ waqfId: w.id, userId: rc.req.requesterUserId, roleKey: role, invitedBy: c.auth.user.id, createdBy: c.auth.user.id });
    await c.tx.insert(waqfKeys).values({ waqfId: w.id, wrappedKey: newDataKey().wrapped });
    await c.tx.insert(waqfTimelineEvents).values({ waqfId: w.id, type: "platform_registered", occurredOn: new Date().toISOString().slice(0, 10), title: "فتح ملف الوقف في منصة وقفك", details: `من طلب الخدمة ${rc.req.number} (${rc.service.nameAr})`, stage: establishing ? 1 : 2, createdBy: c.auth.user.id });
    await c.tx.update(serviceRequests).set({ waqfId: w.id, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, d.id));
    await linkRequest(c.tx, { requestId: d.id, waqfId: w.id, entityType: "waqf", entityId: w.id, relation: "origin", actorId: c.auth.user.id, note: "فُتح ملف الوقف من الطلب" });
    await syncWaqfObligations(c.tx, w.id);
    await logEvent(c.tx, { id: d.id, waqfId: w.id }, c.auth.user.id, `فُتح ملف الوقف «${d.name}» (${internalNumber}) من هذا الطلب`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "waqf.created_from_request", entityType: "waqf", entityId: w.id, waqfId: w.id, ip: c.ip, userAgent: c.userAgent, after: { request: rc.req.number, internalNumber, role } });
    return { ok: true, message: `فُتح ملف الوقف «${d.name}» وارتبط بالطلب.` };
  }, { revalidate: reval(d.id) });
}
