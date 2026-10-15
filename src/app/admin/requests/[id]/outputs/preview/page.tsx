import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, FileDown } from "lucide-react";
import { Alert, Badge, PageHeader, Panel } from "@/components/ui";
import { SectionView } from "@/components/outputs/section-view";
import { SaveDraftForm } from "@/components/outputs/save-draft";
import { requireStaff } from "@/server/authz/context";
import { generateOutput } from "@/server/modules/outputs/actions";
import { DRAFT_STATUSES } from "@/server/modules/outputs/pure";
import { outputPreviewData } from "@/server/modules/outputs/queries";
import { STATUS_LABEL } from "@/server/modules/requests/workflow";

export const metadata: Metadata = { title: "معاينة مخرج" };

/**
 * Preview of an output before any draft is saved: built from the request's current data, nothing is stored and no
 * status changes. Saving the draft (version 1) is a separate, explicit action.
 */
export default async function OutputPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ key?: string }> }) {
  const { id } = await params;
  const { key } = await searchParams;
  const auth = await requireStaff("admin.access");
  if (!key || !/^[A-Z]\d{2}\.[a-z]+(@c\d+)?$/.test(key)) notFound();
  const d = await outputPreviewData(auth, id, key);
  if (!d) notFound();
  if (d.existingId) redirect(`/admin/requests/${id}/outputs/${d.existingId}`);
  const { rc, preview } = d;
  if (!preview) notFound();
  const canDeliver = auth.perms.has("staff.deliver") && (rc.isAssignee || rc.isOps);
  const canSave = canDeliver && DRAFT_STATUSES.includes(rc.req.status) && (!preview.cycle || (preview.cycle.status === "open" && rc.req.status === "in_progress"));
  const { blocking, unwritten, warnings } = preview.ready;
  const incomplete = blocking.length > 0 || unwritten.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/admin/requests", label: "الطلبات" }, { href: `/admin/requests/${id}#outputs`, label: rc.req.number }, { label: "معاينة" }]}
        title={preview.def.title}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone="info" icon={false}>معاينة غير محفوظة</Badge>{incomplete ? <Badge tone="fine" icon={false}>مسودة غير مكتملة</Badge> : null}<span>{d.formatLabel}</span><span>· {d.specialtyLabel}</span><span className="text-muted">· {d.reviewLabel}</span></span>}
        actions={<a href={`/admin/requests/${id}/outputs/preview/pdf?key=${encodeURIComponent(key)}`} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-3 text-sm text-ink hover:bg-ink-soft" data-testid="preview-pdf"><FileDown aria-hidden className="size-4" />PDF للمعاينة</a>}
      />

      <div data-testid="live-preview-banner"><Alert tone="info" title="معاينة من البيانات الحالية — لم تُحفظ مسودة بعد">
        هذا ما تُبنى منه المسودة الآن من بيانات الطلب والوقف والمراجع. لا يُحفظ شيء ولا تتغير حالة الطلب أو مهامه بفتحها.
        {canSave ? " احفظها مسودة لتحريرها وإرسالها للمراجعة." : rc.req.status && !DRAFT_STATUSES.includes(rc.req.status) ? ` لا تُحفظ مسودة جديدة والطلب «${STATUS_LABEL[rc.req.status as keyof typeof STATUS_LABEL]}».` : ""}
      </Alert></div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {blocking.length || unwritten.length || warnings.length ? (
            <Panel title="ما ينقص قبل الاعتماد" description="النواقص الجوهرية والأجزاء التي يكتبها المختص تمنع الإرسال للمراجعة والاعتماد. لا يُملأ ما نقص بقيمة افتراضية.">
              <ul className="space-y-1 text-[15px]" data-testid="output-gaps">
                {blocking.map((g) => <li key={g.key} className="text-critical">● {g.label}{g.hint ? <span className="text-muted"> — {g.hint}</span> : null}</li>)}
                {unwritten.map((u, i) => <li key={i} className="text-critical">● يكتبه المختص: {u.section}</li>)}
                {warnings.map((g) => <li key={g.key} className="text-fine">● {g.label}{g.hint ? <span className="text-muted"> — {g.hint}</span> : null}</li>)}
              </ul>
            </Panel>
          ) : <Alert tone="ok" title="لا نواقص في البيانات الحالية" />}
          <Panel title="المحتوى المتاح الآن">
            <div className="space-y-6" data-testid="live-preview">{preview.sections.filter((s) => !s.removed).map((s) => <SectionView key={s.key} s={s} />)}</div>
          </Panel>
        </div>
        <aside className="min-w-0 space-y-4">
          <Panel title="الإجراءات">
            <div className="space-y-3">
              {canSave ? <SaveDraftForm action={generateOutput} requestId={id} outputKey={key} /> : <p className="text-[13px] text-muted">{canDeliver ? "لا تُحفظ مسودة لهذا المخرج في حالة الطلب الحالية." : "حفظ المسودة لمن يعدّ المخرج: المختص المسند أو المدير المخوّل."}</p>}
              <p className="flex items-center gap-1 text-[13px] text-muted"><Eye aria-hidden className="size-4" />فتح المعاينة لا يعتمد شيئًا ولا يغير حالة.</p>
              <Link href={`/admin/requests/${id}${preview.cycle ? "#service" : "#outputs"}`} className="block text-[14px] text-ink hover:underline">العودة إلى الطلب</Link>
            </div>
          </Panel>
          {preview.sources.length ? (
            <Panel title="المراجع">
              <ul className="space-y-1 text-[13px]">{preview.sources.map((x) => <li key={x.code}>{x.label} <span className="text-muted">({x.status === "verified" ? "من ملفات المشروع" : x.status === "pending_verification" ? "بانتظار التحقق" : "تعريف داخلي"})</span></li>)}</ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
