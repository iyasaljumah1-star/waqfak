import "server-only";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { asSystem } from "@/server/db/as-system";
import { auditLogs, outputs, roles, serviceRequests, services, tasks, userRoles, users } from "@/server/db/schema";
import { rolePermissionMap } from "@/server/authz/context";
import type { Auth, WaqfAccess } from "@/server/authz/context";
import { notify } from "@/server/modules/notify";
import { reviewReason, reviewSection, type ReviewTrigger } from "./file-review-pure";

/**
 * Review of changes to a waqf file (ACC: «إذا كان التعديل يمس بيانات جوهرية أو بيانات استُخدمت في وثيقة معتمدة»).
 *
 * A change is saved at once — it is the file's data — and, when it touches the file's substance (terms, masarif and
 * beneficiaries, nazara and board, assets, identity) of a documented waqf, or of a waqf whose data went into an approved
 * deed document, it is also put to the team for review: one internal task per saved change, naming what changed, who
 * changed it, the value before and after (kept in the append-only audit trail) and why it needs review. An approved
 * output is never changed: its text is frozen in its version. The nazara holding a documented waqf manages its own file
 * without a team review (its changes reach the regulator through the material-change obligation).
 */

/** Waqf statuses whose data is documented: a change there is a change to an instrument already issued. */
const DOCUMENTED = ["documented", "registered", "active", "suspended"];
/** Deed services whose approved output carries the waqf's terms, masarif, assets and nazara. */
const DEED_SERVICES = ["T03", "T04"];

/** The last audit row id (the changes of this action are those written after it). */
export async function auditMark(tx: Tx): Promise<number> {
  const r = await asSystem(tx, () => tx.execute<{ m: string | null }>(sql`select max(id)::text as m from audit_logs`));
  return Number(r.rows[0]?.m ?? 0);
}

/** Approved deed outputs that used this waqf's data (their text is frozen; listed so the reviewer weighs the change). */
async function approvedDeedOutputs(tx: Tx, waqfId: string) {
  return asSystem(tx, () =>
    tx.select({ id: outputs.id, number: outputs.number, title: outputs.title, requestId: outputs.requestId, requestNumber: serviceRequests.number })
      .from(outputs)
      .innerJoin(serviceRequests, eq(serviceRequests.id, outputs.requestId))
      .innerJoin(services, eq(services.id, serviceRequests.serviceId))
      .where(and(eq(outputs.waqfId, waqfId), eq(outputs.status, "approved"), inArray(services.code, DEED_SERVICES))),
  );
}

export async function reviewerIds(tx: Tx) {
  const map = await rolePermissionMap();
  const keys = [...map.entries()].filter(([, p]) => p.has("admin.waqfs.edit")).map(([k]) => k);
  if (!keys.length) return [];
  const rows = await tx.select({ id: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(inArray(roles.key, keys), eq(users.status, "active")));
  return [...new Set(rows.map((r) => r.id))];
}

/**
 * After a waqf-file action succeeded: when its changes need review, opens one review task for them (inside the same
 * transaction, so a failed action leaves nothing). Returns the task id or null.
 */
export async function recordFileChanges(tx: Tx, auth: Auth, access: WaqfAccess, sinceAuditId: number): Promise<string | null> {
  const w = access.waqf;
  const holdsNazara = access.roles.includes("nazir") || access.roles.includes("board_chair");
  const rows = await asSystem(tx, () =>
    tx.select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, before: auditLogs.before, after: auditLogs.after })
      .from(auditLogs)
      .where(and(gt(auditLogs.id, sinceAuditId), eq(auditLogs.waqfId, w.id), eq(auditLogs.actorUserId, auth.user.id)))
      .orderBy(auditLogs.id),
  );
  const changes = rows.map((r) => ({ ...r, section: reviewSection(r.action) })).filter((r) => r.section);
  if (!changes.length) return null;
  const used = await approvedDeedOutputs(tx, w.id);
  const trigger: ReviewTrigger | null =
    used.length ? "approved_output" : DOCUMENTED.includes(w.status) && !holdsNazara ? "documented" : null;
  if (!trigger) return null;
  const sections = [...new Set(changes.map((c) => c.section!))];
  const why = reviewReason(trigger, used.map((o) => `${o.number} «${o.title}» (${o.requestNumber})`));
  const by = access.staffEditor && !access.roles.length ? "فريق «وقفك»" : access.roles.includes("founder") ? "الواقف" : "عضو في الملف";
  const title = `مراجعة تعديل على ملف الوقف: ${sections.join("، ")}`;
  const description = [
    `${w.name} (${w.internalNumber})`,
    `عدّله: ${auth.user.fullName ?? "—"} (${by})`,
    `السبب: ${why}`,
    `سجل التدقيق: ${changes.map((c) => `#${c.id} ${c.action}`).join("، ")}`,
  ].join("\n");
  const [t] = await asSystem(tx, () =>
    tx.insert(tasks).values({
      waqfId: w.id, sourceType: "waqf", sourceId: w.id, kind: "file_review", outputKey: `filechange:${changes[0].id}`,
      title, description, priority: trigger === "approved_output" ? "high" : "normal", visibility: "internal", createdBy: auth.user.id, updatedBy: auth.user.id,
    }).returning({ id: tasks.id }),
  );
  for (const u of await asSystem(tx, () => reviewerIds(tx))) {
    if (u === auth.user.id) continue;
    await notify(u, "waqf.file_review_due", { waqf: w.name, what: sections.join("، "), by: auth.user.fullName ?? by, why }, { waqfId: w.id, link: `/admin/waqfs/${w.id}#file-reviews`, tx });
  }
  return t.id;
}

