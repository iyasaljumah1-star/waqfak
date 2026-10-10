import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2, Receipt } from "lucide-react";
import { Alert, Badge, ButtonLink, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { DocumentList } from "@/components/documents/list";
import { DocumentUploader } from "@/components/documents/uploader";
import { ConflictBadge, ContractPaper, CONTACT_LABEL, EventList, NotesThread, PRIORITY_LABEL, SlaBadge, StageTimeline, StatusBadge } from "@/components/requests/bits";
import { NoteForm, RatingForm, SignContractForm, TransitionPanel } from "@/components/requests/forms";
import { fmtBoth, fmtDate, fmtDateTime, fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { clientTransition, postClientNote, rateRequest } from "@/server/modules/requests/actions";
import { requestDetail } from "@/server/modules/requests/queries";
import { HOLD_PARTY_LABEL } from "@/server/modules/requests/workflow";
import { requestSignOtp, signContract } from "@/server/modules/contracts/actions";
import { computeInvoice } from "@/server/modules/billing/calc";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "@/server/modules/billing/access";

export const metadata: Metadata = { title: "تفاصيل الطلب" };

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; signed?: string }> }) {
  const { id } = await params;
  const { created, signed } = await searchParams;
  const auth = await requireAuth({ next: `/app/requests/${id}` });
  const d = await requestDetail(auth, id, "client");
  if (!d) notFound();
  const { rc, stages, events, notes, deliverables, contract, invoices, names } = d;
  const r = rc.req;
  const canAct = rc.isRequester || rc.memberCreate;
  const submittedDels = deliverables.filter((x) => x.status === "submitted");
  const quote = r.quoteAmount ? computeInvoice(Number(r.quoteAmount), d.vatRate) : null;
  const assignee = r.assignedToUserId ? names.get(r.assignedToUserId) : null;
  const k = contract.contract;
  const canSign = !!k && k.status === "sent" && (k.partyUserId === auth.user.id || rc.memberSign);
  const openInvoices = invoices.filter((i) => i.status === "issued");
  const others = d.transitions.filter((t) => !(r.status === "awaiting_client_approval" && (t.to === "completed" || t.to === "in_progress")) && !(r.status === "quote" && t.to === "awaiting_contract"));

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/app/requests", label: "طلباتي" }, { label: r.number }]}
        title={rc.service.nameAr}
        description={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="tabular">{r.number}</span><StatusBadge status={r.status} /><ConflictBadge value={r.conflictCheck} /></span>}
        actions={r.waqfId ? <ButtonLink href={`/app/w/${r.waqfId}`} variant="secondary" size="sm">ملف الوقف</ButtonLink> : null}
      />

      {created ? <Alert tone="ok" title="أُرسل طلبك">سيُسند لمختص ويُفرز خلال 5 أيام عمل. ارفع المستندات المطلوبة الآن لتسريع العمل.</Alert> : null}
      {signed && contract.clientSigned ? <Alert tone="ok" title="تم توقيع العقد">حُفظ توقيعك مع بصمة نص العقد. تصدر الفاتورة بعد ذلك وتصلك في «الفواتير».</Alert> : null}
      {r.conflictCheck === "blocked" ? (
        <Alert tone="critical" title="الطلب قيد مراجعة الاستقلالية">
          <p className="whitespace-pre-line">{r.conflictNote}</p>
          <p className="mt-1">حُفظ طلبك، ويقرر فيه مدير التشغيل: اعتماد استثناء مسبب أو رفض الطلب مع بيان السبب.</p>
        </Alert>
      ) : r.conflictCheck === "override_approved" ? (
        <Alert tone="seal" title="اعتُمد استثناء مسبب من قاعدة الاستقلال"><p className="whitespace-pre-line">{r.conflictNote}</p></Alert>
      ) : null}
      {r.status === "on_hold" ? (
        <Alert tone="fine" title={`الطلب معلّق — بانتظار ${HOLD_PARTY_LABEL[r.holdParty ?? ""] ?? "طرف آخر"}`}>
          {r.holdReason}{r.holdFollowUpOn ? ` · المتابعة في ${fmtBoth(r.holdFollowUpOn)}` : ""}
        </Alert>
      ) : null}
      {r.status === "rejected" && r.rejectReason ? <Alert tone="critical" title="رُفض الطلب">{r.rejectReason}</Alert> : null}
      {r.status === "cancelled" ? <Alert tone="neutral" title="أُلغي الطلب">{r.cancelReason}</Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* Quote */}
          {r.status === "quote" && quote ? (
            <Panel title="عرض السعر" description="راجع العرض. بعد قبوله يصلك العقد للتوقيع.">
              <dl className="grid grid-cols-3 gap-3 text-center">
                <div><dt className="text-[13px] text-muted">قبل الضريبة</dt><dd className="tabular text-lg font-semibold">{fmtSAR(quote.net)}</dd></div>
                <div><dt className="text-[13px] text-muted">الضريبة {d.vatRate}%</dt><dd className="tabular text-lg">{fmtSAR(quote.vat)}</dd></div>
                <div><dt className="text-[13px] text-muted">الإجمالي</dt><dd className="tabular text-lg font-semibold text-ink">{fmtSAR(quote.total)}</dd></div>
              </dl>
              {canAct ? (
                <div className="mt-4">
                  <TransitionPanel action={clientTransition} id={r.id} transitions={d.transitions.filter((t) => t.to === "awaiting_contract").map((t) => ({ ...t, label: "أقبل عرض السعر" }))} />
                </div>
              ) : null}
            </Panel>
          ) : null}

          {/* Contract */}
          {k ? (
            <Panel id="contract" title={`العقد ${k.number}`} description={k.status === "signed" ? `موقّع ${fmtDateTime(k.signedAt)}` : "بانتظار توقيعك"}
              actions={<Badge tone={k.status === "signed" ? "ok" : "warn"} icon={false}>{k.status === "signed" ? (contract.companySigned ? "موقّع من الطرفين" : "وقّعه العميل — بانتظار توقيع الشركة") : "بانتظار التوقيع"}</Badge>}>
              <details open={k.status === "sent"} className="group">
                <summary className="mb-3 cursor-pointer text-[15px] text-ink">{k.status === "sent" ? "نص العقد" : "اعرض نص العقد"}</summary>
                <ContractPaper body={k.body} number={k.number} hash={k.contentHash}
                  footer={contract.signatures.length ? (
                    <ul className="mt-4 space-y-1 font-sans text-[13px] leading-6">
                      {contract.signatures.map((s) => (
                        <li key={s.id}>{s.method === "otp" ? "توقيع العميل" : "توقيع الشركة"}: {names.get(s.userId)?.name ?? "—"} · {fmtDateTime(s.signedAt)}{s.method === "otp" ? " · برمز تحقق" : ""}</li>
                      ))}
                    </ul>
                  ) : null}
                />
              </details>
              {canSign ? <div className="mt-4 border-t border-line pt-4"><SignContractForm requestOtp={requestSignOtp} sign={signContract} contractId={k.id} /></div> : null}
            </Panel>
          ) : r.status === "awaiting_contract" ? (
            <Panel title="العقد"><p className="text-[15px] text-muted">قبلت عرض السعر. يجهز الفريق العقد الآن وسيصلك إشعار عند جاهزيته للتوقيع.</p></Panel>
          ) : null}

          {/* Invoices */}
          {invoices.length ? (
            <Panel title="الفواتير">
              <ul className="divide-y divide-line">
                {invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex items-center gap-2"><Receipt aria-hidden className="size-4 text-muted" /><Link href={`/app/billing/${i.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{i.number}</Link></span>
                    <span className="tabular">{fmtSAR(i.total)}</span>
                    <Badge tone={INVOICE_STATUS_TONE[i.status] ?? "neutral"} icon={false}>{INVOICE_STATUS_LABEL[i.status] ?? i.status}</Badge>
                    {i.status === "issued" ? <ButtonLink href={`/app/billing/${i.id}`} size="sm">ادفع</ButtonLink> : null}
                  </li>
                ))}
              </ul>
              {openInvoices.length ? <p className="mt-2 text-[13px] text-muted">تستحق الفاتورة خلال 14 يومًا من إصدارها.</p> : null}
            </Panel>
          ) : null}

          {/* Deliverables */}
          {deliverables.length ? (
            <Panel title="المخرجات" description={r.status === "awaiting_client_approval" ? "راجع المخرجات ثم اعتمدها أو اطلب تعديلات." : undefined}>
              <ul className="divide-y divide-line">
                {deliverables.filter((x) => x.status !== "draft").map((x) => (
                  <li key={x.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium"><FileCheck2 aria-hidden className="size-4 text-muted" />{x.title} <span className="text-[13px] font-normal text-muted">(إصدار {x.version})</span></p>
                      {x.signedBy ? <p className="text-[13px] text-muted">موقّع من: {x.signedBy}</p> : null}
                      {x.revisionNote ? <p className="text-[13px] text-fine">ملاحظة التعديل: {x.revisionNote}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={x.status === "approved" ? "ok" : x.status === "revision_requested" ? "fine" : "info"} icon={false}>{x.status === "approved" ? "معتمد" : x.status === "revision_requested" ? "طُلب تعديله" : "بانتظار اعتمادك"}</Badge>
                      {x.documentId ? <a href={`/api/files/${x.documentId}?disposition=inline`} target="_blank" rel="noopener" className="text-sm text-ink underline">فتح</a> : null}
                    </div>
                  </li>
                ))}
              </ul>
              {r.status === "awaiting_client_approval" && canAct && submittedDels.length ? (
                <div className="mt-4 border-t border-line pt-4">
                  <TransitionPanel action={clientTransition} id={r.id}
                    transitions={d.transitions.filter((t) => t.to === "completed" || t.to === "in_progress").map((t) => ({ ...t, label: t.to === "completed" ? "أعتمد المخرجات" : "أطلب تعديلات" }))} />
                </div>
              ) : null}
            </Panel>
          ) : null}

          {/* Rating */}
          {(r.status === "completed" || r.status === "closed") && canAct ? (
            <Panel title="قيّم الخدمة" description="رأيك يساعدنا على تحسين الخدمة.">
              <RatingForm action={rateRequest} id={r.id} current={r.rating} comment={r.ratingComment} />
            </Panel>
          ) : null}

          <Panel title="المراسلات" description="رسائلك مع فريق وقفك حول هذا الطلب.">
            <NotesThread notes={notes} names={names} me={auth.user.id} />
            {!["closed", "cancelled", "rejected"].includes(r.status) ? <div className="mt-4 border-t border-line pt-4"><NoteForm action={postClientNote} id={r.id} /></div> : null}
          </Panel>

          <Panel title="المستندات" description={rc.service.requiredDocuments.length ? `المطلوب: ${rc.service.requiredDocuments.map((x) => x.label).join("، ")}` : undefined}>
            <div className="space-y-4">
              <DocumentList requestId={r.id} emptyText="لم تُرفع مستندات لهذا الطلب بعد." />
              {canAct && !["closed", "cancelled", "rejected"].includes(r.status) ? <DocumentUploader requestId={r.id} waqfId={r.waqfId} compact /> : null}
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="المراحل"><StageTimeline stages={stages} /></Panel>
          <Panel title="بيانات الطلب">
            <DefinitionList cols={1} items={[
              { label: "الوقف", value: rc.waqf ? <Link className="text-ink hover:underline" href={`/app/w/${rc.waqf.id}`}>{rc.waqf.name}</Link> : "بلا وقف" },
              { label: "الأولوية", value: PRIORITY_LABEL[r.priority] ?? r.priority },
              { label: "التواصل المفضل", value: CONTACT_LABEL[String((r.intake as { preferredContact?: string } | null)?.preferredContact ?? "platform")] },
              { label: "المختص", value: assignee?.name ?? "لم يُسند بعد" },
              { label: "أُرسل", value: fmtDate(r.submittedAt) },
              { label: "المهلة الحالية", value: <SlaBadge due={r.slaDueAt} status={r.status} /> },
              { label: "التفاصيل", value: <span className="whitespace-pre-line">{r.details}</span> },
            ]} />
          </Panel>
          {canAct && others.length ? (
            <Panel title="إجراءات"><TransitionPanel action={clientTransition} id={r.id} transitions={others} /></Panel>
          ) : null}
          <Panel title="سجل الطلب"><EventList events={events} names={names} /></Panel>
        </aside>
      </div>
    </div>
  );
}
