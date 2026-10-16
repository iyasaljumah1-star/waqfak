import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import {
  assets, beneficialOwners, beneficiaryClasses, bodies, bodyMemberships, budgets, conditions, documents, meetings, policies, serviceRequests, services, trustees,
  waqfs, waqfTimelineEvents,
} from "@/server/db/schema";
import { addDays, todayISO } from "@/server/engines/dates";
import { POLICY_TYPES } from "@/server/modules/governance/pure";
import { ASSET_TYPES, assetGaps, isAssetCategory } from "@/server/modules/assets/types";
import { assetMissing, missingItems } from "./pure";
import { draftState } from "./queries";
import { journey, type JourneyFacts } from "./journey";

const ESTABLISH_SERVICES = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09"];

/** Reads what the journey rests on, under the caller's RLS context. */
export async function journeyFacts(tx: Tx, waqfId: string): Promise<JourneyFacts | null> {
  const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (!w) return null;
  // a will plan (a waqf after death, still an idea) is not being established: it has no establishment journey
  if (w.creationMode === "bequest" && w.status === "idea") return null;
  const today = todayISO();
  const d = await draftState(tx, waqfId);
  const st = d?.state ?? null;
  const [ast, cls, cond, trs, docs, reqs, bo, bud, pols, mts, board] = await Promise.all([
    tx.select({ id: assets.id, title: assets.title, category: assets.category, marketValue: assets.marketValue, ownershipDocNo: assets.ownershipDocNo, sharePct: assets.sharePct, details: assets.details }).from(assets).where(and(eq(assets.waqfId, waqfId), isNull(assets.archivedAt))),
    tx.select({ n: count() }).from(beneficiaryClasses).where(eq(beneficiaryClasses.waqfId, waqfId)),
    tx.select({ n: count() }).from(conditions).where(eq(conditions.waqfId, waqfId)),
    tx.select({ n: count() }).from(trustees).where(and(eq(trustees.waqfId, waqfId), eq(trustees.status, "active"))),
    tx.select({ type: documents.docType, n: count() }).from(documents).where(and(eq(documents.waqfId, waqfId), isNull(documents.archivedAt), eq(documents.status, "active"), inArray(documents.docType, ["waqf_deed", "registration_certificate", "ownership_deed", "contract"]))).groupBy(documents.docType),
    tx.select({ id: serviceRequests.id, number: serviceRequests.number, status: serviceRequests.status, code: services.code }).from(serviceRequests).innerJoin(services, eq(services.id, serviceRequests.serviceId))
      .where(and(eq(serviceRequests.waqfId, waqfId), inArray(services.code, ESTABLISH_SERVICES))).orderBy(desc(serviceRequests.createdAt)).limit(20),
    tx.select({ n: count() }).from(beneficialOwners).where(and(eq(beneficialOwners.waqfId, waqfId), isNull(beneficialOwners.archivedAt))),
    tx.select({ year: budgets.fiscalYear }).from(budgets).where(eq(budgets.waqfId, waqfId)).orderBy(desc(budgets.fiscalYear)).limit(1),
    tx.select({ type: policies.policyType, status: policies.status }).from(policies).where(eq(policies.waqfId, waqfId)),
    tx.select({ n: count() }).from(meetings).where(and(eq(meetings.waqfId, waqfId), eq(meetings.status, "held"), gte(meetings.scheduledAt, new Date(`${addDays(today, -365)}T00:00:00Z`)))),
    tx.select({ role: bodyMemberships.role, endsOn: bodyMemberships.endsOn, status: bodyMemberships.status }).from(bodyMemberships).innerJoin(bodies, eq(bodies.id, bodyMemberships.bodyId)).where(and(eq(bodies.waqfId, waqfId), eq(bodies.kind, "board"))),
  ]);
  const docN = (t: string) => Number(docs.find((x) => x.type === t)?.n ?? 0);
  const activeBoard = board.filter((m) => (m.status ?? "active") === "active" && (!m.endsOn || m.endsOn >= today));
  const approvedTypes = new Set(pols.filter((p) => p.status === "approved").map((p) => p.type));
  const assetGapList = ast.map((a) => ({ id: a.id, title: a.title, missing: assetGaps({ ...a, details: a.details as Record<string, string> }) })).filter((a) => a.missing.length);
  // a document a type needs for completeness (e.g. a deed for real estate, a contract for usufruct)
  const needsOwnership = ast.some((a) => a.category === "real_estate");
  const needsContract = ast.some((a) => isAssetCategory(a.category) && ASSET_TYPES[a.category].docs.some((x) => x.type === "contract" && x.required));
  return {
    today,
    waqf: { id: w.id, status: w.status, updatedAt: w.updatedAt.toISOString(), deedNo: w.deedNo, deedDate: w.deedDate ?? w.deedDateHijri, documentedOn: w.documentedOn, registeredOn: w.registeredOn, nazirMode: w.nazirMode },
    wizard: st ? {
      finished: !!st.finishedAt, step: st.step, completed: st.completed, missing: missingItems(st), updatedAt: w.updatedAt.toISOString(), nazaraMode: st.nazara.mode,
      assets: st.assets.map((a, index) => ({ id: null, index, title: a.title, missing: assetMissing(a) })).filter((a) => a.missing.length), assetCount: st.assets.length,
      boardMembers: st.nazara.members.filter((m) => m.name.trim()).length, boardChair: st.nazara.members.some((m) => m.role === "chair"),
    } : null,
    file: {
      assets: ast.length, assetGaps: assetGapList, ownershipDocs: docN("ownership_deed") + (needsContract ? docN("contract") : 0), needsOwnershipDocs: needsOwnership || needsContract,
      classes: Number(cls[0]?.n ?? 0), conditions: Number(cond[0]?.n ?? 0), trustees: Number(trs[0]?.n ?? 0),
      board: board.length ? { members: activeBoard.length, chair: activeBoard.some((m) => m.role === "chair") } : null,
    },
    docs: { deed: docN("waqf_deed"), registration: docN("registration_certificate") },
    requests: reqs.map((r) => ({ id: r.id, number: r.number, code: r.code, status: r.status })),
    ops: { bo: Number(bo[0]?.n ?? 0), budgetCurrent: bud[0]?.year === Number(today.slice(0, 4)), policiesApproved: POLICY_TYPES.filter(([t]) => approvedTypes.has(t)).length, policiesTotal: POLICY_TYPES.length, meetings12m: Number(mts[0]?.n ?? 0) },
  };
}

