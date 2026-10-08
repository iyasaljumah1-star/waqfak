import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, Badge, DefinitionList, PageHeader, Panel, Steps } from "@/components/ui";
import { ReportActions } from "@/components/admin/forms/mlro-forms";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { suspicionReport } from "@/server/modules/admin/mlro/queries";
import { INDICATORS, SR_STATUS_LABEL } from "@/server/modules/admin/mlro/shared";

export const metadata: Metadata = { title: "بلاغ اشتباه" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const auth = await requireAdmin("mlro.access");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await suspicionReport(auth, id);
  if (!r) notFound();
  const p = r.payload;
  return (
    <div>
      <PageHeader
        title={`بلاغ اشتباه — ${p.waqfName ?? "وقف"}`}
        crumbs={[{ href: "/admin/mlro", label: "الامتثال الداخلي" }, { label: p.waqfNumber ?? "بلاغ" }]}
        description={<Badge tone={r.status === "internal_review" ? "fine" : r.status === "reported" ? "critical" : "neutral"} icon={false}>{SR_STATUS_LABEL[r.status] ?? r.status}</Badge>}
      />
      {sp.created ? <Alert tone="ok" className="mb-6" title="فُتح البلاغ">سُجل للمراجعة الداخلية. وثّق كل خطوة هنا.</Alert> : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Panel title="الوقائع ووجه الاشتباه">
            <p className="whitespace-pre-line text-[15px] leading-7">{p.summary}</p>
            {p.indicators.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.indicators.map((k) => <Badge key={k} tone="neutral" icon={false}>{INDICATORS[k] ?? k}</Badge>)}
              </div>
            ) : null}
          </Panel>
          <Panel title="المسار">
            {p.timeline.length ? (
              <Steps steps={p.timeline.map((t, i) => ({ label: t.text, status: i === p.timeline.length - 1 ? "active" : "done", meta: `${t.byName} · ${fmtDateTime(t.at)}` }))} />
            ) : (
              <p className="text-muted">لا خطوات مسجلة.</p>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="البيانات">
            <DefinitionList
              cols={1}
              items={[
                { label: "الوقف", value: p.waqfNumber ? <span><span dir="ltr" className="tabular">{p.waqfNumber}</span> — {p.waqfName}</span> : "—" },
                { label: "فتحه", value: `${r.createdByName} · ${fmtDateTime(r.createdAt)}` },
                { label: "آخر تحديث", value: fmtDateTime(r.updatedAt) },
                { label: "تاريخ الإبلاغ", value: r.reportedToFiuOn ? fmtDate(r.reportedToFiuOn) : "—" },
                { label: "مرجع البلاغ", value: r.fiuReference ? <span dir="ltr">{r.fiuReference}</span> : "—" },
              ]}
            />
          </Panel>
          <Panel title="إجراء">
            <ReportActions id={r.id} status={r.status} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
