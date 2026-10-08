/** Editable general settings (key in the `settings` table). Pure module: safe for client components. */
export type NumericSetting = { key: string; label: string; hint: string; unit: string; min: number; max: number; step?: number; fallback: number };

export const GENERAL_SETTINGS: NumericSetting[] = [
  { key: "requests.default_vat_rate", label: "نسبة ضريبة القيمة المضافة", hint: "تُطبق على الفواتير وعروض الأسعار الجديدة فقط؛ لا تتغير الفواتير الصادرة.", unit: "%", min: 0, max: 100, step: 0.01, fallback: 15 },
  { key: "requests.default_sla_days", label: "المهلة الافتراضية للخدمة", hint: "تُستخدم للخدمات التي لم تُحدد لها مهلة خاصة.", unit: "يوم عمل", min: 1, max: 120, fallback: 10 },
  { key: "complaints.sla_days", label: "مهلة الرد على شكاوى المستفيدين", hint: "تحسب من تاريخ استلام الشكوى.", unit: "يوم", min: 1, max: 60, fallback: 10 },
  { key: "documents.max_upload_mb", label: "الحد الأقصى لحجم الملف المرفوع", hint: "يطبق على كل رفع جديد.", unit: "ميغابايت", min: 1, max: 200, fallback: 50 },
  { key: "assessment.reassess_months", label: "التذكير بإعادة التقييم بعد", hint: "عدد الأشهر بعد آخر تقييم منشور.", unit: "شهر", min: 1, max: 24, fallback: 6 },
];

export type RetentionPolicy = { auditYears: number; sessionsDays: number; otpDays: number; outboxDays: number; deletedAccountGraceDays: number };

export const RETENTION_DEFAULTS: RetentionPolicy = { auditYears: 10, sessionsDays: 90, otpDays: 30, outboxDays: 180, deletedAccountGraceDays: 30 };

export const RETENTION_FIELDS: { key: keyof RetentionPolicy; label: string; hint: string; unit: string; min: number; max: number }[] = [
  { key: "auditYears", label: "سجل العمليات", hint: "سجل إلحاقي لا يُحذف من التطبيق؛ تُحفظ المدة هنا لسياسة الأرشفة الخارجية.", unit: "سنة", min: 10, max: 30 },
  { key: "sessionsDays", label: "الجلسات المنتهية", hint: "تُحذف سجلات الجلسات المنتهية أو الملغاة بعد هذه المدة.", unit: "يوم", min: 30, max: 730 },
  { key: "otpDays", label: "رموز التحقق المستخدمة والمنتهية", hint: "لا حاجة لبقائها بعد انتهاء صلاحيتها إلا للتحقيق في إساءة الاستخدام.", unit: "يوم", min: 1, max: 365 },
  { key: "outboxDays", label: "الرسائل الصادرة (SMS والبريد)", hint: "تُحذف بعد هذه المدة لأنها قد تحتوي بيانات اتصال.", unit: "يوم", min: 30, max: 730 },
  { key: "deletedAccountGraceDays", label: "مهلة التراجع عن حذف الحساب", hint: "المدة بين طلب الحذف وتنفيذه، يستطيع المستخدم خلالها التراجع.", unit: "يوم", min: 7, max: 90 },
];

export const COMPANY_FIELDS: { key: string; label: string; dir?: "ltr"; type?: string }[] = [
  { key: "nameAr", label: "الاسم التجاري بالعربية" },
  { key: "nameEn", label: "الاسم بالإنجليزية", dir: "ltr" },
  { key: "legalForm", label: "الشكل النظامي" },
  { key: "crNumber", label: "رقم السجل التجاري", dir: "ltr" },
  { key: "unifiedNumber", label: "الرقم الوطني الموحد", dir: "ltr" },
  { key: "vatNumber", label: "الرقم الضريبي", dir: "ltr" },
  { key: "nationalAddress", label: "العنوان الوطني" },
  { key: "phone", label: "الهاتف", dir: "ltr", type: "tel" },
  { key: "email", label: "البريد الإلكتروني", dir: "ltr", type: "email" },
  { key: "website", label: "الموقع الإلكتروني", dir: "ltr" },
];
