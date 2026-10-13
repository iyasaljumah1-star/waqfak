import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";
import { Badge, buttonClass, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { ConflictBadge, PRIORITY_LABEL, SlaBadge, StatusBadge } from "@/components/requests/bits";
import { cn } from "@/lib/utils";
import { requireStaff } from "@/server/authz/context";
import { assignableStaff, QUEUE_TABS, queueCounts, staffQueue, type QueueTab } from "@/server/modules/requests/queries";
import { SERVICES } from "@/server/seed/data/services";
import { STATUS_LABEL } from "@/server/modules/requests/workflow";

export const metadata: Metadata = { title: "الطلبات" };

type SP = { tab?: string; q?: string; service?: string; status?: string; assignee?: string; from?: string; to?: string };
const FILTER_KEYS = ["q", "service", "status", "assignee", "from", "to"] as const;

export default async function StaffQueue({ searchParams }: { searchParams: Promise<SP> }) {
  const auth = await requireStaff("admin.access");
  if (!auth.perms.has("staff.requests.assigned") && !auth.perms.has("admin.requests.all")) redirect("/admin?denied=1");
  const sp = await searchParams;
  const ops = auth.perms.has("admin.requests.all");
  const tabs = QUEUE_TABS.filter((t) => !t.opsOnly || ops);
  const tab = (tabs.find((t) => t.key === sp.tab)?.key ?? (ops ? "all" : "mine")) as QueueTab;
  const filters = { service: sp.service, status: sp.status, assignee: ops ? sp.assignee : undefined, from: sp.from, to: sp.to };
  const [rows, counts, staff] = await Promise.all([staffQueue(auth, tab, sp.q, filters), queueCounts(auth), ops ? assignableStaff(auth) : Promise.resolve([])]);
  const keep = FILTER_KEYS.map((k) => (sp[k] ? `&${k}=${encodeURIComponent(sp[k]!)}` : "")).join("");
  const qs = (t: string) => `/admin/requests?tab=${t}${keep}`;
  const filtered = FILTER_KEYS.some((k) => k !== "q" && sp[k]);
  const sel = "h-10 rounded-md border border-line-strong bg-surface px-2 text-[15px]";

  return (
    <div className="space-y-6">
      <PageHeader
        title="الطلبات"
        description={ops ? "كل طلبات العملاء: وزّعها وتابع المهل والجودة." : "الطلبات المسندة إليك فقط. يوزّع مدير التشغيل الطلبات الجديدة."}
      />
      <nav aria-label="تبويبات الطلبات" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((t) => (
          <Link key={t.key} href={qs(t.key)} aria-current={t.key === tab ? "page" : undefined}
            className={buttonClass(t.key === tab ? "primary" : "secondary", "sm", "shrink-0 gap-1.5")}>
            {t.label}
            {counts[t.key] !== undefined ? <span className={cn("tabular rounded-full px-1.5 text-[12px]", t.key === tab ? "bg-white/20" : "bg-surface-2 text-muted")}>{counts[t.key]}</span> : null}
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-2" role="search" aria-label="بحث وتصفية الطلبات">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-[13px] text-muted">بحث
          <input name="q" defaultValue={sp.q ?? ""} placeholder="رقم الطلب، الخدمة، الوقف، العميل" className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] text-text" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted">الخدمة
          <select name="service" defaultValue={sp.service ?? ""} className={sel}><option value="">كل الخدمات</option>{SERVICES.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.nameAr}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted">الحالة
          <select name="status" defaultValue={sp.status ?? ""} className={sel}><option value="">كل الحالات</option>{Object.entries(STATUS_LABEL).filter(([k]) => k !== "draft").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        {ops ? (
          <label className="flex flex-col gap-1 text-[13px] text-muted">المسؤول
            <select name="assignee" defaultValue={sp.assignee ?? ""} className={sel}><option value="">الكل</option><option value="none">غير مسند</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-[13px] text-muted">من تاريخ
          <input type="date" name="from" defaultValue={sp.from ?? ""} className={sel} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted">إلى تاريخ
          <input type="date" name="to" defaultValue={sp.to ?? ""} className={sel} />
        </label>
        <button className="h-10 shrink-0 rounded-md border border-line-strong bg-surface px-3 text-[15px] hover:bg-surface-2">تطبيق</button>
        {filtered || sp.q ? <Link href={`/admin/requests?tab=${tab}`} className="h-10 content-center px-2 text-[14px] text-ink hover:underline">مسح التصفية</Link> : null}
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
