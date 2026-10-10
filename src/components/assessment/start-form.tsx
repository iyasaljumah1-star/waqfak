"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Gauge, Lock, Microscope } from "lucide-react";
import { startAssessment } from "@/server/modules/assessment/actions";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { cn, initialState } from "@/lib/utils";

type WaqfOpt = { id: string; name: string; number: string };

export function StartForm({ signedIn, waqfs, quickCount, deepCount, defaultKind, defaultWaqf }: {
  signedIn: boolean; waqfs: WaqfOpt[]; quickCount: number; deepCount: number; defaultKind: "basic" | "deep"; defaultWaqf?: string;
}) {
  const [state, action] = useActionState(startAssessment, initialState);
  const [kind, setKind] = useState<"basic" | "deep">(signedIn ? defaultKind : "basic");
  const [waqf, setWaqf] = useState(defaultWaqf && waqfs.some((w) => w.id === defaultWaqf) ? defaultWaqf : waqfs.length ? waqfs[0].id : "new");

  const card = (active: boolean, disabled = false) =>
    cn(
      "relative flex cursor-pointer flex-col gap-1 rounded-lg border p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]",
      active ? "border-ink bg-ink-soft" : "border-line-strong bg-surface hover:bg-surface-2",
      disabled && "cursor-not-allowed opacity-70",
    );

  return (
    <form action={action} className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-[17px] font-semibold">اختر عمق التقييم</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={card(kind === "basic")}>
            <span className="flex items-center gap-2 font-semibold text-ink">
              <input type="radio" name="kind" value="basic" checked={kind === "basic"} onChange={() => setKind("basic")} className="size-5 accent-[var(--ink)]" />
              <Gauge aria-hidden className="size-5" />
              تقييم سريع
            </span>
            <span className="text-[14.5px] text-muted">حتى {quickCount} سؤالًا، نحو 15 دقيقة. نتيجة فورية وتوصيات وخطة.</span>
          </label>
          <label className={card(kind === "deep", !signedIn)}>
            <span className="flex items-center gap-2 font-semibold text-ink">
              <input type="radio" name="kind" value="deep" checked={kind === "deep"} disabled={!signedIn} onChange={() => setKind("deep")} className="size-5 accent-[var(--ink)]" />
              <Microscope aria-hidden className="size-5" />
              تقييم معمّق
            </span>
            <span className="text-[14.5px] text-muted">حتى {deepCount} سؤالًا، 30 إلى 45 دقيقة. يراجعه مختص في وقفك ويضيف ملاحظاته.</span>
            {!signedIn ? (
              <span className="mt-1 inline-flex items-center gap-1 text-[13.5px] text-ink">
                <Lock aria-hidden className="size-3.5" />
                <Link href="/login?next=/assessment%3Fkind%3Ddeep" className="underline underline-offset-4">سجّل الدخول</Link> لاختياره
              </span>
            ) : null}
          </label>
        </div>
      </fieldset>

      {signedIn ? (
        <fieldset>
          <legend className="mb-3 text-[17px] font-semibold">أي وقف تقيّم؟</legend>
          <div className="grid gap-2">
            {waqfs.map((w) => (
              <label key={w.id} className={card(waqf === w.id)}>
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name="waqf" value={w.id} checked={waqf === w.id} onChange={() => setWaqf(w.id)} className="size-5 accent-[var(--ink)]" />
                  {w.name}
                  <span className="tabular text-[13px] font-normal text-muted">{w.number}</span>
                </span>
              </label>
            ))}
            <label className={card(waqf === "new")}>
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name="waqf" value="new" checked={waqf === "new"} onChange={() => setWaqf("new")} className="size-5 accent-[var(--ink)]" />
                وقف غير مسجّل هنا
              </span>
              <span className="text-[14px] text-muted">يُحفظ التقييم دون ربطه بملف وقف، ويمكنك ربطه لاحقًا.</span>
            </label>
          </div>
          {waqfs.length ? <p className="mt-2 text-[13.5px] text-muted">تظهر الأوقاف التي تملك فيها صلاحية إجراء التقييم. نعبّئ إجابات ملف الوقف من بياناته لتراجعها.</p> : null}
        </fieldset>
      ) : (
        <input type="hidden" name="waqf" value="new" />
      )}

      {(!signedIn || waqf === "new") && (
        <div className="space-y-1.5">
          <label htmlFor="waqfLabel" className="block text-[15px] font-medium">اسم مختصر للوقف (اختياري)</label>
          <input id="waqfLabel" name="waqfLabel" maxLength={120} placeholder="مثال: وقف العائلة" className="block h-11 w-full max-w-md rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20" />
          <p className="text-[13px] text-muted">يظهر في رأس النتيجة فقط. لا تكتب بيانات شخصية.</p>
        </div>
      )}

      <FormMessage state={state} />
      <SubmitButton size="lg" pendingText="نجهّز الأسئلة…" className="w-full sm:w-auto">ابدأ التقييم</SubmitButton>
    </form>
  );
}
