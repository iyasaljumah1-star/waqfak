import type { Metadata } from "next";
import { Alert, PageHeader, Panel } from "@/components/ui";
import { SettingsTabs } from "@/components/admin/section-tabs";
import { CompanyForm, LicenseForm } from "@/components/admin/forms/settings-forms";
import { requireAdmin } from "@/server/modules/admin/guard";
import { loadSettings } from "@/server/modules/admin/settings/queries";

export const metadata: Metadata = { title: "الشركة والتراخيص" };

export default async function SettingsPage() {
  const auth = await requireAdmin("admin.settings");
  const s = await loadSettings(auth);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  return (
    <div>
      <PageHeader title="الإعدادات والتراخيص" description="بيانات الشركة التي تظهر في العقود والفواتير والتقارير، والتراخيص التي تفتح الخدمات المقيدة." />
      <SettingsTabs />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="بيانات الشركة">
          <CompanyForm values={s.profile} />
        </Panel>
        <div className="space-y-6">
          {s.nazara ? (
            <Alert tone={s.nazara.licenceValid ? "ok" : "info"} title={`${s.nazara.name} (N01)`}>
              {s.nazara.availability.available ? "تُستقبل الطلبات وتُدرس. " : `استقبال الطلبات متوقف: ${s.nazara.availability.reason.replace(/\.\s*$/, "")}. `}
              {s.nazara.licenceValid
                ? "الترخيص ساري، فيمكن مباشرة النظارة على الأوقاف التي تُعتمد."
                : "مباشرة النظارة على وقف حقيقي تنتظر تفعيل ترخيص الهيئة أدناه؛ وتُجرَّب المنظومة كاملة على الأوقاف التجريبية."}
            </Alert>
          ) : null}
          <Panel title="التراخيص" description="يُفعَّل الترخيص برقمه وتاريخ انتهائه الساري، ويُسجَّل كل تعديل في سجل العمليات.">
            <div className="space-y-4">
              {s.licenses.map((l) => (
                <LicenseForm key={l.key} lic={l} today={today} />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
