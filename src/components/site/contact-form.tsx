"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { submitContact } from "@/server/modules/public/actions";
import { CONTACT_TOPICS } from "@/server/modules/public/contact-topics";

export function ContactForm({ defaultTopic, refCode }: { defaultTopic?: string; refCode?: string }) {
  const [state, action] = useActionState(submitContact, initialState);
  const startedRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (startedRef.current && !startedRef.current.value) startedRef.current.value = String(Date.now());
  });
  useEffect(() => {
    if (state.ok) doneRef.current?.focus();
  }, [state.ok]);
  const fe = state.fieldErrors ?? {};

  if (state.ok)
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="fade-in flex flex-col items-start gap-3 rounded-lg border border-ok/30 bg-ok-soft p-6 focus:outline-none">
        <CheckCircle2 aria-hidden className="size-8 text-ok" />
        <h2 className="text-xl font-semibold text-text">أُرسلت رسالتك</h2>
        <p className="text-[15.5px] leading-7">{state.message}</p>
        <p className="text-[14px] text-muted">
          وإلى أن نرد عليك، قد تجد إجابتك في <Link href="/faq" className="text-ink underline underline-offset-4">الأسئلة الشائعة</Link> أو{" "}
          <Link href="/library" className="text-ink underline underline-offset-4">المكتبة</Link>.
        </p>
      </div>
    );

  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="الاسم" name="name" required error={fe.name}>
          <Input name="name" autoComplete="name" required maxLength={80} error={fe.name} />
        </Field>
        <Field label="موضوع الرسالة" name="topic" required error={fe.topic}>
          <Select name="topic" required defaultValue={CONTACT_TOPICS.some((t) => t.value === defaultTopic) ? defaultTopic : "general"} options={CONTACT_TOPICS.map((t) => ({ value: t.value, label: t.label }))} error={fe.topic} />
        </Field>
        <Field label="رقم الجوال" name="phone" hint="يكفي رقم الجوال أو البريد الإلكتروني." error={fe.phone}>
          <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="05xxxxxxxx" className="text-end" error={fe.phone} />
        </Field>
        <Field label="البريد الإلكتروني" name="email" error={fe.email}>
          <Input name="email" type="email" autoComplete="email" dir="ltr" className="text-end" error={fe.email} />
        </Field>
      </div>
      <Field label="رسالتك" name="body" required error={fe.body} hint="حفاظًا على خصوصيتك، تجنّب كتابة أرقام الهوية أو الحسابات البنكية.">
        <Textarea name="body" required rows={6} maxLength={3000} error={fe.body} />
      </Field>
      {refCode ? <input type="hidden" name="ref" value={refCode} /> : null}
      <input ref={startedRef} type="hidden" name="startedAt" defaultValue="" />
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden whitespace-nowrap opacity-0 [clip:rect(0,0,0,0)]">
        <label htmlFor="website">اترك هذا الحقل فارغًا</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <Checkbox
          name="consent"
          required
          label={
            <>
              أوافق على معالجة بياناتي للرد على رسالتي وفق <Link href="/legal/privacy" className="text-ink underline underline-offset-4">سياسة الخصوصية</Link>.
            </>
          }
        />
        {fe.consent ? <p className="mt-1 text-[13px] font-medium text-critical">{fe.consent}</p> : null}
      </div>
      <SubmitButton pendingText="جارٍ الإرسال…" size="lg">أرسل الرسالة</SubmitButton>
    </form>
  );
}
