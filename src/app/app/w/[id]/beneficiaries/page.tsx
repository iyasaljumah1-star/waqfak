import type { Metadata } from "next";
import { HeartHandshake, ShieldCheck, Wallet } from "lucide-react";
import { Alert, Badge, DataTable, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { ActionButton, ActionForm, Disclosure, RawActionForm } from "@/components/waqf/action-form";
import { Masked, Muted, SubHead } from "@/components/waqf/bits";
import { fmtBoth, fmtDate, fmtNumber, fmtSAR } from "@/lib/utils";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import {
  addEntitlement, approveDistribution, archiveBeneficialOwner, createDistribution, deleteClass, markDistributionPaid, recomputeClassShares,
  saveBeneficialOwner, saveBeneficiary, saveClass, verifyBeneficialOwner,
} from "@/server/modules/beneficiaries/actions";
import { tierShareIssues } from "@/server/modules/beneficiaries/pure";
import { beneficiariesData, boRegister } from "@/server/modules/beneficiaries/queries";
import { waqfAccess } from "@/server/modules/waqf-core/queries";
import { todayIso } from "@/server/modules/waqf-file/form";
import {
  BEN_STATUS_LABEL, BEN_STATUS_TONE, BO_ROLE_LABEL, CLASS_KIND_LABEL, DIST_STATUS_LABEL, DIST_STATUS_TONE, DIVISION_LABEL, ID_TYPE_LABEL, options,
  RELATION_LABEL, RELATION_SHORT, RISK_LABEL, SUBSTITUTION_LABEL, VERIFY_SOURCE_LABEL,
} from "@/server/modules/waqf-file/labels";

export const metadata: Metadata = { title: "المستفيدون" };

type Cls = Awaited<ReturnType<typeof beneficiariesData>>["classes"][number];
type Ben = Awaited<ReturnType<typeof beneficiariesData>>["people"][number];
type Bo = Awaited<ReturnType<typeof boRegister>>[number];

export default async function BeneficiariesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/beneficiaries` });
  // Beneficiary-only members never reach the full register: requireWaqf sends them to /app/b/[id].
  const access = await waqfAccess(auth, id, "beneficiaries.view");
  const can = (p: Parameters<typeof waqfCan>[1]) => waqfCan(access, p);
  const canEdit = can("beneficiaries.edit");
  const canBo = can("bo.view");
  const [d, bos] = await read(auth, async (tx) => [await beneficiariesData(tx, id), canBo ? await boRegister(tx, id) : []] as const);
  const today = todayIso();
  const active = d.people.filter((p) => p.status === "active" && !p.archivedAt);
  const clsName = new Map(d.classes.map((c) => [c.id, c.name]));
  const benName = new Map(d.people.map((p) => [p.id, p.displayName]));
  const issues = tierShareIssues(d.classes);
  const tiers = [...new Set(d.classes.map((c) => c.tier))].sort((a, b) => a - b);
  const shareSum = active.reduce((s, p) => s + Number(p.entitlementShare ?? 0), 0);
  const classOpts = d.classes.map((c) => ({ value: c.id, label: `ط${c.tier} — ${c.name}` }));
  const benOpts = active.map((p) => ({ value: p.id, label: p.displayName }));
  const YES = (v: boolean | undefined) => !!v;

  const classFields = (c?: Cls) => [
    { name: "name", label: "المصرف أو وصف المستحقين", required: true, defaultValue: c?.name, wide: true, placeholder: "مثال: أولاد الواقف ثم أولادهم" },
    { name: "kind", label: "النوع", type: "select" as const, options: options(CLASS_KIND_LABEL), required: true, defaultValue: c?.kind ?? "private" },
    { name: "specifiedBy", label: "التعيين", type: "select" as const, options: [{ value: "description", label: "بالوصف" }, { value: "name", label: "بالاسم" }], defaultValue: c?.specifiedBy ?? "description" },
    { name: "tier", label: "الطبقة", type: "number" as const, required: true, defaultValue: c?.tier ?? (tiers.at(-1) ?? 0) + 1 },
    { name: "relation", label: "علاقتها بما قبلها", type: "select" as const, options: options(RELATION_LABEL), required: true, defaultValue: c?.relation ?? "then" },
    { name: "sharePct", label: "نسبتها من الغلة (%)", type: "number" as const, defaultValue: c?.sharePct, hint: "عند التشريك بنسب محددة" },
    { name: "divisionRule", label: "القسمة بين أفرادها", type: "select" as const, options: options(DIVISION_LABEL), defaultValue: c?.divisionRule },
    { name: "substitutionRule", label: "الاستحقاق بالتنزيل", type: "select" as const, options: options(SUBSTITUTION_LABEL), defaultValue: c?.substitutionRule },
    { name: "alternateMasraf", label: "المصرف البديل إذا انقطعت", defaultValue: c?.alternateMasraf },
    { name: "need", label: "مشروط بالحاجة أو الفقر", type: "checkbox" as const, defaultValue: YES(c?.criteria?.need) },
    { name: "student", label: "مشروط بطلب العلم", type: "checkbox" as const, defaultValue: YES(c?.criteria?.student) },
    { name: "includesDaughtersChildren", label: "يشمل أولاد البنات", type: "checkbox" as const, defaultValue: YES(c?.criteria?.includesDaughtersChildren) },
    { name: "isFinalDestination", label: "هذا هو المآل النهائي (جهة بر لا تنقطع)", type: "checkbox" as const, defaultValue: c?.isFinalDestination ?? false },
    { name: "criteriaOther", label: "أوصاف أخرى من شرط الواقف", type: "textarea" as const, defaultValue: c?.criteria?.other, wide: true },
  ];
  const benFields = (b?: Ben) => [
    { name: "displayName", label: "الاسم", required: true, defaultValue: b?.displayName },
    { name: "classId", label: "المصرف", type: "select" as const, options: classOpts, defaultValue: b?.classId },
    { name: "sharePct", label: "الحصة من الغلة (%)", type: "number" as const, defaultValue: b?.entitlementShare ? (Number(b.entitlementShare) * 100).toFixed(4).replace(/\.?0+$/, "") : "" },
    { name: "generation", label: "الجيل/الطبقة", type: "number" as const, defaultValue: b?.generation },
    { name: "status", label: "الحالة", type: "select" as const, options: options(BEN_STATUS_LABEL), defaultValue: b?.status ?? "active" },
    { name: "lastVerifiedOn", label: "آخر تحقق من الاستحقاق", type: "date" as const, defaultValue: b?.lastVerifiedOn },
    { name: "residesAbroad", label: "يقيم خارج المملكة", type: "checkbox" as const, defaultValue: b?.residesAbroad ?? false },
  ];
  const boFields = (b?: Bo) => [
    { name: "role", label: "الصفة (م4)", type: "select" as const, options: options(BO_ROLE_LABEL), required: true, defaultValue: b?.role },
    { name: "subjectType", label: "شخص طبيعي أم اعتباري", type: "select" as const, options: [{ value: "person", label: "شخص طبيعي" }, { value: "organization", label: "شخص اعتباري" }], defaultValue: b?.subjectType ?? "person" },
    { name: "fullName", label: "الاسم كاملًا", required: true, defaultValue: b?.fullName },
    { name: "nationality", label: "الجنسية", defaultValue: b?.nationality },
    { name: "birthDate", label: "تاريخ الميلاد", type: "date" as const, defaultValue: b?.birthDate },
    { name: "birthPlace", label: "مكان الميلاد", defaultValue: b?.birthPlace },
    { name: "idType", label: "نوع مستند الهوية", type: "select" as const, options: options(ID_TYPE_LABEL), defaultValue: b?.idType },
    { name: "idNumber", label: "رقم مستند الهوية", ltr: true, hint: b ? `المحفوظ: ${b.idNumberMasked ?? "لا شيء"} — اتركه فارغًا لإبقائه` : "يُحفظ مشفّرًا ويُعرض مخفيًا", autoComplete: "off" },
    { name: "address", label: "عنوان الإقامة", hint: b?.hasAddress ? "محفوظ مشفّرًا — اتركه فارغًا لإبقائه" : "يُحفظ مشفّرًا" },
    { name: "contact", label: "معلومات الاتصال", defaultValue: b?.contact, ltr: true },
    { name: "acquiredOn", label: "تاريخ اكتساب الصفة", type: "date" as const, defaultValue: b?.acquiredOn },
    { name: "bankDetails", label: "البيانات المصرفية التي يتلقى عليها الريع", ltr: true, hint: b?.hasBank ? `المحفوظ: ${b.bankMasked} — اتركه فارغًا لإبقائه` : "يُحفظ مشفّرًا" },
    { name: "relationToWaqf", label: "طبيعة علاقته بالوقف", defaultValue: b?.relationToWaqf },
    { name: "entitlementDesc", label: "مقدار ما يستحقه من الوقف", defaultValue: b?.entitlementDesc },
    { name: "legalForm", label: "الشكل النظامي (للاعتباري)", defaultValue: b?.legalForm },
    { name: "nationalAddress", label: "العنوان الوطني (للاعتباري)", defaultValue: b?.nationalAddress },
    { name: "directorsText", label: "المديرون (للاعتباري): سطر لكل مدير — الاسم | تاريخ الميلاد | مكانه | الجنسية", type: "textarea" as const, wide: true, defaultValue: (b?.directors ?? []).map((x) => [x.name, x.birthDate, x.birthPlace, x.nationality].map((v) => v ?? "").join(" | ")).join("\n") },
    { name: "powers", label: "الصلاحيات المقررة (للاعتباري)", type: "textarea" as const, wide: true, defaultValue: b?.powers },
    { name: "riskLevel", label: "مستوى المخاطر", type: "select" as const, options: options(RISK_LABEL), defaultValue: b?.riskLevel ?? "standard" },
    { name: "verificationSource", label: "مصدر البيانات", type: "select" as const, options: options(VERIFY_SOURCE_LABEL), defaultValue: b?.verificationSource },
    { name: "residesInKsa", label: "مقيم في المملكة", type: "checkbox" as const, defaultValue: b?.residesInKsa ?? true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="المستفيدون" description="مصارف الوقف وطبقاتها وفق شرط الواقف، وسجل المستحقين واستحقاقاتهم، وكشوف الصرف واعتمادها، وسجل المستفيد الحقيقي." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="المصارف" value={fmtNumber(d.classes.length)} sub={`${fmtNumber(tiers.length)} طبقة`} />
        <Stat label="المستحقون النشطون" value={fmtNumber(active.length)} sub={active.some((p) => p.residesAbroad) ? "منهم مقيمون خارج المملكة" : undefined} />
        <Stat label="مجموع الحصص المحددة" value={`${fmtNumber(Math.round(shareSum * 10000) / 100)}%`} tone={shareSum > 1.0001 ? "critical" : undefined} />
        <Stat label="كشوف بانتظار الاعتماد" value={fmtNumber(d.distributions.filter((x) => x.d.status === "planned").length)} />
      </div>

      <Panel title="المصارف والطبقات" description="«ثم» ترتيب: لا تستحق الطبقة حتى تنقرض التي قبلها. «و» تشريك: تستحق معها.">
        {issues.length ? <Alert tone="warn" className="mb-3">{issues.join(" ")}</Alert> : null}
        {d.classes.length ? (
          <ol className="space-y-4">
            {tiers.map((t) => (
              <li key={t}>
                <p className="mb-2 text-[13px] font-semibold text-seal">الطبقة {fmtNumber(t)}</p>
                <ul className="space-y-2">
                  {d.classes.filter((c) => c.tier === t).map((c) => {
                    const members = active.filter((p) => p.classId === c.id);
                    return (
                      <li key={c.id} className="rounded-md border border-line p-3" data-testid="beneficiary-class">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{c.name}</span>
                          <Badge tone="neutral" icon={false}>{CLASS_KIND_LABEL[c.kind] ?? c.kind}</Badge>
                          <Badge tone="ink" icon={false}>{RELATION_SHORT[c.relation] ?? c.relation}</Badge>
                          {c.sharePct ? <Badge tone="seal" icon={false}>{fmtNumber(c.sharePct)}%</Badge> : null}
                          {c.isFinalDestination ? <Badge tone="ok">المآل النهائي</Badge> : null}
                        </div>
                        <Muted>
                          {[c.divisionRule && `القسمة ${DIVISION_LABEL[c.divisionRule]}`, c.substitutionRule && SUBSTITUTION_LABEL[c.substitutionRule], c.criteria?.need && "مشروط بالحاجة", c.criteria?.student && "طلاب العلم", c.criteria?.includesDaughtersChildren && "يشمل أولاد البنات", c.alternateMasraf && `البديل: ${c.alternateMasraf}`, `${fmtNumber(members.length)} مستحق`].filter(Boolean).join(" · ")}
                        </Muted>
                        {canEdit ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Disclosure summary="عدّل">
                              <ActionForm action={saveClass} hidden={{ waqfId: id, classId: c.id }} submitLabel="احفظ" fields={classFields(c)} />
                            </Disclosure>
                            {members.length ? (
                              <Disclosure summary="احسب الحصص وفق قاعدة القسمة">
                                <RawActionForm action={recomputeClassShares} hidden={{ waqfId: id, classId: c.id }} submitLabel="احسب واحفظ الحصص">
                                  <Muted>القاعدة: {DIVISION_LABEL[c.divisionRule ?? "equal"]}{c.sharePct ? `، ونسبة المصرف ${c.sharePct}% من الغلة` : ""}. الجنس يُستخدم للحساب فقط ولا يُحفظ.</Muted>
                                  {c.divisionRule === "male_double" ? (
                                    <ul className="grid gap-2 sm:grid-cols-2">
                                      {members.map((m) => (
                                        <li key={m.id} className="flex items-center justify-between gap-2 rounded bg-surface-2 px-3 py-1.5">
                                          <input type="hidden" name="g.id" value={m.id} />
                                          <span className="text-[14px]">{m.displayName}</span>
                                          <select name="g.gender" aria-label={`جنس ${m.displayName}`} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-[14px]" defaultValue="">
                                            <option value="">—</option>
                                            <option value="m">ذكر</option>
                                            <option value="f">أنثى</option>
                                          </select>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </RawActionForm>
                              </Disclosure>
                            ) : (
                              <ActionButton action={deleteClass} hidden={{ waqfId: id, classId: c.id }} label="احذف المصرف" variant="ghost" confirm="حذف هذا المصرف؟" />
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState icon={HeartHandshake} title="لم تُسجّل المصارف">أضف مصارف الوقف بالترتيب الذي اشترطه الواقف، مع المآل النهائي إذا انقطع المستحقون.</EmptyState>
        )}
        {d.classes.length && !d.classes.some((c) => c.isFinalDestination || c.kind === "public") ? (
          <Alert tone="warn" className="mt-3" title="لا مآل نهائي محدد">الدليل الإرشادي لصياغة الوثيقة يوصي بتحديد بدائل المصارف إذا انقطع المستحقون. سجّل المآل كما في الشرط، أو اطلب رأيًا مختصًا إن سكت عنه.</Alert>
        ) : null}
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary="أضف مصرفًا" testId="add-class">
              <ActionForm action={saveClass} hidden={{ waqfId: id }} submitLabel="أضف المصرف" fields={classFields()} testId="add-class-form" />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="سجل المستحقين" tight>
        <div className="p-4 md:p-5">
          <DataTable
            rows={d.people}
            rowKey={(p) => p.id}
            empty={<EmptyState icon={HeartHandshake} title="لا مستحقين مسجلين" />}
            columns={[
              { key: "name", label: "المستفيد", render: (p) => <span className="font-medium">{p.displayName}</span> },
              { key: "class", label: "المصرف", render: (p) => (p.classId ? clsName.get(p.classId) : "—") },
              { key: "share", label: "الحصة", render: (p) => (p.entitlementShare ? `${fmtNumber(Number(p.entitlementShare) * 100)}%` : "—") },
              { key: "status", label: "الحالة", render: (p) => <Badge tone={BEN_STATUS_TONE[p.status]} icon={false}>{BEN_STATUS_LABEL[p.status] ?? p.status}</Badge> },
              { key: "abroad", label: "الإقامة", render: (p) => (p.residesAbroad ? <Badge tone="warn" icon={false}>خارج المملكة</Badge> : "داخل المملكة"), hideOnMobile: true },
              { key: "ver", label: "آخر تحقق", render: (p) => fmtDate(p.lastVerifiedOn), hideOnMobile: true },
              ...(canEdit ? [{ key: "e", label: "", render: (p: Ben) => <Disclosure summary="عدّل"><ActionForm action={saveBeneficiary} hidden={{ waqfId: id, beneficiaryId: p.id }} submitLabel="احفظ" fields={benFields(p)} /></Disclosure> }] : []),
            ]}
          />
          {canEdit ? (
            <div className="mt-4">
              <Disclosure summary="أضف مستحقًا">
                <ActionForm action={saveBeneficiary} hidden={{ waqfId: id }} submitLabel="أضف" fields={benFields()} />
              </Disclosure>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="الاستحقاقات حسب الفترة">
        <DataTable
          rows={d.entitlements}
          rowKey={(e) => e.id}
          empty={<Muted>لا استحقاقات مسجلة. تُنشأ تلقائيًا عند اعتماد كشف صرف، أو تُضاف يدويًا.</Muted>}
          columns={[
            { key: "p", label: "الفترة", render: (e) => <span className="tabular">{e.period}</span> },
            { key: "b", label: "المستفيد", render: (e) => benName.get(e.beneficiaryId) ?? "—" },
            { key: "a", label: "المبلغ", render: (e) => fmtSAR(e.amount) },
            { key: "on", label: "موعد الصرف المتوقع", render: (e) => fmtDate(e.expectedPayOn) },
            { key: "basis", label: "الأساس", render: (e) => <span className="text-[14px] text-muted">{e.basis ?? "—"}</span>, hideOnMobile: true },
          ]}
        />
        {canEdit && benOpts.length ? (
          <div className="mt-3">
            <Disclosure summary="أضف استحقاقًا">
              <ActionForm
                action={addEntitlement}
                hidden={{ waqfId: id }}
                submitLabel="أضف"
                fields={[
                  { name: "beneficiaryId", label: "المستفيد", type: "select", options: benOpts, required: true },
                  { name: "period", label: "الفترة", required: true, defaultValue: today.slice(0, 4), ltr: true },
                  { name: "amount", label: "المبلغ (ريال)", type: "number", required: true },
                  { name: "expectedPayOn", label: "موعد الصرف المتوقع", type: "date" },
                  { name: "basis", label: "الأساس", wide: true },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="كشوف الصرف" description="يُعدّ الكشف عضو ويعتمده عضو آخر يملك صلاحية اعتماد الصرف، ثم يُسجّل الصرف بأرقام مرجعية لكل مستفيد (معايير المستفيد الحقيقي م5/4).">
        {d.distributions.length ? (
          <ul className="space-y-3">
            {d.distributions.map(({ d: x, maker }) => {
              const ls = d.lines.filter((l) => l.distributionId === x.id);
              const mine = x.createdBy === auth.user.id;
              return (
                <li key={x.id} className="rounded-md border border-line p-3" data-testid="distribution">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">الفترة {x.period} · {fmtSAR(x.totalAmount)}</p>
                      <Muted>أعدّه {maker ?? "—"} · {fmtNumber(ls.length)} مستفيد{x.dueBy ? ` · الموعد ${fmtBoth(x.dueBy)}` : ""}{x.paidOn ? ` · صُرف ${fmtDate(x.paidOn)}` : ""}</Muted>
                    </div>
                    <Badge tone={DIST_STATUS_TONE[x.status]}>{DIST_STATUS_LABEL[x.status] ?? x.status}</Badge>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[14px] text-ink">بنود الكشف</summary>
                    <ul className="mt-2 divide-y divide-line text-[14px]">
                      {ls.map((l) => (
                        <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                          <span>{benName.get(l.beneficiaryId) ?? "—"}</span>
                          <span dir="ltr" className="tabular text-muted">{l.referenceNo}</span>
                          <span className="tabular">{fmtSAR(l.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    {x.status === "planned" && can("distributions.approve") ? (
                      mine ? <Muted>أعددت هذا الكشف، فلا تعتمده أنت. يعتمده عضو آخر.</Muted> : <ActionButton action={approveDistribution} hidden={{ waqfId: id, distributionId: x.id }} label="اعتمد الكشف" variant="primary" />
                    ) : null}
                    {x.status === "approved" && can("finance.edit") ? (
                      <ActionForm action={markDistributionPaid} hidden={{ waqfId: id, distributionId: x.id }} submitLabel="سجّل الصرف" fields={[{ name: "paidOn", label: "تاريخ الصرف", type: "date", required: true, defaultValue: today }]} cols={1} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={Wallet} title="لا كشوف صرف">يلزم صرف عوائد السنة المالية للمستحقين خلال ثلاثة أشهر من نهايتها ما لم يحدد الشرط موعدًا آخر.</EmptyState>
        )}
        {can("finance.edit") ? (
          <div className="mt-4">
            <Disclosure summary="أعدّ كشف صرف">
              <ActionForm
                action={createDistribution}
                hidden={{ waqfId: id }}
                submitLabel="أعدّ الكشف"
                fields={[
                  { name: "period", label: "الفترة", required: true, defaultValue: today.slice(0, 4), ltr: true },
                  { name: "totalAmount", label: "المبلغ الإجمالي (ريال)", type: "number", required: true },
                  { name: "basis", label: "أساس التوزيع", type: "select", options: [{ value: "shares", label: "حسب الحصص المسجلة" }, { value: "equal", label: "بالتساوي" }], defaultValue: "shares" },
                  { name: "classId", label: "مصرف محدد (اختياري)", type: "select", options: classOpts },
                  { name: "bankAccountId", label: "الحساب البنكي للصرف", type: "select", options: d.accounts.filter((a) => a.inWaqfName).map((a) => ({ value: a.id, label: `${a.bankName} •••• ${a.last4}` })) },
                  { name: "dueBy", label: "موعد الصرف", type: "date" },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      {canBo ? (
        <Panel
          title="سجل المستفيد الحقيقي"
          description="البيانات الدنيا وفق معايير المستفيد الحقيقي (م5). أرقام الهويات والعناوين والبيانات المصرفية مشفّرة وتظهر مخفية. تحقق سنويًا من الصك وشهادة التسجيل، وحدّث السجل خلال 15 يومًا من أي تغيير."
          tight
        >
          <div className="space-y-3 p-4 md:p-5">
            {bos.length ? (
              <ul className="space-y-3" data-testid="bo-register">
                {bos.map((b) => {
                  const due = b.nextVerificationDue && b.nextVerificationDue < today;
                  return (
                    <li key={b.id} className="rounded-md border border-line p-3" data-testid="bo-row">
                      <div className="flex flex-wrap items-center gap-2">
                        <ShieldCheck aria-hidden className="size-4 text-muted" />
                        <span className="font-semibold">{b.fullName}</span>
                        <Badge tone="ink" icon={false}>{BO_ROLE_LABEL[b.role] ?? b.role}</Badge>
                        {b.riskLevel === "high" ? <Badge tone="critical">مخاطر مرتفعة</Badge> : null}
                        {!b.verifiedOn ? <Badge tone="warn">لم يُتحقق منه</Badge> : due ? <Badge tone="critical">فات موعد التحقق السنوي</Badge> : <Badge tone="ok">تحقق {fmtDate(b.verifiedOn)}</Badge>}
                      </div>
                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[14px] sm:grid-cols-2 lg:grid-cols-3">
                        <div><dt className="inline text-muted">الهوية: </dt><dd className="inline">{b.idType ? `${ID_TYPE_LABEL[b.idType] ?? b.idType} ` : ""}<Masked value={b.idNumberMasked} label="رقم الهوية" /></dd></div>
                        <div><dt className="inline text-muted">الجنسية: </dt><dd className="inline">{b.nationality ?? "—"}</dd></div>
                        <div><dt className="inline text-muted">الميلاد: </dt><dd className="inline">{b.birthDate ? fmtDate(b.birthDate) : "—"}{b.birthPlace ? ` — ${b.birthPlace}` : ""}</dd></div>
                        <div><dt className="inline text-muted">العنوان: </dt><dd className="inline"><Masked value={b.addressMasked} label="العنوان" /></dd></div>
                        <div><dt className="inline text-muted">الحساب: </dt><dd className="inline"><Masked value={b.bankMasked} label="البيانات المصرفية" /></dd></div>
                        <div><dt className="inline text-muted">اكتسب الصفة: </dt><dd className="inline">{fmtDate(b.acquiredOn)}</dd></div>
                        {b.relationToWaqf ? <div className="sm:col-span-2"><dt className="inline text-muted">العلاقة: </dt><dd className="inline">{b.relationToWaqf}</dd></div> : null}
                        {b.subjectType === "organization" && b.directors?.length ? <div className="sm:col-span-3"><dt className="inline text-muted">المديرون: </dt><dd className="inline">{b.directors.map((x) => x.name).join("، ")}</dd></div> : null}
                      </dl>
                      {can("bo.edit") ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Disclosure summary="حدّث البيانات"><ActionForm action={saveBeneficialOwner} hidden={{ waqfId: id, boId: b.id }} submitLabel="احفظ" fields={boFields(b)} /></Disclosure>
                          <Disclosure summary="سجّل التحقق السنوي">
                            <ActionForm action={verifyBeneficialOwner} hidden={{ waqfId: id, boId: b.id }} submitLabel="سجّل التحقق" cols={1} fields={[{ name: "verificationSource", label: "تحققت بالرجوع إلى", type: "select", options: options(VERIFY_SOURCE_LABEL), required: true, defaultValue: "deed" }]} />
                          </Disclosure>
                          <Disclosure summary="زالت الصفة">
                            <ActionForm action={archiveBeneficialOwner} hidden={{ waqfId: id, boId: b.id }} submitLabel="أرشف السجل" cols={1} fields={[{ name: "reason", label: "السبب", required: true }]} />
                          </Disclosure>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={ShieldCheck} title="السجل فارغ">سجّل الواقف المسيطر والناظر وكل من يمارس سيطرة فعلية، والمستفيدين المحددين ضمن فئة.</EmptyState>
            )}
            {can("bo.edit") ? (
              <Disclosure summary="أضف مستفيدًا حقيقيًا" testId="add-bo">
                <ActionForm action={saveBeneficialOwner} hidden={{ waqfId: id }} submitLabel="أضف إلى السجل" fields={boFields()} testId="add-bo-form" />
              </Disclosure>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
