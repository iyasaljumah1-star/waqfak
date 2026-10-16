import type { Metadata } from "next";
import { UserRound, Users } from "lucide-react";
import { Alert, Badge, DataTable, EmptyState, PageHeader, Panel } from "@/components/ui";
import { ActionButton, ActionForm, Disclosure } from "@/components/waqf/action-form";
import { Muted, SubHead } from "@/components/waqf/bits";
import { fmtBoth, fmtDate, fmtNumber, NAZIR_MODE_LABEL } from "@/lib/utils";
import { requireAuth, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { and, eq } from "drizzle-orm";
import { users, waqfMemberships } from "@/server/db/schema";
import { waqfAccess } from "@/server/modules/waqf-core/queries";
import {
  addBody, addBodyMember, addSuccession, appointTrustee, endBodyMember, endTrustee, removeSuccession, saveFounder, updateBodyMember,
} from "@/server/modules/waqf-file/actions";
import { todayIso } from "@/server/modules/waqf-file/form";
import { AUTHORITY_LABEL, BODY_KIND_LABEL, BODY_ROLE_LABEL, FOUNDER_POWERS, options, TRUSTEE_KIND_LABEL } from "@/server/modules/waqf-file/labels";
import { partiesData } from "@/server/modules/waqf-file/queries";

export const metadata: Metadata = { title: "الأطراف والنظارة" };

const APPOINT_AUTH = ["competent_authority", "gaa", "court", "notary", "internal"];

export default async function PartiesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/parties` });
  const access = await waqfAccess(auth, id, "waqf.view");
  const w = access.waqf;
  const canEdit = waqfCan(access, "waqf.edit");
  const canGov = waqfCan(access, "governance.manage");
  const { d, accounts } = await read(auth, async (tx) => ({
    d: await partiesData(tx, id),
    // the waqf's members with an account: a seat linked to one receives invitations, votes and signs in the platform
    accounts: canGov ? await tx.select({ id: users.id, name: users.fullName }).from(waqfMemberships).innerJoin(users, eq(users.id, waqfMemberships.userId)).where(and(eq(waqfMemberships.waqfId, id), eq(waqfMemberships.status, "active"))) : [],
  }));
  const accountOpts = [...new Map(accounts.map((a) => [a.id, { value: a.id, label: a.name ?? "عضو" }])).values()];
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const today = todayIso();
  const active = d.trustees.filter((t) => t.status === "active");
  const ended = d.trustees.filter((t) => t.status !== "active");
  const liveMembers = d.memberships.filter((m) => (m.status ?? "active") !== "ended" && (!m.endsOn || m.endsOn >= today));

  const founderFields = (f?: (typeof d.founders)[number]) => [
    { name: "displayName", label: "اسم الواقف", required: true, defaultValue: f?.displayName },
    { name: "nationality", label: "الجنسية", defaultValue: f?.nationality },
    { name: "isAlive", label: "على قيد الحياة", type: "checkbox" as const, defaultValue: f ? f.isAlive : true },
    ...FOUNDER_POWERS.map((p) => ({ name: p.key, label: `يحتفظ بصلاحية ${p.label}`, type: "checkbox" as const, defaultValue: !!(f?.powers as Record<string, boolean> | null)?.[p.key] })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="الأطراف والنظارة" description="الواقفون وصلاحياتهم، والنظّار وقرارات تعيينهم وخلافتهم، ومجالس الوقف ولجانه. تغيير النظارة تغيير جوهري يلزم تحديثه لدى الهيئة." />

      <Panel title="الواقف" description="من أنشأ الوقف، وما احتفظ به لنفسه من صلاحيات وفق شرطه.">
        {d.founders.length ? (
          <ul className="divide-y divide-line">
            {d.founders.map((f) => {
              const powers = FOUNDER_POWERS.filter((p) => (f.powers as Record<string, boolean> | null)?.[p.key]).map((p) => p.label);
              return (
                <li key={f.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <UserRound aria-hidden className="size-4 text-muted" />
                    <span className="font-medium">{f.displayName}</span>
                    <Badge tone={f.isAlive ? "ok" : "neutral"} icon={false}>{f.isAlive ? "على قيد الحياة" : "متوفى"}</Badge>
                    {f.nationality ? <span className="text-[13px] text-muted">{f.nationality}</span> : null}
                  </div>
                  <Muted>{powers.length ? `يحتفظ بصلاحية: ${powers.join("، ")}` : "لم يحتفظ بصلاحيات خاصة."}</Muted>
                  {canEdit ? (
                    <div className="mt-2">
                      <Disclosure summary="عدّل">
                        <ActionForm action={saveFounder} hidden={{ waqfId: id, founderId: f.id }} submitLabel="احفظ" fields={founderFields(f)} />
                      </Disclosure>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={UserRound} title="لم تُسجّل بيانات الواقف" />
        )}
        {canEdit ? (
          <div className="mt-3">
            <Disclosure summary="أضف واقفًا">
              <ActionForm action={saveFounder} hidden={{ waqfId: id }} submitLabel="أضف" fields={founderFields()} />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel id="trustees" title="النظارة" description={`صيغة النظارة في ملف الوقف: ${w.nazirMode ? NAZIR_MODE_LABEL[w.nazirMode] : "غير محددة"}.`}>
        {!active.length ? (
          <Alert tone="warn" title="لا ناظر نشط مسجل">سجّل الناظر الحالي وقرار تعيينه. إن شغرت النظارة فالجهة المختصة تقيم ناظرًا.</Alert>
        ) : null}
        <div className="mt-3 space-y-3">
          {active.map((t) => {
            const apps = d.appointments.filter((a) => a.trusteeId === t.id);
            const licLeft = t.licenseExpiresOn ? t.licenseExpiresOn < today : false;
            return (
              <article key={t.id} className="rounded-md border border-line p-4" data-testid="trustee">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t.displayName}</span>
                  <Badge tone="ink" icon={false}>{TRUSTEE_KIND_LABEL[t.kind] ?? t.kind}</Badge>
                  {t.isChair ? <Badge tone="seal" icon={false}>رئيس</Badge> : null}
                  {t.isIndependent ? <Badge tone="info" icon={false}>مستقل</Badge> : null}
                  {t.residesInKsa === false ? <Badge tone="warn">مقيم خارج المملكة</Badge> : null}
                  {licLeft ? <Badge tone="critical">انتهى ترخيصه</Badge> : null}
                </div>
                <Muted>
                  منذ {fmtBoth(t.startsOn)}
                  {t.licenseNo ? ` · ترخيص ${t.licenseNo}${t.licenseExpiresOn ? ` حتى ${fmtDate(t.licenseExpiresOn)}` : ""}` : ""}
                  {t.specialty ? ` · ${t.specialty}` : ""}
                </Muted>
                {apps.length ? (
                  <ul className="mt-2 space-y-1 text-[14px]">
                    {apps.map((a) => (
                      <li key={a.id} className="rounded bg-surface-2 px-3 py-2">
                        قرار التعيين {a.decisionNo ? <span dir="ltr" className="tabular">{a.decisionNo}</span> : "بلا رقم"} {a.decisionDate ? `في ${fmtDate(a.decisionDate)}` : ""} — {a.authority ? AUTHORITY_LABEL[a.authority] : ""}
                        {a.powers ? <span className="block text-muted">الصلاحيات: {a.powers}</span> : null}
                        {a.fees ? <span className="block text-muted">الأجرة: {a.fees}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {canEdit ? (
                  <div className="mt-3">
                    <Disclosure summary="إنهاء النظارة">
                      <ActionForm
                        action={endTrustee}
                        hidden={{ waqfId: id, trusteeId: t.id }}
                        submitLabel="سجّل الانتهاء"
                        footnote="يُنشئ التزام تسليم المستندات الأصلية للناظر الجديد فورًا (معايير المستفيد الحقيقي م7/4)، والتزام تحديث بيانات الوقف إن كان مسجلًا."
                        fields={[
                          { name: "endsOn", label: "تاريخ الانتهاء", type: "date", required: true, defaultValue: today },
                          { name: "reason", label: "السبب", required: true, placeholder: "وفاة، اعتذار، عزل، انتهاء المدة…" },
                        ]}
                      />
                    </Disclosure>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        {ended.length ? (
          <div className="mt-4">
            <SubHead>نظّار سابقون</SubHead>
            <ul className="space-y-1 text-[14px] text-muted">
              {ended.map((t) => <li key={t.id}>{t.displayName} — {TRUSTEE_KIND_LABEL[t.kind]} · من {fmtDate(t.startsOn)} إلى {fmtDate(t.endsOn)}</li>)}
            </ul>
          </div>
        ) : null}
        {canEdit ? (
          <div className="mt-4">
            <Disclosure summary="عيّن ناظرًا" testId="appoint-trustee">
              <ActionForm
                action={appointTrustee}
                hidden={{ waqfId: id }}
                submitLabel="سجّل التعيين"
                fields={[
                  { name: "kind", label: "الصفة", type: "select", options: options(TRUSTEE_KIND_LABEL), required: true, defaultValue: w.nazirMode === "board" ? "board_member" : "individual" },
                  { name: "displayName", label: "الاسم", required: true },
                  { name: "nationality", label: "الجنسية" },
                  { name: "startsOn", label: "تاريخ البدء", type: "date", required: true, defaultValue: today },
                  { name: "authority", label: "جهة التعيين", type: "select", options: APPOINT_AUTH.map((k) => ({ value: k, label: AUTHORITY_LABEL[k] })), required: true, defaultValue: "competent_authority" },
                  { name: "decisionNo", label: "رقم قرار/صك النظارة", ltr: true },
                  { name: "decisionDate", label: "تاريخ القرار", type: "date" },
                  { name: "specialty", label: "التخصص" },
                  { name: "licenseNo", label: "رقم الترخيص (للناظر الاعتباري)", ltr: true },
                  { name: "licenseExpiresOn", label: "انتهاء الترخيص", type: "date" },
                  { name: "powers", label: "الصلاحيات", type: "textarea", wide: true },
                  { name: "fees", label: "الأجرة", placeholder: "مثال: 5% من الغلة" },
                  { name: "responsibilities", label: "المسؤوليات", type: "textarea" },
                  { name: "isChair", label: "رئيس المجلس", type: "checkbox" },
                  { name: "isIndependent", label: "مستقل", type: "checkbox" },
                  { name: "residesInKsa", label: "مقيم في المملكة", type: "checkbox", defaultValue: true },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel title="خلافة النظارة" description="من يتولى النظارة بعد الناظر الحالي، بترتيب شرط الواقف.">
        {d.successions.length ? (
          <ol className="space-y-2">
            {d.successions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
                <div>
                  <span className="tabular me-2 font-semibold text-ink">{fmtNumber(s.position)}.</span>
                  {s.ruleText}
                  {s.successorName ? <span className="block text-[13px] text-muted">الخلف المسمّى: {s.successorName}</span> : null}
                </div>
                {canEdit ? <ActionButton action={removeSuccession} hidden={{ waqfId: id, successionId: s.id }} label="احذف" variant="ghost" confirm="حذف هذه القاعدة؟" /> : null}
              </li>
            ))}
          </ol>
        ) : (
          <Muted>لم تُسجّل قواعد الخلافة. إن سكت شرط الواقف عنها فالجهة المختصة تقيم الناظر عند الشغور.</Muted>
        )}
        {canEdit ? (
          <div className="mt-3">
            <Disclosure summary="أضف قاعدة">
              <ActionForm
                action={addSuccession}
                hidden={{ waqfId: id }}
                submitLabel="أضف"
                fields={[
                  { name: "ruleText", label: "القاعدة", required: true, wide: true, placeholder: "مثال: ثم للأرشد من أولاد الواقف" },
                  { name: "successorName", label: "اسم الخلف (إن سُمّي)" },
                  { name: "position", label: "الترتيب", type: "number", defaultValue: d.successions.length + 1 },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>

      <Panel id="bodies" title="المجالس واللجان" description="أجهزة الوقف وعضويتها واستقلال أعضائها.">
        {d.bodies.length ? (
          <div className="space-y-4">
            {d.bodies.map((b) => {
              const ms = liveMembers.filter((m) => m.bodyId === b.id);
              const indep = ms.filter((m) => m.isIndependent).length;
              const voting = ms.filter((m) => m.hasVote).length;
              const target = d.profile?.independentRatioTarget ? Number(d.profile.independentRatioTarget) : null;
              const ratio = ms.length ? indep / ms.length : 0;
              return (
                <article key={b.id} className="rounded-md border border-line">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <div>
                      <p className="font-semibold">{b.name} <span className="text-[13px] font-normal text-muted">· {BODY_KIND_LABEL[b.kind] ?? b.kind}</span></p>
                      <Muted>{fmtNumber(ms.length)} عضو · {fmtNumber(voting)} لهم حق التصويت · {fmtNumber(indep)} مستقل ({fmtNumber(Math.round(ratio * 100))}%)</Muted>
                    </div>
                    {target !== null && ms.length && ratio < target ? <Badge tone="warn">نسبة المستقلين أقل من المستهدف {fmtNumber(target * 100)}%</Badge> : null}
                  </div>
                  <div className="px-4 py-2">
                    <DataTable
                      rows={ms}
                      rowKey={(m) => m.id}
                      empty={<p className="py-3 text-center text-muted">لا أعضاء.</p>}
                      columns={[
                        { key: "name", label: "العضو", render: (m) => <div><p>{m.personName}</p>{m.capacity ? <p className="text-[13px] text-muted">{m.capacity}</p> : null}<p className="text-[12px] text-muted">{m.userId ? `حساب في المنصة${accountName.get(m.userId) ? `: ${accountName.get(m.userId)}` : ""}` : "بلا حساب في المنصة"}</p></div> },
                        { key: "role", label: "الدور", render: (m) => <div className="flex flex-wrap gap-1">{BODY_ROLE_LABEL[m.role] ?? m.role}{m.isExecutive ? <Badge icon={false}>تنفيذي</Badge> : null}{m.canSign ? <Badge tone="seal" icon={false}>مفوّض بالتوقيع</Badge> : null}{m.status === "suspended" ? <Badge tone="warn" icon={false}>موقوفة</Badge> : null}</div> },
                        { key: "ind", label: "الاستقلال", render: (m) => (m.isIndependent ? <Badge tone="info" icon={false}>مستقل</Badge> : "غير مستقل") },
                        { key: "vote", label: "التصويت", render: (m) => (m.hasVote ? "يصوّت" : "بلا صوت") },
                        { key: "term", label: "المدة", render: (m) => `${fmtDate(m.startsOn)} — ${m.endsOn ? fmtDate(m.endsOn) : "مفتوحة"}`, hideOnMobile: true },
                        ...(canGov ? [{ key: "contact", label: "التواصل", hideOnMobile: true, render: (m: (typeof ms)[number]) => <span className="text-[13px]" dir="ltr">{[m.contactEmail, m.contactPhone].filter(Boolean).join(" · ") || "—"}</span> }] : []),
                        ...(canGov ? [{ key: "end", label: "", render: (m: (typeof ms)[number]) => (
                          <div className="flex flex-col gap-1">
                            <Disclosure summary="عدّل" testId={`edit-member-${m.id}`}>
                              <ActionForm action={updateBodyMember} hidden={{ waqfId: id, membershipId: m.id }} submitLabel="احفظ"
                                fields={[
                                  { name: "personName", label: "الاسم", required: true, defaultValue: m.personName },
                                  { name: "role", label: "الدور", type: "select", options: options(BODY_ROLE_LABEL), required: true, defaultValue: m.role },
                                  { name: "capacity", label: "صفته", defaultValue: m.capacity },
                                  { name: "userId", label: "حسابه في المنصة", type: "select", options: accountOpts, defaultValue: m.userId ?? "" },
                                  { name: "contactEmail", label: "البريد", defaultValue: m.contactEmail, ltr: true },
                                  { name: "contactPhone", label: "الجوال", defaultValue: m.contactPhone, ltr: true },
                                  { name: "startsOn", label: "بداية العضوية", type: "date", defaultValue: m.startsOn },
                                  { name: "endsOn", label: "نهاية العضوية", type: "date", defaultValue: m.endsOn },
                                  { name: "appointmentRef", label: "قرار التعيين أو مستنده", defaultValue: m.appointmentRef },
                                  { name: "status", label: "حالة العضوية", type: "select", options: [{ value: "active", label: "سارية" }, { value: "suspended", label: "موقوفة" }], defaultValue: m.status ?? "active" },
                                  { name: "isIndependent", label: "عضو مستقل", type: "checkbox", defaultValue: m.isIndependent },
                                  { name: "hasVote", label: "له حق التصويت", type: "checkbox", defaultValue: m.hasVote },
                                  { name: "isExecutive", label: "عضو تنفيذي", type: "checkbox", defaultValue: m.isExecutive },
                                  { name: "canSign", label: "مفوّض بالتوقيع", type: "checkbox", defaultValue: m.canSign },
                                ]} />
                            </Disclosure>
                            <ActionButton action={endBodyMember} hidden={{ waqfId: id, membershipId: m.id }} label="أنهِ العضوية" variant="ghost" confirm={`إنهاء عضوية ${m.personName}؟`} />
                          </div>
                        ) }] : []),
                      ]}
                    />
                    {canGov ? (
                      <div className="my-3">
                        <Disclosure summary="أضف عضوًا">
                          <ActionForm
                            action={addBodyMember}
                            hidden={{ waqfId: id, bodyId: b.id }}
                            submitLabel="أضف"
                            fields={[
                              { name: "personName", label: "الاسم", required: true },
                              { name: "role", label: "الدور", type: "select", options: options(BODY_ROLE_LABEL), required: true, defaultValue: "member" },
                              { name: "capacity", label: "صفته", placeholder: "مثال: ممثل الواقف، خبير مالي" },
                              { name: "userId", label: "حسابه في المنصة (إن وُجد)", type: "select", options: accountOpts },
                              { name: "contactEmail", label: "البريد (للدعوات إن لم يكن له حساب)", ltr: true },
                              { name: "contactPhone", label: "الجوال", ltr: true },
                              { name: "startsOn", label: "بداية العضوية", type: "date", defaultValue: today },
                              { name: "endsOn", label: "نهاية العضوية", type: "date" },
                              { name: "appointmentRef", label: "قرار التعيين أو مستنده" },
                              { name: "isIndependent", label: "عضو مستقل", type: "checkbox" },
                              { name: "hasVote", label: "له حق التصويت", type: "checkbox", defaultValue: true },
                              { name: "isExecutive", label: "عضو تنفيذي", type: "checkbox" },
                              { name: "canSign", label: "مفوّض بالتوقيع", type: "checkbox" },
                            ]}
                          />
                        </Disclosure>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Users} title="لا مجالس ولا لجان">الأوقاف الكبيرة والمتوسطة تحتاج غالبًا مجلس نظارة ولجانًا منبثقة عنه.</EmptyState>
        )}
        {canGov ? (
          <div className="mt-3">
            <Disclosure summary="أضف مجلسًا أو لجنة">
              <ActionForm
                action={addBody}
                hidden={{ waqfId: id }}
                submitLabel="أضف"
                fields={[
                  { name: "kind", label: "النوع", type: "select", options: options(BODY_KIND_LABEL), required: true, defaultValue: "board" },
                  { name: "name", label: "الاسم", required: true, placeholder: "مثال: لجنة الاستثمار" },
                  { name: "charter", label: "الميثاق أو الاختصاص", type: "textarea", wide: true },
                ]}
              />
            </Disclosure>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
