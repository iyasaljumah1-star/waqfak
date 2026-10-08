import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, DataTable, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { DocumentList } from "@/components/documents";
import { DocumentUploader } from "@/components/documents/uploader";
import { ActionButton, ActionForm, Disclosure } from "@/components/waqf/action-form";
import { assetFields } from "@/components/waqf/asset-fields";
import { Muted } from "@/components/waqf/bits";
import { fmtBoth, fmtDate, fmtNumber, fmtPct, fmtSAR, relDays } from "@/lib/utils";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import {
  addEncumbrance, addLease, addMaintenance, addValuation, archiveAsset, completeMaintenance, resolveEncumbrance, saveAsset, saveInvestment, saveProperty, substituteAsset, updateLease,
} from "@/server/modules/assets/actions";
import { leaseAlert } from "@/server/modules/assets/pure";
import { assetDetail } from "@/server/modules/assets/queries";
import { isUuid, waqfAccess } from "@/server/modules/waqf-core/queries";
import { todayIso } from "@/server/modules/waqf-file/form";
import {
  ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, ASSET_STATUS_TONE, ASSET_SUBJECT_LABEL, CONDITION_LABEL, ENCUMBRANCE_LABEL, FINANCIAL_CATEGORIES, FREQUENCY_LABEL, INSTRUMENT_LABEL, options, USAGE_LABEL,
} from "@/server/modules/waqf-file/labels";

