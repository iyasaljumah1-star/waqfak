import type { Auth } from "@/server/authz/context";
import { AdminTabs } from "./shell";

/** Sub-navigation of «المستخدمون والأدوار», filtered by the viewer's permissions. */
export function UsersTabs({ auth, pending }: { auth: Auth; pending?: number }) {
  const tabs = [
    auth.perms.has("admin.users") ? { href: "/admin/users", label: "المستخدمون" } : null,
    auth.perms.has("admin.roles") ? { href: "/admin/users/roles", label: "الأدوار والصلاحيات" } : null,
    { href: "/admin/users/break-glass", label: "الوصول الطارئ", count: pending },
    auth.perms.has("admin.users") && auth.perms.has("admin.roles") ? { href: "/admin/users/invite", label: "دعوة موظف" } : null,
  ].filter(Boolean) as { href: string; label: string; count?: number }[];
  return <AdminTabs label="أقسام المستخدمين" tabs={tabs} />;
}

export function SettingsTabs() {
  return (
    <AdminTabs
      label="أقسام الإعدادات"
      tabs={[
        { href: "/admin/settings", label: "الشركة والتراخيص" },
        { href: "/admin/settings/flags", label: "الخصائص" },
        { href: "/admin/settings/general", label: "الإعدادات العامة والاحتفاظ" },
      ]}
    />
  );
}

export function NotificationsTabs({ openDsr }: { openDsr?: number }) {
  return (
    <AdminTabs
      label="أقسام الإشعارات"
      tabs={[
        { href: "/admin/notifications", label: "قوالب الإشعارات" },
        { href: "/admin/notifications/outbox", label: "الرسائل الصادرة" },
        { href: "/admin/notifications/privacy", label: "طلبات البيانات الشخصية", count: openDsr },
      ]}
    />
  );
}

export function ClientsTabs({ newMessages }: { newMessages?: number }) {
  return (
    <AdminTabs
      label="أقسام العملاء"
      tabs={[
        { href: "/admin/clients", label: "العملاء" },
        { href: "/admin/clients/messages", label: "رسائل التواصل", count: newMessages },
      ]}
    />
  );
}
