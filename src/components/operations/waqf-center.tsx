import Link from "next/link";
import { Check, CircleDot, Clock, OctagonAlert, Circle } from "lucide-react";
import { Badge, Panel } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { CenterItem, CenterState, NazaraStage } from "@/server/modules/operations/waqf-center";

const STATE: Record<CenterState, { label: string; tone: "critical" | "fine" | "ok" }> = {
  required: { label: "مطلوب الآن", tone: "critical" }, soon: { label: "قريب أو قيد العمل", tone: "fine" }, done: { label: "مكتمل", tone: "ok" },
};
const NZ_ICON = { done: Check, current: CircleDot, pending: Circle, blocked: OctagonAlert } as const;
const NZ_CLASS = { done: "bg-ok-soft text-ok", current: "bg-ink text-white", pending: "bg-surface-2 text-muted", blocked: "bg-critical-soft text-critical" } as const;

/**
 * The waqf file as an operations center: what is required, why, what remains, who acts, where, and what it produces.
 * Items are computed from the file's records; the caller passes only items the viewer may open.
 */
export function WaqfCenterPanel({ items, nazara, counts, requestHref, nazaraHref }: {
  items: CenterItem[]; nazara: NazaraStage[] | null; counts: Record<CenterState, number>;
  requestHref?: (id: string) => string; nazaraHref?: string | null;
}) {
  const open = items.filter((i) => i.state !== "done");
  const done = items.filter((i) => i.state === "done");
  const href = (i: CenterItem) => (i.key.startsWith("req:") && requestHref ? requestHref(i.key.slice(4)) : i.href);
  return (
    <Panel id="center" title="مركز تشغيل الوقف" description={`${counts.required} مطلوب الآن · ${counts.soon} قريب أو قيد العمل · ${counts.done} مكتمل — محسوبة من سجلات الملف`}>
      <div className="space-y-5" data-testid="waqf-center">
        {nazara ? (
          <div>
            <p className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[15px] font-medium">
              النظارة: الطلب والقبول والجاهزية والمباشرة
              {nazaraHref ? <Link href={nazaraHref} className="text-[13px] font-normal text-ink hover:underline">ملف النظارة</Link> : null}
            </p>
            <ol className="grid gap-2 sm:grid-cols-4" data-testid="nazara-stages">
              {nazara.map((s) => {
                const Icon = NZ_ICON[s.state];
                return (
                  <li key={s.key} className="rounded-md border border-line p-2.5 text-[14px]" data-state={s.state}>
                    <span className="flex items-center gap-2 font-medium">
                      <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full", NZ_CLASS[s.state])}><Icon aria-hidden className="size-3.5" /></span>
                      {s.title}
                    </span>
                    {s.detail ? <span className="mt-1 block text-[13px] text-muted">{s.detail}</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {open.length ? (
          <ul className="divide-y divide-line rounded-md border border-line">
            {open.map((i) => (
              <li key={i.key} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start" data-testid={`center-${i.key}`}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={href(i)} className="font-medium text-ink hover:underline">{i.title}</Link>
                    <span className="text-[12px] text-muted">{i.area}</span>
                  </p>
                  <p className="text-[14px]">{i.why}{i.remaining ? <span className="text-muted"> — {i.remaining}</span> : null}</p>
                  <p className="text-[13px] text-muted">المسؤول: {i.owner} · الناتج: {i.output}</p>
                </div>
                <Badge tone={STATE[i.state].tone} icon={false} className="justify-self-start">{STATE[i.state].label}</Badge>
              </li>
            ))}
          </ul>
        ) : <p className="text-[15px]">لا إجراءات مطلوبة الآن.</p>}

        {done.length ? (
          <details>
            <summary className="cursor-pointer text-[14px] text-ink">المكتمل ({done.length})</summary>
            <ul className="mt-2 grid gap-1 text-[14px] sm:grid-cols-2">
              {done.map((i) => (
                <li key={i.key} className="flex items-start gap-2">
                  <Check aria-hidden className="mt-1 size-3.5 shrink-0 text-ok" />
                  <span><Link href={href(i)} className="hover:underline">{i.title}</Link> <span className="text-muted">— {i.why}</span></span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="flex items-center gap-1 text-[12px] text-muted"><Clock aria-hidden className="size-3" />لا تكامل بنكي آلي: الحركات المالية تُسجّل وتُوثّق بمستنداتها، والإجراءات لدى الجهات تُنفّذ لديها ثم يُحدَّث الملف.</p>
      </div>
    </Panel>
  );
}
