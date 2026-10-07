import "server-only";
import { and, asc, count, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { cache } from "react";
import type { Auth } from "../../authz/context";
import { obligationInstances, obligations, serviceRequests, tasks, notifications, waqfMemberships, waqfs } from "../../db/schema";
import { read } from "../_shared";

export const OPEN_REQUEST_EXCLUDED = ["completed", "closed", "cancelled", "rejected", "draft"] as const;

export type MyWaqf = {
  id: string;
  name: string;
  internalNumber: string;
  status: string;
  legalType: string | null;
  sizeClass: string | null;
  nazirMode: string | null;
  stage: number;
  roles: string[];
  beneficiaryOnly: boolean;
};

/** The waqfs I hold an active membership in (under RLS), with my roles grouped. Cached per request. */
export const myWaqfs = cache(async (auth: Auth): Promise<MyWaqf[]> => {
  const rows = await read(auth, (tx) =>
    tx
      .select({
        id: waqfs.id, name: waqfs.name, internalNumber: waqfs.internalNumber, status: waqfs.status, legalType: waqfs.legalType,
        sizeClass: waqfs.sizeClass, nazirMode: waqfs.nazirMode, stage: waqfs.stage, roleKey: waqfMemberships.roleKey,
      })
      .from(waqfMemberships)
      .innerJoin(waqfs, eq(waqfs.id, waqfMemberships.waqfId))
      .where(
        and(
          eq(waqfMemberships.userId, auth.user.id),
          eq(waqfMemberships.status, "active"),
          or(isNull(waqfMemberships.endsAt), gt(waqfMemberships.endsAt, new Date())),
          isNull(waqfs.archivedAt),
        ),
      )
      .orderBy(asc(waqfs.name)),
  );
  const map = new Map<string, MyWaqf>();
  for (const r of rows) {
    const w = map.get(r.id) ?? { ...r, roles: [] as string[], beneficiaryOnly: false };
    if (!w.roles.includes(r.roleKey)) w.roles.push(r.roleKey);
    map.set(r.id, w);
  }
  const list = [...map.values()];
  for (const w of list) w.beneficiaryOnly = w.roles.every((r) => r === "beneficiary");
  return list;
});

export const unreadCount = cache(async (auth: Auth) => {
  const [r] = await read(auth, (tx) =>
    tx.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, auth.user.id), isNull(notifications.readAt))),
  );
  return Number(r?.n ?? 0);
});

export type DashObligation = { id: string; waqfId: string; title: string; dueOn: string | null; dueImmediately: boolean; status: string; severity: string };

/** Dashboard data for the waqfs where I am more than a beneficiary. Each query runs on its own connection in parallel. */
export async function dashboardData(auth: Auth, waqfIds: string[]) {
  if (!waqfIds.length) return { obligations: new Map<string, DashObligation[]>(), requests: new Map<string, number>(), tasks: new Map<string, number>(), overdue: new Map<string, number>() };
  const [obl, reqs, tsk] = await Promise.all([
    read(auth, (tx) =>
      tx
        .select({
          id: obligationInstances.id, waqfId: obligationInstances.waqfId, title: obligations.titleAr, dueOn: obligationInstances.dueOn,
          dueImmediately: obligationInstances.dueImmediately, status: obligationInstances.status, severity: obligations.severity,
          rn: sql<number>`row_number() over (partition by ${obligationInstances.waqfId} order by ${obligationInstances.dueOn} asc nulls last)`.as("rn"),
        })
        .from(obligationInstances)
        .innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId))
        .where(and(inArray(obligationInstances.waqfId, waqfIds), notInArray(obligationInstances.status, ["done", "waived"]))),
    ),
    read(auth, (tx) =>
      tx
        .select({ waqfId: serviceRequests.waqfId, n: count() })
        .from(serviceRequests)
        .where(and(inArray(serviceRequests.waqfId, waqfIds), notInArray(serviceRequests.status, [...OPEN_REQUEST_EXCLUDED])))
        .groupBy(serviceRequests.waqfId),
    ),
    read(auth, (tx) =>
      tx
        .select({ waqfId: tasks.waqfId, n: count() })
        .from(tasks)
        .where(and(inArray(tasks.waqfId, waqfIds), inArray(tasks.status, ["todo", "in_progress"]), auth.isStaff ? undefined : eq(tasks.visibility, "shared")))
        .groupBy(tasks.waqfId),
    ),
  ]);
  const obligationsBy = new Map<string, DashObligation[]>();
  const overdue = new Map<string, number>();
  for (const o of obl) {
    if (o.status === "overdue") overdue.set(o.waqfId, (overdue.get(o.waqfId) ?? 0) + 1);
    if (Number(o.rn) > 3) continue;
    const l = obligationsBy.get(o.waqfId) ?? [];
    l.push(o);
    obligationsBy.set(o.waqfId, l);
  }
  for (const l of obligationsBy.values()) l.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  return {
    obligations: obligationsBy,
    overdue,
    requests: new Map(reqs.map((r) => [r.waqfId ?? "", Number(r.n)])),
    tasks: new Map(tsk.map((r) => [r.waqfId ?? "", Number(r.n)])),
  };
}
