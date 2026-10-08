import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Alert, Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/admin/action-form";
import { UsersTabs } from "@/components/admin/section-tabs";
import { fmtDateTime } from "@/lib/utils";
import { requireStaff } from "@/server/authz/context";
import { approveBreakGlass, rejectBreakGlass, requestBreakGlass, revokeBreakGlass } from "@/server/modules/admin/breakglass/actions";
import { BG_STATUS_LABEL, bgStatus, listBreakGlass, myBreakGlass } from "@/server/modules/admin/breakglass/queries";

export const metadata: Metadata = { title: "الوصول الطارئ" };

const tone = (s: string) => (s === "approved" ? "critical" : s === "requested" ? "fine" : "neutral") as "critical" | "fine" | "neutral";

export default async function BreakGlassPage() {
  const auth = await requireStaff("admin.access");
  const approver = auth.perms.has("breakglass.approve");
  const [all, mine] = await Promise.all([approver ? listBreakGlass(auth) : Promise.resolve([]), myBreakGlass(auth)]);
  const pending = all.filter((g) => g.status === "requested");
  const active = all.filter((g) => bgStatus(g.status, g.expiresAt) === "approved");
  const past = all.filter((g) => g.status !== "requested" && bgStatus(g.status, g.expiresAt) !== "approved");

  return (
    <div>
      <PageHeader
        title="الوصول الطارئ"
        crumbs={[{ href: "/admin", label: "لوحة الشركة" }, { label: "الوصول الطارئ" }]}
        description="وصول استثنائي محدد المدة إلى ملف وقف غير مسند إليك، لظرف عاجل فقط. يعتمده مسؤول آخر، ويُسجل كل خطوة، ويُبلَّغ ناظر الوقف."
      />
      <UsersTabs auth={auth} pending={approver ? pending.length : undefined} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {approver ? (
            <>
              <Panel title={`بانتظار الاعتماد (${pending.length})`}>
                {pending.length ? (
                  <ul className="space-y-4">
                    {pending.map((g) => (
                      <li key={g.id} className="rounded-lg border border-line p-4">
                        <p className="font-medium">
                          {g.requester} يطلب الوصول إلى <Link href={`/admin/waqfs/${g.waqfId}`} className="text-ink hover:underline">{g.waqfName ?? "وقف"}</Link>{" "}
                          <span dir="ltr" className="tabular text-[13px] text-muted">{g.waqfNumber}</span>
                        </p>
                        <p className="mt-1 whitespace-pre-line text-[15px]">{g.reason}</p>
                        <p className="mt-1 text-[13px] text-muted">{fmtDateTime(g.createdAt)}</p>
                        {g.userId === auth.user.id ? (
                          <p className="mt-3 text-[13px] text-muted">طلبك؛ يعتمده مسؤول آخر.</p>
                        ) : (
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <ActionForm action={approveBreakGlass} hidden={{ id: g.id }} className="space-y-2">
                              <Field label="المدة" name={`hours-${g.id}`}>
                                <Select name="hours" id={`hours-${g.id}`} defaultValue="4" options={[{ value: "1", label: "ساعة واحدة" }, { value: "4", label: "4 ساعات" }, { value: "8", label: "8 ساعات" }, { value: "24", label: "24 ساعة" }]} />
                              </Field>
                              <SubmitButton variant="danger" size="sm">اعتمد الوصول</SubmitButton>
                            </ActionForm>
                            <ActionForm action={rejectBreakGlass} hidden={{ id: g.id }} className="space-y-2">
                              <Field label="سبب الرفض" name={`note-${g.id}`}>
                                <Input name="note" id={`note-${g.id}`} />
                              </Field>
                              <SubmitButton variant="secondary" size="sm">ارفض</SubmitButton>
                            </ActionForm>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={ShieldAlert} title="لا طلبات معلقة" />
                )}
              </Panel>

              <Panel title={`نشط الآن (${active.length})`}>
                {active.length ? (
                  <ul className="divide-y divide-line">
                    {active.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <span className="min-w-0">
                          <span className="block font-medium">{g.requester} ← {g.waqfName ?? g.waqfNumber}</span>
                          <span className="block text-[13px] text-muted">اعتمده {g.approver} · ينتهي {fmtDateTime(g.expiresAt)}</span>
                        </span>
                        <ActionForm action={revokeBreakGlass} hidden={{ id: g.id }} className="space-y-1">
                          <SubmitButton variant="danger" size="sm">أنهِ الآن</SubmitButton>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">لا وصول طارئ نشط.</p>
                )}
              </Panel>

              {past.length ? (
                <Panel title="السجل" tight>
                  <ul className="divide-y divide-line">
                    {past.slice(0, 30).map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[15px]">
                        <span>{g.requester} ← {g.waqfName ?? g.waqfNumber}</span>
                        <span className="flex items-center gap-2 text-[13px] text-muted">
                          <Badge tone="neutral" icon={false}>{BG_STATUS_LABEL[bgStatus(g.status, g.expiresAt)]}</Badge>
                          {fmtDateTime(g.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
            </>
          ) : null}

          {!auth.globalAccess ? (
            <Panel title="طلب وصول طارئ">
              <ActionForm action={requestBreakGlass} resetOnSuccess>
                <Field label="الرقم الداخلي للوقف" name="waqfNumber" hint="كما يظهر في المراسلات أو الطلبات، مثل WQF-000001." required>
                  <Input name="waqfNumber" dir="ltr" placeholder="WQF-000000" required />
                </Field>
                <Field label="سبب الحاجة العاجلة" name="reason" hint="ما الذي لا يحتمل انتظار الإسناد المعتاد؟ يطلع عليه المعتمد وناظر الوقف." required>
                  <Textarea name="reason" required minLength={20} />
                </Field>
                <SubmitButton variant="danger">أرسل الطلب</SubmitButton>
              </ActionForm>
            </Panel>
          ) : (
            <Alert tone="info" title="لا تحتاج وصولًا طارئًا">دورك يتيح الاطلاع على كل الأوقاف. هذه الصفحة لاعتماد طلبات زملائك ومراقبتها.</Alert>
          )}
        </div>

        <div className="space-y-6">
          {mine.length ? (
            <Panel title="طلباتي">
              <ul className="space-y-2">
                {mine.map((g) => {
                  const s = bgStatus(g.status, g.expiresAt);
                  return (
                    <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                      <span dir="ltr" className="tabular">{g.waqfNumber}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={tone(s)} icon={false}>{BG_STATUS_LABEL[s]}</Badge>
                        {s === "approved" ? <Link href={`/admin/waqfs/${g.waqfId}`} className="text-sm text-ink hover:underline">افتح الملف</Link> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
          <Panel title="ضوابط الوصول الطارئ">
            <ul className="list-inside list-disc space-y-1.5 text-[15px] text-muted">
              <li>لا يعتمد أحد طلبه بنفسه.</li>
              <li>المدة القصوى 24 ساعة، وتنتهي تلقائيًا، ويمكن إنهاؤها قبل ذلك.</li>
              <li>يُسجل الطلب والاعتماد والإنهاء في سجل العمليات وفي سجل الوقف نفسه.</li>
              <li>الوصول للاطلاع على ملخص الملف لأداء المهمة العاجلة، لا لتعديل البيانات.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
