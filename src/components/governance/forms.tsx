"use client";

import { useActionState, useRef, useState } from "react";
import { Bold, Heading2, List } from "lucide-react";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { cn, initialState, type ActionState } from "@/lib/utils";
import {
  addAgendaItem, addPerformanceReview, castVote, closeVote, createMeeting, declareConflict, openVote, recordAttendance, requestMinutesOtp,
  saveMinutes, savePolicy, signMinutes, taskFromResolution,
} from "@/server/modules/governance/actions";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
type Opt = { value: string; label: string };
type Ids = { waqfId: string; meetingId?: string };

function Hidden({ v }: { v: Record<string, string | undefined> }) {
  return (
    <>
      {Object.entries(v).map(([k, val]) => (val === undefined ? null : <input key={k} type="hidden" name={k} value={val} />))}
    </>
  );
}

/** One-button form for simple state transitions (invite, confirm quorum, circulate, lock…). */
export function ActionButton({ action, fields, label, pendingText, variant = "primary", size = "md", confirm, className }: {
  action: Act; fields: Record<string, string | undefined>; label: string; pendingText?: string; variant?: "primary" | "secondary" | "ghost" | "danger" | "seal"; size?: "sm" | "md"; confirm?: string; className?: string;
}) {
  const [state, run] = useActionState(action, initialState);
  return (
    <form
      action={run}
      className={cn("space-y-2", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <Hidden v={fields} />
      <SubmitButton variant={variant} size={size} pendingText={pendingText ?? "جارٍ التنفيذ…"}>{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function MeetingForm({ waqfId }: { waqfId: string }) {
  const [state, run] = useActionState(createMeeting, initialState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={run} className="grid gap-4 md:grid-cols-2">
      <Hidden v={{ waqfId }} />
      <Field label="عنوان الاجتماع" name="title" error={fe.title} required className="md:col-span-2">
        <Input name="title" maxLength={200} required placeholder="مثال: الاجتماع الدوري الرابع لعام 2026" />
      </Field>
      <Field label="نوع الاجتماع" name="kind" error={fe.kind} required>
        <Select name="kind" defaultValue="regular" options={[{ value: "regular", label: "عادي" }, { value: "extraordinary", label: "استثنائي" }]} />
      </Field>
      <Field label="التاريخ والوقت" name="scheduledAt" error={fe.scheduledAt} required hint="بتوقيت الرياض">
        <Input name="scheduledAt" type="datetime-local" required dir="ltr" className="text-start" />
      </Field>
      <Field label="المكان" name="location" error={fe.location} hint="اتركه فارغًا إن كان الاجتماع عن بُعد فقط">
        <Input name="location" maxLength={200} placeholder="مقر الوقف — قاعة الاجتماعات" />
      </Field>
      <Field label="رابط الاجتماع عن بُعد" name="link" error={fe.link}>
        <Input name="link" type="url" dir="ltr" className="text-start" placeholder="https://" />
      </Field>
      <Field label="جدول الأعمال" name="agenda" error={fe.agenda} className="md:col-span-2" hint="سطر لكل بند. ابدأ السطر بعلامة ! إن كان البند يحتاج قرارًا وتصويتًا. يمكنك إضافة البنود لاحقًا أيضًا.">
        <Textarea name="agenda" className="min-h-28" placeholder={"المصادقة على محضر الاجتماع السابق\n! اعتماد الموازنة التقديرية\n! تجديد عقد إدارة الأملاك"} />
      </Field>
      <div className="space-y-3 md:col-span-2">
        <FormMessage state={state} />
        <SubmitButton pendingText="جارٍ الإنشاء…">أنشئ الاجتماع</SubmitButton>
      </div>
    </form>
  );
}

export function AgendaItemForm({ waqfId, meetingId }: Required<Ids>) {
  const [state, run] = useActionState(addAgendaItem, initialState);
  return (
    <form action={run} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end">
      <Hidden v={{ waqfId, meetingId }} />
      <Field label="بند جديد" name="title" error={state.fieldErrors?.title}>
        <Input name="title" maxLength={300} required placeholder="عنوان البند" />
      </Field>
      <Field label="النوع" name="kind">
        <Select name="kind" defaultValue="decision" options={[{ value: "decision", label: "للقرار" }, { value: "discussion", label: "للنقاش" }, { value: "info", label: "للعلم" }]} />
      </Field>
      <SubmitButton variant="secondary" pendingText="جارٍ الإضافة…">أضف البند</SubmitButton>
      <div className="md:col-span-3"><FormMessage state={state} /></div>
    </form>
  );
}

export function CoiForm({ waqfId, meetingId, itemId }: Required<Ids> & { itemId: string }) {
  const [state, run] = useActionState(declareConflict, initialState);
  const [kind, setKind] = useState("none");
  const p = (n: string) => `${n}-${itemId.slice(0, 8)}`;
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form action={run} className="space-y-3 rounded-md border border-line bg-surface-2/50 p-3">
      <Hidden v={{ waqfId, meetingId, itemId }} />
      <fieldset>
        <legend className="mb-1 text-[14px] font-medium">إقرار تعارض المصالح لهذا البند</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
          {[["none", "لا يوجد تعارض"], ["potential", "تعارض محتمل"], ["actual", "تعارض فعلي"]].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="accent-[var(--ink)]" />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      {kind !== "none" ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="طبيعة التعارض" name={p("description")} error={state.fieldErrors?.description} required>
            <Textarea id={p("description")} name="description" maxLength={1000} className="min-h-20" placeholder="مثال: المستأجر المقترح شركة يملك فيها قريبي حصة" />
          </Field>
          <Field label="درجة القرابة" name={p("relationDegree")} hint="إن كان التعارض بسبب قريب">
            <Select id={p("relationDegree")} name="relationDegree" defaultValue="" placeholder="لا ينطبق" options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `الدرجة ${n}` }))} />
          </Field>
        </div>
      ) : null}
      <FormMessage state={state} />
      <SubmitButton size="sm" variant={kind === "none" ? "secondary" : "danger"} pendingText="جارٍ التسجيل…">
        {kind === "none" ? "أقرّ بعدم وجود تعارض" : "أفصح عن التعارض"}
      </SubmitButton>
    </form>
  );
}

