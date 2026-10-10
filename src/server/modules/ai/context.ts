import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { assessmentResults, assessments } from "@/server/db/schema";
import type { Auth, WaqfAccess } from "@/server/authz/context";
import { OBLIGATION_STATUS_LABEL, REQUEST_STATUS_LABEL } from "@/components/portal/labels";
import { fmtBoth, relDays } from "@/lib/utils";
import { listWaqfInstances } from "../compliance/queries";
import { requiredDocumentsChecklist } from "../documents/queries";
import { CHECKLIST_LABEL } from "../documents/labels";
import { loadResultBundle } from "../assessment/queries";
import { listClientRequests } from "../requests/queries";
import { explainAssessment } from "./explain";
import type { AnswerBlock, Citation, ListItem } from "./types";

/**
 * Answers computed from the user's own waqf data. Every query runs inside the caller's RLS transaction and is
 * additionally gated by the matching waqf permission, so the assistant never shows more than the page would.
 */

export type ContextAnswer = { blocks: AnswerBlock[]; citations: Citation[] };

const noPerm = (what: string): ContextAnswer => ({
  blocks: [{ type: "p", text: `لا تملك صلاحية الاطلاع على ${what} في هذا الوقف. اطلب من الناظر منحك الصلاحية إن كنت تحتاجها.` }],
  citations: [],
});

const TONE: Record<string, ListItem["tone"]> = { overdue: "critical", due_soon: "warn", upcoming: "neutral" };

