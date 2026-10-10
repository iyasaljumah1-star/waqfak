import Link from "next/link";
import { BellRing, FileCheck2, History, Scale } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import { cn, fmtDate, fmtDateTime, fmtHijri, relDays } from "@/lib/utils";
import type { InstanceView } from "@/server/modules/compliance/queries";
import { AUTHORITY_AR, CATEGORY_AR, EVENT_ACTION_AR, STATUS_AR, STATUS_TONE } from "@/server/modules/compliance/pure";
import { CompleteForm, ReopenForm, WaiveForm } from "./forms";

const BAND_TONE: Record<string, Tone> = { dismissal: "critical", fine: "fine", warning: "warn" };
const SEVERITY_AR: Record<string, string> = { critical: "حرج", high: "مرتفع", medium: "متوسط", low: "منخفض" };

export function DueDate({ iso, immediate }: { iso: string | null; immediate?: boolean }) {
  if (!iso) return <span className="text-muted">الموعد غير محدد — بانتظار التحقق</span>;
  return (
    <span>
      <span className="font-medium">{fmtDate(iso)}</span>
      <span className="text-muted"> · {fmtHijri(iso)}</span>
      {immediate ? <span className="text-muted"> · فوري</span> : null}
    </span>
  );
}

type Props = {
  item: InstanceView;
  waqfId: string;
  canManage: boolean;
  canUpload: boolean;
  docs: { id: string; title: string; number: string | null }[];
};

