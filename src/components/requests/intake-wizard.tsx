"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ContextBlocksView } from "@/components/requests/context-blocks";
import type { ContextBlock } from "@/server/modules/requests/context/types";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, FileText, Paperclip, Save, X } from "lucide-react";
import { Badge, Button, ProgressBar } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { DocumentUploader } from "@/components/documents/uploader";
import { cn, initialState, type ActionState } from "@/lib/utils";
import {
  cellVisible, checkIntake, columnOptions, docRequired, fieldRequired, intakeNeeds, intakeProgress, summarize, tableRows, validateStep, visibleDocs, visibleFields, visibleSteps,
  type Answers, type AnswerValue, type Column, type DocMap, type Field, type ServiceForm, type TableRow,
} from "@/server/modules/requests/intake/engine";

const OFFLINE = "تعذّر الحفظ: لم يصل الطلب إلى الخادم. تحقق من اتصالك بالإنترنت ثم أعد المحاولة؛ إجاباتك ما زالت في هذه الصفحة ولم يُحفظ منها شيء بعد.";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;
export type DocOption = { id: string; title: string; docType: string; source: "request" | "waqf" };

const clean = (e: Record<string, string | undefined>) => Object.fromEntries(Object.entries(e).filter((x): x is [string, string] => !!x[1]));

const inputCls =
  "block w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] text-text placeholder:text-muted/70 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20 aria-[invalid=true]:border-critical";

