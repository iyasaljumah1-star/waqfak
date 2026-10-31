/** Engine constants (PURE: shared by the app, the worker, the seed and the tests). */

/** Fixed id of the platform's processing account (seeded; see engine/actor.ts). */
export const ENGINE_USER_ID = "00000000-0000-4000-8000-00000000e9e1";
export const ENGINE_USER_NAME = "المنصة — المعالجة الآلية";
/** Bumped when the pipeline's behaviour changes; recorded on every run. */
export const ENGINE_VERSION = "core-1.0.0";

/** Services whose output carries a professional or regulatory requirement that the administrator's approval does not
 *  replace (owner's decision of 2026-11-01, item 4): the licensed professional's name, licence and capacity must be
 *  recorded before the final approval. */
export const PROFESSIONAL_REQUIREMENTS: Record<string, string> = {
  F06: "تقرير المراجعة المالية يوقّعه محاسب قانوني مرخص من الهيئة السعودية للمراجعين والمحاسبين",
  G08: "تقرير المراجعة الداخلية يوقّعه مراجع مؤهل باسمه وصفته",
  C08: "الاستشارة القانونية تُقدَّم بموجب ترخيص محاماة: اسم المحامي المرخص ورقم ترخيصه",
  C13: "التمثيل القضائي لمحامٍ مرخص: اسمه ورقم ترخيصه",
  N01: "مباشرة النظارة بترخيص الهيئة العامة للأوقاف وقرار تعيين من الجهة المختصة",
};
