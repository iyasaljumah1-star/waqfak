import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui";
import { NotificationsTabs } from "@/components/admin/section-tabs";
import { TemplateCard } from "@/components/admin/forms/template-form";
import { fmtDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { listTemplates } from "@/server/modules/admin/notifications/queries";

export const metadata: Metadata = { title: "قوالب الإشعارات" };

export default async function TemplatesPage() {
  const auth = await requireAdmin("admin.notifications");
  const rows = await listTemplates(auth);
  return (
    <div>
      <PageHeader title="الإشعارات والرسائل" description="نصوص الإشعارات وقنواتها، والرسائل الصادرة، وطلبات أصحاب البيانات الشخصية." />
      <NotificationsTabs />
      <Alert tone="info" className="mb-4">
        يسري التعديل على الإشعارات الجديدة فقط. يختار المستخدم إيقاف البريد أو الرسائل النصية لكل نوع من صفحة إشعاراته، عدا القوالب المقفلة.
      </Alert>
      <ul className="space-y-2">
        {rows.map((t) => (
          <TemplateCard key={t.key} t={{ key: t.key, titleAr: t.titleAr, bodyAr: t.bodyAr, severity: t.severity, channels: t.channels, locked: t.locked, updatedAt: fmtDateTime(t.updatedAt) }} />
        ))}
      </ul>
    </div>
  );
}
