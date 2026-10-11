export const SETTINGS: [string, unknown, string][] = [
  ["company.profile", {
    nameAr: "شركة وقفك", nameEn: "Waqfak", legalForm: "شركة ذات مسؤولية محدودة", crNumber: "", unifiedNumber: "", vatNumber: "",
    nationalAddress: "", phone: "", email: "", website: "waqfak.sa",
  }, "بيانات الشركة المعروضة في التذييل والعقود والتقارير"],
  ["company.licenses", [
    { key: "legal_consulting", nameAr: "ترخيص الاستشارات القانونية", number: "", issuer: "", expiresOn: "" },
    { key: "financial_audit", nameAr: "ترخيص المراجعة المالية", number: "", issuer: "", expiresOn: "" },
    { key: "gaa_nazara_license", nameAr: "ترخيص الهيئة العامة للأوقاف للناظر الاعتباري", number: "", issuer: "الهيئة العامة للأوقاف", expiresOn: "", active: false },
  ], "التراخيص: الأرقام فارغة حتى تعبئتها. ترخيص النظارة غير مفعّل حتى صدوره (شرط مباشرة النظارة على الأوقاف الحقيقية)."],
  ["assessment.maturity_bands", [{ min: 90, level: "رائد" }, { min: 75, level: "متقدم" }, { min: 60, level: "مُدار" }, { min: 40, level: "ناشئ" }, { min: 0, level: "تأسيسي" }], "حدود مستويات النضج"],
  ["assessment.reassess_months", 6, "تذكير بإعادة التقييم"],
  ["requests.default_vat_rate", 15, "نسبة ضريبة القيمة المضافة"],
  ["complaints.sla_days", 10, "مهلة الرد على شكاوى المستفيدين (أيام)"],
  ["documents.max_upload_mb", 50, "الحد الأقصى لحجم الملف"],
  ["security.session_idle_minutes", 30, "مهلة الخمول للبوابة"],
];

/** Reason the nazara flag was first seeded with (licence-gated intake); replaced once if no admin changed it since. */
export const LEGACY_NAZARA_FLAG_REASON = "بانتظار ترخيص الهيئة العامة للأوقاف للناظر الاعتباري (لائحة النظارة م5/2)";

export const FEATURE_FLAGS = [
  { key: "service.nazara", enabled: true, description: "استقبال طلبات تولي النظارة (N01)", reason: "تُستقبل الطلبات وتُدرس ملفاتها؛ ومباشرة النظارة على وقف حقيقي مشروطة بترخيص الهيئة العامة للأوقاف للناظر الاعتباري (لائحة النظارة م5/2)" },
  { key: "auth.nafath", enabled: false, description: "الدخول عبر النفاذ الوطني", reason: "بانتظار التحقق من أهلية الربط وشروطه" },
  { key: "payments.live", enabled: false, description: "الدفع الإلكتروني الحي", reason: "بانتظار حساب بوابة دفع مرخصة؛ يعمل الآن في وضع تجريبي" },
  { key: "einvoice.zatca", enabled: false, description: "الربط مع الفوترة الإلكترونية", reason: "بانتظار بيانات التسجيل لدى هيئة الزكاة والضريبة والجمارك" },
  { key: "ai.external_llm", enabled: false, description: "نموذج لغوي خارجي للمساعد", reason: "بانتظار قرار الاستضافة ومتطلبات النقل في نظام حماية البيانات الشخصية؛ يعمل الآن محرك داخلي" },
  { key: "waqf.temporary_waqf", enabled: false, description: "خيار الوقف المؤقت في معالج التأسيس", reason: "بانتظار رأي شرعي ونظامي معتمد" },
  { key: "content.english", enabled: false, description: "النسخة الإنجليزية", reason: "المرحلة الثالثة" },
  { key: "unknown_waqf.reporting", enabled: false, description: "خدمة الأوقاف المجهولة", reason: "القواعد ما زالت مشروعًا" },
];

