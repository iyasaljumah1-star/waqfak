import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Building2, Landmark } from "lucide-react";
import { Alert, Badge, DataTable, EmptyState, PageHeader, Panel, Stat } from "@/components/ui";
import { ActionButton, ActionForm, Disclosure, RawActionForm, RowsEditor } from "@/components/waqf/action-form";
import { Muted } from "@/components/waqf/bits";
import { AssetForm } from "@/components/waqf/asset-editor";
import { assetGaps, assetSummary } from "@/server/modules/assets/types";
import { fmtBoth, fmtDate, fmtNumber, fmtPct, fmtSAR, relDays, SIZE_LABEL } from "@/lib/utils";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { addPortfolio, applySizeSuggestion, approveInvestmentPolicy, saveAsset, saveInvestmentPolicy } from "@/server/modules/assets/actions";
import { assetValue, leaseAlert, suggestSizeClass } from "@/server/modules/assets/pure";
import { assetsOverview } from "@/server/modules/assets/queries";
import { waqfAccess } from "@/server/modules/waqf-core/queries";
import { todayIso } from "@/server/modules/waqf-file/form";
import { ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, ASSET_STATUS_TONE, ENCUMBRANCE_LABEL, options, RISK_LABEL } from "@/server/modules/waqf-file/labels";

export const metadata: Metadata = { title: "الأصول والاستثمار" };

const ALLOC_LABEL: Record<string, string> = { real_estate: "عقارات", equities: "أسهم", sukuk: "صكوك", funds: "صناديق استثمار", deposits: "ودائع ومرابحات", cash: "نقد", other: "أخرى" };

