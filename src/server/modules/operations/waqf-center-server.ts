import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, lt, max, notInArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  assets, beneficialOwners, beneficiaries, beneficiaryClasses, budgets, conditions, distributions, documents, ledgerEntries, leases, meetings,
  nazaraEngagements, obligationInstances, obligations, policies, serviceRequests, services, tasks, waqfs,
} from "@/server/db/schema";
import { addDays, todayISO } from "@/server/engines/dates";
import { POLICY_TYPES } from "@/server/modules/governance/pure";
import { WAITING_ON_CLIENT, type RequestStatus } from "@/server/modules/requests/workflow";
import { waqfCenter, type WaqfFacts } from "./waqf-center";

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));

/** Reads the facts of a waqf file under the caller's RLS context (a viewer sees only what their access allows). */
export async function waqfFacts(tx: Tx, waqfId: string): Promise<WaqfFacts | null> {
  const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (!w) return null;
  const today = todayISO();
  const yearAgo = addDays(today, -365);
  const d90 = addDays(today, -90);
  const in30 = addDays(today, 30);
  const in90 = addDays(today, 90);
  const [deedDocs, cond, ast, ls, bens, cls, led90, lastLed, bud, dists, pols, mts, bo, obl, tk, reqs, eng] = await Promise.all([
    tx.select({ n: count() }).from(documents).where(and(eq(documents.waqfId, waqfId), eq(documents.docType, "waqf_deed"), isNull(documents.archivedAt))),
    tx.select({ n: count() }).from(conditions).where(eq(conditions.waqfId, waqfId)),
    tx.select({ last: assets.lastValuationOn }).from(assets).where(and(eq(assets.waqfId, waqfId), isNull(assets.archivedAt))),
    tx.select({ status: leases.status, arrears: leases.arrears, endsOn: leases.endsOn }).from(leases).where(eq(leases.waqfId, waqfId)),
    tx.select({ n: count() }).from(beneficiaries).where(and(eq(beneficiaries.waqfId, waqfId), isNull(beneficiaries.archivedAt))),
    tx.select({ n: count() }).from(beneficiaryClasses).where(eq(beneficiaryClasses.waqfId, waqfId)),
    tx.select({ n: count() }).from(ledgerEntries).where(and(eq(ledgerEntries.waqfId, waqfId), gte(ledgerEntries.entryDate, d90))),
    tx.select({ d: max(ledgerEntries.entryDate) }).from(ledgerEntries).where(eq(ledgerEntries.waqfId, waqfId)),
    tx.select({ year: budgets.fiscalYear, status: budgets.status }).from(budgets).where(eq(budgets.waqfId, waqfId)).orderBy(desc(budgets.fiscalYear)).limit(1),
    tx.select({ n: count() }).from(distributions).where(and(eq(distributions.waqfId, waqfId), notInArray(distributions.status, ["paid"]), lt(distributions.dueBy, today))),
    tx.select({ type: policies.policyType, status: policies.status }).from(policies).where(eq(policies.waqfId, waqfId)),
    tx.select({ n: count() }).from(meetings).where(and(eq(meetings.waqfId, waqfId), eq(meetings.status, "held"), gte(meetings.scheduledAt, new Date(`${yearAgo}T00:00:00Z`)))),
    tx.select({ verifiedOn: beneficialOwners.verifiedOn, next: beneficialOwners.nextVerificationDue }).from(beneficialOwners).where(and(eq(beneficialOwners.waqfId, waqfId), isNull(beneficialOwners.archivedAt))),
    tx.select({ status: obligationInstances.status, dueOn: obligationInstances.dueOn, title: obligations.titleAr }).from(obligationInstances).innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId)).where(eq(obligationInstances.waqfId, waqfId)),
    tx.select({ status: tasks.status, dueOn: tasks.dueOn }).from(tasks).where(and(eq(tasks.waqfId, waqfId), inArray(tasks.status, ["todo", "in_progress"]))),
    tx.select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, service: services.nameAr }).from(serviceRequests).innerJoin(services, eq(services.id, serviceRequests.serviceId))
      .where(and(eq(serviceRequests.waqfId, waqfId), notInArray(serviceRequests.status, ["draft", "closed", "cancelled", "rejected"]))).orderBy(desc(serviceRequests.updatedAt)).limit(10),
    tx.select().from(nazaraEngagements).where(eq(nazaraEngagements.waqfId, waqfId)).orderBy(desc(nazaraEngagements.createdAt)).limit(1),
  ]);
  const polByType = new Map(pols.map((p) => [p.type, p.status]));
  const missingPolicies = POLICY_TYPES.filter(([t]) => polByType.get(t) !== "approved").length;
  const e = eng[0];
  const appointmentMissing = e ? [
    !e.leadUserId && "مسؤول الملف", !e.appointmentDecisionNo && "رقم قرار التعيين", !e.appointmentDecisionDate && "تاريخه",
    !e.powers && "الصلاحيات", !e.feeTerms && "الأتعاب", !e.responsibilities && "المسؤوليات",
  ].filter((x): x is string => !!x) : [];
  return {
    today,
    waqfakIsNazir: w.waqfakRole === "nazir",
    deed: { no: w.deedNo, date: w.deedDate ?? w.deedDateHijri, docs: Number(deedDocs[0]?.n ?? 0), conditions: Number(cond[0]?.n ?? 0) },
    registration: { on: w.registeredOn, expiresOn: w.registrationExpiresOn },
    assets: { count: ast.length, staleValuation: ast.filter((a) => !a.last || a.last < yearAgo).length },
    leases: { arrears: ls.reduce((s, l) => s + num(l.arrears), 0), endingIn90: ls.filter((l) => l.status === "active" && l.endsOn && l.endsOn >= today && l.endsOn <= in90).length },
    beneficiaries: { total: Number(bens[0]?.n ?? 0), classes: Number(cls[0]?.n ?? 0) },
    finance: { entries90d: Number(led90[0]?.n ?? 0), lastEntry: lastLed[0]?.d ?? null },
    budget: { year: bud[0]?.year ?? null, status: bud[0]?.status ?? null, currentYear: Number(today.slice(0, 4)) },
    distributions: { overdue: Number(dists[0]?.n ?? 0) },
    governance: { missingPolicies, totalPolicies: POLICY_TYPES.length, meetings12m: Number(mts[0]?.n ?? 0) },
    bo: { total: bo.length, unverified: bo.filter((x) => !x.verifiedOn).length, dueSoon: bo.filter((x) => x.next && x.next <= in30).length },
    obligations: {
      overdue: obl.filter((o) => o.status === "overdue").map((o) => ({ title: o.title, dueOn: o.dueOn })),
      dueSoon: obl.filter((o) => o.status !== "done" && o.status !== "waived" && o.dueOn && o.dueOn >= today && o.dueOn <= in30).length,
    },
    tasks: { open: tk.length, overdue: tk.filter((t) => t.dueOn && t.dueOn < today).length },
    requests: reqs.map((r) => ({ id: r.id, number: r.number, service: r.service, status: r.status, waitingClient: WAITING_ON_CLIENT.includes(r.status as RequestStatus) })),
    nazara: e ? {
      id: e.id, number: e.number, status: e.status, checklistMissing: (e.checklist ?? []).filter((i) => i.required && i.status === "missing").length,
      appointmentComplete: appointmentMissing.length === 0, appointmentMissing, isPractice: e.isPractice, startedOn: e.startedOn,
    } : null,
  };
}

export async function waqfCenterData(tx: Tx, waqfId: string) {
  const f = await waqfFacts(tx, waqfId);
  return f ? { facts: f, ...waqfCenter(waqfId, f) } : null;
}
