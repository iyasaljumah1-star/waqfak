import Link from "next/link";
import { Badge, DataTable, type Tone } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { AssessmentListItem } from "@/server/modules/assessment/queries";
import { STATUS_VIEW } from "@/server/modules/assessment/facts";

export const ASMT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "لم يكتمل", tone: "neutral" },
  completed: { label: "مكتمل", tone: "ok" },
  computed: { label: "مكتمل", tone: "ok" },
  under_review: { label: "بانتظار المراجعة", tone: "info" },
  published: { label: "روجع من مختص", tone: "seal" },
  superseded: { label: "مُستبدل", tone: "neutral" },
};

export function assessmentHref(a: Pick<AssessmentListItem, "id" | "status">, base = "/app/assessments") {
  return a.status === "draft" ? `/assessment/${a.id}` : `${base}/${a.id}`;
}

export function AssessmentTable({ rows, showWaqf = true, base = "/app/assessments", empty }: { rows: AssessmentListItem[]; showWaqf?: boolean; base?: string; empty?: React.ReactNode }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      empty={empty}
      caption="التقييمات"
      columns={[
        {
          key: "n", label: "التقييم",
          render: (r) => (
            <Link href={assessmentHref(r, base)} className="font-medium text-ink underline-offset-4 hover:underline">
              {r.number}
              <span className="ms-2 text-[13px] font-normal text-muted">{r.kind === "deep" ? "معمّق" : "سريع"}</span>
            </Link>
          ),
        },
        ...(showWaqf ? [{ key: "w", label: "الوقف", render: (r: AssessmentListItem) => r.waqfName ?? r.waqfLabel ?? <span className="text-muted">غير مرتبط بوقف</span> }] : []),
        { key: "d", label: "التاريخ", render: (r) => <span className="tabular">{fmtDate(r.completedAt ?? r.startedAt)}</span> },
        {
          key: "s", label: "النتيجة",
          render: (r) =>
            r.overallScore !== null ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="tabular font-semibold">{Math.round(r.overallScore)}</span>
                {r.resultStatus ? <Badge tone={STATUS_VIEW[r.resultStatus]?.tone ?? "neutral"}>{STATUS_VIEW[r.resultStatus]?.label ?? r.resultStatus}</Badge> : null}
              </span>
            ) : (
              <span className="text-muted">—</span>
            ),
        },
        { key: "st", label: "الحالة", render: (r) => <Badge tone={ASMT_STATUS[r.status]?.tone ?? "neutral"} icon={false}>{ASMT_STATUS[r.status]?.label ?? r.status}</Badge>, hideOnMobile: true },
      ]}
    />
  );
}
