export const SETTINGS: [string, unknown, string][] = [
  ["company.profile", {
    nameAr: "شركة وقفك", nameEn: "Waqfak", legalForm: "شركة ذات مسؤولية محدودة", crNumber: "", unifiedNumber: "", vatNumber: "",
    nationalAddress: "", phone: "", email: "", website: "waqfak.sa",
  }, "بيانات الشركة المعروضة في التذييل والعقود والتقارير"],
  ["company.licenses", [
    { key: "legal_consulting", nameAr: "ترخيص الاستشارات القانونية", number: "", issuer: "", expiresOn: "" },
    { key: "financial_audit", nameAr: "ترخيص المراجعة المالية", number: "", issuer: "", expiresOn: "" },
    { key: "gaa_nazara_license", nameAr: "ترخيص الهيئة العامة للأوقاف للناظر الاعتباري", number: "", issuer: "الهيئة العامة للأوقاف", expiresOn: "", active: false },
  ], "التراخيص: الأرقام فارغة حتى تعبئتها. ترخيص النظارة غير مفعّل حتى صدوره (يفتح خدمة N01)."],
  ["assessment.maturity_bands", [{ min: 90, level: "رائد" }, { min: 75, level: "متقدم" }, { min: 60, level: "مُدار" }, { min: 40, level: "ناشئ" }, { min: 0, level: "تأسيسي" }], "حدود مستويات النضج"],
  ["assessment.reassess_months", 6, "تذكير بإعادة التقييم"],
  ["requests.default_vat_rate", 15, "نسبة ضريبة القيمة المضافة"],
  ["complaints.sla_days", 10, "مهلة الرد على شكاوى المستفيدين (أيام)"],
  ["documents.max_upload_mb", 50, "الحد الأقصى لحجم الملف"],
  ["security.session_idle_minutes", 30, "مهلة الخمول للبوابة"],
];

export const FEATURE_FLAGS = [
  { key: "service.nazara", enabled: false, description: "خدمة تولي النظارة (N01)", reason: "بانتظار ترخيص الهيئة العامة للأوقاف للناظر الاعتباري (لائحة النظارة م5/2)" },
  { key: "auth.nafath", enabled: false, description: "الدخول عبر النفاذ الوطني", reason: "بانتظار التحقق من أهلية الربط وشروطه" },
  { key: "payments.live", enabled: false, description: "الدفع الإلكتروني الحي", reason: "بانتظار حساب بوابة دفع مرخصة؛ يعمل الآن في وضع تجريبي" },
  { key: "einvoice.zatca", enabled: false, description: "الربط مع الفوترة الإلكترونية", reason: "بانتظار بيانات التسجيل لدى هيئة الزكاة والضريبة والجمارك" },
  { key: "ai.external_llm", enabled: false, description: "نموذج لغوي خارجي للمساعد", reason: "بانتظار قرار الاستضافة ومتطلبات النقل في نظام حماية البيانات الشخصية؛ يعمل الآن محرك داخلي" },
  { key: "waqf.temporary_waqf", enabled: false, description: "خيار الوقف المؤقت في معالج التأسيس", reason: "بانتظار رأي شرعي ونظامي معتمد" },
  { key: "content.english", enabled: false, description: "النسخة الإنجليزية", reason: "المرحلة الثالثة" },
  { key: "unknown_waqf.reporting", enabled: false, description: "خدمة الأوقاف المجهولة", reason: "القواعد ما زالت مشروعًا" },
];

