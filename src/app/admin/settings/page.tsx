import type { Metadata } from "next";
import { Alert, PageHeader, Panel } from "@/components/ui";
import { SettingsTabs } from "@/components/admin/section-tabs";
import { CompanyForm, LicenseForm } from "@/components/admin/forms/settings-forms";
import { requireAdmin } from "@/server/modules/admin/guard";
import { loadSettings } from "@/server/modules/admin/settings/queries";
import { ActionForm } from "@/components/requests/forms";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { saveSeparationPolicy } from "@/server/modules/admin/settings/actions";
import { separationFor } from "@/server/modules/approvals/policy";
import { SEPARATION_AR, SEPARATION_KEYS } from "@/server/authz/separation";

export const metadata: Metadata = { title: "الشركة والتراخيص" };

export default async function SettingsPage() {
  const auth = await requireAdmin("admin.settings");
  const s = await loadSettings(auth);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const separation = await separationFor(auth);
  const canEditSeparation = auth.perms.has("admin.roles");
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
          <Panel id="separation" title="الفصل بين المهام في الاعتمادات" description="من يملك «الاعتماد المباشر» (مسؤول النظام الأعلى افتراضيًا) يعتمد ما أعدّه بنفسه ويُسجَّل اعتمادًا ذاتيًا، وبقية الموظفين يعتمد عنهم زميل. يُفعَّل الإلزام بشخص ثانٍ لإجراء ما فقط بسياسة مكتوبة معتمدة يُذكر مرجعها، فيسري حينها على الجميع.">
            <div data-testid="separation-policy">
              <ul className="mb-3 space-y-1 text-[14px]">
                {SEPARATION_KEYS.map((k) => <li key={k}>● {SEPARATION_AR[k]}: {separation[k].enforced ? <strong>يلزم شخص ثانٍ — {separation[k].reference}</strong> : <span className="text-muted">لا سياسة مكتوبة تلزم بشخص ثانٍ</span>}</li>)}
              </ul>
              {canEditSeparation ? (
                <details>
                  <summary className="cursor-pointer text-[14px] text-ink">عدّل السياسة</summary>
                  <ActionForm action={saveSeparationPolicy} submit="احفظ السياسة" size="sm" className="mt-3 space-y-3">
                    {SEPARATION_KEYS.map((k) => (
                      <fieldset key={k} className="space-y-2 rounded-md border border-line p-2">
                        <legend className="px-1 text-[14px] font-medium">{SEPARATION_AR[k]}</legend>
                        <Checkbox name={`enforce_${k}`} label="يلزم أن يعتمده شخص غير من أعدّه (بموجب سياسة مكتوبة)" defaultChecked={separation[k].enforced} />
                        <Field label="مرجع السياسة المعتمدة" name={`ref_${k}`}><Input id={`ref_${k}`} name={`ref_${k}`} defaultValue={separation[k].reference ?? ""} maxLength={300} /></Field>
                      </fieldset>
                    ))}
                    <Field label="سبب التغيير ومرجعه" name="reason" required><Input id="sep-reason" name="reason" required minLength={10} /></Field>
                  </ActionForm>
                </details>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
