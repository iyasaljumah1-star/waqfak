/**
 * Recommendation engine (pure, deterministic, explainable).
 * Facts → (rules) → Needs → Services → prioritized Action Plan in 3 waves.
 *   Priority = Severity × Urgency × Leverage
 *   Severity: critical 10, high 6, medium 3, low 1
 *   Urgency: 3 if regulatory deadline ≤ 30 days or overdue, 2 if ≤ 90 days, else 1
 *   Waves: 1 = every critical + overdue (30 days); 2 = high (90 days); 3 = the rest (12 months)
 * Post-filters: conflict of interest (Waqfak as nazir/manager), license gates, active litigation, GAA nazara,
 * de-duplication against open requests, and package bundling.
 */
import { test, type Facts, type Logic } from "./logic";

export type Rule = {
  id: string;
  code: string;
  version: number;
  titleAr: string;
  condition: Logic;
  needCode: string;
  severity: "critical" | "high" | "medium" | "low";
  urgencyDays: number;
  leverage: number;
  reasonAr: string;
  whyItMattersAr?: string | null;
  reference?: string | null;
  serviceCodes: string[];
  suppressIf?: Logic | null;
  selfServiceHintAr?: string | null;
};

export type ServiceInfo = {
  code: string;
  nameAr: string;
  conflictRule: string; // none | blocked_if_waqfak_nazir | blocked_if_waqfak_controls_finance | inside_nazara_only
  requiresLicenseKey?: string | null;
  isActive: boolean;
};

export type RecContext = {
  waqfakRole: "none" | "advisor" | "delegated_manager" | "nazir" | "board_member" | "bookkeeper";
  activeLicenses: string[];
  hasActiveLitigation: boolean;
  gaaIsNazir: boolean;
  openServiceCodes: string[];
};

export type Recommendation = {
  ruleId: string;
  ruleCode: string;
  ruleVersion: number;
  needCode: string;
  severity: Rule["severity"];
  priority: number;
  wave: 1 | 2 | 3;
  titleAr: string;
  reasonAr: string;
  whyItMattersAr: string | null;
  reference: string | null;
  serviceCodes: string[];
  removedServices: { code: string; why: string }[];
  selfServiceHintAr: string | null;
  status: "open" | "suppressed";
  suppressedNote: string | null;
};

const SEVERITY_SCORE = { critical: 10, high: 6, medium: 3, low: 1 } as const;

export function urgencyFactor(days: number): number {
  return days <= 30 ? 3 : days <= 90 ? 2 : 1;
}

const LITIGATION_SENSITIVE = /^NEED\.(SHR|REG\.AMEND|INV\.SUBST|AST\.SUBST)/;
const NAZARA_SERVICES = new Set(["N01", "N02", "N03", "N04", "N05", "N06", "N07"]);

