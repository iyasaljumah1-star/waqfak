/**
 * Role & permission catalog. Seeded into the database; the database copy is the runtime source of truth
 * and can be edited from the admin panel (roles → permissions).
 */

export const PERMISSIONS = {
  // waqf-scoped
  "waqf.view": ["عرض بيانات الوقف", "waqf"],
  "waqf.edit": ["تعديل بيانات الوقف", "waqf"],
  "waqf.members.manage": ["إدارة أطراف الوقف والدعوات", "waqf"],
  "deed.view": ["عرض الوثيقة والشروط", "deed"],
  "deed.edit": ["تعديل الوثيقة والشروط", "deed"],
  "conditions.interpret": ["اعتماد تفسير الشرط", "deed"],
  "assets.view": ["عرض الأصول", "assets"],
  "assets.edit": ["إدارة الأصول", "assets"],
  "finance.view": ["عرض المالية", "finance"],
  "finance.summary": ["عرض ملخص مالي", "finance"],
  "finance.edit": ["إدخال القيود والموازنة", "finance"],
  "finance.approve": ["اعتماد الموازنة والقوائم", "finance"],
  "statements.view": ["الاطلاع على القوائم المالية", "finance"],
  "beneficiaries.view": ["عرض سجل المستفيدين", "beneficiaries"],
  "beneficiaries.edit": ["إدارة المستفيدين", "beneficiaries"],
  "beneficiaries.self": ["عرض استحقاقي", "beneficiaries"],
  "bo.view": ["عرض سجل المستفيد الحقيقي", "beneficiaries"],
  "bo.edit": ["تحديث المستفيد الحقيقي", "beneficiaries"],
  "distributions.approve": ["اعتماد الصرف", "finance"],
  "governance.view": ["عرض الاجتماعات والقرارات", "governance"],
  "governance.manage": ["إدارة الاجتماعات والمحاضر", "governance"],
  "governance.vote": ["التصويت", "governance"],
  "coi.declare": ["الإقرار بتعارض المصالح", "governance"],
  "documents.view": ["عرض الوثائق العادية", "documents"],
  "documents.view_confidential": ["عرض الوثائق السرية", "documents"],
  "documents.view_secret": ["عرض الوثائق السرية جدًا", "documents"],
  "documents.upload": ["رفع الوثائق", "documents"],
  "documents.approve": ["اعتماد الوثائق", "documents"],
  "documents.share": ["مشاركة الوثائق", "documents"],
  "assessment.run": ["إجراء التقييم", "assessment"],
  "assessment.view": ["عرض التقييمات", "assessment"],
  "requests.create": ["طلب الخدمات", "requests"],
  "requests.view": ["عرض الطلبات", "requests"],
  "contracts.sign": ["توقيع العقود", "requests"],
  "complaints.create": ["رفع الشكاوى", "complaints"],
  "complaints.handle": ["معالجة الشكاوى", "complaints"],
  "compliance.view": ["عرض الامتثال", "compliance"],
  "compliance.manage": ["إدارة الالتزامات", "compliance"],
  "risks.manage": ["إدارة سجل المخاطر", "compliance"],
  "ai.use": ["استخدام المساعد الذكي", "ai"],
  "audit.view_waqf": ["عرض سجل عمليات الوقف", "audit"],
  "reports.generate": ["توليد التقارير", "reports"],
  "suspicion.report": ["رفع بلاغ اشتباه", "compliance"],
  // global / staff
  "admin.access": ["دخول لوحة الإدارة", "admin"],
  "admin.users": ["إدارة المستخدمين", "admin"],
  "admin.roles": ["إدارة الأدوار والصلاحيات", "admin"],
  "admin.services": ["إدارة الخدمات والباقات", "admin"],
  "admin.pricing": ["إدارة الأسعار والخصومات", "admin"],
  "admin.rules": ["إدارة بنك الأسئلة والقواعد", "admin"],
  "admin.compliance": ["إدارة الالتزامات والمراجع النظامية", "admin"],
  "admin.content": ["إدارة المحتوى", "admin"],
  "admin.settings": ["إدارة الإعدادات", "admin"],
  "admin.audit": ["عرض سجل العمليات الشامل", "admin"],
  "admin.requests.all": ["عرض كل الطلبات وتوزيعها", "admin"],
  "admin.waqfs.all": ["عرض كل الأوقاف", "admin"],
  "admin.notifications": ["إدارة قوالب الإشعارات", "admin"],
  "admin.finance": ["الفواتير والمدفوعات", "admin"],
  "admin.reports": ["تقارير الشركة", "admin"],
  "admin.clients.edit": ["تعديل بيانات حسابات العملاء والمستخدمين", "admin"],
  "admin.pii.view": ["عرض البيانات الشخصية كاملة (الجوال والبريد)", "admin"],
  "requests.quotes.approve": ["اعتماد عروض الأسعار قبل إرسالها", "admin"],
  "admin.contracts.approve": ["اعتماد العقود والتوقيع عن الشركة", "admin"],
  "approvals.direct": ["الاعتماد المباشر ولو كان المعتمِد معدّ المعاملة (يُسجَّل اعتمادًا ذاتيًا، ولا يتجاوز سياسة فصل معتمدة)", "admin"],
  // corporate nazara (Waqfak as legal-entity nazir)
  "nazara.view": ["عرض لوحة النظارة الاعتبارية", "nazara"],
  "nazara.manage": ["إدارة ملفات النظارة: الاستلام والتحقق والفريق", "nazara"],
  "nazara.approve": ["اعتماد قبول النظارة ومباشرتها وإنهائها وتقاريرها", "nazara"],
  "staff.requests.assigned": ["العمل على الطلبات المسندة", "staff"],
  "staff.deliver": ["رفع المخرجات", "staff"],
  "staff.quality_review": ["مراجعة الجودة", "staff"],
  "staff.assessment_review": ["مراجعة التقييم المعمّق", "staff"],
  "mlro.access": ["سجلات مكافحة غسل الأموال", "staff"],
  "breakglass.approve": ["اعتماد الوصول الطارئ", "staff"],
} as const satisfies Record<string, readonly [string, string]>;

