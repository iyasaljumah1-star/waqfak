/** Arabic labels and option lists for the waqf file sections. Client-safe (no server imports). */
import type { Tone } from "@/components/ui";

export type Opt = { value: string; label: string };
const opts = (m: Record<string, string>): Opt[] => Object.entries(m).map(([value, label]) => ({ value, label }));

// ── identity
export const CREATION_MODE_LABEL: Record<string, string> = { inter_vivos: "وقف منجز حال الحياة", bequest: "وقف بالوصية (معلّق على الوفاة)" };
export const REG_TYPE_LABEL: Record<string, string> = { issue: "إصدار شهادة تسجيل", renew: "تجديد الشهادة", amend: "تعديل بيانات" };
export const REG_STATUS_LABEL: Record<string, string> = { draft: "مسودة", submitted: "مُقدَّم", under_review: "قيد المراجعة", issued: "صدرت الشهادة", rejected: "مرفوض" };
export const REG_STATUS_TONE: Record<string, Tone> = { draft: "neutral", submitted: "info", under_review: "info", issued: "ok", rejected: "critical" };
export const BENEFICIARY_KIND_OPTIONS: Opt[] = [
  { value: "public", label: "جهات بر عامة (فقراء، مساجد، تعليم، صحة…)" },
  { value: "private", label: "الذرية أو الأقارب أو أشخاص معيّنون" },
  { value: "both", label: "يجمع بين الاثنين (حصة للذرية وحصة للبر العام)" },
];
export const TIMELINE_TYPES: Record<string, string> = {
  platform_registered: "فتح الملف", documented: "توثيق", registered: "تسجيل", nazara_changed: "تغيير النظارة", classification: "تصنيف",
  registration_request: "طلب تسجيل", deed_version: "إصدار وثيقة", asset: "أصل", governance: "حوكمة", note: "حدث", establish: "تأسيس",
};

// ── deed
export const DEED_STATUS_LABEL: Record<string, string> = { draft: "مسودة", documented: "موثّقة", amended: "معدّلة" };
export const CONDITION_CATEGORY_LABEL: Record<string, string> = {
  asset: "شروط الأصل الموقوف", revenue: "شروط الغلة والريع", masraf: "المصارف والمستحقون", nazara: "النظارة",
  founder_self: "ما اشترطه الواقف لنفسه", governance_finance: "الحوكمة والمالية",
};
export const CONDITION_CATEGORIES = Object.keys(CONDITION_CATEGORY_LABEL);
export const SHARIA_REVIEW_LABEL: Record<string, string> = {
  not_reviewed: "لم يراجع شرعيًا", approved: "روجع واعتُمد من مختص", needs_amendment: "يحتاج تعديلًا", possibly_void: "قد يكون باطلًا — يلزم رأي مختص",
};
export const SHARIA_REVIEW_TONE: Record<string, Tone> = { not_reviewed: "neutral", approved: "ok", needs_amendment: "warn", possibly_void: "critical" };
export const INTERP_SOURCE_LABEL: Record<string, string> = { founder: "الواقف", court: "المحكمة المختصة", advisor: "مستشار شرعي" };
export const EXCEPTION_KIND_LABEL: Record<string, string> = { usufruct: "الانتفاع بالعين", yield: "الغلة كلها أو بعضها", quantity: "مقدار محدد" };
export const EXCEPTION_DURATION_LABEL: Record<string, string> = { life: "مدة حياته", until_date: "إلى تاريخ محدد" };
export const APPROVAL_KIND_LABEL: Record<string, string> = {
  substitution: "استبدال أصل", mortgage: "رهن", condition_deviation: "مخالفة شرط لمصلحة", interpretation: "تفسير شرط", nazir_fee: "أجرة الناظر",
  donations: "جمع تبرعات", merger: "دمج أوقاف", long_lease: "تأجير طويل", other: "أخرى",
};
export const AUTHORITY_LABEL: Record<string, string> = {
  competent_authority: "الجهة المختصة", gaa: "الهيئة العامة للأوقاف", court: "المحكمة", cma: "هيئة السوق المالية", fiu: "الإدارة العامة للتحريات المالية", notary: "كتابة العدل", internal: "قرار داخلي",
};
export const APPROVAL_STATUS_LABEL: Record<string, string> = { draft: "مسودة", submitted: "مُقدَّم", granted: "صدر الإذن", rejected: "مرفوض", withdrawn: "مسحوب" };
export const APPROVAL_STATUS_TONE: Record<string, Tone> = { draft: "neutral", submitted: "info", granted: "ok", rejected: "critical", withdrawn: "neutral" };
export const ALLOCATION_FIELDS = [
  { key: "maintenancePct", label: "عمارة الأصول وصيانتها" },
  { key: "developmentPct", label: "تنمية الأصول" },
  { key: "reinvestPct", label: "إعادة الاستثمار" },
  { key: "reservePct", label: "الاحتياطي" },
  { key: "nazirFeePct", label: "أجرة الناظر" },
  { key: "adminPct", label: "المصاريف الإدارية" },
] as const;

