/**
 * Template-based explanations of the user's own structured data (pure; unit-tested).
 * Nothing here is generated freely: every sentence is filled from fields of the assessment result.
 */
import { RESULT_STATUS_LABEL } from "@/components/portal/labels";
import type { AnswerBlock, ListItem } from "./types";

export type AssessmentSummaryInput = {
  number: string;
  kind: "basic" | "deep" | string;
  status: string; // assessment lifecycle status
  href: string;
  waqfId: string;
  computedAt: Date | string;
  overallScore: number;
  maturityLevel: string;
  resultStatus: string;
  confidence: string;
  knowledgeGaps: number;
  axes: { nameAr: string; score: number | null }[];
  flags: { titleAr: string; actionAr: string | null; referenceText: string }[];
  recs: { id: string; titleAr: string; reasonAr: string; wave: number; severity: string; status: string; services: { code: string; nameAr: string }[] }[];
  reviewed: boolean;
};

const CONF_AR: Record<string, string> = { low: "منخفضة", medium: "متوسطة", high: "مرتفعة" };
const WAVE_AR: Record<number, string> = { 1: "خلال 30 يومًا", 2: "خلال 90 يومًا", 3: "خلال 12 شهرًا" };
const SEV_TONE: Record<string, ListItem["tone"]> = { critical: "critical", high: "fine", medium: "warn", low: "neutral" };
const fmt = (n: number) => new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 1 }).format(n);
const day = (d: Date | string) => new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(new Date(d));

export function explainAssessment(a: AssessmentSummaryInput): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const kind = a.kind === "deep" ? "التقييم المعمّق" : "التقييم الأساسي";
  const status = RESULT_STATUS_LABEL[a.resultStatus] ?? a.resultStatus;
  blocks.push({
    type: "p",
    text: `آخر تقييم مكتمل لوقفك هو ${kind} رقم ${a.number} بتاريخ ${day(a.computedAt)}. الدرجة العامة ${fmt(a.overallScore)} من 100، والحالة «${status}»، ومستوى النضج «${a.maturityLevel}». الثقة في النتيجة ${CONF_AR[a.confidence] ?? a.confidence}${a.knowledgeGaps ? `، وفيه ${fmt(a.knowledgeGaps)} إجابات بـ«لا أعرف» تحتاج استكمالًا` : ""}.${a.reviewed ? " راجع مختص هذه النتيجة." : ""}`,
  });
  const scored = a.axes.filter((x): x is { nameAr: string; score: number } => x.score !== null);
  if (scored.length >= 2) {
    const sorted = [...scored].sort((x, y) => y.score - x.score);
    const top = sorted.slice(0, 2).map((x) => `${x.nameAr} (${fmt(x.score)})`).join(" و");
    const low = sorted.slice(-2).reverse().map((x) => `${x.nameAr} (${fmt(x.score)})`).join(" و");
    blocks.push({ type: "p", text: `أعلى المحاور: ${top}. أضعف المحاور: ${low}.` });
  }
  if (a.flags.length) {
    blocks.push({ type: "p", text: `رصد التقييم ${fmt(a.flags.length)} ${a.flags.length === 1 ? "ملاحظة حرجة" : "ملاحظات حرجة"} تحتاج معالجة أولًا:` });
    blocks.push({
      type: "list",
      items: a.flags.slice(0, 4).map((f) => ({ text: f.actionAr ? `${f.titleAr} — ${f.actionAr}` : f.titleAr, meta: f.referenceText || undefined, tone: "critical" })),
    });
  }
  const open = a.recs.filter((r) => r.status === "open" || r.status === "accepted").slice(0, 3);
  if (open.length) {
    blocks.push({ type: "p", text: "أهم التوصيات:" });
    blocks.push({
      type: "list",
      items: open.map((r) => ({
        text: `${r.titleAr}: ${r.reasonAr}`,
        meta: `${WAVE_AR[r.wave] ?? ""}${r.services[0] ? ` · الخدمة المقترحة: ${r.services[0].nameAr}` : ""}`,
        tone: SEV_TONE[r.severity] ?? "neutral",
        href: r.services[0] ? `/app/requests/new?service=${r.services[0].code}&waqf=${a.waqfId}&rec=${r.id}` : undefined,
      })),
    });
  }
  blocks.push({ type: "actions", items: [{ label: "افتح تقرير التقييم كاملًا", href: a.href }] });
  return blocks;
}
