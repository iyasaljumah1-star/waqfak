import "server-only";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import type { Auth } from "@/server/authz/context";
import { nazaraEngagements, nazaraEvents, requestLinks, serviceRequests, services, waqfs } from "@/server/db/schema";
import type { RequestLinkEntity, RequestLinkRelation } from "@/server/db/schema/operations";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";

/**
 * The request as the operational reference: explicit, two-way links between a request and the records it created or
 * concerns (waqf file, nazara engagement). A request keeps its own identity and history; several requests can relate
 * to the same waqf or engagement. Links are unique per (request, entity), so retries never duplicate them.
 */

export async function linkRequest(tx: Tx, l: { requestId: string; waqfId: string | null; entityType: RequestLinkEntity; entityId: string; relation: RequestLinkRelation; actorId: string; note?: string }) {
  const [row] = await tx
    .insert(requestLinks)
    .values({ requestId: l.requestId, waqfId: l.waqfId, entityType: l.entityType, entityId: l.entityId, relation: l.relation, note: l.note ?? null, createdBy: l.actorId })
    .onConflictDoNothing()
    .returning({ id: requestLinks.id });
  return !!row;
}

export type LinkView = { entityType: RequestLinkEntity; entityId: string; relation: RequestLinkRelation; label: string; status: string | null; adminHref: string; clientHref: string | null };

/** What a request is linked to, with the current status of each linked record (read from its own table). */
export async function linksOfRequest(tx: Tx, requestId: string): Promise<LinkView[]> {
  const rows = await tx.select().from(requestLinks).where(eq(requestLinks.requestId, requestId)).orderBy(requestLinks.createdAt);
  const out: LinkView[] = [];
  const engIds = rows.filter((r) => r.entityType === "nazara_engagement").map((r) => r.entityId);
  const waqfIds = rows.filter((r) => r.entityType === "waqf").map((r) => r.entityId);
  const engs = engIds.length ? await tx.select({ id: nazaraEngagements.id, number: nazaraEngagements.number, status: nazaraEngagements.status, waqfId: nazaraEngagements.waqfId }).from(nazaraEngagements).where(inArray(nazaraEngagements.id, engIds)) : [];
  const ws = waqfIds.length ? await tx.select({ id: waqfs.id, name: waqfs.name, status: waqfs.status }).from(waqfs).where(inArray(waqfs.id, waqfIds)) : [];
  for (const r of rows) {
    if (r.entityType === "nazara_engagement") {
      const e = engs.find((x) => x.id === r.entityId);
      if (e) out.push({ entityType: r.entityType, entityId: e.id, relation: r.relation, label: `ملف النظارة ${e.number}`, status: e.status, adminHref: `/admin/nazara/${e.id}`, clientHref: null });
    } else if (r.entityType === "waqf") {
      const w = ws.find((x) => x.id === r.entityId);
      if (w) out.push({ entityType: r.entityType, entityId: w.id, relation: r.relation, label: w.name, status: w.status, adminHref: `/admin/waqfs/${w.id}`, clientHref: `/app/w/${w.id}` });
    }
  }
  return out;
}

/** Requests linked to a record (newest first), with their service and status. */
export async function requestsLinkedTo(tx: Tx, entityType: RequestLinkEntity, entityId: string) {
  return tx
    .select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, relation: requestLinks.relation, service: services.nameAr, code: services.code, createdAt: serviceRequests.createdAt })
    .from(requestLinks)
    .innerJoin(serviceRequests, eq(serviceRequests.id, requestLinks.requestId))
    .innerJoin(services, eq(services.id, serviceRequests.serviceId))
    .where(and(eq(requestLinks.entityType, entityType), eq(requestLinks.entityId, entityId)))
    .orderBy(desc(serviceRequests.createdAt));
}

const OPEN = ["closed", "cancelled", "rejected", "draft"] as const;
const PRE_EXECUTION = ["submitted", "triage", "awaiting_client", "quote", "awaiting_contract", "on_hold"];

type SyncCtx = { auth: Auth; tx: Tx; ip: string; userAgent: string };

/**
 * Nazara decision → linked requests (explicit rules; nothing else changes the request):
 *  - accept   → the request is accepted for service (if it was not), and its history says so.
 *  - reject   → an open request that has not started execution is rejected with the same reason.
 *  - activate / suspend / resume / end → recorded in the request history only.
 */