// ── parties
export const TRUSTEE_KIND_LABEL: Record<string, string> = { individual: "ناظر فرد", board_member: "عضو مجلس نظارة", legal_entity: "شخص اعتباري", founder: "الواقف", gaa: "الهيئة العامة للأوقاف" };
export const BODY_KIND_LABEL: Record<string, string> = { board: "مجلس نظارة", committee: "لجنة", general_assembly: "جمعية عمومية" };
export const BODY_ROLE_LABEL: Record<string, string> = { chair: "رئيس", vice_chair: "نائب الرئيس", member: "عضو", secretary: "أمين سر", observer: "مراقب" };
export const FOUNDER_POWERS: { key: string; label: string }[] = [
  { key: "canInterpret", label: "تفسير شروطه" },
  { key: "canAmendNazara", label: "تعديل النظارة" },
  { key: "canDismissNazir", label: "عزل الناظر" },
  { key: "canAddAssets", label: "إضافة أصول إلى الوقف" },
];

// ── beneficiaries
export const RELATION_LABEL: Record<string, string> = { then: "ثم (ترتيب: لا تستحق حتى تنقرض الطبقة قبلها)", and: "و (تشريك: تستحق مع غيرها)" };
export const RELATION_SHORT: Record<string, string> = { then: "ترتيب «ثم»", and: "تشريك «و»" };
export const DIVISION_LABEL: Record<string, string> = { equal: "بالتساوي", male_double: "للذكر مثل حظ الأنثيين" };
export const SUBSTITUTION_LABEL: Record<string, string> = { tier_blocking: "الطبقة العليا تحجب السفلى", branch_replaces: "يحل الفرع محل أصله المتوفى" };
export const CLASS_KIND_LABEL: Record<string, string> = { public: "جهة بر عامة", private: "معيّنون (ذرية/أقارب/أشخاص)" };
export const BEN_STATUS_LABEL: Record<string, string> = { active: "مستحق", suspended: "موقوف الاستحقاق", ended: "انتهى استحقاقه" };
export const BEN_STATUS_TONE: Record<string, Tone> = { active: "ok", suspended: "warn", ended: "neutral" };
export const DIST_STATUS_LABEL: Record<string, string> = { planned: "مخطط", approved: "معتمد", paid: "مصروف", partially_paid: "صُرف جزئيًا" };
export const DIST_STATUS_TONE: Record<string, Tone> = { planned: "neutral", approved: "info", paid: "ok", partially_paid: "warn" };
export const BO_ROLE_LABEL: Record<string, string> = {
  controlling_founder: "واقف يمارس سيطرة فعلية", nazir: "ناظر", controller: "مسيطر فعلي آخر", beneficiary: "مستفيد ضمن فئة محددة",
  service_provider: "مقدم خدمة مهنية", director: "مدير/عضو مجلس شخص اعتباري",
};
export const ID_TYPE_LABEL: Record<string, string> = { national_id: "هوية وطنية", iqama: "إقامة", passport: "جواز سفر", gcc_id: "هوية خليجية", cr: "سجل تجاري", other: "أخرى" };
export const VERIFY_SOURCE_LABEL: Record<string, string> = { deed: "صك الوقف", registration_certificate: "شهادة التسجيل", other: "مستند رسمي آخر" };
export const RISK_LABEL: Record<string, string> = { low: "منخفض", standard: "عادي", high: "مرتفع" };

