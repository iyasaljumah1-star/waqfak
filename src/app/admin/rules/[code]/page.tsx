import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { demoAssessments, listNeeds, loadRuleVersions, serviceCodeOptions } from "@/server/modules/admin/editors/rules.queries";
import { deleteRuleDraft, newRuleDraft, publishRule, retireRule, saveRule, testRule } from "@/server/modules/admin/editors/rules.actions";
import { PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE } from "@/server/modules/admin/editors/pure";
import { Alert, Badge, DataTable, PageHeader, Panel } from "@/components/ui";
import { ActionButton } from "@/components/admin-editors/editor-form";
import { RuleForm } from "@/components/admin-editors/rule-form";
import { RuleFields } from "@/components/admin-editors/rule-fields";
import { EditorPage, Flash } from "@/components/admin-editors/shell";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "قاعدة توصية" };

export default async function RuleEditor({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const code = decodeURIComponent((await params).code);
  const sp = await searchParams;
  const auth = await requireStaff("admin.rules");
  const data = await read(auth, async (tx) => ({
    versions: await loadRuleVersions(tx, code),
    needs: (await listNeeds(tx)).map((n) => n.n),
    services: await serviceCodeOptions(tx),
    assessments: await demoAssessments(tx),
  }));
  if (!data.versions.length) notFound();
  const draft = data.versions.find((v) => v.r.status === "draft")?.r ?? null;
  const published = data.versions.find((v) => v.r.status === "published")?.r ?? null;
  const current = draft ?? published ?? data.versions[0].r;
  const editable = current.status === "draft";
  const assessments = data.assessments.map((a) => ({
    id: a.id,
    label: `${a.waqf ?? a.label ?? "تقييم بلا وقف"} · ${a.kind === "deep" ? "معمّق" : "أساسي"} · ${fmtDate(a.at)} · ${Math.round(Number(a.score))}`,
  }));

  return (
    <EditorPage>
      <PageHeader
        title={<span><span dir="ltr">{code}</span> — {current.titleAr}</span>}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={PUBLISH_STATUS_TONE[current.status]}>{PUBLISH_STATUS_AR[current.status]} — الإصدار {current.version}</Badge>{published && draft ? <span>المنشور حاليًا: الإصدار {published.version}</span> : null}</span>}
        crumbs={[{ href: "/admin/rules", label: "محرك التوصيات" }, { label: code }]}
      />
      <Flash sp={sp} />
      {editable ? (
        <Panel title="النشر" description="اختبر القاعدة أولًا. النشر يحل محل الإصدار المنشور السابق ويُطبّق على التقييمات التي تُحسب بعده؛ التقييمات السابقة تحتفظ بالإصدار الذي حُسبت به.">
          <div className="flex flex-wrap items-start gap-3">
            <ActionButton action={publishRule} fields={{ ruleId: current.id }} label={`انشر الإصدار ${current.version}`} variant="primary" size="md" confirmText={`نشر الإصدار ${current.version} من ${code}؟`} />
            <ActionButton action={deleteRuleDraft} fields={{ ruleId: current.id }} label="احذف المسودة" variant="ghost" size="md" confirmText="حذف هذه المسودة؟" />
          </div>
        </Panel>
      ) : (
        <Alert
          tone="info"
          title={current.status === "published" ? "الإصدار المنشور لا يُعدّل" : "القاعدة موقوفة"}
          action={
            <div className="flex flex-wrap gap-2">
              <ActionButton action={newRuleDraft} fields={{ code }} label="أنشئ مسودة تعديل" variant="primary" />
              {current.status === "published" ? <ActionButton action={retireRule} fields={{ ruleId: current.id }} label="أوقف القاعدة" variant="ghost" confirmText="إيقاف القاعدة؟ لن تظهر في التقييمات الجديدة." /> : null}
            </div>
          }
        >
          يمكنك اختبارها كما هي أدناه، ولتعديلها أنشئ مسودة إصدار جديد.
        </Alert>
      )}
      <Panel title={editable ? `تحرير المسودة (الإصدار ${current.version})` : `الإصدار ${current.version}`}>
        <RuleForm save={saveRule} test={testRule} code={code} readOnly={!editable}>
          <RuleFields r={current} isNew={false} readOnly={!editable} needs={data.needs} services={data.services} assessments={assessments} />
        </RuleForm>
      </Panel>
      <Panel title="سجل الإصدارات" tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={data.versions}
            rowKey={(v) => v.r.id}
            caption="إصدارات القاعدة"
            columns={[
              { key: "v", label: "الإصدار", render: (v) => <span className="tabular font-medium">v{v.r.version}</span> },
              { key: "s", label: "الحالة", render: (v) => <Badge tone={PUBLISH_STATUS_TONE[v.r.status]}>{PUBLISH_STATUS_AR[v.r.status]}</Badge> },
              { key: "p", label: "النشر", render: (v) => (v.r.publishedAt ? fmtDateTime(v.r.publishedAt) : "—") },
              { key: "a", label: "آخر تعديل", render: (v) => `${fmtDateTime(v.r.updatedAt)}${v.author ? ` — ${v.author}` : ""}`, hideOnMobile: true },
              { key: "f", label: "الظهور", render: (v) => <span className="tabular">{v.r.timesFired}</span>, hideOnMobile: true },
              { key: "c", label: "الشرط", render: (v) => <code dir="ltr" className="block max-w-md truncate text-[12px] text-muted">{JSON.stringify(v.r.condition)}</code>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </EditorPage>
  );
}
