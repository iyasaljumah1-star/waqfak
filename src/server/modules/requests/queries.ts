import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, notInArray, type SQL } from "drizzle-orm";
import {
  deliverables, documents, recommendations, requestEvents, requestItemEvents, requestItems, requestNotes, requestStages, roles, serviceRequests, services, userRoles, users,
  waqfMemberships, waqfs,
} from "@/server/db/schema";
import { ForbiddenError, loadWaqfAccess, type Auth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import type { Tx } from "@/server/db";
import { assignableRoleKeys, clientRequestFilter, contractState, loadRequestCtx, memberWaqfIdsWith, staffRequestFilter, userHasWaqfPerm } from "./access";
import { availableTransitions, HOLD_PARTY_LABEL, STATUS_LABEL, type RequestStatus } from "./workflow";
import { itemCounts } from "./items-pure";
import { nextAction } from "./journey";
import { todayISO } from "@/server/engines/dates";
import { contractCompanyGaps, invoicePolicy, quoteExpired } from "@/server/modules/commerce/pure";
import { companyProfile, consistencyFor, contractsOf, ledgerOf, prestartUnpaid, quotesOf, signaturesOf, signingState } from "@/server/modules/commerce/state";
import { readSetting } from "./catalog";
import { checkIntake, sanitizeAnswers, summarize } from "./intake/engine";
import { intakeOf, serviceForm, validDocMap } from "./intake/server";

const listCols = {
  id: serviceRequests.id,
  number: serviceRequests.number,
  status: serviceRequests.status,
  priority: serviceRequests.priority,
  waqfId: serviceRequests.waqfId,
  waqfName: waqfs.name,
  serviceCode: services.code,
  serviceName: services.nameAr,
  requesterId: serviceRequests.requesterUserId,
  requesterName: users.fullName,
  assignedToUserId: serviceRequests.assignedToUserId,
  slaDueAt: serviceRequests.slaDueAt,
  conflictCheck: serviceRequests.conflictCheck,
  submittedAt: serviceRequests.submittedAt,
  updatedAt: serviceRequests.updatedAt,
  currentStageKey: serviceRequests.currentStageKey,
};

function baseList(tx: Tx) {
  return tx
    .select(listCols)
    .from(serviceRequests)
    .innerJoin(services, eq(services.id, serviceRequests.serviceId))
    .leftJoin(waqfs, eq(waqfs.id, serviceRequests.waqfId))
    .leftJoin(users, eq(users.id, serviceRequests.requesterUserId));
}
export type RequestListRow = Awaited<ReturnType<typeof baseList>>[number];

/** Client side: my requests (requester) and requests of waqfs where my membership grants requests.view. */
export async function listClientRequests(auth: Auth, opts: { waqfId?: string } = {}) {
  return read(auth, async (tx) => {
    const f = await clientRequestFilter(tx, auth);
    const conds: SQL[] = [f];
    if (opts.waqfId) conds.push(eq(serviceRequests.waqfId, opts.waqfId));
    return (await baseList(tx).where(and(...conds)).orderBy(desc(serviceRequests.updatedAt)).limit(300));
  });
}

export type QueueTab = "mine" | "all" | "unassigned" | "overdue" | "awaiting_client" | "quality";
export const QUEUE_TABS: { key: QueueTab; label: string; opsOnly?: boolean }[] = [
  { key: "mine", label: "المسندة إليّ" },
  { key: "all", label: "كل الطلبات المفتوحة", opsOnly: true },
  { key: "unassigned", label: "غير مسندة", opsOnly: true },
  { key: "overdue", label: "متأخرة عن المهلة" },
  { key: "awaiting_client", label: "بانتظار العميل" },
  { key: "quality", label: "مراجعة الجودة" },
];
const CLOSED: RequestStatus[] = ["closed", "cancelled", "rejected"];

export type QueueFilters = { service?: string; status?: string; assignee?: string; from?: string; to?: string };

/** Staff queue. Non-ops staff see ONLY requests assigned to them, whatever the tab or filter. */
export async function staffQueue(auth: Auth, tab: QueueTab, q?: string, f: QueueFilters = {}) {
  return read(auth, async (tx) => {
    const conds: (SQL | undefined)[] = [staffRequestFilter(auth)];
    if (f.service && /^[A-Z]\d{2}$/.test(f.service)) conds.push(eq(services.code, f.service));
    if (f.status && f.status in STATUS_LABEL) conds.push(eq(serviceRequests.status, f.status as RequestStatus));
    if (f.assignee === "none") conds.push(isNull(serviceRequests.assignedToUserId));
    else if (f.assignee && /^[0-9a-f-]{36}$/i.test(f.assignee)) conds.push(eq(serviceRequests.assignedToUserId, f.assignee));
    if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(serviceRequests.createdAt, new Date(`${f.from}T00:00:00+03:00`)));
    if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(serviceRequests.createdAt, new Date(`${f.to}T23:59:59+03:00`)));
    const ops = auth.perms.has("admin.requests.all");
    switch (tab) {
      case "mine":
        conds.push(eq(serviceRequests.assignedToUserId, auth.user.id), notInArray(serviceRequests.status, CLOSED));
        break;
      case "all":
        conds.push(notInArray(serviceRequests.status, CLOSED));
        break;
      case "unassigned":
        conds.push(isNull(serviceRequests.assignedToUserId), notInArray(serviceRequests.status, CLOSED));
        break;
      case "overdue":
        conds.push(lt(serviceRequests.slaDueAt, new Date()), notInArray(serviceRequests.status, [...CLOSED, "completed", "on_hold", "awaiting_client", "quote", "awaiting_contract", "awaiting_client_approval"]));
        break;
      case "awaiting_client":
        conds.push(inArray(serviceRequests.status, ["awaiting_client", "quote", "awaiting_contract", "awaiting_client_approval"]));
        break;
      case "quality":
        conds.push(eq(serviceRequests.status, "quality_review"));
        break;
    }
    if (!ops && (tab === "all" || tab === "unassigned")) return [];
    let rows = (await baseList(tx).where(and(...conds)).orderBy(asc(serviceRequests.slaDueAt), desc(serviceRequests.updatedAt)).limit(300));
    if (q?.trim()) {
      const s = q.trim().toLowerCase();
      rows = rows.filter((r) => [r.number, r.serviceName, r.waqfName, r.requesterName, r.serviceCode].some((x) => x?.toLowerCase().includes(s)));
    }
    return rows;
  });
}

