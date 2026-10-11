import {
  Bell, BookOpen, Briefcase, Circle, ClipboardList, Contact, Gauge, History, KeyRound, Landmark, LayoutDashboard, ListTree, Receipt, Route,
  Scale, Settings, ShieldAlert, UsersRound, Workflow, type LucideIcon,
} from "lucide-react";

/** Icons referenced by name from ADMIN_NAV (src/config/nav.ts). Explicit map keeps the bundle small. */
const MAP: Record<string, LucideIcon> = {
  Bell, BookOpen, Briefcase, ClipboardList, Contact, Gauge, History, KeyRound, Landmark, LayoutDashboard, ListTree, Receipt, Route, Scale,
  Settings, ShieldAlert, UsersRound, Workflow,
};

export function AdminIcon({ name, className }: { name: string; className?: string }) {
  const I = MAP[name] ?? Circle;
  return <I aria-hidden className={className ?? "size-[18px] shrink-0"} />;
}