export function AttendanceForm({ waqfId, meetingId, seats, locked }: Required<Ids> & {
  seats: { membershipId: string; name: string; role: string; isIndependent: boolean; hasVote: boolean; status: string | null; mode: string | null }[];
  locked: boolean;
}) {
  const [state, run] = useActionState(recordAttendance, initialState);
  const statusOpts: Opt[] = [
    { value: "invited", label: "لم يُسجَّل" }, { value: "present", label: "حاضر" }, { value: "apologized", label: "اعتذر" }, { value: "absent", label: "غائب" },
  ];
  const modeOpts: Opt[] = [{ value: "in_person", label: "حضوري" }, { value: "remote", label: "عن بُعد" }];
  return (
    <form action={run} className="space-y-3">
      <Hidden v={{ waqfId, meetingId }} />
      <ul className="divide-y divide-line">
        {seats.map((s) => (
          <li key={s.membershipId} className="grid grid-cols-2 gap-2 py-2">
            <div className="col-span-2 min-w-0">
              <p className="font-medium">{s.name}</p>
              <p className="text-[13px] text-muted">{s.role === "chair" ? "الرئيس" : s.role === "secretary" ? "أمين السر" : "عضو"}{s.isIndependent ? " · مستقل" : ""}{!s.hasVote ? " · بلا صوت" : ""}</p>
            </div>
            <label className="sr-only" htmlFor={`status_${s.membershipId}`}>حضور {s.name}</label>
            <Select name={`status_${s.membershipId}`} id={`status_${s.membershipId}`} aria-label={`حضور ${s.name}`} defaultValue={s.status ?? "invited"} options={statusOpts} disabled={locked} className="h-10" />
            <Select name={`mode_${s.membershipId}`} id={`mode_${s.membershipId}`} aria-label={`طريقة حضور ${s.name}`} defaultValue={s.mode ?? "in_person"} options={modeOpts} disabled={locked} className="h-10" />
          </li>
        ))}
      </ul>
      <FormMessage state={state} />
      {!locked ? <SubmitButton variant="secondary" pendingText="جارٍ الحفظ…">احفظ كشف الحضور</SubmitButton> : null}
    </form>
  );
}

