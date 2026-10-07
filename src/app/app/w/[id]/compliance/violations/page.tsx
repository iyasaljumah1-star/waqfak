import type { Metadata } from "next";
import { Gavel } from "lucide-react";
import { Alert, Badge, DataTable, EmptyState, PageHeader, Panel, type Tone } from "@/components/ui";
import { fmtDate, fmtHijri } from "@/lib/utils";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { evidenceCandidates, listViolations, penaltyOptions } from "@/server/modules/compliance/queries";
import { BAND_LABEL, PENDING_SUFFIX, penaltyInfo } from "@/server/modules/compliance/pure";
import { todayISO } from "@/server/engines/dates";
import { ViolationForm, ViolationStatusForm } from "../forms";

export const metadata: Metadata = { title: "سجل المخالفات" };

const V_STATUS_AR: Record<string, string> = { open: "مفتوحة", corrective_plan: "خطة تصحيح", appealed: "تظلّم مقدَّم", closed: "مغلقة" };
const V_STATUS_TONE: Record<string, Tone> = { open: "critical", corrective_plan: "warn", appealed: "info", closed: "ok" };
const BAND_TONE: Record<string, Tone> = { dismissal: "critical", fine: "fine", warning: "warn" };
const DISMISSAL_AR: Record<string, string> = { immediate: "عزل فوري", after_notice: "عزل بعد الإنذار", escalation: "تصعيد قد يصل إلى العزل", no: "لا عزل" };

export default async function ViolationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/compliance/violations` });
  const access = await requireWaqf(auth, id, "compliance.view");
  const canManage = waqfCan(access, "compliance.manage");
  const { rows, pens, docs } = await read(auth, async (tx) => ({
    rows: await listViolations(tx, id),
    pens: await penaltyOptions(tx),
    docs: canManage ? await evidenceCandidates(tx, id, access.perms) : [],
  }));
  const size = access.waqf.sizeClass;
  const penBy = new Map(pens.map((p) => [p.code, p]));
  const open = rows.filter((r) => r.v.status !== "closed").length;
  const groups = [...new Set(pens.map((p) => p.category))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="سجل المخالفات"
        description="المخالفات التي أبلغت بها الهيئة العامة للأوقاف هذا الوقف، مع البند في جدول المخالفات ومهلة التصحيح وموعد التظلم."
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { href: `/app/w/${id}/compliance`, label: "الامتثال" }, { label: "المخالفات" }]}
      />

      {open ? <Alert tone="critical" title={`${open} مخالفة مفتوحة`}>تابع مهلة التصحيح وموعد التظلم (60 يومًا من الإبلاغ) المضاف تلقائيًا إلى الالتزامات.</Alert> : null}

      <Panel title="المخالفات المسجلة" tight>
        <DataTable
          rows={rows}
          rowKey={(r) => r.v.id}
          caption="المخالفات المسجلة"
          empty={<div className="p-4"><EmptyState icon={Gavel} title="لا مخالفات مسجلة">سجّل هنا أي إشعار مخالفة يصل من الهيئة ليُضاف موعد التظلم إلى الالتزامات.</EmptyState></div>}
          columns={[
            {
              key: "item",
              label: "البند",
              render: (r) => {
                const p = penBy.get(r.v.penaltyCode);
                const info = penaltyInfo(p ?? null, "high", size);
                return (
                  <div>
                    <p className="font-medium"><span dir="ltr" className="tabular">{r.v.penaltyCode}</span> — {r.title ?? "بند غير معروف"}</p>
                    <p className="text-[13px] text-muted">{r.category} · التكرار {r.v.occurrence}</p>
                    {info ? <Badge tone={BAND_TONE[info.band]} className="mt-1">{BAND_LABEL[info.band]}{info.pending ? " · بانتظار التحقق" : ""}</Badge> : null}
                  </div>
                );
              },
            },
            { key: "date", label: "الإشعار", render: (r) => <span>{fmtDate(r.v.noticedOn)}<br /><span className="text-[13px] text-muted">{fmtHijri(r.v.noticedOn)}</span></span> },
            { key: "ref", label: "رقم القرار", render: (r) => <span dir="auto">{r.v.authorityRef ?? "—"}</span>, hideOnMobile: false },
            { key: "sanction", label: "الجزاء", render: (r) => r.v.sanction ?? "—" },
            { key: "deadline", label: "مهلة التصحيح", render: (r) => (r.v.correctiveDeadline ? <span>{fmtDate(r.v.correctiveDeadline)}<br /><span className="text-[13px] text-muted">{fmtHijri(r.v.correctiveDeadline)}</span></span> : "—") },
            {
              key: "status",
              label: "الحالة",
              render: (r) => (canManage ? <ViolationStatusForm waqfId={id} violationId={r.v.id} status={r.v.status} /> : <Badge tone={V_STATUS_TONE[r.v.status] ?? "neutral"}>{V_STATUS_AR[r.v.status] ?? r.v.status}</Badge>),
            },
          ]}
        />
      </Panel>

      {canManage ? (
        <Panel title="سجّل إشعار مخالفة" description="أدخل البيانات كما وردت في إشعار الهيئة. يُحسب رقم التكرار تلقائيًا ويُضاف موعد التظلم إلى الالتزامات.">
          <ViolationForm waqfId={id} penalties={pens.map((p) => ({ code: p.code, titleAr: p.titleAr, category: p.category, dismissalRisk: p.dismissalRisk }))} docs={docs} today={todayISO()} />
        </Panel>
      ) : null}

      <Panel title="جدول المخالفات والجزاءات" description={`الشريحة المعروضة لفئة حجم هذا الوقف. المبالغ والعقوبات ${PENDING_SUFFIX} حتى مطابقتها خلية بخلية مع الجدول الرسمي.`}>
        <div className="space-y-2">
          {groups.map((g) => (
            <details key={g} className="rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer font-medium">{g} <span className="text-[13px] text-muted">({pens.filter((p) => p.category === g).length})</span></summary>
              <ul className="mt-2 divide-y divide-line">
                {pens.filter((p) => p.category === g).map((p) => {
                  const info = penaltyInfo(p, "high", size)!;
                  const sizeText = size === "large" ? p.largeText : size === "medium" ? p.mediumText : p.smallText;
                  return (
                    <li key={p.code} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[14px]">
                      <span className="min-w-0 flex-1"><span dir="ltr" className="tabular text-muted">{p.code}</span> {p.titleAr}</span>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={BAND_TONE[info.band]}>{sizeText || BAND_LABEL[info.band]}</Badge>
                        {p.dismissalRisk !== "no" ? <Badge tone="critical" icon={false}>{DISMISSAL_AR[p.dismissalRisk] ?? p.dismissalRisk}</Badge> : null}
                        {p.verificationStatus !== "verified" ? <Badge tone="seal" icon={false}>بانتظار التحقق</Badge> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
