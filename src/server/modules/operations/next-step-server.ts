import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import type { Auth } from "@/server/authz/context";
import { deliverables, outputs, outputVersions, requestItems, requestLinks, requestRevisions, requestStages, users } from "@/server/db/schema";
import type { RequestCtx } from "@/server/modules/requests/access";
import { contractState } from "@/server/modules/requests/access";
import { currentPlan, selfApprovalCoversQA } from "@/server/modules/requests/engine";
import { advanceStage, HOLD_PARTY_LABEL, type RequestStatus } from "@/server/modules/requests/workflow";
import { awaitingClient } from "@/server/modules/requests/items-pure";
import { checkIntake, sanitizeAnswers, unverifiedSlots, type DocReviewEntry } from "@/server/modules/requests/intake/engine";
import { intakeOf, serviceForm } from "@/server/modules/requests/intake/server";
import { ledgerOf, quotesOf, signingState, signaturesOf } from "@/server/modules/commerce/state";
import { quoteExpired } from "@/server/modules/commerce/pure";
import type { PaymentTerm } from "@/server/db/schema/commerce";
import { outputsFor, SPECIALTY_LABEL } from "@/server/modules/outputs/catalog";
import { approvalCheck, readiness } from "@/server/modules/outputs/pure";
import { preparersOf } from "@/server/modules/outputs/server";
import { todayISO } from "@/server/engines/dates";
import { planRequest, type Snapshot } from "./next-step";

