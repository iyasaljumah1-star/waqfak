"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { FormMessage } from "@/components/ui/form";
import { bequestCheck, ESTATE_KIND_LABEL, type WillPlan } from "@/server/modules/wills/pure";
import { cn, initialState, type ActionState } from "@/lib/utils";
import { RowsEditor } from "./action-form";

const nf = new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 2 });
const input = "block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]";

/** Estate + bequest planner with a live one-third check. */
export function WillPlanner({ action, willId, plan }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; willId: string; plan: WillPlan }) {
  const [state, dispatch, pending] = useActionState(action, initialState);
  const [, start] = useTransition();
  const [estate, setEstate] = useState(plan.estate as unknown as Record<string, string>[]);
  const [v, setV] = useState({ debts: plan.debts, bequestMode: plan.bequestMode, bequestPct: plan.bequestPct, bequestAmount: plan.bequestAmount, bequestToHeir: plan.bequestToHeir });
  const c = bequestCheck({ ...v, estate: estate.map((e) => ({ kind: e.kind ?? "", description: e.description ?? "", value: e.value ?? "" })) });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => dispatch(fd));
  };
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" data-testid="will-form">
      <input type="hidden" name="willId" value={willId} />
      <section className="space-y-3">
        <h3 className="text-[15px] font-semibold">الموصي</h3>
        <label className="block max-w-md space-y-1.5 text-[15px]"><span className="block font-medium">الاسم كاملًا</span><input name="testatorName" defaultValue={plan.testatorName} maxLength={200} className={input} /></label>
      </section>

      <section className="space-y-3">
        <h3 className="text-[15px] font-semibold">التركة المتوقعة (تقديرًا)</h3>
        <RowsEditor
          prefix="e"
          addLabel="أضف بندًا"
          initial={estate}
          onChange={setEstate}
          fields={[
            { key: "kind", label: "النوع", type: "select", options: Object.entries(ESTATE_KIND_LABEL).map(([value, label]) => ({ value, label })) },
            { key: "description", label: "الوصف", width: "sm:col-span-2" },
            { key: "value", label: "القيمة (ريال)", type: "number" },
          ]}
        />
        <label className="block max-w-xs space-y-1.5 text-[15px]"><span className="block font-medium">الديون والالتزامات (ريال)</span><input name="debts" inputMode="decimal" dir="ltr" value={v.debts} onChange={(e) => setV({ ...v, debts: e.target.value })} className={cn(input, "text-start tabular")} /></label>
      </section>

      <section className="space-y-3">
        <h3 className="text-[15px] font-semibold">الوصية بالوقف</h3>
        <div className="flex flex-wrap gap-2">
          {(["pct", "amount"] as const).map((m) => (
            <label key={m} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[15px]", v.bequestMode === m ? "border-ink bg-ink-soft" : "border-line")}>
              <input type="radio" name="bequestMode" value={m} checked={v.bequestMode === m} onChange={() => setV({ ...v, bequestMode: m })} className="size-4 accent-[var(--ink)]" />
              {m === "pct" ? "نسبة من صافي التركة" : "مبلغ محدد"}
            </label>
          ))}
        </div>
        {v.bequestMode === "pct" ? (
          <label className="block max-w-xs space-y-1.5 text-[15px]"><span className="block font-medium">النسبة (%)</span><input name="bequestPct" inputMode="decimal" dir="ltr" value={v.bequestPct} onChange={(e) => setV({ ...v, bequestPct: e.target.value })} className={cn(input, "text-start tabular")} /></label>
        ) : (
          <label className="block max-w-xs space-y-1.5 text-[15px]"><span className="block font-medium">المبلغ (ريال)</span><input name="bequestAmount" inputMode="decimal" dir="ltr" value={v.bequestAmount} onChange={(e) => setV({ ...v, bequestAmount: e.target.value })} className={cn(input, "text-start tabular")} /></label>
        )}
        <input type="hidden" name={v.bequestMode === "pct" ? "bequestAmount" : "bequestPct"} value={v.bequestMode === "pct" ? v.bequestAmount : v.bequestPct} />
        <label className="flex items-start gap-3 text-[15px]"><input type="checkbox" name="bequestToHeir" checked={v.bequestToHeir === "on"} onChange={(e) => setV({ ...v, bequestToHeir: e.target.checked ? "on" : "off" })} className="mt-1.5 size-4 accent-[var(--ink)]" /> جزء من الوقف أو غلته لأحد الورثة</label>
      </section>

      <div aria-live="polite" className={cn("rounded-lg border p-4", c.needsHeirConsent ? "border-fine/40 bg-fine-soft" : "border-ok/40 bg-ok-soft")} data-testid="third-check">
        <dl className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-[13px] text-muted">إجمالي التركة</dt><dd className="tabular font-semibold">{nf.format(c.gross)} ريال</dd></div>
          <div><dt className="text-[13px] text-muted">الصافي بعد الديون</dt><dd className="tabular font-semibold">{nf.format(c.net)} ريال</dd></div>
          <div><dt className="text-[13px] text-muted">الثلث</dt><dd className="tabular font-semibold">{nf.format(c.third)} ريال</dd></div>
          <div><dt className="text-[13px] text-muted">الوصية بالوقف</dt><dd className={cn("tabular font-semibold", c.exceedsThird && "text-critical")}>{nf.format(c.bequest)} ريال ({nf.format(c.bequestPctOfNet)}%)</dd></div>
        </dl>
        <ul className="mt-3 list-disc space-y-1 ps-5 text-[14px] leading-7">
          {c.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>

      {c.needsHeirConsent ? (
        <section className="space-y-3">
          <h3 className="text-[15px] font-semibold">الورثة وإجازتهم</h3>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <label className="space-y-1.5 text-[15px]"><span className="block font-medium">عدد الورثة المتوقع</span><input name="heirsCount" inputMode="numeric" dir="ltr" defaultValue={plan.heirsCount} className={cn(input, "text-start tabular")} /></label>
            <label className="space-y-1.5 text-[15px]"><span className="block font-medium">ملاحظة عن الإجازة</span><input name="heirsConsentNote" defaultValue={plan.heirsConsentNote} maxLength={500} className={input} placeholder="الإجازة المعتبرة تكون بعد الوفاة من وارث بالغ رشيد" /></label>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-[15px] sm:col-span-2"><span className="block font-medium">مصرف الوقف</span><input name="masraf" defaultValue={plan.masraf} maxLength={300} className={input} placeholder="مثال: طلاب العلم الشرعي في مدينة الرياض" /></label>
        <label className="space-y-1.5 text-[15px]"><span className="block font-medium">الناظر على الوقف</span><input name="nazirName" defaultValue={plan.nazirName} maxLength={200} className={input} /></label>
        <label className="space-y-1.5 text-[15px]"><span className="block font-medium">الوصي المنفّذ</span><input name="executorName" defaultValue={plan.executorName} maxLength={200} className={input} /></label>
        <label className="space-y-1.5 text-[15px] sm:col-span-2"><span className="block font-medium">شروط أخرى</span><textarea name="conditions" defaultValue={plan.conditions} maxLength={1500} className="block min-h-20 w-full rounded-md border border-line-strong bg-surface px-3 py-2" /></label>
      </section>

      <FormMessage state={state} />
      <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
        احفظ وولّد مسودة الوصية
      </button>
    </form>
  );
}
