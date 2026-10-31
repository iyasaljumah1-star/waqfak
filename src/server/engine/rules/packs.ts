import type { RulePack } from "./types";

/**
 * The rule packs shipped with the engine core. Service-specific packs come in the next phase, one service family at a
 * time, each with its own version and tests (owner's order of 2026-11-01: no service is changed in this phase).
 */
export const CORE_PACK: RulePack = {
  id: "core.common",
  version: "1.0.0",
  title: "القواعد المشتركة لكل الخدمات",
  services: "*",
  rules: [
    {
      id: "conflict_blocked", title: "تعارض الاستقلال", effect: "block",
      when: { "==": [{ var: "request.conflict" }, "blocked"] },
      message: "في الطلب تعارض استقلال قائم: لا يعالجه المحرك قبل قرار مسبب من مدير التشغيل.",
    },
    {
      id: "intake_incomplete", title: "اكتمال التقديم", effect: "client",
      when: { or: [{ ">": [{ var: "intake.missingFields" }, 0] }, { ">": [{ var: "intake.missingDocs" }, 0] }] },
      message: "بيانات أو مستندات إلزامية لم تُستكمل في الطلب.",
      ask: { kind: "question", title: "استكمل البيانات والمستندات الإلزامية في طلبك", body: "تحتاج المعالجة إلى البيانات والمستندات الإلزامية كاملة. راجع ما نقص واستكمله ثم أرسل ردك." },
    },
    {
      id: "material_conflict", title: "تعارض في البيانات", effect: "client",
      when: { ">": [{ var: "conflicts.material" }, 0] },
      message: "بيانات الطلب تتعارض مع ملف الوقف أو مع بعضها في مسألة جوهرية، ولا تختار المنصة بين القيمتين.",
      ask: { kind: "question", title: "أكّد القيمة الصحيحة للبيانات المتعارضة", body: "وجدنا في طلبك بيانات تختلف عما في ملف الوقف أو تختلف فيما بينها. اكتب القيمة الصحيحة ومصدرها، أو أرفق ما يثبتها." },
    },
    {
      id: "client_gaps", title: "نواقص على العميل", effect: "client",
      when: { ">": [{ var: "gaps.clientBlocking" }, 0] },
      message: "المخرج يحتاج بيانات لا تتوفر في الطلب ولا في ملف الوقف.",
      ask: { kind: "data", title: "استكمل البيانات المطلوبة لإعداد المخرج", body: "تحتاج المعالجة إلى بيانات لم ترد في طلبك ولا في ملف الوقف. البنود المطلوبة مذكورة أدناه." },
    },
    {
      id: "unreadable_docs", title: "مستندات لم تُقرأ آليًا", effect: "warn",
      when: { ">": [{ var: "docs.unreadable" }, 0] },
      message: "مستند مرفق لم يُستخرج نصه آليًا (صورة ممسوحة أو صيغة غير مقروءة): لم يُبنَ عليه تحليل، ويطّلع عليه المعتمد.",
    },
    {
      id: "essential_refs", title: "مراجع جوهرية", effect: "block",
      when: { ">": [{ var: "kb.missingEssentialCount" }, 0] },
      message: "مرجع جوهري للخدمة ناقص من قاعدة المعرفة أو نصه غير مقروء أو غير موثق: لا يُعدّ المخرج آليًا قبل استكماله.",
    },
  ],
  // every analysis section is written under the rules from the knowledge base, and must rest on a source
  sections: [{ section: "*", mode: "model", requireCitation: true }],
};

export function rulePacks(): RulePack[] {
  return [CORE_PACK];
}
