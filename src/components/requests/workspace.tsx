import Link from "next/link";
import { Badge, Panel } from "@/components/ui";
import { Field, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtDateTime } from "@/lib/utils";
import type { RevisionImpact } from "@/server/db/schema/operations";
import { COMMS_STATE_AR, COMMS_STATE_TONE, type Channel } from "@/server/modules/operations/comms";
import type { RollbackOption } from "@/server/modules/operations/revisions-pure";
import type { ActionState } from "@/lib/utils";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
type Tone = "critical" | "fine" | "warn" | "ok" | "info" | "neutral" | "ink" | "seal";

/** The request at a glance: who, what, where it stands, what is needed now and from whom. */
export function RequestSummary({ items }: { items: { label: string; value: React.ReactNode; tone?: Tone; testId?: string }[] }) {
  // 10 cells fill two rows of five on wide screens
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 xl:grid-cols-5" data-testid="request-summary">
      {items.map((i) => (
        <div key={i.label} className="min-w-0 bg-surface px-3 py-2.5" data-testid={i.testId}>
          <dt className="text-[12px] text-muted">{i.label}</dt>
          <dd className="mt-0.5 text-[14px] font-medium leading-6">{i.tone ? <Badge tone={i.tone} icon={false}>{i.value}</Badge> : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Jump links to the sections of the workspace, each with its own state. */
export function SectionNav({ sections }: { sections: { id: string; label: string; note?: string; tone?: Tone }[] }) {
  return (
    <nav aria-label="أقسام الطلب" className="sticky top-14 z-10 -mx-1 overflow-x-auto bg-surface-2/95 px-1 py-2 backdrop-blur" data-testid="section-nav">
      <ul className="flex min-w-max gap-2">
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[14px] text-text hover:border-ink">
              {s.label}
              {s.note ? <Badge tone={s.tone ?? "neutral"} icon={false} className="text-[11px]">{s.note}</Badge> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A titled group of panels with an anchor. */
export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 space-y-4" aria-labelledby={`${id}-h`} data-testid={`section-${id}`}>
      <h2 id={`${id}-h`} className="border-b border-line pb-1 text-[15px] font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

const IMPACT_KIND: Record<string, string> = { output: "مخرج", quote: "عرض", contract: "عقد", invoice: "فاتورة", verification: "تحقق", acceptance: "قبول", stage: "مرحلة" };

export function ImpactList({ impact }: { impact: RevisionImpact }) {
  if (!impact.length) return <p className="text-[13px] text-muted">لا سجلات متأثرة.</p>;
  return (
    <ul className="space-y-1 text-[14px]" data-testid="impact-list">
      {impact.map((x, i) => (
        <li key={i} className="flex flex-wrap gap-x-2"><Badge tone="neutral" icon={false}>{IMPACT_KIND[x.kind] ?? x.kind}</Badge><span>{x.label}</span><span className="text-muted">— {x.action}</span></li>
      ))}
    </ul>
  );
}

/** Going back to an earlier point of the request (controlled, recorded, nothing erased). */
export function RollbackPanel({ action, requestId, options, impact, isOps }: { action: Act; requestId: string; options: RollbackOption[]; impact: RevisionImpact; isOps: boolean }) {
  const usable = options.filter((o) => !o.opsOnly || isOps);
  return (
    <Panel id="rollback" title="الرجوع إلى مرحلة سابقة" description="للتصحيح: لا يُحذف أي إجراء سابق، ويُسجَّل الرجوع وسببه وأثره.">
      {usable.length ? (
        <details data-testid="rollback">
          <summary className="cursor-pointer text-[15px] font-medium text-ink">اختر النقطة وسبب الرجوع</summary>
          <div className="mt-3 space-y-3">
            <ActionForm action={action} hidden={{ id: requestId }} submit="ارجع إلى هذه النقطة" variant="secondary" size="sm">
              <Field label="الرجوع إلى" name="rb-target"><Select name="target" id="rb-target" required options={usable.map((o) => ({ value: o.target, label: `${o.label} — ${o.detail}` }))} /></Field>
              <Field label="السبب" name="rb-reason" hint="يظهر في سجل التعديلات. ما أُرسل للعميل يُبلَّغ به."><Textarea name="reason" id="rb-reason" required minLength={10} className="min-h-16" /></Field>
            </ActionForm>
            <div>
              <p className="mb-1 text-[13px] font-medium">ما سيلزم بعد الرجوع</p>
              <ImpactList impact={impact} />
            </div>
          </div>
        </details>
      ) : <p className="text-[14px] text-muted">لا نقطة رجوع متاحة في الحالة الحالية.{options.some((o) => o.opsOnly) ? " سحب ما أُرسل للعميل لمدير التشغيل." : ""}</p>}
    </Panel>
  );
}

const KIND_AR: Record<string, string> = { intake_edit: "تصحيح بيانات", rollback: "رجوع", reopen_output: "إعادة فتح مخرج" };

export function RevisionList({ rows, names }: { rows: { id: string; kind: string; target: string | null; reason: string; at: Date; actorUserId: string; impact: RevisionImpact; before: unknown; after: unknown }[]; names: Map<string, string> }) {
  if (!rows.length) return <p className="text-sm text-muted">لا تصحيحات أو رجوع مسجل.</p>;
  return (
    <ol className="space-y-3" data-testid="revisions">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border border-line p-3 text-[14px]">
          <p className="flex flex-wrap items-center gap-2"><Badge tone="seal" icon={false}>{KIND_AR[r.kind] ?? r.kind}</Badge><span className="font-medium">{r.target ?? ""}</span><span className="text-muted">{names.get(r.actorUserId) ?? "—"} · {fmtDateTime(r.at)}</span></p>
          <p className="mt-1">{r.reason}</p>
          {r.kind === "intake_edit" ? <p className="mt-1 text-[13px] text-muted" dir="auto">قبل: {JSON.stringify(Object.values((r.before ?? {}) as object)[0] ?? "—")} · بعد: {JSON.stringify(Object.values((r.after ?? {}) as object)[0] ?? "—")}</p> : null}
          {r.impact.length ? <details className="mt-1"><summary className="cursor-pointer text-[13px] text-ink">الأثر ({r.impact.length})</summary><div className="mt-1"><ImpactList impact={r.impact} /></div></details> : null}
        </li>
      ))}
    </ol>
  );
}

/** One card per channel with its state, linking to the panel where it is handled. */
export function CommsOverview({ channels }: { channels: (Channel & { href: string })[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="comms-overview">
      {channels.map((c) => (
        <li key={c.key} className="rounded-md border border-line bg-surface p-3" data-testid={`comms-${c.key}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={c.href} className="font-medium text-ink hover:underline">{c.title}{c.count ? <span className="ms-1 text-[12px] text-muted">({c.count})</span> : null}</Link>
            <Badge tone={COMMS_STATE_TONE[c.state]} icon={false}>{COMMS_STATE_AR[c.state]}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted">{c.summary}</p>
        </li>
      ))}
    </ul>
  );
}
