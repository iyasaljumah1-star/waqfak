import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus, UsersRound } from "lucide-react";
import { Badge, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { UsersTabs } from "@/components/admin/section-tabs";
import { USER_STATUS } from "@/components/admin/labels";
import { fmtDateTime } from "@/lib/utils";
import { roleName } from "@/server/authz/catalog";
import { maskPhoneShort, requireAdmin } from "@/server/modules/admin/guard";
import { globalRoleOptions, listUsers } from "@/server/modules/admin/users/queries";

export const metadata: Metadata = { title: "المستخدمون" };

const inputCls = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; status?: string; role?: string }> }) {
  const auth = await requireAdmin("admin.users");
  const sp = await searchParams;
  const kind = sp.kind === "clients" || sp.kind === "all" ? sp.kind : "staff";
  const [rows, roles] = await Promise.all([listUsers(auth, { q: sp.q, kind, status: sp.status, role: sp.role }), globalRoleOptions(auth)]);
  const canInvite = auth.perms.has("admin.roles");

  return (
    <div>
      <PageHeader
        title="المستخدمون والأدوار"
        description="حسابات الفريق والعملاء: الأدوار والحالة والتحقق بخطوتين والجلسات. كل إجراء يُسجّل في سجل العمليات."
        actions={canInvite ? <ActionLink href="/admin/users/invite"><UserPlus aria-hidden className="size-4" />دعوة موظف</ActionLink> : undefined}
      />
      <UsersTabs auth={auth} />
      <form role="search" className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <label className="sr-only" htmlFor="q">بحث</label>
        <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="الاسم أو البريد أو آخر أرقام الجوال" className={inputCls} />
        <label className="sr-only" htmlFor="kind">النوع</label>
        <select id="kind" name="kind" defaultValue={kind} className={inputCls}>
          <option value="staff">فريق وقفك</option>
          <option value="clients">العملاء</option>
          <option value="all">الكل</option>
        </select>
        <label className="sr-only" htmlFor="status">الحالة</label>
        <select id="status" name="status" defaultValue={sp.status ?? ""} className={inputCls}>
          <option value="">كل الحالات</option>
          {Object.entries(USER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="role">الدور</label>
        <select id="role" name="role" defaultValue={sp.role ?? ""} className={inputCls}>
          <option value="">كل الأدوار</option>
          {roles.map((r) => <option key={r.key} value={r.key}>{r.nameAr}</option>)}
        </select>
        <button className="h-10 rounded-md border border-line-strong bg-surface px-4 text-[15px] hover:bg-surface-2">عرض</button>
      </form>
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            caption="قائمة المستخدمين"
            empty={<div className="p-4"><EmptyState icon={UsersRound} title="لا نتائج">غيّر عبارة البحث أو المرشحات.</EmptyState></div>}
            columns={[
              { key: "n", label: "الاسم", render: (r) => <Link href={`/admin/users/${r.id}`} className="font-medium text-ink hover:underline">{r.fullName || "بلا اسم"}</Link> },
              { key: "c", label: "التواصل", render: (r) => <span className="text-[14px]"><span dir="ltr" className="tabular block text-end md:text-start">{maskPhoneShort(r.phone)}</span>{r.email ? <span dir="ltr" className="block truncate text-muted">{r.email}</span> : null}</span>, hideOnMobile: true },
              { key: "r", label: "الأدوار", render: (r) => r.roles.length ? <span className="flex flex-wrap gap-1">{r.roles.map((k) => <Badge key={k} tone={k === "super_admin" ? "seal" : "ink"} icon={false}>{roleName(k)}</Badge>)}</span> : <span className="text-muted">{r.isStaff ? "بلا دور" : "عميل"}</span> },
              { key: "s", label: "الحالة", render: (r) => (
                <span className="flex flex-wrap gap-1">
                  <Badge tone={USER_STATUS[r.status]?.tone ?? "neutral"}>{USER_STATUS[r.status]?.label ?? r.status}</Badge>
                  {r.isStaff && !r.mfaEnabled ? <Badge tone="warn">بلا تحقق بخطوتين</Badge> : null}
                </span>
              ) },
              { key: "l", label: "آخر دخول", render: (r) => <span className="text-[14px] text-muted">{r.lastLoginAt ? fmtDateTime(r.lastLoginAt) : "لم يدخل بعد"}</span>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
      {rows.length === 200 ? <p className="mt-2 text-sm text-muted">تُعرض أول 200 نتيجة؛ ضيّق البحث لرؤية غيرها.</p> : null}
    </div>
  );
}
