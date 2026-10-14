"use server";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { deliverables, serviceCycles } from "@/server/db/schema";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { logEvent, opsManagerIds } from "@/server/modules/requests/engine";
import { notify } from "@/server/modules/notify";
import type { ActionState } from "@/lib/utils";
import { specOf } from "./continuous";

/**
 * The client's explicit decision on a delivery made available to them: approve it (recorded with who, when, which
 * version, and any note) or ask for changes (a note is required; the delivery goes back to the team, every earlier
 * version and note is kept). Silence is never approval and time never closes a delivery.
 *
 * This is the client's acceptance of what was delivered. It is not the team's internal approval of the output, not a
 * financial approval, and not any official or regulatory act; none of these replaces another.
 */
const schema = z.object({ cycleId: z.string().uuid(), note: z.string().trim().max(2000).optional().default("") });

async function loadForClient(c: Parameters<Parameters<typeof userAction>[0]>[0], cycleId: string) {
  const [cy] = await c.tx.select().from(serviceCycles).where(eq(serviceCycles.id, cycleId)).limit(1);
  if (!cy) throw new UserError("التسليم غير موجود أو لا تملك صلاحية الوصول إليه.");
  const rc = await loadRequestCtx(c.tx, c.auth, cy.requestId, "client");
  if (!rc.clientSide || !(rc.isRequester || rc.memberCreate)) throw new ForbiddenError("يعتمد التسليم مقدّم الطلب أو من يملك صلاحية الطلبات في الوقف.");
  if (!specOf(rc)) throw new UserError("هذه الخدمة ليست خدمة مستمرة.");
  if (cy.status !== "sent") throw new UserError(cy.status === "closed" ? "أُقفل هذا التسليم." : "هذا التسليم ليس متاحًا لاتخاذ قرار عليه الآن.");
  if (cy.clientDecision) throw new UserError("سُجل قرارك على هذا التسليم من قبل.");
  const [del] = await c.tx.select().from(deliverables).where(and(eq(deliverables.cycleId, cy.id), isNotNull(deliverables.releasedAt))).orderBy(desc(deliverables.releasedAt)).limit(1);
  return { cy, rc, del: del ?? null };
}

/** The output version made available last (recorded by the team when it made the delivery available; the client
 *  cannot read the team's drafts). */
const availableVersion = (cy: typeof serviceCycles.$inferSelect) => [...(cy.clientEvents ?? [])].reverse().find((e) => e.kind === "available")?.version ?? null;

async function staffToTell(c: Parameters<Parameters<typeof userAction>[0]>[0], assignee: string | null) {
  return [...new Set([...(assignee ? [assignee] : []), ...(await opsManagerIds(c.tx))])];
}

export async function approveDelivery(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema, fd);
  if ("state" in r) return r.state;
  let rid = "";
  return userAction(async (c) => {
    const { cy, rc, del } = await loadForClient(c, r.data.cycleId);
    rid = rc.req.id;
    const version = availableVersion(cy);
    const now = new Date();
    await c.tx.update(serviceCycles).set({
      clientDecision: "approved", clientDecisionAt: now, clientDecisionBy: c.auth.user.id, clientDecisionNote: r.data.note || null, clientApprovedVersion: version,
      clientEvents: [...(cy.clientEvents ?? []), { at: now.toISOString(), by: c.auth.user.id, kind: "approved", version, note: r.data.note || null }],
    }).where(and(eq(serviceCycles.id, cy.id), eq(serviceCycles.status, "sent")));
    if (del) await c.tx.update(deliverables).set({ status: "approved", approvedAt: now, approvedBy: c.auth.user.id }).where(eq(deliverables.id, del.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `اعتمد العميل استلام التسليم «${cy.label}»${version ? ` (النسخة ${version})` : ""}${r.data.note ? `: ${r.data.note}` : ""}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.client_approve", entityType: "service_cycle", entityId: cy.id, waqfId: cy.waqfId, ip: c.ip, userAgent: c.userAgent, after: { seq: cy.seq, version, note: r.data.note || undefined } });
    for (const u of await staffToTell(c, rc.req.assignedToUserId))
      await notify(u, "delivery.client_decision", { number: rc.req.number, decision: "اعتمد العميل الاستلام", title: cy.label, note: r.data.note || "" }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}#cycle-${cy.seq}`, tx: c.tx });
    return { ok: true, message: "سُجل اعتمادك لاستلام هذا التسليم." };
  }, { revalidate: () => [`/app/requests/${rid}`, `/admin/requests/${rid}`] });
}

export async function requestDeliveryRevision(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema, fd);
  if ("state" in r) return r.state;
  if (r.data.note.length < 10) return { error: "اكتب ملاحظاتك على التسليم وما يلزم تعديله (10 أحرف على الأقل).", fieldErrors: { note: "اكتب ما يلزم تعديله." } };
  let rid = "";
  return userAction(async (c) => {
    const { cy, rc, del } = await loadForClient(c, r.data.cycleId);
    rid = rc.req.id;
    const o = { v: availableVersion(cy) };
    const now = new Date();
    // The delivery goes back to the team: the cycle reopens; the delivered version and its file stay as they were.
    await c.tx.update(serviceCycles).set({
      status: "open", clientDecision: "revision_requested", clientDecisionAt: now, clientDecisionBy: c.auth.user.id, clientDecisionNote: r.data.note,
      clientEvents: [...(cy.clientEvents ?? []), { at: now.toISOString(), by: c.auth.user.id, kind: "revision_requested", version: o?.v ?? null, note: r.data.note }],
    }).where(and(eq(serviceCycles.id, cy.id), eq(serviceCycles.status, "sent")));
    if (del) await c.tx.update(deliverables).set({ status: "revision_requested", revisionNote: r.data.note }).where(eq(deliverables.id, del.id));
    await logEvent(c.tx, rc.req, c.auth.user.id, `طلب العميل تعديل التسليم «${cy.label}»: ${r.data.note}`);
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "continuous.client_revision", entityType: "service_cycle", entityId: cy.id, waqfId: cy.waqfId, ip: c.ip, userAgent: c.userAgent, after: { seq: cy.seq, version: o?.v ?? null, note: r.data.note } });
    for (const u of await staffToTell(c, rc.req.assignedToUserId))
      await notify(u, "delivery.client_decision", { number: rc.req.number, decision: "طلب العميل تعديلًا", title: cy.label, note: r.data.note }, { waqfId: rc.req.waqfId, link: `/admin/requests/${rc.req.id}#cycle-${cy.seq}`, tx: c.tx });
    return { ok: true, message: "أُرسلت ملاحظاتك إلى الفريق، وعاد التسليم إليهم للتعديل." };
  }, { revalidate: () => [`/app/requests/${rid}`, `/admin/requests/${rid}`] });
}