export const NOTIFICATION_TEMPLATES = [
  { key: "obligation.reminder", titleAr: "موعد التزام نظامي يقترب: {title}", bodyAr: "الموعد {due} — {waqf}. المرجع: {reference}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "obligation.overdue", titleAr: "فات موعد التزام نظامي: {title}", bodyAr: "{waqf} — كان الموعد {due}. الجزاء المحتمل: {penalty}", severity: "critical" as const, channels: ["in_app", "email", "sms"], locked: true },
  { key: "request.status", titleAr: "تحديث على طلبك {number}", bodyAr: "الحالة الآن: {status}", severity: "info" as const, channels: ["in_app", "email"] },
  { key: "request.awaiting_client", titleAr: "طلبك {number} بانتظار إجراء منك", bodyAr: "{note}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "request.assigned", titleAr: "طلب جديد مسند إليك: {number}", bodyAr: "{service} — {waqf}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "nazara.update", titleAr: "النظارة {number}: {status}", bodyAr: "{waqf} — {note}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "meeting.invite", titleAr: "دعوة لاجتماع: {title}", bodyAr: "{when} — {waqf}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "minutes.sign", titleAr: "محضر بانتظار توقيعك", bodyAr: "{title}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "complaint.new", titleAr: "شكوى جديدة من مستفيد", bodyAr: "{subject} — موعد الرد: {due}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "complaint.answered", titleAr: "تم الرد على طلبك", bodyAr: "{subject}", severity: "info" as const, channels: ["in_app", "email"] },
  { key: "document.expiring", titleAr: "وثيقة تقترب من الانتهاء: {title}", bodyAr: "تنتهي في {date}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "invitation", titleAr: "دعوة للانضمام إلى ملف وقف", bodyAr: "دُعيت إلى {waqf} بصفة {role}", severity: "info" as const, channels: ["in_app", "sms"] },
  { key: "security.new_login", titleAr: "دخول جديد إلى حسابك", bodyAr: "من {device} في {time}. إن لم تكن أنت، فغيّر بيانات الدخول فورًا.", severity: "critical" as const, channels: ["in_app", "email"], locked: true },
  { key: "invitation.accepted", titleAr: "قُبلت دعوتك", bodyAr: "انضم {name} إلى {waqf} بصفة {role}", severity: "info" as const, channels: ["in_app"] },
  { key: "assessment.reviewed", titleAr: "روجع تقييم وقفك من مختص", bodyAr: "{waqf}: الدرجة {score} — {status}", severity: "info" as const, channels: ["in_app", "email"] },
  { key: "assessment.ready", titleAr: "نتيجة تقييم وقفك جاهزة", bodyAr: "{waqf}: الدرجة {score} — {status}", severity: "info" as const, channels: ["in_app", "email"] },
  { key: "task.assigned", titleAr: "مهمة جديدة مسندة إليك: {title}", bodyAr: "{waqf} — الموعد {due}", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "task.comment", titleAr: "تعليق جديد على مهمة: {title}", bodyAr: "افتح المهمة للاطلاع على التعليق.", severity: "info" as const, channels: ["in_app"] },
  { key: "breakglass.requested", titleAr: "طلب وصول طارئ بانتظار اعتمادك", bodyAr: "{name} يطلب وصولًا طارئًا إلى الوقف {waqf}.", severity: "important" as const, channels: ["in_app", "email"] },
  { key: "breakglass.approved", titleAr: "اعتُمد وصولك الطارئ", bodyAr: "الوقف {waqf} — لمدة {hours} ساعة. كل اطلاع مسجّل.", severity: "important" as const, channels: ["in_app"] },
  { key: "breakglass.waqf_notice", titleAr: "فُتح وصول طارئ على ملف وقفك", bodyAr: "{waqf} — لمدة {hours} ساعة لأغراض الدعم. يمكنك مراجعة سجل العمليات.", severity: "critical" as const, channels: ["in_app", "email"], locked: true },
  { key: "security.mfa_reset", titleAr: "أُعيد ضبط التحقق بخطوتين في حسابك", bodyAr: "نفّذه فريق الدعم في {time}. إن لم تطلبه، فتواصل معنا فورًا.", severity: "critical" as const, channels: ["in_app", "email", "sms"], locked: true },
  { key: "privacy.request_closed", titleAr: "أُغلق طلبك المتعلق ببياناتك", bodyAr: "الحالة: {status}. {note}", severity: "info" as const, channels: ["in_app", "email"] },
  { key: "contact.new", titleAr: "رسالة تواصل جديدة: {topic}", bodyAr: "من {name}", severity: "info" as const, channels: ["in_app"] },
];

const SERVICE_CONTRACT = `# عقد تقديم خدمة رقم {{number}}

**الطرف الأول:** {{company_name}}، سجل تجاري رقم {{company_cr}}، ويمثلها مفوَّضها النظامي.
**الطرف الثاني:** {{client_name}}{{waqf_clause}}.

## 1. محل العقد
يقدّم الطرف الأول للطرف الثاني خدمة «{{service_name}}» (رمز {{service_code}}) بالنطاق والمخرجات الآتية: {{outputs}}.
ولا يُعد الطرف الأول نائبًا أو وكيلًا عن الطرف الثاني ما لم يصدر تفويض مستقل مكتوب.

## 2. المدة والمراحل
تُنفَّذ الخدمة وفق مراحل سير العمل المبينة في المنصة، وتُحتسب المدة المعيارية ({{sla_days}} يومًا) من تاريخ اكتمال المستندات المطلوبة.

## 3. المقابل المالي
{{price_clause}} وتُضاف إليه ضريبة القيمة المضافة. ويجوز تعديل المقابل باتفاق مكتوب إذا تغيّر نطاق العمل.

## 4. حدود الخدمة والقيود النظامية
{{restriction}}
المخرجات الآلية للمنصة، كالتقييمات والتذكيرات، تقديرية مبنية على البيانات المدخلة ولا تُعد رأيًا مهنيًا. وتصدر الآراء الشرعية والقانونية مكتوبة موقّعة باسم المستشار وصفته.

## 5. السرية وحماية البيانات
يلتزم الطرف الأول بسرية المعلومات، وبمعالجة البيانات الشخصية للغرض المتعاقد عليه فقط، ويبقى التزام السرية قائمًا بعد انتهاء العقد.

## 6. المسؤولية
لا تتجاوز مسؤولية الطرف الأول التعاقدية قيمة هذا العقد. ولا يسري هذا الحد في حالات الغش أو الخطأ الجسيم، ولا يخل بالمسؤولية عن الفعل الضار.

## 7. الإشعارات
يتفق الطرفان على أن الإشعار عبر المنصة والبريد الإلكتروني المسجل وسيلة معتمدة للتبليغ والإعذار.

## 8. القانون الواجب التطبيق
يخضع هذا العقد لأنظمة المملكة العربية السعودية.

وقّع الطرف الثاني إلكترونيًا بالموافقة الموثقة برمز التحقق، وتحفظ المنصة بصمة نص العقد وتاريخ التوقيع.`;

export const CONTRACT_TEMPLATES = [
  { code: "service_standard", kind: "service", nameAr: "عقد تقديم خدمة", body: SERVICE_CONTRACT, version: 1 },
];