// ── assets
export const ASSET_CATEGORY_LABEL: Record<string, string> = {
  real_estate: "عقار", movable: "منقول", usufruct: "منفعة", intellectual_property: "ملكية فكرية", cash: "نقد",
  shares: "أسهم", fund_units: "وحدات صناديق", portfolio: "محفظة استثمارية", sukuk: "صكوك",
};
export const FINANCIAL_CATEGORIES = ["cash", "shares", "fund_units", "portfolio", "sukuk"];
export const ASSET_STATUS_LABEL: Record<string, string> = { income: "مُدرّ للدخل", vacant: "شاغر", development: "قيد التطوير", idle: "معطّل", disputed: "عليه نزاع" };
export const ASSET_STATUS_TONE: Record<string, Tone> = { income: "ok", vacant: "warn", development: "info", idle: "fine", disputed: "critical" };
export const ASSET_SUBJECT_LABEL: Record<string, string> = { corpus: "عين موقوفة (أصل)", value: "قيمة موقوفة (تُستبدل)" };
export const USAGE_LABEL: Record<string, string> = { residential: "سكني", commercial: "تجاري", agricultural: "زراعي", mosque: "مسجد", mixed: "متعدد الاستخدام", land: "أرض" };
export const CONDITION_LABEL: Record<string, string> = { good: "جيدة", fair: "متوسطة", poor: "سيئة" };
export const FREQUENCY_LABEL: Record<string, string> = { monthly: "شهريًا", quarterly: "ربع سنوي", annual: "سنويًا", once: "مرة واحدة" };
export const ENCUMBRANCE_LABEL: Record<string, string> = { mortgage: "رهن", seizure: "حجز", dispute: "نزاع", encroachment: "تعدٍّ", lien: "حق امتياز" };
export const INSTRUMENT_LABEL: Record<string, string> = { shares: "أسهم", fund_units: "وحدات صندوق", portfolio: "محفظة", sukuk: "صكوك", direct: "استثمار مباشر", deposit: "وديعة مرابحة" };

// ── finance
export const BANK_PURPOSE_LABEL: Record<string, string> = { general: "عام", donations: "التبرعات", investment: "الاستثمار", distribution: "صرف الغلة" };
export const STATEMENT_KIND_LABEL: Record<string, string> = { audited: "قوائم مالية مدققة", simple_statement: "بيان مالي مبسط" };
export const STATEMENT_STATUS_LABEL: Record<string, string> = { draft: "مسودة", final: "معتمدة نهائيًا", submitted: "رُفعت للهيئة" };
export const STATEMENT_STATUS_TONE: Record<string, Tone> = { draft: "neutral", final: "ok", submitted: "ink" };
/** Simplified chart of accounts for waqf books. */
export const ACCOUNTS: { code: string; label: string; kind: "asset" | "liability" | "equity" | "revenue" | "expense" }[] = [
  { code: "1100", label: "النقد في البنك", kind: "asset" },
  { code: "1200", label: "ذمم المستأجرين", kind: "asset" },
  { code: "1500", label: "الأصول الموقوفة والاستثمارات", kind: "asset" },
  { code: "2100", label: "مستحقات ودائنون", kind: "liability" },
  { code: "2200", label: "غلة مستحقة للمستفيدين", kind: "liability" },
  { code: "3100", label: "رأس مال الوقف (الأعيان)", kind: "equity" },
  { code: "3200", label: "الاحتياطي", kind: "equity" },
  { code: "4100", label: "إيرادات الإيجار", kind: "revenue" },
  { code: "4200", label: "عوائد الاستثمار", kind: "revenue" },
  { code: "4300", label: "التبرعات", kind: "revenue" },
  { code: "4900", label: "إيرادات أخرى", kind: "revenue" },
  { code: "5100", label: "الصيانة والعمارة", kind: "expense" },
  { code: "5200", label: "مصاريف إدارية", kind: "expense" },
  { code: "5300", label: "أجرة الناظر", kind: "expense" },
  { code: "5400", label: "صرف الغلة للمستفيدين", kind: "expense" },
  { code: "5900", label: "مصاريف أخرى", kind: "expense" },
];
export const ACCOUNT_LABEL: Record<string, string> = Object.fromEntries(ACCOUNTS.map((a) => [a.code, `${a.code} — ${a.label}`]));

export const options = opts;
