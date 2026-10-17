import { AlertTriangle, CheckCircle2, CircleDashed, Lightbulb, Scale, ShieldQuestion, UserRound, Database, Paperclip } from "lucide-react";
import { ProgressBar } from "@/components/ui";
import { ContextBlockView } from "@/components/requests/context-blocks";
import { FieldActions, FieldFilter, type FieldActionSet } from "@/components/requests/field-actions";
import { cn, fmtDate, fmtDateTime } from "@/lib/utils";
import { ctxField } from "@/server/modules/requests/context/types";
import { INSIGHT_KIND_AR, type FieldView, type Insight, type InsightKind, type RequestAnalysis } from "@/server/modules/requests/insights";
import type { FieldNote, FieldTask } from "@/server/modules/requests/field-workspace";
import type { Answers, Field } from "@/server/modules/requests/intake/engine";

/**
 * The request's data in one place for the team: every answer in the order the client saw it, the waqf-file records the
 * service reads, what each value rests on, the analysis under it, and the actions beside it. All from the database.
 */

const KIND_ICON: Record<InsightKind, typeof Lightbulb> = { client: UserRound, fact: Database, inference: Lightbulb, recommendation: Lightbulb, specialist: Scale, gap: CircleDashed, conflict: AlertTriangle };
const KIND_TONE: Record<InsightKind, string> = { client: "text-muted", fact: "text-ok", inference: "text-ink", recommendation: "text-seal", specialist: "text-seal", gap: "text-fine", conflict: "text-critical" };
const STATE_AR = { pending: "لم يُراجع", approved: "معتمد", needs_review: "يحتاج مراجعة" } as const;
const STATE_TONE = { pending: "bg-surface-2 text-muted", approved: "bg-ok-soft text-ok", needs_review: "bg-warn-soft text-warn" } as const;
const ORIGIN_AR: Record<FieldView["origin"], string> = { client: "أدخله العميل", file: "من ملف الوقف", file_changed: "عدّله العميل عن ملف الوقف", staff: "صحّحه الفريق", client_completion: "استكمله العميل", system: "من النظام" };

export function InsightList({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1 border-t border-line/70 pt-2 text-[14px]" data-testid="insights">
      {items.map((x, i) => {
        const Icon = KIND_ICON[x.kind];
        return (
          <li key={i} className="flex items-start gap-2" data-kind={x.kind}>
            <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", KIND_TONE[x.kind])} />
            <span><span className={cn("font-medium", KIND_TONE[x.kind])}>{INSIGHT_KIND_AR[x.kind]}:</span> {x.text}{x.evidence?.length ? <span className="text-[12px] text-muted"> — المستند إليه: {x.evidence.join("، ")}</span> : null}</span>
          </li>
        );
      })}
    </ul>
  );
}

function StateChip({ state, outdated }: { state: keyof typeof STATE_AR; outdated?: boolean }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", STATE_TONE[state])} data-testid="field-state" data-state={state}>{outdated ? "اعتُمد ثم تغيّر" : STATE_AR[state]}</span>;
}

function NotesAndTasks({ notes, tasks }: { notes?: FieldNote[]; tasks?: FieldTask[] }) {
  if (!notes?.length && !tasks?.length) return null;
  return (
    <div className="space-y-1 text-[13px]">
      {(notes ?? []).map((n) => (
        <p key={n.id} className={cn("rounded px-2 py-1", n.visibility === "internal" ? "bg-seal-soft/40" : "bg-surface-2")} data-testid="field-note">
          <span className="font-medium">{n.visibility === "internal" ? "داخلية" : "للعميل"} — {n.author}</span> ({fmtDateTime(n.at)}): {n.body}
          {n.documentId ? <> <a className="inline-flex items-center gap-1 text-ink underline" href={`/api/files/${n.documentId}?disposition=inline`} target="_blank" rel="noopener"><Paperclip aria-hidden className="size-3" />{n.documentTitle}</a></> : null}
        </p>
      ))}
      {(tasks ?? []).map((t) => (
        <p key={t.id} className="rounded bg-surface-2 px-2 py-1" data-testid="field-task">
          <span className="font-medium">مهمة:</span> {t.title} — {t.status === "done" ? "منجزة" : t.status === "in_progress" ? "قيد التنفيذ" : t.status === "cancelled" ? "ملغاة" : "مفتوحة"}{t.assignee ? ` · ${t.assignee}` : ""}{t.dueOn ? ` · ${fmtDate(t.dueOn)}` : ""}
        </p>
      ))}
    </div>
  );
}

