import type { ReactNode } from "react";
import { Fragment } from "react";
import { Badge, Steps } from "@/components/ui";
import { cn, daysUntil, fmtDate, fmtDateTime, relDays } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, type RequestStatus } from "@/server/modules/requests/workflow";

export const PRIORITY_LABEL: Record<string, string> = { urgent: "عاجل", high: "مرتفعة", normal: "عادية", low: "منخفضة" };
export const CONTACT_LABEL: Record<string, string> = { platform: "رسائل المنصة", phone: "اتصال هاتفي", email: "البريد الإلكتروني", whatsapp: "واتساب" };
export const CONFLICT_LABEL: Record<string, string> = { pending: "قيد الفحص", passed: "لا تعارض", blocked: "تعارض استقلال", override_approved: "استثناء معتمد" };

export function StatusBadge({ status }: { status: string }) {
  const s = status as RequestStatus;
  return <Badge tone={STATUS_TONE[s] ?? "neutral"} icon={false}>{STATUS_LABEL[s] ?? status}</Badge>;
}

export function ConflictBadge({ value }: { value: string }) {
  if (value === "passed" || value === "pending") return null;
  return <Badge tone={value === "blocked" ? "critical" : "seal"}>{CONFLICT_LABEL[value] ?? value}</Badge>;
}

const toIso = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(d);

/** SLA badge: overdue (red), due within 2 days (warn), otherwise neutral. */
export function SlaBadge({ due, status }: { due: Date | null; status: string }) {
  if (!due || ["completed", "closed", "cancelled", "rejected"].includes(status)) return <span className="text-sm text-muted">—</span>;
  const iso = toIso(due);
  const n = daysUntil(iso) ?? 0;
  const paused = status === "on_hold" || status === "awaiting_client" || status === "quote" || status === "awaiting_contract" || status === "awaiting_client_approval";
  if (paused) return <Badge tone="neutral" icon={false}>{relDays(iso)} · بانتظار طرف آخر</Badge>;
  return <Badge tone={n < 0 ? "critical" : n <= 2 ? "warn" : "neutral"} icon={n < 0}>{relDays(iso)}</Badge>;
}

/** Status timeline from request_stages. */
export function StageTimeline({ stages }: { stages: { id: string; name: string; status: string; slaDueAt: Date | null; completedAt: Date | null; startedAt: Date | null }[] }) {
  if (!stages.length) return <p className="text-sm text-muted">لا مراحل معرّفة لهذه الخدمة.</p>;
  return (
    <Steps
      steps={stages.map((s) => ({
        label: s.name,
        status: (s.status === "done" || s.status === "active" || s.status === "skipped" ? s.status : "pending") as "done" | "active" | "pending" | "skipped",
        meta:
          s.status === "done" ? <>اكتملت {fmtDate(s.completedAt)}</>
          : s.status === "active" ? <>جارية — المهلة {s.slaDueAt ? `${fmtDate(s.slaDueAt)} (${relDays(toIso(s.slaDueAt))})` : "غير محددة"}</>
          : s.status === "skipped" ? <>لم تُنفذ</>
          : s.slaDueAt ? <>متوقعة بحلول {fmtDate(s.slaDueAt)}</> : null,
      }))}
    />
  );
}

