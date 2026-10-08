import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Route } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { changeLog, listObligations, listPenalties, listReferences, listRequirements } from "@/server/modules/admin/editors/compliance.queries";
import { PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE, REQ_STATUS_AR, SEVERITY_OPTIONS, SEVERITY_TONE, VERIFICATION_AR } from "@/server/modules/admin/editors/pure";
import { CATEGORY_AR } from "@/server/modules/compliance/pure";
import { eventLabel } from "@/server/modules/compliance/engine";
import { Badge, ButtonLink, DataTable, PageHeader, Panel } from "@/components/ui";
import { EditorPage, Flash, TabNav } from "@/components/admin-editors/shell";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "محرك الامتثال" };

const TABS = ["obligations", "requirements", "references", "penalties", "log"] as const;
type Tab = (typeof TABS)[number];
const ENTITY_AR: Record<string, string> = { obligation: "التزام", requirement: "متطلب", reference: "مصدر", penalty: "بند جزاء", rule: "قاعدة" };
const BINDING_AR: Record<string, string> = { binding: "ملزم", guidance: "إرشادي", draft: "مسودة", reference: "مرجعي" };
const DISMISSAL_AR: Record<string, string> = { immediate: "عزل مباشر", after_notice: "عزل بعد إنذار", escalation: "تصعيد", no: "لا" };
const verTone = (v: string) => (v === "verified" ? "ok" : "warn") as "ok" | "warn";

