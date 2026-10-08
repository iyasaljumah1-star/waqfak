"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { contactMessages, users } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { parseForm, UserError } from "@/server/modules/_shared";
import type { ActionState } from "@/lib/utils";
import { staffAction } from "../guard";

const PATH = "/admin/clients/messages";

const assignSchema = z.object({ id: z.string().uuid(), assignee: z.union([z.literal(""), z.string().uuid()]) });

export async function assignContactMessage(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(assignSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("admin.users", async ({ auth, tx, ip, userAgent }) => {
    const [m] = await tx.select().from(contactMessages).where(eq(contactMessages.id, r.data.id)).limit(1);
    if (!m) throw new UserError("الرسالة غير موجودة.");
    const assignee = r.data.assignee || auth.user.id;
    const [s] = await tx.select({ id: users.id, name: users.fullName }).from(users).where(and(eq(users.id, assignee), eq(users.isStaff, true), eq(users.status, "active"))).limit(1);
    if (!s) throw new UserError("اختر موظفًا نشطًا.");
    await tx.update(contactMessages).set({ handledBy: s.id, status: m.status === "handled" ? "handled" : "in_progress" }).where(eq(contactMessages.id, m.id));
    await audit(tx, { actorUserId: auth.user.id, action: "admin.contact.assigned", entityType: "contact_message", entityId: m.id, ip, userAgent, before: { handledBy: m.handledBy, status: m.status }, after: { handledBy: s.id } });
    return { ok: true, message: `أُسندت إلى ${s.name ?? "الموظف"}.` };
  }, PATH);
}

const statusSchema = z.object({ id: z.string().uuid(), status: z.enum(["new", "in_progress", "handled"]) });

export async function setContactStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(statusSchema, fd);
  if ("state" in r) return r.state;
  return staffAction("admin.users", async ({ auth, tx, ip, userAgent }) => {
    const [m] = await tx.select().from(contactMessages).where(eq(contactMessages.id, r.data.id)).limit(1);
    if (!m) throw new UserError("الرسالة غير موجودة.");
    if (m.status === r.data.status) return { ok: true, message: "لا تغيير." };
    await tx
      .update(contactMessages)
      .set({ status: r.data.status, handledBy: r.data.status === "new" ? m.handledBy : (m.handledBy ?? auth.user.id) })
      .where(eq(contactMessages.id, m.id));
    await audit(tx, { actorUserId: auth.user.id, action: "admin.contact.status", entityType: "contact_message", entityId: m.id, ip, userAgent, before: { status: m.status }, after: { status: r.data.status } });
    return { ok: true, message: r.data.status === "handled" ? "عُلّمت الرسالة معالَجة." : "حُدّثت الحالة." };
  }, PATH);
}