export async function journeyOf(tx: Tx, waqfId: string) {
  const f = await journeyFacts(tx, waqfId);
  return f ? { facts: f, ...journey(f) } : null;
}

const STAGE_TITLE = ["تأسيس", "توثيق وتسجيل", "تشغيل", "مأسسة", "استدامة"];

/**
 * Keeps the waqf's stage (shown across the platform) equal to what its records prove, in both directions: a change to
 * earlier data that reopens a step brings the stage back. A change is recorded on the file's timeline.
 */
export async function syncJourney(tx: Tx, waqfId: string, actorId: string | null) {
  const j = await journeyOf(tx, waqfId);
  if (!j) return null;
  const [w] = await tx.select({ stage: waqfs.stage }).from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (w && w.stage !== j.stage) {
    await tx.update(waqfs).set({ stage: j.stage }).where(eq(waqfs.id, waqfId));
    await tx.insert(waqfTimelineEvents).values({ waqfId, type: "establish", occurredOn: todayISO(), stage: j.stage, createdBy: actorId,
      title: j.stage > w.stage ? `الانتقال إلى مرحلة «${STAGE_TITLE[j.stage - 1]}»` : `العودة إلى مرحلة «${STAGE_TITLE[j.stage - 1]}» بعد تعديل بيانات سابقة`, details: j.statusLabel });
  }
  return j;
}

/**
 * Re-evaluates the stage after a change made by any member of the file. The evaluation reads the whole file (a member's
 * own view may not show every document), so it runs with the system context for its reads and the stage write only,
 * then restores the caller's identity in the same transaction.
 */
export async function syncJourneyAfterChange(tx: Tx, waqfId: string, actorId: string) {
  const prev = await tx.execute<{ u: string | null; g: string | null }>(sql`select current_setting('app.user_id', true) as u, current_setting('app.global_access', true) as g`);
  const u = prev.rows[0]?.u ?? "";
  const g = prev.rows[0]?.g ?? "off";
  await tx.execute(sql`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
  try {
    return await syncJourney(tx, waqfId, actorId);
  } finally {
    await tx.execute(sql`select set_config('app.user_id', ${u}, true), set_config('app.global_access', ${g}, true)`);
  }
}


/** The official instruments in the vault (active, not archived): a waqf deed, a registration certificate. */
export async function evidenceDocs(tx: Tx, waqfId: string) {
  const rows = await tx.select({ t: documents.docType, n: count() }).from(documents)
    .where(and(eq(documents.waqfId, waqfId), isNull(documents.archivedAt), eq(documents.status, "active"), inArray(documents.docType, ["waqf_deed", "registration_certificate"]))).groupBy(documents.docType);
  return { deed: rows.some((r) => r.t === "waqf_deed" && Number(r.n) > 0), registration: rows.some((r) => r.t === "registration_certificate" && Number(r.n) > 0) };
}

/**
 * After an instrument is uploaded: a file whose deed data was already entered becomes «موثّق» once the deed is in the
 * vault, and «مسجّل» once the registration certificate is too. Nothing moves on data alone. Then the stage is re-read.
 */
export async function advanceByEvidence(tx: Tx, waqfId: string, actorId: string) {
  const [w] = await tx.select({ status: waqfs.status, deedNo: waqfs.deedNo, documentedOn: waqfs.documentedOn, registeredOn: waqfs.registeredOn, stage: waqfs.stage }).from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (!w) return;
  if (["idea", "draft", "documenting", "documented"].includes(w.status)) {
    const ev = await evidenceDocs(tx, waqfId);
    let next = w.status;
    if (ev.deed && (w.deedNo || w.documentedOn) && ["idea", "draft", "documenting"].includes(w.status)) next = "documented";
    if (ev.deed && ev.registration && w.registeredOn) next = "registered";
    if (next !== w.status) {
      await tx.update(waqfs).set({ status: next as typeof w.status, updatedBy: actorId }).where(eq(waqfs.id, waqfId));
      await tx.insert(waqfTimelineEvents).values({ waqfId, type: next, occurredOn: todayISO(), stage: w.stage, createdBy: actorId, title: next === "registered" ? "رُفعت شهادة التسجيل: الوقف مسجل" : "رُفع صك الوقف: الوقف موثق", details: null });
    }
  }
  await syncJourneyAfterChange(tx, waqfId, actorId);
}
