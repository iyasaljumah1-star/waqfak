"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { NavIcon } from "./icons";

export type WaqfSection = { href: string; label: string; icon: string };

function useActive(base: string) {
  const pathname = usePathname();
  return (href: string) =>
    href === base
      ? pathname === base
      : pathname === href || pathname.startsWith(`${href}/`);
}

/** Waqf file sections: horizontal scrolling tabs below xl, a quiet side list from xl up. */
export function WaqfSectionNav({
  base,
  sections,
  variant,
}: {
  base: string;
  sections: WaqfSection[];
  variant: "tabs" | "list";
}) {
  const isActive = useActive(base);
  const tabsRef = useRef<HTMLUListElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>("[aria-current=page]")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  if (variant === "tabs")
    return (
      <nav
        aria-label="أقسام ملف الوقف"
        className="-mx-4 mb-6 border-b border-line md:-mx-8 xl:hidden"
      >
        <ul
          ref={tabsRef}
          className="flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:px-8"
        >
          {sections.map((s) => {
            const active = isActive(s.href);
            return (
              <li key={s.href} className="shrink-0">
                <Link
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-[15px]",
                    active
                      ? "border-ink font-semibold text-ink"
                      : "border-transparent text-muted hover:text-text",
                  )}
                >
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  return (
    <nav aria-label="أقسام ملف الوقف" className="hidden xl:block">
      <ul className="space-y-0.5">
        {sections.map((s) => {
          const active = isActive(s.href);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[15px]",
                  active
                    ? "bg-surface font-semibold text-ink shadow-card"
                    : "text-muted hover:text-text",
                )}
              >
                <NavIcon name={s.icon} className="size-4 shrink-0" />
                <span className="truncate">{s.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
