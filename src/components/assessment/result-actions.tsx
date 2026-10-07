"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Copy, Link2, ListChecks, Save } from "lucide-react";
import { claimAssessment, createActionPlan, createShare, revokeShare } from "@/server/modules/assessment/actions";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui";
import { fmtDateTime, initialState } from "@/lib/utils";

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <input readOnly value={value} aria-label="رابط المشاركة" onFocus={(e) => e.currentTarget.select()} dir="ltr" className="h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-surface-2 px-3 text-[14px]" />
      <button
        type="button"
        className={buttonClass("secondary", "md")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check aria-hidden className="size-4 text-ok" /> : <Copy aria-hidden className="size-4" />}
        {copied ? "نُسخ" : "انسخ"}
      </button>
    </div>
  );
}

export function ShareControls({ id, shares }: { id: string; shares: { id: string; expiresAt: string; revokedAt: string | null; views: number; createdAt: string }[] }) {
  const [state, action] = useActionState(createShare, initialState);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = typeof state.data?.url === "string" ? `${origin}${state.data.url}` : null;
  const now = Date.now();
  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={id} />
        <div className="space-y-1.5">
          <label htmlFor="share-days" className="block text-[14px] font-medium">مدة الرابط</label>
          <select id="share-days" name="days" defaultValue="7" className="h-11 rounded-md border border-line-strong bg-surface px-3 text-[15px]">
            <option value="7">7 أيام</option>
            <option value="30">30 يومًا</option>
          </select>
        </div>
        <SubmitButton variant="secondary" pendingText="ننشئ الرابط…">
          <Link2 aria-hidden className="size-4" />
          أنشئ رابط قراءة
        </SubmitButton>
      </form>
      <FormMessage state={state} />
      {url ? <CopyField value={url} /> : null}
      {shares.length ? (
        <ul className="divide-y divide-line rounded-md border border-line text-[14px]">
          {shares.map((s) => {
            const active = !s.revokedAt && new Date(s.expiresAt).getTime() > now;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  {active ? `نشط حتى ${fmtDateTime(s.expiresAt)}` : s.revokedAt ? "ملغى" : "منتهي"}
                  <span className="text-muted"> — {s.views} مشاهدة</span>
                </span>
                {active ? <RevokeShare id={id} share={s.id} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function RevokeShare({ id, share }: { id: string; share: string }) {
  const [state, action] = useActionState(revokeShare, initialState);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="share" value={share} />
      <SubmitButton variant="ghost" size="sm" pendingText="نلغي…">ألغِ الرابط</SubmitButton>
      {state.error ? <span role="alert" className="ms-2 text-critical">{state.error}</span> : null}
    </form>
  );
}

export function ActionPlanForm({ id, packageCode }: { id: string; packageCode: string | null }) {
  const [state, action] = useActionState(createActionPlan, initialState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {packageCode ? <input type="hidden" name="package" value={packageCode} /> : null}
      {state.ok ? null : (
        <SubmitButton pendingText="ننشئ المهام…">
          <ListChecks aria-hidden className="size-4" />
          أنشئ خطة عمل
        </SubmitButton>
      )}
      <FormMessage state={state} />
      {state.ok ? <a href="/app/tasks" className={buttonClass("secondary", "md")}>افتح المهام</a> : null}
    </form>
  );
}

export function ClaimForm({ id, waqfs }: { id: string; waqfs: { id: string; name: string }[] }) {
  const [state, action] = useActionState(claimAssessment, initialState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {waqfs.length ? (
        <div className="space-y-1.5">
          <label htmlFor="claim-waqf" className="block text-[14px] font-medium">اربطه بوقف (اختياري)</label>
          <select id="claim-waqf" name="waqf" defaultValue="" className="h-11 w-full max-w-md rounded-md border border-line-strong bg-surface px-3 text-[15px]">
            <option value="">لا تربطه بوقف الآن</option>
            {waqfs.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      ) : null}
      <SubmitButton pendingText="نحفظ…">
        <Save aria-hidden className="size-4" />
        احفظ النتيجة في حسابي
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
