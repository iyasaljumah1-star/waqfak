"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { DocumentUploader } from "@/components/documents/uploader";
import { cn, fmtSAR, initialState, type ActionState } from "@/lib/utils";
import { buildQuote, splitInstallments, TERM_DUE_LABEL } from "@/server/modules/commerce/pure";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;
/** Submits without React's automatic form reset (the editors keep their state between saves). */
const keep = (dispatch: (fd: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  startTransition(() => dispatch(fd));
};

const inputCls = "block w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20";

// ───────────────────────── Attachments ─────────────────────────

/** Upload a file to the request (or pick one already uploaded) and keep its id in a hidden input. */
export function AttachmentPicker({ requestId, waqfId, docs, name = "documentId", label = "مرفق (اختياري)", docType }: {
  requestId: string; waqfId: string | null; docs: { id: string; title: string }[]; name?: string; label?: string; docType?: string;
}) {
  const [v, setV] = useState("");
  const [extra, setExtra] = useState<{ id: string; title: string }[]>([]);
  const all = [...extra, ...docs.filter((d) => !extra.some((e) => e.id === d.id))];
  return (
    <div className="space-y-2 rounded-md border border-dashed border-line-strong p-3">
      <p className="flex items-center gap-2 text-[14px] font-medium"><Paperclip aria-hidden className="size-4 text-muted" />{label}</p>
      <input type="hidden" name={name} value={v} />
      <DocumentUploader requestId={requestId} waqfId={waqfId} compact docType={docType} onUploaded={(d) => (setExtra((x) => [d, ...x]), setV(d.id))} />
      {all.length ? (
        <label className="block space-y-1">
          <span className="text-[13px] text-muted">أو اختر من مستندات الطلب</span>
          <select value={v} onChange={(e) => setV(e.target.value)} className={cn(inputCls, "h-10")}>
            <option value="">بلا مرفق</option>
            {all.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function NoteFormWithAttachment({ action, id, staff, requestId, waqfId, docs, fixedVisibility }: { action: Act; id: string; staff?: boolean; requestId: string; waqfId: string | null; docs: { id: string; title: string }[]; fixedVisibility?: "client" | "internal" }) {
  const [k, setK] = useState(0);
  // A successful send remounts the form (clears the text and the attachment).
  const [s, a] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) setK((x) => x + 1);
    return r;
  }, initialState);
  return (
    <form action={a} className="space-y-3" key={k}>
      <input type="hidden" name="id" value={id} />
      <Field label={fixedVisibility === "client" ? "رسالة إلى العميل" : fixedVisibility === "internal" ? "ملاحظة داخلية" : staff ? "رسالة أو ملاحظة" : "رسالتك إلى فريق وقفك"} name={`note-body-${fixedVisibility ?? "any"}`}>
        <Textarea name="body" id={`note-body-${fixedVisibility ?? "any"}`} required minLength={2} className="min-h-24" />
      </Field>
      {fixedVisibility ? <input type="hidden" name="visibility" value={fixedVisibility} /> : staff ? (
        <fieldset className="flex flex-wrap gap-4 text-[15px]">
          <legend className="sr-only">من يرى الرسالة</legend>
          <label className="flex items-center gap-2"><input type="radio" name="visibility" value="internal" defaultChecked className="accent-[var(--ink)]" /> ملاحظة داخلية (للفريق فقط)</label>
          <label className="flex items-center gap-2"><input type="radio" name="visibility" value="client" className="accent-[var(--ink)]" /> رسالة للعميل</label>
        </fieldset>
      ) : null}
      <AttachmentPicker requestId={requestId} waqfId={waqfId} docs={docs} />
      <FormMessage state={s} />
      <SubmitButton pendingText="جارٍ الإرسال…">أرسل</SubmitButton>
    </form>
  );
}

// ───────────────────────── Deficiencies ─────────────────────────

const KIND_OPTIONS = [
  { value: "data", label: "بيانات ناقصة أو غير واضحة" },
  { value: "document", label: "مستند ناقص أو غير مقبول" },
  { value: "question", label: "استفسار للعميل" },
  { value: "internal", label: "ملاحظة داخلية (لا يراها العميل)" },
  { value: "technical", label: "مشكلة تقنية" },
];

export function RaiseItemForm({ action, id, fields, docTypes }: { action: Act; id: string; fields: { value: string; label: string }[]; docTypes: { value: string; label: string }[] }) {
  const [s, a] = useActionState(action, initialState);
  const [kind, setKind] = useState("data");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (s.ok) ref.current?.reset();
  }, [s]);
  return (
    <form ref={ref} action={a} className="space-y-3" data-testid="raise-item">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="النوع" name="item-kind" required>
          <Select name="kind" id="item-kind" value={kind} onChange={(e) => setKind(e.target.value)} options={KIND_OPTIONS} />
        </Field>
        <Field label="العنوان" name="item-title" required error={s.fieldErrors?.title}>
          <Input name="title" id="item-title" required minLength={4} maxLength={200} />
        </Field>
      </div>
      <Field label="التفاصيل" name="item-body" hint={kind === "internal" ? "لا تظهر للعميل." : "تظهر للعميل كما تكتبها."}>
        <Textarea name="body" id="item-body" className="min-h-20" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        {kind === "data" && fields.length ? (
          <Field label="الحقل المعني" name="item-field"><Select name="fieldKey" id="item-field" options={fields} placeholder="—" /></Field>
        ) : null}
        {kind === "document" ? (
          <Field label="نوع المستند" name="item-doctype" required><Select name="docType" id="item-doctype" required options={docTypes} placeholder="اختر" /></Field>
        ) : null}
        {kind === "technical" ? (
          <Field label="من يراه" name="item-visibility"><Select name="visibility" id="item-visibility" options={[{ value: "client", label: "العميل والفريق" }, { value: "internal", label: "الفريق فقط" }]} /></Field>
        ) : null}
        <Field label="الموعد المطلوب (اختياري)" name="item-due"><Input name="dueOn" id="item-due" type="date" dir="ltr" /></Field>
      </div>
      {kind !== "internal" ? (
        <label className="flex items-start gap-3 text-[15px]">
          <input type="checkbox" name="required" defaultChecked className="mt-1.5 size-4 accent-[var(--ink)]" />
          <span>مطلوب لإكمال الطلب (يوقف تقدم الطلب حتى يُستكمل، ويمنع إكماله ما دام مفتوحًا)</span>
        </label>
      ) : <input type="hidden" name="required" value="on" />}
      <FormMessage state={s} />
      <SubmitButton size="md" pendingText="جارٍ التسجيل…">سجّل البند</SubmitButton>
    </form>
  );
}

export function AnswerItemForm({ action, itemId, kind, requestId, waqfId, docs, docType }: { action: Act; itemId: string; kind: string; requestId: string; waqfId: string | null; docs: { id: string; title: string }[]; docType?: string | null }) {
  const [s, a] = useActionState(action, initialState);
  if (s.ok) return <FormMessage state={s} />;
  return (
    <form action={a} className="mt-3 space-y-3 border-t border-line pt-3" data-testid={`answer-${itemId}`}>
      <input type="hidden" name="itemId" value={itemId} />
      <Field label={kind === "document" ? "ملاحظة (اختياري)" : "ردك"} name={`response-${itemId}`}>
        <Textarea name="response" id={`response-${itemId}`} className="min-h-20" required={kind !== "document"} minLength={kind === "document" ? 0 : 2} />
      </Field>
      <AttachmentPicker requestId={requestId} waqfId={waqfId} docs={docs} label={kind === "document" ? "المستند المطلوب" : "مرفق (اختياري)"} docType={docType ?? undefined} />
      <FormMessage state={s} />
      <SubmitButton size="md" pendingText="جارٍ الإرسال…">أرسل الرد</SubmitButton>
    </form>
  );
}

export function ReviewItemForms({ action, itemId, status, internal }: { action: Act; itemId: string; status: string; internal: boolean }) {
  const [s, a] = useActionState(action, initialState);
  const [mode, setMode] = useState<"correct" | "cancel" | null>(null);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "answered" ? (
          <form action={a}>
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="decision" value="accept" />
            <SubmitButton size="sm" pendingText="…">اقبل وأغلق</SubmitButton>
          </form>
        ) : null}
        {internal && status === "open" ? (
          <form action={a}>
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="decision" value="close" />
            <SubmitButton size="sm" variant="secondary" pendingText="…">أغلق</SubmitButton>
          </form>
        ) : null}
        {status === "answered" ? <Button type="button" size="sm" variant="secondary" onClick={() => setMode(mode === "correct" ? null : "correct")}>اطلب تصحيحًا</Button> : null}
        {!["accepted", "cancelled"].includes(status) ? <Button type="button" size="sm" variant="ghost" onClick={() => setMode(mode === "cancel" ? null : "cancel")}>ألغِ البند</Button> : null}
      </div>
      {mode ? (
        <form action={a} className="space-y-2 rounded-md bg-surface-2 p-3">
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="decision" value={mode} />
          <Field label={mode === "correct" ? "ما المطلوب تصحيحه؟" : "سبب الإلغاء"} name={`note-${itemId}`}>
            <Textarea name="note" id={`note-${itemId}`} required minLength={3} className="min-h-16" />
          </Field>
          <SubmitButton size="sm" variant={mode === "cancel" ? "danger" : "primary"} pendingText="…">{mode === "correct" ? "أرسل طلب التصحيح" : "ألغِ البند"}</SubmitButton>
        </form>
      ) : null}
      <FormMessage state={s} />
    </div>
  );
}

