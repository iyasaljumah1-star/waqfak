import type { Metadata } from "next";
import Link from "next/link";
import { Contact } from "lucide-react";
import { Badge, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { ClientsTabs } from "@/components/admin/section-tabs";
import { USER_STATUS } from "@/components/admin/labels";
import { fmtDate, fmtNumber, fmtSAR } from "@/lib/utils";
import { maskPhoneShort, requireAdmin } from "@/server/modules/admin/guard";
import { listClients, newContactCount } from "@/server/modules/admin/clients/queries";

export const metadata: Metadata = { title: "العملاء" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const auth = await requireAdmin("admin.users");
  const sp = await searchParams;
  const [rows, newMsgs] = await Promise.all([listClients(auth, sp.q), newContactCount(auth)]);
  return (
    <div>
      <PageHeader title="العملاء" description="أصحاب الحسابات من الواقفين والنظار والأعضاء والمستفيدين، مع أوقافهم وطلباتهم وفواتيرهم." />
      <ClientsTabs newMessages={newMsgs} />
      <form role="search" className="mb-4 flex max-w-lg gap-2">
        <label htmlFor="q" className="sr-only">بحث في العملاء</label>
        <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="الاسم أو البريد أو آخر أرقام الجوال" className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]" />
        <button className="h-10 shrink-0 rounded-md border border-line-strong bg-surface px-4 text-[15px] hover:bg-surface-2">بحث</button>
      </form>
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            caption="قائمة العملاء"
            empty={<div className="p-4"><EmptyState icon={Contact} title="لا عملاء مطابقون" /></div>}
            columns={[
              { key: "n", label: "العميل", render: (r) => (
                <span>
                  <Link href={`/admin/clients/${r.id}`} className="font-medium text-ink hover:underline">{r.fullName || "بلا اسم"}</Link>
                  <span dir="ltr" className="tabular block text-end text-[13px] text-muted md:text-start">{maskPhoneShort(r.phone)}</span>
                </span>
              ) },
              { key: "w", label: "الأوقاف", render: (r) => <span className="tabular">{fmtNumber(r.waqfs)}</span> },
              { key: "r", label: "الطلبات", render: (r) => <span className="tabular">{fmtNumber(r.requests)}{r.openRequests ? <span className="text-muted"> ({fmtNumber(r.openRequests)} مفتوح)</span> : null}</span> },
              { key: "i", label: "الفواتير", render: (r) => <span className="tabular">{fmtNumber(r.invoices)}{r.due ? <span className="text-fine"> · مستحق {fmtSAR(r.due)}</span> : null}</span> },
              { key: "s", label: "الحالة", render: (r) => <Badge tone={USER_STATUS[r.status]?.tone ?? "neutral"}>{USER_STATUS[r.status]?.label ?? r.status}</Badge>, hideOnMobile: true },
              { key: "c", label: "انضم", render: (r) => <span className="text-[14px] text-muted">{fmtDate(r.createdAt)}</span>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}
