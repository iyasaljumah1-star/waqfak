import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { contracts, paymentSchedule, quotes, roles, serviceRequests, settings, userRoles, users } from "@/server/db/schema";
import type { PaymentTerm } from "@/server/db/schema/commerce";
import { toISO, todayISO } from "@/server/engines/dates";
import { rolePermissionMap } from "@/server/authz/context";
import { ledgerOf } from "@/server/modules/commerce/state";
import { splitInstallments } from "@/server/modules/commerce/pure";
import { notify } from "@/server/modules/notify";
import { dueAlerts, dueAlertSettings, initialDueOn, installmentStage, STAGE_AR, type InstallmentInvoice } from "./schedule-pure";

export const DUE_ALERTS_KEY = "billing.due_alerts";

export async function readDueAlertSettings(tx: Tx) {
  const [r] = await tx.select({ v: settings.value }).from(settings).where(eq(settings.key, DUE_ALERTS_KEY)).limit(1);
  return dueAlertSettings(r?.v);
}

/**
 * Creates the schedule rows of every executed contract of a request (initial and amendments) from its quote's payment
 * terms. Idempotent (unique on quote + term): an existing row is never rewritten.
 */
export async function materializeSchedule(tx: Tx, requestId: string, actorId: string | null) {
  const ks = await tx.select().from(contracts).where(and(eq(contracts.requestId, requestId), eq(contracts.status, "signed"), isNotNull(contracts.quoteId)));
  let made = 0;
  for (const k of ks) {
    const [q] = await tx.select().from(quotes).where(eq(quotes.id, k.quoteId!)).limit(1);
    if (!q || q.status !== "accepted") continue;
    const executedOn = k.executedAt ? toISO(k.executedAt) : k.signedAt ? toISO(k.signedAt) : null;
    const parts = splitInstallments(Number(q.net), Number(q.vatRate), q.paymentTerms as PaymentTerm[]);
    const rows = parts.map((t) => ({
      requestId, waqfId: q.waqfId, quoteId: q.id, contractId: k.id, termKey: t.key, label: t.label, percent: String(t.percent),
      net: t.net.toFixed(2), vat: t.vat.toFixed(2), total: t.total.toFixed(2), dueKind: t.due, dueOn: initialDueOn(t, executedOn),
      milestone: t.milestone ?? null, beforeStart: t.beforeStart, series: t.series ?? null,
      history: [{ at: new Date().toISOString(), by: actorId, kind: "created" as const, note: `من العقد ${k.number} والعرض ${q.number} (نسخة ${q.version})` }],
      createdBy: actorId, updatedBy: actorId,
    }));
    if (!rows.length) continue;
    const ins = await tx.insert(paymentSchedule).values(rows).onConflictDoNothing().returning({ id: paymentSchedule.id });
    made += ins.length;
  }
  return made;
}

/** The schedule of a request with each installment's invoices and the separate dates of each step. */
export async function scheduleOf(tx: Tx, requestId: string) {
  const cfg = await readDueAlertSettings(tx);
  const rows = await tx.select().from(paymentSchedule).where(eq(paymentSchedule.requestId, requestId)).orderBy(asc(paymentSchedule.createdAt), asc(paymentSchedule.termKey));
  if (!rows.length) return { rows: [], cfg };
  const ledger = await ledgerOf(tx, requestId);
  const today = todayISO();
  return {
    cfg,
    rows: rows.map((r) => {
      const invs: InstallmentInvoice[] = ledger.invoices.filter((i) => i.quoteId === r.quoteId && i.installmentKey === r.termKey).map((i) => ({
        id: i.id, number: i.number, status: i.status, kind: i.kind, total: Number(i.total), paid: i.paid,
        createdAt: i.createdAt, approvedAt: i.approvedAt, sentAt: i.sentAt, paidOn: i.paidOn,
      }));
      const stage = installmentStage({ dueOn: r.dueOn, total: Number(r.total) }, invs, today, cfg);
      return { ...r, invoices: invs, stage, stageLabel: STAGE_AR[stage] };
    }),
  };
}

