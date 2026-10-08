import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { SettingsTabs } from "@/components/admin/section-tabs";
import { FlagRow } from "@/components/admin/forms/settings-forms";
import { fmtDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { loadSettings } from "@/server/modules/admin/settings/queries";

export const metadata: Metadata = { title: "الخصائص" };

export default async function FlagsPage() {
  const auth = await requireAdmin("admin.settings");
  const s = await loadSettings(auth);
  return (
    <div>
      <PageHeader title="الإعدادات والتراخيص" description="خصائص تُشغَّل أو تُوقف دون نشر جديد. يُطلب سبب لكل تغيير ويُحفظ مع الخاصية وفي سجل العمليات." />
      <SettingsTabs />
      <Panel title="الخصائص">
        <ul className="divide-y divide-line">
          {s.flags.map((f) => (
            <FlagRow key={f.key} flag={{ key: f.key, enabled: f.enabled, description: f.description, reason: f.reason, updatedAt: fmtDateTime(f.updatedAt), updatedBy: f.updatedBy ? s.names.get(f.updatedBy) ?? null : null }} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}