/** Reads everything the execution plan needs, from the viewer's point of view (rights are the viewer's, not assumed). */
export async function requestSnapshot(tx: Tx, auth: Auth, rc: RequestCtx): Promise<Snapshot> {
  const id = rc.req.id;
  const me = auth.user.id;
  const has = (p: string) => auth.perms.has(p);

  // Intake: present vs. verified
  const form = serviceForm(rc.service);
  const intake = intakeOf(rc.req) as ReturnType<typeof intakeOf> & { docReview?: Record<string, DocReviewEntry>; formVersion?: number };
  const legacy = !intake.formVersion;
  const answers = sanitizeAnswers(form, intake.answers ?? {});
  const docs = intake.docs ?? {};
  const check = intake.answers ? checkIntake(form, answers, docs) : null;
  const items = await tx.select().from(requestItems).where(eq(requestItems.requestId, id));
  const acceptedItems = new Set(items.filter((i) => i.status === "accepted").map((i) => i.id));
  const fieldLabel = new Map(form.steps.flatMap((s) => s.fields).map((f) => [f.key, f.label]));
  const unverified = legacy ? [] : unverifiedSlots(form, answers, docs, intake.docReview ?? {}, acceptedItems).filter((s) => (docs[s.key] ?? []).length);

  // Commercial path
  const qs = await quotesOf(tx, id);
  const q = qs.find((x) => x.kind === "initial") ?? null;
  const acceptedQ = qs.find((x) => x.kind === "initial" && x.status === "accepted") ?? null;
  const cs = await contractState(tx, id);
  const k = cs.stage;
  const sigs = k ? await signaturesOf(tx, [k.id]) : [];
  const sign = k ? signingState(k, sigs) : null;
  const ledger = await ledgerOf(tx, id);
  const prestart = acceptedQ ? (acceptedQ.paymentTerms as PaymentTerm[]).filter((t) => t.beforeStart).map((t) => {
    const invs = ledger.invoices.filter((i) => i.quoteId === acceptedQ.id && i.installmentKey === t.key && i.status !== "void" && i.kind !== "credit_note");
    const cur = invs.find((i) => i.status === "draft" || i.status === "approved") ?? invs[0] ?? null;
    return { quoteId: acceptedQ.id, key: t.key, label: t.label, invoiced: invs.length > 0, paid: invs.some((i) => i.status === "paid"), invoiceId: cur?.id ?? null, invoiceStatus: cur?.status ?? null, sendError: cur?.sendResult && !cur.sendResult.ok ? cur.sendResult.error ?? "خطأ غير معروف" : null };
  }) : [];

  // Stages
  const stageRows = await tx.select().from(requestStages).where(eq(requestStages.requestId, id)).orderBy(asc(requestStages.position));
  const plan = await currentPlan(tx, id, rc.stagesDef);
  const canAdvance = rc.req.status === "in_progress" && !!advanceStage(plan);

  // Outputs
  const defs = outputsFor(rc.service);
  const outRows = defs.length ? await tx.select().from(outputs).where(eq(outputs.requestId, id)) : [];
  const vers = outRows.length ? await tx.select().from(outputVersions).where(inArray(outputVersions.outputId, outRows.map((o) => o.id))) : [];
  const dels = await tx.select({ id: deliverables.id, status: deliverables.status, outputId: deliverables.outputId, signedBy: deliverables.signedBy }).from(deliverables).where(eq(deliverables.requestId, id));
  const opinion = rc.workflowCode === "opinion";
  const edits = await tx.select({ at: requestRevisions.at }).from(requestRevisions).where(and(eq(requestRevisions.requestId, id), eq(requestRevisions.kind, "intake_edit")));
  const lastEdit = edits.reduce<Date | null>((m, e) => (!m || e.at > m ? e.at : m), null);
  const outs = [];
  for (const def of defs) {
    const o = outRows.find((x) => x.outputKey === def.key) ?? null;
    const v = o ? vers.find((x) => x.outputId === o.id && x.version === o.currentVersion) : null;
    const ready = v ? readiness(v.sections, v.gaps) : null;
    let viewerCanApprove = false;
    let reason: string | undefined;
    if (o?.status === "in_review") {
      const ck = approvalCheck({ policy: o.reviewPolicy, approverId: me, preparers: await preparersOf(tx, o), canReview: has("staff.quality_review"), isManager: has("admin.requests.all") });
      viewerCanApprove = ck.ok;
      if (!ck.ok) reason = ck.error;
    }
    const del = o?.deliverableId ? dels.find((x) => x.id === o.deliverableId) : null;
    outs.push({
      key: def.key, title: def.title, specialty: SPECIALTY_LABEL[def.specialty], id: o?.id ?? null, status: (o?.status ?? null) as Snapshot["outputs"][number]["status"],
      blocking: (ready?.blocking ?? []).map((g) => ({ label: g.label, fix: g.hint })), unwritten: (ready?.unwritten ?? []).map((u) => u.section),
      returnedNote: o?.status === "returned" ? o.reviewNote : null,
      viewerCanApprove, approveBlockedReason: reason, needsSignature: opinion || def.specialty === "sharia",
      needsRevision: o?.status === "approved" && (!o.deliverableId || del?.status === "revision_requested"),
      stale: !!(v && lastEdit && v.createdAt < lastEdit),
    });
  }
  const isDeliverer = rc.deliverers.includes(me);
  const selfQA = rc.req.status === "quality_review" && rc.isOps && isDeliverer ? await selfApprovalCoversQA(tx, id, outRows) : false;

  const [nz] = rc.service.code === "N01" ? await tx.select({ id: requestLinks.entityId }).from(requestLinks).where(and(eq(requestLinks.requestId, id), eq(requestLinks.entityType, "nazara_engagement"))).limit(1) : [];
  const assignee = rc.req.assignedToUserId ? (await tx.select({ name: users.fullName }).from(users).where(eq(users.id, rc.req.assignedToUserId)).limit(1))[0]?.name ?? null : null;
  return {
    id, status: rc.req.status as RequestStatus, resumeTo: rc.resumeTo, holdParty: rc.req.holdParty, holdLabel: rc.req.holdParty ? HOLD_PARTY_LABEL[rc.req.holdParty] ?? null : null,
    paid: rc.service.pricingModel !== "free", conflictBlocked: rc.req.conflictCheck === "blocked", assigneeName: assignee,
    viewer: {
      id: me, isOps: rc.isOps, isAssignee: rc.isAssignee, canDeliver: has("staff.deliver"), canQA: has("staff.quality_review"),
      canApproveQuote: has("requests.quotes.approve"), canApproveContract: has("admin.contracts.approve"), isDeliverer, canApproveInvoice: has("admin.finance"),
    },
    intake: {
      legacy,
      invalidFields: check ? Object.keys(check.errors).map((key) => fieldLabel.get(key) ?? key) : [],
      missingDocs: check ? check.missingDocs.map((d) => d.label) : [],
      unverifiedDocs: unverified.map((s) => s.label),
      verified: !!rc.req.intakeVerifiedAt, accepted: !!rc.req.acceptedAt,
    },
    items: {
      clientOpen: items.filter(awaitingClient).length,
      awaitingReview: items.filter((i) => i.status === "answered").length,
      internalOpen: items.filter((i) => i.visibility === "internal" && i.status === "open").length,
    },
    quote: q ? { id: q.id, status: q.status, preparedByViewer: q.preparedBy === me, expired: quoteExpired(q, todayISO()) } : null,
    contract: k && sign ? {
      id: k.id, status: k.status, byViewer: k.createdBy === me || k.updatedBy === me,
      pendingClient: sign.legacy ? (sign.clientSigned ? [] : ["العميل"]) : sign.pending.filter((p) => p.side === "client").map((p) => p.signerName || p.name),
      companyPending: !sign.legacy && sign.pending.some((p) => p.side === "company"),
      executed: cs.executed || (sign.legacy && cs.clientSigned), clientSigned: cs.clientSigned,
    } : null,
    prestart,
    stages: stageRows.map((s) => ({ key: s.stageKey, name: s.name, status: s.status })),
    canAdvanceStage: canAdvance,
    outputs: outs,
    deliverables: { submitted: dels.filter((d) => d.status === "submitted").length, unsignedOpinion: opinion ? dels.filter((d) => d.status === "submitted" && !d.signedBy).length : 0 },
    opinion,
    selfQA,
    waqf: { linked: !!rc.req.waqfId, name: rc.waqf?.name ?? null },
    flow: (() => {
      const st = rc.stagesDef;
      const ci = st.findIndex((x) => !!x.clientApproval || x.role === "client");
      return { quality: st.find((x) => x.role === "quality")?.name ?? null, client: ci >= 0 ? st[ci].name : null, after: ci >= 0 ? st.slice(ci + 1).map((x) => x.name) : [] };
    })(),
    acceptVia: rc.service.code === "N01" ? { href: nz ? `/admin/nazara/${nz.id}` : "/admin/nazara", label: "قرار القبول في ملف النظارة", who: "ops" } : null,
  };
}

export async function requestPlan(tx: Tx, auth: Auth, rc: RequestCtx) {
  const snap = await requestSnapshot(tx, auth, rc);
  const plan = planRequest(snap);
  return { snap, ...plan, token: planToken(snap, plan.primary) };
}

/** Fingerprint of the state the primary action was computed from: a stale or repeated click is refused, not re-run. */
export function planToken(s: Snapshot, a: ReturnType<typeof planRequest>["primary"]) {
  const active = s.stages.find((x) => x.status === "active")?.key ?? "";
  const outs = s.outputs.map((o) => `${o.key}=${o.status ?? "-"}`).join(",");
  const body = a ? (a.kind === "run" ? `${a.key}:${JSON.stringify(a.args ?? {})}` : `link:${a.href}`) : "none";
  return `${s.status}|${active}|${s.quote?.status ?? "-"}|${s.contract?.status ?? "-"}|${s.intake.verified ? 1 : 0}${s.intake.accepted ? 1 : 0}|${outs}|${body}`;
}
