import {
  Bell, Briefcase, Building2, CalendarClock, ClipboardList, FileBarChart, Fingerprint, FolderLock, Gauge, Gavel, HeartHandshake,
  History, IdCard, Landmark, LayoutDashboard, ListChecks, MessagesSquare, Receipt, ScrollText, Settings, ShieldCheck, Sparkles,
  Sprout, TriangleAlert, UserRound, Users, Wallet, Circle, type LucideIcon,
} from "lucide-react";

/** Icons referenced by name from src/config/nav.ts (kept explicit so bundles stay small). */
const MAP: Record<string, LucideIcon> = {
  Bell, Briefcase, Building2, CalendarClock, ClipboardList, FileBarChart, Fingerprint, FolderLock, Gauge, Gavel, HeartHandshake,
  History, IdCard, Landmark, LayoutDashboard, ListChecks, MessagesSquare, Receipt, ScrollText, Settings, ShieldCheck, Sparkles,
  Sprout, TriangleAlert, UserRound, Users, Wallet,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const I = MAP[name] ?? Circle;
  return <I aria-hidden className={className ?? "size-[18px] shrink-0"} />;
}
