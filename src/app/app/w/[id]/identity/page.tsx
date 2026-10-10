import type { Metadata } from "next";
import { History, Landmark } from "lucide-react";
import { Alert, Badge, DataTable, DefinitionList, EmptyState, PageHeader, Panel } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { ActionForm, Disclosure } from "@/components/waqf/action-form";
import { fmtBoth, fmtDate, fmtSAR, SIZE_LABEL, TYPE_LABEL } from "@/lib/utils";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { waqfAccess } from "@/server/modules/waqf-core/queries";
import { addTimelineEvent, classifyWaqf, saveRegistration, updateIdentityExtras } from "@/server/modules/waqf-file/actions";
import { todayIso } from "@/server/modules/waqf-file/form";
import {
  BENEFICIARY_KIND_OPTIONS, CREATION_MODE_LABEL, options, REG_STATUS_LABEL, REG_STATUS_TONE, REG_TYPE_LABEL, TIMELINE_TYPES,
} from "@/server/modules/waqf-file/labels";
import { identityData } from "@/server/modules/waqf-file/queries";

export const metadata: Metadata = { title: "الهوية والتسجيل" };

const YES_NO = [{ value: "yes", label: "نعم" }, { value: "no", label: "لا" }];

export default async function IdentityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/identity` });
  const access = await waqfAccess(auth, id, "waqf.view");
  const w = access.waqf;
  const canEdit = waqfCan(access, "waqf.edit");
  const data = await read(auth, (tx) => identityData(tx, id));
  const today = todayIso();
  const certLeft = w.registrationExpiresOn ? Math.round((new Date(w.registrationExpiresOn).getTime() - new Date(today).getTime()) / 86_400_000) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الهوية والتسجيل"
        description="بيانات تعريف الوقف لدى الجهات الرسمية، وسجل تصنيف نوعه، وطلبات التسجيل لدى الهيئة العامة للأوقاف، والسجل الزمني."
        actions={canEdit ? <ActionLink href={`/app/w/${id}?edit=1#profile`} variant="secondary" size="sm">تعديل البيانات الأساسية</ActionLink> : null}
      />

      {!w.registeredOn && (w.documentedOn || w.deedNo) ? (
        <Alert tone="warn" title="الوقف موثّق ولم يُسجّل لدى الهيئة بعد">
          يلزم تسجيل الوقف وأصوله لدى الهيئة خلال 30 يوم عمل من التوثيق (لائحة تنظيم أعمال النظارة م8/1). سجّل الطلب أدناه وتابع حالته.
        </Alert>
      ) : null}
      {certLeft !== null && certLeft <= 60 ? (
        <Alert tone={certLeft < 0 ? "critical" : "warn"} title={certLeft < 0 ? "انتهت شهادة التسجيل" : "شهادة التسجيل تقترب من الانتهاء"}>
          تاريخ الانتهاء {fmtBoth(w.registrationExpiresOn)}. سجّل طلب التجديد أدناه.
        </Alert>
      ) : null}

      <Panel title="بيانات التسجيل">
        <DefinitionList
          cols={3}
          items={[
            { label: "الرقم الداخلي في وقفك", value: <span dir="ltr" className="tabular">{w.internalNumber}</span> },
            { label: "الرقم الوطني الموحد", value: w.nationalUnifiedNumber ? <span dir="ltr" className="tabular">{w.nationalUnifiedNumber}</span> : "لم يُدخل" },
            { label: "رقم شهادة التسجيل", value: w.registrationCertNo ? <span dir="ltr" className="tabular">{w.registrationCertNo}</span> : "لم يُدخل" },
            { label: "تاريخ التسجيل", value: w.registeredOn ? fmtBoth(w.registeredOn) : "غير مسجّل" },
            { label: "انتهاء الشهادة", value: w.registrationExpiresOn ? fmtBoth(w.registrationExpiresOn) : "—" },
            { label: "رقم الصك وجهة إصداره", value: w.deedNo ? `${w.deedNo}${w.deedIssuer ? ` — ${w.deedIssuer}` : ""}` : "لم يُدخل" },
            { label: "صيغة الإنشاء", value: CREATION_MODE_LABEL[w.creationMode] },
            { label: "النوع المعتمد", value: w.legalType ? TYPE_LABEL[w.legalType] : "لم يُصنّف" },
            { label: "الفئة حسب الحجم", value: w.sizeClass ? `${SIZE_LABEL[w.sizeClass]}${w.sizeClassLocked ? " (مثبّتة من الإدارة)" : ""}` : "غير محددة" },
            { label: "قيمة الأصول التقديرية", value: fmtSAR(w.assetsEstimatedValue), hint: "تُحدَّث من سجل الأصول" },
            { label: "مجال العمل", value: w.fieldOfWork ?? "—" },
            { label: "النطاق الجغرافي والمقر", value: [w.geographicScope, w.domicile].filter(Boolean).join(" — ") || "—" },
          ]}
        />
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary="تعديل البيانات التعريفية الإضافية">
              <ActionForm
                action={updateIdentityExtras}
                hidden={{ waqfId: id }}
                submitLabel="احفظ"
                fields={[
                  { name: "registrationCertNo", label: "رقم شهادة التسجيل", defaultValue: w.registrationCertNo, ltr: true },
                  { name: "deedIssuer", label: "جهة إصدار الصك", defaultValue: w.deedIssuer, placeholder: "مثال: المحكمة العامة بالرياض" },
                  { name: "fieldOfWork", label: "مجال العمل", defaultValue: w.fieldOfWork },
                  { name: "geographicScope", label: "النطاق الجغرافي", defaultValue: w.geographicScope },
                  { name: "domicile", label: "المقر", defaultValue: w.domicile },
                  { name: "creationMode", label: "صيغة الإنشاء", type: "select", options: options(CREATION_MODE_LABEL), defaultValue: w.creationMode, required: true },
                  { name: "directBenefit", label: "وقف ذو انتفاع مباشر (يُنتفع بعينه كمسجد أو سكن، لا بغلته)", type: "checkbox", defaultValue: w.directBenefit, wide: true, hint: "يغيّر فئة الوقف إلى «ذو انتفاع مباشر» ما لم تكن مثبّتة." },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="تصنيف نوع الوقف" description="يُحسب النوع من شرط الواقف في المصرف وفق الدليل الاسترشادي لتصنيف أنواع الوقف، ويُحفظ كل تصنيف في سجل تاريخي.">
        {w.computedTypeReason ? (
          <p className="mb-4 rounded-md bg-surface-2 px-3 py-2 text-[14px] leading-7">
            <Badge tone="ink" icon={false}>{w.legalType ? TYPE_LABEL[w.legalType] : "—"}</Badge> <span className="ms-1">{w.computedTypeReason}</span>
          </p>
        ) : null}
        <DataTable
          rows={data.classes}
          rowKey={(r) => r.c.id}
          empty={<EmptyState icon={Landmark} title="لا تصنيف مسجّل">صنّف الوقف من النموذج أدناه بالإجابة عن شرط الواقف في المصرف.</EmptyState>}
          columns={[
            { key: "from", label: "يسري من", render: (r) => fmtDate(r.c.effectiveFrom) },
            { key: "type", label: "النوع المعتمد", render: (r) => (r.c.legalType ? TYPE_LABEL[r.c.legalType] : "—") },
            { key: "computed", label: "المحسوب", render: (r) => (r.c.computedType ? TYPE_LABEL[r.c.computedType] : "—") + (r.c.computedType && r.c.legalType && r.c.computedType !== r.c.legalType ? " ⚠" : "") },
            { key: "reason", label: "السبب", render: (r) => <span className="text-[14px]">{r.c.reason ?? "—"}</span> },
            { key: "by", label: "سجّله", render: (r) => r.by ?? "—", hideOnMobile: true },
          ]}
        />
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary="صنّف الوقف" testId="classify-form">
              <ActionForm
                action={classifyWaqf}
                hidden={{ waqfId: id }}
                submitLabel="احسب واحفظ التصنيف"
                footnote="التصنيف محسوب آليًا؛ وإن تضمّن المصرف وصفًا خيريًا على الذرية فاعرضه على مختص قبل اعتماده."
                fields={[
                  { name: "beneficiaryKind", label: "على من شرط الواقف صرف الغلة؟", type: "select", options: BENEFICIARY_KIND_OPTIONS, required: true, wide: true },
                  { name: "charitableQualifier", label: "إن كان على الذرية: هل قيّده بوصف خيري كالفقر أو الحاجة؟", type: "select", options: YES_NO },
                  { name: "thenToCharity", label: "وهل جعله بعدهم لجهة بر؟", type: "select", options: YES_NO },
                  { name: "legalType", label: "النوع المعتمد", type: "select", options: options(TYPE_LABEL), required: true, defaultValue: w.legalType, hint: "إن خالف المحسوب فاذكر السبب." },
                  { name: "effectiveFrom", label: "يسري من", type: "date", required: true, defaultValue: today },
                  { name: "reason", label: "سبب الاعتماد أو المخالفة", type: "textarea", wide: true },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="طلبات التسجيل لدى الهيئة" description="إصدار شهادة التسجيل وتجديدها وتعديل بياناتها. صدور الشهادة يحدّث ملف الوقف ويغلق التزام التسجيل.">
        <DataTable
          rows={data.regs}
          rowKey={(r) => r.id}
          empty={<p className="py-4 text-center text-muted">لا طلبات مسجلة.</p>}
          columns={[
            { key: "type", label: "الطلب", render: (r) => REG_TYPE_LABEL[r.requestType] ?? r.requestType },
            { key: "status", label: "الحالة", render: (r) => <Badge tone={REG_STATUS_TONE[r.status]}>{REG_STATUS_LABEL[r.status] ?? r.status}</Badge> },
            { key: "sub", label: "قُدّم في", render: (r) => fmtDate(r.submittedOn) },
            { key: "cert", label: "الشهادة", render: (r) => (r.certNo ? <span dir="ltr" className="tabular">{r.certNo}</span> : "—") },
            { key: "exp", label: "تنتهي", render: (r) => fmtDate(r.expiresOn) },
            ...(canEdit
              ? [{
                  key: "edit", label: "تحديث", render: (r: (typeof data.regs)[number]) => (
                    <Disclosure summary="حدّث الحالة">
                      <ActionForm
                        action={saveRegistration}
                        hidden={{ waqfId: id, registrationId: r.id, requestType: r.requestType }}
                        submitLabel="احفظ"
                        fields={[
                          { name: "status", label: "الحالة", type: "select", options: options(REG_STATUS_LABEL), defaultValue: r.status, required: true },
                          { name: "submittedOn", label: "تاريخ التقديم", type: "date", defaultValue: r.submittedOn },
                          { name: "certNo", label: "رقم الشهادة", defaultValue: r.certNo, ltr: true },
                          { name: "issuedOn", label: "تاريخ الصدور", type: "date", defaultValue: r.issuedOn },
                          { name: "expiresOn", label: "تاريخ الانتهاء", type: "date", defaultValue: r.expiresOn },
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
          <div className="mt-4">
            <Disclosure summary="سجّل طلبًا جديدًا">
              <ActionForm
                action={saveRegistration}
                hidden={{ waqfId: id }}
                submitLabel="سجّل الطلب"
                fields={[
                  { name: "requestType", label: "نوع الطلب", type: "select", options: options(REG_TYPE_LABEL), required: true, defaultValue: w.registeredOn ? "renew" : "issue" },
                  { name: "status", label: "الحالة", type: "select", options: options(REG_STATUS_LABEL), required: true, defaultValue: "submitted" },
                  { name: "submittedOn", label: "تاريخ التقديم", type: "date", defaultValue: today },
                  { name: "certNo", label: "رقم الشهادة (إن صدرت)", ltr: true },
                  { name: "issuedOn", label: "تاريخ الصدور", type: "date" },
                  { name: "expiresOn", label: "تاريخ الانتهاء", type: "date" },
                  { name: "notes", label: "ملاحظات", type: "textarea", wide: true },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="السجل الزمني" description="الأحداث المهمة في حياة الوقف بترتيب زمني.">
        {data.timeline.length ? (
          <ol className="relative space-y-4 border-s border-line ps-5">
            {data.timeline.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className="absolute -start-[27px] top-2 size-3 rounded-full bg-seal ring-4 ring-surface" />
                <p className="text-[13px] text-muted">
                  <time dateTime={e.occurredOn}>{fmtBoth(e.occurredOn)}</time> · {TIMELINE_TYPES[e.type] ?? e.type}
                </p>
                <p className="font-medium">{e.title}</p>
                {e.details ? <p className="text-sm text-muted">{e.details}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState icon={History} title="لا أحداث مسجّلة" />
        )}
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary="أضف حدثًا">
              <ActionForm
                action={addTimelineEvent}
                hidden={{ waqfId: id }}
                submitLabel="أضف"
                fields={[
                  { name: "occurredOn", label: "التاريخ", type: "date", required: true, defaultValue: today },
                  { name: "title", label: "العنوان", required: true },
                  { name: "details", label: "التفاصيل", type: "textarea", wide: true },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
