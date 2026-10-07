import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { Badge, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { ConflictBadge, PRIORITY_LABEL, SlaBadge, StatusBadge } from "@/components/requests/bits";
import { cn } from "@/lib/utils";
import { requireStaff } from "@/server/authz/context";
import { QUEUE_TABS, queueCounts, staffQueue, type QueueTab } from "@/server/modules/requests/queries";

export const metadata: Metadata = { title: "الطلبات" };

export default async function StaffQueue({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const auth = await requireStaff("staff.requests.assigned");
  const sp = await searchParams;
  const ops = auth.perms.has("admin.requests.all");
  const tabs = QUEUE_TABS.filter((t) => !t.opsOnly || ops);
  const tab = (tabs.find((t) => t.key === sp.tab)?.key ?? (ops ? "all" : "mine")) as QueueTab;
  const [rows, counts] = await Promise.all([staffQueue(auth, tab, sp.q), queueCounts(auth)]);
  const qs = (t: string) => `/admin/requests?tab=${t}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الطلبات"
        description={ops ? "كل طلبات العملاء: وزّعها وتابع المهل والجودة." : "الطلبات المسندة إليك فقط. يوزّع مدير التشغيل الطلبات الجديدة."}
      />
      <nav aria-label="تبويبات الطلبات" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((t) => (
          <Link key={t.key} href={qs(t.key)} aria-current={t.key === tab ? "page" : undefined}
            className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[15px]", t.key === tab ? "bg-ink text-white dark:text-[#0f141c]" : "border border-line bg-surface hover:bg-surface-2")}>
            {t.label}
            {counts[t.key] !== undefined ? <span className={cn("tabular rounded-full px-1.5 text-[12px]", t.key === tab ? "bg-white/20" : "bg-surface-2 text-muted")}>{counts[t.key]}</span> : null}
          </Link>
        ))}
      </nav>
      <form className="flex max-w-md gap-2" role="search">
        <input type="hidden" name="tab" value={tab} />
        <label htmlFor="q" className="sr-only">ابحث برقم الطلب أو الخدمة أو الوقف أو العميل</label>
        <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="رقم الطلب، الخدمة، الوقف، العميل" className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]" />
        <button className="h-10 shrink-0 rounded-md border border-line-strong bg-surface px-3 text-[15px] hover:bg-surface-2">بحث</button>
      </form>
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            caption="قائمة الطلبات"
            empty={<div className="p-4"><EmptyState icon={Inbox} title="لا طلبات هنا">{tab === "mine" ? "لا طلبات مسندة إليك حاليًا." : "لا طلبات في هذا التبويب."}</EmptyState></div>}
            columns={[
              { key: "n", label: "الطلب", render: (r) => <Link href={`/admin/requests/${r.id}`} className="tabular font-medium text-ink hover:underline" dir="ltr">{r.number}</Link> },
              { key: "s", label: "الخدمة", render: (r) => <span><span className="tabular text-[13px] text-muted" dir="ltr">{r.serviceCode}</span> {r.serviceName}</span> },
              { key: "w", label: "الوقف", render: (r) => <span className={r.waqfName ? "" : "text-muted"}>{r.waqfName ?? "بلا وقف"}</span> },
              { key: "c", label: "العميل", render: (r) => r.requesterName ?? "—", hideOnMobile: true },
              { key: "st", label: "الحالة", render: (r) => (
                <span className="flex flex-wrap gap-1">
                  <StatusBadge status={r.status} />
                  <ConflictBadge value={r.conflictCheck} />
                  {r.priority === "urgent" || r.priority === "high" ? <Badge tone={r.priority === "urgent" ? "critical" : "warn"} icon={false}>{PRIORITY_LABEL[r.priority]}</Badge> : null}
                  {!r.assignedToUserId ? <Badge tone="info" icon={false}>غير مسند</Badge> : null}
                </span>
              ) },
              { key: "sla", label: "المهلة", render: (r) => <SlaBadge due={r.slaDueAt} status={r.status} /> },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}
