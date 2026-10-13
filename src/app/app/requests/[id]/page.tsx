import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2, FileDown, Receipt } from "lucide-react";
import { Alert, Badge, ButtonLink, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { DocumentList } from "@/components/documents/list";
import { DocumentUploader } from "@/components/documents/uploader";
import {
  ConflictBadge, ContractPaper, EventList, IntakeSummaryView, NextActionBanner, NotesThread, PartiesList, PRIORITY_LABEL, QuoteDocument, RequestStates, SlaBadge,
  StageTimeline, StatusBadge,
} from "@/components/requests/bits";
import { RatingForm, SignContractForm, TransitionPanel } from "@/components/requests/forms";
import { AnswerItemForm, NoteFormWithAttachment, QuoteResponseForm } from "@/components/requests/commerce";
import { fmtBoth, fmtDate, fmtDateTime, fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { clientTransition, postClientNote, rateRequest } from "@/server/modules/requests/actions";
import { answerItem } from "@/server/modules/requests/items-actions";
import { requestDetail } from "@/server/modules/requests/queries";
import { HOLD_PARTY_LABEL } from "@/server/modules/requests/workflow";
import { ITEM_KIND_LABEL, ITEM_STATUS_LABEL, ITEM_STATUS_TONE } from "@/server/modules/requests/items-pure";
import { requestSignOtp, signContract } from "@/server/modules/contracts/actions";
import { respondQuote } from "@/server/modules/commerce/quote-actions";
import { AUTHORITY_LABEL, CONTRACT_STATUS_LABEL, INVOICE_KIND_LABEL, QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, quoteDisplayStatus } from "@/server/modules/commerce/pure";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "@/server/modules/billing/access";
import type { RequestItemStatus } from "@/server/db/schema/commerce";

export const metadata: Metadata = { title: "تفاصيل الطلب" };

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; signed?: string }> }) {
  const { id } = await params;
  const { created, signed } = await searchParams;
  const auth = await requireAuth({ next: `/app/requests/${id}` });
  const d = await requestDetail(auth, id, "client");
  if (!d) notFound();
  const { rc, stages, events, notes, deliverables, names, today } = d;
  const r = rc.req;
  const canAct = rc.isRequester || rc.memberCreate;
  const canRespondQuote = rc.isRequester || rc.memberSign;
  const terminal = ["closed", "cancelled", "rejected"].includes(r.status);
  const submittedDels = deliverables.filter((x) => x.status === "submitted");
  const assignee = r.assignedToUserId ? names.get(r.assignedToUserId) : null;
  const docOpts = d.docs.map((x) => ({ id: x.id, title: x.title }));
  const docTitle = new Map(d.docs.map((x) => [x.id, x.title]));
  const legacyQuote = !d.quotes.length && r.status === "quote" && r.quoteAmount;
  const others = d.transitions.filter((t) => !(r.status === "awaiting_client_approval" && (t.to === "completed" || t.to === "in_progress")) && !(r.status === "quote" && t.to === "awaiting_contract") && !(r.status === "awaiting_client" && t.to === "triage" && d.items.length > 0));
  const openItems = d.items.filter((i) => ["open", "correction_requested"].includes(i.status));
  const contracts = d.contracts.filter((k) => k.status !== "void" || k.signatures.length);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/app/requests", label: "طلباتي" }, { label: r.number }]}
        title={rc.service.nameAr}
        description={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="tabular">{r.number}</span><StatusBadge status={r.status} /><ConflictBadge value={r.conflictCheck} /></span>}
        actions={r.waqfId ? <ButtonLink href={`/app/w/${r.waqfId}`} variant="secondary" size="sm">ملف الوقف</ButtonLink> : null}
      />

      {r.status === "draft" ? (
        <Alert tone="seal" title="مسودة لم تُرسل" action={canAct ? <ButtonLink href={`/app/requests/${r.id}/intake`} size="sm">أكمل النموذج</ButtonLink> : null}>
          حُفظت إجاباتك ومستنداتك. لا يصل الطلب إلى الفريق حتى ترسله من خطوة «المراجعة والإرسال».
        </Alert>
      ) : null}
      {created ? <Alert tone="ok" title={`أُرسل طلبك ${r.number}`}>وصلنا الطلب ببياناته ومستنداته. يتابعه الآن مدير التشغيل بإسناده إلى مختص، وستجد الخطوة التالية ومن عليه أعلى هذه الصفحة دائمًا.</Alert> : null}
      {signed && d.contract.stage ? <Alert tone="ok" title="سُجّل توقيعك">حُفظ توقيعك مع بصمة نص العقد. {d.contract.executed ? "نفذ العقد بتوقيع جميع الأطراف، ونسخته الموقّعة متاحة أدناه." : "يُستكمل العقد بتوقيع بقية الأطراف."}</Alert> : null}
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

      {r.status !== "draft" ? <NextActionBanner next={d.next} viewer="client" /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* Deficiencies and queries */}
          {d.items.length ? (
            <Panel id="items" title="النواقص والاستفسارات" description={openItems.length ? `${openItems.length} بانتظار ردك. أجب عن كل بند على حدة.` : "لا بنود بانتظار ردك."}>
              <ol className="space-y-3">
                {d.items.map((it) => (
                  <li key={it.id} className="rounded-lg border border-line p-3" data-testid={`item-${it.seq}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{it.seq}. {it.title}</p>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone="neutral" icon={false}>{ITEM_KIND_LABEL[it.kind]}</Badge>
                        <Badge tone={ITEM_STATUS_TONE[it.status as RequestItemStatus]} icon={false}>{ITEM_STATUS_LABEL[it.status as RequestItemStatus]}</Badge>
                      </span>
                    </div>
                    {it.body ? <p className="mt-1 whitespace-pre-line text-[15px]">{it.body}</p> : null}
                    {it.dueOn ? <p className="text-[13px] text-muted">مطلوب بحلول {fmtDate(it.dueOn)}</p> : null}
                    {d.itemEvents.filter((e) => e.itemId === it.id && e.action === "correction_requested").slice(-1).map((e) => (
                      <p key={e.id} className="mt-1 rounded-md bg-fine-soft/50 px-2 py-1 text-[14px] text-fine">مطلوب تصحيحه: {e.note}</p>
                    ))}
                    {it.responseText || it.responseDocumentId ? (
                      <div className="mt-2 rounded-md bg-surface-2 p-2 text-[15px]">
                        <p className="text-[13px] text-muted">ردك {it.answeredAt ? fmtDateTime(it.answeredAt) : ""}</p>
                        {it.responseText ? <p className="whitespace-pre-line">{it.responseText}</p> : null}
                        {it.responseDocumentId ? <a href={`/api/files/${it.responseDocumentId}?disposition=inline`} target="_blank" rel="noopener" className="text-ink underline">{docTitle.get(it.responseDocumentId) ?? "المستند"}</a> : null}
                      </div>
                    ) : null}
                    {canAct && ["open", "correction_requested"].includes(it.status) && !terminal ? (
                      <AnswerItemForm action={answerItem} itemId={it.id} kind={it.kind} requestId={r.id} waqfId={r.waqfId} docs={docOpts} docType={it.docType} />
                    ) : null}
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}

          {/* Quote */}
          {d.quotes.length ? (
            <Panel id="quote" title="نطاق العمل وعرض السعر">
              <div className="space-y-4">
                {d.quotes.map((q, i) => {
                  const st = quoteDisplayStatus(q, today);
                  const actionable = q.status === "sent" && st !== "expired";
                  return (
                    <details key={q.id} open={i === 0 || actionable || q.status === "accepted"} className="rounded-lg border border-line p-3" data-testid={`quote-${q.number}-v${q.version}`}>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                        <span className="font-medium">{q.kind === "amendment" ? "ملحق تعديل" : "عرض"} <span dir="ltr" className="tabular">{q.number}</span> — نسخة {q.version}</span>
                        <Badge tone={QUOTE_STATUS_TONE[st]} icon={false}>{QUOTE_STATUS_LABEL[st]}</Badge>
                        <span className="tabular text-[14px] text-muted">{fmtSAR(q.total)}</span>
                      </summary>
                      <div className="mt-3"><QuoteDocument q={q} today={today} /></div>
                      <div className="mt-2"><a href={`/app/requests/${r.id}/quote/${q.id}`} className="inline-flex items-center gap-1 text-[14px] text-ink hover:underline"><FileDown aria-hidden className="size-4" />تنزيل PDF</a></div>
                      {actionable && canRespondQuote ? (
                        <div className="mt-3 border-t border-line pt-3">
                          <p className="mb-2 text-[13px] text-muted">قبولك يكون للنسخة المعروضة كما هي. يصلك العقد بعدها للتوقيع.</p>
                          <QuoteResponseForm action={respondQuote} quoteId={q.id} hash={q.contentHash ?? ""} />
                        </div>
                      ) : st === "expired" ? <p className="mt-3 text-[14px] text-fine">انتهت صلاحية هذا العرض ولا يمكن قبوله. سيصدر لك الفريق نسخة جديدة إن رغبت؛ اكتب لنا في المراسلات.</p> : null}
                    </details>
                  );
                })}
              </div>
            </Panel>
          ) : legacyQuote ? (
            <Panel title="عرض السعر" description="عرض صدر قبل نماذج العروض المفصلة.">
              <p className="tabular text-lg font-semibold">{fmtSAR(r.quoteAmount!)} قبل الضريبة</p>
              {canAct ? <div className="mt-4"><TransitionPanel action={clientTransition} id={r.id} transitions={d.transitions.filter((t) => t.to === "awaiting_contract").map((t) => ({ ...t, label: "أقبل عرض السعر" }))} /></div> : null}
            </Panel>
          ) : null}

          {/* Contracts */}
          {contracts.length ? (
            <Panel id="contract" title="العقد">
              <div className="space-y-4">
                {contracts.map((k) => {
                  const mine = k.parties.length ? k.signing.pending.filter((p) => p.side === "client" && p.signerUserId === auth.user.id) : (!k.signing.clientSigned && ["sent"].includes(k.status) && (k.partyUserId === auth.user.id || rc.memberSign) ? [null] : []);
                  return (
                    <div key={k.id} className="rounded-lg border border-line p-3" data-testid={`contract-${k.number}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{k.parentContractId ? "ملحق تعديل" : "العقد"} <span dir="ltr" className="tabular">{k.number}</span>{k.version > 1 ? ` — إصدار ${k.version}` : ""}</p>
                        <Badge tone={k.status === "signed" ? "ok" : k.status === "void" ? "neutral" : "warn"} icon={false}>{CONTRACT_STATUS_LABEL[k.status] ?? k.status}</Badge>
                      </div>
                      {k.voidReason ? <p className="text-[13px] text-muted">أُلغي: {k.voidReason}</p> : null}
                      {k.parties.length ? <div className="mt-2"><PartiesList parties={k.parties} signatures={k.signatures} /></div> : null}
                      <details open={mine.length > 0} className="mt-2">
                        <summary className="cursor-pointer text-[15px] text-ink">نص العقد</summary>
                        <div className="mt-2">
                          <ContractPaper body={k.body} number={k.number} hash={k.contentHash}
                            footer={!k.parties.length && k.signatures.length ? (
                              <ul className="mt-4 space-y-1 font-sans text-[13px] leading-6">
                                {k.signatures.map((s) => <li key={s.id}>{s.method === "otp" ? "توقيع العميل" : "توقيع الشركة"}: {names.get(s.userId)?.name ?? "—"} · {fmtDateTime(s.signedAt)}</li>)}
                              </ul>
                            ) : null} />
                        </div>
                      </details>
                      {k.status !== "void" ? <a href={`/app/requests/${r.id}/contract/${k.id}`} className="mt-2 inline-flex items-center gap-1 text-[14px] text-ink hover:underline"><FileDown aria-hidden className="size-4" />{k.status === "signed" ? "النسخة الموقّعة (PDF)" : "تنزيل PDF"}</a> : null}
                      {k.status !== "void" ? mine.map((p) => (
                        <div key={p?.key ?? "legacy"} className="mt-4 border-t border-line pt-4">
                          <SignContractForm requestOtp={requestSignOtp} sign={signContract} contractId={k.id} partyKey={p?.key ?? ""} asLabel={p ? `${AUTHORITY_LABEL[p.authorityType]} عن «${p.name}»` : undefined} />
                        </div>
                      )) : null}
                    </div>
                  );
                })}
              </div>
            </Panel>
          ) : r.status === "awaiting_contract" ? (
            <Panel title="العقد"><p className="text-[15px] text-muted">قبلت عرض السعر. يُعدّ الفريق العقد ويعتمده، ثم يصلك إشعار عند جاهزيته للتوقيع.</p></Panel>
          ) : null}

          {/* Invoices */}
          {d.invoices.length ? (
            <Panel title="الفواتير والمدفوعات">
              <ul className="divide-y divide-line">
                {d.invoices.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex items-center gap-2"><Receipt aria-hidden className="size-4 text-muted" /><Link href={`/app/billing/${i.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{i.number}</Link></span>
                    <span className="text-[13px] text-muted">{INVOICE_KIND_LABEL[i.kind as keyof typeof INVOICE_KIND_LABEL] ?? i.kind}{i.installmentLabel ? ` — ${i.installmentLabel}` : ""}</span>
                    <span className="tabular">{fmtSAR(i.total)}</span>
                    <Badge tone={INVOICE_STATUS_TONE[i.status] ?? "neutral"} icon={false}>{INVOICE_STATUS_LABEL[i.status] ?? i.status}</Badge>
                    {["issued", "partially_paid"].includes(i.status) && i.kind !== "proforma" && i.kind !== "credit_note" ? <ButtonLink href={`/app/billing/${i.id}`} size="sm">ادفع {i.status === "partially_paid" ? `المتبقي ${fmtSAR(i.balance)}` : ""}</ButtonLink> : null}
                  </li>
                ))}
              </ul>
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

          {(r.status === "completed" || r.status === "closed") && canAct ? (
            <Panel title="قيّم الخدمة" description="رأيك يساعدنا على تحسين الخدمة.">
              <RatingForm action={rateRequest} id={r.id} current={r.rating} comment={r.ratingComment} />
            </Panel>
          ) : null}

          {d.intakeSummary ? (
            <Panel title="بيانات طلبك">
              <details>
                <summary className="cursor-pointer text-[15px] text-ink">اعرض ما قدّمته في النموذج</summary>
                <div className="mt-3"><IntakeSummaryView sections={d.intakeSummary} /></div>
              </details>
            </Panel>
          ) : null}

          {r.status !== "draft" ? (
            <Panel title="المراسلات" description="رسائلك مع فريق وقفك حول هذا الطلب. تبقى الرسائل كما أُرسلت ولا تُحذف.">
              <NotesThread notes={notes} names={names} me={auth.user.id} docTitles={docTitle} />
              {!terminal && canAct ? <div className="mt-4 border-t border-line pt-4"><NoteFormWithAttachment action={postClientNote} id={r.id} requestId={r.id} waqfId={r.waqfId} docs={docOpts} /></div> : null}
            </Panel>
          ) : null}

          <Panel title="المستندات">
            <div className="space-y-4">
              <DocumentList requestId={r.id} emptyText="لم تُرفع مستندات لهذا الطلب بعد." />
              {canAct && !terminal && r.status !== "draft" ? <DocumentUploader requestId={r.id} waqfId={r.waqfId} compact /> : null}
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="حالة الطلب"><RequestStates states={d.states} /></Panel>
          <Panel title="المراحل"><StageTimeline stages={stages} /></Panel>
          <Panel title="بيانات الطلب">
            <DefinitionList cols={1} items={[
              { label: "الوقف", value: rc.waqf ? <Link className="text-ink hover:underline" href={`/app/w/${rc.waqf.id}`}>{rc.waqf.name}</Link> : "بلا وقف" },
              { label: "الأولوية", value: PRIORITY_LABEL[r.priority] ?? r.priority },
              { label: "المختص", value: assignee?.name ?? "لم يُسند بعد" },
              { label: "أُرسل", value: r.submittedAt ? fmtDate(r.submittedAt) : "لم يُرسل" },
              { label: "المهلة الحالية", value: <SlaBadge due={r.slaDueAt} status={r.status} /> },
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
