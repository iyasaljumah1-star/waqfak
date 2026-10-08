import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageSquareText } from "lucide-react";
import { Alert, Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/ui/form";
import { ActionForm } from "@/components/admin/action-form";
import { NotificationsTabs } from "@/components/admin/section-tabs";
import { cn, fmtDateTime, fmtNumber } from "@/lib/utils";
import { env } from "@/server/env";
import { maskPhoneShort, requireAdmin } from "@/server/modules/admin/guard";
import { resendOutbox } from "@/server/modules/admin/notifications/actions";
import { outboxPage, type OutboxFilter } from "@/server/modules/admin/notifications/queries";

export const metadata: Metadata = { title: "الرسائل الصادرة" };

const STATUS: Record<string, { label: string; tone: "warn" | "ok" | "critical" }> = {
  queued: { label: "في الانتظار", tone: "warn" }, sent: { label: "أُرسلت", tone: "ok" }, failed: { label: "فشلت", tone: "critical" },
};
const sel = "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]";

export default async function OutboxPage({ searchParams }: { searchParams: Promise<OutboxFilter> }) {
  const auth = await requireAdmin("admin.notifications");
  const f = await searchParams;
  const d = await outboxPage(auth, f);
  const providerless = env.SMS_PROVIDER === "outbox" || env.EMAIL_PROVIDER === "outbox";
  const last = d.rows[d.rows.length - 1];
  const qs = (x: Record<string, string>) => `/admin/notifications/outbox?${new URLSearchParams(Object.entries({ ...f, ...x }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <div>
      <PageHeader title="الإشعارات والرسائل" description="كل رسالة نصية أو بريد تمر بصندوق الصادر أولًا: للتتبع وإعادة المحاولة." />
      <NotificationsTabs />
      {providerless ? (
        <Alert tone="warn" title="مزوّد الإرسال غير مربوط" className="mb-4">
          {env.SMS_PROVIDER === "outbox" ? "الرسائل النصية" : ""}{env.SMS_PROVIDER === "outbox" && env.EMAIL_PROVIDER === "outbox" ? " والبريد" : env.EMAIL_PROVIDER === "outbox" ? "البريد" : ""} لا تُرسل فعليًا الآن؛ تظهر هنا كما كانت ستُرسل بحالة «في الانتظار». رموز التحقق محجوبة.
        </Alert>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2 text-[14px]">
        <Badge tone="warn" icon={false}>في الانتظار {fmtNumber(d.counts.queued)}</Badge>
        <Badge tone="ok" icon={false}>أُرسلت {fmtNumber(d.counts.sent)}</Badge>
        <Badge tone="critical" icon={false}>فشلت {fmtNumber(d.counts.failed)}</Badge>
      </div>
      <form role="search" className="mb-4 grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        <label htmlFor="channel" className="sr-only">القناة</label>
        <select id="channel" name="channel" defaultValue={f.channel ?? ""} className={sel}>
          <option value="">كل القنوات</option>
          <option value="sms">رسائل نصية</option>
          <option value="email">بريد</option>
        </select>
        <label htmlFor="status" className="sr-only">الحالة</label>
        <select id="status" name="status" defaultValue={f.status ?? ""} className={sel}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label htmlFor="q" className="sr-only">المستلم</label>
        <input id="q" name="q" defaultValue={f.q ?? ""} placeholder="رقم أو بريد المستلم" dir="ltr" className={sel} />
        <button className="h-10 rounded-md border border-line-strong bg-surface px-4 text-[15px] hover:bg-surface-2">عرض</button>
      </form>
      {d.rows.length ? (
        <Panel tight>
          <ul className="divide-y divide-line">
            {d.rows.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {m.channel === "sms" ? <MessageSquareText aria-label="رسالة نصية" className="size-4 shrink-0 text-muted" /> : <Mail aria-label="بريد" className="size-4 shrink-0 text-muted" />}
                    <span dir="ltr" className="tabular truncate text-[14px]">{m.channel === "sms" ? maskPhoneShort(m.toAddress) : m.toAddress}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[13px] text-muted">
                    <Badge tone={STATUS[m.status]?.tone ?? "neutral"} icon={false}>{STATUS[m.status]?.label ?? m.status}</Badge>
                    {m.attempts ? <span>أعيدت {fmtNumber(m.attempts)}</span> : null}
                    <span>{fmtDateTime(m.createdAt)}</span>
                  </span>
                </div>
                {m.subject ? <p className="mt-1 font-medium">{m.subject}</p> : null}
                <p className={cn("mt-1 whitespace-pre-line text-[14px] leading-6", m.otp && "text-muted")}>{m.body}</p>
                {m.error ? <p className="mt-1 text-[13px] text-critical" dir="ltr">{m.error}</p> : null}
                {!m.otp && (m.channel === "sms" || m.channel === "email") ? (
                  <ActionForm action={resendOutbox} hidden={{ id: String(m.id) }} className="mt-2 space-y-1">
                    <SubmitButton variant="ghost" size="sm" pendingText="…">أعد الإرسال</SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <EmptyState icon={Mail} title="لا رسائل مطابقة" />
      )}
      <div className="mt-4 flex gap-2">
        {f.before ? <Link href={qs({ before: "" })} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px]">الأحدث</Link> : null}
        {d.hasMore && last ? <Link href={qs({ before: String(last.id) })} className="rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px]">الأقدم</Link> : null}
      </div>
    </div>
  );
}
