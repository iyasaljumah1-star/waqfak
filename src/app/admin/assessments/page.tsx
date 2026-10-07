import type { Metadata } from "next";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { Microscope } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { users } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { listReviewQueue } from "@/server/modules/assessment/queries";
import { STATUS_VIEW } from "@/server/modules/assessment/facts";
import { ASMT_STATUS } from "@/components/assessment/list";
import { Badge, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { cn, fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "التقييمات المعمّقة" };

const TABS = [
  { key: "pending", label: "بانتظار المراجعة" },
  { key: "reviewed", label: "روجعت" },
] as const;

export default async function ReviewQueue({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const auth = await requireStaff("staff.assessment_review");
  const sp = await searchParams;
  const tab = sp.tab === "reviewed" ? "reviewed" : "pending";

  // RLS limits the queue to deep assessments the reviewer may see: not linked to a waqf, or on a waqf
  // they are assigned to (open request) or reach through a global-access role.
  const { rows, names } = await read(auth, async (tx) => {
    const rows = await listReviewQueue(tx);
    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean) as string[])];
    const names = ids.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    return { rows, names: new Map(names.map((n) => [n.id, n.name])) };
  });
  const pending = rows.filter((r) => !r.reviewedAt).sort((a, b) => +(a.completedAt ?? a.startedAt) - +(b.completedAt ?? b.startedAt));
  const reviewed = rows.filter((r) => r.reviewedAt);
  const shown = tab === "pending" ? pending : reviewed;
  const counts = { pending: pending.length, reviewed: reviewed.length };

  return (
    <div className="space-y-6">
      <PageHeader
        title="التقييمات المعمّقة"
        description="راجع التقييمات المعمّقة قبل اعتمادها: تحقق من الإثبات، أضف ملاحظاتك على المحاور، وعدّل التوصيات. الأقدم أولًا."
      />
      <nav aria-label="تبويبات المراجعة" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/assessments?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}
            className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[15px]", t.key === tab ? "bg-ink text-white dark:text-[#0f141c]" : "border border-line bg-surface hover:bg-surface-2")}>
            {t.label}
            <span className={cn("tabular rounded-full px-1.5 text-[12px]", t.key === tab ? "bg-white/20" : "bg-surface-2 text-muted")}>{counts[t.key]}</span>
          </Link>
        ))}
      </nav>
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={shown}
            rowKey={(r) => r.id}
            caption="قائمة التقييمات المعمّقة"
            empty={
              <div className="p-4">
                <EmptyState icon={Microscope} title={tab === "pending" ? "لا تقييمات بانتظار المراجعة" : "لم تُراجع تقييمات بعد"}>
                  {tab === "pending" ? "يظهر هنا كل تقييم معمّق يكمله العميل، إن كان لك وصول إلى وقفه." : "تظهر هنا التقييمات بعد اعتماد مراجعتها."}
                </EmptyState>
              </div>
            }
            columns={[
              { key: "n", label: "التقييم", render: (r) => <Link href={`/admin/assessments/${r.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{r.number}</Link> },
              { key: "w", label: "الوقف", render: (r) => <span className={r.waqfName ? "" : "text-muted"}>{r.waqfName ?? r.waqfLabel ?? "غير مرتبط بوقف"}</span> },
              { key: "c", label: "العميل", render: (r) => (r.userId ? names.get(r.userId) ?? "—" : "—"), hideOnMobile: true },
              {
                key: "s", label: "النتيجة الآلية",
                render: (r) => r.overallScore === null ? "—" : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="tabular font-semibold">{Math.round(r.overallScore)}</span>
                    {r.resultStatus ? <Badge tone={STATUS_VIEW[r.resultStatus]?.tone ?? "neutral"}>{STATUS_VIEW[r.resultStatus]?.label}</Badge> : null}
                  </span>
                ),
              },
              {
                key: "d", label: tab === "pending" ? "اكتمل" : "روجع",
                render: (r) => {
                  const d = tab === "pending" ? r.completedAt : r.reviewedAt;
                  const ago = d ? -relDaysNum(d) : null;
                  return (
                    <span className="tabular">
                      {fmtDate(d)}
                      {tab === "pending" && ago !== null && ago >= 3 ? <Badge tone="warn" icon={false} className="ms-2">منذ {ago} أيام</Badge> : null}
                    </span>
                  );
                },
              },
              { key: "st", label: "الحالة", render: (r) => <Badge tone={ASMT_STATUS[r.status]?.tone ?? "neutral"} icon={false}>{ASMT_STATUS[r.status]?.label ?? r.status}</Badge>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

/** Whole days between today and a past date (negative for the past). */
function relDaysNum(d: Date): number {
  return Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
}