export function runRules(rules: Rule[], facts: Facts, services: ServiceInfo[], ctx: RecContext) {
  const svc = new Map(services.map((s) => [s.code, s]));
  const fired: Recommendation[] = [];
  const seenNeeds = new Set<string>();

  for (const rule of rules) {
    let matched = false;
    try {
      matched = test(rule.condition, facts);
    } catch {
      matched = false; // a malformed rule never blocks the engine; it is reported in admin
    }
    if (!matched || seenNeeds.has(rule.needCode)) continue;
    seenNeeds.add(rule.needCode);

    let status: Recommendation["status"] = "open";
    let suppressedNote: string | null = null;
    if (rule.suppressIf && test(rule.suppressIf, { ...facts, waqfak_role: ctx.waqfakRole })) {
      status = "suppressed";
      suppressedNote = "يُعالج ضمن نطاق دور وقفك الحالي في الوقف.";
    }

    const removed: { code: string; why: string }[] = [];
    const kept: string[] = [];
    for (const code of rule.serviceCodes) {
      const s = svc.get(code);
      if (!s || !s.isActive) {
        removed.push({ code, why: "الخدمة غير متاحة حاليًا." });
        continue;
      }
      // Separation of duties (لائحة تنظيم أعمال النظارة م18؛ استقلال المراجعة م15/4)
      if (ctx.waqfakRole === "nazir" && (s.conflictRule === "blocked_if_waqfak_nazir" || s.conflictRule === "blocked_if_waqfak_controls_finance")) {
        removed.push({ code, why: "وقفك ناظر على هذا الوقف؛ تُعالج ضمن أجر النظارة أو بمراجع مستقل، ولا تُباع خدمة منفصلة (م18/2)." });
        continue;
      }
      if (["delegated_manager", "bookkeeper"].includes(ctx.waqfakRole) && s.conflictRule === "blocked_if_waqfak_controls_finance") {
        removed.push({ code, why: "استقلال المراجعة: لا يراجع القوائم من يديرها أو يمسك دفاترها؛ يُعيَّن مراجع مستقل." });
        continue;
      }
      if (s.requiresLicenseKey && !ctx.activeLicenses.includes(s.requiresLicenseKey)) {
        removed.push({ code, why: "تتطلب ترخيصًا لم يُسجّل بعد في المنصة." });
        continue;
      }
      if (ctx.gaaIsNazir && NAZARA_SERVICES.has(code)) {
        removed.push({ code, why: "الهيئة العامة للأوقاف هي الناظر على هذا الوقف." });
        continue;
      }
      if (ctx.openServiceCodes.includes(code)) {
        removed.push({ code, why: "يوجد طلب مفتوح لهذه الخدمة." });
        continue;
      }
      kept.push(code);
    }

    if (ctx.hasActiveLitigation && LITIGATION_SENSITIVE.test(rule.needCode) && status === "open") {
      status = "suppressed";
      suppressedNote = "معلّقة بسبب نزاع قضائي قائم؛ الأولوية للخدمة القانونية.";
    }

    const urgency = urgencyFactor(rule.urgencyDays);
    const priority = Math.round(SEVERITY_SCORE[rule.severity] * urgency * (rule.leverage || 1) * 100) / 100;
    const wave: 1 | 2 | 3 = rule.severity === "critical" || rule.urgencyDays <= 30 ? 1 : rule.severity === "high" || rule.urgencyDays <= 90 ? 2 : 3;

    fired.push({
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleVersion: rule.version,
      needCode: rule.needCode,
      severity: rule.severity,
      priority,
      wave,
      titleAr: rule.titleAr,
      reasonAr: rule.reasonAr,
      whyItMattersAr: rule.whyItMattersAr ?? null,
      reference: rule.reference ?? null,
      serviceCodes: kept,
      removedServices: removed,
      selfServiceHintAr: rule.selfServiceHintAr ?? null,
      status,
      suppressedNote,
    });
  }

  fired.sort((a, b) => a.wave - b.wave || b.priority - a.priority);
  return fired;
}

export type PackageInfo = { code: string; nameAr: string; serviceCodes: string[]; targetSizeClasses: string[]; isClosed: boolean };

/** Suggests a package when it covers ≥ 4 of the recommended services and fits the waqf size. */
export function suggestPackage(recs: Recommendation[], pkgs: PackageInfo[], sizeClass: string | null, waqfakRole: string): { code: string; covers: number } | null {
  const wanted = new Set(recs.filter((r) => r.status === "open").flatMap((r) => r.serviceCodes));
  let best: { code: string; covers: number } | null = null;
  for (const p of pkgs) {
    if (p.isClosed && waqfakRole !== "nazir") continue;
    if (sizeClass && p.targetSizeClasses.length && !p.targetSizeClasses.includes(sizeClass)) continue;
    const covers = p.serviceCodes.filter((c) => wanted.has(c)).length;
    if (covers >= 4 && (!best || covers > best.covers)) best = { code: p.code, covers };
  }
  return best;
}
