import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, DataTable, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { ClientsTabs } from "@/components/admin/section-tabs";
import { USER_STATUS } from "@/components/admin/labels";
import { DSR_LABEL, DSR_STATUS_LABEL } from "@/server/modules/account/constants";
import { fmtDate, fmtDateTime, fmtSAR, STATUS_LABEL as WAQF_STATUS } from "@/lib/utils";
import { roleName } from "@/server/authz/catalog";
import { maskPhoneShort, requireAdmin } from "@/server/modules/admin/guard";
import { clientDetail } from "@/server/modules/admin/clients/queries";
import { STATUS_LABEL } from "@/server/modules/requests/workflow";

export const metadata: Metadata = { title: "عميل" };

const INV_LABEL: Record<string, string> = { issued: "مستحقة", paid: "مسددة", void: "ملغاة", overdue: "متأخرة" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("admin.users");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await clientDetail(auth, id);
  if (!d) notFound();
  const u = d.user;
  const st = USER_STATUS[u.status] ?? { label: u.status, tone: "neutral" as const };
  return (
    <div>
      <PageHeader
        title={u.fullName || "عميل بلا اسم"}
        crumbs={[{ href: "/admin/clients", label: "العملاء" }, { label: u.fullName || "عميل" }]}
        actions={<Link href={`/admin/users/${u.id}`} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] hover:bg-surface-2">الحساب والأمان</Link>}
      />
      <ClientsTabs />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Panel title="الأوقاف">
            {d.memberships.length ? (
              <ul className="divide-y divide-line">
                {d.memberships.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    {m.name ? <Link href={`/admin/waqfs/${m.waqfId}`} className="font-medium text-ink hover:underline">{m.name}</Link> : <span className="text-muted">وقف خارج صلاحياتك</span>}
                    <span className="flex flex-wrap gap-1">
                      <Badge tone="ink" icon={false}>{roleName(m.roleKey)}</Badge>
                      {m.waqfStatus ? <Badge tone="neutral" icon={false}>{WAQF_STATUS[m.waqfStatus] ?? m.waqfStatus}</Badge> : null}
                      {m.status !== "active" ? <Badge tone="neutral" icon={false}>عضوية منتهية</Badge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">لا يرتبط بأي وقف.</p>
            )}
          </Panel>
          <Panel title="الطلبات" tight>
            <div className="px-3 md:px-2">
              <DataTable
                rows={d.requests}
                rowKey={(r) => r.id}
                empty={<p className="p-4 text-muted">لا طلبات.</p>}
                columns={[
                  { key: "n", label: "الطلب", render: (r) => <Link href={`/admin/requests/${r.id}`} dir="ltr" className="tabular text-ink hover:underline">{r.number}</Link> },
                  { key: "s", label: "الخدمة", render: (r) => r.service ?? "—" },
                  { key: "w", label: "الوقف", render: (r) => r.waqfName ?? "—", hideOnMobile: true },
                  { key: "st", label: "الحالة", render: (r) => <Badge tone="neutral" icon={false}>{STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status}</Badge> },
                  { key: "d", label: "التاريخ", render: (r) => fmtDate(r.createdAt), hideOnMobile: true },
                ]}
              />
            </div>
          </Panel>
          <Panel title="الفواتير" tight>
            <div className="px-3 md:px-2">
              <DataTable
                rows={d.invoices}
                rowKey={(r) => r.id}
                empty={<p className="p-4 text-muted">لا فواتير.</p>}
                columns={[
                  { key: "n", label: "الفاتورة", render: (r) => <Link href={`/admin/finance/${r.id}`} dir="ltr" className="tabular text-ink hover:underline">{r.number}</Link> },
                  { key: "t", label: "الإجمالي", render: (r) => fmtSAR(r.total) },
                  { key: "s", label: "الحالة", render: (r) => <Badge tone={r.status === "paid" ? "ok" : r.status === "overdue" ? "critical" : "neutral"} icon={false}>{INV_LABEL[r.status] ?? r.status}</Badge> },
                  { key: "d", label: "الإصدار", render: (r) => fmtDate(r.issuedOn), hideOnMobile: true },
                ]}
              />
            </div>
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="الحساب">
            <DefinitionList
              cols={1}
              items={[
                { label: "الحالة", value: <Badge tone={st.tone}>{st.label}</Badge> },
                { label: "الجوال", value: <span dir="ltr" className="tabular">{maskPhoneShort(u.phone)}</span> },
                { label: "البريد", value: u.email ? <span dir="ltr">{u.email}</span> : "—" },
                { label: "انضم", value: fmtDate(u.createdAt) },
                { label: "آخر دخول", value: u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "—" },
              ]}
            />
          </Panel>
          <Panel title="طلبات البيانات الشخصية">
            {d.dsrs.length ? (
              <ul className="space-y-2 text-[15px]">
                {d.dsrs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{DSR_LABEL[r.kind] ?? r.kind}</span>
                    <Badge tone={r.status === "completed" ? "ok" : r.status === "rejected" ? "neutral" : "fine"} icon={false}>{DSR_STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">لا طلبات.</p>
            )}
            {d.dsrs.some((r) => ["received", "in_progress"].includes(r.status)) && auth.perms.has("admin.notifications") ? (
              <Link href="/admin/notifications/privacy" className="mt-3 inline-block text-sm text-ink hover:underline">عالجها من قائمة طلبات البيانات</Link>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