export default async function AssetsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ add?: string }> }) {
  const sp = await searchParams;
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/assets` });
  const access = await waqfAccess(auth, id, "assets.view");
  const w = access.waqf;
  const canEdit = waqfCan(access, "assets.edit");
  const d = await read(auth, (tx) => assetsOverview(tx, id));
  const today = todayIso();
  const live = d.assets.filter((a) => !a.archivedAt);
  const archived = d.assets.filter((a) => a.archivedAt);
  const total = live.reduce((s, a) => s + assetValue(a), 0);
  const income = live.reduce((s, a) => s + Number(a.annualIncome ?? 0), 0);
  const suggested = live.length ? suggestSizeClass(total, w.directBenefit) : null;
  const notInName = live.filter((a) => a.inWaqfName === false || a.inWaqfName === null);
  const leaseAlerts = d.leases.map((x) => ({ ...x, alert: leaseAlert(x.l.endsOn, today) })).filter((x) => x.alert === "expired" || x.alert === "soon");
  const approvedPolicy = d.policies.find((p) => p.status === "approved");
  const draftPolicy = d.policies.find((p) => p.status === "draft");

  return (
    <div className="space-y-6">
      <PageHeader title="الأصول والاستثمار" description="سجل أصول الوقف وقيمها وعقودها وصيانتها وما عليها من قيود، ومحافظه وسياسة استثماره. مجموع القيم يحدد فئة الوقف حسب الحجم." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="الأصول القائمة" value={fmtNumber(live.length)} />
        <Stat label="القيمة الإجمالية" value={fmtSAR(total)} sub="السوقية، وإلا الدفترية" />
        <Stat label="الدخل السنوي" value={fmtSAR(income)} sub={total ? `عائد ${fmtPct(Math.round((income / total) * 1000) / 10)}` : undefined} />
        <Stat label="الفئة حسب الحجم" value={w.sizeClass ? SIZE_LABEL[w.sizeClass] : "—"} sub={w.sizeClassLocked ? "مثبّتة من الإدارة" : suggested && suggested !== w.sizeClass ? `المقترح: ${SIZE_LABEL[suggested]}` : "مطابقة للأصول"} />
      </div>

      {suggested && suggested !== w.sizeClass && !w.sizeClassLocked ? (
        <Alert
          tone="info"
          title={`قيمة الأصول المسجلة تشير إلى فئة «${SIZE_LABEL[suggested]}»`}
          action={waqfCan(access, "waqf.edit") ? <ActionButton action={applySizeSuggestion} hidden={{ waqfId: id }} label="اعتمد الفئة المقترحة" variant="primary" /> : null}
        >
          الفئة الحالية «{w.sizeClass ? SIZE_LABEL[w.sizeClass] : "غير محددة"}». الفئة تحدد متطلبات القوائم المدققة والموازنة واللوائح؛ اعتمادها يعيد حساب الالتزامات.
        </Alert>
      ) : null}
      {notInName.length ? (
        <Alert tone="warn" title={`${fmtNumber(notInName.length)} أصل غير مؤكد تسجيله باسم الوقف`}>
          على الناظر تسجيل أصول الوقف باسمه لدى الهيئة. راجع: {notInName.slice(0, 3).map((a) => a.title).join("، ")}{notInName.length > 3 ? "…" : ""}
        </Alert>
      ) : null}
      {leaseAlerts.length ? (
        <Alert tone={leaseAlerts.some((x) => x.alert === "expired") ? "critical" : "warn"} title="عقود إيجار منتهية أو تقترب من الانتهاء">
          <ul className="space-y-0.5">
            {leaseAlerts.map((x) => (
              <li key={x.l.id}>
                <Link className="underline" href={`/app/w/${id}/assets/${x.l.assetId}`}>{x.title}</Link> — {x.l.tenantName}: {x.alert === "expired" ? "انتهى" : "ينتهي"} {fmtBoth(x.l.endsOn)} ({relDays(x.l.endsOn)})
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {d.encumbrances.length ? (
        <Alert tone="fine" title="قيود قائمة على أصول">
          {d.encumbrances.map((x) => `${ENCUMBRANCE_LABEL[x.e.kind] ?? x.e.kind}: ${x.title}`).join(" · ")}
        </Alert>
      ) : null}

      <Panel title="سجل الأصول" tight>
        <div className="p-4 md:p-5">
          <DataTable
            rows={live}
            rowKey={(a) => a.id}
            empty={<EmptyState icon={Building2} title="لا أصول مسجلة">سجّل كل أصل بوصف يميزه ومستند ملكيته وقيمته.</EmptyState>}
            columns={[
              { key: "t", label: "الأصل", render: (a) => {
                const sum = assetSummary(a.category, a.details as Record<string, string>);
                const miss = assetGaps({ ...a, details: a.details as Record<string, string> });
                return <div><Link href={`/app/w/${id}/assets/${a.id}`} className="font-medium text-ink hover:underline">{a.title}</Link>{sum ? <p className="text-[13px] text-muted">{sum}</p> : null}{miss.length ? <p className="text-[12px] text-fine">ينقص: {miss.join("، ")}</p> : null}</div>;
              } },
              { key: "c", label: "النوع", render: (a) => ASSET_CATEGORY_LABEL[a.category] ?? a.category },
              { key: "v", label: "القيمة", render: (a) => <span className="tabular">{fmtSAR(a.marketValue ?? a.bookValue)}</span> },
              { key: "i", label: "الدخل السنوي", render: (a) => fmtSAR(a.annualIncome), hideOnMobile: true },
              { key: "s", label: "الحالة", render: (a) => <Badge tone={ASSET_STATUS_TONE[a.status]} icon={false}>{ASSET_STATUS_LABEL[a.status]}</Badge> },
              { key: "val", label: "آخر تقييم", render: (a) => (a.lastValuationOn ? fmtDate(a.lastValuationOn) : <span className="text-muted">لم يُقيّم</span>), hideOnMobile: true },
              { key: "go", label: "", render: (a) => <Link href={`/app/w/${id}/assets/${a.id}`} aria-label={`تفاصيل ${a.title}`} className="inline-flex items-center gap-1 text-sm text-ink hover:underline">التفاصيل <ArrowLeft aria-hidden className="size-3.5" /></Link> },
            ]}
          />
          {archived.length ? (
            <details className="mt-3 text-[14px]">
              <summary className="cursor-pointer text-muted">أصول مؤرشفة ({fmtNumber(archived.length)})</summary>
              <ul className="mt-2 space-y-1">
                {archived.map((a) => <li key={a.id}><Link className="hover:underline" href={`/app/w/${id}/assets/${a.id}`}>{a.title}</Link> — <span className="text-muted">{a.archiveReason}</span></li>)}
              </ul>
            </details>
          ) : null}
          {canEdit ? (
            <div className="mt-4">
              <div id="add-asset" className="scroll-mt-24">
                <Disclosure summary="أضف أصلًا" testId="add-asset" defaultOpen={sp.add === "1"}>
                  <AssetForm action={saveAsset} waqfId={id} submitLabel="أضف الأصل" testId="add-asset-form" />
                </Disclosure>
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      {d.maintenance.length ? (
        <Panel title="صيانة قادمة">
          <ul className="divide-y divide-line text-[14px]">
            {d.maintenance.map((x) => (
              <li key={x.m.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><Link className="hover:underline" href={`/app/w/${id}/assets/${x.m.assetId}`}>{x.title}</Link> — {x.m.item}</span>
                <span className={x.m.nextDueOn && x.m.nextDueOn < today ? "font-medium text-critical" : "text-muted"}>{x.m.nextDueOn ? `${fmtDate(x.m.nextDueOn)} (${relDays(x.m.nextDueOn)})` : "بلا موعد"}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="المحافظ الاستثمارية الوقفية" description="وقف محفظة يمر بمراحل نظامية: تسجيل الوقف، ثم فتح الحساب، ثم قيده لدى الهيئة — كل مرحلة خلال 5 أيام عمل (لائحة المنتجات الاستثمارية الوقفية م21–23).">
        <DataTable
          rows={d.portfolios}
          rowKey={(p) => p.id}
          empty={<EmptyState icon={Landmark} title="لا محافظ مسجلة" />}
          columns={[
            { key: "a", label: "الحساب", render: (p) => (p.accountNo ? <span dir="ltr" className="tabular">{p.accountNo}</span> : "—") },
            { key: "m", label: "المدير", render: (p) => (p.managerName ? `${p.managerName}${p.managerCmaLicense ? ` (ترخيص ${p.managerCmaLicense})` : ""}` : "—") },
            { key: "c", label: "أمين الحفظ", render: (p) => p.custodian ?? "—", hideOnMobile: true },
            { key: "r", label: "المخاطر", render: (p) => (p.riskLevel ? RISK_LABEL[p.riskLevel === "medium" ? "standard" : p.riskLevel] : "—") },
            { key: "s", label: "المراحل", render: (p) => <Muted>{[p.waqfDeedOn && `وقف ${fmtDate(p.waqfDeedOn)}`, p.registeredWithGaaOn && `تسجيل ${fmtDate(p.registeredWithGaaOn)}`, p.accountOpenedOn && `حساب ${fmtDate(p.accountOpenedOn)}`, p.recordedWithGaaOn && `قيد ${fmtDate(p.recordedWithGaaOn)}`].filter(Boolean).join(" ← ") || "—"}</Muted> },
          ]}
        />
        {canEdit ? (
          <div className="mt-3">
            <Disclosure summary="أضف محفظة">
              <ActionForm
                action={addPortfolio}
                hidden={{ waqfId: id }}
                submitLabel="أضف"
                fields={[
                  { name: "accountNo", label: "رقم الحساب الاستثماري", ltr: true },
                  { name: "custodian", label: "أمين الحفظ" },
                  { name: "managerName", label: "مدير المحفظة" },
                  { name: "managerCmaLicense", label: "ترخيص هيئة السوق المالية", ltr: true },
                  { name: "riskLevel", label: "مستوى المخاطر", type: "select", options: [{ value: "low", label: "منخفض" }, { value: "medium", label: "متوسط" }, { value: "high", label: "مرتفع" }] },
                  { name: "strategy", label: "الاستراتيجية" },
                  { name: "waqfDeedOn", label: "تاريخ وقف المحفظة", type: "date" },
                  { name: "registeredWithGaaOn", label: "تاريخ شهادة التسجيل", type: "date" },
                  { name: "accountOpenedOn", label: "تاريخ فتح الحساب", type: "date" },
                  { name: "recordedWithGaaOn", label: "تاريخ القيد لدى الهيئة", type: "date" },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="سياسة الاستثمار" description="التوزيع المستهدف للأصول وحدوده، والعائد المستهدف وتحمل المخاطر، وما يُمنع الاستثمار فيه.">
        {approvedPolicy ? (
          <div className="space-y-2">
            <p className="text-[14px]"><Badge tone="ok">معتمدة</Badge> الإصدار {approvedPolicy.version}{approvedPolicy.targetReturnPct ? ` · العائد المستهدف ${fmtPct(approvedPolicy.targetReturnPct)}` : ""}{approvedPolicy.reviewDue ? ` · المراجعة ${fmtDate(approvedPolicy.reviewDue)}` : ""}</p>
            <DataTable
              rows={approvedPolicy.allocation ?? []}
              rowKey={(r) => r.category}
              columns={[
                { key: "c", label: "الفئة", render: (r) => ALLOC_LABEL[r.category] ?? r.category },
                { key: "min", label: "الأدنى", render: (r) => fmtPct(r.minPct) },
                { key: "t", label: "المستهدف", render: (r) => fmtPct(r.targetPct) },
                { key: "max", label: "الأعلى", render: (r) => fmtPct(r.maxPct) },
              ]}
            />
            {approvedPolicy.prohibited ? <Muted>المحظور: {approvedPolicy.prohibited}</Muted> : null}
          </div>
        ) : (
          <Muted>لا سياسة معتمدة. الأوقاف المتوسطة والكبيرة تحتاج سياسة استثمار معتمدة تُراجع سنويًا.</Muted>
        )}
        {draftPolicy ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
            <span className="text-[14px]">مسودة الإصدار {draftPolicy.version} بانتظار الاعتماد.</span>
            {waqfCan(access, "finance.approve") ? <ActionButton action={approveInvestmentPolicy} hidden={{ waqfId: id, policyId: draftPolicy.id }} label="اعتمد السياسة" variant="primary" /> : null}
          </div>
        ) : null}
        {canEdit ? (
          <div className="mt-3">
            <Disclosure summary="أعدّ إصدارًا جديدًا">
              <RawActionForm action={saveInvestmentPolicy} hidden={{ waqfId: id }} submitLabel="احفظ المسودة">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-[14px]"><span className="block font-medium">العائد المستهدف (%)</span><input name="targetReturnPct" inputMode="decimal" dir="ltr" defaultValue={approvedPolicy?.targetReturnPct ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-2" /></label>
                  <label className="space-y-1 text-[14px]"><span className="block font-medium">تحمل المخاطر</span><select name="riskTolerance" defaultValue={approvedPolicy?.riskTolerance ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-2"><option value="">—</option><option value="low">منخفض</option><option value="medium">متوسط</option><option value="high">مرتفع</option></select></label>
                  <label className="space-y-1 text-[14px]"><span className="block font-medium">موعد المراجعة</span><input type="date" name="reviewDue" dir="ltr" className="block h-10 w-full rounded-md border border-line-strong bg-surface px-2" /></label>
                  <label className="space-y-1 text-[14px]"><span className="block font-medium">سياسة الاقتراض والرافعة</span><input name="leveragePolicy" defaultValue={approvedPolicy?.leveragePolicy ?? "لا اقتراض بضمان أصول الوقف دون إذن الجهة المختصة"} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-2" /></label>
                  <label className="space-y-1 text-[14px] sm:col-span-2"><span className="block font-medium">المحظور</span><textarea name="prohibited" defaultValue={approvedPolicy?.prohibited ?? "الأدوات غير المتوافقة مع الضوابط الشرعية، والمضاربات قصيرة الأجل"} className="block min-h-16 w-full rounded-md border border-line-strong bg-surface px-2 py-1" /></label>
                </div>
                <p className="text-[14px] font-medium">التوزيع المستهدف (المجموع 100%)</p>
                <RowsEditor
                  prefix="al"
                  addLabel="أضف فئة"
                  initial={(approvedPolicy?.allocation ?? []).map((r) => ({ category: r.category, minPct: String(r.minPct), targetPct: String(r.targetPct), maxPct: String(r.maxPct) }))}
                  fields={[
                    { key: "category", label: "الفئة", type: "select", options: options(ALLOC_LABEL) },
                    { key: "minPct", label: "الأدنى %", type: "number" },
                    { key: "targetPct", label: "المستهدف %", type: "number" },
                    { key: "maxPct", label: "الأعلى %", type: "number" },
                  ]}
                />
              </RawActionForm>
            </Disclosure>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