export type Permission = keyof typeof PERMISSIONS;

const ALL_WAQF: Permission[] = [
  "waqf.view", "waqf.edit", "waqf.members.manage", "deed.view", "deed.edit", "assets.view", "assets.edit",
  "finance.view", "finance.summary", "finance.edit", "finance.approve", "statements.view", "beneficiaries.view",
  "beneficiaries.edit", "bo.view", "bo.edit", "distributions.approve", "governance.view", "governance.manage",
  "coi.declare", "documents.view", "documents.view_confidential", "documents.view_secret", "documents.upload",
  "documents.approve", "documents.share", "assessment.run", "assessment.view", "requests.create", "requests.view",
  "contracts.sign", "complaints.handle", "compliance.view", "compliance.manage", "risks.manage", "ai.use",
  "audit.view_waqf", "reports.generate", "suspicion.report",
];

export const ROLES: Record<string, { nameAr: string; scope: "global" | "waqf"; permissions: Permission[]; globalAccess?: boolean }> = {
  // ── waqf-scoped roles
  founder: {
    nameAr: "واقف", scope: "waqf",
    permissions: ["waqf.view", "deed.view", "conditions.interpret", "assets.view", "finance.summary", "statements.view",
      "governance.view", "documents.view", "documents.upload", "assessment.run", "assessment.view", "requests.create",
      "requests.view", "contracts.sign", "compliance.view", "coi.declare", "ai.use", "reports.generate"],
  },
  nazir: { nameAr: "ناظر", scope: "waqf", permissions: ALL_WAQF },
  board_chair: {
    nameAr: "رئيس مجلس النظارة", scope: "waqf",
    permissions: ALL_WAQF.filter((p) => p !== "documents.view_secret").concat(["governance.vote"]),
  },
  board_member: {
    nameAr: "عضو مجلس نظارة", scope: "waqf",
    permissions: ["waqf.view", "deed.view", "assets.view", "finance.view", "finance.summary", "statements.view",
      "beneficiaries.view", "governance.view", "governance.vote", "coi.declare", "documents.view",
      "documents.view_confidential", "assessment.view", "requests.view", "compliance.view", "ai.use"],
  },
  board_secretary: {
    nameAr: "أمين سر المجلس", scope: "waqf",
    permissions: ["waqf.view", "deed.view", "governance.view", "governance.manage", "coi.declare", "documents.view",
      "documents.view_confidential", "documents.upload", "compliance.view"],
  },
  committee_member: {
    nameAr: "عضو لجنة", scope: "waqf",
    permissions: ["waqf.view", "assets.view", "finance.summary", "governance.view", "governance.vote", "coi.declare", "documents.view"],
  },
  executive: {
    nameAr: "مدير تنفيذي للوقف", scope: "waqf",
    permissions: ["waqf.view", "waqf.edit", "deed.view", "assets.view", "assets.edit", "finance.view", "finance.summary",
      "finance.edit", "beneficiaries.view", "beneficiaries.edit", "bo.view", "bo.edit", "governance.view", "documents.view",
      "documents.view_confidential", "documents.upload", "assessment.run", "assessment.view", "requests.create",
      "requests.view", "complaints.handle", "compliance.view", "compliance.manage", "risks.manage", "ai.use", "coi.declare"],
  },
  delegated_manager: {
    nameAr: "مفوَّض بالإدارة", scope: "waqf",
    permissions: ["waqf.view", "waqf.edit", "deed.view", "assets.view", "assets.edit", "finance.view", "finance.edit",
      "beneficiaries.view", "documents.view", "documents.view_confidential", "documents.upload", "requests.view",
      "compliance.view", "compliance.manage", "coi.declare"],
  },
  agent: {
    nameAr: "وكيل", scope: "waqf",
    // effective permissions are the intersection with the power-of-attorney scope
    permissions: ["waqf.view", "deed.view", "documents.view", "documents.upload", "assessment.run", "assessment.view",
      "requests.create", "requests.view", "contracts.sign"],
  },
  beneficiary: {
    nameAr: "مستفيد", scope: "waqf",
    permissions: ["beneficiaries.self", "statements.view", "complaints.create"],
  },
  external_auditor: {
    nameAr: "مراجع خارجي", scope: "waqf",
    permissions: ["waqf.view", "finance.view", "statements.view", "beneficiaries.view", "documents.view", "documents.view_confidential", "governance.view"],
  },
  viewer: { nameAr: "مشاهد", scope: "waqf", permissions: ["waqf.view"] },
  // Staff studying a nazara request before acceptance (read-only); replaced by «nazir»/«executive» on activation.
  nazara_reviewer: {
    nameAr: "فريق دراسة النظارة", scope: "waqf",
    permissions: ["waqf.view", "deed.view", "assets.view", "finance.view", "finance.summary", "statements.view", "beneficiaries.view",
      "governance.view", "documents.view", "documents.view_confidential", "compliance.view", "requests.view"],
  },

  // ── global (staff / platform) roles
  super_admin: {
    nameAr: "مسؤول النظام الأعلى", scope: "global", globalAccess: true,
    permissions: ["admin.access", "admin.users", "admin.roles", "admin.services", "admin.pricing", "admin.rules",
      "admin.compliance", "admin.content", "admin.settings", "admin.audit", "admin.requests.all", "admin.waqfs.all",
      "admin.notifications", "admin.finance", "admin.reports", "breakglass.approve", "staff.requests.assigned",
      "staff.deliver", "staff.quality_review", "staff.assessment_review", "admin.clients.edit", "admin.pii.view",
      "nazara.view", "nazara.manage", "nazara.approve", "requests.quotes.approve", "admin.contracts.approve", "approvals.direct"],
  },
  system_admin: {
    // manages configuration and users but does not read waqf content
    nameAr: "مسؤول النظام", scope: "global",
    permissions: ["admin.access", "admin.users", "admin.roles", "admin.settings", "admin.notifications"],
  },
  management: {
    nameAr: "الإدارة العليا", scope: "global", globalAccess: true,
    permissions: ["admin.access", "admin.reports", "admin.requests.all", "admin.waqfs.all", "admin.finance", "admin.audit", "breakglass.approve",
      "requests.quotes.approve", "admin.contracts.approve"],
  },
  ops_manager: {
    nameAr: "مدير التشغيل", scope: "global", globalAccess: true,
    permissions: ["admin.access", "admin.requests.all", "admin.waqfs.all", "admin.services", "admin.pricing", "admin.compliance",
      "admin.reports", "staff.requests.assigned", "staff.deliver", "staff.quality_review", "staff.assessment_review", "breakglass.approve",
      "nazara.view", "nazara.manage", "requests.quotes.approve", "admin.contracts.approve"],
  },
  // Corporate nazara team. The manager approves acceptance, activation, ending and reports; the officer runs the file.
  // A team member's access to a waqf comes from the engagement's team membership (waqf-scoped), not from these roles.
  nazara_manager: {
    nameAr: "مدير النظارة الاعتبارية", scope: "global", globalAccess: true,
    permissions: ["admin.access", "nazara.view", "nazara.manage", "nazara.approve", "staff.requests.assigned", "staff.deliver"],
  },
  nazara_officer: {
    nameAr: "موظف النظارة", scope: "global",
    permissions: ["admin.access", "nazara.view", "nazara.manage", "staff.requests.assigned", "staff.deliver"],
  },
  account_manager: {
    nameAr: "مدير حساب", scope: "global",
    permissions: ["admin.access", "staff.requests.assigned", "staff.deliver"],
  },
  consultant_sharia: { nameAr: "مستشار شرعي", scope: "global", permissions: ["admin.access", "staff.requests.assigned", "staff.deliver", "staff.quality_review", "staff.assessment_review"] },
  consultant_legal: { nameAr: "مستشار قانوني", scope: "global", permissions: ["admin.access", "staff.requests.assigned", "staff.deliver", "staff.quality_review", "staff.assessment_review"] },
  consultant_finance: { nameAr: "مستشار مالي", scope: "global", permissions: ["admin.access", "staff.requests.assigned", "staff.deliver", "staff.quality_review", "staff.assessment_review"] },
  consultant_investment: { nameAr: "مستشار استثماري", scope: "global", permissions: ["admin.access", "staff.requests.assigned", "staff.deliver", "staff.quality_review"] },
  employee: { nameAr: "موظف تشغيل", scope: "global", permissions: ["admin.access", "staff.requests.assigned", "staff.deliver"] },
  mlro: { nameAr: "مسؤول الامتثال (MLRO)", scope: "global", permissions: ["admin.access", "mlro.access"] },
  content_editor: { nameAr: "محرر محتوى", scope: "global", permissions: ["admin.access", "admin.content"] },
  security_auditor: { nameAr: "مدقق أمن", scope: "global", permissions: ["admin.access", "admin.audit"] },
};

