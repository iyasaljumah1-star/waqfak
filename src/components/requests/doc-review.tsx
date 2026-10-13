"use client";

import { useActionState, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { Field, FormMessage, SubmitButton, Textarea } from "@/components/ui/form";
import { initialState, type ActionState } from "@/lib/utils";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
export type DocReviewRow = {
  slot: string; label: string; required: boolean; hint?: string;
  docs: { id: string; title: string; review: { status: "verified" | "rejected"; byName: string; at: string; note: string | null } | null }[];
  replacedOk: boolean;
};

/**
 * The team's review of every document attached to the form: «uploaded» is not «verified». A required slot counts only
 * after a verified document (or an accepted replacement through the deficiencies register).
 */
export function IntakeDocReview({ action, requestId, rows, canReview }: { action: Act; requestId: string; rows: DocReviewRow[]; canReview: boolean }) {
  if (!rows.length) return null;
  return (
    <div id="doc-review" className="mt-4 scroll-mt-20 border-t border-line pt-4" data-testid="doc-review">
      <h3 className="mb-1 text-[15px] font-medium">التحقق من المستندات</h3>
      <p className="mb-3 text-[13px] text-muted">المستند المرفوع لا يُعد صحيحًا حتى يتحقق منه المختص. المرفوض يُسجّل بندًا في النواقص ليستبدله العميل.</p>
      <ul className="space-y-3">
        {rows.map((r) => {
          const ok = r.replacedOk || r.docs.some((d) => d.review?.status === "verified");
          return (
            <li key={r.slot} className="rounded-lg border border-line p-3" data-testid={`docslot-${r.slot}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{r.label}</p>
                <span className="flex flex-wrap gap-1">
                  {r.required ? <Badge tone="neutral" icon={false}>مطلوب</Badge> : <Badge tone="neutral" icon={false}>اختياري</Badge>}
                  <Badge tone={ok ? "ok" : r.docs.length ? "info" : r.required ? "warn" : "neutral"} icon={false}>
                    {ok ? (r.replacedOk && !r.docs.some((d) => d.review?.status === "verified") ? "استُبدل وقُبل" : "متحقق منه") : r.docs.length ? "مرفوع — لم يُتحقق منه" : "لم يُرفق"}
                  </Badge>
                </span>
              </div>
              {r.docs.length ? (
                <ul className="mt-2 space-y-2">
                  {r.docs.map((d) => (
                    <li key={d.id} className="rounded-md bg-surface-2 p-2 text-[15px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <a href={`/api/files/${d.id}?disposition=inline`} target="_blank" rel="noopener" className="text-ink underline">{d.title}</a>
                        {d.review ? (
                          <span className="text-[13px] text-muted">
                            {d.review.status === "verified" ? "تحقق منه" : "رفضه"} {d.review.byName} · {d.review.at}{d.review.note ? ` — ${d.review.note}` : ""}
                          </span>
                        ) : null}
                      </div>
                      {canReview && !d.review ? <DocDecision action={action} requestId={requestId} slot={r.slot} documentId={d.id} /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DocDecision({ action, requestId, slot, documentId }: { action: Act; requestId: string; slot: string; documentId: string }) {
  const [s, a] = useActionState(action, initialState);
  const [reject, setReject] = useState(false);
  const hidden = (decision: string) => (
    <>
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="slot" value={slot} />
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="decision" value={decision} />
    </>
  );
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={a}>{hidden("verified")}<SubmitButton size="sm" pendingText="…">تحققت منه</SubmitButton></form>
        <Button type="button" size="sm" variant="secondary" onClick={() => setReject(!reject)}>ارفض واطلب استبداله</Button>
      </div>
      {reject ? (
        <form action={a} className="space-y-2 rounded-md bg-surface p-3">
          {hidden("rejected")}
          <Field label="سبب الرفض (يصل العميل)" name={`reject-${documentId}`}>
            <Textarea name="note" id={`reject-${documentId}`} required minLength={5} className="min-h-16" />
          </Field>
          <SubmitButton size="sm" variant="danger" pendingText="…">ارفض المستند</SubmitButton>
        </form>
      ) : null}
      <FormMessage state={s} />
    </div>
  );
}
