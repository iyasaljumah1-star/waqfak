import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { reviewQueue, type QueueGroup } from "@/server/engine/review/queries";
import { Badge, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { cn, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "المراجعة والاعتماد النهائي" };

const TABS: { key: QueueGroup; label: string; hint: string }[] = [
  { key: "ready", label: "طلبات جاهزة للمراجعة والاعتماد", hint: "مخرجات أكملتها المنصة وتنتظر مراجعتك واعتمادك النهائي." },
  { key: "blocked", label: "تعذّرت معالجتها", hint: "لم تكتمل المعالجة الآلية: الأسباب في صفحة كل طلب." },
  { key: "processing", label: "قيد المعالجة الآلية", hint: "تعالجها المنصة الآن أو تنتظر دورها في الطابور." },
  { key: "client", label: "بانتظار العميل", hint: "طلبت المنصة من العميل استكمال ما يلزم، وتُستأنف المعالجة عند رده." },
  { key: "approved", label: "معتمدة", hint: "اعتُمدت وأُتيحت لأصحابها." },
];

export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const auth = await requireStaff("admin.requests.all");
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "ready") as QueueGroup;
  const rows = await reviewQueue(auth);
  const shown = rows.filter((r) => r.group === tab);
  const count = (g: QueueGroup) => rows.filter((r) => r.group === g).length;
  return (
    <div className="space-y-6">
      <PageHeader title="المراجعة والاعتماد النهائي" description="طلبات المعالجة الآلية: تُنجز المنصة الخدمة وتُعدّ مخرجها، ويراجعه مدير النظام ويعتمده، ثم يُتاح للعميل." />
      <nav aria-label="أقسام المراجعة" className="flex flex-wrap gap-2" data-testid="review-tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/review?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}
            className={cn("rounded-md border px-3 py-1.5 text-[14px]", t.key === tab ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-surface-2")}>
            {t.label} <span className="tabular">({count(t.key)})</span>
          </Link>
        ))}
      </nav>
      <Panel title={TABS.find((t) => t.key === tab)!.label} description={TABS.find((t) => t.key === tab)!.hint}>
        <div data-testid={`review-list-${tab}`}>
          <DataTable
            rows={shown}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={ClipboardCheck} title="لا طلبات هنا الآن" />}
            columns={[
              { key: "n", label: "الطلب", render: (r) => <Link href={`/admin/review/${r.id}`} className="font-medium text-ink underline-offset-4 hover:underline" dir="ltr">{r.number}</Link> },
              { key: "s", label: "الخدمة", render: (r) => `${r.code} — ${r.service}` },
              { key: "w", label: "الوقف والعميل", hideOnMobile: true, render: (r) => [r.waqf, r.requester].filter(Boolean).join(" — ") || "—" },
              { key: "st", label: "آخر معالجة", render: (r) => r.lastRun ? <Badge tone={r.lastRun.status === "ready" ? "ok" : r.lastRun.status === "blocked" || r.lastRun.status === "failed" ? "critical" : "info"}>{RUN_LABEL[r.lastRun.status] ?? r.lastRun.status}</Badge> : r.job ? <Badge tone="info">{JOB_LABEL[r.job.status] ?? r.job.status}</Badge> : "—" },
              { key: "t", label: "آخر تحديث", hideOnMobile: true, render: (r) => fmtDateTime(r.updatedAt) },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

const RUN_LABEL: Record<string, string> = { running: "جارية", ready: "اكتملت", needs_client: "بانتظار العميل", waiting: "بانتظار شرط", blocked: "تعذّرت", failed: "خطأ (يُعاد)" };
const JOB_LABEL: Record<string, string> = { queued: "في الطابور", running: "جارية", succeeded: "اكتملت", dead: "توقفت بعد المحاولات", failed: "فشلت" };
