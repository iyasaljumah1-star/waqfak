"use client";

import { useActionState, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Loader2, Save } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { FormMessage } from "@/components/ui/form";
import { deriveType } from "@/server/engines/assessment";
import { cn, initialState, type ActionState } from "@/lib/utils";
import { RowsEditor, type RowField } from "./action-form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** One wizard step: children are the step's fields; buttons submit with intent back | save | next. No auto reset. */
export function WizardStepForm({ action, draftId, step, isFirst, nextLabel = "التالي", children }: { action: Action; draftId: string; step: number; isFirst: boolean; nextLabel?: string; children: ReactNode }) {
  const [state, dispatch, pending] = useActionState(action, initialState);
  const [, start] = useTransition();
  const [clicked, setClicked] = useState<string | null>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter ?? undefined);
    setClicked(submitter?.value ?? "next");
    start(() => dispatch(fd));
  };
  const fe = Object.entries(state.fieldErrors ?? {}).filter(([, v]) => v);
  const spin = (k: string) => (pending && clicked === k ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null);
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" data-testid={`wizard-step-${step}`}>
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="step" value={step} />
      {children}
      {fe.length > 1 ? (
        <ul className="list-disc space-y-0.5 rounded-md bg-critical-soft px-8 py-2 text-[14px] text-critical">
          {fe.map(([k, v]) => <li key={k}>{v}</li>)}
        </ul>
      ) : null}
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex gap-2">
          {!isFirst ? (
            <button type="submit" name="intent" value="back" disabled={pending} className={buttonClass("ghost", "md")}>
              {spin("back") ?? <ArrowRight aria-hidden className="size-4" />} السابق
            </button>
          ) : null}
          <button type="submit" name="intent" value="save" disabled={pending} className={buttonClass("secondary", "md")}>
            {spin("save") ?? <Save aria-hidden className="size-4" />} احفظ واخرج
          </button>
        </div>
        <button type="submit" name="intent" value="next" disabled={pending} className={buttonClass("primary", "md")}>
          {nextLabel} {spin("next") ?? <ArrowLeft aria-hidden className="size-4" />}
        </button>
      </div>
    </form>
  );
}

const TYPE_AR: Record<string, string> = { public: "وقف عام (خيري)", private: "وقف خاص (أهلي)", joint: "وقف مشترك" };

