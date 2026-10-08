import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Lock, MapPin, ShieldAlert } from "lucide-react";
import { Alert, Badge, PageHeader, Panel, Steps, type Tone } from "@/components/ui";
import {
  ActionButton, AgendaItemForm, AttendanceForm, CloseVoteForm, CoiForm, MinutesEditor, OpenVoteForm, ResolutionTaskForm, SignMinutesForm, VoteForm,
} from "@/components/governance/forms";
import { MinutesView } from "@/components/governance/minutes-view";
import { cn, fmtDate, fmtDateTime } from "@/lib/utils";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { isUuid } from "@/server/modules/waqf-core/queries";
import {
  cancelMeeting, circulateMinutes, confirmQuorum, draftMinutes, lockMinutes, removeAgendaItem, reopenMinutes, sendInvitations,
} from "@/server/modules/governance/actions";
import { meetingPage } from "@/server/modules/governance/queries";
import {
  AGENDA_KIND_AR, ATTENDANCE_AR, COI_KIND_AR, isPresent, MEETING_KIND_AR, MEETING_STATUS_AR, MINUTES_STATUS_AR, RESOLUTION_CATEGORIES,
  RESOLUTION_CATEGORY_AR, RESOLUTION_STATUS_AR, ROLE_AR, VOTE_AR, type VoteValue,
} from "@/server/modules/governance/pure";
import { assignableMembers } from "@/server/modules/tasks/queries";
import { TASK_STATUS_AR } from "@/server/modules/tasks/pure";

export const metadata: Metadata = { title: "اجتماع المجلس" };

const RES_TONE: Record<string, Tone> = { draft: "info", approved: "ok", rejected: "critical", executed: "ink" };

