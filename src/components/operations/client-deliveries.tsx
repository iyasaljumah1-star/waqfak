import { Badge, DefinitionList, Panel } from "@/components/ui";
import { Field, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtDate, type ActionState } from "@/lib/utils";
import { ACCEPTANCE_AR } from "@/server/modules/operations/continuous-pure";
import type { clientContinuous } from "@/server/modules/operations/continuous";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
type View = NonNullable<Awaited<ReturnType<typeof clientContinuous>>>;

/**
 * The client's view of a continuous service: its term, and each delivery made available in the platform with three
 * separate states — available, viewed (the client opened the file), approved — and the client's two actions:
 * approve the delivery, or ask for changes with notes.
 */
export function ClientDeliveries({ v, canAct, approve, revise }: { v: View; canAct: boolean; approve: Act; revise: Act }) {
  if (!v.term) return null;
  return (
    <Panel id="deliveries" title="خدمتك المستمرة وتسليماتها" description={`${v.spec.delivery.title} — دورية ${v.term.cadence}. يبقى طلبك قائمًا طوال مدة الخدمة. ${ACCEPTANCE_AR[v.acceptance]}.`}>
      <div className="space-y-4" data-testid="client-continuous">
        <DefinitionList items={[
          { label: "مدة الخدمة", value: `${v.term.startOn} إلى ${v.term.endOn}` },
          { label: "الحالة", value: v.stateLabel ?? "—" },
          { label: "تسليمات أُتيحت لك", value: String(v.cycles.length) },
          { label: "الاستحقاق القادم", value: v.nextDue ? `${v.nextDue.label} — ${v.nextDue.due}` : v.spec.delivery.kind === "output" ? "—" : "عند الاجتماع أو الحدث" },
          ...(v.term.terminated ? [{ label: "الإنهاء", value: `${v.term.terminated.reason ?? ""} — نافذ ${v.term.terminated.on}` }] : []),
        ]} />
        {v.cycles.length ? (
          <ul className="divide-y divide-line">
            {v.cycles.map((c) => (
              <li key={c.id} className="space-y-2 py-3" data-testid={`delivery-${c.seq}`}>
                <p className="font-medium">{c.label}</p>
                <p className="flex flex-wrap gap-2 text-[13px]">
                  <Badge tone="info" icon={false}>أُتيح في المنصة {c.sentAt ? fmtDate(c.sentAt) : "—"}</Badge>
                  <Badge tone={c.viewedAt ? "ok" : "neutral"} icon={false}>{c.viewedAt ? `اطّلعت عليه ${fmtDate(c.viewedAt)}` : "لم تفتحه بعد"}</Badge>
                  <Badge tone={c.decision === "approved" ? "ok" : c.decision === "revision_requested" ? "fine" : "warn"} icon={false}>
                    {c.decision === "approved" ? `اعتمدته ${fmtDate(c.decisionAt!)} (النسخة ${c.approvedVersion ?? "—"})` : c.decision === "revision_requested" ? "طلبت تعديله — عند الفريق" : "بانتظار قرارك"}
                  </Badge>
                </p>
                <ul className="text-sm">
                  {c.files.map((f) => (
                    <li key={f.id}>{f.title} — الإصدار {f.version}{f.status === "revision_requested" ? " (طلبت تعديله)" : ""} · <a href={`/api/deliveries/${f.id}`} target="_blank" rel="noopener" className="text-ink underline">معاينة الملف</a> · <a href={`/api/files/${f.documentId}`} className="text-ink underline">تنزيل PDF</a></li>
                  ))}
                </ul>
                {c.decisionNote ? <p className="text-[13px] text-muted">ملاحظتك: {c.decisionNote}</p> : null}
                {canAct && c.status === "sent" && !c.decision ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <ActionForm action={approve} hidden={{ cycleId: c.id }} submit="اعتماد التسليم" size="sm">
                      <Field label="ملاحظة مع الاعتماد (اختيارية)" name={`ok-${c.id}`}><Textarea id={`ok-${c.id}`} name="note" rows={2} maxLength={2000} /></Field>
                    </ActionForm>
                    <ActionForm action={revise} hidden={{ cycleId: c.id }} submit="طلب تعديل" size="sm" variant="secondary">
                      <Field label="ما يلزم تعديله" name={`rev-${c.id}`} required><Textarea id={`rev-${c.id}`} name="note" rows={2} required minLength={10} maxLength={2000} /></Field>
                    </ActionForm>
                  </div>
                ) : null}
                {canAct && c.status === "sent" && !c.decision ? <p className="text-[12px] text-muted">اعتمادك إقرار باستلام التسليم، ولا يُعد دليلًا على صحته النظامية ولا بديلًا عن مراجعة الفريق الداخلية.</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">لم يُتح لك تسليم بعد.</p>}
      </div>
    </Panel>
  );
}
