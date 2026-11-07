/**
 * Licence gate for corporate nazara (client-safe, no server imports).
 *
 * Three separate things (أمر التطوير، خامسًا):
 *  1. N01 is in the catalog, and requests for it are received and studied (intake): gated only by the operational
 *     switch `service.nazara`, never by the licence.
 *  2. The platform functions are built and testable: on demo/test waqfs an engagement may be activated as a
 *     practice engagement, clearly marked, without a licence.
 *  3. Actually becoming the nazir of a real waqf (activation) requires the GAA licence for a legal-entity nazir,
 *     recorded in company settings as active, numbered and unexpired (لائحة تنظيم أعمال النظارة م5/2).
 */
export const NAZARA_LICENSE_KEY = "gaa_nazara_license";
export const NAZARA_INTAKE_FLAG = "service.nazara";

/** Licences that gate the start of practice, not the receiving of requests. */
export const PRACTICE_GATED_LICENSES = new Set<string>([NAZARA_LICENSE_KEY]);

export type LicenceRecord = { key: string; nameAr?: string; number?: string; active?: boolean; expiresOn?: string | null; issuer?: string };

export function licenceValid(l: LicenceRecord | undefined | null, today: string): boolean {
  return !!l && l.active === true && !!String(l.number ?? "").trim() && (!l.expiresOn || l.expiresOn > today);
}

export const NAZARA_PRACTICE_NOTICE =
  "نستقبل طلبات تولي النظارة الآن: ندرس ملف الوقف، ونعدّ طلب التعيين ومرفقاته، ونتابع الإجراء. ولا تبدأ «وقفك» مباشرة النظارة إلا بعد ثبوت تعيينها بقرار من الجهة المختصة واستيفاء المتطلبات النظامية المنطبقة، ومنها أن يكون الناظر الاعتباري مرخصًا من الهيئة (لائحة تنظيم أعمال النظارة م5/2). تقديم الطلب أو توقيع عقد لا يجعل «وقفك» ناظرًا.";

export type ActivationGate = { allowed: true; practice: boolean } | { allowed: false; reason: string };

/** Whether an accepted engagement may start (become active) on this waqf now. */
export function activationGate(opts: { licence: LicenceRecord | undefined | null; today: string; waqfIsDemo: boolean }): ActivationGate {
  if (licenceValid(opts.licence, opts.today)) return { allowed: true, practice: false };
  if (opts.waqfIsDemo) return { allowed: true, practice: true };
  return {
    allowed: false,
    reason:
      "لا تُباشَر النظارة على وقف حقيقي قبل اعتماد ترخيص الهيئة العامة للأوقاف للناظر الاعتباري (لائحة تنظيم أعمال النظارة م5/2). " +
      "يُفعَّل الترخيص من «الإعدادات والتراخيص» برقمه وتاريخ انتهائه، وتبقى إجراءات الاستلام والدراسة متاحة حتى ذلك الحين.",
  };
}

/**
 * What the appointment record must hold before the nazara is started (owner's decision 2026-11-07, §6, phase 3): the
 * file's lead, the decision's number, date and issuing authority, the powers, fees and responsibilities it sets (م4/6),
 * and — for a real waqf — the decision document itself attached to the waqf. Combined with activationGate (licence,
 * م5/2), nothing registers the company as the waqf's nazir before these are met.
 */
export function appointmentMissing(e: { leadUserId: string | null; appointmentDecisionNo: string | null; appointmentDecisionDate: string | null; appointmentAuthority: string | null; powers: string | null; feeTerms: string | null; responsibilities: string | null; appointmentDocumentId: string | null }, waqfIsDemo: boolean): string[] {
  return [
    !e.leadUserId && "مسؤول الملف",
    !e.appointmentDecisionNo && "رقم قرار التعيين",
    !e.appointmentDecisionDate && "تاريخه",
    !e.appointmentAuthority && "الجهة المصدرة للقرار",
    !e.powers && "الصلاحيات",
    !e.feeTerms && "الأتعاب",
    !e.responsibilities && "المسؤوليات",
    !waqfIsDemo && !e.appointmentDocumentId && "وثيقة قرار التعيين مرفقة بملف الوقف",
  ].filter((x): x is string => !!x);
}