export function FieldInput({ f, value, onChange, error, required, answers }: { f: Field; value: AnswerValue | undefined; onChange: (v: AnswerValue | undefined) => void; error?: string; required: boolean; answers?: Answers }) {
  const id = `q-${f.key}`;
  const describedBy = error ? `${id}-error` : f.hint ? `${id}-hint` : undefined;
  const common = { id, "aria-invalid": !!error, "aria-describedby": describedBy, "aria-required": required };
  const s = Array.isArray(value) ? "" : value ?? "";
  const label = (
    <>
      {f.label}
      {required ? <span aria-hidden className="text-critical"> *</span> : null}
    </>
  );
  if (f.type === "hidden") return null;
  let control;
  switch (f.type) {
    case "textarea":
      control = <textarea {...common} value={s} maxLength={f.maxLength ?? 4000} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "min-h-28 py-2 leading-7")} />;
      break;
    case "select":
      control = (
        <select {...common} value={s} onChange={(e) => onChange(e.target.value || undefined)} className={cn(inputCls, "h-11")}>
          <option value="">اختر…</option>
          {f.options?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      );
      break;
    case "radio":
    case "yesno": {
      const opts = f.type === "yesno" ? ([["yes", "نعم"], ["no", "لا"]] as const) : f.options ?? [];
      return (
        <fieldset className={cn("space-y-2", f.wide && "sm:col-span-2")} aria-describedby={describedBy} aria-invalid={!!error}>
          <legend className="mb-1.5 text-[15px] font-medium">{label}</legend>
          <div className={cn("flex flex-wrap gap-2", f.type === "radio" && opts.length > 3 && "flex-col")}>
            {opts.map(([k, l]) => (
              <label key={k} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[15px]", s === k ? "border-ink bg-ink-soft" : "border-line-strong bg-surface hover:bg-surface-2")}>
                <input type="radio" name={id} value={k} checked={s === k} onChange={() => onChange(k)} className="size-4 accent-[var(--ink)]" />
                {l}
              </label>
            ))}
          </div>
          {f.hint && !error ? <p id={`${id}-hint`} className="text-[13px] text-muted">{f.hint}</p> : null}
          {error ? <p id={`${id}-error`} className="text-[13px] font-medium text-critical">{error}</p> : null}
        </fieldset>
      );
    }
    case "checkboxes": {
      const arr = Array.isArray(value) ? value : [];
      return (
        <fieldset className="space-y-2 sm:col-span-2" aria-describedby={describedBy} aria-invalid={!!error}>
          <legend className="mb-1.5 text-[15px] font-medium">{label}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {f.options?.map(([k, l]) => (
              <label key={k} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[15px]", arr.includes(k) ? "border-ink bg-ink-soft" : "border-line-strong bg-surface hover:bg-surface-2")}>
                <input type="checkbox" checked={arr.includes(k)} onChange={(e) => onChange(e.target.checked ? [...arr, k] : arr.filter((x) => x !== k))} className="size-4 accent-[var(--ink)]" />
                {l}
              </label>
            ))}
          </div>
          {f.hint && !error ? <p id={`${id}-hint`} className="text-[13px] text-muted">{f.hint}</p> : null}
          {error ? <p id={`${id}-error`} className="text-[13px] font-medium text-critical">{error}</p> : null}
        </fieldset>
      );
    }
    case "table":
      return (
        <fieldset className="space-y-2 sm:col-span-2" aria-describedby={describedBy} aria-invalid={!!error} data-testid={`table-${f.key}`}>
          <legend className="mb-1.5 text-[15px] font-medium">{label}</legend>
          <TableInput f={f} value={value} onChange={onChange} answers={answers ?? {}} />
          {f.hint && !error ? <p id={`${id}-hint`} className="text-[13px] text-muted">{f.hint}</p> : null}
          {error ? <p id={`${id}-error`} className="text-[13px] font-medium text-critical">{error}</p> : null}
        </fieldset>
      );
    case "ack":
      return (
        <div className="space-y-1 sm:col-span-2">
          <label className="flex items-start gap-3 rounded-md border border-line bg-surface-2 p-3 text-[15px] leading-7">
            <input {...common} type="checkbox" checked={s === "yes"} onChange={(e) => onChange(e.target.checked ? "yes" : undefined)} className="mt-1.5 size-4 accent-[var(--ink)]" />
            <span>{f.label}</span>
          </label>
          {error ? <p id={`${id}-error`} className="text-[13px] font-medium text-critical">{error}</p> : null}
        </div>
      );
    default: {
      const type = f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text";
      const numeric = ["number", "money", "percent", "idnumber", "phone"].includes(f.type);
      control = (
        <input {...common} type={type} value={s} inputMode={f.type === "money" || f.type === "percent" ? "decimal" : numeric ? "numeric" : undefined}
          dir={numeric || type === "email" || type === "date" ? "ltr" : undefined} maxLength={f.maxLength ?? 300}
          onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "h-11", numeric && "tabular text-start")} />
      );
    }
  }
  return (
    <div className={cn("space-y-1.5", f.wide && "sm:col-span-2")}>
      <label htmlFor={id} className="block text-[15px] font-medium">{label}</label>
      {control}
      {f.hint && !error ? <p id={`${id}-hint`} className="text-[13px] text-muted">{f.hint}</p> : null}
      {error ? <p id={`${id}-error`} className="text-[13px] font-medium text-critical">{error}</p> : null}
    </div>
  );
}