/** Active users holding the finance permission (invoice approval). */
export async function financeUserIds(tx: Tx) {
  const map = await rolePermissionMap();
  const keys = [...map.entries()].filter(([, p]) => p.has("admin.finance")).map(([k]) => k);
  if (!keys.length) return [];
  const rows = await tx.select({ id: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(inArray(roles.key, keys), eq(users.status, "active")));
  return [...new Set(rows.map((r) => r.id))];
}

/**
 * Daily step (system context): fills missing schedules of executed contracts, then alerts the finance team before a
 * due date, on it, and after it when unpaid. Never creates an invoice.
 */
/** Fills the schedules of every executed contract the caller can see (idempotent; contracts executed before the schedule existed included). */
export async function materializeAll(tx: Tx, actorId: string | null) {
  const signed = await tx.selectDistinct({ id: contracts.requestId }).from(contracts).where(and(eq(contracts.status, "signed"), isNotNull(contracts.quoteId), isNotNull(contracts.requestId)));
  let created = 0;
  for (const s of signed) created += await materializeSchedule(tx, s.id!, actorId);
  return created;
}

export async function paymentDueAlerts(tx: Tx) {
  const created = await materializeAll(tx, null);
  const cfg = await readDueAlertSettings(tx);
  const today = todayISO();
  const rows = await tx.select({ s: paymentSchedule, number: serviceRequests.number, status: serviceRequests.status }).from(paymentSchedule)
    .innerJoin(serviceRequests, eq(serviceRequests.id, paymentSchedule.requestId)).where(isNotNull(paymentSchedule.dueOn));
  const finance = await financeUserIds(tx);
  let alerts = 0;
  const ledgers = new Map<string, Awaited<ReturnType<typeof ledgerOf>>>();
  for (const { s, number, status } of rows) {
    if (["cancelled", "rejected"].includes(status)) continue;
    const ledger = ledgers.get(s.requestId) ?? (await ledgerOf(tx, s.requestId));
    ledgers.set(s.requestId, ledger);
    const invs = ledger.invoices.filter((i) => i.quoteId === s.quoteId && i.installmentKey === s.termKey).map((i) => ({
      id: i.id, number: i.number, status: i.status, kind: i.kind, total: Number(i.total), paid: i.paid, createdAt: i.createdAt, approvedAt: i.approvedAt, sentAt: i.sentAt, paidOn: i.paidOn,
    }));
    const stage = installmentStage({ dueOn: s.dueOn, total: Number(s.total) }, invs, today, cfg);
    const owed = dueAlerts(s, stage, today, cfg, s.alerts ?? []);
    if (!owed.length) continue;
    for (const a of owed) {
      for (const u of finance) await notify(u, "billing.installment_due", { label: s.label, number, stage: a.text, amount: `${Number(s.total).toFixed(2)} ر.س`, due: s.dueOn }, { waqfId: s.waqfId, link: `/admin/requests/${s.requestId}#billing`, tx });
      alerts++;
    }
    await tx.update(paymentSchedule).set({
      alerts: [...(s.alerts ?? []), ...owed.map((a) => a.key)],
      history: [...(s.history ?? []), ...owed.map((a) => ({ at: new Date().toISOString(), by: null, kind: "alert" as const, note: `${a.text} — أُبلغ ${finance.length} من فريق المالية` }))],
    }).where(eq(paymentSchedule.id, s.id));
  }
  return { schedulesCreated: created, alerts, financeUsers: finance.length };
}

/** Every installment of every request (finance page), with its stage. */
export async function allInstallments(tx: Tx) {
  const cfg = await readDueAlertSettings(tx);
  const rows = await tx.select({ s: paymentSchedule, number: serviceRequests.number }).from(paymentSchedule)
    .innerJoin(serviceRequests, eq(serviceRequests.id, paymentSchedule.requestId)).orderBy(asc(paymentSchedule.dueOn));
  const today = todayISO();
  const ledgers = new Map<string, Awaited<ReturnType<typeof ledgerOf>>>();
  const out = [];
  for (const { s, number } of rows) {
    const ledger = ledgers.get(s.requestId) ?? (await ledgerOf(tx, s.requestId));
    ledgers.set(s.requestId, ledger);
    const invs = ledger.invoices.filter((i) => i.quoteId === s.quoteId && i.installmentKey === s.termKey).map((i) => ({
      id: i.id, number: i.number, status: i.status, kind: i.kind, total: Number(i.total), paid: i.paid, createdAt: i.createdAt, approvedAt: i.approvedAt, sentAt: i.sentAt, paidOn: i.paidOn,
    }));
    const stage = installmentStage({ dueOn: s.dueOn, total: Number(s.total) }, invs, today, cfg);
    out.push({ ...s, requestNumber: number, invoices: invs, stage, stageLabel: STAGE_AR[stage] });
  }
  return { rows: out, cfg };
}


