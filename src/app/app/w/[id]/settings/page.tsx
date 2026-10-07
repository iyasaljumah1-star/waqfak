import { Mail, ScrollText, Users } from "lucide-react";
import { Badge, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { fmtBoth, fmtDate, SIZE_LABEL } from "@/lib/utils";
import { maskPhone } from "@/server/auth/otp";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { PERMISSIONS, roleName } from "@/server/authz/catalog";
import { AGENT_CEILING, INVITABLE_ROLES, PROTECTED_ROLES } from "@/server/modules/waqf-core/constants";
import { waqfAccess, waqfSettingsData } from "@/server/modules/waqf-core/queries";
import { ActionLink } from "@/components/portal/action-link";
import { DelegationForm, EndMembershipForm, InviteForm, MemberRoleForm, RevokeDelegationForm, RevokeInvitationForm } from "./forms";

export const metadata = { title: "الأعضاء والإعدادات" };

const MEMBER_STATUS: Record<string, string> = { active: "نشط", invited: "مدعو", suspended: "موقوف", ended: "منتهٍ" };

export default async function WaqfSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/settings` });
  const access = await waqfAccess(auth, id, "waqf.members.manage");
  const w = access.waqf;
  const { members, invites, delegs } = await waqfSettingsData(auth, id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const now = new Date();
  const roleOpts = INVITABLE_ROLES.map((r) => ({ value: r, label: roleName(r) }));
  const permOpts = AGENT_CEILING.map((p) => ({ value: p, label: PERMISSIONS[p as keyof typeof PERMISSIONS]?.[0] ?? p }));
  const activeMembers = members.filter((m) => m.status === "active" && (!m.endsAt || m.endsAt > now));
  const activeCount = (role: string) => activeMembers.filter((m) => m.roleKey === role).length;
  const pending = invites.filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > now);
  const pastInvites = invites.filter((i) => !pending.includes(i)).slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader title="الأعضاء والإعدادات" description="من يصل إلى ملف هذا الوقف وبأي دور، والوكالات السارية، وبيانات الوقف التي تُحسب منها التزاماته. كل تغيير يُسجَّل في سجل العمليات." />

      <Panel id="members" title="الأعضاء" description="الدور يحدد ما يراه العضو وما يستطيع فعله." tight>
        <div className="px-2 md:px-3">
          <DataTable
            caption="أعضاء الوقف"
            rows={members}
            rowKey={(m) => m.id}
            empty={<div className="p-4"><EmptyState icon={Users} title="لا أعضاء بعد" /></div>}
            columns={[
              {
                key: "name",
                label: "العضو",
                render: (m) => (
                  <div>
                    <p className="font-medium">{m.name ?? "—"}{m.userId === auth.user.id ? <span className="text-muted"> (أنت)</span> : null}</p>
                    <p dir="ltr" className="tabular text-end text-[13px] text-muted md:text-start">{maskPhone(m.phone)}</p>
                  </div>
                ),
              },
              {
                key: "role",
                label: "الدور",
                render: (m) =>
                  m.status === "active" && m.roleKey !== "agent" ? (
                    <MemberRoleForm waqfId={id} membershipId={m.id} roleKey={m.roleKey} isIndependent={m.isIndependent} roles={roleOpts} />
                  ) : (
                    <span>{roleName(m.roleKey)}{m.isIndependent ? " · مستقل" : ""}</span>
                  ),
              },
              {
                key: "status",
                label: "الحالة",
                render: (m) => (
                  <div>
                    <Badge tone={m.status === "active" ? "ok" : "neutral"} icon={false}>{MEMBER_STATUS[m.status] ?? m.status}</Badge>
                    <p className="mt-1 text-[13px] text-muted">
                      منذ {fmtDate(m.startsAt)}
                      {m.endsAt ? <> · {m.endsAt > now ? "ينتهي" : "انتهى"} {fmtDate(m.endsAt)}</> : null}
                    </p>
                  </div>
                ),
              },
              {
                key: "actions",
                label: "إجراء",
                render: (m) => {
                  if (m.status !== "active") return <span className="text-[13px] text-muted">—</span>;
                  if (m.roleKey === "agent") return <span className="text-[13px] text-muted">يُدار من الوكالات</span>;
                  if (PROTECTED_ROLES.includes(m.roleKey) && activeCount(m.roleKey) <= 1)
                    return <span className="text-[13px] text-muted">آخر {roleName(m.roleKey)} نشط، فلا يُنهى قبل تعيين من يخلفه.</span>;
                  return <EndMembershipForm waqfId={id} membershipId={m.id} name={m.name ?? "العضو"} />;
                },
              },
            ]}
          />
        </div>
      </Panel>

      <Panel id="invite" title="دعوة عضو" description="نرسل رابطًا إلى الجوال صالحًا 7 أيام. يقبله صاحبه بعد الدخول بالرقم نفسه.">
        <InviteForm waqfId={id} roles={roleOpts} />
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="mb-2 text-[15px] font-semibold">دعوات بانتظار القبول</h3>
          {pending.length ? (
            <ul className="divide-y divide-line">
              {pending.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <span dir="ltr" className="tabular">{maskPhone(i.phone)}</span>
                  <span>{roleName(i.roleKey)}</span>
                  <span className="text-[13px] text-muted">تنتهي {fmtDate(i.expiresAt)} · من {i.inviter ?? "—"}</span>
                  <span className="ms-auto"><RevokeInvitationForm waqfId={id} invitationId={i.id} /></span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Mail} title="لا دعوات معلقة" />
          )}
          {pastInvites.length ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted">دعوات سابقة ({pastInvites.length})</summary>
              <ul className="mt-2 space-y-1 text-muted">
                {pastInvites.map((i) => (
                  <li key={i.id}>
                    <span dir="ltr" className="tabular">{maskPhone(i.phone)}</span> · {roleName(i.roleKey)} ·{" "}
                    {i.acceptedAt ? `قُبلت ${fmtDate(i.acceptedAt)}` : i.scope && "declinedAt" in i.scope ? "اعتذر المدعو" : i.revokedAt ? "أُلغيت" : "انتهت صلاحيتها"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </Panel>

      <Panel id="delegations" title="الوكالات" description="وكيل يعمل نيابة عن الناظر بوكالة شرعية محددة النطاق والمدة. تنتهي صلاحيته تلقائيًا بانتهاء مدتها.">
        {delegs.length ? (
          <ul className="mb-6 divide-y divide-line rounded-md border border-line">
            {delegs.map((d) => {
              const expired = d.status === "active" && d.validTo < today;
              const notYet = d.status === "active" && d.validFrom > today;
              const label = expired ? "منتهية" : d.status === "revoked" ? "ملغاة" : d.status === "active" ? (notYet ? "لم تبدأ" : "سارية") : d.status === "pending_review" ? "بانتظار التحقق" : d.status;
              return (
                <li key={d.id} className="space-y-1 p-3 md:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.agentName ?? "—"}</span>
                    <Badge tone={label === "سارية" ? "ok" : label === "منتهية" ? "warn" : "neutral"} icon={false}>{label}</Badge>
                    <span className="text-[13px] text-muted">وكالة رقم <span dir="ltr" className="tabular">{d.poaNo ?? "—"}</span></span>
                    {d.status === "active" && !expired ? <span className="ms-auto"><RevokeDelegationForm waqfId={id} delegationId={d.id} /></span> : null}
                  </div>
                  <p className="text-[13px] text-muted">من {fmtBoth(d.validFrom)} إلى {fmtBoth(d.validTo)}</p>
                  <p className="text-[13px]">النطاق: {d.scope.map((p) => PERMISSIONS[p as keyof typeof PERMISSIONS]?.[0] ?? p).join("، ")}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mb-6"><EmptyState icon={ScrollText} title="لا وكالات مسجّلة">سجّل وكالة لمن يتابع شؤون الوقف نيابة عنك، كالمحامي أو المعقّب.</EmptyState></div>
        )}
        <h3 className="mb-3 text-[15px] font-semibold">تسجيل وكالة جديدة</h3>
        <DelegationForm waqfId={id} perms={permOpts} today={today} />
      </Panel>

      {waqfCan(access, "waqf.edit") ? (
        <Panel id="profile" title="ملف الوقف" description="الاسم والصك والتواريخ والتصنيف والأوضاع التي تُحسب منها الالتزامات النظامية.">
          <p className="mb-3 text-[15px]">
            فئة الحجم الحالية: <span className="font-medium">{w.sizeClass ? SIZE_LABEL[w.sizeClass] : "غير محددة"}</span> · نهاية السنة المالية{" "}
            <span dir="ltr" className="tabular">{w.fiscalYearEnd}</span>
          </p>
          <ActionLink href={`/app/w/${id}?edit=1#profile`} variant="secondary" size="sm">عدّل ملف الوقف</ActionLink>
        </Panel>
      ) : null}
    </div>
  );
}