export function ObligationItem({ item: i, waqfId, canManage, canUpload, docs }: Props) {
  const open = ["upcoming", "due_soon", "overdue"].includes(i.status);
  const showPenalty = i.penalty && (open || i.status === "waived");
  return (
    <article
      id={`i-${i.id}`}
      aria-labelledby={`t-${i.id}`}
      className={cn(
        "scroll-mt-24 rounded-lg border border-line bg-surface p-4 md:p-5",
        i.status === "overdue" && "border-s-4 border-s-critical",
        i.status === "due_soon" && "border-s-4 border-s-warn",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={`t-${i.id}`} className="text-[16px] font-semibold leading-7 text-text">{i.title}</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            <span dir="ltr" className="tabular">{i.code}</span> · {CATEGORY_AR[i.category] ?? i.category} · {AUTHORITY_AR[i.authority] ?? i.authority} · الأهمية {SEVERITY_AR[i.severity] ?? i.severity}
            {i.periodKey?.startsWith("FY") ? <> · السنة المالية {i.periodKey.slice(2)}</> : null}
          </p>
        </div>
        <Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{STATUS_AR[i.status] ?? i.status}</Badge>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-muted">الموعد</dt>
          <dd>
            <DueDate iso={i.dueOn} immediate={i.dueImmediately} />
            {open && i.dueOn ? <span className={cn("ms-2 text-[13px] font-medium", i.status === "overdue" ? "text-critical" : "text-muted")}>({relDays(i.dueOn)})</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted">المرجع النظامي</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            <Scale aria-hidden className="size-4 text-muted" />
            <span>{i.reference.label}</span>
            {i.reference.requirement ? <span dir="ltr" className="text-[12px] text-muted tabular">{i.reference.requirement}</span> : null}
            {i.reference.pending ? <Badge tone="seal" icon={false}>بانتظار التحقق</Badge> : null}
          </dd>
          {i.reference.source && i.reference.source !== i.reference.label ? <p className="text-[12px] text-muted">{i.reference.source}</p> : null}
        </div>
        {showPenalty ? (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">الجزاء المحتمل عند التأخر</dt>
            <dd className="mt-0.5"><Badge tone={BAND_TONE[i.penalty!.band] ?? "fine"}>{i.penalty!.text}</Badge></dd>
          </div>
        ) : null}
        {i.status === "done" ? (
          <div>
            <dt className="text-[13px] text-muted">أُنجز في</dt>
            <dd>{i.completedOn ? <DueDate iso={i.completedOn} /> : "—"}</dd>
          </div>
        ) : null}
        {i.waivedReason ? (
          <div className="sm:col-span-2">
            <dt className="text-[13px] text-muted">{i.status === "not_applicable" ? "سبب عدم الانطباق" : "سبب الإعفاء"}</dt>
            <dd>{i.waivedReason}</dd>
          </div>
        ) : null}
      </dl>

      {open && i.details ? <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-[15px] leading-7">{i.details}</p> : null}
      {i.obligationPending && i.notes ? <p className="mt-2 text-[13px] text-muted">ملاحظة التحقق: {i.notes}</p> : null}

      <div className="mt-3 space-y-1">
        <p className="flex items-center gap-1.5 text-[13px] text-muted"><FileCheck2 aria-hidden className="size-4" /> الأدلة</p>
        {i.documents.length ? (
          <ul className="space-y-1 text-[15px]">
            {i.documents.map((d) => (
              <li key={d.id}>
                {d.hidden ? <span className="text-muted">{d.title}</span> : <Link className="text-ink underline-offset-4 hover:underline" href={`/app/w/${waqfId}/documents/${d.id}`}>{d.title}</Link>}
                {d.number ? <span className="text-[13px] text-muted"> ({d.number})</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{i.evidenceRequired ? `لم يُرفق بعد. المطلوب: ${i.evidenceRequired}` : "لم يُرفق دليل بعد."}</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {i.why.length ? (
          <details className="group text-[14px]">
            <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">لماذا ينطبق عليّ؟</summary>
            <ul className="mt-2 list-disc space-y-1 ps-5 text-text/90">
              {i.why.map((w, k) => <li key={k}>{w}</li>)}
            </ul>
          </details>
        ) : null}
        <details className="text-[14px]">
          <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">
            <BellRing aria-hidden className="me-1 inline size-4" />التذكيرات ({i.reminders.length})
          </summary>
          {i.reminders.length ? (
            <ul className="mt-2 space-y-1 ps-1 text-muted">
              {i.reminders.map((r, k) => (
                <li key={k}>{fmtDateTime(r.at)} — {r.offset < 0 ? `إشعار تأخر (${Math.abs(r.offset)} يوم)` : `قبل الموعد بـ ${r.offset} يومًا`}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted">لم يُرسل تذكير بعد.</p>
          )}
        </details>
        <details className="text-[14px]">
          <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">
            <History aria-hidden className="me-1 inline size-4" />السجل
          </summary>
          <ol className="mt-2 space-y-1 ps-1 text-muted">
            {i.history.map((h, k) => (
              <li key={k}>
                {fmtDateTime(h.at)} — {EVENT_ACTION_AR[h.action] ?? h.action}
                {h.note && h.action !== "reminder" ? `: ${h.note}` : ""}
                {h.actor ? ` (${h.actor})` : ""}
              </li>
            ))}
          </ol>
        </details>
      </div>

      {canManage ? (
        <div className="mt-4 border-t border-line pt-3">
          {open ? (
            <div className="flex flex-col gap-3">
              <details className="rounded-md border border-line px-3 py-2 open:pb-4">
                <summary className="cursor-pointer font-medium text-ink">أنجز مع دليل</summary>
                <div className="mt-3">
                  <CompleteForm waqfId={waqfId} instanceId={i.id} docs={docs} linkedIds={i.documents.map((d) => d.id)} evidenceHint={i.evidenceRequired} canUpload={canUpload} />
                </div>
              </details>
              <details className="rounded-md border border-line px-3 py-2 open:pb-4">
                <summary className="cursor-pointer font-medium text-muted">إعفاء بسبب</summary>
                <div className="mt-3">
                  <WaiveForm waqfId={waqfId} instanceId={i.id} />
                </div>
              </details>
            </div>
          ) : i.status === "done" || i.status === "waived" ? (
            <ReopenForm waqfId={waqfId} instanceId={i.id} />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
