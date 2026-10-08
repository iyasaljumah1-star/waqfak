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
  const nazaraFlag = s.flags.find((f) => f.key === "service.nazara");
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
            <Alert tone={s.nazara.availability.available ? "ok" : "info"} title={`خدمة ${s.nazara.name} (N01): ${s.nazara.availability.available ? "متاحة للعملاء" : "غير متاحة"}`}>
              {s.nazara.availability.available
                ? "الترخيص مفعّل والخاصية مفعّلة."
                : `السبب: ${s.nazara.availability.reason}. تُتاح عند تفعيل ترخيص النظارة برقم ساري وتفعيل خاصية service.nazara.`}
            </Alert>
          ) : null}
          <Panel title="التراخيص" description="لا يُفعّل ترخيص بلا رقم وتاريخ انتهاء ساري. كل تعديل يُسجل في سجل العمليات.">
            <div className="space-y-4">
              {s.licenses.map((l) => (
                <LicenseForm key={l.key} lic={l} today={today} nazaraFlagOn={nazaraFlag?.enabled} />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
