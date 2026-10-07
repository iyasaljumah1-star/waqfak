/** Readable Arabic for audit action codes. Unknown codes are shown as-is. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "waqf.register": "فتح ملف الوقف في المنصة",
  "waqf.profile_updated": "تعديل بيانات ملف الوقف",
  "waqf.member.role_changed": "تغيير دور عضو",
  "waqf.member.ended": "إنهاء عضوية",
  "waqf.invitation.created": "إرسال دعوة",
  "waqf.invitation.revoked": "إلغاء دعوة",
  "waqf.invitation.accepted": "قبول دعوة",
  "waqf.invitation.declined": "الاعتذار عن دعوة",
  "waqf.delegation.created": "تسجيل وكالة",
  "waqf.delegation.invited": "دعوة وكيل",
  "waqf.delegation.revoked": "إلغاء وكالة",
  "user.login": "تسجيل دخول",
  "user.logout": "تسجيل خروج",
  "user.signup": "إنشاء حساب",
  "user.recover": "استعادة الحساب",
  "user.mfa_verified": "تحقق بخطوتين",
  "user.password_set": "تعيين كلمة المرور",
  "auth.mfa_enabled": "تفعيل التحقق بخطوتين",
  "auth.mfa_disabled": "إيقاف التحقق بخطوتين",
  "auth.password_changed": "تغيير كلمة المرور",
  "auth.session_revoked": "إنهاء جلسة",
  "auth.sessions_revoked_others": "إنهاء الجلسات الأخرى",
};

/** Arabic names for action prefixes (the part before the first dot), used by the filter. */
export const AUDIT_PREFIX_LABEL: Record<string, string> = {
  waqf: "الوقف والأعضاء", deed: "الوثيقة والشروط", conditions: "الشروط", assets: "الأصول", finance: "المالية", beneficiaries: "المستفيدون",
  bo: "المستفيد الحقيقي", distribution: "الصرف", governance: "الحوكمة", meeting: "الاجتماعات", resolution: "القرارات", minutes: "المحاضر",
  documents: "الوثائق", document: "الوثائق", compliance: "الامتثال", obligation: "الالتزامات", risk: "المخاطر", assessment: "التقييم",
  request: "الطلبات", requests: "الطلبات", task: "المهام", tasks: "المهام", complaint: "الشكاوى", complaints: "الشكاوى", report: "التقارير",
  ai: "المساعد الذكي", contract: "العقود", invoice: "الفواتير", user: "الحساب", auth: "الأمان",
};

export const ENTITY_LABEL: Record<string, string> = {
  waqf: "الوقف", waqf_membership: "عضوية", invitation: "دعوة", delegation: "وكالة", user: "مستخدم", document: "وثيقة", asset: "أصل",
  beneficiary: "مستفيد", meeting: "اجتماع", resolution: "قرار", service_request: "طلب خدمة", task: "مهمة", obligation_instance: "التزام",
  assessment: "تقييم", complaint: "شكوى", session: "جلسة",
};

export function auditActionLabel(code: string) {
  return AUDIT_ACTION_LABEL[code] ?? null;
}
