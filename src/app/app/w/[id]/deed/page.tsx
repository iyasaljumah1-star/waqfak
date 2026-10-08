import type { Metadata } from "next";
import { FileSignature, ScrollText } from "lucide-react";
import { Alert, Badge, DataTable, DefinitionList, EmptyState, PageHeader, Panel } from "@/components/ui";
import { DocumentList } from "@/components/documents";
import { DocumentUploader } from "@/components/documents/uploader";
import { ActionButton, ActionForm, Disclosure } from "@/components/waqf/action-form";
import { AllocationBar, DeedText, Muted, SubHead } from "@/components/waqf/bits";
import { fmtBoth, fmtDate, fmtSAR } from "@/lib/utils";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { addDeedVersion, addException, addInterpretation, recordShariaReview, removeException, saveAllocation, saveApproval, saveCondition, saveDeed } from "@/server/modules/deed/actions";
import { allocationTotal } from "@/server/modules/deed/pure";
import { deedData } from "@/server/modules/deed/queries";
import { waqfAccess } from "@/server/modules/waqf-core/queries";
import {
  ALLOCATION_FIELDS, APPROVAL_KIND_LABEL, APPROVAL_STATUS_LABEL, APPROVAL_STATUS_TONE, AUTHORITY_LABEL, CONDITION_CATEGORIES, CONDITION_CATEGORY_LABEL,
  DEED_STATUS_LABEL, EXCEPTION_DURATION_LABEL, EXCEPTION_KIND_LABEL, INTERP_SOURCE_LABEL, options, SHARIA_REVIEW_LABEL, SHARIA_REVIEW_TONE,
} from "@/server/modules/waqf-file/labels";

export const metadata: Metadata = { title: "الوثيقة والشروط" };

