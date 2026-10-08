import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, Panel, Steps } from "@/components/ui";
import { UsersTabs } from "@/components/admin/section-tabs";
import { InviteStaffForm } from "@/components/admin/forms/invite-form";
import { isSuperAdmin, requireAdmin } from "@/server/modules/admin/guard";
import { globalRoleOptions } from "@/server/modules/admin/users/queries";
import { rolePermissionMap } from "@/server/authz/context";

export const metadata: Metadata = { title: "دعوة موظف" };

export default async function InvitePage() {
  const auth = await requireAdmin("admin.users");
  if (!auth.perms.has("admin.roles")) redirect("/admin?denied=1");
  const [all, map] = await Promise.all([globalRoleOptions(auth), rolePermissionMap()]);
  // Only roles the inviter could grant (no privilege escalation).
  const roles = isSuperAdmin(auth) ? all : all.filter((r) => r.key !== "super_admin" && [...(map.get(r.key) ?? [])].every((p) => auth.perms.has(p)));
  return (
    <div>
      <PageHeader title="دعوة موظف" crumbs={[{ href: "/admin/users", label: "المستخدمون" }, { label: "دعوة موظف" }]} description="ينشئ حساب موظف بدور محدد ويرسل له رسالة نصية بخطوات الدخول." />
      <UsersTabs auth={auth} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="بيانات الموظف">
          <InviteStaffForm roles={roles} />
        </Panel>
        <Panel title="ما يحدث بعد الدعوة">
          <Steps
            steps={[
              { label: "يصله إشعار نصي برابط الدخول", status: "done" },
              { label: "يدخل برقم جواله ورمز لمرة واحدة", status: "active" },
              { label: "تلزمه المنصة بتسجيل تطبيق المصادقة", status: "pending", meta: "لا تُفتح لوحة الإدارة قبل ذلك." },
              { label: "تظهر له أقسام دوره فقط", status: "pending" },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