export const NOTIFICATION_TEMPLATES = [
  { key: "obligation.reminder", titleAr: "التزام نظامي يقترب: {title}", bodyAr: "الموعد {due} — {waqf}. المرجع: {reference}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "obligation.overdue", titleAr: "فات موعد التزام نظامي: {title}", bodyAr: "{waqf} — كان الموعد {due}. الجزاء المحتمل: {penalty}", severity: "critical" as const, channels: ["in_app", "email", "sms"], locked: true },
  { key: "request.status", titleAr: "تحديث على طلبك {number}", bodyAr: "الحالة الآن: {status}", severity: "info" as const, channels: ["in_app", "email"] },
  { key: "request.awaiting_client", titleAr: "طلبك {number} بانتظارك", bodyAr: "{note}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "request.assigned", titleAr: "طلب جديد مسند إليك: {number}", bodyAr: "{service} — {waqf}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "meeting.invite", titleAr: "دعوة لاجتماع: {title}", bodyAr: "{when} — {waqf}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "minutes.sign", titleAr: "محضر بانتظار توقيعك", bodyAr: "{title}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "complaint.new", titleAr: "شكوى جديدة من مستفيد", bodyAr: "{subject} — يجب الرد قبل {due}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "complaint.answered", titleAr: "تم الرد على طلبك", bodyAr: "{subject}", severity: "info" as const, channels: ["in_app", "email"] },
  { key: "document.expiring", titleAr: "وثيقة تقترب من الانتهاء: {title}", bodyAr: "تنتهي في {date}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "invitation", titleAr: "دعوة للانضمام إلى ملف وقف", bodyAr: "دُعيت إلى {waqf} بصفة {role}", severity: "info" as const, channels: ["in_app", "sms"] },
  { key: "security.new_login", titleAr: "دخول جديد إلى حسابك", bodyAr: "من {device} في {time}. إن لم يكن أنت فغيّر بيانات الدخول فورًا.", severity: "critical" as const, channels: ["in_app", "email"], locked: true },
  { key: "invitation.accepted", titleAr: "قُبلت دعوتك", bodyAr: "{name} انضم إلى {waqf} بصفة {role}", severity: "info" as const, channels: ["in_app"] },
  { key: "assessment.reviewed", titleAr: "روجع تقييم وقفك من مختص", bodyAr: "{waqf}: الدرجة {score} — {status}", severity: "info" as const, channels: ["in_app", "email"] },
  { key: "assessment.ready", titleAr: "نتيجة تقييم وقفك جاهزة", bodyAr: "{waqf}: الدرجة {score} — {status}", severity: "info" as const, channels: ["in_app", "email"] },
];

const SERVICE_CONTRACT = `# عقد تقديم خدمة رقم {{number}}

**الطرف الأول:** {{company_name}}، سجل تجاري رقم {{company_cr}}، ويمثلها مفوَّضها النظامي.
**الطرف الثاني:** {{client_name}}{{waqf_clause}}.

## 1. محل العقد
يقدّم الطرف الأول للطرف الثاني خدمة «{{service_name}}» (رمز {{service_code}}) بالنطاق والمخرجات الآتية: {{outputs}}.
ولا يُعد الطرف الأول نائبًا أو وكيلًا عن الطرف الثاني ما لم يصدر تفويض مستقل مكتوب.

## 2. المدة والمراحل
تُنفذ الخدمة وفق مراحل سير العمل المبينة في المنصة، وتبدأ المدة المعيارية ({{sla_days}} يومًا) من اكتمال المستندات المطلوبة.

## 3. المقابل المالي
{{price_clause}} وتضاف ضريبة القيمة المضافة. يجوز تعديل المقابل باتفاق مكتوب إذا تغيّر نطاق العمل.

## 4. حدود الخدمة والقيود النظامية
{{restriction}}
مخرجات المنصة الآلية استرشادية. الآراء الشرعية والقانونية تصدر موقّعة باسم المستشار وصفته.

## 5. السرية وحماية البيانات
يلتزم الطرف الأول بسرية المعلومات وبمعالجة البيانات الشخصية للغرض المتعاقد عليه فقط، وتبقى السرية بعد انتهاء العقد.

## 6. المسؤولية
لا تتجاوز مسؤولية الطرف الأول التعاقدية قيمة هذا العقد، ولا يسري هذا الحد في حالات الغش أو الخطأ الجسيم، ولا يخل بالمسؤولية عن الفعل الضار.

## 7. الإشعارات
يتفق الطرفان على أن الإشعار عبر المنصة والبريد الإلكتروني المسجل وسيلة معتمدة للتبليغ والإعذار.

## 8. القانون الواجب التطبيق
يخضع هذا العقد لأنظمة المملكة العربية السعودية.

وقّع الطرف الثاني إلكترونيًا بالموافقة الموثقة برمز التحقق، وتحفظ المنصة بصمة نص العقد وتاريخ التوقيع.`;

export const CONTRACT_TEMPLATES = [
  { code: "service_standard", kind: "service", nameAr: "عقد تقديم خدمة", body: SERVICE_CONTRACT, version: 1 },
];
