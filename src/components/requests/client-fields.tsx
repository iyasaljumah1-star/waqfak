import { CheckCircle2, Pencil } from "lucide-react";
import { ContextBlockView } from "@/components/requests/context-blocks";
import { NoteFormWithAttachment } from "@/components/requests/commerce";
import { fmtDateTime } from "@/lib/utils";
import { ctxField } from "@/server/modules/requests/context/types";
import type { RequestAnalysis } from "@/server/modules/requests/insights";
import type { FieldNote } from "@/server/modules/requests/field-workspace";
import type { ActionState } from "@/lib/utils";
import { displayValue, type Field } from "@/server/modules/requests/intake/engine";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
type Rev = { kind: string; target: string | null; at: string; actor: string; reason: string | null; before: unknown; after: unknown };

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join("، ") : String(v));

/**
 * The client's view of their request data: the value in force for each answer (the same value the team works on), any
 * correction made to it (by the team, why, and the earlier value), whether the team approved it, the team's notes on
 * it, and the waqf-file records the service reads with a way to report an error.
 */
export function ClientFieldsView({ analysis, form, revisions, notes, requestId, waqfId, canReport, postNote, docs }: {
  analysis: RequestAnalysis;
  /** The service form, to show an earlier value in words (option labels), as the current one is shown. */
  form: { steps: { fields: Field[] }[] };
  revisions: Rev[];
  notes: Record<string, FieldNote[]>;
  requestId: string;
  waqfId: string | null;
  canReport: boolean;
  postNote: Act;
  docs: { id: string; title: string }[];
}) {
  const defs = new Map(form.steps.flatMap((st) => st.fields).map((f) => [f.key, f]));
  const earlier = (k: string, v: unknown) => {
    const f = defs.get(k);
    return v === null || v === undefined || v === "" ? "—" : f && (typeof v === "string" || Array.isArray(v)) ? displayValue(f, v as string | string[]) : show(v);
  };
  const lastRev = (k: string) => [...revisions].reverse().find((r) => r.target === k);
  return (
    <div className="space-y-4" data-testid="client-fields">
      {analysis.steps.map((st) => (
        <section key={st.key}>
          <h3 className="mb-2 text-[15px] font-semibold">{st.title}</h3>
          <dl className="divide-y divide-line rounded-lg border border-line">
            {st.fields.map((f) => {
              const rev = lastRev(f.key);
              const before = rev && rev.before && typeof rev.before === "object" ? (rev.before as Record<string, unknown>)[f.key] : undefined;
              return (
                <div key={f.key} className="space-y-1 px-3 py-2" data-testid={`cfield-${f.key}`}>
                  <dt className="text-[13px] text-muted">{f.label}</dt>
                  <dd className="whitespace-pre-line text-[15px]">{f.value}</dd>
                  {rev ? (
                    <dd className="flex items-start gap-1.5 text-[13px] text-seal" data-testid="cfield-revision">
                      <Pencil aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      <span>{rev.kind === "client_completion" ? "حدّثتَه ردًا على طلب استكمال" : `عدّله ${rev.actor}`} في {fmtDateTime(rev.at)}{rev.kind !== "client_completion" && rev.reason ? ` — السبب: ${rev.reason}` : ""}. القيمة السابقة: {earlier(f.key, before)}.</span>
                    </dd>
                  ) : null}
                  {f.state === "approved" ? <dd className="flex items-center gap-1 text-[13px] text-ok" data-testid="cfield-approved"><CheckCircle2 aria-hidden className="size-3.5" />راجعه فريق وقفك واعتمده</dd> : null}
                  {(notes[f.key] ?? []).map((n) => <dd key={n.id} className="rounded bg-surface-2 px-2 py-1 text-[13px]" data-testid="cfield-note">ملاحظة الفريق: {n.body}</dd>)}
                </div>
              );
            })}
          </dl>
        </section>
      ))}
      {analysis.blocks.length ? (
        <section className="space-y-3">
          <h3 className="text-[15px] font-semibold">بيانات وقفك التي تعتمد عليها الخدمة</h3>
          {analysis.blocks.map((b) => {
            const key = ctxField(b.block.key);
            return (
              <ContextBlockView key={b.block.key} b={b.block} waqfId={waqfId}>
                {b.state === "approved" ? <p className="flex items-center gap-1 text-[13px] text-ok"><CheckCircle2 aria-hidden className="size-3.5" />راجعها فريق وقفك</p> : null}
                {(notes[key] ?? []).map((n) => <p key={n.id} className="rounded bg-surface-2 px-2 py-1 text-[13px]" data-testid="cblock-note">{n.author}: {n.body}</p>)}
                {canReport ? (
                  <details className="text-[14px]">
                    <summary className="cursor-pointer text-ink" data-testid={`report-${b.block.key}`}>أبلغ عن خطأ أو اطلب تحديثًا</summary>
                    <div className="mt-2"><NoteFormWithAttachment action={postNote} id={requestId} requestId={requestId} waqfId={waqfId} docs={docs} fieldKey={key} label={`ما الذي يحتاج تصحيحًا في «${b.block.title}»؟ اذكر القيمة الصحيحة ومصدرها.`} attachmentLabel="مستند يثبت التصحيح (اختياري)" /></div>
                  </details>
                ) : null}
              </ContextBlockView>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
