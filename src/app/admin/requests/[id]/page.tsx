import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2, FolderOpen } from "lucide-react";
import { Alert, Badge, ButtonLink, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { DocumentList } from "@/components/documents/list";
import { DocumentUploader } from "@/components/documents/uploader";
import { CONFLICT_LABEL, ConflictBadge, ContractPaper, CONTACT_LABEL, EventList, NotesThread, PRIORITY_LABEL, SlaBadge, StageTimeline, StatusBadge } from "@/components/requests/bits";
import { ActionForm, NoteForm, TransitionPanel } from "@/components/requests/forms";
import { fmtBoth, fmtDate, fmtDateTime, fmtSAR, WAQFAK_ROLE_LABEL } from "@/lib/utils";
import { maskPhone } from "@/server/auth/otp";
import { requireStaff } from "@/server/authz/context";
import {
  addDeliverable, advanceStageAction, assignRequest, overrideConflict, postStaffNote, setQuote, staffTransition,
} from "@/server/modules/requests/actions";
import { assignableStaff, requestDetail } from "@/server/modules/requests/queries";
import { HOLD_PARTY_LABEL } from "@/server/modules/requests/workflow";
import { countersignContract, generateContract } from "@/server/modules/contracts/actions";
import { issueInvoice } from "@/server/modules/billing/actions";
import { computeInvoice } from "@/server/modules/billing/calc";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "@/server/modules/billing/access";

export const metadata: Metadata = { title: "طلب — مساحة العمل" };

export default async function StaffRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireStaff("staff.requests.assigned");
  const d = await requestDetail(auth, id, "staff");
  if (!d) notFound();
  const { rc, stages, events, notes, deliverables, docs, contract, invoices, names } = d;
  const r = rc.req;
  const ops = rc.isOps;
  const staff = ops ? await assignableStaff(auth) : [];
  const terminal = ["closed", "cancelled", "rejected"].includes(r.status);
  const k = contract.contract;
  const quote = r.quoteAmount ? computeInvoice(Number(r.quoteAmount), d.vatRate) : null;
  const activeInvoice = invoices.find((i) => ["issued", "paid"].includes(i.status));
  const canInvoice = !activeInvoice && !["draft", "submitted", "cancelled", "rejected"].includes(r.status) && (k ? contract.clientSigned : !!(r.agreedPrice ?? r.quoteAmount));
  const iDelivered = rc.deliverers.includes(auth.user.id);
  const isOpinion = rc.workflowCode === "opinion";
  const requesterName = names.get(r.requesterUserId)?.name ?? "—";
  const assigneeName = r.assignedToUserId ? names.get(r.assignedToUserId)?.name : null;

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/admin/requests", label: "الطلبات" }, { label: r.number }]}
        title={rc.service.nameAr}
        description={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="tabular">{r.number}</span><StatusBadge status={r.status} /><ConflictBadge value={r.conflictCheck} /><SlaBadge due={r.slaDueAt} status={r.status} /></span>}
        actions={r.waqfId ? <ButtonLink href={`/app/w/${r.waqfId}`} variant="secondary" size="sm"><FolderOpen aria-hidden className="size-4" />ملف الوقف</ButtonLink> : null}
      />

      {r.conflictCheck === "blocked" ? (
        <Alert tone="critical" title="تعارض في الاستقلال — العمل موقوف">
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Panel title="سير العمل" description="الإجراءات المتاحة لك حسب الحالة ودورك.">
            <TransitionPanel action={staffTransition} id={r.id} transitions={d.transitions} holdParties={HOLD_PARTY_LABEL} />
            {r.status === "in_progress" && (rc.isAssignee || ops) ? (
              <div className="mt-3 border-t border-line pt-3">
                <ActionForm action={advanceStageAction} hidden={{ id: r.id }} submit="أنجزت المرحلة الحالية" variant="secondary" size="sm" />
              </div>
            ) : null}
          </Panel>

          {ops && !terminal ? (
            <Panel title="الإسناد" description={assigneeName ? `مسند حاليًا إلى ${assigneeName}` : "الطلب غير مسند"}>
              <ActionForm action={assignRequest} hidden={{ id: r.id }} submit={assigneeName ? "أعد الإسناد" : "أسند"} size="md">
                <Field label="الموظف" name="userId" required>
                  <Select name="userId" required defaultValue={r.assignedToUserId ?? ""} placeholder="اختر الموظف" options={staff.map((s) => ({ value: s.id, label: `${s.name} — ${s.roles.join("، ")}` }))} />
                </Field>
              </ActionForm>
            </Panel>
          ) : null}

          {["triage", "quote", "awaiting_client"].includes(r.status) ? (
            <Panel title="عرض السعر" description={quote ? `الحالي: ${fmtSAR(quote.net)} + ضريبة ${fmtSAR(quote.vat)} = ${fmtSAR(quote.total)}` : "حدّد المبلغ قبل الضريبة."}>
              <ActionForm action={setQuote} hidden={{ id: r.id }} submit="احفظ العرض">
                <Field label="المبلغ قبل الضريبة (ر.س)" name="amount" required>
                  <Input name="amount" type="number" min="1" step="0.01" inputMode="decimal" dir="ltr" required defaultValue={r.quoteAmount ?? ""} className="tabular max-w-60 text-start" />
                </Field>
                {r.status === "triage" ? <Checkbox name="send" label="أرسل العرض للعميل الآن" defaultChecked /> : null}
              </ActionForm>
            </Panel>
          ) : null}

          {r.status === "awaiting_contract" || k ? (
            <Panel id="contract" title={k ? `العقد ${k.number}` : "العقد"}
              actions={k ? <Badge tone={contract.clientSigned ? "ok" : "warn"} icon={false}>{contract.clientSigned ? (contract.companySigned ? "موقّع من الطرفين" : "وقّعه العميل") : "بانتظار توقيع العميل"}</Badge> : null}>
              {k ? (
                <details>
                  <summary className="mb-3 cursor-pointer text-[15px] text-ink">اعرض نص العقد</summary>
                  <ContractPaper body={k.body} number={k.number} hash={k.contentHash} />
                </details>
              ) : <p className="text-[15px] text-muted">قبل العميل عرض السعر. أنشئ العقد من القالب المعتمد ليوقّعه.</p>}
              {contract.signatures.length ? (
                <ul className="mt-3 space-y-1 text-[13px] text-muted">
                  {contract.signatures.map((s) => <li key={s.id}>{s.method === "otp" ? "العميل" : "الشركة"}: {names.get(s.userId)?.name ?? "—"} · {fmtDateTime(s.signedAt)} · IP <span dir="ltr">{s.ip ?? "—"}</span></li>)}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {r.status === "awaiting_contract" && !contract.clientSigned ? <ActionForm action={generateContract} hidden={{ id: r.id }} submit={k ? "أعد إنشاء العقد" : "أنشئ العقد وأرسله"} variant="secondary" size="sm" inline /> : null}
                {k && contract.clientSigned && !contract.companySigned && ops ? <ActionForm action={countersignContract} hidden={{ contractId: k.id }} submit="وقّع عن الشركة" variant="seal" size="sm" inline /> : null}
              </div>
            </Panel>
          ) : null}

          {invoices.length || canInvoice ? (
            <Panel title="الفوترة">
              {invoices.length ? (
                <ul className="mb-3 divide-y divide-line">
                  {invoices.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/app/billing/${i.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{i.number}</Link>
                      <span className="tabular">{fmtSAR(i.total)}</span>
                      <Badge tone={INVOICE_STATUS_TONE[i.status] ?? "neutral"} icon={false}>{INVOICE_STATUS_LABEL[i.status] ?? i.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              {canInvoice ? <ActionForm action={issueInvoice} hidden={{ id: r.id }} submit="أصدر الفاتورة" variant="secondary" size="sm" inline /> : null}
            </Panel>
          ) : null}

          <Panel title="المخرجات" description={isOpinion ? "رأي متخصص: يجب توقيع المخرج باسم المستشار وصفته قبل اعتماد الجودة." : undefined}>
            {deliverables.length ? (
              <ul className="mb-4 divide-y divide-line">
                {deliverables.map((x) => (
                  <li key={x.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex items-center gap-2"><FileCheck2 aria-hidden className="size-4 text-muted" />{x.title} <span className="text-[13px] text-muted">إصدار {x.version} · {names.get(x.createdBy ?? "")?.name ?? ""}</span></span>
                    <span className="flex items-center gap-2">
                      {x.signedBy ? <span className="text-[13px] text-muted">موقّع: {x.signedBy}</span> : isOpinion ? <Badge tone="fine" icon={false}>غير موقّع</Badge> : null}
                      <Badge tone={x.status === "approved" ? "ok" : x.status === "revision_requested" ? "fine" : "info"} icon={false}>{x.status === "approved" ? "معتمد" : x.status === "revision_requested" ? "مطلوب تعديله" : "مُسلّم"}</Badge>
                      {x.documentId ? <a href={`/api/files/${x.documentId}?disposition=inline`} target="_blank" rel="noopener" className="text-sm text-ink underline">فتح</a> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mb-4 text-sm text-muted">لا مخرجات بعد.</p>}
            {["in_progress", "quality_review"].includes(r.status) && auth.perms.has("staff.deliver") ? (
              <div className="space-y-4 border-t border-line pt-4">
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
            ) : null}
          </Panel>

          <Panel title="الملاحظات والمراسلات" description="الملاحظات الداخلية لا يراها العميل.">
            <NotesThread notes={notes} names={names} me={auth.user.id} showVisibility />
            {!terminal ? <div className="mt-4 border-t border-line pt-4"><NoteForm action={postStaffNote} id={r.id} staff /></div> : null}
          </Panel>

          <Panel title="مستندات الطلب">
            <DocumentList requestId={r.id} emptyText="لا مستندات لهذا الطلب." />
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="المراحل"><StageTimeline stages={stages} /></Panel>
          <Panel title="بيانات الطلب">
            <DefinitionList cols={1} items={[
              { label: "العميل", value: <>{requesterName}{d.requesterPhone ? <span dir="ltr" className="ms-2 text-[13px] text-muted">{maskPhone(d.requesterPhone)}</span> : null}</> },
              { label: "الوقف", value: rc.waqf ? <Link className="text-ink hover:underline" href={`/app/w/${rc.waqf.id}`}>{rc.waqf.name}</Link> : "بلا وقف" },
              { label: "دور وقفك في الوقف", value: rc.waqf ? WAQFAK_ROLE_LABEL[rc.waqf.waqfakRole] ?? rc.waqf.waqfakRole : "—" },
              { label: "المختص", value: assigneeName ?? "غير مسند" },
              { label: "الأولوية", value: PRIORITY_LABEL[r.priority] ?? r.priority },
              { label: "التواصل المفضل", value: CONTACT_LABEL[String((r.intake as { preferredContact?: string } | null)?.preferredContact ?? "platform")] },
              { label: "فحص الاستقلال", value: CONFLICT_LABEL[r.conflictCheck] ?? r.conflictCheck },
              { label: "المصدر", value: r.source === "recommendation" ? "توصية تقييم" : "طلب مباشر" },
              { label: "أُرسل", value: fmtDate(r.submittedAt) },
              { label: "التقييم", value: r.rating ? `${r.rating} من 5${r.ratingComment ? ` — ${r.ratingComment}` : ""}` : "—" },
              { label: "التفاصيل", value: <span className="whitespace-pre-line">{r.details}</span> },
            ]} />
          </Panel>
          <Panel title="سجل الطلب"><EventList events={events} names={names} /></Panel>
        </aside>
      </div>
    </div>
  );
}
