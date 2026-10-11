import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  documentLinks, documents, obligationEvents, obligationInstances, obligations, penaltySchedule, regulatoryReferences,
  regulatoryRequirements, reports, riskRegister, users, violations, waqfMemberships, waqfs,
} from "../../db/schema";
import { rolePermissionMap } from "../../authz/context";
import { todayISO } from "../../engines/dates";
import {
  isNotApplicable, parseManual, penaltyInfo, readiness, explain, applicable, MANUAL_CODE,
  type ObligationRow, type WaqfFactBag,
} from "./pure";

export type InstanceView = Awaited<ReturnType<typeof listWaqfInstances>>[number];

const CONF_PERM: Record<string, string> = { internal: "documents.view", confidential: "documents.view_confidential", secret: "documents.view_secret" };

/** Every obligation instance of a waqf with what the compliance tab needs. Runs under the user's RLS context. */
export async function listWaqfInstances(tx: Tx, waqfId: string, opts: { perms?: Set<string>; facts?: WaqfFactBag | null } = {}) {
  const [w] = await tx.select({ sizeClass: waqfs.sizeClass }).from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  const rows = await tx
    .select({
      i: obligationInstances,
      o: obligations,
      refSource: regulatoryReferences.sourceName,
      refCode: regulatoryReferences.code,
      refVerification: regulatoryReferences.verificationStatus,
      reqCode: regulatoryRequirements.code,
      article: regulatoryRequirements.article,
    })
    .from(obligationInstances)
    .innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId))
    .leftJoin(regulatoryRequirements, eq(regulatoryRequirements.id, obligations.requirementId))
    .leftJoin(regulatoryReferences, eq(regulatoryReferences.id, regulatoryRequirements.referenceId))
    .where(eq(obligationInstances.waqfId, waqfId))
    .orderBy(sql`${obligationInstances.dueOn} asc nulls last`, asc(obligations.code));
  const ids = rows.map((r) => r.i.id);
  const events = ids.length
    ? await tx.select({ e: obligationEvents, actor: users.fullName }).from(obligationEvents).leftJoin(users, eq(users.id, obligationEvents.actorUserId)).where(inArray(obligationEvents.instanceId, ids)).orderBy(asc(obligationEvents.at))
    : [];
  const links = ids.length
    ? await tx
        .select({ entityId: documentLinks.entityId, id: documents.id, title: documents.title, number: documents.number, conf: documents.confidentiality, status: documents.status })
        .from(documentLinks)
        .innerJoin(documents, eq(documents.id, documentLinks.documentId))
        .where(and(eq(documentLinks.entityType, "obligation_instance"), inArray(documentLinks.entityId, ids), isNull(documents.archivedAt)))
    : [];
  const pens = await tx.select().from(penaltySchedule);
  const evidenceIds = rows.map((r) => r.i.evidenceDocumentId).filter((x): x is string => !!x);
  const evDocs = evidenceIds.length
    ? await tx.select({ id: documents.id, title: documents.title, number: documents.number, conf: documents.confidentiality, status: documents.status }).from(documents).where(inArray(documents.id, evidenceIds))
    : [];
  const penBy = new Map(pens.map((p) => [p.code, p]));
  const evBy = new Map<string, typeof events>();
  for (const e of events) {
    if (!evBy.has(e.e.instanceId)) evBy.set(e.e.instanceId, []);
    evBy.get(e.e.instanceId)!.push(e);
  }
  const canSee = (conf: string) => !opts.perms || opts.perms.has(CONF_PERM[conf] ?? "documents.view_secret");
  const today = todayISO();
  return rows.map(({ i, o, refSource, refCode, refVerification, reqCode, article }) => {
    const ev = evBy.get(i.id) ?? [];
    const manual = o.code === MANUAL_CODE || o.obligationType === "manual" ? parseManual(ev.find((x) => x.e.action === "created")?.e.note) : null;
    const docs = new Map<string, { id: string; title: string; number: string | null; hidden: boolean }>();
    for (const d of [...links.filter((l) => l.entityId === i.id), ...evDocs.filter((d) => d.id === i.evidenceDocumentId)]) {
      docs.set(d.id, { id: d.id, title: canSee(d.conf) ? d.title : "وثيقة مقيدة الاطلاع", number: canSee(d.conf) ? d.number : null, hidden: !canSee(d.conf) });
    }
    const na = isNotApplicable(i.status, i.waivedReason);
    const view = na ? "not_applicable" : i.status;
    const pen = penaltyInfo(o.penaltyCode ? penBy.get(o.penaltyCode) : null, o.severity, w?.sizeClass ?? null);
    return {
      id: i.id,
      waqfId: i.waqfId,
      obligationId: o.id,
      code: o.code,
      title: manual?.title ?? o.titleAr,
      details: manual?.details ?? o.requiredAction,
      manual: !!manual,
      category: o.obligationType,
      authority: o.authority,
      severity: o.severity,
      status: view as "upcoming" | "due_soon" | "overdue" | "done" | "waived" | "not_applicable",
      rawStatus: i.status,
      periodKey: i.periodKey,
      triggerDate: i.triggerDate,
      dueOn: i.dueOn,
      dueImmediately: i.dueImmediately,
      completedAt: i.completedAt,
      completedOn: i.completedAt ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(i.completedAt) : null,
      waivedReason: na ? i.waivedReason!.replace(/^\[غير منطبق\] /, "") : i.waivedReason,
      evidenceRequired: o.evidenceRequired,
      reference: {
        label: manual?.reference ?? o.referenceText,
        source: manual ? null : refSource,
        article,
        text: o.referenceText,
        code: refCode,
        requirement: reqCode,
        pending: o.verificationStatus !== "verified" || refVerification === "pending_verification",
      },
      obligationPending: o.verificationStatus !== "verified",
      notes: o.notes,
      penalty: pen,
      reminders: ev.filter((x) => x.e.action === "reminder").map((x) => ({ at: x.e.at, offset: Number(String(x.e.note ?? "").replace("offset:", "")) })),
      history: ev.map((x) => ({ action: x.e.action, note: x.e.action === "created" && manual ? null : x.e.note, at: x.e.at, actor: x.actor })),
      documents: [...docs.values()],
      why: opts.facts && !manual ? explain(o as ObligationRow, opts.facts) : [],
      applicableNow: opts.facts && !manual ? applicable(o as ObligationRow, opts.facts) : true,
      isLate: !!i.dueOn && i.dueOn < today,
    };
  });
}