export async function queueCounts(auth: Auth) {
  const tabs: QueueTab[] = ["mine", "unassigned", "overdue", "awaiting_client", "quality"];
  const out: Partial<Record<QueueTab, number>> = {};
  for (const t of tabs) out[t] = (await staffQueue(auth, t)).length;
  return out;
}

/** Staff users eligible for assignment (global role granting staff.requests.assigned). */
export async function assignableStaff(auth: Auth) {
  const keys = await assignableRoleKeys();
  return read(auth, async (tx) => {
    const rows = await tx
      .select({ id: users.id, name: users.fullName, role: roles.key, roleName: roles.nameAr })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.isStaff, true), eq(users.status, "active"), inArray(roles.key, keys)));
    const m = new Map<string, { id: string; name: string; roles: string[] }>();
    for (const r of rows) {
      const e = m.get(r.id) ?? { id: r.id, name: r.name ?? "موظف", roles: [] };
      e.roles.push(r.roleName ?? r.role);
      m.set(r.id, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  });
}

/** Full request view. `side` decides isolation and what is visible (internal notes/items and unsent drafts are staff-only). */
export async function requestDetail(auth: Auth, id: string, side: "client" | "staff") {
  return read(auth, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, id, side);
    } catch (e) {
      if (e instanceof ForbiddenError) return null;
      throw e;
    }
    const staff = side === "staff";
    const today = todayISO();
    const stages = await tx.select().from(requestStages).where(eq(requestStages.requestId, id)).orderBy(asc(requestStages.position));
    const events = await tx.select().from(requestEvents).where(eq(requestEvents.requestId, id)).orderBy(desc(requestEvents.at));
    const notes = await tx
      .select()
      .from(requestNotes)
      .where(staff ? eq(requestNotes.requestId, id) : and(eq(requestNotes.requestId, id), eq(requestNotes.visibility, "client")))
      .orderBy(asc(requestNotes.createdAt));
    const allDels = await tx.select().from(deliverables).where(eq(deliverables.requestId, id)).orderBy(desc(deliverables.createdAt));
    // The client sees the work once it is released after quality review (or approved), never while in preparation.
    const released = ["awaiting_client_approval", "completed", "closed"].includes(rc.req.status);
    const dels = staff ? allDels : allDels.filter((x) => x.status === "approved" || x.status === "revision_requested" || (released && x.status !== "draft"));
    const docs = await tx.select({ id: documents.id, title: documents.title, confidentiality: documents.confidentiality, docType: documents.docType }).from(documents).where(and(eq(documents.requestId, id), isNull(documents.archivedAt)));
    const cs = await contractState(tx, id);

    // Deficiencies register
    const allItems = await tx.select().from(requestItems).where(eq(requestItems.requestId, id)).orderBy(asc(requestItems.seq));
    const items = staff ? allItems : allItems.filter((i) => i.visibility === "client");
    const itemEvents = items.length ? await tx.select().from(requestItemEvents).where(inArray(requestItemEvents.itemId, items.map((i) => i.id))).orderBy(asc(requestItemEvents.at)) : [];

    // Quotes, contracts, ledger
    const allQuotes = await quotesOf(tx, id);
    const quotesV = staff ? allQuotes : allQuotes.filter((q) => !["draft", "approved"].includes(q.status));
    const allContracts = await contractsOf(tx, id);
    const contractsV = staff ? allContracts : allContracts.filter((k) => !["draft", "approved"].includes(k.status));
    const sigs = await signaturesOf(tx, allContracts.map((k) => k.id));
    const contractsFull = contractsV.map((k) => ({ ...k, signing: signingState(k, sigs), signatures: sigs.filter((x) => x.contractId === k.id) }));
    const ledger = await ledgerOf(tx, id);
    const invs = ledger.invoices;
    const company = staff ? await companyProfile(tx) : null;

    const ids = new Set<string>([rc.req.requesterUserId, ...(rc.req.assignedToUserId ? [rc.req.assignedToUserId] : [])]);
    for (const e of events) if (e.actorUserId) ids.add(e.actorUserId);
    for (const n of notes) ids.add(n.authorId);
    for (const s2 of sigs) ids.add(s2.userId);
    for (const e of itemEvents) if (e.actorUserId) ids.add(e.actorUserId);
    for (const q of allQuotes) for (const u of [q.preparedBy, q.approvedBy, q.respondedBy]) if (u) ids.add(u);
    const people = ids.size ? await tx.select({ id: users.id, name: users.fullName, isStaff: users.isStaff, phone: users.phone }).from(users).where(inArray(users.id, [...ids])) : [];
    const names = new Map(people.map((p) => [p.id, { name: p.name ?? "مستخدم", isStaff: p.isStaff }]));
    const requester = people.find((p) => p.id === rc.req.requesterUserId);
    const transitions = availableTransitions(rc.req.status as RequestStatus, rc.actors, { resumeTo: rc.resumeTo });

    // Intake answers in the form's own words
    const form = serviceForm(rc.service);
    const intake = intakeOf(rc.req);
    const answers = sanitizeAnswers(form, intake.answers ?? {});
    const intakeSummary = intake.answers ? summarize(form, answers) : null;
    const intakeDocs = intake.docs ?? {};
    const check = intake.answers ? checkIntake(form, answers, intakeDocs) : null;
    const states = [
      { label: "البيانات مكتملة", done: check ? check.fieldsComplete : !!rc.req.details, at: rc.req.submittedAt },
      { label: "المستندات المطلوبة مرفقة", done: check ? check.docsComplete : !!rc.req.submittedAt, at: rc.req.submittedAt },
      { label: "تحقق الفريق من البيانات والمستندات", done: !!rc.req.intakeVerifiedAt, at: rc.req.intakeVerifiedAt },
      { label: "قُبل الطلب للخدمة", done: !!rc.req.acceptedAt, at: rc.req.acceptedAt },
      { label: "اعتُمد بدء التنفيذ", done: !!rc.req.startApprovedAt, at: rc.req.startApprovedAt },
      { label: "نُفّذت الخدمة واعتُمدت مخرجاتها", done: !!rc.req.completedAt, at: rc.req.completedAt },
    ];

    // Next action and who owns it
    const counts = itemCounts(allItems);
    const initialQuotes = allQuotes.filter((q) => q.kind === "initial");
    const lastQuote = initialQuotes[0] ?? null;
    const unpaidPrestart = rc.req.status === "awaiting_contract" ? await prestartUnpaid(tx, id) : 0;
    const main = cs.stage;
    const mainSigning = main ? signingState(main, sigs) : null;
    const next = nextAction({
      status: rc.req.status as RequestStatus, assigned: !!rc.req.assignedToUserId, conflictBlocked: rc.req.conflictCheck === "blocked",
      verified: !!rc.req.intakeVerifiedAt, accepted: !!rc.req.acceptedAt, clientItemsOpen: counts.clientOpen, itemsAwaitingReview: counts.awaitingReview,
      quote: lastQuote ? { status: lastQuote.status, expired: quoteExpired(lastQuote, today) } : null, pricingModel: rc.service.pricingModel,
      contract: main ? { status: main.status, pendingClientSigners: (mainSigning?.pending ?? []).filter((p) => p.side === "client").map((p) => p.signerName), companyPending: (mainSigning?.pending ?? []).some((p) => p.side === "company") || (!!mainSigning?.legacy && !mainSigning.executed) } : null,
      prestartUnpaid: unpaidPrestart, holdParty: rc.req.holdParty, holdLabel: rc.req.holdParty ? HOLD_PARTY_LABEL[rc.req.holdParty] : null,
      deliverablesSubmitted: dels.filter((x) => x.status === "submitted").length,
    });
    const consistency = staff ? await consistencyFor(tx, id) : [];
    const signers = staff ? await contractSigners(tx, rc.req.requesterUserId, rc.req.waqfId) : [];
    const vatRate = await readSetting<number | null>(tx, "requests.default_vat_rate", null);
    const validityDays = Number(await readSetting<number>(tx, "quotes.validity_days", 30)) || 30;
    return {
      rc, stages, events, notes, deliverables: dels, docs, contract: cs, invoices: invs, payments: ledger.payments, names, requesterPhone: requester?.phone ?? null, transitions,
      vatRate: vatRate === null ? null : Number(vatRate), items, itemEvents, counts, quotes: quotesV, contracts: contractsFull, company, companyGaps: company ? contractCompanyGaps(company) : [],
      invoicePolicy: company ? invoicePolicy(company) : null, consistency, next, form, answers, intakeSummary, intakeDocs, signers, validityDays, today, unpaidPrestart, states,
    };
  });
}

