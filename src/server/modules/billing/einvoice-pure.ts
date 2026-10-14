import { invoicePolicy, type CompanyProfile } from "@/server/modules/commerce/pure";

/** The platform has no connector to ZATCA's API yet (UBL XML, signing, clearance/reporting). Set true when it ships. */
export const EINVOICE_CONNECTOR_AVAILABLE = false;

export type ReadinessItem = { label: string; ok: boolean; detail?: string };

/** Conditions for e-invoicing to be active. All must hold; nothing is reported as sent to ZATCA otherwise. */
export function einvoiceReadiness(x: { company: CompanyProfile; credentials: { csid: boolean; secret: boolean; env: string }; connector?: boolean }): { active: boolean; items: ReadinessItem[] } {
  const policy = invoicePolicy(x.company);
  const items: ReadinessItem[] = [
    { label: "الشركة مسجلة في ضريبة القيمة المضافة", ok: x.company.vatRegistration === "registered", detail: x.company.vatRegistration === "not_registered" ? "الشركة مسجلة في الإعدادات على أنها غير مسجلة؛ لا تنطبق الفوترة الإلكترونية الضريبية." : undefined },
    { label: "بيانات الشركة الضريبية مكتملة", ok: policy.kind === "tax_invoice", detail: policy.kind === "tax_invoice" ? undefined : `ينقص: ${policy.gaps.join("، ")}` },
    { label: "بيانات الربط مع منصة فاتورة (شهادة الجهاز CSID وسرّها) في متغيرات البيئة", ok: x.credentials.csid && x.credentials.secret, detail: "تصدر من بوابة «فاتورة» بعد تسجيل الجهاز، وتُضاف إلى بيئة الخادم لا إلى الكود." },
    { label: "بيئة الربط محددة (محاكاة أو إنتاج)", ok: ["simulation", "production", "sandbox"].includes(x.credentials.env), detail: "ZATCA_ENV" },
    { label: "وحدة الربط البرمجية مع منصة فاتورة", ok: x.connector ?? EINVOICE_CONNECTOR_AVAILABLE, detail: "لم تُبنَ بعد: توليد XML وفق المواصفة، والتوقيع، وإرسال الفواتير للاعتماد أو الإبلاغ." },
  ];
  return { active: items.every((i) => i.ok), items };
}
