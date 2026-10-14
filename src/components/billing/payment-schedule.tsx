import Link from "next/link";
import { Badge } from "@/components/ui";
import { Field, Input } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtDate, fmtSAR, type ActionState } from "@/lib/utils";
import { termWhen } from "@/server/modules/commerce/pure";
import { STAGE_TONE, type InstallmentInvoice, type InstallmentStage } from "@/server/modules/billing/schedule-pure";
import { INVOICE_STATUS_LABEL } from "@/server/modules/billing/access";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
export type ScheduleRow = {
  id: string; label: string; percent: string; total: string; dueKind: string; dueOn: string | null; milestone: string | null; beforeStart: boolean; series: string | null;
  stage: InstallmentStage; stageLabel: string; invoices: InstallmentInvoice[];
  history: { at: string; by: string | null; kind: string; note?: string | null; from?: string | null; to?: string | null }[];
};

const d = (v: Date | string | null | undefined) => (v ? fmtDate(v) : "—");

/**
 * The contract's payment schedule. Each installment shows its due date and, apart, its invoice's creation, approval,
 * sending and payment dates: issuing an invoice is not payment, and nothing here creates an invoice.
 */
export function PaymentScheduleTable({ rows, staff, setDue, names }: { rows: ScheduleRow[]; staff: boolean; setDue?: Act; names?: Map<string, string> }) {
  return (
    <div className="overflow-x-auto" data-testid="payment-schedule">
      <table className="w-full text-[14px]">
        <caption className="sr-only">جدول الدفعات التعاقدي</caption>
        <thead>
          <tr className="border-b border-line-strong text-[13px] text-muted">
            <th scope="col" className="py-2 text-start font-medium">الدفعة</th>
            <th scope="col" className="text-end font-medium">المبلغ</th>
            <th scope="col" className="ps-3 text-start font-medium">الاستحقاق</th>
            <th scope="col" className="ps-3 text-start font-medium">الحالة</th>
            <th scope="col" className="ps-3 text-start font-medium">{staff ? "الفاتورة: إنشاء · اعتماد · إرسال · سداد" : "الفاتورة والسداد"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const inv = r.invoices.filter((i) => i.status !== "void" && i.kind !== "credit_note");
            const visible = staff ? inv : inv.filter((i) => ["issued", "partially_paid", "paid"].includes(i.status));
            return (
              <tr key={r.id} className="align-top" data-testid={`installment-${r.label}`}>
                <td className="py-2 pe-2">{r.label} <span className="text-muted">({r.percent}٪)</span>{r.series ? <span className="block text-[12px] text-muted">ضمن دفعات {r.series}</span> : null}</td>
                <td className="tabular text-end">{fmtSAR(Number(r.total))}</td>
                <td className="ps-3">
                  {r.dueOn ? <span className="tabular">{r.dueOn}</span> : <span className="text-muted">{termWhen({ due: r.dueKind as never, dueOn: null, milestone: r.milestone })}</span>}
                  {r.beforeStart ? <span className="block text-[12px] text-muted">شرط للبدء</span> : null}
                  {staff && setDue ? (
                    <details className="mt-1 text-[13px]">
                      <summary className="cursor-pointer text-ink">{r.dueOn ? "عدّل الموعد" : "حدّد الموعد"}</summary>
                      <ActionForm action={setDue} hidden={{ scheduleId: r.id }} submit="احفظ الموعد" size="sm" variant="secondary" className="mt-2">
                        <Field label="تاريخ الاستحقاق" name="dueOn" required><Input type="date" name="dueOn" required defaultValue={r.dueOn ?? ""} dir="ltr" /></Field>
                        <Field label="السبب والمرجع" name="reason" required hint="مثل: اكتملت المرحلة، أو ملحق التعديل رقم…"><Input name="reason" required minLength={5} /></Field>
                      </ActionForm>
                    </details>
                  ) : null}
                </td>
                <td className="ps-3"><Badge tone={STAGE_TONE[r.stage]} icon={false}>{r.stageLabel}</Badge></td>
                <td className="ps-3 text-[13px]">
                  {visible.length ? visible.map((i) => (
                    <div key={i.id}>
                      {staff ? <Link href={`/admin/finance/${i.id}`} className="tabular text-ink hover:underline" dir="ltr">{i.number}</Link> : <Link href={`/app/billing/${i.id}`} className="tabular text-ink hover:underline" dir="ltr">{i.number}</Link>}
                      {" "}{INVOICE_STATUS_LABEL[i.status as keyof typeof INVOICE_STATUS_LABEL] ?? i.status}
                      <span className="block text-muted">
                        {staff ? `أُنشئت ${d(i.createdAt)} · اعتُمدت ${d(i.approvedAt)} · أُرسلت ${d(i.sentAt)} · ` : `أُرسلت ${d(i.sentAt)} · `}
                        {i.paidOn ? `سُددت ${d(i.paidOn)}` : i.paid > 0 ? `سُدد ${fmtSAR(i.paid)}` : "لم تُسدد"}
                      </span>
                    </div>
                  )) : <span className="text-muted">{staff ? "لم تُنشأ فاتورة" : "لم تصدر فاتورة بعد"}</span>}
                  {staff && r.history.length > 1 ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted">سجل الدفعة ({r.history.length})</summary>
                      <ul className="mt-1 list-disc ps-4 text-muted">{r.history.map((h) => <li key={h.at + h.kind}>{h.at.slice(0, 10)} — {({ created: "أُنشئت", due_set: "حُدد الموعد", due_changed: "عُدّل الموعد", alert: "تنبيه" } as Record<string, string>)[h.kind] ?? h.kind}{h.from || h.to ? ` (${h.from ?? "—"} ← ${h.to ?? "—"})` : ""}{h.note ? `: ${h.note}` : ""}{h.by && names?.get(h.by) ? ` — ${names.get(h.by)}` : ""}</li>)}</ul>
                    </details>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