export function OpenVoteForm({ waqfId, meetingId, itemId, defaultText, categories }: Required<Ids> & { itemId: string; defaultText: string; categories: Opt[] }) {
  const [state, run] = useActionState(openVote, initialState);
  const p = (n: string) => `${n}-${itemId.slice(0, 8)}`;
  return (
    <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer font-medium text-ink">اطرح للتصويت</summary>
      <form action={run} className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
        <Hidden v={{ waqfId, meetingId, itemId }} />
        <Field label="نص القرار المقترح" name={p("text")} error={state.fieldErrors?.text} required className="md:col-span-2">
          <Textarea id={p("text")} name="text" defaultValue={defaultText} maxLength={2000} className="min-h-20" required />
        </Field>
        <Field label="تصنيف القرار" name={p("category")} error={state.fieldErrors?.category} required>
          <Select id={p("category")} name="category" defaultValue="other" options={categories} />
        </Field>
        <div className="self-end pb-2"><Checkbox name="requiresExternalApproval" label="يحتاج موافقة جهة خارجية (كالهيئة)" /></div>
        <div className="space-y-2 md:col-span-2">
          <FormMessage state={state} />
          <SubmitButton pendingText="جارٍ الفتح…">افتح التصويت</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function VoteForm({ waqfId, meetingId, resolutionId, needsDeclaration }: Required<Ids> & { resolutionId: string; needsDeclaration: boolean }) {
  const [state, run] = useActionState(castVote, initialState);
  if (state.ok) return <FormMessage state={state} />;
  const p = resolutionId.slice(0, 8);
  return (
    <form action={run} className="space-y-3 rounded-md border border-ink/30 bg-ink-soft/40 p-3">
      <Hidden v={{ waqfId, meetingId, resolutionId }} />
      <fieldset>
        <legend className="mb-1 font-medium">صوتك</legend>
        <div className="flex flex-wrap gap-2">
          {[["for", "موافق"], ["against", "معارض"], ["abstain", "ممتنع"]].map(([v, l]) => (
            <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3 has-[:checked]:border-ink has-[:checked]:bg-ink-soft">
              <input type="radio" name="value" value={v} required className="accent-[var(--ink)]" id={`v-${v}-${p}`} />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="مسوّغ الصوت (اختياري)" name={`reason-${p}`}>
        <Input id={`reason-${p}`} name="reason" maxLength={500} />
      </Field>
      {needsDeclaration ? <Checkbox name="noConflict" required label="أقرّ بعدم وجود تعارض مصالح لي أو لأقاربي في هذا البند." /> : null}
      <p className="text-[13px] text-muted">الصوت نهائي ولا يمكن تعديله بعد الإدلاء به.</p>
      <FormMessage state={state} />
      <SubmitButton variant="seal" pendingText="جارٍ التسجيل…">سجّل صوتي</SubmitButton>
    </form>
  );
}

export function CloseVoteForm({ waqfId, meetingId, resolutionId }: Required<Ids> & { resolutionId: string }) {
  const [state, run] = useActionState(closeVote, initialState);
  return (
    <form action={run} className="space-y-2">
      <Hidden v={{ waqfId, meetingId, resolutionId }} />
      {state.data?.needForce ? <Checkbox name="force" label="أغلق التصويت ويُعدّ من لم يصوّت غير مصوّت" /> : null}
      <FormMessage state={state} />
      <SubmitButton variant="secondary" size="sm" pendingText="جارٍ الإغلاق…">أغلق التصويت واحسب النتيجة</SubmitButton>
    </form>
  );
}

export function MinutesEditor({ waqfId, meetingId, minuteId, body }: Required<Ids> & { minuteId: string; body: string }) {
  const [state, run] = useActionState(saveMinutes, initialState);
  const ta = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after = "", linePrefix = false) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    if (linePrefix) {
      const ls = value.lastIndexOf("\n", s - 1) + 1;
      el.setRangeText(before, ls, ls, "end");
    } else {
      el.setRangeText(`${before}${value.slice(s, e) || "نص"}${after}`, s, e, "select");
    }
    el.focus();
  };
  return (
    <form action={run} className="space-y-3">
      <Hidden v={{ waqfId, meetingId, minuteId }} />
      <div className="flex flex-wrap gap-1" role="toolbar" aria-label="تنسيق المحضر">
        <button type="button" onClick={() => wrap("**", "**")} className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-2 text-[13px] hover:bg-surface-2"><Bold aria-hidden className="size-4" />عريض</button>
        <button type="button" onClick={() => wrap("## ", "", true)} className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-2 text-[13px] hover:bg-surface-2"><Heading2 aria-hidden className="size-4" />عنوان</button>
        <button type="button" onClick={() => wrap("- ", "", true)} className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-2 text-[13px] hover:bg-surface-2"><List aria-hidden className="size-4" />قائمة</button>
      </div>
      <Field label="نص المحضر" name="body" error={state.fieldErrors?.body} hint="أكمل «ملخص المداولة» تحت كل بند. القرارات ونتائج التصويت مدرجة تلقائيًا؛ لا تغيّر أرقامها.">
        <Textarea ref={ta} name="body" defaultValue={body} className="naskh min-h-[28rem] text-[16px] leading-8" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="جارٍ الحفظ…">احفظ المسودة</SubmitButton>
    </form>
  );
}

export function SignMinutesForm({ waqfId, meetingId, minuteId }: Required<Ids> & { minuteId: string }) {
  const [o, sendOtp] = useActionState(requestMinutesOtp, initialState);
  const [s, doSign] = useActionState(signMinutes, initialState);
  const challengeId = (o.data?.challengeId as string) ?? "";
  if (s.ok) return <FormMessage state={s} />;
  return (
    <div className="space-y-3">
      {!challengeId ? (
        <form action={sendOtp} className="space-y-3">
          <Hidden v={{ waqfId, meetingId, minuteId }} />
          <p className="text-[15px] text-muted">توقيعك بالموافقة الموثقة: نرسل رمزًا إلى جوالك المسجل، وتحفظ المنصة بصمة نص المحضر ووقت التوقيع.</p>
          <FormMessage state={o} />
          <SubmitButton variant="seal" pendingText="جارٍ الإرسال…">أرسل رمز التوقيع</SubmitButton>
        </form>
      ) : (
        <form action={doSign} className="space-y-3">
          <Hidden v={{ waqfId, meetingId, minuteId, challengeId }} />
          <p className="text-[15px] text-muted">أرسلنا رمزًا من 6 أرقام إلى <span dir="ltr" className="font-medium text-text">{String(o.data?.masked ?? "")}</span>. الرمز صالح 5 دقائق.</p>
          {o.data?.demoCode ? (
            <div className="rounded-md border border-dashed border-seal bg-seal-soft p-3 text-[15px]" role="note">
              <p className="font-semibold text-seal">وضع التجربة</p>
              <p>لم يُربط مزود الرسائل بعد، لذلك يظهر الرمز هنا: <span dir="ltr" data-testid="demo-otp" className="tabular font-bold tracking-[0.3em]">{String(o.data.demoCode)}</span></p>
            </div>
          ) : null}
          <Field label="رمز التوقيع" name="code" error={s.fieldErrors?.code}>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} dir="ltr" required className="tabular max-w-56 text-center text-xl tracking-[0.4em]" />
          </Field>
          <Checkbox name="consent" required label="قرأت المحضر كاملًا، وأوافق على أنه يطابق ما جرى في الاجتماع." />
          <FormMessage state={s} />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton variant="seal" pendingText="جارٍ التوقيع…">وقّع المحضر</SubmitButton>
            <button type="button" onClick={() => window.location.reload()} className="text-[15px] text-ink underline-offset-4 hover:underline">طلب رمز جديد</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function ResolutionTaskForm({ waqfId, meetingId, resolutionId, members, defaultTitle }: Ids & { resolutionId: string; members: Opt[]; defaultTitle: string }) {
  const [state, run] = useActionState(taskFromResolution, initialState);
  const p = (n: string) => `${n}-${resolutionId.slice(0, 8)}`;
  return (
    <details className="text-[14px]">
      <summary className="cursor-pointer text-ink underline-offset-4 hover:underline">أنشئ مهمة تنفيذ</summary>
      <form action={run} className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_10rem]">
        <Hidden v={{ waqfId, meetingId, resolutionId }} />
        <Field label="المهمة" name={p("title")} error={state.fieldErrors?.title} required>
          <Input id={p("title")} name="title" defaultValue={defaultTitle} maxLength={200} required />
        </Field>
        <Field label="المكلّف" name={p("assignee")}>
          <Select id={p("assignee")} name="assigneeUserId" defaultValue="" placeholder="بدون تكليف" options={members} />
        </Field>
        <Field label="الموعد" name={p("due")} error={state.fieldErrors?.dueOn}>
          <Input id={p("due")} name="dueOn" type="date" dir="ltr" className="text-start" />
        </Field>
        <div className="space-y-2 md:col-span-3">
          <FormMessage state={state} />
          <SubmitButton size="sm" pendingText="جارٍ الإنشاء…">أنشئ المهمة</SubmitButton>
        </div>
      </form>
    </details>
  );
}

export function PolicyForm({ waqfId, types, resolutions, policy }: {
  waqfId: string; types: Opt[]; resolutions: Opt[];
  policy?: { id: string; policyType: string; title: string; status: string; approvedOn: string | null; reviewDue: string | null; approvedByResolutionId: string | null };
}) {
  const [state, run] = useActionState(savePolicy, initialState);
  const fe = state.fieldErrors ?? {};
  const p = (n: string) => `${n}-${policy ? policy.id.slice(0, 8) : "new"}`;
  return (
    <form action={run} className="grid gap-3 md:grid-cols-2">
      <Hidden v={{ waqfId, policyId: policy?.id ?? "" }} />
      <Field label="النوع" name={p("type")} error={fe.policyType} required>
        <Select id={p("type")} name="policyType" defaultValue={policy?.policyType ?? ""} placeholder="اختر" options={types} required />
      </Field>
      <Field label="العنوان" name={p("title")} error={fe.title} required>
        <Input id={p("title")} name="title" defaultValue={policy?.title} maxLength={200} required />
      </Field>
      <Field label="الحالة" name={p("status")}>
        <Select id={p("status")} name="status" defaultValue={policy?.status ?? "draft"} options={[{ value: "draft", label: "مسودة" }, { value: "approved", label: "معتمدة" }, { value: "superseded", label: "مستبدلة" }]} />
      </Field>
      <Field label="قرار الاعتماد" name={p("res")}>
        <Select id={p("res")} name="resolutionId" defaultValue={policy?.approvedByResolutionId ?? ""} placeholder="بدون" options={resolutions} />
      </Field>
      <Field label="تاريخ الاعتماد" name={p("approvedOn")} error={fe.approvedOn}>
        <Input id={p("approvedOn")} name="approvedOn" type="date" defaultValue={policy?.approvedOn ?? ""} dir="ltr" className="text-start" />
      </Field>
      <Field label="موعد المراجعة القادمة" name={p("reviewDue")} error={fe.reviewDue}>
        <Input id={p("reviewDue")} name="reviewDue" type="date" defaultValue={policy?.reviewDue ?? ""} dir="ltr" className="text-start" />
      </Field>
      <div className="space-y-2 md:col-span-2">
        <FormMessage state={state} />
        <SubmitButton size="sm" pendingText="جارٍ الحفظ…">{policy ? "احفظ" : "أضف إلى السجل"}</SubmitButton>
      </div>
    </form>
  );
}

export function ReviewForm({ waqfId }: { waqfId: string }) {
  const [state, run] = useActionState(addPerformanceReview, initialState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={run} className="grid gap-3 md:grid-cols-4">
      <Hidden v={{ waqfId }} />
      <Field label="المُقيَّم" name="subjectType">
        <Select name="subjectType" defaultValue="board" options={[{ value: "board", label: "المجلس" }, { value: "member", label: "عضو" }, { value: "nazir", label: "الناظر" }]} />
      </Field>
      <Field label="الاسم" name="subjectName" error={fe.subjectName} required>
        <Input name="subjectName" maxLength={200} required />
      </Field>
      <Field label="السنة" name="year" error={fe.year} required>
        <Input name="year" type="number" min={2000} max={2100} defaultValue={new Date().getFullYear()} dir="ltr" className="text-start" />
      </Field>
      <Field label="الدرجة من 100" name="score" error={fe.score}>
        <Input name="score" type="number" min={0} max={100} step="0.5" dir="ltr" className="text-start" />
      </Field>
      <Field label="الملاحظات" name="notes" className="md:col-span-4">
        <Textarea name="notes" maxLength={2000} className="min-h-20" />
      </Field>
      <div className="space-y-2 md:col-span-4">
        <FormMessage state={state} />
        <SubmitButton size="sm" pendingText="جارٍ الحفظ…">سجّل التقييم</SubmitButton>
      </div>
    </form>
  );
}