/** Repeating rows: each row is a small card of cells (works on phones), with add and remove. */
function TableInput({ f, value, onChange, answers }: { f: Field; value: AnswerValue | undefined; onChange: (v: AnswerValue | undefined) => void; answers: Answers }) {
  const rows = tableRows(value);
  const cols = f.columns ?? [];
  const max = f.maxRows ?? 30;
  const set = (next: TableRow[]) => onChange(next.length ? JSON.stringify(next) : undefined);
  const setCell = (i: number, c: Column, v: string) => set(rows.map((r, j) => (j === i ? { ...r, [c.key]: v } : r)));
  const list = rows.length ? rows : [];
  return (
    <div className="space-y-2">
      {list.map((r, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface-2/40 p-3" data-testid={`row-${f.key}-${i}`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-muted">{i + 1}{r.src?.startsWith("file:") ? <span className="ms-2 rounded bg-ink-soft px-1.5 py-0.5 text-[12px] text-ink" data-testid="row-from-file">من ملف الوقف — صحّح ما يلزم</span> : null}</span>
            <button type="button" onClick={() => set(rows.filter((_, j) => j !== i))} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-critical hover:bg-critical-soft">
              <X aria-hidden className="size-3.5" />احذف الصف
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {cols.filter((c) => c.type !== "hidden" && cellVisible(c, r)).map((c) => {
              const cid = `q-${f.key}-${i}-${c.key}`;
              const v = r[c.key] ?? "";
              const numeric = ["number", "money", "percent", "idnumber"].includes(c.type);
              return (
                <div key={c.key} className="space-y-1">
                  <label htmlFor={cid} className="block text-[14px]">{c.label}{c.required ? <span aria-hidden className="text-critical"> *</span> : null}</label>
                  {c.type === "select" ? (
                    <select id={cid} value={v} onChange={(e) => setCell(i, c, e.target.value)} className={cn(inputCls, "h-10")}>
                      <option value="">اختر…</option>
                      {columnOptions(c, answers).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  ) : (
                    <input id={cid} type={c.type === "date" ? "date" : "text"} value={v} inputMode={numeric ? "decimal" : undefined} dir={numeric || c.type === "date" ? "ltr" : undefined}
                      maxLength={300} onChange={(e) => setCell(i, c, e.target.value)} className={cn(inputCls, "h-10", numeric && "tabular text-start")} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {rows.length < max ? (
        <button type="button" onClick={() => set([...rows, {}])} className="inline-flex h-10 items-center rounded-md border border-dashed border-line-strong px-3 text-[14px] text-ink hover:bg-ink-soft">
          أضف صفًا{rows.length ? "" : ` — ${f.label}`}
        </button>
      ) : null}
    </div>
  );
}

export function IntakeWizard({ requestId, form, initialAnswers, docMap, docOptions, waqfId, save, attach, submit, discard, contextBlocks = [] }: {
  requestId: string;
  /** Waqf-file records the service reads, shown in the «بيانات الوقف المسجلة» step for confirmation. */
  contextBlocks?: ContextBlock[];
  form: ServiceForm;
  initialAnswers: Answers;
  docMap: DocMap;
  docOptions: DocOption[];
  waqfId: string | null;
  save: Act;
  attach: Act;
  submit: Act;
  discard: Act;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stepKey, setStepKey] = useState<string>(() => visibleSteps(form, initialAnswers)[0]?.key ?? "review");
  const [dirty, setDirty] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [docMsg, setDocMsg] = useState<ActionState>(initialState);
  const [busy, startTransition] = useTransition();
  // Server-side validation on submit: show its errors and jump to the first step that needs attention.
  const [sub, doSubmit] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r: ActionState = await submit(prev, fd).catch(() => ({ error: OFFLINE }));
    if (r.error) {
      if (r.fieldErrors) setErrors(clean(r.fieldErrors));
      const first = r.data?.firstStep as string | undefined;
      if (first) setStepKey(first);
    }
    return r;
  }, initialState);
  const [disc, doDiscard] = useActionState(discard, initialState);
  const topRef = useRef<HTMLDivElement>(null);

  const steps = visibleSteps(form, answers);
  const docs = visibleDocs(form, answers);
  const order = [...steps.map((s) => ({ key: s.key, title: s.title })), ...(docs.length ? [{ key: "documents", title: "المستندات" }] : []), { key: "review", title: "المراجعة والإرسال" }];
  const idx = Math.max(0, order.findIndex((o) => o.key === stepKey));
  const current = order[idx];
  const step = steps.find((s) => s.key === current.key);
  const progress = intakeProgress(form, answers, docMap);
  const check = useMemo(() => checkIntake(form, answers, docMap), [form, answers, docMap]);
  const needs = useMemo(() => intakeNeeds(form, answers, docMap), [form, answers, docMap]);
  // A completeness error from the last submit is stale once the gaps are filled.
  const staleSubmit = !!sub.data?.formSteps && check.fieldsComplete && check.docsComplete;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);


  // A change that hides answered questions (e.g. switching a will to «pure» hides the waqf's terms) is confirmed
  // first, listing what will no longer apply; nothing is dropped silently.
  const [pending, setPending] = useState<{ k: string; v: AnswerValue | undefined; lost: string[] } | null>(null);
  const answered = (a: Answers) => new Set(visibleSteps(form, a).flatMap((st) => visibleFields(st, a)).filter((f) => { const x = a[f.key]; return x !== undefined && x !== "" && !(Array.isArray(x) && !x.length); }).map((f) => f.key));
  const setValue = (k: string, v: AnswerValue | undefined) => {
    const before = answered(answers);
    const next = { ...answers };
    if (v === undefined || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v;
    const nowVisible = new Set(visibleSteps(form, next).flatMap((st) => visibleFields(st, next)).map((f) => f.key));
    const lost = [...before].filter((x) => x !== k && !nowVisible.has(x));
    if (lost.length && !pending) {
      const label = (key: string) => form.steps.flatMap((st) => st.fields).find((f) => f.key === key)?.label ?? key;
      setPending({ k, v, lost: lost.map(label) });
      return;
    }
    apply(k, v);
  };
  const apply = (k: string, v: AnswerValue | undefined) => {
    setAnswers((a) => {
      const n = { ...a };
      if (v === undefined || (Array.isArray(v) && !v.length)) delete n[k];
      else n[k] = v;
      return n;
    });
    setErrors((e) => {
      if (!e[k]) return e;
      const n = { ...e };
      delete n[k];
      return n;
    });
    setDirty(true);
  };

  function persist(stepToValidate?: string, then?: () => void) {
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("answers", JSON.stringify(answers));
    if (stepToValidate) fd.set("step", stepToValidate);
    startTransition(async () => {
      // A lost connection rejects the call: keep the answers on screen and say what happened instead of failing the page.
      const r = await save(initialState, fd).catch(() => null);
      if (!r) {
        setSaveErr(OFFLINE);
        return;
      }
      if (r.fieldErrors && Object.keys(r.fieldErrors).length) {
        setErrors(clean(r.fieldErrors));
        setSaveErr(r.error ?? null);
        return;
      }
      if (r.error) {
        setSaveErr(r.error);
        return;
      }
      setSaveErr(null);
      setDirty(false);
      setSavedMsg(`حُفظت المسودة ${new Intl.DateTimeFormat("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
      then?.();
    });
  }

  const go = (key: string) => {
    setStepKey(key);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  function next() {
    if (step) {
      const e = validateStep(step, answers);
      if (Object.keys(e).length) {
        setErrors(e);
        const first = visibleFields(step, answers).find((f) => e[f.key]);
        if (first) document.getElementById(`q-${first.key}`)?.focus();
        return;
      }
      persist(step.key, () => go(order[idx + 1].key));
      return;
    }
    go(order[idx + 1].key);
  }
  function back() {
    if (dirty) persist();
    go(order[idx - 1].key);
  }

  function docAction(slot: string, documentId: string, mode: "add" | "remove") {
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("slot", slot);
    fd.set("documentId", documentId);
    fd.set("mode", mode);
    startTransition(async () => {
      const r = await attach(initialState, fd).catch(() => null);
      setDocMsg(r ?? { ...initialState, error: OFFLINE });
      if (r) router.refresh();
    });
  }

  const titleOf = (id: string) => docOptions.find((d) => d.id === id)?.title ?? "وثيقة";

  return (
    <div ref={topRef} className="scroll-mt-20 space-y-5">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
          <p className="font-medium">الخطوة {idx + 1} من {order.length}: {current.title}</p>
          <p className="text-muted" aria-live="polite">{busy ? "جارٍ الحفظ…" : savedMsg ?? (dirty ? "تعديلات غير محفوظة" : "")}</p>
        </div>
        <ProgressBar value={progress} label={`اكتمال الطلب ${progress}٪`} tone={progress === 100 ? "ok" : "ink"} />
        <ol className="flex flex-wrap gap-1.5" aria-label="خطوات النموذج">
          {order.map((o, i) => (
            <li key={o.key}>
              <button type="button" onClick={() => { if (dirty) persist(); go(o.key); }} aria-current={i === idx ? "step" : undefined}
                className={cn("rounded-full border px-2.5 py-1 text-[13px]", i === idx ? "border-ink bg-ink text-white" : i < idx ? "border-ink/40 bg-ink-soft text-ink" : "border-line text-muted hover:bg-surface-2")}>
                {i + 1}. {o.title}
              </button>
            </li>
          ))}
        </ol>
      </div>

      {saveErr ? <p role="alert" className="rounded-md bg-critical-soft px-3 py-2 text-[15px] text-critical">{saveErr}</p> : null}
      {sub.error && !staleSubmit && current.key !== "review" ? <FormMessage state={sub} /> : null}

      {/* Question steps */}
      {step ? (
        <section aria-labelledby="step-title" className="space-y-4">
          <h2 id="step-title" className="text-lg font-semibold">{step.title}</h2>
          {step.intro ? <p className="text-[15px] text-muted">{step.intro}</p> : null}
          {step.contextBlocks ? <ContextBlocksView blocks={contextBlocks} waqfId={waqfId} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {pending ? (
              <div role="alertdialog" aria-labelledby="change-title" className="rounded-lg border border-warn/50 bg-warn-soft p-4 sm:col-span-2" data-testid="confirm-change">
                <p id="change-title" className="font-semibold">هذا التغيير يجعل إجابات سابقة غير منطبقة</p>
                <p className="mt-1 text-[14px]">لن تُستخدم الإجابات التالية بعد التغيير، وتُحفظ قيمها في سجل الطلب: {pending.lost.join("، ")}.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => { const p = pending; setPending(null); apply(p.k, p.v); }}>أؤكد التغيير</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setPending(null)}>تراجع</Button>
                </div>
              </div>
            ) : null}
            {visibleFields(step, answers).map((f) => (
              <FieldInput key={f.key} f={f} value={answers[f.key]} onChange={(v) => setValue(f.key, v)} error={errors[f.key]} required={fieldRequired(f, answers)} answers={answers} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Documents */}
      {current.key === "documents" ? (
        <section aria-labelledby="docs-title" className="space-y-4">
          <h2 id="docs-title" className="text-lg font-semibold">المستندات</h2>
          <p className="text-[15px] text-muted">ارفع كل مستند في خانته، أو اختره من وثائق {waqfId ? "الوقف أو " : ""}هذا الطلب إن كان مرفوعًا من قبل. تُحفظ الملفات مشفّرة ولا يراها إلا أطراف الطلب.</p>
          <FormMessage state={docMsg} />
          <ul className="space-y-3">
            {docs.map((slot) => {
              const attached = docMap[slot.key] ?? [];
              const req = docRequired(slot, answers);
              const choices = docOptions.filter((d) => !attached.includes(d.id) && (d.docType === slot.docType || d.source === "request"));
              return (
                <li key={slot.key} className={cn("rounded-lg border p-3", req && !attached.length ? "border-fine/50 bg-fine-soft/30" : "border-line bg-surface")} data-testid={`slot-${slot.key}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{slot.label}</p>
                    {attached.length ? <Badge tone="ok" icon={false}>أُرفق</Badge> : req ? <Badge tone="fine" icon={false}>مطلوب</Badge> : <Badge tone="neutral" icon={false}>اختياري</Badge>}
                  </div>
                  {slot.hint ? <p className="mt-1 text-[13px] text-muted">{slot.hint}</p> : null}
                  {attached.length ? (
                    <ul className="mt-2 space-y-1">
                      {attached.map((id) => (
                        <li key={id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1.5 text-[14px]">
                          <span className="flex min-w-0 items-center gap-2"><FileText aria-hidden className="size-4 shrink-0 text-muted" /><span className="truncate">{titleOf(id)}</span></span>
                          <button type="button" onClick={() => docAction(slot.key, id, "remove")} className="rounded p-1 text-muted hover:bg-critical-soft hover:text-critical" aria-label={`أزل ${titleOf(id)} من «${slot.label}»`}>
                            <X aria-hidden className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    <DocumentUploader requestId={requestId} waqfId={waqfId} docType={slot.docType} defaultTitle={slot.label} compact
                      onUploaded={(d) => docAction(slot.key, d.id, "add")} />
                    {choices.length ? (
                      <ExistingPicker options={choices} onPick={(id) => docAction(slot.key, id, "add")} label={slot.label} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Review */}
      {current.key === "review" ? (
        <section aria-labelledby="review-title" className="space-y-4">
          <h2 id="review-title" className="text-lg font-semibold">راجع طلبك قبل الإرسال</h2>
          {check.fieldsComplete && check.docsComplete ? (
            <p className="flex items-center gap-2 rounded-md bg-ok-soft px-3 py-2 text-[15px] text-ok"><CheckCircle2 aria-hidden className="size-4" />البيانات والمستندات المطلوبة مكتملة.</p>
          ) : (
            <div role="status" className="rounded-md border border-fine/40 bg-fine-soft/40 p-3 text-[15px]">
              <p className="font-medium">قبل الإرسال أكمل ما يلي:</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-5">
                {Object.entries(check.errors).slice(0, 8).map(([k, v]) => <li key={k}>{v}</li>)}
                {check.missingDocs.map((m) => <li key={m.key}>مستند مطلوب: {m.label}</li>)}
              </ul>
              {check.firstStep || check.missingDocs.length ? (
                <button type="button" onClick={() => go(check.firstStep ?? "documents")} className="mt-2 text-ink underline-offset-4 hover:underline">انتقل إلى أول نقص</button>
              ) : null}
            </div>
          )}
          <NeedsSummary needs={needs} go={go} />
          {summarize(form, answers).map((sec) => (
            <div key={sec.key} className="rounded-lg border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <h3 className="font-semibold">{sec.title}</h3>
                <button type="button" onClick={() => go(sec.key)} className="text-[14px] text-ink hover:underline">تعديل</button>
              </div>
              <dl className="grid gap-x-4 gap-y-2 p-3 text-[15px] sm:grid-cols-[minmax(0,14rem)_1fr]">
                {sec.rows.map((r) => (
                  <div key={r.key} className="contents">
                    <dt className="text-muted">{r.label}</dt>
                    <dd className={cn("whitespace-pre-line break-words", errors[r.key] && "text-critical")}>{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {docs.length ? (
            <div className="rounded-lg border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <h3 className="font-semibold">المستندات</h3>
                <button type="button" onClick={() => go("documents")} className="text-[14px] text-ink hover:underline">تعديل</button>
              </div>
              <ul className="space-y-1 p-3 text-[15px]">
                {docs.map((s) => (
                  <li key={s.key} className="flex flex-wrap items-center gap-2">
                    <Paperclip aria-hidden className="size-4 text-muted" />
                    <span>{s.label}:</span>
                    <span className={cn(!(docMap[s.key]?.length) && docRequired(s, answers) ? "text-critical" : "text-muted")}>
                      {docMap[s.key]?.length ? docMap[s.key].map(titleOf).join("، ") : docRequired(s, answers) ? "لم يُرفق (مطلوب)" : "لم يُرفق"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <form action={doSubmit} className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
            <input type="hidden" name="id" value={requestId} />
            <input type="hidden" name="answers" value={JSON.stringify(answers)} />
            <label className="flex items-start gap-3 text-[15px] leading-7">
              <input type="checkbox" name="confirm" required className="mt-1.5 size-4 accent-[var(--ink)]" />
              <span>أقر بأن البيانات والمستندات المرفقة صحيحة، وأنني مخوّل بتقديم هذا الطلب بالصفة المذكورة.</span>
            </label>
            {!staleSubmit ? <FormMessage state={sub} /> : null}
            <SubmitButton size="lg" pendingText="جارٍ الإرسال…" disabled={busy}>أرسل الطلب</SubmitButton>
          </form>
        </section>
      ) : null}

      {/* Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex flex-wrap gap-2">
          {idx > 0 ? (
            <Button type="button" variant="secondary" onClick={back} disabled={busy}><ChevronRight aria-hidden className="size-4" />السابق</Button>
          ) : null}
          {idx < order.length - 1 ? (
            <Button type="button" onClick={next} disabled={busy}>التالي<ChevronLeft aria-hidden className="size-4" /></Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => persist()} disabled={busy}><Save aria-hidden className="size-4" />احفظ المسودة</Button>
          <form action={doDiscard} onSubmit={(e) => { if (!confirm("إلغاء المسودة؟ لن يُرسل الطلب، ويبقى في طلباتك ملغى.")) e.preventDefault(); }}>
            <input type="hidden" name="id" value={requestId} />
            <SubmitButton variant="ghost" size="md" pendingText="جارٍ الإلغاء…" className="text-critical">ألغِ المسودة</SubmitButton>
          </form>
        </div>
      </div>
      {disc.error ? <FormMessage state={disc} /> : null}
    </div>
  );
}

function ExistingPicker({ options, onPick, label }: { options: DocOption[]; onPick: (id: string) => void; label: string }) {
  const [v, setV] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 space-y-1">
        <span className="text-[13px] text-muted">أو اختر وثيقة مرفوعة</span>
        <select value={v} onChange={(e) => setV(e.target.value)} className={cn(inputCls, "h-10")} aria-label={`اختر وثيقة مرفوعة لخانة «${label}»`}>
          <option value="">اختر…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.title}{o.source === "waqf" ? " (من ملف الوقف)" : ""}</option>)}
        </select>
      </label>
      <Button type="button" variant="secondary" size="sm" disabled={!v} onClick={() => (onPick(v), setV(""))}>أرفق</Button>
    </div>
  );
}

const REVIEW_AR = { sharia: "شرعية", legal: "قانونية", financial: "مالية", technical: "فنية" } as const;

/**
 * Completeness against the service's requirements: what work cannot start without (the request can still be sent and
 * completed later), what only helps, and what a specialist will review before it is relied on.
 */
function NeedsSummary({ needs, go }: { needs: ReturnType<typeof intakeNeeds>; go: (k: string) => void }) {
  const item = (x: { key: string; label: string; kind: string; step: string | null; why: string | null }) => (
    <li key={x.key}>
      <button type="button" onClick={() => go(x.step ?? "documents")} className="text-start text-ink underline-offset-4 hover:underline">{x.kind === "doc" ? `مستند: ${x.label}` : x.label}</button>
      {x.why ? <span className="text-[13px] text-muted"> — {x.why}</span> : null}
    </li>
  );
  return (
    <div className="space-y-3 rounded-lg border border-line p-3 text-[15px]" data-testid="needs-summary">
      <p className="flex items-baseline justify-between gap-2"><span className="font-medium">اكتمال بيانات الطلب</span><span className="tabular font-semibold" data-testid="needs-percent">{needs.percent}%</span></p>
      {needs.start.length ? (
        <div data-testid="needs-start">
          <p className="font-medium text-fine">يمكنك الإرسال الآن، لكن لا يبدأ العمل قبل استكمال:</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">{needs.start.map(item)}</ul>
        </div>
      ) : null}
      {needs.support.length ? (
        <details data-testid="needs-support">
          <summary className="cursor-pointer text-muted">بيانات تساعد على جودة النتيجة ولا تمنع الإرسال ({needs.support.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">{needs.support.map(item)}</ul>
        </details>
      ) : null}
      {needs.specialist.length ? (
        <p className="text-[14px] text-muted" data-testid="needs-specialist">يراجع مختص قبل الاعتماد عليها: {needs.specialist.map((x) => `${x.label} (${REVIEW_AR[x.review]})`).join("، ")}.</p>
      ) : null}
    </div>
  );
}
