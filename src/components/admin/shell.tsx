"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/server/modules/auth.actions";
import { AdminIcon } from "./icons";

export type AdminNavItem = { href: string; label: string; icon: string };

/** Sections of the admin menu. Items not listed here (added later by other teams) fall under «أخرى». */
const GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "التشغيل", hrefs: ["/admin", "/admin/requests", "/admin/continuous", "/admin/waqfs", "/admin/clients", "/admin/assessments", "/admin/finance"] },
  { label: "الكتالوج والقواعد", hrefs: ["/admin/services", "/admin/question-bank", "/admin/rules", "/admin/compliance", "/admin/traceability", "/admin/content"] },
  { label: "الحوكمة والأمن", hrefs: ["/admin/users", "/admin/notifications", "/admin/mlro", "/admin/audit", "/admin/settings"] },
];

export function isAdminActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function grouped(items: AdminNavItem[]) {
  const known = new Set(GROUPS.flatMap((g) => g.hrefs));
  const out = GROUPS.map((g) => ({ label: g.label, items: g.hrefs.map((h) => items.find((i) => i.href === h)).filter(Boolean) as AdminNavItem[] }));
  const rest = items.filter((i) => !known.has(i.href));
  if (rest.length) out.push({ label: "أخرى", items: rest });
  return out.filter((g) => g.items.length);
}

function NavList({ items, pathname, large }: { items: AdminNavItem[]; pathname: string; large?: boolean }) {
  return (
    <div className="space-y-5">
      {grouped(items).map((g) => (
        <div key={g.label}>
          <p className="mb-1 px-3 text-[12px] font-medium text-muted">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = isAdminActive(pathname, it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-md px-3 text-[15px] transition-colors",
                      large ? "py-3" : "py-2",
                      active ? "bg-surface font-semibold text-ink shadow-card" : "text-muted hover:bg-surface/70 hover:text-text",
                    )}
                  >
                    {active ? <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-ink" /> : null}
                    <AdminIcon name={it.icon} />
                    <span className="truncate">{it.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Desktop side navigation (start side; right in RTL). */
export function AdminSideNav({ items, userName, roles }: { items: AdminNavItem[]; userName: string; roles: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="قائمة الإدارة" className="flex h-full flex-col gap-6 px-3 py-6">
      <NavList items={items} pathname={pathname} />
      <div className="mt-auto border-t border-line px-3 pt-4">
        <p className="truncate text-[15px] font-medium">{userName}</p>
        <p className="truncate text-[13px] text-muted">{roles}</p>
        <form action={logout}>
          <button type="submit" className="mt-2 inline-flex items-center gap-2 text-sm text-muted hover:text-critical">
            <LogOut aria-hidden className="size-4" />
            تسجيل الخروج
          </button>
        </form>
      </div>
    </nav>
  );
}

/** Mobile/tablet: menu button in the top bar opening a full-height drawer. */
export function AdminMobileNav({ items, userName, roles }: { items: AdminNavItem[]; userName: string; roles: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  const current = items.find((i) => isAdminActive(pathname, i.href));
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="فتح قائمة الإدارة"
        className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-white hover:bg-white/10 lg:hidden"
      >
        <Menu aria-hidden className="size-5" />
        <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{current?.label ?? "القائمة"}</span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button type="button" aria-label="إغلاق" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="fade-in absolute inset-y-0 start-0 flex w-[min(20rem,88vw)] flex-col overflow-y-auto bg-stone px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 id={titleId} className="font-semibold text-ink">لوحة الإدارة</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق القائمة" className="inline-flex size-10 items-center justify-center rounded-md hover:bg-surface">
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <nav aria-label="قائمة الإدارة">
              <NavList items={items} pathname={pathname} large />
            </nav>
            <div className="mt-6 border-t border-line px-3 pt-4">
              <p className="truncate font-medium">{userName}</p>
              <p className="truncate text-[13px] text-muted">{roles}</p>
              <Link href="/app" className="mt-3 block text-[15px] text-ink underline-offset-4 hover:underline">الانتقال إلى بوابتي</Link>
              <form action={logout} className="mt-3">
                <button type="submit" className="inline-flex items-center gap-2 text-[15px] text-critical">
                  <LogOut aria-hidden className="size-4" />
                  تسجيل الخروج
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Horizontal sub-navigation for sections with several pages (settings, notifications, users). */
export function AdminTabs({ tabs, label }: { tabs: { href: string; label: string; count?: number }[]; label: string }) {
  const pathname = usePathname();
  // the longest matching href wins so "/admin/settings" is not active on "/admin/settings/flags"
  const active = tabs.filter((t) => pathname === t.href || pathname.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={label} className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? "page" : undefined}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[15px]",
            t.href === active ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t.label}
          {t.count ? <span className="tabular rounded-full bg-critical px-1.5 text-[12px] font-semibold leading-5 text-white">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