export function EventList({ events, names }: { events: { id: string; note: string | null; at: Date; actorUserId: string | null; toStatus: string | null }[]; names: Map<string, { name: string; isStaff: boolean }> }) {
  if (!events.length) return <p className="text-sm text-muted">لا أحداث بعد.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const who = e.actorUserId ? names.get(e.actorUserId) : null;
        return (
          <li key={e.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
            <p className="text-[15px]">{e.note ?? (e.toStatus ? STATUS_LABEL[e.toStatus as RequestStatus] : "")}</p>
            <p className="text-[13px] text-muted">
              {fmtDateTime(e.at)}
              {who ? <> · {who.name}{who.isStaff ? " (وقفك)" : ""}</> : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function NotesThread({ notes, names, me, showVisibility, docTitles }: { notes: { id: string; body: string; createdAt: Date; authorId: string; visibility: string; documentId?: string | null }[]; names: Map<string, { name: string; isStaff: boolean }>; me: string; showVisibility?: boolean; docTitles?: Map<string, string> }) {
  if (!notes.length) return <p className="text-sm text-muted">لا رسائل بعد. اكتب أول رسالة بالأسفل.</p>;
  return (
    <ul className="space-y-3">
      {notes.map((n) => {
        const who = names.get(n.authorId);
        const mine = n.authorId === me;
        return (
          <li key={n.id} className={cn("rounded-lg border p-3", n.visibility === "internal" ? "border-dashed border-seal bg-seal-soft/40" : mine ? "border-line bg-ink-soft/40" : "border-line bg-surface")}>
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span className="font-medium text-text">{mine ? "أنت" : who?.name ?? "مستخدم"}</span>
              {who?.isStaff ? <span>فريق وقفك</span> : null}
              <span>{fmtDateTime(n.createdAt)}</span>
              {showVisibility ? <Badge tone={n.visibility === "internal" ? "seal" : "info"} icon={false}>{n.visibility === "internal" ? "داخلية" : "مرئية للعميل"}</Badge> : null}
            </p>
            <p className="mt-1 whitespace-pre-line leading-7">{n.body}</p>
            {n.documentId ? (
              <a href={`/api/files/${n.documentId}?disposition=inline`} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-[14px] text-ink underline">
                مرفق: {docTitles?.get(n.documentId) ?? "فتح الملف"}
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Renders the contract body (markdown subset: #, ##, **bold**, ---) on deed paper in Naskh. */
export function ContractPaper({ body, number, hash, footer }: { body: string; number: string; hash: string; footer?: ReactNode }) {
  const bold = (t: string) => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
  return (
    <article className="deed-paper naskh rounded-lg border border-line px-5 py-6 text-[17px] leading-[35px] md:px-10" aria-label={`نص العقد ${number}`}>
      {body.split("\n").map((line, i) => {
        if (line.startsWith("# ")) return <h3 key={i} className="mb-[35px] text-center text-[1.45rem] font-bold leading-[35px] text-ink">{bold(line.slice(2))}</h3>;
        if (line.startsWith("## ")) return <h4 key={i} className="font-bold leading-[35px] text-ink">{bold(line.slice(3))}</h4>;
        if (line.trim() === "---") return <hr key={i} className="my-[17px] border-line-strong" />;
        if (!line.trim()) return <div key={i} className="h-[17px]" aria-hidden />;
        return <p key={i} className="leading-[35px]">{bold(line)}</p>;
      })}
      {footer}
      <p className="mt-4 break-all font-sans text-[12px] leading-5 text-muted" dir="ltr">SHA-256: {hash}</p>
    </article>
  );
}

// ───────────────────────── Next action, intake, register, quote, contract parties ─────────────────────────

const WHO_TONE: Record<string, "info" | "warn" | "seal" | "neutral" | "fine"> = { client: "warn", waqfak: "info", ops: "seal", external: "fine", none: "neutral" };

/** «الإجراء التالي ومن عليه» — derived from the request's real state (journey.ts). */
export function NextActionBanner({ next, viewer }: { next: { who: string; label: string; detail?: string }; viewer: "client" | "staff" }) {
  if (next.who === "none") return null;
  const whoLabel = next.who === "client" ? (viewer === "client" ? "عليك أنت" : "على العميل") : next.who === "ops" ? "على مدير التشغيل" : next.who === "external" ? "على جهة خارجية" : viewer === "client" ? "على فريق «وقفك»" : "على الفريق";
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-3" data-testid="next-action">
      <Badge tone={WHO_TONE[next.who] ?? "neutral"} icon={false}>الخطوة التالية {whoLabel}</Badge>
      <p className="text-[15px] font-medium">{next.label}</p>
      {next.detail ? <p className="text-[13px] text-muted">{next.detail}</p> : null}
    </div>
  );
}

/** Intake answers grouped by the form's steps, in the form's own labels. */
export function IntakeSummaryView({ sections, docs, docTitles }: { sections: { key: string; title: string; rows: { key: string; label: string; value: string }[] }[]; docs?: { label: string; ids: string[] }[]; docTitles?: Map<string, string> }) {
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <section key={s.key}>
          <h3 className="mb-1 text-[15px] font-semibold text-ink">{s.title}</h3>
          <dl className="grid gap-x-4 gap-y-1.5 text-[15px] sm:grid-cols-[minmax(0,13rem)_1fr]">
            {s.rows.map((r) => (
              <div key={r.key} className="contents">
                <dt className="text-muted">{r.label}</dt>
                <dd className="whitespace-pre-line break-words">{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {docs?.length ? (
        <section>
          <h3 className="mb-1 text-[15px] font-semibold text-ink">المستندات المرفقة بالنموذج</h3>
          <ul className="space-y-1 text-[15px]">
            {docs.map((d) => (
              <li key={d.label}><span className="text-muted">{d.label}: </span>{d.ids.length ? d.ids.map((id) => <a key={id} href={`/api/files/${id}?disposition=inline`} target="_blank" rel="noopener" className="me-2 text-ink underline">{docTitles?.get(id) ?? "فتح"}</a>) : "—"}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function QuoteDocument({ q, today, names }: {
  q: { number: string; version: number; kind: string; status: string; scope: string; deliverables: string | null; exclusions: string | null; assumptions: string | null; clientObligations: string | null; durationDays: number | null; lines: { description: string; qty: number; unit: number; total: number }[]; subtotal: string; discount: string; net: string; vatRate: string; vat: string; total: string; paymentTerms: { key: string; label: string; percent: number; due: string; beforeStart: boolean }[]; validUntil: string; contentHash: string | null; preparedBy: string | null; approvedBy: string | null; sentAt: Date | null; respondedAt: Date | null; responseNote: string | null };
  today: string;
  names?: Map<string, { name: string; isStaff: boolean }>;
}) {
  const expired = q.status === "sent" && q.validUntil < today;
  const sar = (n: number | string) => `${Number(n).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
  const DUE: Record<string, string> = { on_contract: "عند توقيع العقد", before_start: "قبل بدء التنفيذ", on_delivery: "عند تسليم المخرجات", on_completion: "عند اكتمال الخدمة" };
  return (
    <article className="space-y-3 text-[15px]" aria-label={`عرض السعر ${q.number}`}>
      <p className="text-[13px] text-muted">
        {q.kind === "amendment" ? "ملحق تعديل" : "عرض سعر"} <span dir="ltr" className="tabular">{q.number}</span> — نسخة {q.version} — صالح حتى {fmtDate(q.validUntil)}
        {expired ? <Badge tone="warn" icon={false} className="ms-2">انتهت صلاحيته</Badge> : null}
      </p>
      <section><h4 className="font-semibold">نطاق العمل</h4><p className="whitespace-pre-line leading-7">{q.scope}</p></section>
      {q.deliverables ? <section><h4 className="font-semibold">المخرجات</h4><p className="whitespace-pre-line leading-7">{q.deliverables}</p></section> : null}
      {q.exclusions ? <section><h4 className="font-semibold">ما لا يشمله النطاق</h4><p className="whitespace-pre-line leading-7">{q.exclusions}</p></section> : null}
      {q.assumptions ? <section><h4 className="font-semibold">الافتراضات</h4><p className="whitespace-pre-line leading-7">{q.assumptions}</p></section> : null}
      {q.clientObligations ? <section><h4 className="font-semibold">التزاماتك</h4><p className="whitespace-pre-line leading-7">{q.clientObligations}</p></section> : null}
      {q.durationDays ? <p><span className="text-muted">المدة: </span>{q.durationDays} يومًا من نفاذ العقد واكتمال ما يلزم منك</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <caption className="sr-only">بنود العرض</caption>
          <thead><tr className="border-b border-line-strong text-[13px] text-muted"><th scope="col" className="py-1.5 text-start font-medium">البند</th><th scope="col" className="w-12 py-1.5 text-center font-medium">الكمية</th><th scope="col" className="w-28 py-1.5 text-end font-medium">المبلغ</th></tr></thead>
          <tbody>{q.lines.map((l, i) => <tr key={i} className="border-b border-line"><td className="py-1.5 pe-2">{l.description}</td><td className="tabular py-1.5 text-center">{l.qty}</td><td className="tabular py-1.5 text-end">{sar(l.total)}</td></tr>)}</tbody>
        </table>
      </div>
      <dl className="ms-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-0.5">
        {Number(q.discount) ? <><dt className="text-muted">الخصم</dt><dd className="tabular text-end">{sar(q.discount)}</dd></> : null}
        <dt className="text-muted">الصافي</dt><dd className="tabular text-end">{sar(q.net)}</dd>
        <dt className="text-muted">الضريبة ({Number(q.vatRate)}٪)</dt><dd className="tabular text-end">{sar(q.vat)}</dd>
        <dt className="border-t border-line-strong pt-1 font-semibold">الإجمالي</dt><dd className="tabular border-t border-line-strong pt-1 text-end font-semibold">{sar(q.total)}</dd>
      </dl>
      <section>
        <h4 className="font-semibold">شروط الدفع</h4>
        <ul className="list-disc space-y-0.5 ps-5">{q.paymentTerms.map((t) => <li key={t.key}>{t.label} — {t.percent}٪ — {DUE[t.due] ?? t.due}{t.beforeStart ? " — يُشترط سدادها قبل البدء" : ""}</li>)}</ul>
      </section>
      {q.responseNote ? <p className="rounded-md bg-surface-2 px-3 py-2"><span className="text-muted">ملاحظة الرد: </span>{q.responseNote}</p> : null}
      {names ? (
        <p className="text-[12px] text-muted">
          أعدّه {names.get(q.preparedBy ?? "")?.name ?? "—"}{q.approvedBy ? ` · اعتمده ${names.get(q.approvedBy)?.name ?? "—"}` : ""}{q.sentAt ? ` · أُرسل ${fmtDateTime(q.sentAt)}` : ""}{q.respondedAt ? ` · الرد ${fmtDateTime(q.respondedAt)}` : ""}
        </p>
      ) : null}
      {q.contentHash ? <p className="break-all text-[11px] text-muted" dir="ltr">SHA-256: {q.contentHash}</p> : null}
    </article>
  );
}

export function PartiesList({ parties, signatures }: {
  parties: { key: string; side: string; name: string; capacity: string; signerName: string; authorityType: string; authorityRef?: string | null }[];
  signatures: { id: string; partyKey: string | null; signerName: string | null; capacity: string | null; signedAt: Date; ip: string | null }[];
}) {
  const AUTH: Record<string, string> = { self: "أصالة", agent: "وكيلًا بوكالة", nazir: "بصفته ناظر الوقف", board: "بتفويض من المجلس", legal_rep: "ممثلًا نظاميًا", company_signatory: "المفوّض بالتوقيع" };
  return (
    <ul className="divide-y divide-line rounded-lg border border-line" data-testid="contract-parties">
      {parties.map((p) => {
        const sig = signatures.find((s) => s.partyKey === p.key);
        return (
          <li key={p.key} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[15px]">
              <p className="font-medium">{p.side === "company" ? "الطرف الأول" : "الطرف الثاني"}: {p.name} <span className="text-[13px] font-normal text-muted">({p.capacity})</span></p>
              <p className="text-[13px] text-muted">يوقّع: {p.signerName} — {AUTH[p.authorityType] ?? p.authorityType}{p.authorityRef ? ` (${p.authorityRef})` : ""}</p>
              {sig ? <p className="text-[12px] text-muted">وقّع {sig.signerName ?? ""} {fmtDateTime(sig.signedAt)} برمز تحقق · IP <span dir="ltr">{sig.ip ?? "—"}</span></p> : null}
            </div>
            <Badge tone={sig ? "ok" : "warn"} icon={false}>{sig ? "وقّع" : "لم يوقّع بعد"}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

/** The separate states of a request: data complete, documents present, verified, accepted, approved to start, executed. */
export function RequestStates({ states }: { states: { label: string; done: boolean; at?: Date | null; note?: string }[] }) {
  return (
    <ul className="space-y-1.5 text-[14px]" data-testid="request-states">
      {states.map((s) => (
        <li key={s.label} className="flex items-start gap-2">
          <span aria-hidden className={cn("mt-1.5 inline-block size-2.5 shrink-0 rounded-full", s.done ? "bg-ok" : "bg-line-strong")} />
          <span className="min-w-0">
            <span className={s.done ? "text-text" : "text-muted"}>{s.label}</span>
            <span className="sr-only">{s.done ? ": تم" : ": لم يتم"}</span>
            {s.at ? <span className="ms-1 text-[12px] text-muted">{fmtDate(s.at)}</span> : null}
            {s.note ? <span className="block text-[12px] text-muted">{s.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
