import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, Plus } from "lucide-react";
import { Badge, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { STATUS_TONE } from "@/components/portal/labels";
import { StageMeter } from "@/components/portal/stage";
import { SIZE_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { myWaqfs } from "@/server/modules/portal/queries";
import { read } from "@/server/modules/_shared";
import { journeyOf } from "@/server/modules/establish/journey-server";
import { completenessOf } from "@/server/modules/waqf-core/completeness";
import type { MyWaqf } from "@/server/modules/portal/queries";

export const metadata: Metadata = { title: "أوقافي" };

export default async function WaqfsPage() {
  const auth = await requireAuth({ next: "/app/waqfs" });
  const waqfs = await myWaqfs(auth);
  // files still being established show where they stand and a way back into the same file (never a new one)
  const journeys = new Map(await read(auth, async (tx) => {
    const out: [string, NonNullable<Awaited<ReturnType<typeof journeyOf>>>][] = [];
    for (const w of waqfs) if (!w.beneficiaryOnly && ["idea", "draft", "documenting", "documented"].includes(w.status)) { const j = await journeyOf(tx, w.id); if (j && j.stage <= 2) out.push([w.id, j]); }
    return out;
  }));
  // «الأوقاف المكتملة» only when the records prove it; drafts and files missing data are listed apart (never as waqfs)
  const comp = await read(auth, (tx) => completenessOf(tx, waqfs.map((w) => w.id)));
  const complete = waqfs.filter((w) => !w.beneficiaryOnly && comp.get(w.id)?.complete);
  const inProgress = waqfs.filter((w) => !w.beneficiaryOnly && !comp.get(w.id)?.complete);
  const benef = waqfs.filter((w) => w.beneficiaryOnly);
  const table = (rows: MyWaqf[], caption: string, testId: string, withMissing = false) => (
      <div className="rounded-lg border border-line bg-surface px-2 md:px-3" data-testid={testId}>
        <DataTable
          caption={caption}
          rows={rows}
          rowKey={(w) => w.id}
          columns={[
            {
              key: "name",
              label: "الوقف",
              render: (w) => (
                <div className="min-w-0">
                  <Link href={w.beneficiaryOnly ? `/app/b/${w.id}` : `/app/w/${w.id}`} className="font-semibold text-ink hover:underline">{w.name}</Link>
                  <p dir="ltr" className="tabular text-end text-[13px] text-muted md:text-start">{w.internalNumber}</p>
                  {journeys.get(w.id)?.resume ? (
                    <Link href={journeys.get(w.id)!.resume!.href} className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-ink underline" data-testid="list-resume">{journeys.get(w.id)!.resume!.label}</Link>
                  ) : null}
                </div>
              ),
            },
            {
              key: "roles",
              label: "دوري",
              render: (w) => (
                <div className="flex flex-wrap gap-1">
                  {w.roles.map((r) => (
                    <Badge key={r} tone={r === "beneficiary" ? "seal" : "ink"} icon={false}>{roleName(r)}</Badge>
                  ))}
                </div>
              ),
            },
            {
              key: "status",
              label: "الحالة",
              render: (w) => (
                <div className="flex flex-wrap gap-1">
                  {journeys.get(w.id) ? <Badge tone="warn" icon={false}>{journeys.get(w.id)!.statusLabel}</Badge> : <Badge tone={STATUS_TONE[w.status] ?? "neutral"} icon={false}>{STATUS_LABEL[w.status] ?? w.status}</Badge>}
                  {w.legalType ? <Badge icon={false}>{TYPE_LABEL[w.legalType]}</Badge> : null}
                  {w.sizeClass ? <Badge icon={false}>{SIZE_LABEL[w.sizeClass]}</Badge> : null}
                </div>
              ),
            },
            { key: "stage", label: "المرحلة", hideOnMobile: true, render: (w) => <StageMeter stage={journeys.get(w.id)?.stage ?? w.stage} /> },
            ...(withMissing ? [{ key: "missing", label: "ينقصه", render: (w: MyWaqf) => <span className="text-[13px]">{(comp.get(w.id)?.missing ?? []).join("، ")}</span> }] : []),
          ]}
          empty={
            <div className="py-4">
              <EmptyState
                icon={Landmark}
                title={waqfs.length ? "لا وقف مكتمل بعد" : "لا يرتبط حسابك بأي وقف بعد"}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <ActionLink href="/app/waqfs/new" size="sm">سجّل وقفًا قائمًا</ActionLink>
                    <ActionLink href="/app/establish" size="sm" variant="secondary">أسّس وقفًا جديدًا</ActionLink>
                  </div>
                }
              >
                {waqfs.length ? "يظهر الوقف هنا حين يُوثَّق ويُرفع صكه، وتُسجَّل أصوله ومصارفه ونظارته. ملفاتك قيد الاستكمال أدناه." : "سجّل وقفًا موثّقًا تديره أو أسّس وقفًا جديدًا. إن دعاك ناظر إلى وقف فسيظهر هنا بعد قبول الدعوة."}
              </EmptyState>
            </div>
          }
        />
      </div>
  );
  return (
    <>
      <PageHeader
        title="أوقافي"
        description="أوقافك المكتملة، وملفات الأوقاف التي تؤسسها أو تستكملها، كلٌّ في قسمه. طلبات الخدمات في «طلباتي»."
        actions={<ActionLink href="/app/waqfs/new" size="sm"><Plus aria-hidden className="size-4" />سجّل وقفًا قائمًا</ActionLink>}
      />
      <div className="space-y-6">
        <section aria-labelledby="complete-h" className="space-y-2">
          <h2 id="complete-h" className="text-lg font-semibold">الأوقاف المكتملة <span className="tabular text-[15px] font-normal text-muted">({complete.length})</span></h2>
          {table(complete, "الأوقاف المكتملة", "complete-waqfs")}
        </section>
        {inProgress.length ? (
          <section aria-labelledby="progress-h" className="space-y-2">
            <h2 id="progress-h" className="text-lg font-semibold">ملفات قيد التأسيس أو الاستكمال <span className="tabular text-[15px] font-normal text-muted">({inProgress.length})</span></h2>
            <p className="text-sm text-muted">لا تُعد أوقافًا مكتملة حتى تُوثَّق ويُرفع صكها وتُسجَّل أصولها ومصارفها ونظارتها. افتح الملف لتستكمله.</p>
            {table(inProgress, "ملفات قيد الاستكمال", "in-progress-waqfs", true)}
          </section>
        ) : null}
        {benef.length ? (
          <section aria-labelledby="benef-h" className="space-y-2">
            <h2 id="benef-h" className="text-lg font-semibold">أوقاف أنت من مستحقيها</h2>
            {table(benef, "أوقاف أنت من مستحقيها", "benef-waqfs")}
          </section>
        ) : null}
      </div>
    </>
  );
}
