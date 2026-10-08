import type { Metadata } from "next";
import Link from "next/link";
import { Fingerprint } from "lucide-react";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui";
import { Field, SubmitButton, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/admin/action-form";
import { NotificationsTabs } from "@/components/admin/section-tabs";
import { cn, fmtDate, fmtDateTime } from "@/lib/utils";
import { roleName } from "@/server/authz/catalog";
import { DSR_LABEL, DSR_STATUS_LABEL } from "@/server/modules/account/constants";
import { requireAdmin } from "@/server/modules/admin/guard";
import { processDsr } from "@/server/modules/admin/notifications/actions";
import { dsrQueue } from "@/server/modules/admin/notifications/queries";

export const metadata: Metadata = { title: "طلبات البيانات الشخصية" };

const FILTERS = [{ key: "open", label: "المفتوحة" }, { key: "completed", label: "المكتملة" }, { key: "rejected", label: "المرفوضة" }, { key: "all", label: "الكل" }];
const GUIDE: Record<string, string> = {
  access: "يستطيع صاحب الطلب تنزيل نسخة بياناته من صفحة «خصوصيتي». تحقق من اكتمالها وأرفق ما لا تشمله النسخة الآلية، ثم أغلق الطلب.",
  export: "كما في طلب الاطلاع: نسخة آلية من صفحة «خصوصيتي» مع ما يلزم يدويًا.",
  correct: "صحّح البيان في مصدره بعد التحقق من المستند المؤيد، واذكر ما صُحح في ملاحظة الإغلاق.",
  delete: "يُخفي التنفيذ هوية الحساب وينهي عضوياته وجلساته بعد مهلة التراجع، ويحتفظ بسجلات الأوقاف النظامية. لا يُنفذ لمن يحمل دور نظارة قائمًا.",
  object: "قيّم الاعتراض: أوقف المعالجة محل الاعتراض أو بيّن السند النظامي لاستمرارها.",
};

export default async function PrivacyQueuePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const auth = await requireAdmin("admin.notifications");
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.status) ? sp.status! : "open";
  const rows = await dsrQueue(auth, filter);
  const now = Date.now();
  const overdue = rows.filter((r) => ["received", "in_progress"].includes(r.status) && r.dueAt && r.dueAt.getTime() < now).length;
  return (
    <div>
      <PageHeader title="الإشعارات والرسائل" description="حقوق أصحاب البيانات وفق نظام حماية البيانات الشخصية: الاطلاع والتصحيح والحذف والاعتراض، ولكل طلب مهلة نظامية." />
      <NotificationsTabs openDsr={filter === "open" ? rows.length : undefined} />
      {overdue ? <Alert tone="critical" title={`${overdue} طلب تجاوز المهلة`} className="mb-4">عالج المتأخر أولًا، واذكر سبب التأخير في ملاحظة الإغلاق.</Alert> : null}
      <nav aria-label="تصفية الطلبات" className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/notifications/privacy?status=${f.key}`} aria-current={f.key === filter ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 text-[15px]", f.key === filter ? "bg-ink text-white dark:text-[#0f141c]" : "border border-line-strong bg-surface hover:bg-surface-2")}>
            {f.label}
          </Link>
        ))}
      </nav>
      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((r) => {
            const open = ["received", "in_progress"].includes(r.status);
            const daysLeft = r.dueAt ? Math.ceil((r.dueAt.getTime() - now) / 86_400_000) : null;
            return (
              <li key={r.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{DSR_LABEL[r.kind] ?? r.kind}</p>
                    <p className="text-[13px] text-muted">
                      <Link href={`/admin/clients/${r.userId}`} className="text-ink hover:underline">{r.name ?? "—"}</Link> · استُلم {fmtDateTime(r.requestedAt)}
                    </p>
                  </div>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={r.status === "completed" ? "ok" : r.status === "rejected" ? "neutral" : "info"} icon={false}>{DSR_STATUS_LABEL[r.status] ?? r.status}</Badge>
                    {open && daysLeft !== null ? (
                      <Badge tone={daysLeft < 0 ? "critical" : daysLeft <= 7 ? "fine" : "neutral"}>{daysLeft < 0 ? `متأخر ${-daysLeft} يوم` : `المهلة ${fmtDate(r.dueAt)} (${daysLeft} يوم)`}</Badge>
                    ) : null}
                  </span>
                </div>
                {r.details ? <p className="mt-2 whitespace-pre-line text-[15px]">{r.details}</p> : null}
                {r.retainedDataNote ? <p className="mt-2 rounded-md bg-surface-2 p-2 text-[14px]"><span className="text-muted">ملاحظة الإغلاق: </span>{r.retainedDataNote}</p> : null}
                {open ? (
                  <div className="mt-3 space-y-3 border-t border-line pt-3">
                    <p className="text-[13px] text-muted">{GUIDE[r.kind]}</p>
                    {r.kind === "delete" && r.activeRoles.length ? (
                      <Alert tone="warn">يحمل أدوارًا قائمة في أوقاف: {[...new Set(r.activeRoles)].map(roleName).join("، ")}.</Alert>
                    ) : null}
                    {r.status === "received" ? (
                      <ActionForm action={processDsr} hidden={{ id: r.id, op: "start" }} className="space-y-1">
                        <SubmitButton variant="secondary" size="sm">ابدأ المعالجة</SubmitButton>
                      </ActionForm>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2">
                      <ActionForm action={processDsr} hidden={{ id: r.id, op: "complete" }} className="space-y-2">
                        <Field label={r.kind === "delete" ? "ما نُفذ وما احتُفظ به ولماذا" : "ما نُفذ"} name={`note-c-${r.id}`}>
                          <Textarea name="note" id={`note-c-${r.id}`} className="min-h-16" />
                        </Field>
                        <SubmitButton size="sm" variant={r.kind === "delete" ? "danger" : "primary"}>{r.kind === "delete" ? "نفّذ الحذف وأغلق" : "أغلق مكتملًا"}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={processDsr} hidden={{ id: r.id, op: "reject" }} className="space-y-2">
                        <Field label="سبب الرفض وسنده" name={`note-r-${r.id}`}>
                          <Textarea name="note" id={`note-r-${r.id}`} className="min-h-16" />
                        </Field>
                        <SubmitButton size="sm" variant="secondary">ارفض</SubmitButton>
                      </ActionForm>
                    </div>
                  </div>
                ) : r.completedAt ? <p className="mt-2 text-[13px] text-muted">أُغلق {fmtDateTime(r.completedAt)}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={Fingerprint} title="لا طلبات هنا">تصل الطلبات من صفحة «خصوصيتي» في حساب المستخدم.</EmptyState>
      )}
    </div>
  );
}
