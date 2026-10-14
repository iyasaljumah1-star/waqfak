import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Seal } from "@/components/brand";
import { AdminMobileNav, AdminSideNav, type AdminNavItem } from "@/components/admin/shell";
import { UserMenu } from "@/components/portal/shell";
import { ADMIN_NAV } from "@/config/nav";
import { maskPhone } from "@/server/auth/otp";
import { requireStaff } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { env } from "@/server/env";
import { activeBreakGlassCount } from "@/server/modules/admin/dashboard";

export const metadata: Metadata = { title: { default: "لوحة الإدارة", template: "%s | إدارة وقفك" }, robots: { index: false, follow: false } };

/** Nav items whose page accepts an alternative permission. */
const ALT_PERMS: Record<string, string[]> = { "/admin/requests": ["admin.requests.all"], "/admin/continuous": ["admin.requests.all"] };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireStaff("admin.access");
  const items: AdminNavItem[] = ADMIN_NAV.filter((n) => !n.perm || auth.perms.has(n.perm) || (ALT_PERMS[n.href] ?? []).some((p) => auth.perms.has(p))).map((n) => ({
    href: n.href, label: n.label, icon: n.icon,
  }));
  const name = auth.user.fullName || "موظف وقفك";
  const roles = auth.globalRoles.map(roleName).join("، ") || "بلا دور";
  const demo = env.DEMO_SHOW_OTP === "true";
  const breakGlass = await activeBreakGlassCount(auth);

  return (
    <div className="min-h-dvh bg-stone">
      <header className="no-print sticky top-0 z-30 bg-ink text-white dark:bg-[#0f1623]">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 md:gap-3 md:px-6">
          <AdminMobileNav items={items} userName={name} roles={roles} />
          <Link href="/admin" className="flex shrink-0 items-center gap-2 text-white" aria-label="لوحة الإدارة — الرئيسية">
            <Seal className="size-7 [--mark-cut:var(--ink)] dark:[--mark-cut:#0f1623]" />
            <span className="text-[20px] font-bold leading-none">وقفك</span>
            <span className="hidden text-[13px] text-white/75 sm:inline">| لوحة الإدارة</span>
          </Link>
          {demo ? (
            <span className="rounded-full bg-seal px-2.5 py-0.5 text-[12px] font-semibold text-white" title="بيانات ورموز تحقق تجريبية؛ لا تُدخل بيانات حقيقية">
              بيئة تجريبية
            </span>
          ) : null}
          <div className="ms-auto flex items-center gap-1 md:gap-3">
            <Link href="/app" className="hidden rounded-md px-2.5 py-1.5 text-sm text-white/90 hover:bg-white/10 hover:text-white md:inline-block">
              بوابتي
            </Link>
            <UserMenu name={name} phone={maskPhone(auth.user.phone)} />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="no-print sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 overflow-y-auto border-e border-line lg:block">
          <AdminSideNav items={items} userName={name} roles={roles} />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 pb-16 pt-6 md:px-8 lg:pt-8">
          {breakGlass ? (
            <Link
              href="/admin/users/break-glass"
              className="mb-6 flex items-center gap-3 rounded-lg border border-critical/30 bg-critical-soft px-4 py-3 text-[15px] text-critical hover:underline"
            >
              <ShieldAlert aria-hidden className="size-5 shrink-0" />
              <span>
                <strong>وصول طارئ نشط: {breakGlass}</strong> — راجع من يحمل وصولًا استثنائيًا إلى ملفات أوقاف ومتى ينتهي.
              </span>
            </Link>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
