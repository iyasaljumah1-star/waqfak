import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, Gavel, ScrollText, Users } from "lucide-react";
import { Alert, Badge, DataTable, EmptyState, PageHeader, Panel, Stat, type Tone } from "@/components/ui";
import { ActionButton, MeetingForm, PolicyForm, ResolutionTaskForm, ReviewForm } from "@/components/governance/forms";
import { cn, daysUntil, fmtBoth, fmtDate, fmtDateTime, fmtNumber, relDays } from "@/lib/utils";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { markResolutionExecuted, policyReviewTask } from "@/server/modules/governance/actions";
import { governanceHome } from "@/server/modules/governance/queries";
import {
  MEETING_KIND_AR, MEETING_STATUS_AR, MINUTES_STATUS_AR, POLICY_STATUS_AR, POLICY_TYPE_AR, POLICY_TYPES, RESOLUTION_CATEGORY_AR, RESOLUTION_STATUS_AR, ROLE_AR,
} from "@/server/modules/governance/pure";
import { assignableMembers } from "@/server/modules/tasks/queries";

export const metadata: Metadata = { title: "الحوكمة والاجتماعات" };

const RES_TONE: Record<string, Tone> = { draft: "info", approved: "ok", rejected: "critical", deferred: "warn", executed: "ink", reviewed: "neutral" };
const QUORUM_AR: Record<string, string> = { majority: "الأغلبية (أكثر من النصف)", two_thirds: "الثلثان", all: "جميع الأعضاء" };
const MAJORITY_AR: Record<string, string> = { simple: "أغلبية بسيطة للحاضرين", absolute: "أغلبية مطلقة", two_thirds: "أغلبية الثلثين" };

