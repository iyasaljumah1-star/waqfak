import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileQuestion } from "lucide-react";
import { Alert, Badge, buttonClass, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { CONSENT_LABEL, DSR_KINDS, DSR_LABEL, DSR_STATUS_LABEL } from "@/server/modules/account/constants";
import { privacyData } from "@/server/modules/account/queries";
import { DataRequestForm, DeletionForm, MarketingConsentForm } from "./forms";

export const metadata: Metadata = { title: "خصوصيتي وبياناتي" };

export default async function PrivacyPage() {
  const auth = await requireAuth({ next: "/app/privacy" });
  const { consents, dsrs } = await privacyData(auth);
  const marketing = consents.find((c) => c.kind === "marketing");
  const deletion = auth.user.deletionRequestedAt;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="خصوصيتي وبياناتي"
        description={<>حقوقك في بياناتك الشخصية وفق نظام حماية البيانات الشخصية: الاطلاع والنسخ والتصحيح والحذف والاعتراض. التفاصيل في <Link href="/legal/privacy" className="text-ink underline-offset-4 hover:underline">سياسة الخصوصية</Link>.</>}
      />

      {deletion ? (
        <Alert tone="warn" title="طلبت حذف حسابك">
          سجّلنا الطلب في {fmtDate(deletion)}. نراجعه وننفذه خلال 30 يومًا، ويمكنك إلغاؤه من أسفل الصفحة قبل التنفيذ.
        </Alert>
      ) : null}

      <Panel title="نسخة من بياناتي" description="ملف JSON بما نحفظه عنك: ملفك، وعضوياتك في الأوقاف، وموافقاتك، وإشعاراتك، وطلباتك، وجلساتك.">
        <a href="/app/privacy/export" download className={buttonClass("secondary")}>
          <Download aria-hidden className="size-4" />
          نزّل بياناتي
        </a>
        <p className="mt-2 text-[13px] text-muted">يُسجَّل كل تنزيل في سجل أمان حسابك. لا يتضمن الملف بصمة كلمة المرور ولا مفاتيح التحقق.</p>
      </Panel>

      <Panel title="الموافقات" tight>
        <ul className="divide-y divide-line">
          {consents.length ? (
            consents.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 md:px-5">
                <div>
                  <p className="font-medium">{CONSENT_LABEL[c.kind] ?? c.kind}</p>
                  <p className="text-[13px] text-muted">
                    الإصدار <span dir="ltr" className="tabular">{c.version}</span> · {fmtDateTime(c.at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge tone={c.granted ? "ok" : "neutral"} icon={false}>{c.granted ? "موافق" : "غير موافق"}</Badge>
                  {c.kind === "marketing" ? <MarketingConsentForm granted={c.granted} /> : null}
                </div>
              </li>
            ))
          ) : (
            <li className="p-4"><EmptyState title="لا موافقات مسجّلة" /></li>
          )}
          {!marketing ? (
            <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 md:px-5">
              <p className="font-medium">{CONSENT_LABEL.marketing}</p>
              <MarketingConsentForm granted={false} />
            </li>
          ) : null}
        </ul>
        <p className="border-t border-line px-4 py-3 text-[13px] text-muted md:px-5">
          الموافقة على الشروط وسياسة الخصوصية شرط لاستخدام المنصة. لسحبها اطلب حذف حسابك.
        </p>
      </Panel>

      <Panel title="طلباتي بشأن بياناتي" description="نرد على كل طلب خلال 30 يومًا كحد أقصى.">
        <DataRequestForm kinds={DSR_KINDS.filter((k) => k !== "delete").map((k) => ({ value: k, label: DSR_LABEL[k] }))} />
        <div className="mt-6 border-t border-line pt-4">
          <DataTable
            caption="طلباتي بشأن بياناتي"
            rows={dsrs}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={FileQuestion} title="لم ترسل طلبات بعد" />}
            columns={[
              { key: "kind", label: "الطلب", render: (r) => <span className="font-medium">{DSR_LABEL[r.kind] ?? r.kind}</span> },
              { key: "at", label: "أُرسل", render: (r) => fmtDate(r.requestedAt) },
              { key: "due", label: "موعد الرد", render: (r) => fmtDate(r.dueAt) },
              { key: "status", label: "الحالة", render: (r) => <Badge tone={r.status === "completed" ? "ok" : r.status === "rejected" ? "critical" : "info"} icon={false}>{DSR_STATUS_LABEL[r.status] ?? r.status}</Badge> },
            ]}
          />
        </div>
      </Panel>

      <Panel title="حذف الحساب" description="نحذف بياناتك الشخصية أو نجعلها غير معرِّفة، مع استثناءات يفرضها النظام.">
        <ul className="mb-4 list-disc space-y-1 ps-5 text-[15px] text-muted">
          <li>سجلات الأوقاف (الصكوك والقرارات والمحاضر والقوائم المالية والصرف) ملك للوقف وتبقى، ويظهر فيها اسمك حيث كنت طرفًا.</li>
          <li>سجل العمليات والفواتير وسجلات مكافحة غسل الأموال تُحفظ طوال مدة الحفظ النظامية ثم تُتلف.</li>
          <li>إن كنت ناظرًا أو رئيس مجلس فلا تنتهي صفتك في الوقف بحذف الحساب؛ يلزم تعيين بديل أولًا.</li>
        </ul>
        <DeletionForm requested={!!deletion} />
      </Panel>
    </div>
  );
}
