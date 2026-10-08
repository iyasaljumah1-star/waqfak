"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { Badge, ProgressBar } from "@/components/ui";
import { cn, daysAr, fmtDate, fmtHijri } from "@/lib/utils";
import {
  APPLIES_LABEL, classifyWaqf, DEADLINE_RULES, parseAmount, READINESS, readinessScore, registrationDeadline, SIZE_NAMES, SIZE_RULES, sizeClass, willThird,
  type DeadlineKind, type TypeInput,
} from "./logic";

// ───────────── shared bits ─────────────
function Choice<T extends string>({ legend, name, value, onChange, options, hint }: { legend: string; name: string; value: T | ""; onChange: (v: T) => void; options: { value: T; label: string; hint?: string }[]; hint?: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-[16.5px] font-semibold">{legend}</legend>
      {hint ? <p className="text-[14px] text-muted">{hint}</p> : null}
      <div className="grid gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
              value === o.value ? "border-ink bg-ink-soft" : "border-line-strong bg-surface hover:border-ink/60",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-1.5 size-4 accent-[var(--ink)]" />
            <span>
              <span className="block font-medium">{o.label}</span>
              {o.hint ? <span className="block text-[14px] leading-6 text-muted">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Result({ children, empty }: { children: ReactNode | null; empty: string }) {
  return (
    <section aria-labelledby="result-title" aria-live="polite" className="rounded-lg border border-line bg-surface-2 p-5 md:p-6">
      <h2 id="result-title" className="text-[14px] font-medium text-muted">النتيجة</h2>
      {children ?? <p className="mt-2 text-[15px] text-muted">{empty}</p>}
    </section>
  );
}

function AmountField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[15px] font-medium">{label}</label>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          dir="ltr"
          className="tabular block h-11 w-full rounded-md border border-line-strong bg-surface pe-3 ps-14 text-end text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
        />
        <span aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">ر.س</span>
      </div>
      {hint ? <p id={`${id}-hint`} className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

const nf = new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 0 });
const sar = (n: number) => `${nf.format(Math.round(n))} ر.س`;

// ───────────── 1) waqf type ─────────────
export function WaqfTypeTool() {
  const [s, set] = useState<TypeInput>({ recipients: "", qualifier: "", after: "" });
  const r = classifyWaqf(s);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Choice
          legend="على من يُصرف ريع الوقف؟"
          name="recipients"
          value={s.recipients}
          onChange={(v) => set({ recipients: v, qualifier: "", after: "" })}
          options={[
            { value: "public", label: "جهات بر عامة", hint: "المساجد، الفقراء، التعليم، السقيا، جمعية خيرية، ونحوها." },
            { value: "specific", label: "أشخاص معيّنون", hint: "نفسي، ذريتي، أقاربي، أو أشخاص بأسمائهم أو أوصافهم." },
            { value: "both", label: "الاثنان معًا", hint: "حصة للذرية أو لأشخاص، وحصة لجهة بر." },
          ]}
        />
        {s.recipients === "specific" ? (
          <Choice
            legend="هل استحقاقهم مقيد بوصف خيري؟"
            hint="مثل: «الفقراء والمحتاجون من ذريتي» بدل «ذريتي» مطلقًا."
            name="qualifier"
            value={s.qualifier}
            onChange={(v) => set({ ...s, qualifier: v, after: "" })}
            options={[
              { value: "yes", label: "نعم، بوصف كالفقر أو الحاجة" },
              { value: "no", label: "لا، يستحقون بالقرابة أو بالتعيين" },
            ]}
          />
        ) : null}
        {s.recipients === "specific" && s.qualifier === "no" ? (
          <Choice
            legend="إلى أين يصير الوقف إذا انقرض المستحقون؟"
            name="after"
            value={s.after}
            onChange={(v) => set({ ...s, after: v })}
            options={[
              { value: "charity", label: "إلى جهة بر حددتها" },
              { value: "none", label: "لم أحدد ذلك بعد" },
            ]}
          />
        ) : null}
      </div>
      <Result empty="أجب عن الأسئلة لتظهر النتيجة.">
        {r ? (
          <div className="fade-in mt-2">
            <p className="font-naskh text-[1.7rem] font-bold text-ink" data-testid="tool-result">{r.label}</p>
            <p className="mt-2 text-[15.5px] leading-8">{r.reason}</p>
            <ul className="mt-4 space-y-2 text-[15px] leading-7">
              {r.notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <CircleAlert aria-hidden className="mt-1.5 size-4 shrink-0 text-muted" />
                  {n}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Result>
    </div>
  );
}

// ───────────── 2) size ─────────────
export function WaqfSizeTool() {
  const [value, setValue] = useState("");
  const [direct, setDirect] = useState(false);
  const amount = parseAmount(value);
  const invalid = value.trim() !== "" && (amount === null || amount < 0);
  const cls = sizeClass(amount, direct);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="space-y-5">
        <AmountField id="total" label="إجمالي قيمة الأصول الموقوفة" value={value} onChange={setValue} hint="بحسب آخر تقييم معتمد، مثل 75000000." />
        {invalid ? <p role="alert" className="text-[13.5px] font-medium text-critical">اكتب القيمة أرقامًا فقط، مثل 75000000.</p> : null}
        <label className="flex items-start gap-3 text-[15px] leading-7">
          <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} className="mt-1.5 size-4 accent-[var(--ink)]" />
          <span>
            ينتفع الموقوف عليهم بالأصل نفسه مباشرة
            <span className="block text-[13.5px] text-muted">كوقف جهاز طبي أو مركز خدمات يستخدمه المستفيدون، لا يُدر غلة.</span>
          </span>
        </label>
      </div>
      <Result empty="أدخل القيمة لتظهر فئة الوقف ومتطلباتها.">
        {cls ? (
          <div className="fade-in mt-2">
            <p className="font-naskh text-[1.7rem] font-bold text-ink" data-testid="tool-result">{SIZE_NAMES[cls]}</p>
            {amount !== null && !direct ? <p className="text-[14px] text-muted">بقيمة أصول {sar(amount)}</p> : null}
            <table className="mt-4 w-full text-[14.5px]">
              <caption className="sr-only">المتطلبات بحسب الفئة</caption>
              <thead>
                <tr className="border-b border-line text-start text-[13px] text-muted">
                  <th scope="col" className="py-2 text-start font-medium">المتطلب</th>
                  <th scope="col" className="py-2 text-start font-medium">لوقفك</th>
                </tr>
              </thead>
              <tbody>
                {SIZE_RULES.map((r) => {
                  const a = r.applies[cls];
                  return (
                    <tr key={r.item} className="border-b border-line align-top">
                      <td className="py-2.5 pe-3">
                        {r.item} <span className="text-[12.5px] text-muted">({r.ref})</span>
                      </td>
                      <td className="py-2.5">
                        <Badge tone={a === "yes" || a === "special" ? "ink" : a === "cond" ? "warn" : "neutral"} icon={false}>{APPLIES_LABEL[a]}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[13.5px] leading-6 text-muted">
              «غير منصوص عليه» لا يعني الإعفاء من الممارسة الجيدة: نوصي بموازنة وسياسات لكل وقف أيًّا كان حجمه. وبقية الالتزامات (التسجيل، الصرف، السجلات، المستفيد الحقيقي) عامة لكل الأوقاف.
            </p>
          </div>
        ) : null}
      </Result>
    </div>
  );
}

// ───────────── 3) registration deadline ─────────────
export function RegistrationDeadlineTool({ holidays, today }: { holidays: { day: string; name: string }[]; today: string }) {
  const [kind, setKind] = useState<DeadlineKind>("register");
  const [date, setDate] = useState("");
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= "2015-01-01" && date <= "2035-12-31";
  const r = valid ? registrationDeadline(date, kind, holidays, today) : null;
  const known = holidays.length ? `${holidays[0].day.slice(0, 4)}–${holidays[holidays.length - 1].day.slice(0, 4)}` : null;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Choice
          legend="ماذا تريد أن تحسب؟"
          name="kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "register", label: "تسجيل وقف جديد", hint: "30 يوم عمل من توثيق الوقف." },
            { value: "update", label: "تحديث بيانات وقف مسجل", hint: "15 يوم عمل من التغير الجوهري أو انتهاء الشهادة." },
          ]}
        />
        <div className="space-y-1.5">
          <label htmlFor="trigger" className="block text-[15px] font-medium">{DEADLINE_RULES[kind].trigger}</label>
          <input
            id="trigger"
            type="date"
            value={date}
            min="2015-01-01"
            max="2035-12-31"
            onChange={(e) => setDate(e.target.value)}
            className="block h-11 w-full max-w-xs rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
          />
          {date && !valid ? <p role="alert" className="text-[13.5px] font-medium text-critical">اختر تاريخًا صحيحًا بين 2015 و2035.</p> : null}
        </div>
      </div>
      <Result empty="اختر التاريخ ليظهر آخر موعد.">
        {r ? (
          <div className="fade-in mt-2">
            <p className="text-[15px]">آخر موعد لـ{r.rule.label}:</p>
            <p className="mt-1 font-naskh text-[1.7rem] font-bold leading-tight text-ink" data-testid="tool-result">{fmtDate(r.due)}</p>
            <p className="text-[15px] text-muted">{fmtHijri(r.due)}</p>
            <div className="mt-4">
              {r.remaining < 0 ? (
                <Badge tone="critical">فات الموعد منذ {daysAr(-r.remaining)}</Badge>
              ) : r.remaining === 0 ? (
                <Badge tone="fine">الموعد اليوم</Badge>
              ) : (
                <Badge tone={r.businessLeft <= 5 ? "warn" : "ok"}>
                  باقٍ {daysAr(r.remaining)} ({r.businessLeft} يوم عمل)
                </Badge>
              )}
            </div>
            <ul className="mt-4 space-y-1.5 text-[14.5px] leading-7 text-muted">
              <li>{r.rule.days} يوم عمل تعادل هنا {daysAr(r.calendarDays)} تقويمية.</li>
              {r.skippedHolidays.length ? (
                <li>استُبعدت إجازات رسمية: {[...new Set(r.skippedHolidays.map((h) => h.name))].join("، ")}.</li>
              ) : null}
              <li>المرجع: {r.rule.ref}.</li>
              {r.remaining < 0 ? <li className="text-critical">التأخر في التسجيل أو التحديث مخالفة مصنفة في جدول المخالفات. بادر بالتسجيل الآن.</li> : null}
            </ul>
            {known ? <p className="mt-3 text-[12.5px] text-muted">الإجازات الرسمية المسجلة لدينا تغطي {known}.</p> : null}
          </div>
        ) : null}
      </Result>
    </div>
  );
}

// ───────────── 4) will third ─────────────
export function WillThirdTool() {
  const [v, setV] = useState({ estate: "", debts: "", expenses: "", waqf: "", other: "" });
  const [toHeir, setToHeir] = useState(false);
  const n = (s: string) => Math.max(0, parseAmount(s) ?? 0);
  const ready = parseAmount(v.estate) !== null && parseAmount(v.waqf) !== null;
  const r = ready ? willThird({ estate: n(v.estate), debts: n(v.debts), expenses: n(v.expenses), waqf: n(v.waqf), other: n(v.other), toHeir }) : null;
  const f = (k: keyof typeof v) => (x: string) => setV({ ...v, [k]: x });
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><AmountField id="estate" label="إجمالي الأموال المتوقعة في التركة" value={v.estate} onChange={f("estate")} hint="عقارات ونقود وأسهم وغيرها، بقيمة تقديرية." /></div>
        <AmountField id="debts" label="الديون" value={v.debts} onChange={f("debts")} />
        <AmountField id="expenses" label="نفقات التجهيز والدفن" value={v.expenses} onChange={f("expenses")} />
        <AmountField id="waqf" label="قيمة ما توصي بوقفه" value={v.waqf} onChange={f("waqf")} />
        <AmountField id="other" label="وصايا أخرى" value={v.other} onChange={f("other")} />
        <label className="flex items-start gap-3 text-[15px] leading-7 sm:col-span-2">
          <input type="checkbox" checked={toHeir} onChange={(e) => setToHeir(e.target.checked)} className="mt-1.5 size-4 accent-[var(--ink)]" />
          <span>في الوصية شيء لأحد الورثة</span>
        </label>
      </div>
      <Result empty="أدخل قيمة التركة وقيمة الوصية بالوقف لتظهر النتيجة.">
        {r ? (
          <div className="fade-in mt-2">
            {r.status === "no_estate" ? (
              <p className="font-naskh text-[1.5rem] font-bold text-critical" data-testid="tool-result">لا يبقى من التركة شيء بعد الديون</p>
            ) : r.status === "within" ? (
              <p className="flex items-center gap-2 font-naskh text-[1.6rem] font-bold text-ok" data-testid="tool-result">
                <CheckCircle2 aria-hidden className="size-6" />
                في حدود الثلث
              </p>
            ) : (
              <p className="flex items-center gap-2 font-naskh text-[1.6rem] font-bold text-fine" data-testid="tool-result">
                <AlertTriangle aria-hidden className="size-6" />
                تتجاوز الثلث بـ {sar(r.excess)}
              </p>
            )}
            <dl className="mt-4 divide-y divide-line border-y border-line text-[15px]">
              {[
                ["صافي التركة", sar(r.net)],
                ["الثلث", sar(r.third)],
                ["مجموع الوصايا", sar(r.total)],
                ["نسبة الوصايا من الصافي", r.net > 0 ? `${new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 1 }).format(r.ratio * 100)}٪` : "—"],
              ].map(([k, val]) => (
                <div key={k} className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">{k}</dt>
                  <dd className="tabular font-medium">{val}</dd>
                </div>
              ))}
            </dl>
            {r.status === "within" || r.status === "exceeds" ? (
              <div className="mt-4" aria-hidden>
                <div className="relative h-3 rounded-full bg-surface ring-1 ring-line">
                  <div className={cn("h-full rounded-full", r.status === "within" ? "bg-ok" : "bg-fine")} style={{ width: `${Math.min(100, r.ratio * 100)}%` }} />
                  <span className="absolute -top-1 h-5 w-0.5 bg-ink" style={{ insetInlineStart: "33.333%" }} />
                </div>
                <p className="mt-1 text-[12.5px] text-muted" style={{ paddingInlineStart: "calc(33.333% - 1.25rem)" }}>الثلث</p>
              </div>
            ) : null}
            <ul className="mt-4 space-y-2 text-[14.5px] leading-7">
              {r.status === "exceeds" ? <li>ما زاد على الثلث لا ينفذ إلا بإجازة الورثة البالغين الراشدين بعد الوفاة.</li> : null}
              {toHeir ? <li>الوصية لوارث لا تنفذ إلا بإجازة بقية الورثة، ولو كانت أقل من الثلث.</li> : null}
              <li className="text-muted">العبرة بقيمة التركة يوم الوفاة؛ فراجع وصيتك إذا تغيرت أموالك كثيرًا.</li>
            </ul>
          </div>
        ) : null}
      </Result>
    </div>
  );
}

// ───────────── 5) nazir readiness ─────────────
export function NazirReadinessTool() {
  const [size, setSize] = useState<"large" | "medium" | "small">("small");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const r = useMemo(() => readinessScore(size, checked), [size, checked]);
  const toggle = (k: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <div className="space-y-6">
        <Choice
          legend="حجم الوقف"
          name="size"
          value={size}
          onChange={setSize}
          options={[
            { value: "small", label: "صغير أو ذو انتفاع مباشر", hint: "أصول أقل من 50 مليون ريال." },
            { value: "medium", label: "متوسط", hint: "من 50 إلى أقل من 200 مليون ريال." },
            { value: "large", label: "كبير", hint: "200 مليون ريال فأكثر." },
          ]}
        />
        <fieldset>
          <legend className="mb-2 text-[16.5px] font-semibold">أشّر على ما أنجزته</legend>
          <ul className="divide-y divide-line border-y border-line">
            {READINESS.filter((i) => !i.sizes || i.sizes.includes(size)).map((i) => (
              <li key={i.key}>
                <label className="flex cursor-pointer items-start gap-3 py-3 text-[15px] leading-7">
                  <input type="checkbox" checked={checked.has(i.key)} onChange={() => toggle(i.key)} className="mt-1.5 size-4 shrink-0 accent-[var(--ink)]" />
                  <span className="flex-1">
                    {i.text}
                    <span className="ms-1 text-[12.5px] text-muted">({i.ref})</span>
                  </span>
                  {i.weight === 3 ? <span className="shrink-0 text-[12.5px] font-medium text-critical">جوهري</span> : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
      <div className="lg:sticky lg:top-24 lg:self-start">
        <Result empty="">
          <div className="mt-2">
            <p className="tabular font-naskh text-[2.4rem] font-bold leading-none text-ink" data-testid="tool-result">{r.score}٪</p>
            <div className="mt-2">
              <Badge tone={r.band.tone}>{r.band.label}</Badge>
            </div>
            <div className="mt-4">
              <ProgressBar value={r.score} tone={r.band.tone === "ok" ? "ok" : r.band.tone === "critical" ? "critical" : "fine"} label="درجة الجاهزية" />
            </div>
            {r.missing.length ? (
              <>
                <h3 className="mt-5 text-[15px] font-semibold">ابدأ بهذه</h3>
                <ol className="mt-2 list-decimal space-y-2 ps-5 text-[14.5px] leading-7">
                  {r.missing.slice(0, 4).map((m) => (
                    <li key={m.key}>
                      {m.text}
                      {m.service ? (
                        <>
                          {" "}
                          <Link href={`/services/${m.service}`} className="text-ink underline underline-offset-4">الخدمة المناسبة</Link>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="mt-4 text-[15px]">أنجزت كل البنود الأساسية. للتحقق الأعمق، جرّب التقييم الوقفي الكامل.</p>
            )}
            {r.criticalMissing.length ? (
              <p className="mt-4 text-[13.5px] leading-6 text-critical">ينقصك {r.criticalMissing.length} من البنود الجوهرية؛ تركها قد يترتب عليه جزاء أو عزل.</p>
            ) : null}
          </div>
        </Result>
      </div>
    </div>
  );
}