/** Accounts that may sign a contract for the client side: the requester and waqf members holding contracts.sign. */
async function contractSigners(tx: Tx, requesterId: string, waqfId: string | null) {
  const ids = new Set<string>([requesterId]);
  if (waqfId) {
    const ms = await tx.select({ userId: waqfMemberships.userId }).from(waqfMemberships).where(and(eq(waqfMemberships.waqfId, waqfId), eq(waqfMemberships.status, "active")));
    for (const m of ms) if (await userHasWaqfPerm(tx, m.userId, waqfId, "contracts.sign")) ids.add(m.userId);
  }
  const rows = await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, [...ids]));
  return rows.map((r) => ({ id: r.id, name: r.name ?? "مستخدم", requester: r.id === requesterId }));
}
export type RequestDetail = NonNullable<Awaited<ReturnType<typeof requestDetail>>>;

/** Waqfs where my membership allows requesting services. */
export async function requestableWaqfs(auth: Auth) {
  return read(auth, async (tx) => {
    const ids = await memberWaqfIdsWith(tx, auth, "requests.create");
    if (!ids.length) return [];
    return tx.select({ id: waqfs.id, name: waqfs.name, number: waqfs.internalNumber, waqfakRole: waqfs.waqfakRole }).from(waqfs).where(inArray(waqfs.id, ids)).orderBy(asc(waqfs.name));
  });
}