const flags = (f: { state: string; insights: Insight[] }, system: boolean) =>
  [f.state, ...(f.insights.some((x) => x.kind === "gap") ? ["gap"] : []), ...(f.insights.some((x) => x.kind === "conflict") ? ["conflict"] : []), ...(system ? ["system"] : [])].join(" ");

export function FieldWorkspaceView({ ws, requestId, waqfId, canAct, actions, docs, staff }: {
  ws: { analysis: RequestAnalysis; answers: Answers; form: { steps: { key: string; fields: Field[] }[] }; notes: Record<string, FieldNote[]>; tasks: Record<string, FieldTask[]> };
  requestId: string;
  waqfId: string | null;
  canAct: boolean;
  actions: FieldActionSet;
  docs: { id: string; title: string }[];
  staff: { value: string; label: string }[];
}) {
  const a = ws.analysis;
  const s = a.summary;
  const fieldDef = new Map(ws.form.steps.flatMap((st) => st.fields).map((f) => [f.key, f]));
  const all = [...a.steps.flatMap((st) => st.fields.map((f) => ({ state: f.state, insights: f.insights, system: f.origin === "file" }))), ...a.blocks.map((b) => ({ state: b.state, insights: b.insights, system: true }))];
  const counts = {
    gap: all.filter((x) => x.insights.some((i) => i.kind === "gap")).length,
    conflict: all.filter((x) => x.insights.some((i) => i.kind === "conflict")).length,
    needs_review: all.filter((x) => x.state === "needs_review").length,
    pending: all.filter((x) => x.state === "pending").length,
    approved: all.filter((x) => x.state === "approved").length,
    system: all.filter((x) => x.system).length,
  };
  const firstGap = a.steps.flatMap((st) => st.fields).find((f) => f.insights.some((x) => x.kind === "gap"))?.key ?? a.blocks.find((b) => b.insights.some((x) => x.kind === "gap"))?.block.key;
  const openTasks = Object.values(ws.tasks).flat().filter((t) => t.status === "todo" || t.status === "in_progress").length;
  return (
    <div className="space-y-5" data-fieldws>
      <div className="grid gap-3 rounded-lg border border-line bg-surface-2/50 p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="field-summary">
        <div className="space-y-1 sm:col-span-2 lg:col-span-1">
          <div className="flex items-baseline justify-between text-[14px]"><span>اكتمال البيانات</span><span className="tabular font-semibold" data-testid="field-completeness">{s.completeness}%</span></div>
          <ProgressBar value={s.completeness} label="اكتمال البيانات" />
          <p className="text-[12px] text-muted">{s.requiredValid} من {s.required} حقلًا مطلوبًا مكتملة، و{a.blocks.filter((b) => b.block.status !== "missing").length} من {a.blocks.length} من بيانات ملف الوقف مسجلة.</p>
        </div>
        <p className="text-[14px]"><CheckCircle2 aria-hidden className="me-1 inline size-4 text-ok" /><span className="font-semibold tabular" data-testid="field-approved">{s.approved}</span> معتمدة · <span className="tabular">{s.needsReview}</span> تحتاج مراجعة · <span className="tabular">{s.pending}</span> لم تُراجع</p>
        <p className="text-[14px]"><CircleDashed aria-hidden className="me-1 inline size-4 text-fine" /><span className="font-semibold tabular">{counts.gap}</span> ناقص · <AlertTriangle aria-hidden className="mx-1 inline size-4 text-critical" /><span className="tabular">{counts.conflict}</span> تعارض</p>
        <p className="text-[14px]"><ShieldQuestion aria-hidden className="me-1 inline size-4 text-seal" /><span className="tabular">{openTasks}</span> مهمة مفتوحة مرتبطة بالحقول{firstGap ? <> · <a className="text-ink underline" href={`#f-${firstGap.startsWith("ctx:") ? firstGap : firstGap}`} data-testid="first-gap">أول نقص</a></> : null}</p>
      </div>

      <FieldFilter counts={counts} />

      {a.steps.map((st) => (
        <details key={st.key} open className="group rounded-lg border border-line" id={`step-${st.key}`}>
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-[16px] font-semibold">
            {st.title}
            <span className="text-[13px] font-normal text-muted">{st.fields.filter((f) => f.state === "approved").length} من {st.fields.length} معتمدة</span>
          </summary>
          <div className="divide-y divide-line border-t border-line">
            {st.fields.map((f) => (
              <article key={f.key} id={`f-${f.key}`} className="scroll-mt-24 space-y-2 px-4 py-3" data-row data-f={flags(f, f.origin === "file")} data-q={`${f.label} ${f.value}`.toLowerCase()} data-testid={`field-${f.key}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h4 className="text-[15px] font-medium">{f.label}{f.required ? <span className="text-critical"> *</span> : null}</h4>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-muted" data-testid="field-origin">{ORIGIN_AR[f.origin]}</span>
                    <StateChip state={f.state} outdated={f.approvalOutdated} />
                  </span>
                </div>
                <p className="whitespace-pre-line text-[15px]" data-testid="field-value">{f.value}</p>
                <InsightList items={f.insights} />
                <NotesAndTasks notes={ws.notes[f.key]} tasks={ws.tasks[f.key]} />
                {canAct ? (
                  <FieldActions requestId={requestId} waqfId={waqfId} fieldKey={f.key} label={f.label} field={fieldDef.get(f.key) ?? null} value={ws.answers[f.key]} answers={ws.answers}
                    actions={actions} approved={f.state === "approved"} docs={docs} staff={staff} suggestedTask={f.insights.find((x) => x.task)?.task} />
                ) : null}
              </article>
            ))}
          </div>
        </details>
      ))}

      {a.blocks.length ? (
        <details open className="rounded-lg border border-line" id="step-waqf-file">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-[16px] font-semibold">
            بيانات مستخرجة من ملف الوقف
            <span className="text-[13px] font-normal text-muted">{a.blocks.filter((b) => b.state === "approved").length} من {a.blocks.length} معتمدة</span>
          </summary>
          <div className="space-y-3 border-t border-line p-3">
            {a.blocks.map((b) => {
              const key = ctxField(b.block.key);
              return (
                <div key={b.block.key} id={`f-${key}`} className="scroll-mt-24" data-row data-f={flags(b, true)} data-q={`${b.block.title} ${b.block.rows.map((r) => `${r.label} ${r.value}`).join(" ")}`.toLowerCase()}>
                  <ContextBlockView b={b.block} waqfId={waqfId}
                    actions={canAct ? <FieldActions requestId={requestId} waqfId={waqfId} fieldKey={key} label={b.block.title} field={null} value={undefined} answers={ws.answers} actions={actions} approved={b.state === "approved"} docs={docs} staff={staff} suggestedTask={b.insights.find((x) => x.task)?.task} /> : null}>
                    <div className="flex flex-wrap items-center gap-2"><StateChip state={b.state} outdated={b.approvalOutdated} /></div>
                    <InsightList items={b.insights} />
                    <NotesAndTasks notes={ws.notes[key]} tasks={ws.tasks[key]} />
                  </ContextBlockView>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
