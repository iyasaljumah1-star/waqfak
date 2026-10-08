import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Alert, Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { NewReportForm, ScreeningDecision, ScreeningForm } from "@/components/admin/forms/mlro-forms";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { mlroOverview } from "@/server/modules/admin/mlro/queries";
import { INDICATORS, SCREEN_STATUS_LABEL, SR_STATUS_LABEL } from "@/server/modules/admin/mlro/shared";

export const metadata: Metadata = { title: "الامتثال الداخلي" };

const DECISION: Record<string, string> = { cleared: "لا إجراء", escalated: "صُعّد لبلاغ", false_positive: "تطابق كاذب" };

export default async function MlroPage() {
  const auth = await requireAdmin("mlro.access");
  const d = await mlroOverview(auth);
  const open = d.reports.filter((r) => r.status === "internal_review").length;
  return (
    <div>
      <PageHeader title="الامتثال الداخلي (MLRO)" description="بلاغات الاشتباه ونتائج الفحص في مخطط بيانات معزول لا يصل إليه غير مسؤول الامتثال. المحتوى مشفّر، وكل اطلاع مسجّل." />
      <Alert tone="warn" title="حظر التنبيه" className="mb-6">
        لا تُبلّغ الوقف أو أطرافه بوجود بلاغ أو فحص، ولا تذكره في الطلبات أو المراسلات. لا يظهر شيء من هذه الصفحة في سجلات الأوقاف.
      </Alert>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Panel title={`بلاغات الاشتباه (${d.reports.length}${open ? ` · ${open} قيد المراجعة` : ""})`} tight>
            {d.reports.length ? (
              <ul className="divide-y divide-line">
                {d.reports.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link href={`/admin/mlro/${r.id}`} className="font-medium text-ink hover:underline">
                        {r.waqfName ?? "وقف"} <span dir="ltr" className="tabular text-[13px] text-muted">{r.waqfNumber}</span>
                      </Link>
                      <Badge tone={r.status === "internal_review" ? "fine" : r.status === "reported" ? "critical" : "neutral"} icon={false}>{SR_STATUS_LABEL[r.status] ?? r.status}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[14px] text-muted">{r.summary}</p>
                    <p className="mt-1 text-[12px] text-muted">فتحه {r.createdBy} · {fmtDateTime(r.createdAt)}{r.reportedToFiuOn ? ` · أُبلغ ${fmtDate(r.reportedToFiuOn)}` : ""}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4"><EmptyState icon={ShieldAlert} title="لا بلاغات" /></div>
            )}
          </Panel>
          <Panel title="نتائج الفحص" tight>
            {d.screenings.length ? (
              <ul className="divide-y divide-line">
                {d.screenings.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-medium">{s.label}</span>
                      <span className="flex gap-1">
                        <Badge tone={s.status === "clear" ? "ok" : s.status === "error" ? "neutral" : "critical"} icon={false}>{SCREEN_STATUS_LABEL[s.status] ?? s.status}</Badge>
                        {s.decision ? <Badge tone="neutral" icon={false}>{DECISION[s.decision] ?? s.decision}</Badge> : null}
                      </span>
                    </div>
                    <p className="text-[12px] text-muted">{s.provider} · {fmtDateTime(s.createdAt)}{s.reviewer ? ` · ${s.reviewer}` : ""}</p>
                    {s.notes ? <p className="mt-1 whitespace-pre-line text-[14px]">{s.notes}</p> : null}
                    {s.status !== "clear" && (!s.decision || s.decision === "cleared") ? <ScreeningDecision id={s.id} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-muted">لا نتائج فحص.</p>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="بلاغ اشتباه جديد">
            <NewReportForm indicators={INDICATORS} />
          </Panel>
          <Panel title="تسجيل نتيجة فحص">
            <ScreeningForm />
          </Panel>
        </div>
      </div>
    </div>
  );
}
