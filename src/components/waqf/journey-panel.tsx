import Link from "next/link";
import { ArrowLeft, Building2, CircleCheck, CircleDashed, CircleDot, Landmark, UserRound, Users } from "lucide-react";
import { Badge, Panel, ProgressBar } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { fmtDateTime } from "@/lib/utils";
import { OWNER_AR, type Journey, type Owner } from "@/server/modules/establish/journey";

/**
 * The establishment journey of a waqf file: where it stands, why it stops, who acts next, what is missing (each item a
 * link to the very form that completes it), and one button to resume. Everything shown is read from saved records.
 */

const STATUS_TONE: Record<string, "neutral" | "warn" | "info" | "ok" | "seal" | "ink"> = {
  draft: "neutral", awaiting_client: "warn", data_complete: "info", in_review: "info", returned: "warn", ready_next: "ok", documenting: "seal", ready_ops: "ok", operating: "ink", sustained: "ok", ended: "neutral",
};
const OWNER_ICON: Record<Owner, typeof UserRound> = { client: UserRound, team: Users, authority: Landmark };

/** «مطلوب منك» only when the viewer can act on it; otherwise the client-side work belongs to the waqf's nazara. */
function OwnerChip({ owner, nazara = false }: { owner: Owner; nazara?: boolean }) {
  const Icon = OWNER_ICON[owner];
  return <span className="inline-flex items-center gap-1 text-[13px] text-muted"><Icon aria-hidden className="size-3.5" />{owner === "client" && nazara ? "على النظارة" : OWNER_AR[owner]}</span>;
}

export function JourneyPanel({ j, updatedAt, compact = false, viewer = { manages: true, uploads: true } }: { j: Journey; updatedAt: string | Date; compact?: boolean; viewer?: { manages: boolean; uploads: boolean } }) {
  const current = j.current;
  const byNazara = (href?: string) => !viewer.manages && !(viewer.uploads && !!href && href.includes("/documents?upload="));
  return (
    <Panel id="journey" title="مسار تأسيس الوقف" description="يُقرأ من البيانات المحفوظة: لا تُعد خطوة مكتملة إلا بما يثبتها.">
      <div className="space-y-5" data-testid="journey" data-status={j.status} data-stage={j.stage}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone={STATUS_TONE[j.status] ?? "neutral"} icon={false}><span data-testid="journey-status">{j.statusLabel}</span></Badge>
          {j.owner ? <OwnerChip owner={j.owner} nazara={byNazara()} /> : null}
          <span className="text-[13px] text-muted">آخر تحديث {fmtDateTime(updatedAt)}</span>
        </div>
        {j.reason ? <p className="text-[15px]" data-testid="journey-reason">{j.reason}</p> : null}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-[14px]"><span>الإنجاز الفعلي</span><span className="tabular font-semibold" data-testid="journey-progress">{j.progress.done} من {j.progress.total} ({j.progress.pct}%)</span></div>
          <ProgressBar value={j.progress.pct} tone={j.progress.pct === 100 ? "ok" : "ink"} label="الإنجاز الفعلي لمسار التأسيس" />
        </div>
        {current ? (
          <dl className="grid gap-3 rounded-md bg-surface-2 p-3 text-[14px] sm:grid-cols-2">
            <div><dt className="text-muted">الخطوة الحالية</dt><dd className="font-semibold" data-testid="journey-current">{current.title}</dd><dd className="text-[13px] text-muted">{current.detail}</dd></div>
            <div><dt className="text-muted">الخطوة التالية</dt><dd className="font-semibold">{j.next?.title ?? "—"}</dd>{j.next ? <dd className="text-[13px] text-muted">{j.next.purpose}</dd> : null}</div>
          </dl>
        ) : null}
        {j.resume ? <ActionLink href={j.resume.href} variant="primary" data-testid="resume-establishment">{j.resume.label}<ArrowLeft aria-hidden className="size-4" /></ActionLink> : null}

        {j.gaps.length ? (
          <div>
            <h3 className="mb-2 text-[15px] font-semibold">ما ينقص ({j.gaps.length})</h3>
            <ul className="divide-y divide-line rounded-md border border-line" data-testid="journey-gaps">
              {j.gaps.slice(0, compact ? 6 : 30).map((g) => (
                <li key={g.key}>
                  <Link href={g.href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2" data-gap={g.key}>
                    <span className="min-w-0 flex-1 text-[15px]">{g.text}</span>
                    <OwnerChip owner={g.owner} nazara={byNazara(g.href)} />
                    <ArrowLeft aria-hidden className="size-4 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!compact ? (
          <ol className="space-y-2" data-testid="journey-steps">
            {j.steps.filter((s) => s.state !== "na").map((s) => {
              const Icon = s.state === "done" ? CircleCheck : s.state === "current" ? CircleDot : CircleDashed;
              return (
                <li key={s.key} className="flex gap-3" data-step={s.key} data-state={s.state}>
                  <Icon aria-hidden className={s.state === "done" ? "mt-0.5 size-5 shrink-0 text-ok" : s.state === "current" ? "mt-0.5 size-5 shrink-0 text-ink" : "mt-0.5 size-5 shrink-0 text-muted"} />
                  <div className="min-w-0">
                    <p className={s.state === "pending" ? "font-medium text-muted" : "font-medium"}>
                      <Link href={s.href} className="hover:underline">{s.title}</Link>
                      <span className="sr-only"> — {s.state === "done" ? "مكتملة" : s.state === "current" ? "جارية" : "قادمة"}</span>
                    </p>
                    <p className="text-[13px] text-muted">{s.detail}{s.state !== "done" ? <> · <OwnerChip owner={s.owner} nazara={byNazara(s.href)} /></> : null}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
        <p className="flex items-start gap-2 text-[13px] text-muted"><Building2 aria-hidden className="mt-0.5 size-4 shrink-0" />التوثيق يتم لدى الجهة المختصة والتسجيل لدى الهيئة العامة للأوقاف؛ تعرض المنصة ما يلزم وتسجّل ما يثبت حصوله، ولا تعدّ إدخال رقم أو تاريخ توثيقًا.</p>
      </div>
    </Panel>
  );
}