export default async function DeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/deed` });
  const access = await waqfAccess(auth, id, "deed.view");
  const w = access.waqf;
  const canEdit = waqfCan(access, "deed.edit");
  const canInterpret = waqfCan(access, "conditions.interpret");
  const d = await read(auth, (tx) => deedData(tx, id));
  const latest = d.versions[0]?.v ?? null;
  const a = d.allocation;
  const allocParts = ALLOCATION_FIELDS.map((f) => ({ label: f.label, pct: Number(a?.[f.key] ?? 0) || 0 }));
  const allocSum = a ? allocationTotal(a) : 0;
  const unreviewed = d.conditions.filter((c) => c.shariaReview !== "approved").length;

  return (
    <div className="space-y-6">
      <PageHeader title="الوثيقة والشروط" description="صك الوقف وإصداراته، وفهرس شروط الواقف مع حالة مراجعتها الشرعية وتفسيراتها، وما استثناه الواقف لنفسه، وقواعد توزيع الغلة، والأذونات." />

      <Panel title="صك الوقف" actions={d.deed ? <Badge tone={d.deed.status === "draft" ? "neutral" : "ok"} icon={false}>{DEED_STATUS_LABEL[d.deed.status] ?? d.deed.status}</Badge> : null}>
        <DefinitionList
          cols={3}
          items={[
            { label: "رقم الصك", value: d.deed?.deedNo ?? w.deedNo ?? "لم يُدخل" },
            { label: "جهة الإصدار", value: d.deed?.issuer ?? w.deedIssuer ?? "—" },
            { label: "التاريخ", value: d.deed?.issuedOn ? fmtBoth(d.deed.issuedOn) : (d.deed?.issuedOnHijri ?? w.deedDateHijri ?? "—") },
            { label: "الإصدار الحالي", value: latest ? `الإصدار ${latest.version}` : "لا نص محفوظ" },
          ]}
        />
        {d.deed ? (
          <div className="mt-4 space-y-3">
            <SubHead>نسخة الصك الممسوحة</SubHead>
            <DocumentList waqfId={id} link={{ entityType: "waqf_deed", entityId: d.deed.id }} emptyText="لم تُرفع نسخة من الصك." />
            {waqfCan(access, "documents.upload") ? <DocumentUploader waqfId={id} link={{ entityType: "waqf_deed", entityId: d.deed.id }} docType="waqf_deed" confidentiality="confidential" defaultTitle="صك الوقف" /> : null}
          </div>
        ) : null}
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary={d.deed ? "عدّل بيانات الصك" : "سجّل بيانات الصك"}>
              <ActionForm
                action={saveDeed}
                hidden={{ waqfId: id }}
                submitLabel="احفظ"
                fields={[
                  { name: "deedNo", label: "رقم الصك", defaultValue: d.deed?.deedNo ?? w.deedNo, ltr: true },
                  { name: "issuer", label: "جهة الإصدار", defaultValue: d.deed?.issuer ?? w.deedIssuer },
                  { name: "issuedOn", label: "التاريخ الميلادي", type: "date", defaultValue: d.deed?.issuedOn ?? w.deedDate },
                  { name: "issuedOnHijri", label: "التاريخ الهجري", defaultValue: d.deed?.issuedOnHijri ?? w.deedDateHijri, placeholder: "1445/09/03" },
                  { name: "status", label: "الحالة", type: "select", options: options(DEED_STATUS_LABEL), defaultValue: d.deed?.status ?? (w.documentedOn ? "documented" : "draft"), required: true },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="نص الوثيقة وإصداراته" description="يُحفظ كل تعديل إصدارًا مستقلًا مع سببه؛ لا يُكتب فوق نص سابق.">
        {latest?.body ? (
          <div className="deed-paper naskh max-h-[28rem] overflow-y-auto">
            <DeedText text={latest.body} />
          </div>
        ) : (
          <EmptyState icon={ScrollText} title="لا نص محفوظ للوثيقة">الصق نص الصك كما هو لتسهيل الرجوع إلى الشروط وربطها بالقرارات.</EmptyState>
        )}
        {d.versions.length > 1 ? (
          <ul className="mt-4 space-y-1 text-[14px]">
            {d.versions.map(({ v, by }) => (
              <li key={v.id} className="flex flex-wrap gap-x-3">
                <span className="font-medium">الإصدار {v.version}</span>
                <span className="text-muted">{fmtDate(v.createdAt)} · {by ?? "—"}</span>
                <span>{v.changeNote}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary="أضف إصدارًا جديدًا">
              <ActionForm
                action={addDeedVersion}
                hidden={{ waqfId: id }}
                submitLabel="احفظ الإصدار"
                cols={1}
                fields={[
                  { name: "body", label: "نص الوثيقة", type: "textarea", required: true, defaultValue: latest?.body ?? "", maxLength: 60000 },
                  { name: "changeNote", label: "سبب الإصدار", required: true, placeholder: "مثال: تعديل بند النظارة بموجب حكم المحكمة رقم…" },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="فهرس الشروط"
        description="نص كل شرط كما ورد، مصنّفًا. التفسير لا يُعتمد آليًا: يُسجّل مصدره، ويبقى معلّمًا حتى يراجعه مختص شرعي."
        actions={d.conditions.length ? <Badge tone={unreviewed ? "warn" : "ok"}>{unreviewed ? `${unreviewed} شرط بلا اعتماد شرعي` : "كل الشروط روجعت"}</Badge> : null}
      >
        {d.conditions.length ? (
          <div className="space-y-5">
            {CONDITION_CATEGORIES.filter((cat) => d.conditions.some((c) => c.category === cat)).map((cat) => (
              <section key={cat}>
                <SubHead>{CONDITION_CATEGORY_LABEL[cat]}</SubHead>
                <ul className="space-y-3">
                  {d.conditions.filter((c) => c.category === cat).map((c) => {
                    const its = d.interpretations.filter((i) => i.conditionId === c.id);
                    return (
                      <li key={c.id} className="rounded-md border border-line p-3" data-testid="condition">
                        <div className="flex flex-wrap items-center gap-2">
                          {c.clauseRef ? <span className="text-[13px] text-muted">البند {c.clauseRef}</span> : null}
                          <Badge tone={SHARIA_REVIEW_TONE[c.shariaReview]}>{SHARIA_REVIEW_LABEL[c.shariaReview]}</Badge>
                        </div>
                        <blockquote className="naskh mt-2 border-s-4 border-seal/50 ps-3 text-[1.05rem] leading-8">{c.literalText}</blockquote>
                        {its.length ? (
                          <div className="mt-3 space-y-2">
                            {its.map((i) => (
                              <div key={i.id} className="rounded bg-surface-2 px-3 py-2 text-[14px]">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">تفسير {INTERP_SOURCE_LABEL[i.source] ?? i.source}</span>
                                  {c.shariaReview !== "approved" ? <Badge tone="warn">يحتاج اعتماد مختص شرعي</Badge> : null}
                                  <span className="text-[13px] text-muted">{i.signedBy}{i.decidedOn ? ` · ${fmtDate(i.decidedOn)}` : ""}</span>
                                </div>
                                <p className="mt-1 whitespace-pre-line">{i.text}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {canEdit ? (
                            <Disclosure summary="عدّل الشرط">
                              <ActionForm
                                action={saveCondition}
                                hidden={{ waqfId: id, conditionId: c.id }}
                                submitLabel="احفظ"
                                fields={[
                                  { name: "category", label: "الفئة", type: "select", options: options(CONDITION_CATEGORY_LABEL), defaultValue: c.category, required: true },
                                  { name: "clauseRef", label: "رقم البند", defaultValue: c.clauseRef },
                                  { name: "literalText", label: "النص", type: "textarea", defaultValue: c.literalText, required: true, wide: true },
                                  { name: "position", label: "الترتيب", type: "number", defaultValue: c.position },
                                ]}
                              />
                            </Disclosure>
                          ) : null}
                          {canInterpret ? (
                            <Disclosure summary="سجّل تفسيرًا">
                              <ActionForm
                                action={addInterpretation}
                                hidden={{ waqfId: id, conditionId: c.id }}
                                submitLabel="سجّل التفسير"
                                footnote="يُسجّل التفسير منسوبًا إلى مصدره، ولا تعتمده المنصة؛ يظهر بعلامة «يحتاج اعتماد مختص شرعي» حتى تُسجّل نتيجة المراجعة."
                                fields={[
                                  { name: "text", label: "نص التفسير", type: "textarea", required: true, wide: true },
                                  { name: "source", label: "المصدر", type: "select", options: options(INTERP_SOURCE_LABEL), required: true },
                                  { name: "signedBy", label: "صدر عن", required: true },
                                  { name: "decidedOn", label: "التاريخ", type: "date" },
                                  { name: "documentRef", label: "المرجع (رقم الحكم أو الفتوى)" },
                                ]}
                              />
                            </Disclosure>
                          ) : null}
                          {canEdit ? (
                            <Disclosure summary="سجّل نتيجة المراجعة الشرعية">
                              <ActionForm
                                action={recordShariaReview}
                                hidden={{ waqfId: id, conditionId: c.id }}
                                submitLabel="سجّل النتيجة"
                                footnote="سجّل ما ورد في رأي مختص شرعي موثّق فقط؛ المنصة لا تحكم على الشروط."
                                fields={[
                                  { name: "shariaReview", label: "النتيجة", type: "select", options: options(SHARIA_REVIEW_LABEL), defaultValue: c.shariaReview, required: true },
                                  { name: "reviewer", label: "المختص الشرعي" },
                                  { name: "reference", label: "مرجع الرأي" },
                                ]}
                              />
                            </Disclosure>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState icon={FileSignature} title="لم تُفهرس الشروط بعد">انسخ شروط الواقف من الصك وصنّفها ليسهل الرجوع إليها عند كل قرار.</EmptyState>
        )}
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary="أضف شرطًا">
              <ActionForm
                action={saveCondition}
                hidden={{ waqfId: id }}
                submitLabel="أضف الشرط"
                fields={[
                  { name: "category", label: "الفئة", type: "select", options: options(CONDITION_CATEGORY_LABEL), required: true },
                  { name: "clauseRef", label: "رقم البند" },
                  { name: "literalText", label: "النص كما ورد", type: "textarea", required: true, wide: true },
                  { name: "position", label: "الترتيب", type: "number", defaultValue: d.conditions.length + 1 },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="ما استثناه الواقف لنفسه" description="انتفاع الواقف أو غيره بالوقف أو غلته مدة معينة، وما يؤول إليه بعدها.">
        <DataTable
          rows={d.exceptions}
          rowKey={(e) => e.id}
          empty={<Muted>لا استثناءات مسجلة.</Muted>}
          columns={[
            { key: "who", label: "المستثنى له", render: (e) => e.beneficiaryName },
            { key: "kind", label: "النوع", render: (e) => `${EXCEPTION_KIND_LABEL[e.kind] ?? e.kind}${e.quantity ? ` (${e.quantity})` : ""}` },
            { key: "dur", label: "المدة", render: (e) => (e.duration === "until_date" ? `حتى ${fmtDate(e.untilDate)}` : EXCEPTION_DURATION_LABEL[e.duration]) },
            { key: "after", label: "ثم", render: (e) => e.afterwards ?? "يعود إلى المصارف" },
            ...(canEdit ? [{ key: "x", label: "", render: (e: (typeof d.exceptions)[number]) => <ActionButton action={removeException} hidden={{ waqfId: id, exceptionId: e.id }} label="احذف" variant="ghost" confirm="حذف الاستثناء؟" /> }] : []),
          ]}
        />
        {canEdit ? (
          <div className="mt-3">
            <Disclosure summary="أضف استثناء">
              <ActionForm
                action={addException}
                hidden={{ waqfId: id }}
                submitLabel="أضف"
                fields={[
                  { name: "beneficiaryName", label: "المستثنى له", required: true },
                  { name: "kind", label: "النوع", type: "select", options: options(EXCEPTION_KIND_LABEL), required: true },
                  { name: "duration", label: "المدة", type: "select", options: options(EXCEPTION_DURATION_LABEL), required: true, defaultValue: "life" },
                  { name: "untilDate", label: "حتى تاريخ", type: "date" },
                  { name: "quantity", label: "المقدار (إن كان مقدارًا)" },
                  { name: "afterwards", label: "ثم يؤول إلى" },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="قواعد توزيع الغلة" description="نسب تُقتطع من صافي الغلة قبل الصرف على المستفيدين. لا يتجاوز مجموعها 100%.">
        {a ? (
          <>
            <AllocationBar parts={[...allocParts, { label: "المستفيدون", pct: Math.max(0, 100 - allocSum), tone: "bg-ok" }]} />
            {a.nazirFeeFixed ? <p className="mt-2 text-[14px]">أجرة ثابتة للناظر: {fmtSAR(a.nazirFeeFixed)} سنويًا.</p> : null}
            {a.notes ? <p className="mt-2 text-[14px] text-muted">{a.notes}</p> : null}
          </>
        ) : (
          <Alert tone="info" title="لم تُسجّل قواعد التوزيع">إن سكت شرط الواقف فتُقدّم عمارة الوقف وحفظ أصله على الصرف للمستحقين.</Alert>
        )}
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary="عدّل النسب" testId="allocation-form">
              <ActionForm
                action={saveAllocation}
                hidden={{ waqfId: id }}
                submitLabel="احفظ التوزيع"
                fields={[
                  ...ALLOCATION_FIELDS.map((f) => ({ name: f.key, label: `${f.label} (%)`, type: "number" as const, defaultValue: a?.[f.key] ?? "" })),
                  { name: "nazirFeeFixed", label: "أجرة ثابتة للناظر (ريال سنويًا)", type: "number", defaultValue: a?.nazirFeeFixed ?? "" },
                  { name: "notes", label: "ملاحظات من شرط الواقف", type: "textarea", wide: true, defaultValue: a?.notes ?? "" },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="الأذونات" description="أذونات الجهة المختصة أو الهيئة أو المحكمة: استبدال، رهن، مخالفة شرط لمصلحة، أجرة الناظر…">
        <DataTable
          rows={d.approvals}
          rowKey={(r) => r.id}
          empty={<Muted>لا أذونات مسجلة.</Muted>}
          columns={[
            { key: "subj", label: "الموضوع", render: (r) => <span className="font-medium">{r.subject}</span> },
            { key: "kind", label: "النوع", render: (r) => APPROVAL_KIND_LABEL[r.kind] },
            { key: "auth", label: "الجهة", render: (r) => AUTHORITY_LABEL[r.authority], hideOnMobile: true },
            { key: "status", label: "الحالة", render: (r) => <Badge tone={APPROVAL_STATUS_TONE[r.status]}>{APPROVAL_STATUS_LABEL[r.status]}</Badge> },
            { key: "date", label: "القرار", render: (r) => (r.decidedOn ? fmtDate(r.decidedOn) : "—") },
            ...(canEdit
              ? [{
                  key: "e", label: "", render: (r: (typeof d.approvals)[number]) =>
                    r.status === "granted" ? null : (
                      <Disclosure summary="حدّث">
                        <ActionForm
                          action={saveApproval}
                          hidden={{ waqfId: id, approvalId: r.id, kind: r.kind, authority: r.authority, subject: r.subject, assetId: r.assetId ?? "" }}
                          submitLabel="احفظ"
                          fields={[
                            { name: "status", label: "الحالة", type: "select", options: options(APPROVAL_STATUS_LABEL), defaultValue: r.status, required: true },
                            { name: "refNo", label: "رقم الإذن", defaultValue: r.refNo },
                            { name: "submittedOn", label: "تاريخ التقديم", type: "date", defaultValue: r.submittedOn },
                            { name: "decidedOn", label: "تاريخ القرار", type: "date", defaultValue: r.decidedOn },
                            { name: "notes", label: "ملاحظات", type: "textarea", defaultValue: r.notes, wide: true },
                          ]}
                        />
                      </Disclosure>
                    ),
                }]
              : []),
          ]}
        />
        {canEdit ? (
          <div className="mt-3">
            <Disclosure summary="سجّل طلب إذن">
              <ActionForm
                action={saveApproval}
                hidden={{ waqfId: id }}
                submitLabel="سجّل"
                fields={[
                  { name: "subject", label: "الموضوع", required: true, wide: true },
                  { name: "kind", label: "النوع", type: "select", options: options(APPROVAL_KIND_LABEL), required: true },
                  { name: "authority", label: "الجهة", type: "select", options: options(AUTHORITY_LABEL), required: true, defaultValue: "competent_authority" },
                  { name: "status", label: "الحالة", type: "select", options: options(APPROVAL_STATUS_LABEL), required: true, defaultValue: "draft" },
                  { name: "assetId", label: "الأصل المعني", type: "select", options: d.assetOpts.map((x) => ({ value: x.id, label: x.title })) },
                  { name: "refNo", label: "رقم الإذن" },
                  { name: "submittedOn", label: "تاريخ التقديم", type: "date" },
                  { name: "decidedOn", label: "تاريخ القرار", type: "date" },
                  { name: "notes", label: "ملاحظات", type: "textarea", wide: true },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
