/** Labels and constants shared by server and client document components (no server imports). */
import type { Tone } from "@/components/ui";

export const DOC_TYPES = [
  "waqf_deed", "nazara_deed", "registration_certificate", "ownership_deed", "lease", "contract", "power_of_attorney",
  "resolution", "minutes", "financial_statement", "bank_statement", "valuation", "policy", "regulation",
  "official_letter", "judgment", "permission", "id_document", "bo_register", "deliverable", "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  waqf_deed: "صك الوقف",
  nazara_deed: "صك النظارة",
  registration_certificate: "شهادة التسجيل",
  ownership_deed: "صك الملكية",
  lease: "عقد إيجار",
  contract: "عقد",
  power_of_attorney: "وكالة",
  resolution: "قرار",
  minutes: "محضر اجتماع",
  financial_statement: "قوائم مالية",
  bank_statement: "كشف حساب بنكي",
  valuation: "تقرير تقييم",
  policy: "سياسة",
  regulation: "لائحة",
  official_letter: "خطاب رسمي",
  judgment: "حكم قضائي",
  permission: "إذن أو تصريح",
  id_document: "وثيقة هوية",
  bo_register: "سجل المستفيد الحقيقي",
  deliverable: "مخرج خدمة",
  other: "أخرى",
};
export const docTypeLabel = (t: string) => DOC_TYPE_LABEL[t as DocType] ?? t;
export const DOC_TYPE_OPTIONS = DOC_TYPES.map((v) => ({ value: v, label: DOC_TYPE_LABEL[v] }));

export const CONFIDENTIALITY = ["internal", "confidential", "secret"] as const;
export type Confidentiality = (typeof CONFIDENTIALITY)[number];
export const CONF_LABEL: Record<Confidentiality, string> = { internal: "داخلية", confidential: "سرية", secret: "سرية جدًا" };
export const CONF_TONE: Record<Confidentiality, Tone> = { internal: "neutral", confidential: "seal", secret: "critical" };
export const CONF_RANK: Record<Confidentiality, number> = { internal: 0, confidential: 1, secret: 2 };
export const CONF_OPTIONS = CONFIDENTIALITY.map((v) => ({ value: v, label: CONF_LABEL[v] }));

export const APPROVAL_LABEL: Record<string, string> = { none: "غير معتمدة", draft: "مسودة", in_review: "قيد المراجعة", approved: "معتمدة", locked: "مقفلة" };
export const APPROVAL_TONE: Record<string, Tone> = { none: "neutral", draft: "neutral", in_review: "info", approved: "ok", locked: "ink" };

export const STATUS_LABEL: Record<string, string> = { quarantine: "قيد الفحص", active: "سارية", rejected: "مرفوضة", archived: "مؤرشفة" };
export const SCAN_LABEL: Record<string, string> = { pending: "قيد الفحص", clean: "سليم", infected: "مرفوض", failed: "تعذر الفحص" };

export const ACCESS_ACTION_LABEL: Record<string, string> = {
  upload: "رفع", view: "عرض", download: "تنزيل", share: "مشاركة", update: "تعديل", archive: "أرشفة", approve: "اعتماد", denied: "محاولة مرفوضة",
  share_revoke: "إلغاء مشاركة", restore: "استعادة",
};

export const ENTITY_LABEL: Record<string, string> = {
  waqf: "الوقف", request: "طلب خدمة", asset: "أصل", property: "عقار", lease: "عقد إيجار", meeting: "اجتماع", resolution: "قرار",
  minutes: "محضر", contract: "عقد", obligation: "التزام", obligation_instance: "استحقاق نظامي", violation: "مخالفة", complaint: "شكوى",
  task: "مهمة", beneficiary: "مستفيد", distribution: "صرف", deliverable: "مخرج", assessment: "تقييم", financial_statement: "قوائم مالية",
};

/** Expiry thresholds (days) for reminders and the "expiring soon" filter. */
export const EXPIRY_THRESHOLDS = [60, 30, 7] as const;
export const EXPIRING_SOON_DAYS = 60;

export function expiryTone(days: number | null): Tone | null {
  if (days === null) return null;
  if (days < 0) return "critical";
  if (days <= 7) return "fine";
  if (days <= EXPIRING_SOON_DAYS) return "warn";
  return "neutral";
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} ك.ب`;
  return `${(n / 1024 / 1024).toFixed(1)} م.ب`;
}

// ───────────── Required documents per waqf ─────────────

export type RequiredDocKey = "waqf_deed" | "registration_certificate" | "nazara_deed" | "ownership_deed" | "financial_statement" | "bo_register";

/** The core documents every registered waqf should hold in its vault (checklist on the documents page). */
export const REQUIRED_DOCS: { key: RequiredDocKey; label: string; why: string }[] = [
  { key: "waqf_deed", label: "صك الوقف", why: "يثبت إنشاء الوقف وشروط الواقف، وهو أساس كل تصرف في الوقف." },
  { key: "registration_certificate", label: "شهادة تسجيل الوقف", why: "تثبت تسجيل الوقف لدى الهيئة العامة للأوقاف، ولها تاريخ انتهاء يلزم تجديده." },
  { key: "nazara_deed", label: "صك النظارة", why: "يحدد الناظر وصلاحياته، ويُطلب عند التعامل مع الجهات والبنوك." },
  { key: "ownership_deed", label: "صكوك ملكية الأصول", why: "تثبت ملكية الوقف لعقاراته وأصوله المسجلة." },
  { key: "financial_statement", label: "القوائم المالية لآخر سنة مالية", why: "تُعد سنويًا وتُحفظ للرجوع إليها عند المراجعة والإفصاح." },
  { key: "bo_register", label: "سجل المستفيد الحقيقي", why: "يحدد الأشخاص الطبيعيين المسيطرين على الوقف وفق معايير المستفيد الحقيقي." },
];

export type ChecklistState = "ok" | "pending" | "expiring" | "expired" | "partial" | "outdated" | "due" | "missing";
export const CHECKLIST_LABEL: Record<ChecklistState, string> = {
  ok: "مكتملة", pending: "قيد الفحص", expiring: "تقترب من الانتهاء", expired: "منتهية", partial: "ناقصة جزئيًا",
  outdated: "غير محدّثة", due: "مستحقة قريبًا", missing: "ناقصة",
};
export const CHECKLIST_TONE: Record<ChecklistState, Tone> = {
  ok: "ok", pending: "warn", expiring: "warn", expired: "critical", partial: "warn", outdated: "fine", due: "info", missing: "critical",
};
