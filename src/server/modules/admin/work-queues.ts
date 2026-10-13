import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import {
  contracts, invoices, nazaraEngagements, outputs, payments, quotes, requestItems, serviceRequests, services, tasks, users, waqfs,
} from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { todayISO } from "@/server/engines/dates";

/**
 * Operational work queues for the admin dashboard. Every entry is a real record and links to the record itself
 * (the request page and section, or the nazara file). Each queue states what it counts; nothing is estimated.
 * Visibility: request queues follow the request isolation rule (all requests with admin.requests.all, otherwise only
 * those assigned to the viewer); RLS applies to every query.
 */

export type QueueItem = { id: string; href: string; title: string; meta: string; due?: string | null; overdue?: boolean };
export type Queue = { key: string; title: string; defines: string; count: number; items: QueueItem[]; more?: string };

const LIMIT = 6;

export async function workQueues(auth: Auth): Promise<Queue[]> {
  const all = auth.perms.has("admin.requests.all");
  const mine = auth.perms.has("staff.requests.assigned");
  if (!all && !mine && !auth.perms.has("admin.finance") && !auth.perms.has("nazara.view")) return [];
  return read(auth, async (tx) => {
    const today = todayISO();
    const scope: SQL | undefined = all ? undefined : eq(serviceRequests.assignedToUserId, auth.user.id);
    const out: Queue[] = [];
    const reqBase = () => tx
      .select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, service: services.nameAr, waqf: waqfs.name, client: users.fullName, sla: serviceRequests.slaDueAt, assigned: serviceRequests.assignedToUserId, verified: serviceRequests.intakeVerifiedAt, accepted: serviceRequests.acceptedAt })
      .from(serviceRequests)
      .innerJoin(services, eq(services.id, serviceRequests.serviceId))
      .leftJoin(waqfs, eq(waqfs.id, serviceRequests.waqfId))
      .leftJoin(users, eq(users.id, serviceRequests.requesterUserId));
    type R = Awaited<ReturnType<ReturnType<typeof reqBase>["where"]>>[number];
    const item = (r: R, section = "", extra = ""): QueueItem => ({
      id: r.id, href: `/admin/requests/${r.id}${section}`, title: `${r.number} — ${r.service}`,
      meta: [r.waqf ?? r.client ?? "", extra].filter(Boolean).join(" · "), due: r.sla ? r.sla.toISOString().slice(0, 10) : null, overdue: !!r.sla && r.sla < new Date(),
    });
    const push = (key: string, title: string, defines: string, rows: QueueItem[], more?: string) => out.push({ key, title, defines, count: rows.length, items: rows.slice(0, LIMIT), more });

    if (all || mine) {
      const fresh = await reqBase().where(and(scope, eq(serviceRequests.status, "submitted"))).orderBy(asc(serviceRequests.submittedAt));
      push("new", "طلبات جديدة", "أُرسلت ولم يبدأ فرزها", fresh.map((r) => item(r, "", r.assigned ? "" : "غير مسند")), all ? "/admin/requests?tab=unassigned" : "/admin/requests?tab=mine");
      const review = await reqBase().where(and(scope, eq(serviceRequests.status, "triage"), or(isNull(serviceRequests.intakeVerifiedAt), isNull(serviceRequests.acceptedAt))));
      push("review", "طلبات تحتاج مراجعة", "قيد الفرز: لم يُتحقق من اكتمالها أو لم تُقبل بعد", review.map((r) => item(r, "#intake", r.verified ? "تحقق ولم يُقبل" : "لم يُتحقق")));
      const waitingClient = await reqBase().where(and(scope, eq(serviceRequests.status, "awaiting_client")));
      push("incomplete", "طلبات ناقصة", "بانتظار العميل لاستكمال بيانات أو مستندات", waitingClient.map((r) => item(r, "#items")), "/admin/requests?tab=awaiting_client");
      const answered = await tx.select({ requestId: requestItems.requestId, n: sql<number>`count(*)`.mapWith(Number) }).from(requestItems).where(eq(requestItems.status, "answered")).groupBy(requestItems.requestId);
      const ansReqs = answered.length ? await reqBase().where(and(scope, inArray(serviceRequests.id, answered.map((a) => a.requestId)))) : [];
      push("answers", "ردود عملاء تنتظر المراجعة", "بنود نواقص أو استفسارات ردّ عليها العميل ولم تُراجع", ansReqs.map((r) => item(r, "#items", `${answered.find((a) => a.requestId === r.id)?.n ?? 0} رد`)));

      // Tasks (request execution)
      const taskScope = all ? undefined : or(eq(tasks.assigneeUserId, auth.user.id), eq(serviceRequests.assignedToUserId, auth.user.id));
      const openTasks = await tx.select({ id: tasks.id, title: tasks.title, dueOn: tasks.dueOn, requestId: tasks.requestId, number: serviceRequests.number, assignee: tasks.assigneeUserId })
        .from(tasks).innerJoin(serviceRequests, eq(serviceRequests.id, tasks.requestId))
        .where(and(inArray(tasks.status, ["todo", "in_progress"]), taskScope, notInArray(serviceRequests.status, ["closed", "cancelled", "rejected"])))
        .orderBy(asc(tasks.dueOn));
      const tItem = (t: (typeof openTasks)[number]): QueueItem => ({ id: t.id, href: `/admin/requests/${t.requestId}#task-${t.id}`, title: t.title, meta: `${t.number}${t.assignee ? "" : " · غير مسندة"}`, due: t.dueOn, overdue: !!t.dueOn && t.dueOn < today });
      push("tasks_overdue", "مهام متأخرة", "مهام طلبات مفتوحة تجاوزت موعدها", openTasks.filter((t) => t.dueOn && t.dueOn < today).map(tItem));
      push("tasks_open", all ? "مهام يمكنك تنفيذها مباشرة" : "مهامي المفتوحة", all ? "كل مهام الطلبات المفتوحة؛ ينفذها المدير المخوّل دون إسناد" : "مهام مسندة إليك أو في طلبات مسندة إليك", openTasks.map(tItem));

      // Quotes
      const qRows = await tx.select({ id: quotes.id, requestId: quotes.requestId, number: quotes.number, version: quotes.version, status: quotes.status, preparedBy: quotes.preparedBy, validUntil: quotes.validUntil, req: serviceRequests.number })
        .from(quotes).innerJoin(serviceRequests, eq(serviceRequests.id, quotes.requestId)).where(and(inArray(quotes.status, ["draft", "sent"]), scope)).orderBy(asc(quotes.createdAt));
      const qItem = (q: (typeof qRows)[number], meta: string): QueueItem => ({ id: q.id, href: `/admin/requests/${q.requestId}#quote`, title: `${q.number} نسخة ${q.version}`, meta: `${q.req} · ${meta}`, due: q.validUntil, overdue: !!q.validUntil && q.validUntil < today });
      push("quotes_approve", "عروض بانتظار الاعتماد", "مسودات عروض يعتمدها شخص غير معدّها", qRows.filter((q) => q.status === "draft").map((q) => qItem(q, q.preparedBy === auth.user.id ? "أعددتها أنت" : "")));
      push("quotes_client", "عروض بانتظار رد العميل", "عروض أُرسلت ولم يقبلها العميل أو يرفضها", qRows.filter((q) => q.status === "sent").map((q) => qItem(q, "صالح حتى")));

      // Contracts
      const cRows = await tx.select({ id: contracts.id, requestId: contracts.requestId, number: contracts.number, status: contracts.status, req: serviceRequests.number })
        .from(contracts).innerJoin(serviceRequests, eq(serviceRequests.id, contracts.requestId)).where(and(inArray(contracts.status, ["draft", "approved", "sent", "partially_signed"]), scope));
      push("contracts", "عقود بانتظار اعتماد أو توقيع", "مسودات بانتظار الاعتماد، أو عقود أُرسلت ولم يوقعها كل الأطراف", cRows.map((k) => ({ id: k.id, href: `/admin/requests/${k.requestId}#contract`, title: k.number, meta: `${k.req} · ${({ draft: "مسودة", approved: "معتمد ولم يُرسل", sent: "أُرسل للتوقيع", partially_signed: "وُقّع جزئيًا" } as Record<string, string>)[k.status] ?? k.status}` })));

      // Outputs
      const oRows = await tx.select({ id: outputs.id, requestId: outputs.requestId, number: outputs.number, title: outputs.title, status: outputs.status, submittedBy: outputs.submittedBy, req: serviceRequests.number })
        .from(outputs).innerJoin(serviceRequests, eq(serviceRequests.id, outputs.requestId)).where(and(inArray(outputs.status, ["in_review", "draft", "returned"]), scope));
      push("outputs_review", "مخرجات بانتظار المراجعة والاعتماد", "مخرجات أُرسلت للمراجعة", oRows.filter((o) => o.status === "in_review").map((o) => ({ id: o.id, href: `/admin/requests/${o.requestId}/outputs/${o.id}`, title: o.title, meta: `${o.req} · ${o.number}${o.submittedBy === auth.user.id ? " · أعددته أنت" : ""}` })));
      push("outputs_draft", "مخرجات قيد الإعداد", "مسودات لم تُرسل للمراجعة أو أُعيدت للتعديل", oRows.filter((o) => o.status !== "in_review").map((o) => ({ id: o.id, href: `/admin/requests/${o.requestId}/outputs/${o.id}`, title: o.title, meta: `${o.req} · ${o.status === "returned" ? "أُعيدت للتعديل" : "مسودة"}` })));

      const running = await reqBase().where(and(scope, inArray(serviceRequests.status, ["in_progress", "quality_review"]))).orderBy(asc(serviceRequests.slaDueAt));
      push("running", "خدمات جارٍ تنفيذها", "قيد التنفيذ أو مراجعة الجودة", running.map((r) => item(r, "#tasks", r.status === "quality_review" ? "مراجعة الجودة" : "")));
      const toClose = await reqBase().where(and(scope, eq(serviceRequests.status, "completed")));
      push("close", "طلبات مكتملة تنتظر الإغلاق", "اعتمد العميل مخرجاتها ولم تُغلق", toClose.map((r) => item(r)));
    }

    if (auth.perms.has("admin.finance")) {
      const paid = tx.select({ invoiceId: payments.invoiceId, paid: sql<string>`coalesce(sum(${payments.amount}), 0)`.as("paid") }).from(payments).where(eq(payments.status, "paid")).groupBy(payments.invoiceId).as("pd");
      const inv = await tx.select({ id: invoices.id, number: invoices.number, total: invoices.total, dueOn: invoices.dueOn, status: invoices.status, paid: paid.paid, requestId: invoices.requestId })
        .from(invoices).leftJoin(paid, eq(paid.invoiceId, invoices.id))
        .where(and(inArray(invoices.status, ["issued", "partially_paid", "overdue"]), ne(invoices.kind, "proforma"), ne(invoices.kind, "credit_note")))
        .orderBy(asc(invoices.dueOn));
      push("invoices", "فواتير مستحقة", "صادرة غير مسددة بالكامل (دون الأولية والإشعارات الدائنة)", inv.map((i) => {
        const bal = Number(i.total) - Number(i.paid ?? 0);
        return { id: i.id, href: `/admin/finance/${i.id}`, title: i.number, meta: `المتبقي ${bal.toLocaleString("en-US", { maximumFractionDigits: 2 })} ر.س${i.status === "partially_paid" ? " · سُدد جزئيًا" : ""}`, due: i.dueOn, overdue: !!i.dueOn && i.dueOn < today };
      }), "/admin/finance");
    }

    if (auth.perms.has("nazara.view")) {
      const engs = await tx.select({ id: nazaraEngagements.id, number: nazaraEngagements.number, status: nazaraEngagements.status, waqf: waqfs.name })
        .from(nazaraEngagements).innerJoin(waqfs, eq(waqfs.id, nazaraEngagements.waqfId))
        .where(notInArray(nazaraEngagements.status, ["rejected", "ended"])).orderBy(desc(nazaraEngagements.updatedAt));
      const { STATUS_AR } = await import("@/server/modules/nazara/pure");
      push("nazara", "ملفات النظارة المفتوحة", "ملفات النظارة الاعتبارية غير المرفوضة أو المنتهية، وكل منها مرتبط بطلبه", engs.map((e) => ({ id: e.id, href: `/admin/nazara/${e.id}`, title: `${e.number} — ${e.waqf}`, meta: STATUS_AR[e.status as keyof typeof STATUS_AR] ?? e.status })), "/admin/nazara");
    }
    return out;
  });
}
