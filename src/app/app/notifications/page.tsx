import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BellOff, CheckCheck } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, type Tone } from "@/components/ui";
import { cn, fmtDateTime, fmtNumber } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { notificationsData } from "@/server/modules/account/queries";
import { MarkAllReadButton, MarkReadButton, PreferencesForm, type PrefRow } from "./forms";

export const metadata: Metadata = { title: "الإشعارات" };

const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  critical: { label: "عاجل", tone: "critical" },
  important: { label: "مهم", tone: "warn" },
  info: { label: "للعلم", tone: "neutral" },
};

type Row = Awaited<ReturnType<typeof notificationsData>>["unread"][number];

function Item({ n, unread }: { n: Row; unread: boolean }) {
  const sev = SEVERITY[n.severity] ?? SEVERITY.info;
  return (
    <li data-testid="notification" data-unread={unread ? "1" : "0"} className={cn("flex gap-3 px-4 py-3.5 md:px-5", unread && "bg-ink-soft/40")}>
      <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-full", unread ? (n.severity === "critical" ? "bg-critical" : "bg-ink") : "bg-transparent")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {n.severity !== "info" ? <Badge tone={sev.tone} icon={false}>{sev.label}</Badge> : null}
          <p className={cn("min-w-0 break-words", unread ? "font-semibold" : "font-medium text-text")}>{n.titleAr}</p>
        </div>
        {n.bodyAr ? <p className="mt-0.5 break-words text-[15px] text-muted">{n.bodyAr}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <time dateTime={n.createdAt.toISOString()} className="text-[13px] text-muted">{fmtDateTime(n.createdAt)}</time>
          {n.link ? (
            <Link href={`/app/notifications/${n.id}`} prefetch={false} className="inline-flex items-center gap-1 text-sm text-ink hover:underline">
              افتح <ArrowLeft aria-hidden className="size-3.5" />
            </Link>
          ) : null}
          {unread ? <MarkReadButton id={n.id} /> : null}
        </div>
      </div>
    </li>
  );
}

export default async function NotificationsPage() {
  const auth = await requireAuth({ next: "/app/notifications" });
  const { unread, read, templates, prefs } = await notificationsData(auth);
  const rows: PrefRow[] = templates
    .filter((t) => t.channels.some((c) => c === "email" || c === "sms"))
    .map((t) => {
      const p = prefs.find((x) => x.type === t.key);
      return {
        key: t.key,
        // Templates carry {placeholders}; show the stable part as the label.
        title: t.titleAr.replace(/[:：]?\s*\{\w+\}/g, "").trim() || t.key,
        locked: t.locked,
        channels: t.channels,
        email: t.locked ? t.channels.includes("email") : p ? p.email : t.channels.includes("email"),
        sms: t.locked ? t.channels.includes("sms") : p ? p.sms : t.channels.includes("sms"),
      };
    });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="الإشعارات"
        description="مواعيد الالتزامات، وتحديثات طلباتك، والدعوات، وتنبيهات الأمان. نحتفظ بها هنا وإن أوقفت وصولها بالبريد أو الرسائل."
        actions={unread.length ? <MarkAllReadButton /> : null}
      />

      <Panel title={unread.length ? `غير مقروءة (${fmtNumber(unread.length)})` : "غير مقروءة"} tight>
        {unread.length ? (
          <ul className="divide-y divide-line">{unread.map((n) => <Item key={n.id} n={n} unread />)}</ul>
        ) : (
          <div className="p-4 md:p-5">
            <EmptyState icon={CheckCheck} title="لا إشعارات جديدة">قرأت كل ما وصلك. نخبرك هنا فور اقتراب موعد أو تحديث طلب.</EmptyState>
          </div>
        )}
      </Panel>

      <Panel title="سابقة" description={read.length ? "آخر 100 إشعار." : undefined} tight>
        {read.length ? (
          <ul className="divide-y divide-line">{read.map((n) => <Item key={n.id} n={n} unread={false} />)}</ul>
        ) : (
          <div className="p-4 md:p-5">
            <EmptyState icon={BellOff} title="لا إشعارات سابقة" />
          </div>
        )}
      </Panel>

      <Panel id="preferences" title="طرق الوصول" description="اختر ما يصلك بالبريد أو برسالة نصية. التنبيهات الأمنية والمواعيد الفائتة تصلك دائمًا.">
        {rows.length ? <PreferencesForm rows={rows} /> : <EmptyState title="لا إشعارات قابلة للضبط" />}
      </Panel>
    </div>
  );
}
