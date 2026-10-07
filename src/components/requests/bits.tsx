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

export function NotesThread({ notes, names, me, showVisibility }: { notes: { id: string; body: string; createdAt: Date; authorId: string; visibility: string }[]; names: Map<string, { name: string; isStaff: boolean }>; me: string; showVisibility?: boolean }) {
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
