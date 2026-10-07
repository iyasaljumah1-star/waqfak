"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, BookMarked, Check, CircleHelp, CloudOff, Loader2 } from "lucide-react";
import { visibleQuestions, type Answer, type Option, type Question } from "@/server/engines/assessment";
import { isAnswered, optionsFor, stepsFor } from "@/server/modules/assessment/facts";
import { saveAnswer, saveStep, submitAssessment } from "@/server/modules/assessment/actions";
import { buttonClass } from "@/components/ui";
import { cn } from "@/lib/utils";

export type RunnerQuestion = Question & { helpAr: string | null };
export type RunnerAxis = { code: string; nameAr: string; description: string | null };

type Props = {
  id: string;
  depth: "basic" | "deep";
  axes: RunnerAxis[];
  questions: RunnerQuestion[];
  initialAnswers: Record<string, unknown>;
  initialStep: string;
  prefilledCodes: string[];
};

type SaveState = "idle" | "saving" | "saved" | "error";

const PROFILE: RunnerAxis = { code: "P", nameAr: "ملف الوقف", description: "أسئلة قصيرة تحدد حجم الوقف ونوعه، فنعرض لك الأسئلة المنطبقة عليه وحدها." };

export function AssessmentRunner({ id, depth, axes, questions, initialAnswers, initialStep, prefilledCodes }: Props) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prefilled = useMemo(() => new Set(prefilledCodes), [prefilledCodes]);

  const asAnswers = useMemo(() => Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { value: v } as Answer])), [answers]);
  const visible = useMemo(() => visibleQuestions(questions, asAnswers, {}, depth) as RunnerQuestion[], [questions, asAnswers, depth]);
  const axisOrder = useMemo(() => axes.map((a) => a.code), [axes]);
  const steps = useMemo(() => [...stepsFor(visible, axisOrder), "review"], [visible, axisOrder]);
  const [step, setStep] = useState(() => (steps.includes(initialStep) ? initialStep : "P"));
  const stepIndex = Math.max(0, steps.indexOf(step));
  const axisInfo = step === "P" ? PROFILE : axes.find((a) => a.code === step);
  const stepQuestions = visible.filter((q) => q.axisCode === step);

  const scorable = visible.filter((q) => q.answerType !== "text");
  const answeredCount = scorable.filter((q) => isAnswered(answers[q.code])).length;
  const progress = scorable.length ? Math.round((answeredCount / scorable.length) * 100) : 0;

  const persist = useCallback(
    (code: string, value: unknown) => {
      pending.current++;
      setSaveState("saving");
      chain.current = chain.current
        .then(() => saveAnswer(id, code, value))
        .then((r) => {
          if (!r.ok) {
            setError(r.error ?? "تعذر حفظ الإجابة. تحقق من الاتصال ثم أعد المحاولة.");
            setSaveState("error");
          } else if (--pending.current === 0) {
            setError(null);
            setSaveState("saved");
          }
        })
        .catch(() => {
          pending.current = Math.max(0, pending.current - 1);
          setError("انقطع الاتصال؛ لم تُحفظ آخر إجابة. أعد اختيارها بعد عودة الاتصال.");
          setSaveState("error");
        });
    },
    [id],
  );

  const setAnswer = (code: string, value: unknown) => {
    setAnswers((a) => ({ ...a, [code]: value }));
    setStepError(null);
    persist(code, value);
  };

  const go = (target: string) => {
    setStep(target);
    setStepError(null);
    void saveStep(id, target);
    window.scrollTo({ top: 0, behavior: "smooth" });
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  };

  const next = () => {
    if (step === "P") {
      const missing = stepQuestions.filter((q) => !isAnswered(answers[q.code]));
      if (missing.length) {
        setStepError(`أجب عن أسئلة ملف الوقف كلها أولًا (${missing.length} متبقية)، فهي تحدد الأسئلة المنطبقة والأوزان.`);
        document.getElementById(`q-${missing[0].code}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    if (stepIndex < steps.length - 1) go(steps[stepIndex + 1]);
  };
  const back = () => stepIndex > 0 && go(steps[stepIndex - 1]);

  const submit = () =>
    startSubmit(async () => {
      await chain.current;
      const r = await submitAssessment(id);
      if (r && !r.ok) setError(r.error ?? "تعذر حساب النتيجة. أعد المحاولة.");
    });

  // Warn before leaving while a save is in flight.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (pending.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const profileDone = visible.filter((q) => q.axisCode === "P").every((q) => isAnswered(answers[q.code]));
  const axisNumber = step === "P" || step === "review" ? null : axisOrder.filter((a) => steps.includes(a)).indexOf(step) + 1;
  const axisTotal = steps.length - 2;
  const isReview = step === "review";
  const questionOffset = visible.findIndex((q) => q.axisCode === step);

  return (
    <div className="pb-28 md:pb-10">
      {/* progress header */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>
            {step === "P" ? "البداية: ملف الوقف" : isReview ? "المراجعة الأخيرة" : `المحور ${axisNumber} من ${axisTotal}`}
          </span>
          <span className="tabular" aria-live="polite">
            أجبت عن {answeredCount} من {scorable.length} ({progress}%)
          </span>
        </div>
        <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة الإجابة" className="h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
          <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
        <ol className="hidden flex-wrap gap-1.5 md:flex" aria-label="المحاور">
          {steps.map((s) => {
            const label = s === "P" ? "الملف" : s === "review" ? "المراجعة" : s;
            const ax = axes.find((a) => a.code === s);
            const done = s !== "review" && visible.filter((q) => q.axisCode === s && q.answerType !== "text").every((q) => isAnswered(answers[q.code]));
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => go(s)}
                  disabled={s !== "P" && !profileDone}
                  title={ax?.nameAr ?? label}
                  aria-current={s === step ? "step" : undefined}
                  className={cn(
                    "h-8 min-w-10 rounded-md px-2 text-[13px] font-medium ring-1 transition-colors",
                    s === step ? "bg-ink text-white ring-ink dark:text-[#0f141c]" : done ? "bg-olive-soft text-olive ring-olive/30" : "bg-surface text-muted ring-line hover:bg-surface-2",
                  )}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {!isReview ? (
        <section aria-labelledby="step-title" className="fade-in" key={step}>
          <header className="mb-5">
            <h2 id="step-title" ref={headingRef} tabIndex={-1} className="font-naskh text-[1.6rem] font-bold leading-snug text-ink outline-none md:text-[1.85rem]">
              {axisInfo?.nameAr}
            </h2>
            {axisInfo?.description ? <p className="mt-1 text-muted">{axisInfo.description}</p> : null}
            {step === "P" && prefilled.size ? (
              <p className="mt-3 rounded-md bg-info-soft px-3 py-2 text-[14px] text-info">عبّأنا بعض الإجابات من ملف الوقف في المنصة. راجعها وغيّر ما لا يطابق الواقع.</p>
            ) : null}
          </header>
          <div className="space-y-4">
            {stepQuestions.map((q, i) => (
              <QuestionField key={q.code} q={q} n={questionOffset + i + 1} value={answers[q.code]} onChange={(v) => setAnswer(q.code, v)} prefilled={prefilled.has(q.code)} />
            ))}
          </div>
        </section>
      ) : (
        <ReviewStep steps={steps} axes={axes} visible={visible} answers={answers} onJump={go} headingRef={headingRef} depth={depth} />
      )}

      {stepError ? <p role="alert" className="mt-4 rounded-md bg-critical-soft px-3 py-2 text-[15px] text-critical">{stepError}</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-md bg-critical-soft px-3 py-2 text-[15px] text-critical">{error}</p> : null}

      {/* sticky nav bar (mobile) / inline (desktop) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mt-8 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button type="button" onClick={back} disabled={stepIndex === 0 || submitting} className={buttonClass("secondary", "lg", "px-4")}>
            <ArrowRight aria-hidden className="size-4" />
            السابق
          </button>
          <SaveIndicator state={saveState} />
          {isReview ? (
            <button type="button" onClick={submit} disabled={submitting} aria-busy={submitting} className={buttonClass("primary", "lg", "ms-auto flex-1 md:flex-none")}>
              {submitting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
              {submitting ? "نحسب النتيجة…" : "احسب النتيجة"}
            </button>
          ) : (
            <button type="button" onClick={next} className={buttonClass("primary", "lg", "ms-auto flex-1 md:flex-none")}>
              {steps[stepIndex + 1] === "review" ? "راجع قبل الحساب" : "التالي"}
              <ArrowLeft aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span aria-live="polite" className="hidden min-w-0 items-center gap-1.5 text-[13px] text-muted sm:inline-flex">
      {state === "saving" ? (
        <>
          <Loader2 aria-hidden className="size-3.5 animate-spin" /> جارٍ الحفظ…
        </>
      ) : state === "saved" ? (
        <>
          <Check aria-hidden className="size-3.5 text-ok" /> حُفظت إجاباتك تلقائيًا
        </>
      ) : state === "error" ? (
        <>
          <CloudOff aria-hidden className="size-3.5 text-critical" /> لم يُحفظ
        </>
      ) : (
        "تُحفظ إجاباتك تلقائيًا"
      )}
    </span>
  );
}

function QuestionField({ q, n, value, onChange, prefilled }: { q: RunnerQuestion; n: number; value: unknown; onChange: (v: unknown) => void; prefilled: boolean }) {
  const opts = optionsFor(q);
  const main = opts.filter((o) => !o.unknown && !o.na);
  const extra = opts.filter((o) => o.unknown || o.na);
  const name = `q-${q.code}`;
  const answered = isAnswered(value);

  return (
    <fieldset id={name} className={cn("scroll-mt-24 rounded-lg border bg-surface p-4 md:p-5", answered ? "border-line" : "border-line-strong")}>
      <legend className="sr-only">{q.textAr}</legend>
      <div aria-hidden className="mb-3 flex gap-3">
        <span className="tabular mt-0.5 shrink-0 text-[13px] font-semibold text-muted">{n}</span>
        <p className="text-[16.5px] font-semibold leading-8 text-text">{q.textAr}</p>
      </div>
      {q.helpAr ? (
        <p className="mb-3 flex gap-2 text-[14px] leading-7 text-muted">
          <CircleHelp aria-hidden className="mt-1 size-4 shrink-0" />
          {q.helpAr}
        </p>
      ) : null}

      {q.answerType === "multiselect" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {main.map((o) => {
            const arr = Array.isArray(value) ? (value as string[]) : [];
            const checked = arr.includes(o.value);
            return (
              <label key={o.value} className={choiceClass(checked)}>
                <input
                  type="checkbox"
                  name={name}
                  value={o.value}
                  checked={checked}
                  onChange={(e) => onChange(e.target.checked ? [...arr, o.value] : arr.filter((x) => x !== o.value))}
                  className="size-5 shrink-0 accent-[var(--ink)]"
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      ) : q.answerType === "date" ? (
        <DateField name={name} value={value} onChange={onChange} />
      ) : q.answerType === "number" || q.answerType === "text" ? (
        <input
          type={q.answerType === "number" ? "number" : "text"}
          inputMode={q.answerType === "number" ? "decimal" : undefined}
          aria-label={q.textAr}
          defaultValue={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onBlur={(e) => onChange(e.target.value)}
          className="block h-12 w-full max-w-sm rounded-md border border-line-strong bg-surface px-3 text-[16px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
        />
      ) : (
        <div className={cn("grid gap-2", q.answerType === "maturity" ? "sm:grid-cols-2 lg:grid-cols-3" : main.length > 4 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4")}>
          {main.map((o) => (
            <Radio key={o.value} name={name} o={o} checked={String(value ?? "") === o.value} onChange={onChange} maturity={q.answerType === "maturity"} />
          ))}
        </div>
      )}
      {extra.length && q.answerType !== "date" ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {extra.map((o) => (
            <Radio key={o.value} name={name} o={o} checked={String(value ?? "") === o.value} onChange={onChange} subtle />
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
        {q.referenceText ? (
          <span className="inline-flex items-center gap-1">
            <BookMarked aria-hidden className="size-3.5" />
            <span>المرجع: {q.referenceText}</span>
          </span>
        ) : null}
        {prefilled ? <span className="text-info">من ملف الوقف</span> : null}
      </div>
    </fieldset>
  );
}

const choiceClass = (checked: boolean, subtle = false) =>
  cn(
    "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-[15.5px] leading-6 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]",
    checked ? "border-ink bg-ink-soft text-ink font-medium" : subtle ? "border-dashed border-line-strong text-muted hover:bg-surface-2" : "border-line-strong hover:bg-surface-2",
  );

function Radio({ name, o, checked, onChange, maturity, subtle }: { name: string; o: Option; checked: boolean; onChange: (v: unknown) => void; maturity?: boolean; subtle?: boolean }) {
  return (
    <label className={cn(choiceClass(checked, subtle), subtle && "min-h-11 py-1.5")}>
      <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="size-5 shrink-0 accent-[var(--ink)]" />
      {maturity && o.score !== undefined && o.score !== null ? <span className="tabular w-4 shrink-0 text-[13px] font-semibold text-muted">{o.score}</span> : null}
      <span>{o.label}</span>
    </label>
  );
}

function DateField({ name, value, onChange }: { name: string; value: unknown; onChange: (v: unknown) => void }) {
  const unknown = value === "unknown";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="date"
        aria-label="التاريخ الميلادي"
        disabled={unknown}
        value={typeof value === "string" && value !== "unknown" ? value : ""}
        max="2100-12-31"
        onChange={(e) => onChange(e.target.value || null)}
        className="h-12 rounded-md border border-line-strong bg-surface px-3 text-[16px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20 disabled:opacity-50"
      />
      <label className={cn(choiceClass(unknown, true), "min-h-11")}>
        <input type="checkbox" name={`${name}-unknown`} checked={unknown} onChange={(e) => onChange(e.target.checked ? "unknown" : null)} className="size-5 accent-[var(--ink)]" />
        <span>لا أعلم</span>
      </label>
    </div>
  );
}

function ReviewStep({ steps, axes, visible, answers, onJump, headingRef, depth }: {
  steps: string[]; axes: RunnerAxis[]; visible: Question[]; answers: Record<string, unknown>; onJump: (s: string) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>; depth: "basic" | "deep";
}) {
  const rows = steps.filter((s) => s !== "review").map((s) => {
    const qs = visible.filter((q) => q.axisCode === s && q.answerType !== "text");
    const answered = qs.filter((q) => isAnswered(answers[q.code])).length;
    const unknown = qs.filter((q) => answers[q.code] === "unknown").length;
    return { s, name: s === "P" ? "ملف الوقف" : axes.find((a) => a.code === s)?.nameAr ?? s, total: qs.length, answered, unknown };
  });
  const missing = rows.reduce((a, r) => a + (r.total - r.answered), 0);
  const unknown = rows.reduce((a, r) => a + r.unknown, 0);
  return (
    <section aria-labelledby="step-title" className="fade-in">
      <h2 id="step-title" ref={headingRef} tabIndex={-1} className="font-naskh text-[1.75rem] font-bold text-ink outline-none">راجع إجاباتك قبل الحساب</h2>
      <p className="mt-1 text-muted">يمكنك العودة إلى أي محور وتعديله. بعد الحساب تُثبَّت الإجابات ويُحفظ التقييم في سجل الوقف.</p>
      <ul className="mt-5 divide-y divide-line rounded-lg border border-line bg-surface">
        {rows.map((r) => (
          <li key={r.s} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 font-medium">{r.name}</span>
            <span className={cn("tabular text-sm", r.answered < r.total ? "text-fine" : "text-ok")}>
              {r.answered} / {r.total}
              {r.unknown ? <span className="text-muted"> — «لا أعلم»: {r.unknown}</span> : null}
            </span>
            <button type="button" onClick={() => onJump(r.s)} className={buttonClass("ghost", "sm")}>
              عدّل
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-2 text-[15px]">
        {missing > 0 ? <p className="rounded-md bg-fine-soft px-3 py-2 text-fine">لم تُجب عن {missing} سؤالًا. ستُستبعد من الحساب وتنخفض ثقة النتيجة.</p> : <p className="rounded-md bg-ok-soft px-3 py-2 text-ok">أجبت عن كل الأسئلة المنطبقة.</p>}
        {unknown > 0 ? <p className="text-muted">إجابات «لا أعلم» ({unknown}) تُحسب صفرًا وتظهر في النتيجة فجواتٍ معرفية تستحق التحقق.</p> : null}
        {depth === "deep" ? <p className="text-muted">هذا تقييم معمّق: بعد الحساب يصل إلى مختص في وقفك ليراجعه ويضيف ملاحظاته.</p> : null}
      </div>
    </section>
  );
}