export const metadata: Metadata = { title: "تفاصيل الأصل" };

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string; assetId: string }> }) {
  const { id, assetId } = await params;
  if (!isUuid(assetId)) notFound();
  const auth = await requireAuth({ next: `/app/w/${id}/assets/${assetId}` });
  const access = await waqfAccess(auth, id, "assets.view");
  const canEdit = waqfCan(access, "assets.edit");
  const d = await read(auth, (tx) => assetDetail(tx, id, assetId));
  if (!d) notFound();
  const a = d.asset;
  const today = todayIso();
  const p = d.property;
  const inv = d.investment;
  const isRE = a.category === "real_estate";
  const isFin = FINANCIAL_CATEGORIES.includes(a.category);
  const h = { waqfId: id, assetId };
  const open = !a.archivedAt && canEdit;

  return (
    <div className="space-y-6">
      <PageHeader
        title={a.title}
        description={`${ASSET_CATEGORY_LABEL[a.category] ?? a.category} · ${ASSET_SUBJECT_LABEL[a.subject] ?? a.subject}`}
        crumbs={[{ href: `/app/w/${id}/assets`, label: "الأصول والاستثمار" }, { label: a.title }]}
        actions={<Badge tone={ASSET_STATUS_TONE[a.status]} icon={false}>{ASSET_STATUS_LABEL[a.status]}</Badge>}
      />
      {a.archivedAt ? <Alert tone="neutral" title="أصل مؤرشف">{a.archiveReason}</Alert> : null}

      <Panel title="البيانات الأساسية">
        <DefinitionList
          cols={3}
          items={[
            { label: "القيمة السوقية", value: fmtSAR(a.marketValue), hint: a.lastValuationOn ? `آخر تقييم ${fmtDate(a.lastValuationOn)}${a.valuer ? ` — ${a.valuer}` : ""}` : "لم يُقيّم" },
            { label: "القيمة الدفترية", value: fmtSAR(a.bookValue) },
            { label: "الدخل السنوي", value: fmtSAR(a.annualIncome) },
            { label: "مستند الملكية", value: a.ownershipDocNo ? <span dir="ltr" className="tabular">{a.ownershipDocNo}</span> : "لم يُدخل" },
            { label: "باسم الوقف", value: a.inWaqfName ? "نعم" : <span className="font-medium text-fine">غير مؤكد</span> },
            { label: "حصة مشاعة", value: a.sharePct ? fmtPct(a.sharePct) : "كامل الأصل" },
          ]}
        />
        {a.notes ? <p className="mt-3 text-[14px] text-muted">{a.notes}</p> : null}
        <div className="mt-4 space-y-2">
          <DocumentList waqfId={id} link={{ entityType: "asset", entityId: a.id }} emptyText="لا مستندات مرتبطة بالأصل (صك الملكية، رخص، تقارير)." />
          {open && waqfCan(access, "documents.upload") ? <DocumentUploader waqfId={id} link={{ entityType: "asset", entityId: a.id }} defaultDocType="ownership_deed" defaultTitle={`مستند — ${a.title}`} /> : null}
        </div>
        {open ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Disclosure summary="عدّل البيانات"><ActionForm action={saveAsset} hidden={{ ...h }} submitLabel="احفظ" fields={assetFields(a)} /></Disclosure>
            <Disclosure summary="استبدال الأصل">
              {d.subApprovals.length ? (
                <ActionForm
                  action={substituteAsset}
                  hidden={h}
                  submitLabel="سجّل الاستبدال"
                  footnote="يُؤرشف الأصل الحالي ويُسجّل البديل، ويُضاف التزام إشعار الهيئة خلال 10 أيام عمل."
                  fields={[
                    { name: "approvalId", label: "إذن الاستبدال", type: "select", required: true, options: d.subApprovals.map((x) => ({ value: x.id, label: `${x.subject}${x.refNo ? ` — ${x.refNo}` : ""}` })) },
                    { name: "substitutedOn", label: "تاريخ الاستبدال", type: "date", required: true, defaultValue: today },
                    { name: "newTitle", label: "وصف الأصل البديل", required: true, wide: true },
                    { name: "newCategory", label: "نوعه", type: "select", options: options(ASSET_CATEGORY_LABEL), required: true, defaultValue: a.category },
                    { name: "newValue", label: "قيمته (ريال)", type: "number", required: true },
                    { name: "newOwnershipDocNo", label: "رقم مستند ملكيته", ltr: true },
                  ]}
                />
              ) : (
                <Muted>الاستبدال يحتاج إذنًا صادرًا من الجهة المختصة. سجّله أولًا في «الوثيقة والشروط ← الأذونات» بنوع «استبدال أصل» وحالة «صدر الإذن».</Muted>
              )}
            </Disclosure>
            <Disclosure summary="إخراج من السجل">
              <ActionForm action={archiveAsset} hidden={h} submitLabel="أرشف الأصل" cols={1} fields={[{ name: "reason", label: "السبب", required: true }]} />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      {isRE ? (
        <Panel title="بيانات العقار">
          {p ? (
            <DefinitionList
              cols={3}
              items={[
                { label: "الموقع", value: [p.city, p.district].filter(Boolean).join(" — ") || "—" },
                { label: "الاستخدام", value: p.usage ? USAGE_LABEL[p.usage] : "—" },
                { label: "المساحة", value: p.areaSqm ? `${fmtNumber(p.areaSqm)} م²` : "—" },
                { label: "الإشغال", value: p.unitsCount ? `${fmtNumber(p.occupiedUnits ?? 0)} من ${fmtNumber(p.unitsCount)} وحدة` : "—" },
                { label: "الحالة الفنية", value: p.technicalCondition ? CONDITION_LABEL[p.technicalCondition] : "—" },
                { label: "تكلفة الصيانة السنوية", value: fmtSAR(p.annualMaintenanceCost) },
                { label: "احتياطي الصيانة", value: fmtSAR(p.maintenanceReserve) },
                { label: "الإيجار التقديري", value: fmtSAR(p.estimatedRent) },
                { label: "رقم صك العقار", value: p.deedNo ?? "—" },
              ]}
            />
          ) : <Muted>لم تُسجّل بيانات العقار.</Muted>}
          {open ? (
            <div className="mt-3">
              <Disclosure summary={p ? "عدّل بيانات العقار" : "سجّل بيانات العقار"}>
                <ActionForm
                  action={saveProperty}
                  hidden={h}
                  submitLabel="احفظ"
                  fields={[
                    { name: "city", label: "المدينة", defaultValue: p?.city },
                    { name: "district", label: "الحي", defaultValue: p?.district },
                    { name: "deedNo", label: "رقم صك العقار", defaultValue: p?.deedNo, ltr: true },
                    { name: "usage", label: "الاستخدام", type: "select", options: options(USAGE_LABEL), defaultValue: p?.usage },
                    { name: "areaSqm", label: "المساحة (م²)", type: "number", defaultValue: p?.areaSqm },
                    { name: "unitsCount", label: "عدد الوحدات", type: "number", defaultValue: p?.unitsCount },
                    { name: "occupiedUnits", label: "الوحدات المؤجرة", type: "number", defaultValue: p?.occupiedUnits },
                    { name: "technicalCondition", label: "الحالة الفنية", type: "select", options: options(CONDITION_LABEL), defaultValue: p?.technicalCondition },
                    { name: "annualMaintenanceCost", label: "تكلفة الصيانة السنوية", type: "number", defaultValue: p?.annualMaintenanceCost },
                    { name: "maintenanceReserve", label: "احتياطي الصيانة", type: "number", defaultValue: p?.maintenanceReserve },
                    { name: "estimatedRent", label: "الإيجار التقديري السنوي", type: "number", defaultValue: p?.estimatedRent },
                  ]}
                />
              </Disclosure>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {isFin ? (
        <Panel title="بيانات الاستثمار">
          {inv ? (
            <DefinitionList
              cols={3}
              items={[
                { label: "الأداة", value: INSTRUMENT_LABEL[inv.instrumentType] ?? inv.instrumentType },
                { label: "المصدر", value: inv.issuerName ?? "—" },
                { label: "الكمية", value: inv.quantity ? fmtNumber(inv.quantity) : "—" },
                { label: "التكلفة", value: fmtSAR(inv.costBasis) },
                { label: "المدير", value: inv.managerName ? `${inv.managerName}${inv.managerCmaLicense ? ` (${inv.managerCmaLicense})` : ""}` : "—" },
                { label: "الرسوم", value: inv.feePct ? fmtPct(inv.feePct) : "—" },
                { label: "أسهم المنحة", value: inv.bonusSharesTreatment === "corpus" ? "تُلحق بالأصل" : inv.bonusSharesTreatment === "yield" ? "تُعامل غلة" : "—" },
                { label: "المؤشر المرجعي", value: inv.benchmark ?? "—" },
              ]}
            />
          ) : <Muted>لم تُسجّل بيانات الاستثمار.</Muted>}
          {open ? (
            <div className="mt-3">
              <Disclosure summary={inv ? "عدّل" : "سجّل بيانات الاستثمار"}>
                <ActionForm
                  action={saveInvestment}
                  hidden={h}
                  submitLabel="احفظ"
                  fields={[
                    { name: "instrumentType", label: "الأداة", type: "select", options: options(INSTRUMENT_LABEL), required: true, defaultValue: inv?.instrumentType },
                    { name: "issuerName", label: "المصدر", defaultValue: inv?.issuerName },
                    { name: "quantity", label: "الكمية", type: "number", defaultValue: inv?.quantity },
                    { name: "costBasis", label: "التكلفة", type: "number", defaultValue: inv?.costBasis },
                    { name: "managerName", label: "مدير الاستثمار", defaultValue: inv?.managerName },
                    { name: "managerCmaLicense", label: "ترخيص هيئة السوق المالية", defaultValue: inv?.managerCmaLicense, ltr: true },
                    { name: "custodyAccount", label: "حساب الحفظ", defaultValue: inv?.custodyAccount, ltr: true },
                    { name: "feePct", label: "الرسوم (%)", type: "number", defaultValue: inv?.feePct },
                    { name: "bonusSharesTreatment", label: "معاملة أسهم المنحة", type: "select", options: [{ value: "corpus", label: "تُلحق بالأصل الموقوف" }, { value: "yield", label: "تُعامل غلة" }], defaultValue: inv?.bonusSharesTreatment },
                    { name: "benchmark", label: "المؤشر المرجعي", defaultValue: inv?.benchmark },
                  ]}
                />
              </Disclosure>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {isRE || a.category === "usufruct" ? (
        <Panel title="عقود الإيجار">
          <DataTable
            rows={d.leases}
            rowKey={(l) => l.id}
            empty={<Muted>لا عقود مسجلة.</Muted>}
            columns={[
              { key: "t", label: "المستأجر", render: (l) => <span className="font-medium">{l.tenantName}</span> },
              { key: "e", label: "إيجار", render: (l) => (l.ejarContractNo ? <span dir="ltr" className="tabular">{l.ejarContractNo}</span> : "—"), hideOnMobile: true },
              { key: "p", label: "المدة", render: (l) => `${fmtDate(l.startsOn)} — ${fmtDate(l.endsOn)}` },
              { key: "r", label: "الأجرة السنوية", render: (l) => fmtSAR(l.annualRent) },
              { key: "ar", label: "المتأخرات", render: (l) => (Number(l.arrears ?? 0) > 0 ? <span className="font-medium text-critical">{fmtSAR(l.arrears)}</span> : "—") },
              {
                key: "s", label: "الحالة", render: (l) => {
                  if (l.status !== "active") return <Badge tone="neutral" icon={false}>منتهٍ</Badge>;
                  const al = leaseAlert(l.endsOn, today);
                  return al === "expired" ? <Badge tone="critical">انتهى {relDays(l.endsOn)}</Badge> : al === "soon" ? <Badge tone="warn">ينتهي {relDays(l.endsOn)}</Badge> : <Badge tone="ok" icon={false}>ساري</Badge>;
                },
              },
              ...(open ? [{
                key: "u", label: "", render: (l: (typeof d.leases)[number]) => (
                  <Disclosure summary="حدّث">
                    <ActionForm action={updateLease} hidden={{ ...h, leaseId: l.id }} submitLabel="احفظ" fields={[
                      { name: "collectedToDate", label: "المحصّل حتى الآن", type: "number", defaultValue: l.collectedToDate },
                      { name: "arrears", label: "المتأخرات", type: "number", defaultValue: l.arrears },
                      { name: "status", label: "الحالة", type: "select", options: [{ value: "active", label: "ساري" }, { value: "ended", label: "انتهى" }, { value: "terminated", label: "فُسخ" }], defaultValue: l.status },
                    ]} />
                  </Disclosure>
                ),
              }] : []),
            ]}
          />
          {open ? (
            <div className="mt-3">
              <Disclosure summary="أضف عقدًا">
                <ActionForm action={addLease} hidden={h} submitLabel="أضف العقد" fields={[
                  { name: "tenantName", label: "المستأجر", required: true },
                  { name: "ejarContractNo", label: "رقم العقد في منصة إيجار", ltr: true },
                  { name: "startsOn", label: "البداية", type: "date", required: true },
                  { name: "endsOn", label: "النهاية", type: "date", required: true },
                  { name: "annualRent", label: "الأجرة السنوية (ريال)", type: "number", required: true },
                  { name: "collectedToDate", label: "المحصّل حتى الآن", type: "number" },
                  { name: "arrears", label: "المتأخرات", type: "number" },
                ]} />
              </Disclosure>
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="التقييمات">
        <DataTable
          rows={d.valuations}
          rowKey={(v) => v.id}
          empty={<Muted>لا تقييمات. يُستحسن تقييم الأصول دوريًا من مقيّم معتمد.</Muted>}
          columns={[
            { key: "d", label: "التاريخ", render: (v) => fmtDate(v.valuedOn) },
            { key: "v", label: "القيمة", render: (v) => fmtSAR(v.value) },
            { key: "by", label: "المقيّم", render: (v) => `${v.valuer}${v.valuerLicense ? ` (${v.valuerLicense})` : ""}` },
            { key: "m", label: "الأسلوب", render: (v) => v.method ?? "—", hideOnMobile: true },
          ]}
        />
        {open ? (
          <div className="mt-3">
            <Disclosure summary="أضف تقييمًا">
              <ActionForm action={addValuation} hidden={h} submitLabel="سجّل التقييم" fields={[
                { name: "value", label: "القيمة (ريال)", type: "number", required: true },
                { name: "valuedOn", label: "تاريخ التقييم", type: "date", required: true, defaultValue: today },
                { name: "valuer", label: "المقيّم", required: true },
                { name: "valuerLicense", label: "رقم ترخيص «تقييم»", ltr: true },
                { name: "method", label: "أسلوب التقييم", placeholder: "الدخل، المقارنة، التكلفة" },
              ]} />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="خطة الصيانة">
        <DataTable
          rows={d.maintenance}
          rowKey={(m) => m.id}
          empty={<Muted>لا بنود صيانة.</Muted>}
          columns={[
            { key: "i", label: "البند", render: (m) => m.item },
            { key: "f", label: "التكرار", render: (m) => (m.frequency ? FREQUENCY_LABEL[m.frequency] : "—") },
            { key: "n", label: "الموعد", render: (m) => (m.status === "done" ? "نُفّذ" : m.nextDueOn ? <span className={m.nextDueOn < today ? "font-medium text-critical" : ""}>{fmtBoth(m.nextDueOn)}</span> : "—") },
            { key: "c", label: "التكلفة", render: (m) => fmtSAR(m.estimatedCost), hideOnMobile: true },
            ...(open ? [{ key: "x", label: "", render: (m: (typeof d.maintenance)[number]) => (m.status === "done" ? null : <ActionButton action={completeMaintenance} hidden={{ ...h, planId: m.id }} label="نُفّذ" variant="ghost" />) }] : []),
          ]}
        />
        {open ? (
          <div className="mt-3">
            <Disclosure summary="أضف بندًا">
              <ActionForm action={addMaintenance} hidden={h} submitLabel="أضف" fields={[
                { name: "item", label: "البند", required: true },
                { name: "frequency", label: "التكرار", type: "select", options: options(FREQUENCY_LABEL) },
                { name: "nextDueOn", label: "الموعد القادم", type: "date" },
                { name: "estimatedCost", label: "التكلفة التقديرية", type: "number" },
              ]} />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="القيود على الأصل" description="رهن أو حجز أو نزاع أو تعدٍّ. رهن أصل الوقف يحتاج إذن الجهة المختصة، ويلزم إشعار الهيئة به.">
        <DataTable
          rows={d.encumbrances}
          rowKey={(e) => e.id}
          empty={<Muted>لا قيود مسجلة.</Muted>}
          columns={[
            { key: "k", label: "النوع", render: (e) => <Badge tone={e.resolvedOn ? "neutral" : "fine"} icon={false}>{ENCUMBRANCE_LABEL[e.kind] ?? e.kind}</Badge> },
            { key: "s", label: "منذ", render: (e) => fmtDate(e.since) },
            { key: "d", label: "التفاصيل", render: (e) => e.details ?? "—" },
            { key: "r", label: "الفك", render: (e) => (e.resolvedOn ? fmtDate(e.resolvedOn) : "قائم") },
            ...(open ? [{ key: "x", label: "", render: (e: (typeof d.encumbrances)[number]) => (e.resolvedOn ? null : (
              <Disclosure summary="سجّل الفك">
                <ActionForm action={resolveEncumbrance} hidden={{ ...h, encumbranceId: e.id }} submitLabel="سجّل" cols={1} fields={[{ name: "resolvedOn", label: "تاريخ الفك", type: "date", required: true, defaultValue: today }]} />
              </Disclosure>
            )) }] : []),
          ]}
        />
        {open ? (
          <div className="mt-3">
            <Disclosure summary="سجّل قيدًا">
              <ActionForm action={addEncumbrance} hidden={h} submitLabel="سجّل القيد" fields={[
                { name: "kind", label: "النوع", type: "select", options: options(ENCUMBRANCE_LABEL), required: true },
                { name: "since", label: "منذ", type: "date", required: true, defaultValue: today },
                { name: "approvalRef", label: "رقم إذن الجهة المختصة (للرهن)", ltr: true },
                { name: "details", label: "التفاصيل", type: "textarea", wide: true },
              ]} />
            </Disclosure>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