function Radio({ name, value, checked, onChange, label, hint }: { name: string; value: string; checked: boolean; onChange: (v: string) => void; label: string; hint?: string }) {
  return (
    <label className={cn("flex cursor-pointer gap-3 rounded-md border p-3", checked ? "border-ink bg-ink-soft" : "border-line hover:bg-surface-2")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="mt-1.5 size-4 accent-[var(--ink)]" />
      <span>
        <span className="block font-medium">{label}</span>
        {hint ? <span className="block text-[13px] text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Step 1: classification first (GAA type guide), with the computed type shown live. */
export function ClassificationFields({ initial, temporaryAllowed }: { initial: { beneficiaryKind: string; charitableQualifier: string; thenToCharity: string; duration: string; durationYears: string; fieldOfWork: string; geographicScope: string }; temporaryAllowed: boolean }) {
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof v) => (val: string) => setV({ ...v, [k]: val });
  const t = deriveType({ beneficiary_kind: v.beneficiaryKind || null, charitable_qualifier: v.beneficiaryKind === "private" ? v.charitableQualifier || null : null, then_to_charity: v.beneficiaryKind === "private" ? v.thenToCharity || null : null });
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-[15px] font-semibold">على من تريد أن تُصرف غلة الوقف؟</legend>
        <Radio name="beneficiaryKind" value="public" checked={v.beneficiaryKind === "public"} onChange={set("beneficiaryKind")} label="جهات بر عامة" hint="الفقراء، المساجد، التعليم، الصحة، طلاب العلم…" />
        <Radio name="beneficiaryKind" value="private" checked={v.beneficiaryKind === "private"} onChange={set("beneficiaryKind")} label="ذريتي أو أقاربي أو أشخاص معيّنون" hint="الأولاد وذرياتهم، الإخوة، أشخاص بأسمائهم…" />
        <Radio name="beneficiaryKind" value="both" checked={v.beneficiaryKind === "both"} onChange={set("beneficiaryKind")} label="الاثنان معًا" hint="حصة للذرية وحصة لجهة بر عامة" />
      </fieldset>
      {v.beneficiaryKind === "private" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[14px] font-medium">هل تقيّد استحقاق الذرية بوصف خيري كالفقر أو الحاجة؟</legend>
            <Radio name="charitableQualifier" value="yes" checked={v.charitableQualifier === "yes"} onChange={set("charitableQualifier")} label="نعم، للمحتاج منهم" />
            <Radio name="charitableQualifier" value="no" checked={v.charitableQualifier === "no"} onChange={set("charitableQualifier")} label="لا، لهم جميعًا" />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[14px] font-medium">وإذا انقرضوا، هل تؤول الغلة لجهة بر؟</legend>
            <Radio name="thenToCharity" value="yes" checked={v.thenToCharity === "yes"} onChange={set("thenToCharity")} label="نعم" />
            <Radio name="thenToCharity" value="no" checked={v.thenToCharity === "no"} onChange={set("thenToCharity")} label="لم أقرر بعد" />
          </fieldset>
        </div>
      ) : null}
      {temporaryAllowed ? (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-[14px] font-medium">مدة الوقف</legend>
          <Radio name="duration" value="perpetual" checked={v.duration !== "temporary"} onChange={set("duration")} label="مؤبد" />
          <Radio name="duration" value="temporary" checked={v.duration === "temporary"} onChange={set("duration")} label="مؤقت لمدة محددة" />
          {v.duration === "temporary" ? (
            <label className="space-y-1 text-[14px] sm:col-span-2"><span className="block font-medium">المدة بالسنوات</span><input name="durationYears" inputMode="numeric" dir="ltr" defaultValue={v.durationYears} className="block h-11 w-40 rounded-md border border-line-strong bg-surface px-3" /></label>
          ) : null}
        </fieldset>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-[15px]"><span className="block font-medium">مجال الوقف (اختياري)</span><input name="fieldOfWork" defaultValue={v.fieldOfWork} maxLength={120} placeholder="مثال: التعليم" className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3" /></label>
        <label className="space-y-1.5 text-[15px]"><span className="block font-medium">النطاق الجغرافي (اختياري)</span><input name="geographicScope" defaultValue={v.geographicScope} maxLength={120} placeholder="مثال: مدينة الرياض" className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3" /></label>
      </div>
      <div aria-live="polite" className="rounded-lg border border-seal/40 bg-seal-soft p-4" data-testid="computed-type">
        <p className="text-[13px] font-medium text-seal">النوع المحسوب</p>
        <p className="text-lg font-semibold text-ink">{t.type ? TYPE_AR[t.type] : "أجب عن السؤال الأول"}</p>
        {t.reason ? <p className="mt-1 text-[14px] leading-7">{t.reason}</p> : null}
        <p className="mt-2 text-[12px] text-muted">التصنيف استرشادي وفق الدليل الاسترشادي لتصنيف أنواع الوقف، ويُؤكَّد عند المراجعة الشرعية والقانونية.</p>
      </div>
    </div>
  );
}

const M = 1_000_000;
const sizeOf = (t: number) => (t >= 200 * M ? "كبير" : t >= 50 * M ? "متوسط" : "صغير");

/** Step 3: assets with live total and indicative size class. */
export function AssetsStep({ initial, fields }: { initial: Record<string, string>[]; fields: RowField[] }) {
  const [rows, setRows] = useState(initial);
  const total = rows.reduce((s, r) => s + (Number(String(r.value ?? "").replace(/,/g, "")) || 0), 0);
  return (
    <div className="space-y-3">
      <RowsEditor prefix="a" fields={fields} initial={initial} addLabel="أضف أصلًا" onChange={setRows} />
      <p className="rounded-md bg-surface-2 px-3 py-2 text-[14px]" aria-live="polite">
        القيمة التقديرية الإجمالية: <span className="tabular font-semibold">{new Intl.NumberFormat("ar-SA-u-nu-latn").format(total)} ريال</span>
        {total > 0 ? <> — الفئة المتوقعة حسب الحجم: <span className="font-semibold">{sizeOf(total)}</span></> : null}
      </p>
    </div>
  );
}

const ALLOC = [
  { key: "maintenancePct", label: "عمارة الأصول وصيانتها" },
  { key: "developmentPct", label: "تنمية الأصول" },
  { key: "reinvestPct", label: "إعادة الاستثمار" },
  { key: "reservePct", label: "الاحتياطي" },
  { key: "nazirFeePct", label: "أجرة الناظر" },
  { key: "adminPct", label: "المصاريف الإدارية" },
] as const;

/** Step 6: revenue allocation with a live remainder for beneficiaries (must stay ≥ 0). */
export function AllocationStep({ initial }: { initial: Record<string, string> }) {
  const [v, setV] = useState(initial);
  const sum = Math.round(ALLOC.reduce((s, a) => s + (Number(v[a.key]) || 0), 0) * 100) / 100;
  const rest = Math.round((100 - sum) * 100) / 100;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ALLOC.map((a) => (
          <label key={a.key} className="space-y-1.5 text-[15px]">
            <span className="block font-medium">{a.label} (%)</span>
            <input name={a.key} inputMode="decimal" dir="ltr" value={v[a.key] ?? ""} onChange={(e) => setV({ ...v, [a.key]: e.target.value })} className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-start tabular" />
          </label>
        ))}
      </div>
      <p aria-live="polite" className={cn("rounded-md px-3 py-2 text-[15px]", rest < 0 ? "bg-critical-soft text-critical" : "bg-ok-soft text-ok")}>
        {rest < 0 ? `المجموع ${sum}% يتجاوز 100%. خفّض النسب.` : `يبقى للمستفيدين ${rest}% من صافي الغلة.`}
      </p>
      <label className="block space-y-1.5 text-[15px]">
        <span className="block font-medium">ملاحظات على توزيع الغلة (اختياري)</span>
        <textarea name="notes" defaultValue={initial.notes ?? ""} maxLength={1000} className="block min-h-20 w-full rounded-md border border-line-strong bg-surface px-3 py-2" placeholder="مثال: تُقدَّم عمارة الوقف على الصرف للمستحقين عند الحاجة." />
      </label>
    </div>
  );
}
