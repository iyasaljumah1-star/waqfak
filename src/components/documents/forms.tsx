"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Field, FormMessage, Input, Select, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { approveDocument, archiveDocument, createShareLink, revokeShareLink, updateDocumentMeta } from "@/server/modules/documents/actions";
import { CONF_OPTIONS, DOC_TYPE_OPTIONS } from "@/server/modules/documents/labels";

type Meta = {
  title: string; docType: string; number: string | null; issuer: string | null; issuedOn: string | null; issuedOnHijri: string | null;
  expiresOn: string | null; retentionUntil: string | null; confidentiality: string;
};

export function MetaForm({ waqfId, docId, doc, canLower }: { waqfId: string; docId: string; doc: Meta; canLower: boolean }) {
  const [state, action] = useActionState(updateDocumentMeta, initialState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="docId" value={docId} />
      <Field label="العنوان" name="title" required error={fe.title}>
        <Input name="title" defaultValue={doc.title} required maxLength={200} error={fe.title} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="النوع" name="docType" error={fe.docType}>
          <Select name="docType" defaultValue={doc.docType} options={DOC_TYPE_OPTIONS} error={fe.docType} />
        </Field>
        <Field label="درجة السرية" name="confidentiality" error={fe.confidentiality} hint={canLower ? undefined : "خفض الدرجة يتطلب صلاحية الاعتماد."}>
          <Select name="confidentiality" defaultValue={doc.confidentiality} options={CONF_OPTIONS} error={fe.confidentiality} />
        </Field>
        <Field label="رقم الوثيقة" name="number" error={fe.number}>
          <Input name="number" defaultValue={doc.number ?? ""} dir="auto" maxLength={100} error={fe.number} />
        </Field>
        <Field label="جهة الإصدار" name="issuer" error={fe.issuer}>
          <Input name="issuer" defaultValue={doc.issuer ?? ""} maxLength={200} error={fe.issuer} />
        </Field>
        <Field label="تاريخ الإصدار (ميلادي)" name="issuedOn" error={fe.issuedOn}>
          <Input name="issuedOn" type="date" defaultValue={doc.issuedOn ?? ""} error={fe.issuedOn} />
        </Field>
        <Field label="تاريخ الإصدار (هجري)" name="issuedOnHijri" hint="كما ورد في الوثيقة، مثل 1445/09/12" error={fe.issuedOnHijri}>
          <Input name="issuedOnHijri" defaultValue={doc.issuedOnHijri ?? ""} dir="ltr" maxLength={40} error={fe.issuedOnHijri} />
        </Field>
        <Field label="تاريخ الانتهاء" name="expiresOn" hint="نذكّرك قبل الانتهاء بـ60 و30 و7 أيام." error={fe.expiresOn}>
          <Input name="expiresOn" type="date" defaultValue={doc.expiresOn ?? ""} error={fe.expiresOn} />
        </Field>
        <Field label="الحفظ حتى" name="retentionUntil" hint="مدة الاحتفاظ النظامية بالوثيقة." error={fe.retentionUntil}>
          <Input name="retentionUntil" type="date" defaultValue={doc.retentionUntil ?? ""} error={fe.retentionUntil} />
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton>احفظ البيانات</SubmitButton>
    </form>
  );
}

export function ApproveForm({ waqfId, docId }: { waqfId: string; docId: string }) {
  const [state, action] = useActionState(approveDocument, initialState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="docId" value={docId} />
      <FormMessage state={state} />
      <SubmitButton variant="seal" pendingText="جارٍ الاعتماد…">اعتمد الوثيقة</SubmitButton>
    </form>
  );
}

export function ArchiveForm({ waqfId, docId, archived }: { waqfId: string; docId: string; archived: boolean }) {
  const [state, action] = useActionState(archiveDocument, initialState);
  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        if (!archived && !confirm("أرشفة الوثيقة تخفيها من القائمة وتلغي روابط المشاركة. هل تريد المتابعة؟")) e.preventDefault();
      }}
    >
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="docId" value={docId} />
      {archived ? <input type="hidden" name="restore" value="1" /> : null}
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="جارٍ التنفيذ…">{archived ? "استعد الوثيقة" : "أرشف الوثيقة"}</SubmitButton>
    </form>
  );
}

export function ShareForm({ waqfId, docId }: { waqfId: string; docId: string }) {
  const [state, action] = useActionState(createShareLink, initialState);
  const [copied, setCopied] = useState(false);
  const url = typeof state.data?.url === "string" ? state.data.url : null;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="docId" value={docId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="صالح لمدة (أيام)" name="days" error={fe.days}>
          <Input name="days" type="number" min={1} max={30} defaultValue={7} inputMode="numeric" error={fe.days} />
        </Field>
        <Field label="مرات التنزيل" name="maxUses" error={fe.maxUses}>
          <Input name="maxUses" type="number" min={1} max={50} defaultValue={3} inputMode="numeric" error={fe.maxUses} />
        </Field>
      </div>
      {url ? (
        <div className="space-y-2 rounded-md bg-ok-soft p-3">
          <p className="text-[14px] text-ok">{state.message}</p>
          <div className="flex gap-2">
            <input readOnly value={url} dir="ltr" aria-label="رابط المشاركة" data-testid="share-url" onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[13px]" />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  /* clipboard blocked: the field stays selectable */
                }
              }}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-line-strong bg-surface px-3 text-sm hover:bg-surface-2"
            >
              {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
              {copied ? "نُسخ" : "انسخ"}
            </button>
          </div>
        </div>
      ) : (
        <FormMessage state={state} />
      )}
      <SubmitButton variant="secondary" pendingText="جارٍ الإنشاء…">أنشئ رابط مشاركة</SubmitButton>
    </form>
  );
}

export function RevokeShareForm({ waqfId, docId, shareId }: { waqfId: string; docId: string; shareId: string }) {
  const [state, action] = useActionState(revokeShareLink, initialState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="waqfId" value={waqfId} />
      <input type="hidden" name="docId" value={docId} />
      <input type="hidden" name="shareId" value={shareId} />
      <SubmitButton variant="ghost" size="sm" pendingText="جارٍ الإلغاء…" className="text-critical">ألغِ الرابط</SubmitButton>
      {state.error ? <span role="alert" className="ms-2 text-[13px] text-critical">{state.error}</span> : null}
    </form>
  );
}
