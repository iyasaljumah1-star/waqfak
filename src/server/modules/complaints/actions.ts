"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { beneficiaries, complaints, holidays, settings, waqfMemberships } from "@/server/db/schema";
import { rolePermissionMap } from "@/server/authz/context";
import { audit, nextNumber } from "@/server/lib/audit";
import { todayISO } from "@/server/engines/dates";
import { notify } from "@/server/modules/notify";
import { parseForm, UserError, waqfAction } from "@/server/modules/_shared";
import type { Tx } from "@/server/db";
import { fmtBoth, type ActionState } from "@/lib/utils";
import { COMPLAINT_KIND_AR, COMPLAINT_KINDS, DEFAULT_SLA_DAYS, slaDueDate, slaDueTimestamp } from "./pure";

const uuid = z.string().uuid("قيمة غير صالحة.");
const paths = (waqfId: string) => [`/app/w/${waqfId}/complaints`, `/app/b/${waqfId}`];

async function slaDays(tx: Tx) {
  const [s] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, "complaints.sla_days")).limit(1);
  const n = Number(s?.v);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SLA_DAYS;
}

/** Users holding complaints.handle in this waqf (through their waqf roles). */
async function handlers(tx: Tx, waqfId: string) {
  const map = await rolePermissionMap();
  const mems = await tx.select({ userId: waqfMemberships.userId, role: waqfMemberships.roleKey, endsAt: waqfMemberships.endsAt })
    .from(waqfMemberships).where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.status, "active")));
  const now = new Date();
  return [...new Set(mems.filter((m) => (!m.endsAt || m.endsAt > now) && map.get(m.role)?.has("complaints.handle")).map((m) => m.userId))];
}

const submitSchema = z.object({
  kind: z.enum(COMPLAINT_KINDS, { message: "اختر نوع الطلب." }),
  subject: z.string().trim().min(4, "اكتب موضوعًا واضحًا (4 أحرف على الأقل).").max(200, "الموضوع أطول من 200 حرف."),
  body: z.string().trim().min(10, "صف طلبك بتفصيل كافٍ (10 أحرف على الأقل).").max(5000, "النص أطول من 5000 حرف."),
});

export async function submitComplaint(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  if (!uuid.safeParse(waqfId).success) return { error: "طلب غير صالح. أعد تحميل الصفحة." };
  const r = parseForm(submitSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(waqfId, "complaints.create", async (c) => {
    const [ben] = await c.tx.select({ id: beneficiaries.id }).from(beneficiaries)
      .where(and(eq(beneficiaries.waqfId, waqfId), eq(beneficiaries.userId, c.auth.user.id), isNull(beneficiaries.archivedAt))).limit(1);
    const hol = new Set((await c.tx.select({ d: holidays.day }).from(holidays)).map((h) => h.d));
    const days = await slaDays(c.tx);
    const due = slaDueDate(todayISO(), days, hol);
    const number = await nextNumber(c.tx, "CMP");
    const [row] = await c.tx.insert(complaints).values({
      waqfId, number, raisedByUserId: c.auth.user.id, beneficiaryId: ben?.id ?? null, kind: d.kind, subject: d.subject, body: d.body,
      slaDueAt: slaDueTimestamp(due), createdBy: c.auth.user.id,
    }).returning({ id: complaints.id });
    for (const u of await handlers(c.tx, waqfId)) {
      await notify(u, "complaint.new", { subject: `${COMPLAINT_KIND_AR[d.kind]} ${number}: ${d.subject}`, due: fmtBoth(due) }, { waqfId, link: `/app/w/${waqfId}/complaints#${number}`, tx: c.tx });
    }
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "complaints.create", entityType: "complaint", entityId: row.id, waqfId, ip: c.ip, userAgent: c.userAgent, after: { number, kind: d.kind, subject: d.subject, slaDue: due, slaDays: days } });
    return { ok: true, message: `استلمنا ${COMPLAINT_KIND_AR[d.kind]} برقم ${number}. يلتزم ناظر الوقف بالرد قبل ${fmtBoth(due)}.`, data: { number } };
  }, paths(waqfId));
}

const respondSchema = z.object({
  complaintId: uuid,
  response: z.string().trim().min(10, "اكتب ردًا واضحًا (10 أحرف على الأقل).").max(5000),
  close: z.string().optional(),
});

export async function respondComplaint(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  if (!uuid.safeParse(waqfId).success) return { error: "طلب غير صالح." };
  const r = parseForm(respondSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  return waqfAction(waqfId, "complaints.handle", async (c) => {
    const [row] = await c.tx.select().from(complaints).where(and(eq(complaints.id, d.complaintId), eq(complaints.waqfId, waqfId))).limit(1);
    if (!row) throw new UserError("الطلب غير موجود.");
    if (row.status === "closed") throw new UserError("الطلب مغلق.");
    const now = new Date();
    const status = d.close === "on" ? "closed" : "answered";
    await c.tx.update(complaints).set({ response: d.response, respondedAt: now, respondedBy: c.auth.user.id, status, updatedBy: c.auth.user.id }).where(eq(complaints.id, row.id));
    await notify(row.raisedByUserId, "complaint.answered", { subject: `${row.number}: ${row.subject}` }, { waqfId, link: `/app/b/${waqfId}#submissions`, tx: c.tx });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "complaints.respond", entityType: "complaint", entityId: row.id, waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: row.status, response: row.response }, after: { status, withinSla: now <= row.slaDueAt } });
    return { ok: true, message: `أُرسل الرد على ${row.number} وأُشعر مقدّم الطلب.${now > row.slaDueAt ? " تجاوز الرد المهلة المحددة؛ وثّق سبب التأخير." : ""}` };
  }, paths(waqfId));
}

const statusSchema = z.object({ complaintId: uuid, status: z.enum(["in_progress", "closed", "open"]) });

export async function setComplaintStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const waqfId = String(fd.get("waqfId") ?? "");
  if (!uuid.safeParse(waqfId).success) return { error: "طلب غير صالح." };
  const r = parseForm(statusSchema, fd);
  if ("state" in r) return r.state;
  return waqfAction(waqfId, "complaints.handle", async (c) => {
    const [row] = await c.tx.select().from(complaints).where(and(eq(complaints.id, r.data.complaintId), eq(complaints.waqfId, waqfId))).limit(1);
    if (!row) throw new UserError("الطلب غير موجود.");
    if (r.data.status === "closed" && !row.response) throw new UserError("ردّ على الطلب قبل إغلاقه؛ فكل طلب يُغلق برد موثق.");
    if (row.status === "closed" && r.data.status !== "open") throw new UserError("الطلب مغلق.");
    await c.tx.update(complaints).set({ status: r.data.status, updatedBy: c.auth.user.id }).where(eq(complaints.id, row.id));
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "complaints.status", entityType: "complaint", entityId: row.id, waqfId, ip: c.ip, userAgent: c.userAgent, before: { status: row.status }, after: { status: r.data.status } });
    return { ok: true, message: r.data.status === "closed" ? `أُغلق ${row.number}.` : r.data.status === "open" ? `أُعيد فتح ${row.number}.` : `${row.number} قيد المعالجة الآن.` };
  }, paths(waqfId));
}