export async function recommendationForPrefill(auth: Auth, recId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(recId)) return null;
  return read(auth, async (tx) => {
    const [r] = await tx.select().from(recommendations).where(eq(recommendations.id, recId)).limit(1);
    if (!r) return null;
    // RLS hides other waqfs' recommendations; for waqf-less ones require membership-level access anyway
    if (r.waqfId) {
      const ok = (await memberWaqfIdsWith(tx, auth, "requests.create")).includes(r.waqfId);
      if (!ok) return null;
    }
    return r;
  });
}

/** My latest open draft for a service (to resume instead of starting over). */
export async function myDraftFor(auth: Auth, serviceId: string) {
  return read(auth, async (tx) => {
    const [d] = await tx
      .select({ id: serviceRequests.id, number: serviceRequests.number, waqfName: waqfs.name })
      .from(serviceRequests)
      .leftJoin(waqfs, eq(waqfs.id, serviceRequests.waqfId))
      .where(and(eq(serviceRequests.requesterUserId, auth.user.id), eq(serviceRequests.serviceId, serviceId), eq(serviceRequests.status, "draft")))
      .orderBy(desc(serviceRequests.updatedAt))
      .limit(1);
    return d ?? null;
  });
}

/** Data for the intake wizard of a draft: form, saved answers, attached documents and the documents that can be attached. */
export async function intakePageData(auth: Auth, id: string) {
  return read(auth, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, id, "client");
    } catch (e) {
      if (e instanceof ForbiddenError) return null;
      throw e;
    }
    const form = serviceForm(rc.service);
    const intake = intakeOf(rc.req);
    const docMap = await validDocMap(tx, id, rc.req.waqfId, intake.docs);
    const reqDocs = await tx.select({ id: documents.id, title: documents.title, docType: documents.docType }).from(documents)
      .where(and(eq(documents.requestId, id), isNull(documents.archivedAt))).orderBy(desc(documents.createdAt));
    // Waqf documents the user may see (documents.view; confidential ones need documents.view_confidential; never secret).
    const access = rc.req.waqfId ? await loadWaqfAccess(tx, auth, rc.req.waqfId) : null;
    const waqfDocs = rc.req.waqfId && access?.perms.has("documents.view")
      ? (await tx.select({ id: documents.id, title: documents.title, docType: documents.docType, confidentiality: documents.confidentiality }).from(documents)
        .where(and(eq(documents.waqfId, rc.req.waqfId), isNull(documents.requestId), isNull(documents.archivedAt), inArray(documents.docType, [...new Set(form.docs.map((d) => d.docType))])))
        .orderBy(desc(documents.createdAt)).limit(100))
        .filter((d) => d.confidentiality === "internal" || (d.confidentiality === "confidential" && access.perms.has("documents.view_confidential")))
        .map((d) => ({ id: d.id, title: d.title, docType: d.docType }))
      : [];
    const options = [
      ...reqDocs.map((d) => ({ ...d, source: "request" as const })),
      ...waqfDocs.map((d) => ({ ...d, source: "waqf" as const })),
    ];
    return { rc, form, answers: sanitizeAnswers(form, intake.answers ?? {}), docMap, options, canEdit: rc.isRequester || rc.memberCreate };
  });
}
