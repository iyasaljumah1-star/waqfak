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
  "نستقبل طلبات تولي النظارة وندرس ملفاتها الآن، وتبدأ «وقفك» مباشرة النظارة على الوقف بعد اعتماد ترخيص الهيئة العامة للأوقاف للناظر الاعتباري.";

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