/** The two kinds of item in a file's review list: a saved change to review, and a founder's request for a change. */
export const REVIEW_KINDS = ["file_review", "file_change_request"] as const;

export type FileReview = {
  kind: (typeof REVIEW_KINDS)[number];
  /** A founder's change request: the section, what to change and why (as submitted). */
  request: { section: string; details: string; reason: string } | null;
  id: string; title: string; description: string | null; status: string; priority: string; createdAt: Date; createdBy: string | null; createdByName: string | null;
  completedAt: Date | null; completedByName: string | null; createdByStaff: boolean; note: string | null;
  changes: { id: number; action: string; section: string; before: unknown; after: unknown }[];
};

/** Review tasks of a waqf's file, newest first, with the changes (before/after) they cover. Read with the system context. */
export async function fileReviews(tx: Tx, waqfId: string, opts: { openOnly?: boolean; limit?: number } = {}): Promise<FileReview[]> {
  return asSystem(tx, async () => {
    const list = await tx.select({
      kind: tasks.kind, id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority, createdAt: tasks.createdAt, createdBy: tasks.createdBy,
      completedAt: tasks.completedAt, completedBy: tasks.completedBy, checklist: tasks.checklist,
    }).from(tasks)
      .where(and(eq(tasks.waqfId, waqfId), inArray(tasks.kind, [...REVIEW_KINDS]), opts.openOnly ? inArray(tasks.status, ["todo", "in_progress"]) : undefined))
      .orderBy(desc(tasks.createdAt)).limit(opts.limit ?? 20);
    if (!list.length) return [];
    const ids = [...new Set(list.flatMap((t) => [t.createdBy, t.completedBy]).filter((x): x is string => !!x))];
    const people = ids.length ? await tx.select({ id: users.id, n: users.fullName, staff: users.isStaff }).from(users).where(inArray(users.id, ids)) : [];
    const names = new Map(people.map((u) => [u.id, u.n]));
    const staff = new Set(people.filter((u) => u.staff).map((u) => u.id));
    const out: FileReview[] = [];
    for (const t of list) {
      const isRequest = t.kind === "file_change_request";
      const line = (k: string) => (t.description ?? "").split("\n").find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2) ?? "";
      const auditLine = (t.description ?? "").split("\n").find((l) => l.startsWith("سجل التدقيق: ")) ?? "";
      const auditIds = isRequest ? [] : [...auditLine.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
      const rows = auditIds.length ? await tx.select({ id: auditLogs.id, action: auditLogs.action, before: auditLogs.before, after: auditLogs.after }).from(auditLogs).where(inArray(auditLogs.id, auditIds)).orderBy(auditLogs.id) : [];
      out.push({
        kind: isRequest ? "file_change_request" : "file_review",
        request: isRequest ? { section: line("القسم"), details: line("المطلوب"), reason: line("المبرر") } : null,
        id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, createdAt: t.createdAt, createdBy: t.createdBy,
        createdByName: t.createdBy ? names.get(t.createdBy) ?? null : null, createdByStaff: !!t.createdBy && staff.has(t.createdBy), completedAt: t.completedAt, completedByName: t.completedBy ? names.get(t.completedBy) ?? null : null,
        note: (t.checklist ?? []).map((c) => c.text).join(" ") || null,
        changes: rows.map((r) => ({ ...r, section: reviewSection(r.action) ?? r.action })),
      });
    }
    return out;
  });
}

/** Open review tasks per waqf (for lists). */
export async function openReviewCounts(tx: Tx, waqfIds: string[]) {
  if (!waqfIds.length) return new Map<string, number>();
  const rows = await asSystem(tx, () =>
    tx.select({ w: tasks.waqfId, n: sql<number>`count(*)::int` }).from(tasks)
      .where(and(inArray(tasks.waqfId, waqfIds), inArray(tasks.kind, [...REVIEW_KINDS]), inArray(tasks.status, ["todo", "in_progress"]), isNull(tasks.requestId)))
      .groupBy(tasks.waqfId),
  );
  return new Map(rows.map((r) => [r.w!, Number(r.n)]));
}