export default async function ComplianceAdmin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.compliance");
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "obligations";
  const data = await read(auth, async (tx) => ({
    obligations: await listObligations(tx),
    requirements: await listRequirements(tx),
    references: await listReferences(tx),
    penalties: await listPenalties(tx),
    log: tab === "log" ? await changeLog(tx, { limit: 200 }) : [],
  }));
  const NEW: Partial<Record<Tab, { href: string; label: string }>> = {
    obligations: { href: "/admin/compliance/obligations/new", label: "التزام جديد" },
    requirements: { href: "/admin/compliance/requirements/new", label: "متطلب جديد" },
    references: { href: "/admin/compliance/references/new", label: "مصدر جديد" },
    penalties: { href: "/admin/compliance/penalties/new", label: "بند جديد" },
  };
  const action = NEW[tab];

  return (
    <EditorPage wide>
      <PageHeader
        title="محرك الامتثال"
        description="المصادر النظامية ومتطلباتها والتزاماتها وجدول المخالفات بيانات قابلة للتعديل. أي التزام يُضاف أو يُعدّل هنا يُطبّق على الأوقاف المنطبقة فور الحفظ دون تعديل برمجي، ويُسجّل في سجل تغييرات الامتثال."
        actions={
          <>
            <ButtonLink href="/admin/traceability" variant="secondary"><Route aria-hidden className="size-4" /> سجل التتبع</ButtonLink>
            {action ? <ButtonLink href={action.href}><Plus aria-hidden className="size-4" /> {action.label}</ButtonLink> : null}
          </>
        }
      />
      <Flash sp={sp} />
      <TabNav
        label="أقسام محرك الامتثال"
        current={tab}
        tabs={[
          { key: "obligations", label: "الالتزامات", href: "/admin/compliance", count: data.obligations.length },
          { key: "requirements", label: "المتطلبات", href: "/admin/compliance?tab=requirements", count: data.requirements.length },
          { key: "references", label: "المصادر النظامية", href: "/admin/compliance?tab=references", count: data.references.length },
          { key: "penalties", label: "جدول المخالفات", href: "/admin/compliance?tab=penalties", count: data.penalties.length },
          { key: "log", label: "سجل التغييرات", href: "/admin/compliance?tab=log" },
        ]}
      />

      {tab === "obligations" ? (
        <Panel tight>
          <div className="px-3 md:px-2">
            <DataTable
              rows={data.obligations}
              rowKey={(r) => r.o.id}
              caption="الالتزامات"
              columns={[
                { key: "c", label: "الرمز", render: (r) => <Link href={`/admin/compliance/obligations/${r.o.id}`} className="tabular font-semibold text-ink hover:underline" dir="ltr">{r.o.code}</Link> },
                { key: "t", label: "الالتزام", render: (r) => <span>{r.o.titleAr}<span className="block text-[12px] text-muted">{r.o.referenceText}{r.req ? ` · ${r.req}` : ""}</span></span> },
                { key: "e", label: "الحدث والموعد", render: (r) => <span className="text-[14px]">{eventLabel(r.o.triggerEvent)}{r.o.offsetValue !== null ? ` + ${r.o.offsetValue} ${r.o.offsetUnit}` : ""}{r.o.recurrence === "annual" ? " · سنوي" : ""}</span>, hideOnMobile: true },
                { key: "k", label: "الفئة", render: (r) => CATEGORY_AR[r.o.obligationType] ?? r.o.obligationType, hideOnMobile: true },
                { key: "s", label: "الخطورة", render: (r) => <Badge tone={SEVERITY_TONE[r.o.severity]}>{SEVERITY_OPTIONS.find((o) => o.value === r.o.severity)?.label}</Badge> },
                { key: "w", label: "أوقاف / مفتوح", render: (r) => <span className="tabular">{r.waqfs} / {r.open}</span> },
                { key: "st", label: "الحالة", render: (r) => <span className="flex flex-wrap gap-1"><Badge tone={PUBLISH_STATUS_TONE[r.o.status]}>{PUBLISH_STATUS_AR[r.o.status]}</Badge>{r.o.verificationStatus !== "verified" ? <Badge tone="warn" icon={false}>بانتظار التحقق</Badge> : null}</span> },
              ]}
            />
          </div>
        </Panel>
      ) : null}

      {tab === "requirements" ? (
        <Panel tight>
          <div className="px-3 md:px-2">
            <DataTable
              rows={data.requirements}
              rowKey={(r) => r.r.id}
              caption="المتطلبات النظامية"
              columns={[
                { key: "c", label: "الرمز", render: (r) => <Link href={`/admin/compliance/requirements/${r.r.id}`} className="tabular font-semibold text-ink hover:underline" dir="ltr">{r.r.code}</Link> },
                { key: "t", label: "المتطلب", render: (r) => r.r.title },
                { key: "src", label: "المصدر", render: (r) => <span className="text-[13px]">{r.refName ?? "—"}{r.r.article ? ` ${r.r.article}` : ""}</span>, hideOnMobile: true },
                { key: "i", label: "التنفيذ", render: (r) => <span className="tabular">{r.r.implementedAs.length}</span>, hideOnMobile: true },
                { key: "s", label: "الحالة", render: (r) => <span className="flex flex-wrap gap-1"><Badge tone={r.r.status === "implemented" ? "ok" : r.r.status === "excluded" ? "neutral" : "warn"}>{REQ_STATUS_AR[r.r.status] ?? r.r.status}</Badge>{r.r.verificationStatus !== "verified" ? <Badge tone="warn" icon={false}>{VERIFICATION_AR[r.r.verificationStatus]}</Badge> : null}</span> },
              ]}
            />
          </div>
        </Panel>
      ) : null}

      {tab === "references" ? (
        <Panel tight>
          <div className="px-3 md:px-2">
            <DataTable
              rows={data.references}
              rowKey={(r) => r.r.id}
              caption="المصادر النظامية"
              columns={[
                { key: "c", label: "الرمز", render: (r) => <Link href={`/admin/compliance/references/${r.r.id}`} className="tabular font-semibold text-ink hover:underline" dir="ltr">{r.r.code}</Link> },
                { key: "n", label: "المصدر", render: (r) => <span>{r.r.sourceName}<span className="block text-[12px] text-muted">{r.r.decisionRef ?? ""}</span></span> },
                { key: "b", label: "الإلزام", render: (r) => BINDING_AR[r.r.bindingLevel] ?? r.r.bindingLevel, hideOnMobile: true },
                { key: "q", label: "المتطلبات", render: (r) => <span className="tabular">{r.requirements}</span>, hideOnMobile: true },
                { key: "v", label: "التحقق", render: (r) => <span><Badge tone={verTone(r.r.verificationStatus)}>{VERIFICATION_AR[r.r.verificationStatus]}</Badge>{r.r.lastVerifiedOn ? <span className="block text-[12px] text-muted">{fmtDate(r.r.lastVerifiedOn)}</span> : null}</span> },
              ]}
            />
          </div>
        </Panel>
      ) : null}

      {tab === "penalties" ? (
        <Panel tight>
          <div className="px-3 md:px-2">
            <DataTable
              rows={data.penalties}
              rowKey={(r) => r.id}
              caption="جدول المخالفات"
              columns={[
                { key: "c", label: "البند", render: (r) => <Link href={`/admin/compliance/penalties/${r.id}`} className="tabular font-semibold text-ink hover:underline" dir="ltr">{r.code}</Link> },
                { key: "t", label: "المخالفة", render: (r) => <span>{r.titleAr}<span className="block text-[12px] text-muted">{r.category}</span></span> },
                { key: "l", label: "كبير / متوسط / صغير", render: (r) => <span className="text-[13px]">{[r.largeText, r.mediumText, r.smallText].map((x) => x ?? "—").join(" · ")}</span>, hideOnMobile: true },
                { key: "d", label: "العزل", render: (r) => DISMISSAL_AR[r.dismissalRisk] ?? r.dismissalRisk },
                { key: "v", label: "التحقق", render: (r) => <Badge tone={verTone(r.verificationStatus)}>{VERIFICATION_AR[r.verificationStatus]}</Badge> },
              ]}
            />
          </div>
        </Panel>
      ) : null}

      {tab === "log" ? (
        <Panel tight>
          <div className="px-3 md:px-2">
            <DataTable
              rows={data.log}
              rowKey={(r) => r.l.id}
              caption="سجل تغييرات الامتثال"
              empty={<p className="p-6 text-center text-muted">لا تغييرات مسجلة بعد.</p>}
              columns={[
                { key: "a", label: "الوقت", render: (r) => fmtDateTime(r.l.at) },
                { key: "u", label: "بواسطة", render: (r) => r.actor ?? "النظام" },
                { key: "e", label: "السجل", render: (r) => <span>{ENTITY_AR[r.l.entityType] ?? r.l.entityType} <span dir="ltr" className="tabular">{String(r.l.change.code ?? "")}</span></span> },
                {
                  key: "c", label: "التغيير",
                  render: (r) => {
                    const ch = r.l.change as { action?: string; version?: number; appliesNow?: number; diff?: { field: string }[] };
                    const verb = ch.action === "create" ? "إنشاء" : ch.action === "delete" ? "حذف" : "تعديل";
                    return (
                      <span className="text-[14px]">
                        {verb}{ch.version ? ` — الإصدار ${ch.version}` : ""}
                        {typeof ch.appliesNow === "number" ? ` · ينطبق على ${ch.appliesNow} وقفًا` : ""}
                        {ch.diff?.length ? <span className="block text-[12px] text-muted" dir="ltr">{ch.diff.map((d) => d.field).join(", ")}</span> : null}
                      </span>
                    );
                  },
                },
              ]}
            />
          </div>
        </Panel>
      ) : null}
    </EditorPage>
  );
}