export function summarize(items: InstanceView[]) {
  const today = todayISO();
  const counts = { overdue: 0, due_soon: 0, upcoming: 0, done: 0, waived: 0, not_applicable: 0 };
  for (const i of items) counts[i.status]++;
  const r = readiness(items.map((i) => ({ status: i.status === "not_applicable" ? "waived" : i.status, dueOn: i.dueOn, completedOn: i.completedOn })), today);
  return { counts, readiness: r };
}

/** Waqfs where the user holds a membership whose role grants compliance.view (personal calendar scope). */
export async function myComplianceWaqfs(tx: Tx, userId: string) {
  const map = await rolePermissionMap();
  const mems = await tx
    .select({ waqfId: waqfMemberships.waqfId, roleKey: waqfMemberships.roleKey, endsAt: waqfMemberships.endsAt, name: waqfs.name })
    .from(waqfMemberships)
    .innerJoin(waqfs, eq(waqfs.id, waqfMemberships.waqfId))
    .where(and(eq(waqfMemberships.userId, userId), eq(waqfMemberships.status, "active")));
  const now = new Date();
  const out = new Map<string, string>();
  for (const m of mems) {
    if (m.endsAt && m.endsAt <= now) continue;
    if (map.get(m.roleKey)?.has("compliance.view")) out.set(m.waqfId, m.name);
  }
  return [...out.entries()].map(([id, name]) => ({ id, name }));
}

export type CalendarItem = Awaited<ReturnType<typeof calendarItems>>[number];

