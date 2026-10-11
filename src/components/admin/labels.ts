import { AUDIT_ACTION_LABEL, ENTITY_LABEL } from "@/components/portal/audit-labels";
import type { Tone } from "@/components/ui";

export const USER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "بانتظار التفعيل", tone: "warn" },
  active: { label: "نشط", tone: "ok" },
  locked: { label: "مقفل", tone: "critical" },
  deletion_requested: { label: "طلب الحذف", tone: "fine" },
  deleted: { label: "محذوف", tone: "neutral" },
};

/** Audit action labels for staff/admin actions (portal labels are merged in). */
export const ADMIN_ACTION_LABEL: Record<string, string> = {
  ...AUDIT_ACTION_LABEL,
  "admin.user.role_granted": "منح دور",
  "admin.user.role_revoked": "سحب دور",
  "admin.user.locked": "قفل حساب",
  "admin.user.unlocked": "فتح حساب",
  "admin.user.signed_out": "إنهاء جلسات مستخدم",
  "admin.user.mfa_reset": "إعادة ضبط التحقق بخطوتين",
  "admin.user.profile_updated": "تعديل بيانات الحساب",
  "admin.user.pii_viewed": "اطلاع على البيانات الشخصية كاملة",
  "admin.user.staff_invited": "دعوة موظف",
  "admin.role.permission_granted": "إضافة صلاحية إلى دور",
  "admin.role.permission_revoked": "إزالة صلاحية من دور",
  "admin.settings.company_profile": "تعديل بيانات الشركة",
  "admin.settings.license": "تعديل ترخيص",
  "admin.settings.general": "تعديل إعداد عام",
  "admin.settings.retention": "تعديل سياسة الاحتفاظ",
  "admin.retention.run": "تنفيذ سياسة الاحتفاظ",
  "admin.flag.toggled": "تغيير خاصية",
  "admin.audit.chain_verified": "التحقق من سلامة السجل",
  "admin.notification_template.updated": "تعديل قالب إشعار",
  "admin.outbox.resend": "إعادة إرسال رسالة",
  "admin.dsr.started": "بدء معالجة طلب بيانات",
  "admin.dsr.completed": "إكمال طلب بيانات",
  "admin.dsr.rejected": "رفض طلب بيانات",
  "admin.contact.assigned": "إسناد رسالة تواصل",
  "admin.contact.status": "تحديث رسالة تواصل",
  "breakglass.requested": "طلب وصول طارئ",
  "breakglass.approved": "اعتماد وصول طارئ",
  "breakglass.rejected": "رفض وصول طارئ",
  "breakglass.revoked": "إنهاء وصول طارئ",
  "mlro.report_created": "فتح بلاغ اشتباه",
  "mlro.report_viewed": "الاطلاع على بلاغ اشتباه",
  "mlro.report_note": "ملاحظة على بلاغ",
  "mlro.report_report_fiu": "إبلاغ التحريات المالية",
  "mlro.report_close": "إغلاق بلاغ دون إبلاغ",
  "mlro.report_reopen": "إعادة فتح بلاغ",
  "mlro.screening_recorded": "تسجيل نتيجة فحص",
  "mlro.screening_decided": "قرار على نتيجة فحص",
};

export const ADMIN_ENTITY_LABEL: Record<string, string> = {
  ...ENTITY_LABEL,
  role: "دور", setting: "إعداد", feature_flag: "خاصية", audit_log: "سجل العمليات", notification_template: "قالب إشعار",
  outbox_message: "رسالة صادرة", data_subject_request: "طلب بيانات شخصية", contact_message: "رسالة تواصل",
  break_glass_access: "وصول طارئ", suspicion_report: "بلاغ اشتباه", screening_result: "نتيجة فحص", invoice: "فاتورة", contract: "عقد", consent: "موافقة",
};

export const actionLabel = (a: string) => ADMIN_ACTION_LABEL[a] ?? null;

export const DSR_DEADLINE_DAYS = 30;
