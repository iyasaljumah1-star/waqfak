"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Check, Circle, CircleDot, Clock, OctagonAlert, Minus } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { cn, initialState, type ActionState } from "@/lib/utils";
import type { Blocker, Step, StepAction, StepState } from "@/server/modules/operations/next-step";
import { WHO_AR } from "@/server/modules/operations/next-step";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

const STATE_AR: Record<StepState, string> = { done: "مكتملة", current: "الخطوة الحالية", waiting: "بانتظار طرف آخر", blocked: "متوقفة على نواقص", pending: "لاحقة", skipped: "لم تُنفّذ" };
const STATE_ICON: Record<StepState, typeof Check> = { done: Check, current: CircleDot, waiting: Clock, blocked: OctagonAlert, pending: Circle, skipped: Minus };
const STATE_CLASS: Record<StepState, string> = {
  done: "bg-ok-soft text-ok", current: "bg-ink text-white", waiting: "bg-warn-soft text-warn", blocked: "bg-critical-soft text-critical", pending: "bg-surface-2 text-muted", skipped: "bg-surface-2 text-muted",
};

/** Where each step is reviewed or corrected on the page (done steps stay open for review). */
function stepHref(key: string) {
  if (["receive", "verify", "accept"].includes(key)) return "#data";
  if (key === "quote") return "#quote";
  if (key === "contract") return "#contract";
  if (key === "prestart") return "#billing";
  if (key.startsWith("prep:") || key.startsWith("approve:") || key === "deliverable") return "#outputs";
  if (key === "client_approval") return "#comms";
  if (key.startsWith("cycle:")) return `#cycle-${key.slice(6)}`;
  if (["term", "cycles", "next_cycle", "closing", "end_service"].includes(key)) return "#service";
  return "#work";
}

/**
 * Execution panel of a request: where the request stands, what blocks it and who must act, the expected output of the
 * current step, and one button that performs the next step for real (or points to where a human must decide).
 */
export function ExecutionPanel({ action, requestId, token, steps, current, primary, held, terminal }: {
  action: Act; requestId: string; token: string; steps: Step[]; current: Step | null; primary: StepAction | null; held: Blocker | null; terminal: boolean;
}) {
  const doneCount = steps.filter((s) => s.state === "done").length;
  return (
    <section id="execution" className="rounded-lg border border-ink/30 bg-surface" data-testid="execution-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 md:px-5">
        <h2 className="text-[17px] font-semibold">لوحة التنفيذ</h2>
        <p className="text-[13px] text-muted tabular">{doneCount} من {steps.length} خطوات مكتملة</p>
      </div>
      <div className="grid gap-5 p-4 md:p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-3">
          {terminal ? (
            <p className="text-[15px]">الطلب منتهٍ؛ لا خطوات تنفيذ متبقية.</p>
          ) : current ? (
            <>
              <div>
                <p className="text-[13px] text-muted">الخطوة الحالية · المسؤول: {WHO_AR[current.owner]}</p>
                <p className="text-[19px] font-semibold leading-8" data-testid="current-step">{current.title}</p>
                {current.detail ? <p className="text-[14px] text-muted">{current.detail}</p> : null}
                {current.output ? <p className="mt-1 text-[14px]"><span className="text-muted">المخرج المتوقع: </span>{current.output}</p> : null}
              </div>
              {held ? <BlockerList items={[held]} /> : null}
              {current.blockers.length ? <BlockerList items={current.blockers} /> : null}
              <PrimaryAction action={action} requestId={requestId} token={token} primary={primary} current={current} held={!!held} />
            </>
          ) : <p className="text-[15px]">اكتملت خطوات الطلب.</p>}
        </div>
        <ol className="space-y-1.5" aria-label="مسار الطلب" data-testid="exec-steps">
          {steps.map((s) => {
            const Icon = STATE_ICON[s.state];
            return (
              <li key={s.key} className={cn("flex items-start gap-2 text-[14px] leading-6", s.state === "pending" || s.state === "skipped" ? "text-muted" : "text-text")} data-state={s.state}>
                <span className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full", STATE_CLASS[s.state])} title={STATE_AR[s.state]}>
                  <Icon aria-hidden className="size-3.5" />
                </span>
                <span className="min-w-0">
                  {s.state === "pending" || s.state === "skipped"
                    ? <span>{s.title}</span>
                    : <a href={stepHref(s.key)} className={cn("hover:underline", s === current ? "font-semibold" : undefined)} title="افتح القسم لمراجعته أو تصحيحه">{s.title}</a>}
                  <span className="sr-only"> — {STATE_AR[s.state]}</span>
                  {s.state === "waiting" ? <span className="block text-[12px] text-muted">بانتظار {WHO_AR[s.owner]}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function BlockerList({ items }: { items: Blocker[] }) {
  return (
    <ul className="space-y-1.5 rounded-md bg-surface-2 p-3 text-[14px]" data-testid="blockers">
      {items.map((b, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[12px] font-medium text-muted">{WHO_AR[b.who]}</span>
          {b.href ? <Link href={b.href} className="text-ink underline underline-offset-2">{b.text}</Link> : <span>{b.text}</span>}
        </li>
      ))}
    </ul>
  );
}

function PrimaryAction({ action, requestId, token, primary, current, held }: { action: Act; requestId: string; token: string; primary: StepAction | null; current: Step; held: boolean }) {
  const [s, a] = useActionState(action, initialState);
  // the result of the last click stays visible even when the new step is a link or waits on someone else
  if (!primary) {
    const who = held ? "الطرف المعلّق عليه" : WHO_AR[current.owner];
    return <div className="space-y-2"><FormMessage state={s} /><p className="text-[14px] text-muted" data-testid="no-action">لا إجراء متاح لك في هذه الخطوة. {current.state === "waiting" || held ? `بانتظار ${who}.` : "يتولاها من يملك الصلاحية."}</p></div>;
  }
  if (primary.kind === "link") return <div className="space-y-2"><FormMessage state={s} /><ButtonLink href={primary.href} data-testid="next-step-link" className="h-auto! min-h-11 max-w-full whitespace-normal! py-2! text-start">{primary.label}</ButtonLink></div>;
  const href = (s.data as { href?: string } | undefined)?.href;
  return (
    <form action={a} className="space-y-2">
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="key" value={primary.key} />
      <input type="hidden" name="token" value={token} />
      <SubmitButton pendingText="جارٍ التنفيذ…" data-testid="next-step" className="h-auto! min-h-11 max-w-full whitespace-normal! py-2! text-start" aria-label="نفّذ الخطوة التالية" title={primary.label}>نفّذ الخطوة التالية: {primary.label}</SubmitButton>
      <FormMessage state={s} />
      {s.ok && href ? <ButtonLink href={href} variant="secondary" size="sm">افتح المسودة</ButtonLink> : null}
    </form>
  );
}
