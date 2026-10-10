import type { Metadata } from "next";
import { Archive, FileBarChart, FileSpreadsheet, FileText, ShieldCheck } from "lucide-react";
import { Alert, Badge, DataTable, EmptyState, PageHeader, Panel, buttonClass } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listReports } from "@/server/modules/compliance/queries";
import { lastFiscalYearEnd, todayISO } from "@/server/engines/dates";
import { GenerateReportForm } from "../compliance/forms";
import { RevokeReportButton } from "./revoke";

export const metadata: Metadata = { title: "التقارير وحزم التصدير" };

const PKG_AR: Record<string, string> = { annual: "حزمة التقرير السنوي", gaa_package: "ملف المستفيد الحقيقي", compliance: "سجل الالتزامات (CSV)" };
const PKG_ICON = { annual: FileText, gaa_package: ShieldCheck, compliance: FileSpreadsheet } as const;

export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/reports` });
  const access = await requireWaqf(auth, id, "reports.generate");
  const rows = await read(auth, (tx) => listReports(tx, id));
  const canBo = waqfCan(access, "bo.view");
  const fye = lastFiscalYearEnd(todayISO(), access.waqf.fiscalYearEnd || "12-31");
  const y = Number(fye.slice(0, 4));
  const fyOptions = [y, y - 1, y - 2].map((n) => ({ value: String(n), label: `السنة المالية المنتهية ${n}-${access.waqf.fiscalYearEnd || "12-31"}` }));
  const base = `/app/w/${id}/reports`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="التقارير وحزم التصدير"
        description="حزم جاهزة للتقديم إلى الهيئة العامة للأوقاف، تُبنى من بيانات الوقف لحظة إعدادها، وتُقدَّم عبر بوابة الهيئة."
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { label: "التقارير" }]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="حزمة التقرير السنوي" description="هوية الوقف، النظارة، ملخص المستفيد الحقيقي، قائمة تدقيق القوائم والوثائق، القرارات، حالة الامتثال، وإقرار الناظر للتوقيع." className="lg:col-span-2">
          <GenerateReportForm waqfId={id} pkg="annual" fyOptions={fyOptions} label="جهّز الحزمة السنوية" />
          <p className="mt-3 text-[13px] text-muted">بعد التجهيز نزّلها PDF للطباعة والتوقيع، أو ملفًا مضغوطًا (ZIP) يضم PDF مع سجلي الالتزامات والوثائق بصيغة CSV.</p>
        </Panel>
        <div className="space-y-4">
          <Panel title="ملف المستفيد الحقيقي" description="سجل تفصيلي سري وفق معايير المستفيد الحقيقي (م5 وم6).">
            {!canBo ? <p className="mb-3 text-[13px] text-muted">تُحجب الحقول المشفرة في نسختك، لأن صلاحيتك لا تشمل عرض بيانات المستفيد الحقيقي.</p> : null}
            <GenerateReportForm waqfId={id} pkg="bo" label="جهّز الملف" />
          </Panel>
          <Panel title="سجل الالتزامات" description="كل الالتزامات بحالاتها ومراجعها بصيغة CSV.">
            <GenerateReportForm waqfId={id} pkg="obligations_csv" label="جهّز السجل" />
          </Panel>
        </div>
      </div>

      <Alert tone="info">كل حزمة تحمل رقمًا ورمز تحقق، وتُحفظ لقطتها كما كانت لحظة الإعداد؛ يُسجَّل كل تنزيل في سجل العمليات.</Alert>

      <Panel title="الحزم المجهزة" tight>
        <DataTable
          rows={rows}
          rowKey={(r) => r.r.id}
          caption="الحزم المجهزة"
          empty={<div className="p-4"><EmptyState icon={FileBarChart} title="لم تُجهّز حزم بعد">اختر حزمة أعلاه لتجهيزها.</EmptyState></div>}
          columns={[
            {
              key: "title",
              label: "الحزمة",
              render: (r) => {
                const Icon = PKG_ICON[r.r.kind as keyof typeof PKG_ICON] ?? FileText;
                return (
                  <div className="flex items-start gap-2">
                    <Icon aria-hidden className="mt-1 size-4 shrink-0 text-muted" />
                    <div className="min-w-0">
                      <p className="font-medium">{r.r.title}</p>
                      <p className="text-[13px] text-muted">{PKG_AR[r.r.kind] ?? r.r.kind} · <span dir="ltr" className="tabular">{r.r.number}</span></p>
                    </div>
                  </div>
                );
              },
            },
            { key: "at", label: "أُعدّت", render: (r) => <span>{fmtDateTime(r.r.generatedAt)}{r.by ? <><br /><span className="text-[13px] text-muted">{r.by}</span></> : null}</span> },
            { key: "code", label: "رمز التحقق", render: (r) => <span dir="ltr" className="tabular text-[13px]">{r.r.verificationCode}</span>, hideOnMobile: true },
            {
              key: "actions",
              label: "تنزيل",
              render: (r) =>
                r.r.revokedAt ? (
                  <Badge tone="neutral" icon={false}>ملغاة</Badge>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <a className={buttonClass("secondary", "sm")} href={`${base}/${r.r.id}/download`} download>{r.r.kind === "compliance" ? "CSV" : "PDF"}</a>
                    {r.r.kind === "annual" ? (
                      <a className={buttonClass("secondary", "sm")} href={`${base}/${r.r.id}/download?format=zip`} download><Archive aria-hidden className="size-4" /> ZIP</a>
                    ) : null}
                    <RevokeReportButton waqfId={id} reportId={r.r.id} />
                  </div>
                ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
