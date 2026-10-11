import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, DataTable, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { Select, SubmitButton } from "@/components/ui/form";
import { ActionForm } from "@/components/admin/action-form";
import { ReasonAction } from "@/components/admin/reason-action";
import { UsersTabs } from "@/components/admin/section-tabs";
import { actionLabel, USER_STATUS } from "@/components/admin/labels";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { roleName } from "@/server/authz/catalog";
import { canViewPii, requireAdmin, staffPhone } from "@/server/modules/admin/guard";
import { AccountEditForm } from "@/components/admin/account-edit-form";
import { recordPiiView } from "@/server/modules/admin/users/queries";
import { userDetail } from "@/server/modules/admin/users/queries";
import { forceSignOut, grantRole, lockUser, resetMfa, revokeRole, unlockUser } from "@/server/modules/admin/users/actions";
import { BG_STATUS_LABEL, bgStatus } from "@/server/modules/admin/breakglass/queries";

export const metadata: Metadata = { title: "مستخدم" };

const UUID = /^[0-9a-f-]{36}$/i;
const device = (ua: string | null) => {
  if (!ua) return "جهاز غير معروف";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "متصفح";
  return [br, os].filter(Boolean).join(" على ");
};

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invited?: string }> }) {
  const auth = await requireAdmin("admin.users", "admin.roles", "admin.clients.edit");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const d = await userDetail(auth, id);
  if (!d) notFound();
  const u = d.user;
  const self = u.id === auth.user.id;
  const canUsers = auth.perms.has("admin.users");
  const canRoles = auth.perms.has("admin.roles");
  const held = new Set(d.grants.map((g) => g.key));
  const grantable = d.allRoles.filter((r) => !held.has(r.key));
  const st = USER_STATUS[u.status] ?? { label: u.status, tone: "neutral" as const };
  const lockedNow = u.status === "locked" || (u.lockedUntil && u.lockedUntil > new Date());
  const pii = canViewPii(auth);
  if (pii && !self) await recordPiiView(auth, u.id);
  const canEdit = auth.perms.has("admin.clients.edit") && u.status !== "deleted" && (!d.grants.length || canRoles);

  return (
    <div>
      <PageHeader
        title={u.fullName || "مستخدم بلا اسم"}
        crumbs={[{ href: "/admin/users", label: "المستخدمون" }, { label: u.fullName || "مستخدم" }]}
        description={
          <span className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge tone={u.isStaff ? "ink" : "neutral"} icon={false}>{u.isStaff ? "فريق وقفك" : "عميل"}</Badge>
            <Badge tone={u.mfaEnabled ? "ok" : u.isStaff ? "warn" : "neutral"}>{u.mfaEnabled ? "التحقق بخطوتين مفعّل" : "بلا تحقق بخطوتين"}</Badge>
            {self ? <Badge tone="info" icon={false}>حسابك</Badge> : null}
          </span>
        }
      />
      <UsersTabs auth={auth} />
      {sp.invited ? (
        <Alert tone="ok" title="أُرسلت الدعوة" className="mb-6">
          أُرسلت رسالة نصية إلى الموظف. يدخل برقم جواله (رمز لمرة واحدة)، ثم تُلزمه المنصة بتسجيل تطبيق المصادقة قبل فتح لوحة الإدارة.
        </Alert>
      ) : null}
      {u.isStaff && !u.mfaEnabled ? (
        <Alert tone="warn" className="mb-6" title="لم يُكمل التهيئة">
          تُفتح لوحة الإدارة لهذا الحساب بعد تسجيل تطبيق المصادقة في دخوله التالي.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Panel title="البيانات">
            <DefinitionList
              items={[
                { label: "الجوال", value: <span dir="ltr" className="tabular">{staffPhone(auth, u.phone)}</span>, hint: u.phoneVerifiedAt ? undefined : "لم يُؤكَّد بعد: يُؤكَّد عند أول دخول برمز يصل إليه." },
                { label: "البريد", value: u.email ? <span dir="ltr">{pii ? u.email : u.email.replace(/^(.)[^@]*(@.*)$/, "$1•••$2")}</span> : "—" },
                { label: "الإقامة", value: u.residesInKsa === true ? "داخل المملكة" : u.residesInKsa === false ? "خارج المملكة" : "—" },
                { label: "تاريخ الإنشاء", value: fmtDate(u.createdAt) },
                { label: "آخر دخول", value: u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "لم يدخل بعد" },
                { label: "محاولات دخول فاشلة متتالية", value: <span className="tabular">{u.failedLoginCount}</span> },
                { label: "مقفل مؤقتًا حتى", value: u.lockedUntil && u.lockedUntil > new Date() ? fmtDateTime(u.lockedUntil) : "—" },
                { label: "عوامل التحقق المسجلة", value: d.mfa.factors.length ? `${d.mfa.factors.length} (آخر استخدام ${d.mfa.factors[0].lastUsedAt ? fmtDateTime(d.mfa.factors[0].lastUsedAt) : "—"})` : "لا يوجد" },
                { label: "رموز الاسترداد المتبقية", value: <span className="tabular">{d.mfa.recoveryLeft}</span> },
                ...(u.deletionRequestedAt ? [{ label: "طلب حذف الحساب", value: fmtDate(u.deletionRequestedAt) }] : []),
              ]}
            />
          </Panel>

          <Panel title={`الجلسات النشطة (${d.activeSessions.length})`} tight>
            <div className="px-3 md:px-2">
              <DataTable
                rows={d.activeSessions}
                rowKey={(s) => s.id}
                empty={<p className="p-4 text-muted">لا جلسات نشطة.</p>}
                columns={[
                  { key: "d", label: "الجهاز", render: (s) => device(s.userAgent) },
                  { key: "ip", label: "العنوان", render: (s) => <span dir="ltr" className="tabular text-[14px]">{s.ip ?? "—"}</span> },
                  { key: "c", label: "بدأت", render: (s) => fmtDateTime(s.createdAt), hideOnMobile: true },
                  { key: "l", label: "آخر نشاط", render: (s) => fmtDateTime(s.lastSeenAt) },
                  { key: "m", label: "التحقق", render: (s) => (s.mfaVerified ? <Badge tone="ok" icon={false}>مكتمل</Badge> : <Badge tone="warn" icon={false}>جزئي</Badge>) },
                ]}
              />
            </div>
          </Panel>

          <Panel title="سجل الدخول والأمان" description="من سجل العمليات: الدخول والتحقق وتغييرات الأمان التي قام بها صاحب الحساب." tight>
            <div className="px-3 md:px-2">
              <DataTable
                rows={d.history}
                rowKey={(h) => String(h.id)}
                empty={<p className="p-4 text-muted">لا أحداث بعد.</p>}
                columns={[
                  { key: "a", label: "الحدث", render: (h) => <Link href={`/admin/audit/${h.id}`} className="hover:underline">{actionLabel(h.action) ?? h.action}</Link> },
                  { key: "t", label: "الوقت", render: (h) => fmtDateTime(h.at) },
                  { key: "d", label: "الجهاز", render: (h) => device(h.userAgent), hideOnMobile: true },
                  { key: "ip", label: "العنوان", render: (h) => <span dir="ltr" className="tabular text-[14px]">{h.ip ?? "—"}</span>, hideOnMobile: true },
                ]}
              />
            </div>
          </Panel>

          {d.adminEvents.length ? (
            <Panel title="إجراءات إدارية على الحساب" tight>
              <ul className="divide-y divide-line">
                {d.adminEvents.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-[15px]">
                    <Link href={`/admin/audit/${e.id}`} className="hover:underline">{actionLabel(e.action) ?? e.action}</Link>
                    <span className="text-[13px] text-muted">{e.actorUserId ? d.names.get(e.actorUserId) ?? "—" : "النظام"} · {fmtDateTime(e.at)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {d.memberships.length ? (
            <Panel title="الأدوار في الأوقاف" description="تُدار من ملف كل وقف، لا من هنا.">
              <ul className="space-y-1.5">
                {d.memberships.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-[15px]">
                    {m.name ? <Link href={`/admin/waqfs/${m.waqfId}`} className="text-ink hover:underline">{m.name}</Link> : <span className="text-muted">وقف خارج صلاحياتك</span>}
                    <Badge icon={false} tone="neutral">{roleName(m.roleKey)}</Badge>
                    {m.status !== "active" ? <Badge tone="neutral">{m.status === "ended" ? "منتهية" : m.status}</Badge> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-6">
          {canEdit ? (
            <Panel title="تعديل بيانات الحساب" description="الاسم والجوال والبريد والإقامة. يُسجَّل كل تعديل في سجل العمليات.">
              <AccountEditForm
                userId={u.id}
                fullName={u.fullName ?? ""}
                email={pii ? u.email ?? "" : ""}
                hasEmail={!!u.email}
                phoneLocal={pii ? u.phone.replace(/^\+966/, "0") : ""}
                residesInKsa={u.residesInKsa}
                canSeePii={pii}
              />
            </Panel>
          ) : null}
          <Panel title="أدوار فريق وقفك" description="تحدد ما يراه الموظف في لوحة الإدارة. تسري من الطلب التالي.">
            {d.grants.length ? (
              <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
                {d.grants.map((g) => (
                  <li key={g.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block font-medium">{g.nameAr}</span>
                      <span className="block text-[13px] text-muted">مُنح {fmtDate(g.grantedAt)}{g.grantedBy ? ` بواسطة ${d.names.get(g.grantedBy) ?? "—"}` : ""}</span>
                    </span>
                    {canRoles && !(self && g.key === "super_admin") ? (
                      <ActionForm action={revokeRole} hidden={{ userId: u.id, roleKey: g.key }} className="space-y-1">
                        <SubmitButton variant="ghost" size="sm" pendingText="…" aria-label={`سحب دور ${g.nameAr}`}>سحب</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-muted">لا يحمل أدوارًا في فريق وقفك.</p>
            )}
            {canRoles && grantable.length && u.status !== "deleted" ? (
              <ActionForm action={grantRole} hidden={{ userId: u.id }}>
                <label htmlFor="roleKey" className="block text-[15px] font-medium">منح دور</label>
                <div className="flex gap-2">
                  <Select name="roleKey" options={grantable.map((r) => ({ value: r.key, label: r.nameAr }))} placeholder="اختر الدور" required />
                  <SubmitButton pendingText="…" className="shrink-0">منح</SubmitButton>
                </div>
                {!u.isStaff ? <p className="text-[13px] text-muted">منح دور يجعل الحساب حساب موظف، ويلزمه بتسجيل التحقق بخطوتين.</p> : null}
              </ActionForm>
            ) : null}
          </Panel>

          {canUsers && !self && u.status !== "deleted" ? (
            <Panel title="إجراءات الحساب" description="تتطلب سببًا مكتوبًا ويُبلّغ بها سجل العمليات.">
              <div className="space-y-2">
                {lockedNow ? (
                  <ReasonAction id="unlock" title="فتح الحساب" description="يعيد الحالة إلى نشط ويصفّر المحاولات الفاشلة." action={unlockUser} hidden={{ userId: u.id }} submit="افتح الحساب" variant="primary" />
                ) : (
                  <ReasonAction id="lock" title="قفل الحساب" description="يمنع الدخول وينهي كل الجلسات فورًا." action={lockUser} hidden={{ userId: u.id }} submit="اقفل الحساب" variant="danger" />
                )}
                <ReasonAction id="signout" title="إنهاء كل الجلسات" description={`${d.activeSessions.length} جلسة نشطة. يُطلب منه الدخول من جديد.`} action={forceSignOut} hidden={{ userId: u.id }} submit="أنهِ الجلسات" />
                {u.mfaEnabled || d.mfa.factors.length ? (
                  <ReasonAction id="mfa" title="إعادة ضبط التحقق بخطوتين" description="عند فقد الجهاز: يحذف تطبيق المصادقة ورموز الاسترداد وينهي الجلسات." action={resetMfa} hidden={{ userId: u.id }} submit="أعد الضبط" variant="danger" />
                ) : null}
              </div>
            </Panel>
          ) : null}

          {d.breakGlass.length ? (
            <Panel title="طلبات الوصول الطارئ">
              <ul className="space-y-2 text-[15px]">
                {d.breakGlass.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={bgStatus(b.status, b.expiresAt) === "approved" ? "critical" : "neutral"} icon={false}>{BG_STATUS_LABEL[bgStatus(b.status, b.expiresAt)]}</Badge>
                    <span className="text-muted">{fmtDateTime(b.createdAt)}</span>
                  </li>
                ))}
              </ul>
              <Link href="/admin/users/break-glass" className="mt-3 inline-block text-sm text-ink hover:underline">كل طلبات الوصول الطارئ</Link>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