// ───────────────────────── Quote editor ─────────────────────────

type LineRow = { description: string; qty: string; unit: string };
type TermRow = { label: string; percent: string; due: "on_contract" | "before_start" | "on_delivery" | "on_completion"; beforeStart: boolean };

export type QuoteSeed = {
  quoteId?: string; kind: "initial" | "amendment"; scope: string; deliverables: string; exclusions: string; assumptions: string; clientObligations: string;
  durationDays: string; discount: string; validUntil: string; lines: LineRow[]; terms: TermRow[];
};

export function QuoteEditor({ action, requestId, seed, vatRate, today, title }: { action: Act; requestId: string; seed: QuoteSeed; vatRate: number; today: string; title: string }) {
  const [s, a, pending] = useActionState(action, initialState);
  const [lines, setLines] = useState<LineRow[]>(seed.lines.length ? seed.lines : [{ description: "", qty: "1", unit: "" }]);
  const [terms, setTerms] = useState<TermRow[]>(seed.terms.length ? seed.terms : [{ label: "دفعة واحدة عند توقيع العقد", percent: "100", due: "on_contract", beforeStart: true }]);
  const [discount, setDiscount] = useState(seed.discount || "0");
  const [validUntil, setValidUntil] = useState(seed.validUntil);
  const preview = buildQuote({
    lines: lines.map((l) => ({ description: l.description, qty: Number(l.qty), unit: Number(l.unit) })), discount: Number(discount) || 0, vatRate,
    terms: terms.map((t) => ({ label: t.label, percent: Number(t.percent), due: t.due, beforeStart: t.beforeStart })), validUntil, today,
  });
  const upd = <T,>(arr: T[], i: number, patch: Partial<T>) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x));
  return (
    <form onSubmit={keep(a)} className="space-y-4" data-testid="quote-editor">
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="quoteId" value={seed.quoteId ?? ""} />
      <input type="hidden" name="kind" value={seed.kind} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <input type="hidden" name="terms" value={JSON.stringify(terms)} />
      <h3 className="font-semibold">{title}</h3>
      <Field label="نطاق العمل" name="scope" required hint="ما الذي ستقدمه «وقفك» بالتحديد، بلغة يفهمها العميل." error={s.fieldErrors?.scope}>
        <Textarea name="scope" required minLength={20} defaultValue={seed.scope} className="min-h-28" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المخرجات" name="deliverables" required error={s.fieldErrors?.deliverables}><Textarea name="deliverables" required defaultValue={seed.deliverables} className="min-h-20" /></Field>
        <Field label="ما لا يشمله النطاق" name="exclusions"><Textarea name="exclusions" defaultValue={seed.exclusions} className="min-h-20" /></Field>
        <Field label="الافتراضات" name="assumptions"><Textarea name="assumptions" defaultValue={seed.assumptions} className="min-h-20" /></Field>
        <Field label="التزامات العميل" name="clientObligations"><Textarea name="clientObligations" defaultValue={seed.clientObligations} className="min-h-20" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="المدة (أيام)" name="durationDays" required error={s.fieldErrors?.durationDays}><Input name="durationDays" type="number" min={1} required defaultValue={seed.durationDays} dir="ltr" className="tabular text-start" /></Field>
        <Field label="الخصم (ر.س)" name="discount"><Input name="discount" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} dir="ltr" className="tabular text-start" /></Field>
        <Field label="صالح حتى" name="validUntil" required error={s.fieldErrors?.validUntil}><Input name="validUntil" type="date" required min={today} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} dir="ltr" /></Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium">البنود</legend>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-line p-2 sm:grid-cols-[minmax(0,1fr)_6rem_9rem_auto]">
            <input aria-label={`وصف البند ${i + 1}`} value={l.description} onChange={(e) => setLines(upd(lines, i, { description: e.target.value }))} placeholder="وصف البند" className={cn(inputCls, "col-span-2 h-10 sm:col-span-1")} />
            <input aria-label={`كمية البند ${i + 1}`} value={l.qty} onChange={(e) => setLines(upd(lines, i, { qty: e.target.value }))} inputMode="decimal" dir="ltr" className={cn(inputCls, "tabular h-10 text-start")} />
            <input aria-label={`سعر وحدة البند ${i + 1}`} value={l.unit} onChange={(e) => setLines(upd(lines, i, { unit: e.target.value }))} inputMode="decimal" dir="ltr" placeholder="سعر الوحدة" className={cn(inputCls, "tabular h-10 text-start")} />
            <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1} aria-label={`احذف البند ${i + 1}`} className="rounded p-2 text-muted hover:bg-critical-soft hover:text-critical disabled:opacity-40"><Trash2 aria-hidden className="size-4" /></button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => setLines([...lines, { description: "", qty: "1", unit: "" }])}><Plus aria-hidden className="size-4" />أضف بندًا</Button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium">شروط الدفع</legend>
        {terms.map((t, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[minmax(0,1fr)_5rem_11rem_auto_auto] sm:items-center">
            <input aria-label={`وصف الدفعة ${i + 1}`} value={t.label} onChange={(e) => setTerms(upd(terms, i, { label: e.target.value }))} placeholder="وصف الدفعة" className={cn(inputCls, "h-10")} />
            <input aria-label={`نسبة الدفعة ${i + 1}`} value={t.percent} onChange={(e) => setTerms(upd(terms, i, { percent: e.target.value }))} inputMode="decimal" dir="ltr" className={cn(inputCls, "tabular h-10 text-start")} />
            <select aria-label={`استحقاق الدفعة ${i + 1}`} value={t.due} onChange={(e) => setTerms(upd(terms, i, { due: e.target.value as TermRow["due"] }))} className={cn(inputCls, "h-10")}>
              {Object.entries(TERM_DUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={t.beforeStart || t.due === "before_start"} disabled={t.due === "before_start"} onChange={(e) => setTerms(upd(terms, i, { beforeStart: e.target.checked }))} className="size-4 accent-[var(--ink)]" />شرط للبدء</label>
            <button type="button" onClick={() => setTerms(terms.filter((_, j) => j !== i))} disabled={terms.length === 1} aria-label={`احذف الدفعة ${i + 1}`} className="rounded p-2 text-muted hover:bg-critical-soft hover:text-critical disabled:opacity-40"><Trash2 aria-hidden className="size-4" /></button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => setTerms([...terms, { label: "", percent: "", due: "on_delivery", beforeStart: false }])}><Plus aria-hidden className="size-4" />أضف دفعة</Button>
      </fieldset>

      <div className="rounded-md bg-surface-2 p-3 text-[15px]" aria-live="polite">
        {preview.ok ? (
          <>
            <p>الصافي <span className="tabular font-semibold">{fmtSAR(preview.net)}</span> + الضريبة ({vatRate}٪) <span className="tabular">{fmtSAR(preview.vat)}</span> = <span className="tabular font-semibold text-ink">{fmtSAR(preview.total)}</span></p>
            <ul className="mt-1 text-[13px] text-muted">
              {splitInstallments(preview.net, vatRate, preview.terms).map((t) => <li key={t.key}>{t.label} ({t.percent}٪): {fmtSAR(t.total)} — {TERM_DUE_LABEL[t.due]}{t.beforeStart ? " — شرط للبدء" : ""}</li>)}
            </ul>
          </>
        ) : (
          <ul className="list-disc ps-5 text-[13px] text-fine">{preview.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
        )}
      </div>
      <FormMessage state={s} />
      <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? "جارٍ الحفظ…" : "احفظ مسودة العرض"}</Button>
    </form>
  );
}

export function QuoteResponseForm({ action, quoteId, hash }: { action: Act; quoteId: string; hash: string }) {
  const [s, a] = useActionState(action, initialState);
  const [mode, setMode] = useState<"reject" | "change" | null>(null);
  if (s.ok) return <FormMessage state={s} />;
  return (
    <div className="space-y-3" data-testid="quote-response">
      <div className="flex flex-wrap gap-2">
        <form action={a}>
          <input type="hidden" name="quoteId" value={quoteId} />
          <input type="hidden" name="decision" value="accept" />
          <input type="hidden" name="hash" value={hash} />
          <SubmitButton size="md" pendingText="جارٍ التسجيل…">أقبل العرض</SubmitButton>
        </form>
        <Button type="button" variant="secondary" onClick={() => setMode(mode === "change" ? null : "change")}>أطلب تعديلًا</Button>
        <Button type="button" variant="ghost" className="text-critical" onClick={() => setMode(mode === "reject" ? null : "reject")}>أرفض العرض</Button>
      </div>
      {mode ? (
        <form action={a} className="space-y-2 rounded-md bg-surface-2 p-3">
          <input type="hidden" name="quoteId" value={quoteId} />
          <input type="hidden" name="decision" value={mode} />
          <Field label={mode === "change" ? "ما التعديل الذي تطلبه؟" : "سبب الرفض"} name="note">
            <Textarea name="note" required minLength={5} className="min-h-20" />
          </Field>
          <SubmitButton size="md" variant={mode === "reject" ? "danger" : "primary"} pendingText="جارٍ الإرسال…">{mode === "change" ? "أرسل طلب التعديل" : "أرسل الرفض"}</SubmitButton>
        </form>
      ) : null}
      <FormMessage state={s} />
    </div>
  );
}

// ───────────────────────── Contract parties ─────────────────────────

type PartyRow = { name: string; capacity: string; idLabel: string; idNumber: string; signerUserId: string; authorityType: string; authorityRef: string; authorityDocumentId: string };

const AUTH_OPTIONS = [
  { value: "self", label: "أصالة عن نفسه" },
  { value: "nazir", label: "بصفته ناظر الوقف" },
  { value: "agent", label: "وكيلًا بموجب وكالة" },
  { value: "board", label: "بتفويض من مجلس النظارة" },
  { value: "legal_rep", label: "ممثلًا نظاميًا لجهة" },
];

export function ContractPrepareForm({ action, requestId, quoteId, signers, docs, seed, gaps }: {
  action: Act; requestId: string; quoteId: string; signers: { id: string; name: string; requester: boolean }[]; docs: { id: string; title: string }[]; seed: PartyRow[]; gaps: string[];
}) {
  const [s, a, pending] = useActionState(action, initialState);
  const [rows, setRows] = useState<PartyRow[]>(seed);
  const upd = (i: number, patch: Partial<PartyRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <form onSubmit={keep(a)} className="space-y-4" data-testid="contract-prepare">
      <input type="hidden" name="id" value={requestId} />
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="parties" value={JSON.stringify(rows)} />
      {gaps.length ? (
        <p role="alert" className="rounded-md bg-fine-soft px-3 py-2 text-[15px] text-fine">بيانات الشركة ناقصة في الإعدادات: {gaps.join("، ")}. لا يُعدّ العقد حتى تكتمل.</p>
      ) : null}
      {rows.map((r, i) => (
        <fieldset key={i} className="space-y-3 rounded-lg border border-line p-3">
          <legend className="px-1 font-medium">الطرف الثاني{rows.length > 1 ? ` (${i + 1})` : ""}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1"><span className="text-[14px] font-medium">اسم الطرف المتعاقد</span><input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} className={cn(inputCls, "h-10")} placeholder="الشخص أو الوقف أو الجهة الملتزمة بالعقد" /></label>
            <label className="space-y-1"><span className="text-[14px] font-medium">صفته</span><input value={r.capacity} onChange={(e) => upd(i, { capacity: e.target.value })} className={cn(inputCls, "h-10")} placeholder="مثل: واقف، وقف مسجل، جمعية أهلية" /></label>
            <label className="space-y-1"><span className="text-[14px] font-medium">نوع الهوية أو السجل</span><input value={r.idLabel} onChange={(e) => upd(i, { idLabel: e.target.value })} className={cn(inputCls, "h-10")} placeholder="رقم الهوية، الرقم الوطني الموحد…" /></label>
            <label className="space-y-1"><span className="text-[14px] font-medium">الرقم</span><input value={r.idNumber} onChange={(e) => upd(i, { idNumber: e.target.value })} dir="ltr" className={cn(inputCls, "tabular h-10 text-start")} /></label>
            <label className="space-y-1"><span className="text-[14px] font-medium">الموقّع (حساب في المنصة)</span>
              <select value={r.signerUserId} onChange={(e) => upd(i, { signerUserId: e.target.value })} className={cn(inputCls, "h-10")}>
                {signers.map((u) => <option key={u.id} value={u.id}>{u.name}{u.requester ? " (مقدّم الطلب)" : ""}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className="text-[14px] font-medium">صفة التوقيع</span>
              <select value={r.authorityType} onChange={(e) => upd(i, { authorityType: e.target.value })} className={cn(inputCls, "h-10")}>
                {AUTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {r.authorityType !== "self" ? (
              <>
                <label className="space-y-1"><span className="text-[14px] font-medium">سند الصفة (رقم الوكالة أو القرار أو صك النظارة)</span><input value={r.authorityRef} onChange={(e) => upd(i, { authorityRef: e.target.value })} className={cn(inputCls, "h-10")} /></label>
                <label className="space-y-1"><span className="text-[14px] font-medium">مستند السند</span>
                  <select value={r.authorityDocumentId} onChange={(e) => upd(i, { authorityDocumentId: e.target.value })} className={cn(inputCls, "h-10")}>
                    <option value="">—</option>
                    {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </label>
              </>
            ) : null}
          </div>
          {rows.length > 1 ? <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 aria-hidden className="size-4" />احذف هذا الطرف</Button> : null}
        </fieldset>
      ))}
      {rows.length < 4 ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setRows([...rows, { name: "", capacity: "", idLabel: "", idNumber: "", signerUserId: signers[0]?.id ?? "", authorityType: "self", authorityRef: "", authorityDocumentId: "" }])}>
          <Plus aria-hidden className="size-4" />أضف طرفًا موقّعًا آخر
        </Button>
      ) : null}
      <FormMessage state={s} />
      <Button type="submit" disabled={gaps.length > 0 || pending} aria-busy={pending}>{pending ? "جارٍ الإعداد…" : "أعدّ مسودة العقد"}</Button>
    </form>
  );
}