export default async function GovernancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/governance` });
  const access = await requireWaqf(auth, id, "governance.view");
  const manage = waqfCan(access, "governance.manage");
  const { data, members } = await read(auth, async (tx) => ({ data: await governanceHome(tx, id), members: manage ? await assignableMembers(tx, id) : [] }));
  const base = `/app/w/${id}/governance`;
  const upcoming = data.meetings.filter((m) => m.status === "scheduled" && !m.heldAt);
  const memberOpts = members.map((m) => ({ value: m.id, label: `${m.name} — ${m.roles.join("، ")}` }));
  const resOpts = data.resolutions.filter((r) => r.status === "approved" || r.status === "executed").map((r) => ({ value: r.id, label: `${r.number} — ${r.text.slice(0, 60)}` }));
  const policyByType = new Map<string, (typeof data.policies)[number][]>();
  for (const p of data.policies) policyByType.set(p.policyType, [...(policyByType.get(p.policyType) ?? []), p]);
  const covered = POLICY_TYPES.filter(([k]) => (policyByType.get(k) ?? []).some((p) => p.status === "approved")).length;
  const reviewSoon = data.policies.filter((p) => p.status === "approved" && p.reviewDue && (daysUntil(p.reviewDue) ?? 99) <= 30);
  const ind = data.independence;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الحوكمة والاجتماعات"
        description="اجتماعات المجلس وقراراته وسياسات الوقف وتقييم الأداء، مع الإفصاح عن تعارض المصالح وتوقيع المحاضر."
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { label: "الحوكمة" }]}
        actions={manage ? <a href="#new-meeting" className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-4 text-[15px] font-medium text-white hover:bg-ink-hover"><CalendarPlus aria-hidden className="size-4" />اجتماع جديد</a> : null}
      />

      <nav aria-label="أقسام الحوكمة" className="-mx-1 flex gap-1 overflow-x-auto pb-1 text-[14px]">
        {[["#meetings", "الاجتماعات"], ["#resolutions", "سجل القرارات"], ["#policies", "السياسات واللوائح"], ["#board", "تشكيل المجلس"], ["#reviews", "تقييم الأداء"]].map(([h, l]) => (
          <a key={h} href={h} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 hover:border-ink hover:text-ink">{l}</a>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="اجتماعات منعقدة هذا العام" value={fmtNumber(data.heldThisYear)} sub={`المستهدف ${data.profile.meetingsPerYear} سنويًا`} tone={data.heldThisYear >= data.profile.meetingsPerYear ? "ok" : undefined} />
        <Stat label="قرارات معتمدة" value={fmtNumber(data.resolutions.filter((r) => r.status === "approved" || r.status === "executed").length)} sub={`${data.resolutions.filter((r) => r.status === "approved" && r.tasksOpen > 0).length} قيد التنفيذ`} />
        <Stat label="المتطلبات التنظيمية المعتمدة" value={`${covered} من ${POLICY_TYPES.length}`} tone={covered === POLICY_TYPES.length ? "ok" : covered < 6 ? "fine" : undefined} />
        <Stat label="الأعضاء المستقلون" value={`${ind.independent} من ${ind.voting}`} sub={`المستهدف ${Math.round(ind.target * 100)}%`} tone={ind.meetsTarget ? "ok" : "fine"} />
      </div>

      {upcoming.length ? (
        <Alert tone="info" title={`الاجتماع القادم: ${upcoming.at(-1)!.title}`}>
          {fmtDateTime(upcoming.at(-1)!.scheduledAt)} — <Link className="font-medium text-ink underline" href={`${base}/meetings/${upcoming.at(-1)!.id}`}>افتح الاجتماع</Link>
        </Alert>
      ) : null}

      <Panel id="meetings" title={`الاجتماعات (${data.meetings.length})`} tight>
        <DataTable
          rows={data.meetings}
          rowKey={(m) => m.id}
          empty={<div className="p-4"><EmptyState icon={Gavel} title="لا اجتماعات بعد">{manage ? "أنشئ أول اجتماع وأضف جدول أعماله، ثم أرسل الدعوات للأعضاء." : "لم يُجدول المجلس اجتماعات بعد."}</EmptyState></div>}
          columns={[
            { key: "n", label: "الرقم", render: (m) => <span dir="ltr" className="tabular text-[13px]">{m.number ?? "—"}</span>, className: "w-32" },
            { key: "t", label: "الاجتماع", render: (m) => <Link href={`${base}/meetings/${m.id}`} className="font-medium text-ink hover:underline">{m.title}</Link> },
            { key: "k", label: "النوع", render: (m) => MEETING_KIND_AR[m.kind] ?? m.kind, hideOnMobile: true },
            { key: "d", label: "الموعد", render: (m) => fmtDateTime(m.scheduledAt) },
            {
              key: "s", label: "الحالة", render: (m) => (
                <div className="flex flex-wrap gap-1">
                  <Badge tone={m.status === "held" ? "ok" : m.status === "cancelled" ? "neutral" : "info"} icon={false}>{MEETING_STATUS_AR[m.status]}</Badge>
                  {m.minutesStatus ? <Badge tone={m.minutesStatus === "locked" ? "ink" : "warn"} icon={false}>المحضر: {MINUTES_STATUS_AR[m.minutesStatus]}</Badge> : null}
                </div>
              ),
            },
          ]}
        />
      </Panel>

      <Panel id="resolutions" title="سجل القرارات" description="كل قرار برقمه ونتيجة التصويت عليه، ومهام تنفيذه." tight>
        {data.resolutions.length ? (
          <ul className="divide-y divide-line">
            {data.resolutions.map((r) => (
              <li key={r.id} className="px-4 py-4 md:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-muted">
                      <span dir="ltr" className="tabular font-medium text-text">{r.number}</span>
                      {r.meetingNumber ? <> · <Link className="hover:underline" href={`${base}/meetings/${r.meetingId}`} dir="ltr">{r.meetingNumber}</Link></> : null}
                      {" · "}{RESOLUTION_CATEGORY_AR[r.category] ?? r.category}
                      {r.decidedAt ? <> · {fmtDate(r.decidedAt)}</> : null}
                    </p>
                    <p className="mt-1">{r.text}</p>
                    {r.status !== "draft" ? (
                      <p className="mt-1 text-[13px] text-muted">موافق {r.votesFor} · معارض {r.votesAgainst} · ممتنع {r.votesAbstain} · مستبعد {r.votesRecused}{r.reviewNote ? ` — ${r.reviewNote}` : ""}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={RES_TONE[r.status] ?? "neutral"} icon={false}>{RESOLUTION_STATUS_AR[r.status] ?? r.status}</Badge>
                    {r.tasksTotal ? <Badge tone={r.tasksOpen ? "warn" : "ok"} icon={false}>المهام {r.tasksTotal - r.tasksOpen}/{r.tasksTotal}</Badge> : null}
                    {r.requiresExternalApproval ? <Badge tone="seal" icon={false}>يحتاج موافقة خارجية</Badge> : null}
                  </div>
                </div>
                {manage && r.status === "approved" ? (
                  <div className="mt-2 flex flex-wrap items-start gap-4">
                    <ResolutionTaskForm waqfId={id} resolutionId={r.id} members={memberOpts} defaultTitle={`تنفيذ ${r.number}`} />
                    {r.tasksTotal && !r.tasksOpen ? <ActionButton action={markResolutionExecuted} fields={{ waqfId: id, resolutionId: r.id }} label="علّم القرار منفّذًا" variant="ghost" size="sm" /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4"><EmptyState icon={ScrollText} title="لا قرارات مسجلة">تظهر هنا القرارات بعد التصويت عليها في الاجتماعات.</EmptyState></div>
        )}
      </Panel>

      <Panel id="policies" title="السياسات واللوائح" description="المتطلبات التنظيمية المساندة الاثنا عشر (الدليل المختصر لمهمات ومسؤوليات ناظر الوقف)، بتاريخ اعتمادها وموعد مراجعتها." tight>
        {reviewSoon.length ? (
          <div className="px-4 pt-4 md:px-5">
            <Alert tone={reviewSoon.some((p) => (daysUntil(p.reviewDue) ?? 0) < 0) ? "critical" : "warn"} title="سياسات حان موعد مراجعتها">
              {reviewSoon.map((p) => `${p.title} (${relDays(p.reviewDue)})`).join("، ")}
            </Alert>
          </div>
        ) : null}
        <ul className="divide-y divide-line">
          {POLICY_TYPES.map(([key, label]) => {
            const list = policyByType.get(key) ?? [];
            const current = list.find((p) => p.status === "approved") ?? list[0];
            const left = current?.reviewDue ? daysUntil(current.reviewDue) : null;
            return (
              <li key={key} className="px-4 py-3 md:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{label}</p>
                    {current ? (
                      <p className="text-[13px] text-muted">
                        {current.title} · الإصدار {current.version}
                        {current.approvedOn ? <> · اعتُمدت {fmtBoth(current.approvedOn)}</> : null}
                        {current.reviewDue ? <span className={cn(left !== null && left < 0 && "font-semibold text-critical")}> · المراجعة {fmtDate(current.reviewDue)} ({relDays(current.reviewDue)})</span> : null}
                      </p>
                    ) : <p className="text-[13px] text-muted">غير موجودة في السجل</p>}
                  </div>
                  <Badge tone={!current ? "fine" : current.status === "approved" ? (left !== null && left < 0 ? "critical" : "ok") : "warn"} icon={false}>
                    {!current ? "ناقصة" : left !== null && left < 0 && current.status === "approved" ? "فات موعد مراجعتها" : POLICY_STATUS_AR[current.status]}
                  </Badge>
                </div>
                {manage ? (
                  <div className="mt-2 flex flex-wrap items-start gap-4 text-[14px]">
                    <details>
                      <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">{current ? "حدّث" : "أضف"}</summary>
                      <div className="mt-3 max-w-2xl">
                        <PolicyForm waqfId={id} types={[{ value: key, label }]} resolutions={resOpts} policy={current ? { id: current.id, policyType: current.policyType, title: current.title, status: current.status, approvedOn: current.approvedOn, reviewDue: current.reviewDue, approvedByResolutionId: current.approvedByResolutionId } : undefined} />
                      </div>
                    </details>
                    {current?.reviewDue && current.status === "approved" && (left ?? 99) <= 60 ? <ActionButton action={policyReviewTask} fields={{ waqfId: id, policyId: current.id }} label="أنشئ مهمة مراجعة" variant="ghost" size="sm" /> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {data.policies.some((p) => !POLICY_TYPE_AR[p.policyType]) ? <p className="px-5 pb-4 text-[13px] text-muted">توجد سياسات أخرى خارج المتطلبات الاثني عشر.</p> : null}
      </Panel>

      <Panel id="board" title="تشكيل المجلس واستقلاليته" description={`النصاب: ${QUORUM_AR[data.profile.quorumRule]}${data.profile.requireIndependent ? " مع حضور عضو مستقل على الأقل" : ""}. إصدار القرار: ${MAJORITY_AR[data.profile.majorityRule]}${data.profile.castingVote ? "، ويرجح صوت الرئيس عند التعادل" : ""}.`}>
        {data.seats.length ? (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.seats.map((s) => (
                <li key={s.membershipId} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-[13px] text-muted">{ROLE_AR[s.role] ?? s.role}{!s.hasVote ? " · بلا صوت" : ""}</p>
                  </div>
                  {s.isIndependent ? <Badge tone="ok" icon={false}>مستقل</Badge> : <Badge icon={false}>غير مستقل</Badge>}
                </li>
              ))}
            </ul>
            <p className={cn("mt-3 text-[14px]", ind.meetsTarget ? "text-ok" : "text-fine")}>
              نسبة المستقلين {Math.round(ind.ratio * 100)}% من الأعضاء المصوّتين. {ind.meetsTarget ? "تحقق المستهدف." : "دون المستهدف؛ مبادئ حوكمة الأوقاف توصي بأعضاء مستقلين بنسبة مؤثرة، خاصة في الأوقاف الكبيرة."}
            </p>
            {!data.hasBody ? <p className="mt-1 text-[13px] text-muted">يُنشأ سجل المجلس تلقائيًا من أطراف الوقف عند أول اجتماع.</p> : null}
          </>
        ) : (
          <EmptyState icon={Users} title="لا أعضاء مجلس">أضف أعضاء المجلس من «الأعضاء والإعدادات» بأدوار: رئيس المجلس، عضو، أمين السر.</EmptyState>
        )}
      </Panel>

      <Panel id="reviews" title="تقييم الأداء" description="تقييم سنوي لأداء الناظر والمجلس وأعضائه.">
        {data.reviews.length ? (
          <DataTable
            rows={data.reviews}
            rowKey={(r) => r.id}
            columns={[
              { key: "y", label: "السنة", render: (r) => <span className="tabular">{r.year}</span>, className: "w-20" },
              { key: "s", label: "المُقيَّم", render: (r) => <>{r.subjectName} <span className="text-[13px] text-muted">({r.subjectType === "board" ? "المجلس" : r.subjectType === "nazir" ? "الناظر" : "عضو"})</span></> },
              { key: "sc", label: "الدرجة", render: (r) => (r.score ? <span className="tabular">{fmtNumber(r.score)} / 100</span> : "—") },
              { key: "n", label: "الملاحظات", render: (r) => <span className="text-[14px]">{r.notes ?? "—"}</span>, hideOnMobile: true },
            ]}
          />
        ) : <p className="text-muted">لم يُسجَّل تقييم بعد.</p>}
        {manage ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-[14px] text-ink underline-offset-4 hover:underline">سجّل تقييمًا</summary>
            <div className="mt-3"><ReviewForm waqfId={id} /></div>
          </details>
        ) : null}
      </Panel>

      {manage ? (
        <Panel id="new-meeting" title="اجتماع جديد" description="يأخذ الاجتماع رقمًا تلقائيًا. بعد الإنشاء: راجع جدول الأعمال، ثم أرسل الدعوات.">
          <MeetingForm waqfId={id} />
        </Panel>
      ) : null}
    </div>
  );
}