/** Permissions a staff member gets on a waqf where they hold an active assignment (request). */
/**
 * While a waqf is being established (idea, draft or documenting) and no nazir or board chair holds it on the platform,
 * the founder establishing it completes its file: data, deed text, assets, masarif, the board's composition and who is
 * invited to the file. These lapse by themselves once the waqf is documented or a nazir/chair is on the platform; from
 * then on the nazara manages the file. Operations (finance, beneficial owners, distributions) are never included.
 */
export const ESTABLISHING_FOUNDER_PERMS: Permission[] = [
  "waqf.edit", "deed.edit", "assets.edit", "beneficiaries.view", "beneficiaries.edit", "governance.manage", "waqf.members.manage",
];
export const ESTABLISHING_STATUSES = ["idea", "draft", "documenting"] as const;

export const STAFF_ASSIGNED_WAQF_PERMS: Permission[] = [
  "waqf.view", "deed.view", "assets.view", "finance.view", "finance.summary", "statements.view", "beneficiaries.view",
  "governance.view", "documents.view", "documents.view_confidential", "documents.upload", "assessment.view", "requests.view",
  "compliance.view", "ai.use",
];

/** Role labels for UI. */
export const roleName = (key: string) => ROLES[key]?.nameAr ?? key;

export const WAQF_ROLE_KEYS = Object.entries(ROLES).filter(([, r]) => r.scope === "waqf").map(([k]) => k);
export const GLOBAL_ROLE_KEYS = Object.entries(ROLES).filter(([, r]) => r.scope === "global").map(([k]) => k);