export async function calendarItems(tx: Tx, waqfIds: string[]) {
  if (!waqfIds.length) return [];
  const rows = await tx
    .select({
      id: obligationInstances.id, waqfId: obligationInstances.waqfId, waqfName: waqfs.name, status: obligationInstances.status, waivedReason: obligationInstances.waivedReason,
      dueOn: obligationInstances.dueOn, code: obligations.code, title: obligations.titleAr, category: obligations.obligationType, severity: obligations.severity,
      referenceText: obligations.referenceText, obligationType: obligations.obligationType,
    })
    .from(obligationInstances)
    .innerJoin(obligations, eq(obligations.id, obligationInstances.obligationId))
    .innerJoin(waqfs, eq(waqfs.id, obligationInstances.waqfId))
    .where(inArray(obligationInstances.waqfId, waqfIds))
    .orderBy(sql`${obligationInstances.dueOn} asc nulls last`);
  const manualIds = rows.filter((r) => r.obligationType === "manual").map((r) => r.id);
  const notes = manualIds.length
    ? await tx.select({ id: obligationEvents.instanceId, note: obligationEvents.note }).from(obligationEvents).where(and(inArray(obligationEvents.instanceId, manualIds), eq(obligationEvents.action, "created")))
    : [];
  const manualTitle = new Map(notes.map((n) => [n.id, parseManual(n.note)?.title]));
  return rows.map((r) => ({
    ...r,
    title: manualTitle.get(r.id) ?? r.title,
    status: (isNotApplicable(r.status, r.waivedReason) ? "not_applicable" : r.status) as string,
  }));
}

export async function listViolations(tx: Tx, waqfId: string) {
  return tx
    .select({ v: violations, title: penaltySchedule.titleAr, category: penaltySchedule.category, dismissalRisk: penaltySchedule.dismissalRisk, verification: penaltySchedule.verificationStatus })
    .from(violations)
    .leftJoin(penaltySchedule, eq(penaltySchedule.code, violations.penaltyCode))
    .where(eq(violations.waqfId, waqfId))
    .orderBy(desc(violations.noticedOn));
}

export async function penaltyOptions(tx: Tx) {
  const rows = await tx.select().from(penaltySchedule).orderBy(asc(penaltySchedule.code));
  return rows;
}

/** Active, visible documents of a waqf to pick as evidence (respecting the confidentiality gate). */
export async function evidenceCandidates(tx: Tx, waqfId: string, perms: Set<string>) {
  const rows = await tx
    .select({ id: documents.id, title: documents.title, number: documents.number, conf: documents.confidentiality, docType: documents.docType, createdAt: documents.createdAt })
    .from(documents)
    .where(and(eq(documents.waqfId, waqfId), isNull(documents.archivedAt), eq(documents.status, "active")))
    .orderBy(desc(documents.createdAt))
    .limit(200);
  return rows.filter((d) => perms.has(CONF_PERM[d.conf] ?? "documents.view_secret"));
}

export async function listReports(tx: Tx, waqfId: string) {
  return tx
    .select({ r: reports, by: users.fullName })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.generatedBy))
    .where(and(eq(reports.waqfId, waqfId), inArray(reports.kind, ["annual", "gaa_package", "compliance"])))
    .orderBy(desc(reports.generatedAt))
    .limit(50);
}

// ───────────── Risk register ─────────────

export async function listRisks(tx: Tx, waqfId: string) {
  return tx
    .select({ r: riskRegister, owner: users.fullName })
    .from(riskRegister)
    .leftJoin(users, eq(users.id, riskRegister.ownerUserId))
    .where(eq(riskRegister.waqfId, waqfId))
    .orderBy(asc(sql`case when ${riskRegister.status} = 'closed' then 1 else 0 end`), desc(sql`${riskRegister.impact} * ${riskRegister.likelihood}`), asc(riskRegister.title));
}

/** Active members of the waqf (risk owners). */
export async function waqfMemberOptions(tx: Tx, waqfId: string) {
  const rows = await tx
    .selectDistinct({ id: users.id, name: users.fullName })
    .from(waqfMemberships)
    .innerJoin(users, eq(users.id, waqfMemberships.userId))
    .where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.status, "active")));
  return rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ar"));
}

/** Nazara outputs visible to waqf members: final records and approved periodic reports (drafts stay with the team). */
export async function listNazaraOutputs(tx: Tx, waqfId: string) {
  return tx
    .select({ r: reports, by: users.fullName })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.generatedBy))
    .where(and(eq(reports.waqfId, waqfId), inArray(reports.kind, ["nazara_periodic", "nazara_takeover", "nazara_handover"]), inArray(reports.status, ["final", "approved"]), isNull(reports.revokedAt)))
    .orderBy(desc(reports.generatedAt))
    .limit(50);
}
