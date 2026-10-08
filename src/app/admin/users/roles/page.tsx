import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import { UsersTabs } from "@/components/admin/section-tabs";
import { RoleMatrix } from "@/components/admin/role-matrix";
import { cn } from "@/lib/utils";
import { isSuperAdmin, requireAdmin } from "@/server/modules/admin/guard";
import { GLOBAL_DOMAINS, lockedCell, roleMatrix } from "@/server/modules/admin/roles/queries";

export const metadata: Metadata = { title: "الأدوار والصلاحيات" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const auth = await requireAdmin("admin.roles");
  const sp = await searchParams;
  const scope = sp.scope === "waqf" ? "waqf" : "global";
  const m = await roleMatrix(auth);
  const roles = m.roles.filter((r) => r.scope === scope);
  const perms = m.permissions.filter((p) => GLOBAL_DOMAINS.has(p.domain) === (scope === "global"));
  const locked: Record<string, string> = {};
  for (const r of roles) for (const p of perms) {
    const why = lockedCell(r.key, p.key);
    if (why) locked[`${r.key}|${p.key}`] = why;
  }
  const readOnly: Record<string, string> = {};
  if (!isSuperAdmin(auth)) {
    for (const r of roles) {
      if (r.key === "super_admin") readOnly[r.key] = "دور «مسؤول النظام الأعلى» يعدله مسؤول نظام أعلى فقط.";
    }
    // a non-super-admin cannot grant what they do not hold
    for (const r of roles) for (const p of perms) {
      const k = `${r.key}|${p.key}`;
      if (!locked[k] && !m.granted.has(k) && !auth.perms.has(p.key)) locked[k] = "لا تملك هذه الصلاحية فلا يمكنك منحها.";
    }
  }
  const tab = (s: string, label: string) => (
    <Link href={`/admin/users/roles?scope=${s}`} aria-current={scope === s ? "page" : undefined}
      className={cn("rounded-md px-3 py-1.5 text-[15px]", scope === s ? "bg-ink text-white dark:text-[#0f141c]" : "border border-line-strong bg-surface hover:bg-surface-2")}>
      {label}
    </Link>
  );

  return (
    <div>
      <PageHeader title="الأدوار والصلاحيات" crumbs={[{ href: "/admin/users", label: "المستخدمون" }, { label: "الأدوار والصلاحيات" }]}
        description="مصدر الحقيقة هو قاعدة البيانات: أي تعديل هنا يسري على كل حاملي الدور خلال ثوانٍ، دون تعديل في الشيفرة، ويُسجل في سجل العمليات." />
      <UsersTabs auth={auth} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tab("global", "أدوار فريق وقفك")}
        {tab("waqf", "أدوار الأوقاف")}
      </div>
      {scope === "waqf" ? (
        <Alert tone="warn" className="mb-4" title="تعديل أدوار الأوقاف يمس كل الأوقاف">
          تغيير صلاحية «ناظر» مثلًا يسري على كل نظار المنصة. صلاحيات الوكيل تبقى محصورة في نطاق وكالته حتى لو اتسع الدور.
        </Alert>
      ) : null}
      <RoleMatrix roles={roles.map((r) => ({ key: r.key, nameAr: r.nameAr, holders: r.holders }))} perms={perms} granted={[...m.granted]} locked={locked} readOnly={readOnly} />
      <p className="mt-3 text-[13px] text-muted">
        <Lock aria-hidden className="inline size-3.5 align-[-2px]" /> خلية مقفلة: لا تُعدّل من هنا للسبب الظاهر عند الوقوف عليها. الرقم بجانب الدور عدد حامليه من الفريق.
      </p>
    </div>
  );
}
