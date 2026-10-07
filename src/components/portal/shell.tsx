"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bell, Check, ChevronDown, Ellipsis, Landmark, LogOut, Plus, ShieldAlert, UserRound, X } from "lucide-react";
import { Alert } from "@/components/ui";
import { cn } from "@/lib/utils";
import { logout } from "@/server/modules/auth.actions";
import { NavIcon } from "./icons";

export type ShellNavItem = { href: string; label: string; icon: string; mobile?: boolean };
export type ShellWaqf = { id: string; name: string; number: string; href: string; roles: string };

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Closes a popover on outside click, Escape and route change. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

// ───────────── Desktop side navigation (right side in RTL) ─────────────
export function SideNav({ portal, account, isStaff, userName }: { portal: ShellNavItem[]; account: ShellNavItem[]; isStaff: boolean; userName: string }) {
  const pathname = usePathname();
  const item = (it: ShellNavItem) => {
    const active = isActive(pathname, it.href);
    return (
      <li key={it.href}>
        <Link
          href={it.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-3 rounded-md px-3 py-2 text-[15px] transition-colors",
            active ? "bg-surface font-semibold text-ink shadow-card" : "text-muted hover:bg-surface/70 hover:text-text",
          )}
        >
          {active ? <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-ink" /> : null}
          <NavIcon name={it.icon} />
          <span className="truncate">{it.label}</span>
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label="القائمة الرئيسية" className="flex h-full flex-col gap-6 px-3 py-6">
      <ul className="space-y-0.5">{portal.map(item)}</ul>
      <div>
        <p className="mb-1 px-3 text-[13px] font-medium text-muted">حسابي</p>
        <ul className="space-y-0.5">{account.map(item)}</ul>
      </div>
      {isStaff ? (
        <Link href="/admin" className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-[15px] text-ink hover:bg-surface">
          <ShieldAlert aria-hidden className="size-[18px]" />
          لوحة الإدارة
        </Link>
      ) : null}
      <div className="mt-auto border-t border-line px-3 pt-4">
        <p className="truncate text-[15px] font-medium">{userName}</p>
        <form action={logout}>
          <button type="submit" className="mt-1 inline-flex items-center gap-2 text-sm text-muted hover:text-critical">
            <LogOut aria-hidden className="size-4" />
            تسجيل الخروج
          </button>
        </form>
      </div>
    </nav>
  );
}

// ───────────── Waqf switcher (top bar) ─────────────
export function WaqfSwitcher({ waqfs }: { waqfs: ShellWaqf[] }) {
  const { open, setOpen, ref } = usePopover();
  const pathname = usePathname();
  const menuId = useId();
  const current = waqfs.find((w) => pathname.startsWith(`/app/w/${w.id}`) || pathname.startsWith(`/app/b/${w.id}`));
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
        className="flex h-9 min-w-0 max-w-[13rem] items-center gap-2 rounded-md border border-line px-2.5 text-sm hover:bg-surface-2 sm:max-w-[18rem]"
      >
        <Landmark aria-hidden className="size-4 shrink-0 text-ink" />
        <span className="truncate">{current ? current.name : "أوقافي"}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
      </button>
      {open ? (
        <div id={menuId} className="fade-in absolute start-0 top-11 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-2 shadow-card">
          {waqfs.length ? (
            <ul className="max-h-80 overflow-y-auto">
              {waqfs.map((w) => (
                <li key={w.id}>
                  <Link href={w.href} className="flex items-start gap-2 rounded-md px-3 py-2 hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{w.name}</span>
                      <span className="block text-[13px] text-muted">
                        <span dir="ltr" className="tabular">{w.number}</span> · {w.roles}
                      </span>
                    </span>
                    {current?.id === w.id ? <Check aria-label="الوقف الحالي" className="mt-1 size-4 text-ink" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-muted">لا يرتبط حسابك بأي وقف بعد.</p>
          )}
          <div className="mt-1 border-t border-line pt-1">
            <Link href="/app/waqfs" className="block rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-2">كل أوقافي</Link>
            <Link href="/app/waqfs/new" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-2">
              <Plus aria-hidden className="size-4" />
              سجّل وقفًا قائمًا
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ───────────── Notifications bell ─────────────
export function BellLink({ unread }: { unread: number }) {
  const label = unread ? `الإشعارات، ${unread} غير مقروءة` : "الإشعارات";
  return (
    <Link href="/app/notifications" aria-label={label} className="relative inline-flex size-9 items-center justify-center rounded-md text-ink hover:bg-surface-2">
      <Bell aria-hidden className="size-5" />
      {unread ? (
        <span className="tabular absolute -top-0.5 -end-0.5 min-w-5 rounded-full bg-critical px-1 text-center text-[11px] font-semibold leading-5 text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

// ───────────── User menu ─────────────
export function UserMenu({ name, phone }: { name: string; phone: string }) {
  const { open, setOpen, ref } = usePopover();
  const menuId = useId();
  const initial = name.trim().charAt(0) || "؟";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="قائمة الحساب"
        onClick={() => setOpen(!open)}
        className="inline-flex size-9 items-center justify-center rounded-full bg-ink-soft font-semibold text-ink hover:ring-2 hover:ring-ink/20"
      >
        {initial}
      </button>
      {open ? (
        <div id={menuId} className="fade-in absolute end-0 top-11 z-40 w-64 rounded-lg border border-line bg-surface p-2 shadow-card">
          <div className="border-b border-line px-3 pb-2 pt-1">
            <p className="truncate font-medium">{name}</p>
            <p dir="ltr" className="tabular text-end text-[13px] text-muted">{phone}</p>
          </div>
          <ul className="py-1">
            <li><Link href="/app/profile" className="block rounded-md px-3 py-2 text-[15px] hover:bg-surface-2">ملفي الشخصي</Link></li>
            <li><Link href="/app/security" className="block rounded-md px-3 py-2 text-[15px] hover:bg-surface-2">الأمان والجلسات</Link></li>
            <li><Link href="/app/privacy" className="block rounded-md px-3 py-2 text-[15px] hover:bg-surface-2">خصوصيتي وبياناتي</Link></li>
          </ul>
          <form action={logout} className="border-t border-line pt-1">
            <button type="submit" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[15px] text-critical hover:bg-critical-soft">
              <LogOut aria-hidden className="size-4" />
              تسجيل الخروج
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

// ───────────── Mobile bottom tab bar + "more" sheet ─────────────
export function MobileTabs({ tabs, rest, account, isStaff }: { tabs: ShellNavItem[]; rest: ShellNavItem[]; account: ShellNavItem[]; isStaff: boolean }) {
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
  const moreActive = [...rest, ...account].some((i) => isActive(pathname, i.href));
  const tabClass = (active: boolean) =>
    cn("flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[12px]", active ? "font-semibold text-ink" : "text-muted");
  return (
    <>
      <nav aria-label="التنقل السريع" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="flex">
          {tabs.map((t) => {
            const active = isActive(pathname, t.href);
            return (
              <li key={t.href} className="flex min-w-0 flex-1">
                <Link href={t.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                  <NavIcon name={t.icon} className="size-5" />
                  <span className="truncate">{t.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={tabClass(moreActive)}>
              <Ellipsis aria-hidden className="size-5" />
              <span>المزيد</span>
            </button>
          </li>
        </ul>
      </nav>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button type="button" aria-label="إغلاق" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="fade-in absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-xl bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 id={titleId} className="font-semibold">المزيد</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق القائمة" className="inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-2">
                <X aria-hidden className="size-5" />
              </button>
            </div>
            <SheetList items={rest} pathname={pathname} />
            <p className="mb-1 mt-4 text-[13px] font-medium text-muted">حسابي</p>
            <SheetList items={account} pathname={pathname} />
            {isStaff ? (
              <Link href="/admin" className="mt-4 flex items-center gap-3 rounded-md border border-line px-3 py-3 text-ink">
                <ShieldAlert aria-hidden className="size-5" />
                لوحة الإدارة
              </Link>
            ) : null}
            <form action={logout} className="mt-4 border-t border-line pt-3">
              <button type="submit" className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-critical">
                <LogOut aria-hidden className="size-5" />
                تسجيل الخروج
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SheetList({ items, pathname }: { items: ShellNavItem[]; pathname: string }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {items.map((i) => {
        const active = isActive(pathname, i.href);
        return (
          <li key={i.href}>
            <Link href={i.href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 px-3 py-3 text-[15px]", active ? "font-semibold text-ink" : "")}>
              <NavIcon name={i.icon} className="size-5 text-muted" />
              {i.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Mobile-only account footer (the desktop side nav carries the same). */
export function MobileAccountFooter({ name }: { name: string }) {
  return (
    <div className="mt-12 flex items-center justify-between gap-3 border-t border-line pt-4 text-sm text-muted lg:hidden">
      <span className="flex min-w-0 items-center gap-2">
        <UserRound aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
      <form action={logout}>
        <button type="submit" className="inline-flex items-center gap-1.5 hover:text-critical">
          <LogOut aria-hidden className="size-4" />
          تسجيل الخروج
        </button>
      </form>
    </div>
  );
}

// ───────────── Calm notices for ?denied=1 / ?notfound=1 ─────────────
export function AccessNotice() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const denied = sp.get("denied") === "1";
  const notfound = sp.get("notfound") === "1";
  const welcome = sp.get("welcome") === "1";
  if (!denied && !notfound && !welcome) return null;
  const dismiss = () => {
    const next = new URLSearchParams(sp);
    next.delete("denied");
    next.delete("notfound");
    next.delete("welcome");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const action = (
    <button type="button" onClick={dismiss} className="text-sm underline-offset-4 hover:underline">
      إخفاء
    </button>
  );
  if (welcome)
    return (
      <Alert tone="ok" title="أُنشئ حسابك" className="mb-6" action={action}>
        ابدأ من أحد المسارات أدناه. يمكنك العودة إلى هذه الصفحة في أي وقت من «الرئيسية».
      </Alert>
    );
  return (
    <Alert tone="info" title={denied ? "هذه الصفحة خارج صلاحياتك" : "لم نجد ما طلبته"} className="mb-6" action={action}>
      {denied
        ? "دورك في هذا الوقف لا يتيح فتح تلك الصفحة، فأعدناك إلى أقرب صفحة متاحة لك. إن كنت تحتاجها فاطلب من ناظر الوقف تعديل دورك."
        : "الرابط لا يقابل وقفًا مرتبطًا بحسابك، أو أن صلاحيتك عليه انتهت. اختر وقفًا من «أوقافي»."}
    </Alert>
  );
}

/** Rendered by the shell when there is no verified session: sends the visitor to log in and back. */
export function SignedOutGate({ children, mfaPending }: { children: ReactNode; mfaPending: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const publicPage = pathname.startsWith("/app/invitations/");
  useEffect(() => {
    if (publicPage) return;
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    router.replace(mfaPending ? `/login/mfa?next=${next}` : `/login?next=${next}`);
  }, [publicPage, mfaPending, router]);
  if (publicPage) return <>{children}</>;
  return (
    <p role="status" className="p-10 text-center text-muted">
      جارٍ تحويلك إلى صفحة الدخول…
    </p>
  );
}