export default async function MeetingPage({ params }: { params: Promise<{ id: string; mid: string }> }) {
  const { id, mid } = await params;
  if (!isUuid(mid)) notFound();
  const auth = await requireAuth({ next: `/app/w/${id}/governance/meetings/${mid}` });
  const access = await requireWaqf(auth, id, "governance.view");
  const manage = waqfCan(access, "governance.manage");
  const canVote = waqfCan(access, "governance.vote");
  const canDeclare = waqfCan(access, "coi.declare");
  const me = auth.user.id;
  const { d, members } = await read(auth, async (tx) => ({ d: await meetingPage(tx, id, mid, me), members: manage ? await assignableMembers(tx, id) : [] }));
  if (!d) notFound();
  const m = d.meeting;
  const ids = { waqfId: id, meetingId: m.id };
  const mn = d.minutes;
  const locked = mn?.status === "locked";
  const cancelled = m.status === "cancelled";
  const present = d.seats.filter((s) => isPresent(s.status));
  const signedBy = new Set(d.signatures.filter((s) => s.contentHash === mn?.contentHash).map((s) => s.userId));
  const mySeatPresent = d.mySeat && isPresent(d.mySeat.status);
  const decisionItems = d.items.filter((i) => i.kind === "decision");
  const allClosed = decisionItems.every((i) => i.resolution && i.resolution.status !== "draft");
  const memberOpts = members.map((x) => ({ value: x.id, label: `${x.name} — ${x.roles.join("، ")}` }));
  const categories = RESOLUTION_CATEGORIES.map((c) => ({ value: c, label: RESOLUTION_CATEGORY_AR[c] }));

  const steps: { label: string; status: "done" | "active" | "pending" | "skipped" }[] = [
    { label: "جدول الأعمال والدعوات", status: d.invited ? "done" : "active" },
    { label: "الإفصاح عن التعارض وتسجيل الحضور", status: m.quorumMet ? "done" : d.invited ? "active" : "pending" },
    { label: "التحقق من النصاب", status: m.quorumMet ? "done" : d.invited ? "active" : "pending" },
    { label: "التصويت على البنود", status: m.quorumMet ? (allClosed && decisionItems.length ? "done" : "active") : "pending" },
    { label: "تحرير المحضر", status: mn ? (mn.status === "draft" ? "active" : "done") : m.quorumMet && allClosed ? "active" : "pending" },
    { label: "التوقيع والإقفال", status: locked ? "done" : mn?.status === "circulated" ? "active" : "pending" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={m.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span dir="ltr" className="tabular">{m.number}</span>
            <span>اجتماع {MEETING_KIND_AR[m.kind] ?? m.kind}</span>
            <span>{fmtDateTime(m.scheduledAt)}</span>
            {m.location ? <span className="inline-flex items-center gap-1"><MapPin aria-hidden className="size-4" />{m.location}</span> : null}
            {m.link ? <a href={m.link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-ink underline"><ExternalLink aria-hidden className="size-4" />رابط الاجتماع عن بُعد</a> : null}
          </span>
        }
        crumbs={[{ href: `/app/w/${id}`, label: access.waqf.name }, { href: `/app/w/${id}/governance`, label: "الحوكمة" }, { label: m.number ?? "اجتماع" }]}
        actions={
          <div className="flex flex-wrap gap-1">
            <Badge tone={m.status === "held" ? "ok" : cancelled ? "neutral" : "info"} icon={false}>{MEETING_STATUS_AR[m.status]}</Badge>
            {mn ? <Badge tone={locked ? "ink" : "warn"} icon={false}>{locked ? <><Lock aria-hidden className="size-3.5" /> المحضر مقفل</> : `المحضر: ${MINUTES_STATUS_AR[mn.status]}`}</Badge> : null}
          </div>
        }
      />

      {cancelled ? <Alert tone="neutral" title="أُلغي هذا الاجتماع" /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          {/* ───────── Agenda, conflicts and voting ───────── */}
          <Panel title="جدول الأعمال" description={m.quorumMet ? "الاجتماع منعقد. يُطرح كل بند «للقرار» للتصويت ويُستبعد منه من أفصح عن تعارض." : "أفصح عن أي تعارض مصالح لكل بند قبل الاجتماع."} tight>
            {d.items.length ? (
              <ol className="divide-y divide-line">
                {d.items.map((it) => {
                  const r = it.resolution;
                  const iConflicted = it.conflicted.includes(me);
                  const eligibleVoters = d.seats.filter((s) => s.hasVote && isPresent(s.status) && !(s.userId && it.conflicted.includes(s.userId))).length;
                  const canCast = !!r && r.status === "draft" && canVote && !!d.mySeat?.hasVote && !!mySeatPresent && !iConflicted && !it.myVote;
                  return (
                    <li key={it.id} className="space-y-3 px-4 py-4 md:px-5" data-testid={`agenda-${it.position}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 font-semibold"><span className="tabular text-muted">{it.position}.</span> {it.title}</h3>
                        <div className="flex flex-wrap gap-1">
                          <Badge icon={false}>{AGENDA_KIND_AR[it.kind] ?? it.kind}</Badge>
                          {r ? <Badge tone={RES_TONE[r.status] ?? "neutral"} icon={false}><span dir="ltr">{r.number}</span> · {RESOLUTION_STATUS_AR[r.status]}</Badge> : null}
                        </div>
                      </div>

                      {it.declarations.filter((x) => x.kind !== "none").length ? (
                        <p className="flex items-start gap-2 rounded-md bg-fine-soft px-3 py-2 text-[14px] text-fine">
                          <ShieldAlert aria-hidden className="mt-1 size-4 shrink-0" />
                          <span>
                            أفصح عن تعارض: {it.declarations.filter((x) => x.kind !== "none").map((x) => `${x.name} (${COI_KIND_AR[x.kind]})`).join("، ")} — مستبعد من التصويت على هذا البند وخارج نصابه.
                          </span>
                        </p>
                      ) : null}

                      {/* My declaration */}
                      {d.mySeat && canDeclare && !cancelled ? (
                        it.myDeclaration ? (
                          <p className="text-[13px] text-muted">إقرارك: {COI_KIND_AR[it.myDeclaration.kind]} — {fmtDateTime(it.myDeclaration.declaredAt)}</p>
                        ) : !r || r.status === "draft" ? (
                          <CoiForm {...ids} itemId={it.id} />
                        ) : null
                      ) : null}

                      {/* Voting */}
                      {r ? (
                        <div className="space-y-2 rounded-md border border-line p-3">
                          <p className="text-[15px]"><span className="text-muted">القرار المقترح:</span> {r.text}</p>
                          {r.status === "draft" ? (
                            <p className="text-[14px] text-muted">صوّت {it.votesCast} من {eligibleVoters} مؤهلين للتصويت على هذا البند.</p>
                          ) : (
                            <p className="text-[14px]">
                              موافق <b className="tabular">{r.votesFor}</b> · معارض <b className="tabular">{r.votesAgainst}</b> · ممتنع <b className="tabular">{r.votesAbstain}</b> · مستبعد <b className="tabular">{r.votesRecused}</b>
                              {r.reviewNote ? <span className="text-muted"> — {r.reviewNote}</span> : null}
                            </p>
                          )}
                          {it.myVote ? <p className="text-[14px] font-medium" data-testid="my-vote">صوتك: {VOTE_AR[it.myVote as VoteValue]}</p> : null}
                          {r.status === "draft" && iConflicted && d.mySeat?.hasVote ? (
                            <Alert tone="fine" title="أنت مستبعد من التصويت على هذا البند">أفصحت عن تعارض مصالح، فلا يحق لك التصويت عليه ولا تُحسب في نصابه.</Alert>
                          ) : null}
                          {canCast ? <VoteForm {...ids} resolutionId={r.id} needsDeclaration={!it.myDeclaration} /> : null}
                          {r.status === "draft" && manage ? <CloseVoteForm {...ids} resolutionId={r.id} /> : null}
                          {r.status !== "draft" && (manage || d.mySeat) ? (
                            <details className="text-[14px]">
                              <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">سجل الأصوات</summary>
                              <ul className="mt-2 space-y-1">
                                {it.votes.map((v) => <li key={v.userId}>{v.name}: {VOTE_AR[v.value as VoteValue]}{v.reason ? <span className="text-muted"> — {v.reason}</span> : null}</li>)}
                              </ul>
                            </details>
                          ) : null}
                          {it.tasks.length ? (
                            <ul className="space-y-1 border-t border-line pt-2 text-[14px]">
                              {it.tasks.map((t) => (
                                <li key={t.id} className="flex flex-wrap items-center gap-2">
                                  <Link href={`/app/w/${id}/tasks/${t.id}`} className="text-ink hover:underline">{t.title}</Link>
                                  <span className="text-muted">{t.assignee ?? "بلا مكلّف"}{t.dueOn ? ` · ${fmtDate(t.dueOn)}` : ""}</span>
                                  <Badge tone={t.status === "done" ? "ok" : "neutral"} icon={false}>{TASK_STATUS_AR[t.status]}</Badge>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {manage && (r.status === "approved" || r.status === "executed") ? <ResolutionTaskForm {...ids} resolutionId={r.id} members={memberOpts} defaultTitle={`تنفيذ القرار ${r.number}`} /> : null}
                        </div>
                      ) : it.kind === "decision" && manage && m.quorumMet && !cancelled && (!mn || mn.status === "draft") ? (
                        <OpenVoteForm {...ids} itemId={it.id} defaultText={it.title} categories={categories} />
                      ) : null}

                      {manage && !r && !it.declarations.length && !m.heldAt && !cancelled ? (
                        <ActionButton action={removeAgendaItem} fields={{ ...ids, itemId: it.id }} label="احذف البند" variant="ghost" size="sm" confirm="حذف هذا البند من جدول الأعمال؟" />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="p-5 text-muted">لا بنود بعد.</p>
            )}
            {manage && !cancelled && (!mn || mn.status === "draft") ? (
              <div className="border-t border-line p-4 md:p-5"><AgendaItemForm {...ids} /></div>
            ) : null}
          </Panel>

          {/* ───────── Minutes ───────── */}
          <Panel id="minutes" title="المحضر" description={mn ? `الإصدار ${mn.version} · ${MINUTES_STATUS_AR[mn.status]}` : "يُحرَّر بعد انعقاد الاجتماع وإغلاق التصويت، وتُدرج فيه القرارات تلقائيًا."}>
            {!mn ? (
              manage && m.heldAt ? (
                allClosed ? <ActionButton action={draftMinutes} fields={ids} label="أنشئ مسودة المحضر" pendingText="جارٍ الإنشاء…" /> : <p className="text-muted">أغلق التصويت على جميع البنود ثم أنشئ المحضر.</p>
              ) : <p className="text-muted">لم يُحرَّر المحضر بعد.</p>
            ) : mn.status === "draft" ? (
              manage ? (
                <div className="space-y-4">
                  <MinutesEditor {...ids} minuteId={mn.id} body={mn.body} />
                  <div className="border-t border-line pt-4">
                    <p className="mb-2 text-[14px] text-muted">بعد التعميم تُحفظ بصمة النص، ولا يُعدّل إلا بإعادته إلى مسودة وإلغاء التوقيعات.</p>
                    <ActionButton action={circulateMinutes} fields={{ ...ids, minuteId: mn.id }} label="عمّم المحضر للتوقيع" variant="seal" />
                  </div>
                </div>
              ) : <p className="text-muted">يحرر أمين السر المسودة الآن.</p>
            ) : (
              <div className="space-y-4">
                {locked ? (
                  <Alert tone="ok" title="المحضر مقفل">
                    أُقفل في {fmtDateTime(mn.lockedAt)} بعد توقيع جميع الحاضرين. لا يمكن تعديله؛ قاعدة البيانات ترفض أي تغيير عليه.
                  </Alert>
                ) : null}
                <MinutesView body={mn.body} />
                <p className="text-[12px] text-muted">بصمة النص (SHA-256): <span dir="ltr" className="break-all font-mono">{mn.contentHash}</span></p>
                <div>
                  <h3 className="mb-2 font-semibold">التوقيعات ({present.filter((s) => s.userId && signedBy.has(s.userId)).length} من {present.filter((s) => s.userId).length})</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {present.filter((s) => s.userId).map((s) => {
                      const sig = d.signatures.find((x) => x.userId === s.userId);
                      return (
                        <li key={s.membershipId} className={cn("rounded-md border px-3 py-2 text-[14px]", sig ? "border-ok/50 bg-ok-soft" : "border-line")}>
                          <p className="font-medium">{s.name}</p>
                          <p className="text-[13px] text-muted">{sig ? `وقّع ${fmtDateTime(sig.signedAt)}` : "بانتظار التوقيع"}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {mn.status === "circulated" && mySeatPresent && !signedBy.has(me) ? (
                  <div className="rounded-md border border-seal/50 p-4"><h3 className="mb-2 font-semibold">وقّع المحضر</h3><SignMinutesForm {...ids} minuteId={mn.id} /></div>
                ) : null}
                {mn.status === "circulated" && manage ? (
                  <div className="flex flex-wrap items-start gap-3 border-t border-line pt-4">
                    <ActionButton action={lockMinutes} fields={{ ...ids, minuteId: mn.id }} label="أقفل المحضر" variant="primary" confirm="بعد الإقفال لا يمكن تعديل المحضر نهائيًا. متابعة؟" />
                    <ActionButton action={reopenMinutes} fields={{ ...ids, minuteId: mn.id }} label="أعده إلى مسودة" variant="ghost" confirm="ستُلغى التوقيعات الحالية. متابعة؟" />
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
        </div>

        {/* ───────── Side: progress, invitations, attendance ───────── */}
        <aside className="space-y-6">
          <Panel title="مسار الاجتماع"><Steps steps={steps} /></Panel>

          {manage && !cancelled && !m.heldAt ? (
            <Panel title="الدعوات">
              {d.invited ? <p className="mb-3 text-[14px] text-muted">أُرسلت الدعوات {fmtDateTime(m.invitationsSentAt)}.</p> : <p className="mb-3 text-[14px] text-muted">تصل الدعوة لكل عضو مع جدول الأعمال ورابط الإفصاح عن التعارض.</p>}
              <ActionButton action={sendInvitations} fields={ids} label={d.invited ? "أعد إرسال الدعوات" : "أرسل الدعوات"} variant={d.invited ? "secondary" : "primary"} pendingText="جارٍ الإرسال…" />
              <div className="mt-3 border-t border-line pt-3"><ActionButton action={cancelMeeting} fields={ids} label="ألغِ الاجتماع" variant="ghost" size="sm" confirm="إلغاء هذا الاجتماع؟" /></div>
            </Panel>
          ) : null}

          <Panel title="الحضور والنصاب" description={m.quorumRequired ? `النصاب المطلوب ${m.quorumRequired} من الأعضاء المصوّتين${d.profile.requireIndependent ? " مع عضو مستقل" : ""}.` : undefined}>
            {m.quorumMet === true ? <Alert tone="ok" title="اكتمل النصاب" className="mb-3">حضر {d.presentVoting} من الأعضاء المصوّتين.</Alert> : m.quorumMet === false ? <Alert tone="critical" title="لم يكتمل النصاب" className="mb-3">لا يجوز التصويت. أكمل الحضور ثم أعد التحقق.</Alert> : null}
            {manage && d.invited && !cancelled && (!mn || mn.status === "draft") ? (
              <div className="space-y-4">
                <AttendanceForm {...ids} seats={d.seats} locked={false} />
                <ActionButton action={confirmQuorum} fields={ids} label={m.quorumMet ? "أعد التحقق من النصاب" : "تحقق من النصاب وابدأ الاجتماع"} variant={m.quorumMet ? "secondary" : "primary"} />
              </div>
            ) : (
              <ul className="space-y-1 text-[14px]">
                {d.seats.map((s) => (
                  <li key={s.membershipId} className="flex justify-between gap-2">
                    <span>{s.name} <span className="text-muted">({ROLE_AR[s.role] ?? s.role}{s.isIndependent ? "، مستقل" : ""})</span></span>
                    <span className={cn(isPresent(s.status) ? "text-ok" : "text-muted")}>{s.status ? ATTENDANCE_AR[s.status] : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
