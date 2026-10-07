import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, type Tone } from "@/components/ui";
import { cn, fmtBoth, daysUntil } from "@/lib/utils";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listRisks, waqfMemberOptions } from "@/server/modules/compliance/queries";
import { RISK_CATEGORIES, RISK_CATEGORY_AR, RISK_LEVEL_AR, RISK_STATUSES, RISK_STATUS_AR, riskBand } from "@/server/modules/compliance/pure";
import { RiskForm } from "./forms";

export const metadata: Metadata = { title: "سجل المخاطر" };

const BAND_TONE: Record<string, Tone> = { high: "critical", medium: "fine", low: "ok" };
const CELL: Record<string, string> = { high: "bg-critical-soft text-critical", medium: "bg-fine-soft text-fine", low: "bg-ok-soft text-ok" };

export default async function RisksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/risks` });
  const access = await requireWaqf(auth, id, "compliance.view");
  const canManage = waqfCan(access, "risks.manage");
  const { rows, owners } = await read(auth, async (tx) => ({ rows: await listRisks(tx, id), owners: canManage ? await waqfMemberOptions(tx, id) : [] }));
  const active = rows.filter((r) => r.r.status !== "closed");
  const categories = RISK_CATEGORIES.map((c) => ({ value: c, label: RISK_CATEGORY_AR[c] }));
  const statuses = RISK_STATUSES.map((s) => ({ value: s, label: RISK_STATUS_AR[s] }));
  const ownerOpts = owners.map((o) => ({ value: o.id, label: o.name ?? "عضو" }));
  const matrix = (impact: number, likelihood: number) => active.filter((r) => r.r.impact === impact && r.r.likelihood === likelihood).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="سجل المخاطر"
        description="المخاطر التي تهدد أصول الوقف وغلته واستمراريته، بتقدير الأثر والاحتمال وخطة المعالجة ومالك كل خطر."
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { label: "المخاطر" }]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title={`المخاطر (${rows.length})`} tight>
          {rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map(({ r, owner }) => {
                const b = riskBand(r.impact, r.likelihood);
                const left = daysUntil(r.reviewOn);
                return (
                  <li key={r.id} className={cn("px-4 py-4 md:px-5", r.status === "closed" && "opacity-70")}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.title}</p>
                        <p className="text-[13px] text-muted">
                          {RISK_CATEGORY_AR[r.category] ?? r.category} · الأثر {RISK_LEVEL_AR[r.impact]} · الاحتمال {RISK_LEVEL_AR[r.likelihood]}
                          {owner ? <> · المالك: {owner}</> : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={BAND_TONE[b.band]}>درجة {b.score} — {b.label}</Badge>
                        <Badge tone={r.status === "closed" ? "neutral" : "ink"} icon={false}>{RISK_STATUS_AR[r.status] ?? r.status}</Badge>
                      </div>
                    </div>
                    {r.treatment ? <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-[14px] leading-7">{r.treatment}</p> : null}
                    {r.reviewOn ? (
                      <p className={cn("mt-1 text-[13px]", left !== null && left < 0 && r.status !== "closed" ? "font-medium text-critical" : "text-muted")}>
                        المراجعة: {fmtBoth(r.reviewOn)}{left !== null && left < 0 && r.status !== "closed" ? " — فات موعد المراجعة" : ""}
                      </p>
                    ) : null}
                    {canManage ? (
                      <details className="mt-2 text-[14px]">
                        <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">عدّل</summary>
                        <div className="mt-3">
                          <RiskForm waqfId={id} categories={categories} statuses={statuses} owners={ownerOpts} risk={{ id: r.id, title: r.title, category: r.category, impact: r.impact, likelihood: r.likelihood, treatment: r.treatment, ownerUserId: r.ownerUserId, reviewOn: r.reviewOn, status: r.status }} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-4">
              <EmptyState icon={ShieldAlert} title="لا مخاطر مسجلة">
                {canManage ? "أضف أول خطر من النموذج أدناه. ابدأ بمخاطر تركّز الأصول والسيولة والنزاعات." : "لم يسجل مدير الوقف مخاطر بعد."}
              </EmptyState>
            </div>
          )}
        </Panel>

        <Panel title="خريطة المخاطر" description="عدد المخاطر غير المغلقة حسب الأثر والاحتمال.">
          <table className="w-full table-fixed border-separate border-spacing-1 text-center text-[13px]" aria-label="خريطة المخاطر">
            <thead>
              <tr>
                <th scope="col" className="w-16 text-muted"><span className="sr-only">الأثر</span></th>
                {[1, 2, 3].map((l) => <th key={l} scope="col" className="font-medium text-muted">احتمال {RISK_LEVEL_AR[l]}</th>)}
              </tr>
            </thead>
            <tbody>
              {[3, 2, 1].map((i) => (
                <tr key={i}>
                  <th scope="row" className="font-medium text-muted">أثر {RISK_LEVEL_AR[i]}</th>
                  {[1, 2, 3].map((l) => {
                    const n = matrix(i, l);
                    return (
                      <td key={l} className={cn("h-14 rounded-md font-semibold tabular", CELL[riskBand(i, l).band], !n && "opacity-50")}>
                        {n}
                        <span className="sr-only"> خطر</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {canManage ? (
        <Panel title="أضف خطرًا">
          <RiskForm waqfId={id} categories={categories} statuses={statuses} owners={ownerOpts} />
        </Panel>
      ) : null}
    </div>
  );
}
