"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Menu, UserRound, X } from "lucide-react";
import { Logo } from "@/components/brand";
import { buttonClass } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AUDIENCE_LINKS } from "./labels";


const MAIN = [
  { href: "/services", label: "الخدمات" },
  { href: "/packages", label: "الباقات" },
  { href: "/for", label: "لمن نخدم", children: AUDIENCE_LINKS },
  { href: "/library", label: "المكتبة" },
  { href: "/tools", label: "الأدوات" },
  { href: "/about", label: "عن وقفك" },
];

const active = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function SiteNav({ account }: { account: { href: string; label: string } | null }) {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [drop, setDrop] = useState(false);
  const dropRef = useRef<HTMLLIElement>(null);
  const menuId = useId();
  const dropId = useId();

  // Close menus when the route changes (state reset during render, no effect needed).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenu(false);
    setDrop(false);
  }

  useEffect(() => {
    if (!drop && !menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrop(false);
        setMenu(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (drop && dropRef.current && !dropRef.current.contains(e.target as Node)) setDrop(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [drop, menu]);

  useEffect(() => {
    document.documentElement.style.overflow = menu ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [menu]);

  return (
    <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:h-[72px] md:px-6">
      <Logo />

      <nav aria-label="القائمة الرئيسية" className="ms-6 hidden lg:block">
        <ul className="flex items-center gap-1">
          {MAIN.map((it) =>
            it.children ? (
              <li key={it.href} ref={dropRef} className="relative">
                <button
                  type="button"
                  aria-expanded={drop}
                  aria-controls={dropId}
                  onClick={() => setDrop((v) => !v)}
                  className={cn(
                    "inline-flex h-10 items-center gap-1 rounded-md px-3 text-[15px] font-medium text-text/85 hover:bg-surface-2 hover:text-ink",
                    active(pathname, "/for") && "text-ink",
                  )}
                >
                  {it.label}
                  <ChevronDown aria-hidden className={cn("size-4 transition-transform", drop && "rotate-180")} />
                </button>
                <div
                  id={dropId}
                  hidden={!drop}
                  className="absolute start-0 top-full z-40 mt-2 w-80 rounded-lg border border-line bg-surface p-2 shadow-card"
                >
                  <ul>
                    {it.children.map((c) => (
                      <li key={c.href}>
                        <Link href={c.href} className="block rounded-md px-3 py-2.5 hover:bg-surface-2" aria-current={pathname === c.href ? "page" : undefined}>
                          <span className="block font-medium text-ink">{c.label}</span>
                          <span className="block text-[13.5px] leading-6 text-muted">{c.hint}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ) : (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={active(pathname, it.href) ? "page" : undefined}
                  className="relative inline-flex h-10 items-center rounded-md px-3 text-[15px] font-medium text-text/85 hover:bg-surface-2 hover:text-ink aria-[current=page]:text-ink aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:-bottom-[15px] aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-ink"
                >
                  {it.label}
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>

      <div className="ms-auto flex items-center gap-2">
        <Link href="/assessment" className={buttonClass("primary", "md", "max-[389px]:hidden")}>
          قيّم وقفك مجانًا
        </Link>
        {account ? (
          <Link href={account.href} className={buttonClass("secondary", "md", "gap-1.5 max-lg:hidden")}>
            <UserRound aria-hidden className="size-4" />
            {account.label}
          </Link>
        ) : (
          <Link href="/login" className={buttonClass("ghost", "md", "max-lg:hidden")}>
            دخول
          </Link>
        )}
        <button
          type="button"
          className="grid size-11 place-items-center rounded-md text-ink hover:bg-surface-2 lg:hidden"
          aria-expanded={menu}
          aria-controls={menuId}
          onClick={() => setMenu((v) => !v)}
        >
          {menu ? <X aria-hidden className="size-6" /> : <Menu aria-hidden className="size-6" />}
          <span className="sr-only">{menu ? "أغلق القائمة" : "افتح القائمة"}</span>
        </button>
      </div>

      {/* Mobile menu: a sheet under the header */}
      <div
        id={menuId}
        hidden={!menu}
        className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto border-t border-line bg-surface lg:hidden"
      >
        <nav aria-label="القائمة الرئيسية للجوال" className="px-4 pb-10 pt-4">
          <ul className="divide-y divide-line">
            {MAIN.filter((m) => !m.children).map((it) => (
              <li key={it.href}>
                <Link href={it.href} aria-current={active(pathname, it.href) ? "page" : undefined} className="flex h-13 items-center py-3 text-[17px] font-medium aria-[current=page]:text-ink">
                  {it.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[13px] font-medium text-muted">لمن نخدم</p>
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {AUDIENCE_LINKS.map((c) => (
              <li key={c.href}>
                <Link href={c.href} className="block rounded-md border border-line px-3 py-2.5 font-medium text-ink">
                  {c.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-8 grid gap-2">
            <Link href="/assessment" className={buttonClass("primary", "lg")}>قيّم وقفك مجانًا</Link>
            {account ? (
              <Link href={account.href} className={buttonClass("secondary", "lg")}>{account.label}</Link>
            ) : (
              <Link href="/login" className={buttonClass("secondary", "lg")}>دخول</Link>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
