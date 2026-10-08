import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { Select, SubmitButton } from "@/components/ui/form";
import { ActionForm } from "@/components/admin/action-form";
import { ClientsTabs } from "@/components/admin/section-tabs";
import { cn, fmtDateTime } from "@/lib/utils";
import { requireAdmin } from "@/server/modules/admin/guard";
import { assignContactMessage, setContactStatus } from "@/server/modules/admin/clients/actions";
import { CONTACT_STATUS_LABEL, listContactMessages } from "@/server/modules/admin/clients/queries";

export const metadata: Metadata = { title: "رسائل التواصل" };

const FILTERS = [
  { key: "open", label: "المفتوحة" },
  { key: "new", label: "جديدة" },
  { key: "in_progress", label: "قيد المتابعة" },
  { key: "handled", label: "عولجت" },
  { key: "all", label: "الكل" },
];

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const auth = await requireAdmin("admin.users");
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.status) ? sp.status! : "open";
  const { rows: all, staff, names } = await listContactMessages(auth, filter === "open" ? undefined : filter);
  const rows = filter === "open" ? all.filter((r) => r.status !== "handled") : all;
  const newCount = all.filter((r) => r.status === "new").length;

  return (
    <div>
      <PageHeader title="رسائل التواصل" description="ما يصل من نموذج «تواصل معنا» في الموقع. أسند الرسالة لموظف، وعلّمها معالَجة بعد الرد." />
      <ClientsTabs newMessages={filter === "open" ? newCount : undefined} />
      <nav aria-label="تصفية الرسائل" className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/clients/messages?status=${f.key}`} aria-current={f.key === filter ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 text-[15px]", f.key === filter ? "bg-ink text-white dark:text-[#0f141c]" : "border border-line-strong bg-surface hover:bg-surface-2")}>
            {f.label}
          </Link>
        ))}
      </nav>
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((m) => (
            <li key={m.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{m.topic}</p>
                  <p className="text-[13px] text-muted">
                    {m.name}
                    {m.phone ? <> · <span dir="ltr" className="tabular">{m.phone}</span></> : null}
                    {m.email ? <> · <span dir="ltr">{m.email}</span></> : null}
                    {" · "}{fmtDateTime(m.createdAt)}
                  </p>
                </div>
                <span className="flex flex-wrap gap-1">
                  <Badge tone={m.status === "new" ? "fine" : m.status === "handled" ? "ok" : "info"} icon={false}>{CONTACT_STATUS_LABEL[m.status] ?? m.status}</Badge>
                  {m.handledBy ? <Badge tone="neutral" icon={false}>{names.get(m.handledBy) ?? "—"}</Badge> : null}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line text-[15px] leading-7">{m.body}</p>
              <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
                <ActionForm action={assignContactMessage} hidden={{ id: m.id }} className="flex flex-wrap items-end gap-2 space-y-0">
                  <label className="sr-only" htmlFor={`as-${m.id}`}>إسناد إلى</label>
                  <Select name="assignee" id={`as-${m.id}`} defaultValue={m.handledBy ?? auth.user.id} className="h-9 w-56" options={staff.map((s) => ({ value: s.id, label: s.id === auth.user.id ? `أنا (${s.name ?? ""})` : s.name ?? "—" }))} />
                  <SubmitButton variant="secondary" size="sm">أسند</SubmitButton>
                </ActionForm>
                {m.status !== "handled" ? (
                  <ActionForm action={setContactStatus} hidden={{ id: m.id, status: "handled" }} className="space-y-0">
                    <SubmitButton size="sm">علّمها معالَجة</SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={setContactStatus} hidden={{ id: m.id, status: "in_progress" }} className="space-y-0">
                    <SubmitButton variant="ghost" size="sm">أعد فتحها</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Inbox} title="لا رسائل هنا">تظهر هنا رسائل نموذج التواصل فور وصولها.</EmptyState>
      )}
    </div>
  );
}
