import { viewerMakerRules } from "@/server/modules/approvals/policy";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Eye, FileCheck2, FileDown, FolderOpen } from "lucide-react";
import { Alert, Badge, ButtonLink, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { DocumentList } from "@/components/documents/list";
import { DocumentUploader } from "@/components/documents/uploader";
import {
  CONFLICT_LABEL, ConflictBadge, ContractPaper, CONTACT_LABEL, EventList, IntakeSummaryView, NotesThread, PartiesList, PRIORITY_LABEL,
  QuoteDocument, RequestStates, SlaBadge, StageTimeline, StatusBadge,
} from "@/components/requests/bits";
import { ActionForm, SignContractForm, TransitionPanel } from "@/components/requests/forms";
import { ContractPrepareForm, NoteFormWithAttachment, QuoteEditor, RaiseItemForm, ReviewItemForms, type QuoteSeed } from "@/components/requests/commerce";
import { fmtBoth, fmtDate, fmtDateTime, fmtSAR, WAQFAK_ROLE_LABEL } from "@/lib/utils";
import { addDays as addDaysISO } from "@/server/engines/dates";
import { staffPhone } from "@/server/modules/admin/guard";
import { requireStaff } from "@/server/authz/context";
import { addDeliverable, advanceStageAction, assignRequest, overrideConflict, postStaffNote, staffTransition } from "@/server/modules/requests/actions";
import { acceptRequest, raiseItem, reviewIntakeDoc, reviewItem, verifyIntake, type DocReview } from "@/server/modules/requests/items-actions";
import { IntakeDocReview, type DocReviewRow } from "@/components/requests/doc-review";
import { assignableStaff, requestDetail } from "@/server/modules/requests/queries";
import { HOLD_PARTY_LABEL } from "@/server/modules/requests/workflow";
import { ITEM_EVENT_LABEL, ITEM_KIND_LABEL, ITEM_STATUS_TONE, itemStatusLabel } from "@/server/modules/requests/items-pure";
import { approveContract, countersignContract, prepareContract, requestSignOtp, sendContract, signContract, voidContract } from "@/server/modules/contracts/actions";
import { approveQuote, saveQuote, sendQuote, withdrawQuote } from "@/server/modules/commerce/quote-actions";
import { issueInvoice } from "@/server/modules/billing/actions";
import { CONTRACT_STATUS_LABEL, INVOICE_KIND_LABEL, QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, quoteDisplayStatus, splitInstallments, termWhen } from "@/server/modules/commerce/pure";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "@/server/modules/billing/access";
import { DOC_TYPE_OPTIONS } from "@/server/modules/documents/labels";
import { docRequired, visibleDocs, visibleSteps, visibleFields } from "@/server/modules/requests/intake/engine";
import type { RequestItemStatus } from "@/server/db/schema/commerce";
import { LinksPanel, OutputsPanel, TasksPanel } from "@/components/operations/panels";
import { read } from "@/server/modules/_shared";
import { requestOperations } from "@/server/modules/operations/queries";
import { requestPlan } from "@/server/modules/operations/next-step-server";
import { runNextStep } from "@/server/modules/operations/next-step-actions";
import { ExecutionPanel } from "@/components/operations/execution-panel";
import { InvoiceCycle } from "@/components/billing/invoice-cycle";
import { CommsOverview, ImpactList, RequestSummary, RevisionList, RollbackPanel, Section, SectionNav } from "@/components/requests/workspace";
import { ReviewDecisions, type Decision } from "@/components/requests/review-decisions";
import { StaffIntakeEditor } from "@/components/requests/staff-intake-editor";
import { FieldWorkspaceView } from "@/components/requests/field-workspace";
import { fieldWorkspace } from "@/server/modules/requests/field-workspace";
import { processingPhase } from "@/server/modules/requests/phase";

const PHASE_OWNER_AR = { client: "على العميل", team: "على الفريق", manager: "على مدير التشغيل", none: "—" } as const;
import { createFieldTask, setFieldState } from "@/server/modules/requests/field-actions";
import { workspaceExtras } from "@/server/modules/operations/workspace-server";
import { rollbackRequest, staffEditIntake } from "@/server/modules/operations/revisions-actions";
import { commsChannels, commsHeadline, COMMS_STATE_TONE } from "@/server/modules/operations/comms";
import { WHO_AR } from "@/server/modules/operations/next-step";
import { OUTPUT_STATUS_LABEL } from "@/server/modules/outputs/pure";
import { STATUS_LABEL as REQ_STATUS_LABEL } from "@/server/modules/requests/workflow";
import { ContinuousPanel } from "@/components/operations/continuous-panel";
import { PaymentScheduleTable } from "@/components/billing/payment-schedule";
import { materializeSchedule, scheduleOf } from "@/server/modules/billing/schedule";
import { setInstallmentDue } from "@/server/modules/billing/schedule-actions";
import { continuousView } from "@/server/modules/operations/continuous";
import { CADENCE_AR, clientPreference, continuousSpec, type Cadence } from "@/server/modules/operations/continuous-pure";
import { changeAcceptance, closeCycle, extendTerm, linkCycleMeeting, openCycle, rescheduleCycle, sendCycle, setupTerm, skipCycle, terminateService, toggleCycleCheck } from "@/server/modules/operations/continuous-actions";
import { addMonths as addMonthsISO, toISO } from "@/server/engines/dates";

export const metadata: Metadata = { title: "طلب — مساحة العمل" };

export default async function StaffRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireStaff("admin.access");
  if (!auth.perms.has("staff.requests.assigned") && !auth.perms.has("admin.requests.all")) notFound();
  const d = await requestDetail(auth, id, "staff");
  if (!d) notFound();
  const { rc, stages, events, notes, deliverables, docs, names, today } = d;
  const r = rc.req;
  const ops = rc.isOps;
  const worker = rc.isAssignee || ops;
  const staff = ops ? await assignableStaff(auth) : [];
  const terminal = ["closed", "cancelled", "rejected"].includes(r.status);
  const iDelivered = rc.deliverers.includes(auth.user.id);
  const isOpinion = rc.workflowCode === "opinion";
  const paid = rc.service.pricingModel !== "free";
  const requesterName = names.get(r.requesterUserId)?.name ?? "—";
  const assigneeName = r.assignedToUserId ? names.get(r.assignedToUserId)?.name : null;
  const docOpts = docs.map((x) => ({ id: x.id, title: x.title }));
  const docTitle = new Map(docs.map((x) => [x.id, x.title]));
  const canApproveQuote = auth.perms.has("requests.quotes.approve");
  const canApproveContract = auth.perms.has("admin.contracts.approve");
  const maker = await viewerMakerRules(auth);
  const ops2 = await read(auth, (tx) => requestOperations(tx, auth, rc));
  const plan = await read(auth, (tx) => requestPlan(tx, auth, rc));
  // the request's fields, the waqf-file records the service reads, their review states, analysis, notes and tasks
  const fws = r.intakeFormVersion ? await read(auth, (tx) => fieldWorkspace(tx, rc, "staff")) : null;
  const sched = paid ? await read(auth, async (tx) => { await materializeSchedule(tx, r.id, null); return scheduleOf(tx, r.id); }) : null;
  const cont = continuousSpec(rc.service.code) ? await read(auth, (tx) => continuousView(tx, auth, rc)) : null;
  const contStart = cont?.contract?.executedAt ? toISO(cont.contract.executedAt) : r.startApprovedAt ? toISO(r.startApprovedAt) : today;
  const termMonths = Number(d.answers.termMonths) > 0 ? Number(d.answers.termMonths) : 12;
  const contDefaults = {
    startOn: contStart, endOn: addDaysISO(cont?.quote?.durationDays ? addDaysISO(contStart, cont.quote.durationDays) : addMonthsISO(contStart, termMonths), -1),
    // Preselected only from the accepted quote or a documented preset; otherwise left unset for the user to fix from the contract.
    cadence: ((cont?.quoteCadence?.cadence as Cadence | undefined) ?? cont?.spec.cadence ?? null) as Cadence | null,
    customDates: (cont?.quoteCadence?.customDates ?? []).map((x) => `${x.due} | ${x.label}`).join("\n"),
    clientPreference: clientPreference(d.answers),
  };

  // Quotes
  const initial = d.quotes.filter((q) => q.kind === "initial");
  const amendments = d.quotes.filter((q) => q.kind === "amendment");
  const acceptedInitial = initial.find((q) => q.status === "accepted");
  const openDraft = (kind: string) => d.quotes.find((q) => q.kind === kind && q.status === "draft");
  const canNewInitial = paid && worker && !acceptedInitial && (["triage", "awaiting_client", "quote"].includes(r.status) || (r.status === "awaiting_contract" && !initial.length && !d.contract.stage));
  const canNewAmendment = paid && worker && !!acceptedInitial && d.contract.executed && ["awaiting_contract", "in_progress", "quality_review", "awaiting_client_approval"].includes(r.status);
  const seedFrom = (kind: "initial" | "amendment"): QuoteSeed => {
    const draft = openDraft(kind);
    const base = draft ?? d.quotes.find((q) => q.kind === kind);
    const validUntil = draft?.validUntil && draft.validUntil >= today ? draft.validUntil : addDaysISO(today, d.validityDays);
    if (base) {
      return {
        quoteId: draft?.id, kind, scope: base.scope, deliverables: base.deliverables ?? "", exclusions: base.exclusions ?? "", assumptions: base.assumptions ?? "",
        clientObligations: base.clientObligations ?? "", durationDays: String(base.durationDays ?? ""), discount: String(Number(base.discount)), validUntil,
        lines: base.lines.map((l) => ({ description: l.description, qty: String(l.qty), unit: String(l.unit) })),
        deliveryCadence: base.deliverySchedule?.cadence ?? "", deliveryDates: (base.deliverySchedule?.customDates ?? []).map((x) => `${x.due} | ${x.label}`).join("\n"),
        terms: base.paymentTerms.map((t) => ({ label: t.label, percent: String(t.percent), due: t.due, beforeStart: t.beforeStart, dueOn: t.dueOn ?? undefined, milestone: t.milestone ?? undefined, series: t.series ?? undefined })),
      };
    }
    const days = rc.service.slaDays ?? rc.stagesDef.reduce((s, x) => s + x.slaDays, 0);
    return {
      kind, scope: kind === "amendment" ? "" : rc.service.summary, deliverables: kind === "amendment" ? "" : rc.service.outputs ?? "", exclusions: "", assumptions: "", clientObligations: "",
      durationDays: days ? String(days) : "", discount: "0", validUntil,
      lines: [{ description: kind === "amendment" ? "" : `${rc.service.nameAr} (${rc.service.code})`, qty: "1", unit: rc.service.basePrice ? String(Number(rc.service.basePrice)) : "" }],
      terms: [],
    };
  };

  // Contracts
  const contractsByQuote = (qid: string) => d.contracts.filter((k) => k.quoteId === qid);
  const liveContract = (qid: string) => contractsByQuote(qid).find((k) => k.status !== "void");
  const needsContract = d.quotes.filter((q) => q.status === "accepted" && !liveContract(q.id) && (q.kind === "initial" ? r.status === "awaiting_contract" : d.contract.executed));
  const ans = d.answers;
  const partySeed = (() => {
    const cap = String(ans.capacity ?? "");
    const base = { idLabel: "", idNumber: "", signerUserId: r.requesterUserId, authorityRef: "", authorityDocumentId: "" };
    if (cap === "agent") return [{ ...base, name: String(ans.principalName ?? ""), capacity: "عميل", authorityType: "agent", authorityRef: String(ans.poaNumber ?? ""), authorityDocumentId: d.intakeDocs.poa?.[0] ?? "" }];
    if (cap === "entity_rep") return [{ ...base, name: String(ans.entityName ?? ""), capacity: "جهة اعتبارية", idLabel: "الرقم الوطني الموحد", idNumber: String(ans.entityNumber ?? ""), authorityType: "legal_rep", authorityRef: String(ans.entityPosition ?? ""), authorityDocumentId: d.intakeDocs.authorization?.[0] ?? "" }];
    if (cap === "nazir" && rc.waqf) return [{ ...base, name: rc.waqf.name, capacity: "وقف", authorityType: "nazir" }];
    return [{ ...base, name: String(ans.contactName ?? requesterName), capacity: cap === "waqif" ? "واقف" : "عميل", authorityType: "self" }];
  })();

  // Billing
  const acceptedQuotes = d.quotes.filter((q) => q.status === "accepted");
  const invOf = (qid: string, key: string) => d.invoices.filter((i) => i.quoteId === qid && i.installmentKey === key && i.status !== "void" && i.kind !== "credit_note");
  const legacyInvoice = !d.quotes.length && !d.invoices.some((i) => ["issued", "partially_paid", "paid"].includes(i.status) && i.kind !== "proforma") && !["draft", "submitted", "cancelled", "rejected"].includes(r.status) && (d.contract.contract ? d.contract.clientSigned : !!(r.agreedPrice ?? r.quoteAmount));

  // Item form helpers
  const fieldOptions = visibleSteps(d.form, ans).flatMap((st) => visibleFields(st, ans).map((f) => ({ value: f.key, label: `${st.title}: ${f.label}` })));
  const itemEvents = (itemId: string) => d.itemEvents.filter((e) => e.itemId === itemId);
  const docReview = ((r.intake ?? {}) as { docReview?: Record<string, DocReview> }).docReview ?? {};
  const acceptedItems = new Set(d.items.filter((i) => i.status === "accepted").map((i) => i.id));
  const docRows: DocReviewRow[] = r.intakeFormVersion ? visibleDocs(d.form, ans).filter((s) => d.intakeDocs[s.key]?.length || docRequired(s, ans)).map((s) => ({
    slot: s.key, label: s.label, required: docRequired(s, ans),
    docs: (d.intakeDocs[s.key] ?? []).map((id) => {
      const v = docReview[id];
      return { id, title: docTitle.get(id) ?? "مستند", review: v ? { status: v.status, byName: names.get(v.by)?.name ?? "الفريق", at: fmtDateTime(new Date(v.at)), note: v.note } : null };
    }),
    replacedOk: Object.values(docReview).some((v) => v.slot === s.key && v.status === "rejected" && !!v.itemId && acceptedItems.has(v.itemId)),
  })) : [];
  // ── Workspace: summary, sections, communications
  const wx = await read(auth, (tx) => workspaceExtras(tx, auth, rc));
  const activeStage = stages.find((s) => s.status === "active");
  const outSummary = ops2.outputs.length
    ? ops2.outputs.map((o) => `${o.def.title}: ${o.o ? (o.o.status === "approved" && ["awaiting_client_approval", "completed", "closed"].includes(r.status) ? "مُسلَّم" : OUTPUT_STATUS_LABEL[o.o.status]) : "لم تُعدّ"}`).join("، ")
    : deliverables.length ? `${deliverables.length} تسليم` : "لا مخرجات بعد";
  const lastQuote = d.quotes.find((q) => q.kind === "initial");
  const openInv = d.invoices.filter((i) => i.status !== "void" && i.kind !== "credit_note");
  const INV_SHORT: Record<string, string> = { draft: "مسودة", approved: "معتمدة لم تُرسل", paid: "مدفوعة", partially_paid: "مدفوعة جزئيًا", issued: "مرسلة" };
  const invSummary = openInv.length ? openInv.map((i, n) => <span key={i.id}>{n ? "، " : ""}<bdi dir="ltr" className="tabular">{i.number}</bdi> {INV_SHORT[i.status] ?? i.status}</span>) : "لا فواتير";
  const blockersCount = (plan.current?.blockers.length ?? 0) + (plan.held ? 1 : 0);
  const waiting = plan.terminal ? "—" : plan.held ? WHO_AR[plan.held.who] : plan.current ? WHO_AR[plan.current.owner] : "—";
  const phase = processingPhase({
    status: r.status, assigned: !!r.assignedToUserId,
    data: fws ? { requiredMissing: fws.analysis.summary.required - fws.analysis.summary.requiredValid, gaps: fws.analysis.summary.gaps, conflicts: fws.analysis.summary.conflicts } : null,
    openClientItems: d.counts.clientOpen, outputs: wx.outputsLite.map((o) => ({ status: o.status, delivered: !!o.deliverableId })),
  });
  const summaryItems = [
    { label: "مرحلة المعالجة", value: <span data-testid="summary-phase" data-phase={phase.phase}>{phase.label} — التالي: {phase.next} ({PHASE_OWNER_AR[phase.owner]})</span> },
    { label: "العميل", value: requesterName },
    { label: "الحالة", value: REQ_STATUS_LABEL[r.status as keyof typeof REQ_STATUS_LABEL] ?? r.status },
    { label: "المرحلة الحالية", value: activeStage?.name ?? "—" },
    { label: "الإجراء المطلوب الآن", value: plan.terminal ? "لا شيء — الطلب منتهٍ" : plan.current?.title ?? "اكتملت الخطوات", testId: "summary-action" },
    { label: "بانتظار", value: waiting, testId: "summary-waiting" },
    { label: "النواقص والموانع", value: blockersCount || d.counts.clientOpen ? `${blockersCount} مانع · ${d.counts.clientOpen} بانتظار العميل` : "لا موانع", tone: (blockersCount ? "warn" : "ok") as "warn" | "ok" },
    ...(cont ? [
      { label: "مدة الخدمة", value: cont.term ? `${cont.termLabel} — ${cont.term.startOn} إلى ${cont.effectiveEnd}` : "لم تُحدد", testId: "summary-term" },
      { label: "الدورات", value: `${cont.counts.done} مكتملة · ${cont.counts.late} متأخرة · ${cont.counts.pending} مفتوحة${cont.next ? ` · التالية تستحق ${cont.next.due}` : ""}`, tone: (cont.counts.late ? "warn" : "ok") as "warn" | "ok", testId: "summary-cycles" },
    ] : [{ label: "المخرجات", value: outSummary }]),
    ...(paid ? [
      { label: "العرض المالي", value: lastQuote ? <><bdi dir="ltr" className="tabular">{lastQuote.number}</bdi> {QUOTE_STATUS_LABEL[lastQuote.status as keyof typeof QUOTE_STATUS_LABEL] ?? lastQuote.status}</> : "لا عرض بعد" },
      { label: "الفواتير", value: <>{invSummary}</>, testId: "summary-invoices" },
    ] : [{ label: "الرسوم", value: "خدمة مجانية — بلا عرض ولا فاتورة" }, { label: "الوقف", value: rc.waqf?.name ?? "بلا وقف" }]),
    { label: "المختص", value: assigneeName ?? "غير مسند — ينفّذ المدير المخوّل مباشرة" },
    ...(paid ? [{ label: "الوقف", value: rc.waqf?.name ?? "بلا وقف" }] : []),
    { label: "تاريخ التقديم", value: r.submittedAt ? fmtDate(r.submittedAt) : "لم يُقدَّم بعد" },
    ...(fws ? [{ label: "اكتمال البيانات", value: <a className="underline-offset-4 hover:underline" href="#intake">{fws.analysis.summary.completeness}% · {fws.analysis.summary.approved} معتمدة · {fws.analysis.summary.gaps} نقص</a>, tone: (fws.analysis.summary.gaps || fws.analysis.summary.conflicts ? "warn" : "ok") as "warn" | "ok", testId: "summary-completeness" }] : []),
    ...(fws ? [{ label: "مهام الحقول المفتوحة", value: String(Object.values(fws.tasks).flat().filter((t) => t.status === "todo" || t.status === "in_progress").length) }] : []),
    { label: "مواعيد مهمة", value: [r.slaDueAt ? `الاستحقاق ${fmtDate(r.slaDueAt)}` : null, typeof d.answers.deadline === "string" ? `موعد العميل ${fmtDate(d.answers.deadline)}` : null].filter(Boolean).join(" · ") || "—" },
  ];
  const channelsRaw = commsChannels({
    items: d.items, notes: notes.map((n) => ({ id: n.id, visibility: n.visibility, authorIsStaff: !!names.get(n.authorId)?.isStaff, createdAt: n.createdAt })),
    outputs: wx.outputsLite, quotes: d.quotes, deliverables,
  });
  const CH_HREF: Record<string, string> = { requests: "#items", replies: "#items", client: "#client-messages", internal: "#internal-notes", review: "#review-notes", decisions: "#review-notes" };
  const channels = channelsRaw.map((c) => ({ ...c, href: CH_HREF[c.key] }));
  const headline = commsHeadline(channelsRaw);
  const decisions: Decision[] = [
    ...d.quotes.filter((q) => q.respondedAt).map((q) => ({ at: q.respondedAt!, label: `العرض ${q.number} — ${QUOTE_STATUS_LABEL[q.status as keyof typeof QUOTE_STATUS_LABEL] ?? q.status}`, note: q.responseNote, tone: (q.status === "accepted" ? "ok" : "fine") as Decision["tone"] })),
    ...wx.outputsLite.filter((o) => o.status === "returned" && o.reviewNote).map((o) => ({ at: null, label: `أعاد المراجع «${o.title}» للتعديل`, note: o.reviewNote, tone: "fine" as const, open: true })),
    ...ops2.outputs.filter((o) => o.o?.status === "approved" && o.o.approvedAt).map((o) => ({ at: o.o!.approvedAt!, label: `اعتُمد «${o.def.title}»${o.o!.selfApproved ? " (اعتماد ذاتي)" : ""}`, note: null, tone: "ok" as const })),
    ...deliverables.filter((x) => x.status === "revision_requested").map((x) => ({ at: null, label: `طلب العميل تعديل «${x.title}»`, note: x.revisionNote, tone: "fine" as const, open: true })),
    ...deliverables.filter((x) => x.status === "approved" && x.approvedAt).map((x) => ({ at: x.approvedAt!, label: `اعتمد العميل «${x.title}»`, note: null, tone: "ok" as const })),
    ...d.invoices.filter((i) => i.approvedAt).map((i) => ({ at: i.approvedAt!, label: `اعتُمدت الفاتورة ${i.number}${i.selfApproved ? " (اعتماد ذاتي)" : ""}`, note: null, tone: "ok" as const })),
  ];
  const navSections = [
    ...(cont ? [{ id: "service", label: "الخدمة المستمرة", note: cont.counts.late ? `${cont.counts.late} متأخرة` : cont.termLabel ?? "لم تُحدد المدة", tone: (cont.counts.late ? "warn" : "info") as "warn" | "info" }] : []),
    { id: "work", label: "العمل والمهام", note: plan.current && !plan.terminal ? WHO_AR[plan.current.owner] : undefined, tone: "info" as const },
    { id: "data", label: "البيانات والمستندات", note: r.intakeVerifiedAt ? "متحقق منها" : "لم يُتحقق", tone: (r.intakeVerifiedAt ? "ok" : "warn") as "ok" | "warn" },
    { id: "comms", label: "المراسلات والنواقص", note: headline.state === "clear" ? undefined : channelsRaw.find((c) => c.state === headline.state)?.title, tone: COMMS_STATE_TONE[headline.state] },
    ...(paid ? [{ id: "commerce", label: "العرض والعقد والفوترة" }] : []),
    { id: "outputs", label: "المخرجات" },
    { id: "history", label: "السجل", note: wx.revisions.length ? `${wx.revisions.length} تصحيح` : undefined },
  ];
  const staffTransitions = d.transitions.filter((t) => t.to !== "quote" && !(r.status === "quote" && t.to === "awaiting_contract"));

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/admin/requests", label: "الطلبات" }, { label: r.number }]}
        title={rc.service.nameAr}
        description={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="tabular">{r.number}</span><StatusBadge status={r.status} /><ConflictBadge value={r.conflictCheck} /><SlaBadge due={r.slaDueAt} status={r.status} /></span>}
        actions={r.waqfId ? <ButtonLink href={auth.perms.has("admin.waqfs.all") ? `/admin/waqfs/${r.waqfId}` : `/app/w/${r.waqfId}`} variant="secondary" size="sm"><FolderOpen aria-hidden className="size-4" />ملف الوقف</ButtonLink> : null}
      />

      {r.conflictCheck === "blocked" ? (
        <Alert tone="critical" title="تعارض استقلال — العمل متوقف حتى القرار">
          <p className="whitespace-pre-line">{r.conflictNote}</p>
          {ops ? (
            <details className="mt-3">
              <summary className="cursor-pointer font-medium text-ink">اعتماد استثناء مسبب</summary>
              <div className="mt-3 rounded-md bg-surface p-3 text-text">
                <ActionForm action={overrideConflict} hidden={{ id: r.id }} submit="اعتمد الاستثناء" variant="danger">
                  <Field label="المبرر" name="justification" required hint="يُسجل في سجل العمليات مع اسمك. اذكر لماذا لا يخل الاستثناء باستقلال الرأي.">
                    <Textarea name="justification" required minLength={20} />
                  </Field>
                </ActionForm>
              </div>
            </details>
          ) : <p className="mt-1">يقرر مدير التشغيل: رفض الطلب أو اعتماد استثناء مسبب.</p>}
        </Alert>
      ) : r.conflictCheck === "override_approved" ? (
        <Alert tone="seal" title="استثناء معتمد من قاعدة الاستقلال"><p className="whitespace-pre-line">{r.conflictNote}</p></Alert>
      ) : null}
      {r.status === "on_hold" ? (
        <Alert tone="fine" title={`معلّق — بانتظار ${HOLD_PARTY_LABEL[r.holdParty ?? ""] ?? "طرف آخر"}`}>{r.holdReason}{r.holdFollowUpOn ? ` · المتابعة ${fmtBoth(r.holdFollowUpOn)}` : ""}</Alert>
      ) : null}
      {r.status === "quality_review" && iDelivered ? (
        <Alert tone="info" title="مبدأ العينين الأربع">أنت من أعدّ المخرجات، لذلك تُراجع الجودة من زميل آخر يحمل صلاحية مراجعة الجودة.</Alert>
      ) : null}
      {d.consistency.length ? (
        <Alert tone={d.consistency.some((x) => x.level === "error") ? "critical" : "fine"} title="فحص الاتساق بين العرض والعقد والفواتير والمدفوعات">
          <ul className="list-disc ps-5">{d.consistency.map((x) => <li key={x.text}>{x.text}</li>)}</ul>
        </Alert>
      ) : null}


      <RequestSummary items={summaryItems} />
      <ExecutionPanel action={runNextStep} requestId={r.id} token={plan.token} steps={plan.steps} current={plan.current} primary={plan.primary} held={plan.held} terminal={plan.terminal} />
      <SectionNav sections={navSections} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          {cont ? (
            <Section id="service" title="الخدمة المستمرة ودورات التسليم">
              <ContinuousPanel v={cont} requestId={r.id} status={r.status} worker={worker} ops={ops} canDeliver={auth.perms.has("staff.deliver")} nextAction={plan.terminal ? null : plan.current?.title ?? null} defaults={contDefaults}
                a={{ setupTerm, extendTerm, terminateService, openCycle, toggleCycleCheck, linkCycleMeeting, rescheduleCycle, sendCycle, closeCycle, skipCycle, raiseItem, changeAcceptance }}
                schedule={sched?.rows ?? []} />
            </Section>
          ) : null}
          <Section id="work" title="العمل والمهام">
          <Panel title="سير العمل" description="الإجراءات المتاحة لك حسب الحالة ودورك. يُرسل عرض السعر ويُقبل من لوحته.">
            <TransitionPanel action={staffTransition} id={r.id} transitions={staffTransitions} holdParties={HOLD_PARTY_LABEL} />
            {r.status === "in_progress" && worker && (!cont || plan.snap.canAdvanceStage) ? (
              <div className="mt-3 border-t border-line pt-3">
                <ActionForm action={advanceStageAction} hidden={{ id: r.id }} submit="أنجزت المرحلة الحالية" variant="secondary" size="sm" />
              </div>
            ) : null}
          </Panel>

          <TasksPanel ops={ops2} requestId={r.id} staff={staff} today={today} status={r.status} canWork={worker} />

          {ops && !terminal ? (
            <Panel title="الإسناد" description={assigneeName ? `مسند حاليًا إلى ${assigneeName}` : "الطلب غير مسند"}>
              <ActionForm action={assignRequest} hidden={{ id: r.id }} submit={assigneeName ? "أعد الإسناد" : "أسند"} size="md">
                <Field label="الموظف" name="userId" required>
                  <Select name="userId" required defaultValue={r.assignedToUserId ?? ""} placeholder="اختر الموظف" options={staff.map((s) => ({ value: s.id, label: `${s.name} — ${s.roles.join("، ")}` }))} />
                </Field>
              </ActionForm>
            </Panel>
          ) : null}

            <RollbackPanel action={rollbackRequest} requestId={r.id} options={terminal ? [] : wx.rollback} impact={wx.rollbackImpact} isOps={ops} />
          </Section>

          <Section id="data" title="البيانات والمستندات">
          <Panel id="intake" title="بيانات الطلب" description={r.intakeFormVersion ? `نموذج الخدمة — الإصدار ${r.intakeFormVersion}. كل حقل بقيمته ومصدره وحالة مراجعته، وتحليل النظام تحته، والإجراءات بجانبه.` : "طلب سابق لنماذج الخدمات: التفاصيل نص حر."}>
            {fws ? (
              <FieldWorkspaceView ws={fws} requestId={r.id} waqfId={r.waqfId} canAct={worker && !terminal && r.status !== "draft"}
                actions={{ staffEditIntake, raiseItem, setFieldState, postStaffNote, createFieldTask }} docs={docOpts} staff={staff.map((x) => ({ value: x.id, label: x.name }))} />
            ) : d.intakeSummary ? (
              <IntakeSummaryView sections={d.intakeSummary} docTitles={docTitle}
                docs={d.form.docs.filter((s) => d.intakeDocs[s.key]?.length || s.required).map((s) => ({ label: s.label, ids: d.intakeDocs[s.key] ?? [] }))} />
            ) : <p className="whitespace-pre-line text-[15px]">{r.details}</p>}
            {fws && worker && !terminal && wx.editImpact.length ? <div className="mt-4 border-t border-line pt-3"><p className="mb-1 text-[13px] font-medium">ما قد يتأثر بأي تعديل في البيانات</p><ImpactList impact={wx.editImpact} /></div> : null}
            {!fws && worker && !terminal && wx.editable.length ? (
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer font-medium text-ink">صحّح بيانات العميل أو أكملها</summary>
                <div className="mt-3 space-y-3">
                  <StaffIntakeEditor action={staffEditIntake} requestId={r.id} fields={wx.editable} />
                  {wx.editImpact.length ? <div><p className="mb-1 text-[13px] font-medium">ما قد يتأثر بالتصحيح</p><ImpactList impact={wx.editImpact} /></div> : null}
                </div>
              </details>
            ) : null}
            <IntakeDocReview action={reviewIntakeDoc} requestId={r.id} rows={docRows} canReview={worker && !terminal && r.status !== "draft"} />
            {worker && ["triage", "awaiting_client"].includes(r.status) ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                {!r.intakeVerifiedAt ? <ActionForm action={verifyIntake} hidden={{ id: r.id }} submit="تحققت من البيانات والمستندات" size="sm" inline /> : null}
                {r.intakeVerifiedAt && !r.acceptedAt && r.status === "triage" ? <ActionForm action={acceptRequest} hidden={{ id: r.id }} submit="اقبل الطلب للخدمة" size="sm" variant="seal" inline /> : null}
              </div>
            ) : null}
          </Panel>

          <Panel title="مستندات الطلب">
            <DocumentList requestId={r.id} emptyText="لا مستندات لهذا الطلب." />
          </Panel>
          </Section>

          <Section id="comms" title="المراسلات والنواقص">
            <CommsOverview channels={channels} />
          <Panel id="items" title="النواقص والاستفسارات" description={`${d.counts.clientOpen} بانتظار العميل · ${d.counts.awaitingReview} بانتظار مراجعتك · ${d.counts.blocking} مطلوب غير مغلق`}>
            {d.items.length ? (
              <ol className="space-y-3">
                {d.items.map((it) => (
                  <li key={it.id} className={it.visibility === "internal" ? "rounded-lg border border-dashed border-seal bg-seal-soft/30 p-3" : "rounded-lg border border-line p-3"} data-testid={`item-${it.seq}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{it.seq}. {it.title}</p>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone="neutral" icon={false}>{ITEM_KIND_LABEL[it.kind]}</Badge>
                        {it.visibility === "internal" ? <Badge tone="seal" icon={false}>داخلي</Badge> : null}
                        {it.required ? <Badge tone="neutral" icon={false}>مطلوب</Badge> : null}
                        <Badge tone={ITEM_STATUS_TONE[it.status as RequestItemStatus]} icon={false}>{itemStatusLabel(it)}</Badge>
                      </span>
                    </div>
                    {it.body ? <p className="mt-1 whitespace-pre-line text-[15px]">{it.body}</p> : null}
                    {it.fieldKey ? <p className="text-[13px] text-muted">الحقل: {fieldOptions.find((f) => f.value === it.fieldKey)?.label ?? it.fieldKey}</p> : null}
                    {it.dueOn ? <p className="text-[13px] text-muted">مطلوب بحلول {fmtDate(it.dueOn)}</p> : null}
                    {it.responseText || it.responseDocumentId ? (
                      <div className="mt-2 rounded-md bg-surface-2 p-2 text-[15px]">
                        <p className="text-[13px] text-muted">رد العميل {it.answeredAt ? fmtDateTime(it.answeredAt) : ""}</p>
                        {it.responseText ? <p className="whitespace-pre-line">{it.responseText}</p> : null}
                        {it.responseDocumentId ? <a href={`/api/files/${it.responseDocumentId}?disposition=inline`} target="_blank" rel="noopener" className="text-ink underline">{docTitle.get(it.responseDocumentId) ?? "المستند"}</a> : null}
                      </div>
                    ) : null}
                    <details className="mt-2 text-[13px] text-muted">
                      <summary className="cursor-pointer">السجل ({itemEvents(it.id).length})</summary>
                      <ul className="mt-1 space-y-0.5">{itemEvents(it.id).map((e) => <li key={e.id}>{fmtDateTime(e.at)} — {ITEM_EVENT_LABEL[e.action] ?? e.action} — {names.get(e.actorUserId ?? "")?.name ?? ""}{e.note ? `: ${e.note}` : ""}</li>)}</ul>
                    </details>
                    {worker && !terminal ? <ReviewItemForms action={reviewItem} itemId={it.id} status={it.status} internal={it.visibility === "internal"} /> : null}
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted">لا نواقص أو استفسارات مسجلة.</p>}
            {worker && !terminal && r.status !== "draft" ? (
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer font-medium text-ink">سجّل بندًا جديدًا</summary>
                <div className="mt-3"><RaiseItemForm action={raiseItem} id={r.id} fields={fieldOptions} docTypes={DOC_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} /></div>
              </details>
            ) : null}
          </Panel>

          <Panel id="client-messages" title="مراسلات العميل" description="يراها العميل ويُبلَّغ بها.">
            <NotesThread notes={notes.filter((n) => n.visibility === "client")} names={names} me={auth.user.id} docTitles={docTitle} />
            {!terminal ? <div className="mt-4 border-t border-line pt-4"><NoteFormWithAttachment action={postStaffNote} id={r.id} staff fixedVisibility="client" requestId={r.id} waqfId={r.waqfId} docs={docOpts} /></div> : null}
          </Panel>
          <Panel id="internal-notes" title="الملاحظات الداخلية" description="للفريق فقط؛ لا يراها العميل. السجل لا يُحذف ولا يُعدّل.">
            <NotesThread notes={notes.filter((n) => n.visibility === "internal")} names={names} me={auth.user.id} docTitles={docTitle} />
            {!terminal ? <div className="mt-4 border-t border-line pt-4"><NoteFormWithAttachment action={postStaffNote} id={r.id} staff fixedVisibility="internal" requestId={r.id} waqfId={r.waqfId} docs={docOpts} /></div> : null}
          </Panel>
          <Panel id="review-notes" title="ملاحظات المراجعة والاعتمادات" description="ما أعاده المراجعون أو طلب العميل تعديله، وقرارات الاعتماد والرفض.">
            <ReviewDecisions rows={decisions} />
          </Panel>
          </Section>

          {paid ? (
            <Section id="commerce" title="العرض والعقد والفوترة">
          {paid ? (
            <Panel id="quote" title="نطاق العمل وعرض السعر" description={d.vatRate === null ? "نسبة الضريبة غير مضبوطة في الإعدادات." : `الضريبة المطبقة على العروض الجديدة ${d.vatRate}٪ (من الإعدادات).`}>
              {d.quotes.length ? (
                <div className="space-y-4">
                  {[...initial, ...amendments].map((q, i) => {
                    const st = quoteDisplayStatus(q, today);
                    const latest = i === 0 || (q.kind === "amendment" && amendments[0]?.id === q.id);
                    return (
                      <details key={q.id} open={latest || ["draft", "approved", "sent", "accepted"].includes(q.status)} className="rounded-lg border border-line p-3" data-testid={`quote-${q.number}-v${q.version}`}>
                        <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                          <span className="font-medium">{q.kind === "amendment" ? "ملحق تعديل" : "عرض"} <span dir="ltr" className="tabular">{q.number}</span> — نسخة {q.version}</span>
                          <Badge tone={QUOTE_STATUS_TONE[st]} icon={false}>{QUOTE_STATUS_LABEL[st]}</Badge>
                          <span className="tabular text-[14px] text-muted">{fmtSAR(q.total)}</span>
                        </summary>
                        <div className="mt-3"><QuoteDocument q={q} today={today} names={names} /></div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(() => {
                            if (q.status !== "draft") return null;
                            const mk = maker.check("quote", q.preparedBy === auth.user.id, "أعددتَ هذا العرض: يعتمده زميل يملك صلاحية اعتماد العروض.");
                            if (canApproveQuote && mk.ok) return <ActionForm action={approveQuote} hidden={{ quoteId: q.id }} submit={mk.self ? "اعتمد العرض (اعتماد مباشر مسجّل)" : "اعتمد العرض"} size="sm" inline />;
                            return <p className="text-[13px] text-muted">{!mk.ok ? mk.error : "يعتمده من يملك صلاحية اعتماد العروض."}</p>;
                          })()}
                          {q.status === "approved" && worker ? <ActionForm action={sendQuote} hidden={{ quoteId: q.id }} submit="أرسل العرض للعميل" size="sm" variant="seal" inline /> : null}
                          <a href={`/app/requests/${r.id}/quote/${q.id}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-ink-soft"><FileDown aria-hidden className="size-4" />PDF</a>
                        </div>
                        {["draft", "approved", "sent"].includes(q.status) && worker ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[14px] text-critical">اسحب العرض</summary>
                            <div className="mt-2"><ActionForm action={withdrawQuote} hidden={{ quoteId: q.id }} submit="اسحب العرض" variant="danger" size="sm">
                              <Field label="السبب" name={`withdraw-${q.id}`} required><Textarea name="note" id={`withdraw-${q.id}`} required minLength={5} className="min-h-16" /></Field>
                            </ActionForm></div>
                          </details>
                        ) : null}
                      </details>
                    );
                  })}
                </div>
              ) : <p className="text-sm text-muted">لم يُعدّ عرض بعد.{!r.acceptedAt ? " يُرسل العرض بعد التحقق من البيانات وقبول الطلب." : ""}</p>}
              {canNewInitial && d.vatRate !== null ? (
                <details className="mt-4 border-t border-line pt-4" open={!d.quotes.length || !!openDraft("initial")}>
                  <summary className="cursor-pointer font-medium text-ink">{openDraft("initial") ? "عدّل مسودة العرض" : d.quotes.length ? "أعدّ نسخة جديدة من العرض" : "أعدّ نطاق العمل وعرض السعر"}</summary>
                  <div className="mt-3"><QuoteEditor action={saveQuote} requestId={r.id} seed={seedFrom("initial")} vatRate={d.vatRate} today={today} title={openDraft("initial") ? "مسودة العرض" : "عرض جديد"} cadences={continuousSpec(rc.service.code)?.allowed.map((c) => ({ value: c, label: CADENCE_AR[c] }))} /></div>
                </details>
              ) : null}
              {canNewAmendment && d.vatRate !== null ? (
                <details className="mt-4 border-t border-line pt-4">
                  <summary className="cursor-pointer font-medium text-ink">{openDraft("amendment") ? "عدّل مسودة ملحق التعديل" : "أعدّ ملحق تعديل (تغيير في النطاق أو السعر)"}</summary>
                  <div className="mt-3"><QuoteEditor action={saveQuote} requestId={r.id} seed={seedFrom("amendment")} vatRate={d.vatRate} today={today} title="ملحق تعديل" /></div>
                </details>
              ) : null}
            </Panel>
          ) : null}

          {paid && (d.contracts.length || needsContract.length || d.contract.contract) ? (
            <Panel id="contract" title="العقد">
              {d.companyGaps.length ? (
                <Alert tone="fine" title="بيانات الشركة ناقصة" className="mb-3" action={auth.perms.has("admin.settings") ? <ButtonLink href="/admin/settings" size="sm" variant="secondary">الإعدادات</ButtonLink> : null}>
                  لا يُعدّ عقد قبل استكمال: {d.companyGaps.join("، ")}.
                </Alert>
              ) : null}
              <div className="space-y-4">
                {d.contracts.map((k) => {
                  const myCompanySign = canApproveContract && k.parties.length && ["sent", "partially_signed"].includes(k.status) && k.signing.pending.some((p) => p.side === "company");
                  return (
                    <div key={k.id} className="rounded-lg border border-line p-3" data-testid={`contract-${k.number}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{k.parentContractId ? "ملحق تعديل" : "العقد"} <span dir="ltr" className="tabular">{k.number}</span> — إصدار {k.version}</p>
                        <Badge tone={k.status === "signed" ? "ok" : k.status === "void" ? "neutral" : "warn"} icon={false}>{CONTRACT_STATUS_LABEL[k.status] ?? k.status}</Badge>
                      </div>
                      {k.voidReason ? <p className="text-[13px] text-muted">سبب الإلغاء: {k.voidReason}</p> : null}
                      {k.parties.length ? <div className="mt-2"><PartiesList parties={k.parties} signatures={k.signatures} /></div> : (
                        <ul className="mt-2 space-y-1 text-[13px] text-muted">{k.signatures.map((s) => <li key={s.id}>{s.method === "otp" ? "العميل" : "الشركة"}: {names.get(s.userId)?.name ?? "—"} · {fmtDateTime(s.signedAt)}</li>)}</ul>
                      )}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[15px] text-ink">معاينة نص العقد</summary>
                        <div className="mt-2"><ContractPaper body={k.body} number={k.number} hash={k.contentHash} /></div>
                      </details>
                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        {(() => {
                          if (k.status !== "draft") return null;
                          const mk = maker.check("contract", k.createdBy === auth.user.id || k.updatedBy === auth.user.id, "أعددتَ هذا العقد أو عدّلت مسودته: يعتمده زميل يملك صلاحية اعتماد العقود.");
                          if (canApproveContract && mk.ok) return <ActionForm action={approveContract} hidden={{ contractId: k.id }} submit={mk.self ? "اعتمد العقد (اعتماد مباشر مسجّل)" : "اعتمد العقد"} size="sm" inline />;
                          return <p className="text-[13px] text-muted">{!mk.ok ? mk.error : "يعتمده من يملك صلاحية اعتماد العقود."}</p>;
                        })()}
                        {k.status === "approved" && worker ? <ActionForm action={sendContract} hidden={{ contractId: k.id }} submit="أرسل للتوقيع" size="sm" variant="seal" inline /> : null}
                        {!k.parties.length && k.signing.clientSigned && !k.signing.companySigned && ops && k.status !== "void" ? <ActionForm action={countersignContract} hidden={{ contractId: k.id }} submit="وقّع عن الشركة" variant="seal" size="sm" inline /> : null}
                        <a href={`/app/requests/${r.id}/contract/${k.id}`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-ink-soft" data-testid={`contract-pdf-${k.number}`}><FileDown aria-hidden className="size-4" />{k.status === "signed" ? "النسخة الموقّعة PDF" : k.status === "draft" ? "معاينة PDF (مسودة)" : k.status === "approved" ? "معاينة PDF (معتمد لم يُرسل)" : "PDF"}</a>
                      </div>
                      {myCompanySign ? (
                        <div className="mt-3 border-t border-line pt-3"><SignContractForm requestOtp={requestSignOtp} sign={signContract} contractId={k.id} partyKey="company" asLabel={`عن «${k.parties.find((p) => p.side === "company")?.name}» بصفتك مفوّضًا بالتوقيع`} /></div>
                      ) : null}
                      {["draft", "approved", "sent", "partially_signed"].includes(k.status) && (k.status === "draft" ? worker : ops) ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[14px] text-critical">ألغِ العقد قبل نفاذه</summary>
                          <div className="mt-2"><ActionForm action={voidContract} hidden={{ contractId: k.id }} submit="ألغِ العقد" variant="danger" size="sm">
                            <Field label="السبب" name={`void-${k.id}`} required hint="تسقط التوقيعات السابقة، ويُصدر إصدار جديد يوقّعه الجميع."><Textarea name="reason" id={`void-${k.id}`} required minLength={5} className="min-h-16" /></Field>
                          </ActionForm></div>
                        </details>
                      ) : null}
                      {k.status === "draft" && worker && k.quoteId ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[14px] text-ink">عدّل الأطراف وأعد إعداد المسودة</summary>
                          <div className="mt-2"><ContractPrepareForm action={prepareContract} requestId={r.id} quoteId={k.quoteId} signers={d.signers} docs={docOpts} gaps={d.companyGaps}
                            seed={k.parties.filter((p) => p.side === "client").map((p) => ({ name: p.name, capacity: p.capacity, idLabel: p.idLabel ?? "", idNumber: p.idNumber ?? "", signerUserId: p.signerUserId ?? r.requesterUserId, authorityType: p.authorityType, authorityRef: p.authorityRef ?? "", authorityDocumentId: p.authorityDocumentId ?? "" }))} /></div>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
                {needsContract.map((q) => (
                  <div key={q.id} className="rounded-lg border border-dashed border-line-strong p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{worker ? "أعدّ" : "لم يُعدّ"} {q.kind === "amendment" ? "ملحق التعديل" : "العقد"} من العرض المقبول <span dir="ltr" className="tabular">{q.number}</span> (نسخة {q.version})</p>
                      <Link href={`/admin/requests/${r.id}/contract-preview?quoteId=${q.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-3 text-sm text-ink hover:bg-ink-soft" data-testid={`contract-preview-${q.number}`}><Eye aria-hidden className="size-4" />معاينة نص العقد{d.companyGaps.length ? " (مع النواقص)" : ""}</Link>
                    </div>
                    {worker ? <ContractPrepareForm action={prepareContract} requestId={r.id} quoteId={q.id} signers={d.signers} docs={docOpts} gaps={d.companyGaps} seed={partySeed} /> : null}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {paid && (acceptedQuotes.length || d.invoices.length || legacyInvoice) ? (
            <Panel id="billing" title="الفوترة والمدفوعات">
              {d.invoicePolicy && d.invoicePolicy.kind !== "tax_invoice" ? (
                <Alert tone={d.invoicePolicy.kind === "proforma" ? "fine" : "info"} title={d.invoicePolicy.kind === "proforma" ? "تصدر فاتورة أولية فقط" : "الشركة غير مسجلة في ضريبة القيمة المضافة"} className="mb-3">
                  {d.invoicePolicy.kind === "proforma"
                    ? `لا تصدر فاتورة ضريبية حتى تكتمل بيانات الشركة: ${d.invoicePolicy.gaps.join("، ")}. الفاتورة الأولية لا تُسدد ولا تُعد فاتورة ضريبية.`
                    : "تصدر فاتورة بلا ضريبة وفق إعداد الشركة."}
                </Alert>
              ) : null}
              {sched?.rows.length ? (
                <div className="mb-4">
                  <p className="mb-2 text-[15px] font-medium">جدول الدفعات التعاقدي</p>
                  <PaymentScheduleTable rows={sched.rows} staff setDue={auth.perms.has("admin.finance") || ops ? setInstallmentDue : undefined} names={new Map([...names.entries()].map(([k, v]) => [k, v.name]))} />
                  <p className="mt-1 text-[12px] text-muted">لا تصدر فاتورة تلقائيًا عند حلول الموعد: تُنبَّه المالية قبل الموعد وعنده وبعد التأخر، وتُعدّ المسودة من بنود الدفعات أدناه.</p>
                </div>
              ) : null}
              {acceptedQuotes.map((q) => {
                const k = d.contracts.find((x) => x.quoteId === q.id && x.status === "signed");
                return (
                  <div key={q.id} className="mb-4">
                    <p className="mb-2 text-[15px] font-medium">دفعات {q.kind === "amendment" ? "ملحق التعديل" : "العرض"} <span dir="ltr" className="tabular">{q.number}</span>{k ? "" : " — تصدر الفواتير بعد نفاذ العقد"}</p>
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {splitInstallments(Number(q.net), Number(q.vatRate), q.paymentTerms).map((t) => {
                        const invs = invOf(q.id, t.key);
                        const real = invs.find((i) => i.kind !== "proforma");
                        return (
                          <li key={t.key} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`term-${t.key}`}>
                            <span className="text-[15px]">{t.label} ({t.percent}٪) — <span className="tabular">{fmtSAR(t.total)}</span> <span className="text-[13px] text-muted">{termWhen(t)}{t.beforeStart ? " · شرط للبدء" : ""}</span></span>
                            <span className="flex flex-wrap items-center gap-2">
                              {invs.map((i) => (
                                <Link key={i.id} href={`/admin/finance/${i.id}`} className="text-[14px] text-ink hover:underline">
                                  <span dir="ltr" className="tabular">{i.number}</span> · {INVOICE_STATUS_LABEL[i.status] ?? i.status}{i.kind === "proforma" ? " (أولية)" : i.balance > 0 && i.status !== "void" ? ` · المتبقي ${fmtSAR(i.balance)}` : ""}
                                </Link>
                              ))}
                              {k && !real && worker ? <ActionForm action={issueInvoice} hidden={{ id: r.id, quoteId: q.id, termKey: t.key }} submit={d.invoicePolicy?.kind === "proforma" ? "أعدّ مسودة فاتورة أولية" : "أعدّ مسودة الفاتورة"} variant="secondary" size="sm" inline /> : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              {legacyInvoice && worker ? <ActionForm action={issueInvoice} hidden={{ id: r.id }} submit="أعدّ مسودة الفاتورة" variant="secondary" size="sm" inline /> : null}
              {d.invoices.filter((i) => i.status === "draft" || i.status === "approved").map((i) => (
                <div key={i.id} className="mb-3"><InvoiceCycle inv={i} canApprove={auth.perms.has("admin.finance")} canWork={worker || auth.perms.has("admin.finance")} me={auth.user.id} /></div>
              ))}
              {d.invoices.length ? (
                <ul className="divide-y divide-line border-t border-line">
                  {d.invoices.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[15px]">
                      <Link href={`/admin/finance/${i.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{i.number}</Link>
                      <span className="text-[13px] text-muted">{INVOICE_KIND_LABEL[i.kind as keyof typeof INVOICE_KIND_LABEL] ?? i.kind}</span>
                      <span className="tabular">{fmtSAR(i.total)}</span>
                      <Badge tone={INVOICE_STATUS_TONE[i.status] ?? "neutral"} icon={false}>{INVOICE_STATUS_LABEL[i.status] ?? i.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ) : null}

            </Section>
          ) : null}

          <Section id="outputs-section" title="المخرجات">
          <Panel id="outputs" title="المخرجات" description={`تُعدّ المسودة من بيانات الطلب والوقف والمراجع، ويكمل المختص ما يحتاج رأيه، ثم تُعتمد وفق سياسة كل مخرج وتُسلَّم للعميل بعد مراجعة الجودة.${isOpinion ? " الرأي المتخصص يُوقَّع باسم المستشار وصفته." : ""}`}>
            <OutputsPanel ops={ops2} requestId={r.id} status={r.status} canDeliver={auth.perms.has("staff.deliver") && worker} canReview={auth.perms.has("staff.quality_review")} isManager={ops} me={auth.user.id} opinion={isOpinion} />
            <h3 className="mb-2 mt-4 text-[15px] font-medium">التسليمات إلى العميل</h3>
            {deliverables.length ? (
              <ul className="mb-4 divide-y divide-line">
                {deliverables.map((x) => (
                  <li key={x.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex items-center gap-2"><FileCheck2 aria-hidden className="size-4 text-muted" />{x.title} <span className="text-[13px] text-muted">إصدار {x.version} · {names.get(x.createdBy ?? "")?.name ?? ""}</span></span>
                    <span className="flex items-center gap-2">
                      {x.signedBy ? <span className="text-[13px] text-muted">موقّع: {x.signedBy}</span> : isOpinion ? <Badge tone="fine" icon={false}>غير موقّع</Badge> : null}
                      <Badge tone={x.status === "approved" ? "ok" : x.status === "revision_requested" ? "fine" : "info"} icon={false}>{x.status === "approved" ? "معتمد" : x.status === "revision_requested" ? "مطلوب تعديله" : "مُسلّم"}</Badge>
                      {x.documentId ? <><a href={`/api/files/${x.documentId}?disposition=inline`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm text-ink underline"><Eye aria-hidden className="size-4" />معاينة</a><a href={`/api/files/${x.documentId}`} className="text-sm text-ink underline">تنزيل</a></>
                        : x.outputId ? <Link href={`/admin/requests/${r.id}/outputs/${x.outputId}`} className="inline-flex items-center gap-1 text-sm text-ink underline"><Eye aria-hidden className="size-4" />معاينة (يصدر ملفه عند الإفراج)</Link> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mb-4 text-sm text-muted">لا تسليمات بعد. يصبح المخرج المعتمد تسليمًا، ويظهر للعميل بعد مراجعة الجودة.</p>}
            {["in_progress", "quality_review"].includes(r.status) && auth.perms.has("staff.deliver") ? (
              <details className="border-t border-line pt-4">
              <summary className="cursor-pointer text-[15px] font-medium text-ink">أو ارفع ملفًا أُعدّ خارج المنصة</summary>
              <div className="mt-3 space-y-4">
                <DocumentUploader requestId={r.id} waqfId={r.waqfId} docType="deliverable" defaultTitle={rc.service.outputs ?? ""} compact />
                <ActionForm action={addDeliverable} hidden={{ id: r.id }} submit="سجّل المخرج" size="md">
                  <Field label="عنوان المخرج" name="title" required>
                    <Input name="title" required defaultValue={rc.service.outputs ?? ""} />
                  </Field>
                  <Field label="الملف" name="documentId" hint="ارفع الملف أعلاه أولًا ثم اختره هنا.">
                    <Select name="documentId" placeholder="بلا ملف" options={docs.map((x) => ({ value: x.id, label: x.title }))} />
                  </Field>
                  {isOpinion ? (
                    <Field label="التوقيع: اسم المستشار وصفته" name="signedBy" hint="مثال: د. فلان الفلاني — مستشار شرعي">
                      <Input name="signedBy" />
                    </Field>
                  ) : null}
                </ActionForm>
              </div>
              </details>
            ) : null}
          </Panel>

          </Section>

          <Section id="history" title="السجل">
            <Panel title="سجل الطلب" description="ما يراه العميل من أحداث الطلب."><EventList events={events} names={names} /></Panel>
            <Panel title="سجل التصحيحات والرجوع" description="للفريق فقط: من صحّح أو رجع، ولماذا، وما الأثر."><RevisionList rows={wx.revisions} names={wx.revisionNames} /></Panel>
          </Section>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="حالة الطلب"><RequestStates states={d.states} /></Panel>
          <LinksPanel ops={ops2} requestId={r.id} waqf={rc.waqf ? { id: rc.waqf.id, name: rc.waqf.name } : null} canLink={worker && !terminal} suggestedName={String(ans.waqfName ?? (r.intake as { answers?: Record<string, unknown> } | null)?.answers?.waqfName ?? "")} />
          <Panel title="المراحل"><StageTimeline stages={stages} /></Panel>
          <Panel title="بيانات أساسية">
            <DefinitionList cols={1} items={[
              { label: "العميل", value: <>{requesterName}{d.requesterPhone ? <span dir="ltr" className="ms-2 text-[13px] text-muted">{staffPhone(auth, d.requesterPhone)}</span> : null}</> },
              { label: "الوقف", value: rc.waqf ? <Link className="text-ink hover:underline" href={auth.perms.has("admin.waqfs.all") ? `/admin/waqfs/${rc.waqf.id}` : `/app/w/${rc.waqf.id}`}>{rc.waqf.name}</Link> : "بلا وقف" },
              { label: "دور وقفك في الوقف", value: rc.waqf ? WAQFAK_ROLE_LABEL[rc.waqf.waqfakRole] ?? rc.waqf.waqfakRole : "—" },
              { label: "المختص", value: assigneeName ?? "غير مسند" },
              { label: "الأولوية", value: PRIORITY_LABEL[r.priority] ?? r.priority },
              { label: "التواصل المفضل", value: CONTACT_LABEL[String((r.intake as { preferredContact?: string } | null)?.preferredContact ?? "platform")] },
              { label: "فحص الاستقلال", value: CONFLICT_LABEL[r.conflictCheck] ?? r.conflictCheck },
              { label: "المصدر", value: r.source === "recommendation" ? "توصية تقييم" : "طلب مباشر" },
              { label: "أُرسل", value: fmtDate(r.submittedAt) },
              { label: "السعر المتفق عليه", value: r.agreedPrice ? fmtSAR(r.agreedPrice) + " قبل الضريبة" : "—" },
              { label: "التقييم", value: r.rating ? `${r.rating} من 5${r.ratingComment ? ` — ${r.ratingComment}` : ""}` : "—" },
            ]} />
          </Panel>
          {d.consistency.length === 0 && (d.quotes.length || d.invoices.length) ? (
            <p className="flex items-center gap-2 text-[13px] text-muted"><CheckCircle2 aria-hidden className="size-4 text-ok" />فحص الاتساق: لا فروق بين العرض المقبول والعقود والفواتير والمدفوعات.</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
