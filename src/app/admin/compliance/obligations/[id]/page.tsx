import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { instanceCounts, loadObligation, obligationFormOptions } from "@/server/modules/admin/editors/compliance.queries";
import { previewObligation, saveObligation } from "@/server/modules/admin/editors/compliance.actions";
import { PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE } from "@/server/modules/admin/editors/pure";
import { Badge, PageHeader, Panel, Stat } from "@/components/ui";
import { ObligationForm } from "@/components/admin-editors/obligation-form";
import { ObligationFields } from "@/components/admin-editors/obligation-fields";
import { ChangeList, EditorPage, Flash } from "@/components/admin-editors/shell";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "تعديل التزام" };

export default async function ObligationEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.compliance");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, async (tx) => ({ ob: await loadObligation(tx, id), opts: await obligationFormOptions(tx), counts: await instanceCounts(tx, id) }));
  if (!data.ob) notFound();
  const { o, log } = data.ob;
  const req = data.opts.reqs.find((r) => r.id === o.requirementId);
  return (
    <EditorPage>
      <PageHeader
        title={<span><span dir="ltr">{o.code}</span> — {o.titleAr}</span>}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={PUBLISH_STATUS_TONE[o.status]}>{PUBLISH_STATUS_AR[o.status]}</Badge><span>الإصدار {o.version}</span>{req ? <Link href={`/admin/compliance/requirements/${req.id}`} className="text-ink underline">{req.code}</Link> : null}</span>}
        crumbs={[{ href: "/admin/compliance", label: "محرك الامتثال" }, { label: o.code }]}
      />
      <Flash sp={sp} />
      <section aria-label="أثر الالتزام" className="grid gap-3 sm:grid-cols-3">
        <Stat label="أوقاف لديها استحقاق مفتوح" value={data.counts.waqfs} />
        <Stat label="استحقاقات مفتوحة" value={data.counts.open} />
        <Stat label="كل الاستحقاقات" value={data.counts.total} sub="منذ إنشاء الالتزام" />
      </section>
      <Panel>
        <ObligationForm save={saveObligation} preview={previewObligation} isNew={false}>
          <ObligationFields o={o} reqs={data.opts.reqs} pens={data.opts.pens} />
        </ObligationForm>
      </Panel>
      <Panel title="سجل تغييرات هذا الالتزام">
        <ChangeList
          items={log.map((l) => {
            const ch = l.l.change as { action?: string; version?: number; appliesNow?: number; diff?: { field: string; oldValue: string | null; newValue: string | null }[]; resync?: { created: number } };
            return {
              key: l.l.id,
              at: fmtDateTime(l.l.at),
              who: l.actor,
              text: (
                <span>
                  {ch.action === "create" ? "إنشاء" : "تعديل"}{ch.version ? ` — الإصدار ${ch.version}` : ""}{typeof ch.appliesNow === "number" ? ` · ينطبق على ${ch.appliesNow} وقفًا` : ""}{ch.resync ? ` · أُنشئ ${ch.resync.created} استحقاقًا` : ""}
                  {ch.diff?.length ? <span className="block text-[12px] text-muted" dir="ltr">{ch.diff.map((d) => d.field).join(", ")}</span> : null}
                </span>
              ),
            };
          })}
        />
      </Panel>
    </EditorPage>
  );
}
