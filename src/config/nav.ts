/**
 * Navigation registry (single source for portal, waqf file and admin menus).
 * Feature teams add pages at the listed hrefs; the shells render menus from here, filtered by permission.
 * Icon names are lucide-react component names.
 */
export type NavItem = { href: string; label: string; icon: string; perm?: string; mobile?: boolean };

export const PORTAL_NAV: NavItem[] = [
  { href: "/app", label: "الرئيسية", icon: "LayoutDashboard", mobile: true },
  { href: "/app/waqfs", label: "أوقافي", icon: "Landmark", mobile: true },
  { href: "/app/tasks", label: "مهامي", icon: "ListChecks", mobile: true },
  { href: "/app/calendar", label: "التقويم والالتزامات", icon: "CalendarClock" },
  { href: "/app/requests", label: "طلباتي", icon: "ClipboardList" },
  { href: "/app/assessments", label: "تقييماتي", icon: "Gauge" },
  { href: "/app/establish", label: "تأسيس وقف جديد", icon: "Sprout" },
  { href: "/app/wills", label: "الوصايا", icon: "ScrollText" },
  { href: "/app/services", label: "الخدمات والباقات", icon: "Briefcase" },
  { href: "/app/billing", label: "الفواتير والمدفوعات", icon: "Receipt" },
  { href: "/app/notifications", label: "الإشعارات", icon: "Bell", mobile: true },
];

export const ACCOUNT_NAV: NavItem[] = [
  { href: "/app/profile", label: "ملفي الشخصي", icon: "UserRound" },
  { href: "/app/security", label: "الأمان والجلسات", icon: "ShieldCheck" },
  { href: "/app/privacy", label: "خصوصيتي وبياناتي", icon: "Fingerprint" },
];

/** Waqf file sections: /app/w/[id]/<segment>. */
export const WAQF_NAV: (NavItem & { segment: string })[] = [
  { segment: "", href: "", label: "نظرة عامة", icon: "LayoutDashboard", perm: "waqf.view" },
  { segment: "identity", href: "identity", label: "الهوية والتسجيل", icon: "IdCard", perm: "waqf.view" },
  { segment: "deed", href: "deed", label: "الوثيقة والشروط", icon: "ScrollText", perm: "deed.view" },
  { segment: "parties", href: "parties", label: "الأطراف والنظارة", icon: "Users", perm: "waqf.view" },
  { segment: "beneficiaries", href: "beneficiaries", label: "المستفيدون", icon: "HeartHandshake", perm: "beneficiaries.view" },
  { segment: "assets", href: "assets", label: "الأصول والاستثمار", icon: "Building2", perm: "assets.view" },
  { segment: "finance", href: "finance", label: "المالية والصرف", icon: "Wallet", perm: "finance.summary" },
  { segment: "governance", href: "governance", label: "الحوكمة والاجتماعات", icon: "Gavel", perm: "governance.view" },
  { segment: "compliance", href: "compliance", label: "الامتثال والمواعيد", icon: "CalendarClock", perm: "compliance.view" },
  { segment: "risks", href: "risks", label: "المخاطر", icon: "TriangleAlert", perm: "compliance.view" },
  { segment: "documents", href: "documents", label: "الوثائق", icon: "FolderLock", perm: "documents.view" },
  { segment: "assessments", href: "assessments", label: "التقييمات", icon: "Gauge", perm: "assessment.view" },
  { segment: "requests", href: "requests", label: "الخدمات والطلبات", icon: "ClipboardList", perm: "requests.view" },
  { segment: "tasks", href: "tasks", label: "المهام", icon: "ListChecks", perm: "waqf.view" },
  { segment: "complaints", href: "complaints", label: "الشكاوى والاستفسارات", icon: "MessagesSquare", perm: "complaints.handle" },
  { segment: "reports", href: "reports", label: "التقارير", icon: "FileBarChart", perm: "reports.generate" },
  { segment: "assistant", href: "assistant", label: "المساعد الذكي", icon: "Sparkles", perm: "ai.use" },
  { segment: "audit", href: "audit", label: "سجل العمليات", icon: "History", perm: "audit.view_waqf" },
  { segment: "settings", href: "settings", label: "الأعضاء والإعدادات", icon: "Settings", perm: "waqf.members.manage" },
];

export const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "لوحة الشركة", icon: "LayoutDashboard", perm: "admin.access" },
  { href: "/admin/requests", label: "الطلبات", icon: "ClipboardList", perm: "staff.requests.assigned" },
  { href: "/admin/waqfs", label: "الأوقاف", icon: "Landmark", perm: "admin.waqfs.all" },
  { href: "/admin/clients", label: "العملاء", icon: "Contact", perm: "admin.users" },
  { href: "/admin/assessments", label: "التقييمات المعمّقة", icon: "Gauge", perm: "staff.assessment_review" },
  { href: "/admin/services", label: "الخدمات والباقات والأسعار", icon: "Briefcase", perm: "admin.services" },
  { href: "/admin/question-bank", label: "بنك الأسئلة", icon: "ListTree", perm: "admin.rules" },
  { href: "/admin/rules", label: "محرك التوصيات", icon: "Workflow", perm: "admin.rules" },
  { href: "/admin/compliance", label: "محرك الامتثال", icon: "Scale", perm: "admin.compliance" },
  { href: "/admin/traceability", label: "سجل تتبع المتطلبات", icon: "Route", perm: "admin.compliance" },
  { href: "/admin/content", label: "المحتوى والمكتبة", icon: "BookOpen", perm: "admin.content" },
  { href: "/admin/users", label: "المستخدمون والأدوار", icon: "UsersRound", perm: "admin.users" },
  { href: "/admin/finance", label: "الفواتير والمدفوعات", icon: "Receipt", perm: "admin.finance" },
  { href: "/admin/notifications", label: "الإشعارات والرسائل", icon: "Bell", perm: "admin.notifications" },
  { href: "/admin/mlro", label: "الامتثال الداخلي (MLRO)", icon: "ShieldAlert", perm: "mlro.access" },
  { href: "/admin/audit", label: "سجل العمليات", icon: "History", perm: "admin.audit" },
  { href: "/admin/settings", label: "الإعدادات والتراخيص", icon: "Settings", perm: "admin.settings" },
];