export async function answerObligations(tx: Tx, access: WaqfAccess): Promise<ContextAnswer> {
  if (!access.perms.has("compliance.view")) return noPerm("الالتزامات النظامية");
  const id = access.waqf.id;
  const items = await listWaqfInstances(tx, id, { perms: access.perms });
  const order: Record<string, number> = { overdue: 0, due_soon: 1, upcoming: 2 };
  const open = items
    .filter((i) => i.status in order)
    .sort((a, b) => order[a.status] - order[b.status] || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
  const base = `/app/w/${id}/compliance`;
  const citations: Citation[] = [{ n: 1, kind: "data", title: "سجل الالتزامات النظامية لوقفك", href: base, label: "بيانات وقفك" }];
  if (!open.length) {
    return { blocks: [{ type: "p", text: "لا توجد التزامات مفتوحة على وقفك الآن. ستظهر الالتزامات الجديدة تلقائيًا عند تحقق أسبابها." }], citations };
  }
  const n = (s: string) => open.filter((i) => i.status === s).length;
  const parts = [n("overdue") ? `${n("overdue")} متأخرة` : null, n("due_soon") ? `${n("due_soon")} يقترب موعدها` : null, n("upcoming") ? `${n("upcoming")} قادمة` : null].filter(Boolean);
  const shown = open.slice(0, 6);
  // cite each distinct regulatory requirement behind the shown obligations
  const reqCites = new Map<string, number>();
  for (const i of shown) {
    const code = i.reference.requirement;
    if (code && !reqCites.has(code)) {
      const num = citations.length + 1;
      reqCites.set(code, num);
      citations.push({ n: num, kind: "requirement", title: i.reference.source ? `${i.reference.source}${i.reference.article ? ` — ${i.reference.article}` : ""}` : i.reference.label, href: `/regulations#${code.toLowerCase()}`, label: code, snippet: i.reference.text });
    }
  }
  const blocks: AnswerBlock[] = [
    { type: "p", text: `على وقفك ${open.length} ${open.length === 1 ? "التزام مفتوح" : "التزامات مفتوحة"}: ${parts.join("، ")}. الأقرب أولًا:` },
    {
      type: "list",
      items: shown.map((i) => ({
        text: i.title,
        meta: [
          OBLIGATION_STATUS_LABEL[i.status] ?? i.status,
          i.dueImmediately && !i.dueOn ? "مستحق فورًا" : i.dueOn ? `الموعد ${fmtBoth(i.dueOn)} (${relDays(i.dueOn)})` : null,
          i.reference.label ? `المرجع: ${i.reference.label}` : null,
        ].filter(Boolean).join(" · "),
        tone: TONE[i.status],
        href: `${base}#i-${i.id}`,
        cite: i.reference.requirement ? reqCites.get(i.reference.requirement) : 1,
      })),
    },
  ];
  if (open.length > shown.length) blocks.push({ type: "p", text: `وهناك ${open.length - shown.length} التزامات أخرى في صفحة الامتثال.` });
  blocks.push({ type: "actions", items: [{ label: "افتح الامتثال والمواعيد", href: base }] });
  return { blocks, citations };
}

export async function answerAssessment(tx: Tx, access: WaqfAccess): Promise<ContextAnswer> {
  if (!access.perms.has("assessment.view")) return noPerm("التقييمات");
  const id = access.waqf.id;
  const [row] = await tx
    .select({ a: assessments })
    .from(assessments)
    .innerJoin(assessmentResults, eq(assessmentResults.assessmentId, assessments.id))
    .where(and(eq(assessments.waqfId, id), isNull(assessments.supersededBy), inArray(assessments.status, ["completed", "published", "under_review"])))
    .orderBy(desc(assessmentResults.computedAt))
    .limit(1);
  if (!row) {
    return {
      blocks: [
        { type: "p", text: "لا يوجد تقييم مكتمل لهذا الوقف بعد. التقييم الأساسي مجاني ويستغرق نحو 15 دقيقة، ويعطيك درجة لكل محور وتوصيات مرتبة." },
        { type: "actions", items: [{ label: "ابدأ التقييم", href: `/app/w/${id}/assessments` }] },
      ],
      citations: [],
    };
  }
  const b = await loadResultBundle(tx, row.a);
  if (!b) return { blocks: [{ type: "p", text: "تعذر تحميل نتيجة التقييم. افتح صفحة التقييمات وأعد المحاولة." }], citations: [] };
  const href = `/app/assessments/${row.a.id}`;
  const blocks = explainAssessment({
    number: b.number, kind: row.a.kind, status: row.a.status, href, waqfId: id, computedAt: b.result.computedAt,
    overallScore: b.result.overallScore, maturityLevel: b.result.maturityLevel, resultStatus: b.result.status, confidence: b.result.confidence,
    knowledgeGaps: b.result.knowledgeGaps, axes: b.axes.map((a) => ({ nameAr: a.nameAr, score: a.score })),
    flags: b.flags.map((f) => ({ titleAr: f.titleAr, actionAr: f.actionAr, referenceText: f.referenceText })),
    recs: b.recs.map((r) => ({ id: r.id, titleAr: r.titleAr, reasonAr: r.reasonAr, wave: r.wave, severity: r.severity, status: r.status, services: r.services })),
    reviewed: !!row.a.reviewedAt,
  });
  return { blocks, citations: [{ n: 1, kind: "data", title: `تقرير التقييم ${b.number}`, href, label: "بيانات وقفك" }] };
}

export async function answerMissingDocuments(tx: Tx, auth: Auth, access: WaqfAccess): Promise<ContextAnswer> {
  if (!access.perms.has("documents.view")) return noPerm("الوثائق");
  const id = access.waqf.id;
  const items = await requiredDocumentsChecklist(tx, id, { userId: auth.user.id, perms: access.perms });
  const base = `/app/w/${id}/documents`;
  const citations: Citation[] = [{ n: 1, kind: "data", title: "قائمة الوثائق المطلوبة لوقفك", href: base, label: "بيانات وقفك" }];
  const gaps = items.filter((i) => i.state !== "ok" && i.state !== "pending");
  if (!gaps.length) return { blocks: [{ type: "p", text: "وثائق وقفك المطلوبة مكتملة وسارية حسب قائمة التحقق." }], citations };
  const TONE_OF: Record<string, ListItem["tone"]> = { missing: "critical", expired: "critical", expiring: "warn", partial: "warn", outdated: "warn", due: "info" };
  return {
    blocks: [
      { type: "p", text: `في قائمة وثائق وقفك ${gaps.length} ${gaps.length === 1 ? "بند يحتاج" : "بنود تحتاج"} إجراء:` },
      {
        type: "list",
        items: gaps.map((g) => ({
          text: `${g.label} — ${CHECKLIST_LABEL[g.state]}`,
          meta: [g.detail, g.why].filter(Boolean).join(" · "),
          tone: TONE_OF[g.state] ?? "neutral",
          href: g.doc?.visible ? `${base}/${g.doc.id}` : base,
          cite: 1,
        })),
      },
      { type: "actions", items: [{ label: "افتح الوثائق", href: base }] },
    ],
    citations,
  };
}

export async function answerRequests(auth: Auth, access: WaqfAccess): Promise<ContextAnswer> {
  if (!access.perms.has("requests.view")) return noPerm("طلبات الخدمات");
  const id = access.waqf.id;
  const rows = await listClientRequests(auth, { waqfId: id });
  const base = `/app/w/${id}/requests`;
  const citations: Citation[] = [{ n: 1, kind: "data", title: "طلبات الخدمات لوقفك", href: base, label: "بيانات وقفك" }];
  const closed = new Set(["closed", "cancelled", "rejected", "completed"]);
  const open = rows.filter((r) => !closed.has(r.status));
  if (!rows.length) {
    return { blocks: [{ type: "p", text: "لا توجد طلبات خدمات لهذا الوقف بعد." }, { type: "actions", items: [{ label: "تصفح الخدمات", href: `/app/services` }] }], citations };
  }
  const waiting = open.filter((r) => ["awaiting_client", "awaiting_contract", "awaiting_client_approval", "quote"].includes(r.status));
  const head = open.length
    ? `لديك ${open.length} ${open.length === 1 ? "طلب مفتوح" : "طلبات مفتوحة"}${waiting.length ? `، منها ${waiting.length} بانتظار إجراء منك` : ""}:`
    : "كل طلبات هذا الوقف مغلقة أو مكتملة. آخرها:";
  const shown = (open.length ? open : rows).slice(0, 6);
  return {
    blocks: [
      { type: "p", text: head },
      {
        type: "list",
        items: shown.map((r) => ({
          text: `${r.number} — ${r.serviceName}`,
          meta: `${REQUEST_STATUS_LABEL[r.status] ?? r.status}${r.slaDueAt ? ` · الموعد المتوقع ${fmtBoth(r.slaDueAt)}` : ""}`,
          tone: waiting.includes(r) ? "warn" : "neutral",
          href: `/app/requests/${r.id}`,
          cite: 1,
        })),
      },
      { type: "actions", items: [{ label: "كل الطلبات", href: base }] },
    ],
    citations,
  };
}