export async function syncRequestsFromNazara(c: SyncCtx, e: { id: string; number: string; waqfId: string }, action: string, note: string | null) {
  const linked = (await requestsLinkedTo(c.tx, "nazara_engagement", e.id)).filter((r) => !(OPEN as readonly string[]).includes(r.status));
  if (!linked.length) return;
  const { loadRequestCtx } = await import("@/server/modules/requests/access");
  const { logEvent, transition } = await import("@/server/modules/requests/engine");
  const { syncTask } = await import("./exec");
  const label: Record<string, string> = {
    accept: "اعتُمد قبول ملف النظارة", reject: "رُفض ملف النظارة", activate: "بدأت مباشرة النظارة", suspend: "أُوقفت النظارة", resume: "استُؤنفت النظارة",
    start_ending: "بدأ إنهاء النظارة وتسليمها", end: "أُقفلت النظارة بعد التسليم", request_completion: "طلب فريق النظارة استكمال مستندات", start_review: "بدأت دراسة ملف النظارة",
  };
  for (const r of linked) {
    const rc = await loadRequestCtx(c.tx, c.auth, r.id, "system");
    const msg = `${label[action] ?? action} (${e.number})${note ? ` — ${note}` : ""}`;
    if (action === "accept" && !rc.req.acceptedAt && rc.req.status === "triage" && rc.req.intakeVerifiedAt) {
      await c.tx.update(serviceRequests).set({ acceptedAt: new Date(), acceptedBy: c.auth.user.id, updatedBy: c.auth.user.id }).where(eq(serviceRequests.id, r.id));
      await syncTask(c.tx, r.id, "intake", undefined, "done", c.auth.user.id, "قُبل الطلب باعتماد قبول ملف النظارة");
      await logEvent(c.tx, rc.req, c.auth.user.id, `${msg}؛ وقُبل الطلب للخدمة تبعًا له`);
    } else if (action === "reject" && PRE_EXECUTION.includes(rc.req.status)) {
      await transition(c, rc, { to: "rejected", note: msg, system: true });
    } else {
      await logEvent(c.tx, rc.req, c.auth.user.id, msg);
    }
  }
}

/**
 * Request → its nazara engagement: when the request that opened (or relates to) a file still under study is cancelled
 * or rejected, the file is NOT changed automatically — the nazara managers are told and decide (event + notification).
 */
export async function syncNazaraFromRequest(c: SyncCtx, req: { id: string; number: string }, to: string, note: string) {
  if (to !== "cancelled" && to !== "rejected") return;
  const links = await c.tx.select({ id: requestLinks.entityId }).from(requestLinks).where(and(eq(requestLinks.requestId, req.id), eq(requestLinks.entityType, "nazara_engagement")));
  if (!links.length) return;
  const engs = await c.tx.select().from(nazaraEngagements).where(and(inArray(nazaraEngagements.id, links.map((l) => l.id)), inArray(nazaraEngagements.status, ["intake", "under_review", "pending_completion", "accepted"])));
  for (const e of engs) {
    const others = (await requestsLinkedTo(c.tx, "nazara_engagement", e.id)).filter((r) => r.id !== req.id && !(OPEN as readonly string[]).includes(r.status));
    const text = `${to === "cancelled" ? "أُلغي" : "رُفض"} الطلب ${req.number}${note ? `: ${note}` : ""}.${others.length ? ` يبقى الملف مرتبطًا بطلب مفتوح آخر (${others.map((o) => o.number).join("، ")}).` : " يقرر مدير النظارة مصير الملف."}`;
    await c.tx.insert(nazaraEvents).values({ engagementId: e.id, waqfId: e.waqfId, action: "request_closed", fromStatus: e.status, toStatus: e.status, note: text, actorUserId: c.auth.user.id });
    await audit(c.tx, { actorUserId: c.auth.user.id, action: "nazara.request_closed", entityType: "nazara_engagement", entityId: e.id, waqfId: e.waqfId, ip: c.ip, userAgent: c.userAgent, after: { request: req.number, to } });
    if (!others.length) {
      const { nazaraManagerIds } = await import("@/server/modules/nazara/queries");
      for (const mid of await nazaraManagerIds(c.tx)) await notify(mid, "nazara.update", { number: e.number, status: "طلب الملف لم يعد مفتوحًا", waqf: "", note: text }, { waqfId: e.waqfId, link: `/admin/nazara/${e.id}`, tx: c.tx });
    }
  }
}

/** Open requests of a waqf (to show them on the waqf and nazara files). */
export async function openRequestsOfWaqf(tx: Tx, waqfId: string) {
  return tx.select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, service: services.nameAr })
    .from(serviceRequests).innerJoin(services, eq(services.id, serviceRequests.serviceId))
    .where(and(eq(serviceRequests.waqfId, waqfId), notInArray(serviceRequests.status, [...OPEN])))
    .orderBy(desc(serviceRequests.createdAt));
}
