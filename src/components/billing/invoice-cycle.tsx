import Link from "next/link";
import { FileDown } from "lucide-react";
import { Badge } from "@/components/ui";
import { Field, Input, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtDateTime, fmtSAR } from "@/lib/utils";
import { approveInvoice, discardInvoiceDraft, sendInvoice, updateInvoiceDraft } from "@/server/modules/billing/actions";

type Inv = {
  id: string; number: string; status: string; total: string | number; billedToName: string; dueOn: string | null; issuedOn: string; kind: string;
  lines: { description: string }[]; createdBy: string | null; approvedAt: Date | null; selfApproved: boolean; sentAt: Date | null;
  sendResult: { ok: boolean; at: string; error?: string } | null;
};

/**
 * Invoice cycle for the team: preview → correct the draft → approve (finance) → send (visible to the client) → payment.
 * Each step is a separate, recorded action; nothing is sent when the invoice is created.
 */
export function InvoiceCycle({ inv, canApprove, canWork, me, compact }: { inv: Inv; canApprove: boolean; canWork: boolean; me: string; compact?: boolean }) {
  const step = inv.status === "draft" ? 1 : inv.status === "approved" ? 2 : 3;
  const failed = inv.status === "approved" && inv.sendResult && !inv.sendResult.ok;
  return (
    <div className="space-y-2 rounded-md border border-dashed border-line-strong p-3" data-testid={`invoice-cycle-${inv.id}`}>
      <ol className="flex flex-wrap gap-2 text-[13px]" aria-label="دورة الفاتورة">
        {["المسودة والمعاينة", "الاعتماد", "الإرسال للعميل"].map((t, i) => (
          <li key={t}><Badge tone={i + 1 < step ? "ok" : i + 1 === step ? "info" : "neutral"} icon={false}>{i + 1}. {t}</Badge></li>
        ))}
      </ol>
      <p className="flex flex-wrap items-center gap-2 text-[14px]">
        <Link href={`/app/billing/${inv.id}`} className="font-medium text-ink underline" data-testid="invoice-preview">معاينة الفاتورة كاملة</Link>
        <a href={`/app/billing/${inv.id}/pdf`} className="inline-flex items-center gap-1 text-ink hover:underline"><FileDown aria-hidden className="size-4" />PDF المعاينة</a>
        <span className="text-muted">{inv.billedToName} · <span className="tabular">{fmtSAR(inv.total)}</span></span>
      </p>
      {failed ? <p role="alert" className="text-[14px] text-critical">فشلت محاولة الإرسال {fmtDateTime(new Date(inv.sendResult!.at))}: {inv.sendResult!.error}. لم تُرسل الفاتورة.</p> : null}
      {inv.status === "draft" ? (
        <>
          {canWork && !compact ? (
            <details>
              <summary className="cursor-pointer text-[14px] text-ink">صحّح المسودة</summary>
              <div className="mt-2">
                <ActionForm action={updateInvoiceDraft} hidden={{ invoiceId: inv.id }} submit="احفظ التصحيح" size="sm">
                  <Field label="يُفوتر باسم" name={`billed-${inv.id}`}><Input id={`billed-${inv.id}`} name="billedToName" defaultValue={inv.billedToName} required /></Field>
                  <Field label="وصف البند" name={`desc-${inv.id}`}><Textarea id={`desc-${inv.id}`} name="description" defaultValue={inv.lines[0]?.description ?? ""} required className="min-h-16" /></Field>
                  <Field label="مدة الاستحقاق بالأيام (من الإرسال)" name={`due-${inv.id}`}><Input id={`due-${inv.id}`} name="dueDays" type="number" min={0} max={120} defaultValue="14" dir="ltr" /></Field>
                </ActionForm>
              </div>
            </details>
          ) : null}
          {canApprove ? (
            <ActionForm action={approveInvoice} hidden={{ invoiceId: inv.id }} submit={inv.createdBy === me ? "اعتمد الفاتورة (اعتماد ذاتي مسجل)" : "اعتمد الفاتورة"} size="sm" inline />
          ) : <p className="text-[13px] text-muted">يعتمدها من يملك صلاحية المالية.</p>}
        </>
      ) : null}
      {inv.status === "approved" && canWork ? <ActionForm action={sendInvoice} hidden={{ invoiceId: inv.id }} submit={failed ? "أعد محاولة الإرسال" : "أرسل الفاتورة للعميل"} size="sm" variant="seal" inline /> : null}
      {(inv.status === "draft" || inv.status === "approved") && canWork ? (
        <details>
          <summary className="cursor-pointer text-[13px] text-critical">اسحب الفاتورة قبل إرسالها</summary>
          <div className="mt-2">
            <ActionForm action={discardInvoiceDraft} hidden={{ invoiceId: inv.id }} submit="اسحب" variant="danger" size="sm">
              <Field label="السبب" name={`wd-${inv.id}`}><Textarea id={`wd-${inv.id}`} name="note" required minLength={5} className="min-h-16" /></Field>
            </ActionForm>
          </div>
        </details>
      ) : null}
      {inv.approvedAt ? <p className="text-[12px] text-muted">اعتُمدت {fmtDateTime(inv.approvedAt)}{inv.selfApproved ? " (اعتماد ذاتي)" : ""}{inv.sentAt ? ` · أُرسلت ${fmtDateTime(inv.sentAt)}` : ""}</p> : null}
    </div>
  );
}
