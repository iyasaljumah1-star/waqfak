/**
 * Meaning-bearing icons for the public site. Each icon names a category, audience, content kind or tool,
 * so the same concept always carries the same mark across pages (never decoration only).
 */
import {
  BookOpen,
  Building2,
  Calculator,
  CalendarClock,
  ClipboardCheck,
  Compass,
  FileStack,
  FlaskConical,
  HandHeart,
  KeyRound,
  Network,
  Newspaper,
  Percent,
  Ruler,
  Scale,
  ScrollText,
  ShieldCheck,
  Shapes,
  Sprout,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Service categories (service_categories.code). */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  T: Sprout, // التأسيس والتصميم
  W: ScrollText, // الوصايا
  N: KeyRound, // النظارة والإدارة
  G: Network, // الحوكمة والبناء المؤسسي
  F: Calculator, // المالية والمحاسبة
  I: TrendingUp, // الاستثمار والأصول
  C: ShieldCheck, // الامتثال والتقارير والاستشارات
};
export const categoryIcon = (code: string | null | undefined): LucideIcon => (code && CATEGORY_ICON[code[0]]) || Shapes;

/** Audience pages (/for/[who]) and the home paths. */
export const AUDIENCE_ICON: Record<string, LucideIcon> = {
  waqif: HandHeart,
  nazir: UserCog,
  beneficiary: Users,
  entities: Building2,
};

/** Library content kinds. */
export const KIND_ICON: Record<string, LucideIcon> = {
  article: Newspaper,
  guide: BookOpen,
  regulation: Scale,
  study: FlaskConical,
  template: FileStack,
};
export const kindIcon = (kind: string): LucideIcon => KIND_ICON[kind] ?? BookOpen;

/** Free tools. */
export const TOOL_ICON: Record<string, LucideIcon> = {
  "waqf-type": Compass,
  "waqf-size": Ruler,
  "registration-deadline": CalendarClock,
  "will-third": Percent,
  "nazir-readiness": ClipboardCheck,
};
