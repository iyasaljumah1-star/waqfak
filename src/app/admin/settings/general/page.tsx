import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { SettingsTabs } from "@/components/admin/section-tabs";
import { GeneralForm, RetentionForm } from "@/components/admin/forms/settings-forms";
import { requireAdmin } from "@/server/modules/admin/guard";
import { loadSettings } from "@/server/modules/admin/settings/queries";

export const metadata: Metadata = { title: "الإعدادات العامة" };

export default async function GeneralSettingsPage() {
  const auth = await requireAdmin("admin.settings");
  const s = await loadSettings(auth);
  return (
    <div>
      <PageHeader title="الإعدادات والتراخيص" description="القيم الافتراضية للتشغيل وسياسة الاحتفاظ بالبيانات وفق نظام حماية البيانات الشخصية." />
      <SettingsTabs />
      <div className="space-y-6">
        <Panel title="الإعدادات العامة">
          <GeneralForm values={s.general} />
        </Panel>
        <Panel title="الاحتفاظ بالبيانات" description="لا يُحتفظ بالبيانات الشخصية أطول من حاجة الغرض. سجلات الأوقاف النظامية وسجل العمليات خارج نطاق الحذف الآلي.">
          <RetentionForm values={s.retention} />
        </Panel>
      </div>
    </div>
  );
}
