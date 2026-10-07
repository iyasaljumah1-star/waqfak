"use client";

import { useActionState } from "react";
import { Checkbox, Field, FormMessage, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { cancelAccountDeletion, createDataRequest, requestAccountDeletion, setMarketingConsent } from "@/server/modules/account/actions";

export function MarketingConsentForm({ granted }: { granted: boolean }) {
  const [s, a] = useActionState(setMarketingConsent, initialState);
  return (
    <form action={a} className="space-y-2">
      <input type="hidden" name="granted" value={granted ? "false" : "true"} />
      <SubmitButton size="sm" variant={granted ? "secondary" : "primary"} pendingText="…">{granted ? "اسحب الموافقة" : "أوافق على استلامها"}</SubmitButton>
      <FormMessage state={s} />
    </form>
  );
}

export function DataRequestForm({ kinds }: { kinds: { value: string; label: string }[] }) {
  const [s, a] = useActionState(createDataRequest, initialState);
  return (
    <form action={a} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نوع الطلب" name="kind" required error={s.fieldErrors?.kind}>
          <Select name="kind" required placeholder="اختر" options={kinds} error={s.fieldErrors?.kind} />
        </Field>
      </div>
      <Field label="التفاصيل" name="details" hint="للتصحيح: اذكر البيان وقيمته الصحيحة. للاعتراض: اذكر المعالجة وسببك." error={s.fieldErrors?.details}>
        <Textarea name="details" maxLength={2000} className="min-h-24" error={s.fieldErrors?.details} />
      </Field>
      <FormMessage state={s} />
      <SubmitButton pendingText="جارٍ الإرسال…">أرسل الطلب</SubmitButton>
    </form>
  );
}

export function DeletionForm({ requested }: { requested: boolean }) {
  const [s, a] = useActionState(requestAccountDeletion, initialState);
  const [c, cancel] = useActionState(async () => cancelAccountDeletion(), initialState);
  if (requested)
    return (
      <form action={cancel} className="space-y-2">
        <SubmitButton variant="secondary" pendingText="…">ألغِ طلب الحذف</SubmitButton>
        <FormMessage state={c} />
      </form>
    );
  return (
    <form action={a} className="space-y-4">
      <Field label="السبب (اختياري)" name="reason">
        <Textarea name="reason" maxLength={1000} className="min-h-20" />
      </Field>
      <Checkbox name="confirm" label="فهمت أن السجلات النظامية للأوقاف تُحفظ رغم حذف الحساب، وأن الحذف لا يُلغي أدواري حتى يعيّن الناظر بديلًا." />
      {s.fieldErrors?.confirm ? <p className="text-[13px] font-medium text-critical">{s.fieldErrors.confirm}</p> : null}
      <FormMessage state={s} />
      <SubmitButton variant="danger" pendingText="…">اطلب حذف حسابي</SubmitButton>
    </form>
  );
}
