"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { FormMessage } from "@/components/ui/form";
import { buttonClass } from "@/components/ui";
import { initialState, type ActionState } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASSET_CATEGORIES, ASSET_TYPES, checkAsset, isAssetCategory, type AssetFieldSpec, type AssetInput } from "@/server/modules/assets/types";

/**
 * Asset fields that follow the chosen type: changing the type shows that type's fields only (and drops the others'
 * data, after confirmation when there is any). Validation messages come from the same definition the server applies.
 */

const inputCls = "block h-10 w-full rounded-md border border-line-strong bg-surface px-2 text-[14px]";

export type AssetDraft = AssetInput;
export const blankAsset = (category = ""): AssetDraft => ({ category, title: "", value: "", ownershipDocNo: "", sharePct: "", held: "off", details: {} });

function Field({ id, f, value, onChange }: { id: string; f: AssetFieldSpec; value: string; onChange: (v: string) => void }) {
  return (
    <div className={cn("space-y-1", f.type === "textarea" && "sm:col-span-2 lg:col-span-4")}>
      <label htmlFor={id} className="block text-[13px] font-medium">{f.label}{f.required ? <span className="text-critical"> *</span> : null}</label>
      {f.type === "select" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          <option value="">—</option>
          {(f.options ?? []).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ) : f.type === "textarea" ? (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={1000} className="block min-h-16 w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[14px]" />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" || f.last4 ? "numeric" : undefined}
          dir={f.type === "number" || f.type === "date" || f.last4 ? "ltr" : undefined} maxLength={f.last4 ? 4 : 200} autoComplete="off" className={cn(inputCls, (f.type === "number" || f.type === "date") && "text-start tabular")} />
      )}
      {f.hint ? <p className="text-[12px] text-muted">{f.hint}</p> : null}
    </div>
  );
}

/** The fields of one asset, by its type. */
export function AssetFields({ idPrefix, value, onChange, showHeld = true }: { idPrefix: string; value: AssetDraft; onChange: (v: AssetDraft) => void; showHeld?: boolean }) {
  const spec = isAssetCategory(value.category) ? ASSET_TYPES[value.category] : null;
  const set = (patch: Partial<AssetDraft>) => onChange({ ...value, ...patch });
  const changeType = (c: string) => {
    const hasData = Object.values(value.details).some(Boolean) || !!value.ownershipDocNo || !!value.sharePct;
    if (value.category && c !== value.category && hasData && !window.confirm("تغيير نوع الأصل يُسقط البيانات الخاصة بالنوع السابق (مثل رقم الصك أو عدد الأسهم). هل تريد المتابعة؟")) return;
    onChange({ ...value, category: c, details: {}, ownershipDocNo: c === value.category ? value.ownershipDocNo : "", sharePct: c === value.category ? value.sharePct : "" });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-category`} className="block text-[13px] font-medium">نوع الأصل<span className="text-critical"> *</span></label>
        <select id={`${idPrefix}-category`} value={value.category} onChange={(e) => changeType(e.target.value)} className={inputCls}>
          <option value="">اختر</option>
          {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_TYPES[c].label}</option>)}
        </select>
      </div>
      {spec ? (
        <>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
            <label htmlFor={`${idPrefix}-title`} className="block text-[13px] font-medium">{spec.titleLabel}<span className="text-critical"> *</span></label>
            <input id={`${idPrefix}-title`} value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder={spec.titleHint} maxLength={200} className={inputCls} />
          </div>
          {spec.ownershipDoc ? (
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-ownershipDocNo`} className="block text-[13px] font-medium">{spec.ownershipDoc.label}{spec.ownershipDoc.required ? <span className="text-critical"> *</span> : null}</label>
              <input id={`${idPrefix}-ownershipDocNo`} value={value.ownershipDocNo} onChange={(e) => set({ ownershipDocNo: e.target.value })} dir="ltr" maxLength={80} className={cn(inputCls, "text-start")} />
            </div>
          ) : null}
          {spec.fields.map((f) => <Field key={f.key} id={`${idPrefix}-${f.key}`} f={f} value={value.details[f.key] ?? ""} onChange={(v) => set({ details: { ...value.details, [f.key]: v } })} />)}
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-value`} className="block text-[13px] font-medium">{spec.valueLabel}{spec.valueRequired ? <span className="text-critical"> *</span> : null}</label>
            <input id={`${idPrefix}-value`} value={value.value} onChange={(e) => set({ value: e.target.value })} inputMode="decimal" dir="ltr" className={cn(inputCls, "text-start tabular")} />
          </div>
          {spec.share ? (
            <div className="space-y-1">
              <label htmlFor={`${idPrefix}-sharePct`} className="block text-[13px] font-medium">حصة مشاعة % (إن وُجدت)</label>
              <input id={`${idPrefix}-sharePct`} value={value.sharePct} onChange={(e) => set({ sharePct: e.target.value })} inputMode="decimal" dir="ltr" className={cn(inputCls, "text-start tabular")} />
            </div>
          ) : null}
          {showHeld ? <label className="flex items-center gap-2 self-end pb-2 text-[14px]">
            <input type="checkbox" checked={value.held === "on"} onChange={(e) => set({ held: e.target.checked ? "on" : "off" })} className="size-4 accent-[var(--ink)]" />
            {spec.heldLabel}
          </label> : null}
          <p className="text-[12px] text-muted sm:col-span-2 lg:col-span-4">المستندات المؤيدة: {spec.docs.map((d) => `${d.label}${d.required ? " (مطلوب)" : ""}`).join("، ")} — تُرفع في «الوثائق»{showHeld ? " بعد إنشاء ملف الوقف" : ""}.</p>
        </>
      ) : <p className="self-end pb-2 text-[13px] text-muted sm:col-span-1 lg:col-span-3">اختر نوع الأصل لتظهر الحقول التي تناسبه.</p>}
    </div>
  );
}

/** The wizard's assets: one row per asset, each with its type's fields; submitted as one JSON list. */
export function AssetRowsEditor({ initial, name = "assetsJson", onTotal }: { initial: AssetDraft[]; name?: string; onTotal?: (n: number) => void }) {
  const [rows, setRows] = useState<{ k: number; v: AssetDraft }[]>(() => (initial.length ? initial : [blankAsset()]).map((v, k) => ({ k, v: { ...blankAsset(), ...v, details: v.details ?? {} } })));
  const [seq, setSeq] = useState(rows.length);
  const update = (next: { k: number; v: AssetDraft }[]) => {
    setRows(next);
    onTotal?.(next.reduce((s, r) => s + (Number(String(r.v.value).replace(/,/g, "")) || 0), 0));
  };
  const json = useMemo(() => JSON.stringify(rows.map((r) => ({ category: r.v.category, title: r.v.title, value: r.v.value, ownershipDocNo: r.v.ownershipDocNo, sharePct: r.v.sharePct, inFounderName: r.v.held, details: r.v.details }))), [rows]);
  return (
    <div className="space-y-3" id="assets">
      <input type="hidden" name={name} value={json} />
      <ol className="space-y-3">
        {rows.map((r, idx) => {
          const c = r.v.category ? checkAsset(r.v) : null;
          return (
            <li key={r.k} id={`asset-${idx}`} className="scroll-mt-24 rounded-md border border-line bg-surface-2/60 p-3 target:ring-2 target:ring-ink" data-testid={`asset-row-${idx}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted">الأصل {idx + 1}{r.v.category && isAssetCategory(r.v.category) ? ` — ${ASSET_TYPES[r.v.category].label}` : ""}</span>
                {rows.length > 1 ? (
                  <button type="button" onClick={() => update(rows.filter((x) => x.k !== r.k))} className="inline-flex items-center gap-1 text-[13px] text-critical hover:underline">
                    <Trash2 aria-hidden className="size-3.5" /> احذف
                  </button>
                ) : null}
              </div>
              <AssetFields idPrefix={`as-${idx}`} value={r.v} onChange={(v) => update(rows.map((x) => (x.k === r.k ? { ...x, v } : x)))} />
              {c && (c.errors.length || c.missing.length) ? (
                <p className="mt-2 text-[13px] text-fine" data-testid={`asset-missing-${idx}`}>{[...c.errors, c.missing.length ? `ينقص لاكتمال الأصل: ${c.missing.join("، ")}` : ""].filter(Boolean).join(" ")}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {rows.length < 30 ? (
        <button type="button" onClick={() => { update([...rows, { k: seq, v: blankAsset() }]); setSeq(seq + 1); }} className="inline-flex items-center gap-1 rounded-md border border-dashed border-line-strong px-3 py-2 text-[14px] text-ink hover:bg-surface-2">
          <Plus aria-hidden className="size-4" /> أضف أصلًا
        </button>
      ) : null}
    </div>
  );
}

type Saved = { id: string; category: string; subject: string; title: string; ownershipDocNo: string | null; inWaqfName: boolean | null; sharePct: string | null; bookValue: string | null; marketValue: string | null; status: string; annualIncome: string | null; acquiredOn: string | null; notes: string | null; details: Record<string, string> | null };
const STATUS = [["income", "مدرّ للدخل"], ["vacant", "شاغر"], ["development", "تحت التطوير"], ["idle", "معطّل"], ["disputed", "متنازع عليه"]] as const;
const FIN = ["cash", "shares", "fund_units", "portfolio", "sukuk"];

/** Add or edit an asset of the waqf file: its type's fields, then its operating data. */
export function AssetForm({ action, waqfId, asset, submitLabel, testId }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; waqfId: string; asset?: Saved; submitLabel: string; testId?: string }) {
  const [state, dispatch, pending] = useActionState(action, initialState);
  const [v, setV] = useState<AssetDraft>(() => asset
    ? { category: asset.category, title: asset.title, value: asset.marketValue ?? "", ownershipDocNo: asset.ownershipDocNo ?? "", sharePct: asset.sharePct ?? "", held: "off", details: asset.details ?? {} }
    : blankAsset());
  const fin = FIN.includes(v.category);
  // An added asset is saved even when incomplete (its gaps are listed): the add form clears so that submitting again
  // never creates a second copy, and the saved asset is completed from its own page.
  const added = !asset && state.ok && typeof state.data?.assetId === "string" ? state.data.assetId : null;
  useEffect(() => { if (added) setV(blankAsset()); }, [added, state]);
  return (
    <form action={dispatch} className="space-y-4" data-testid={testId} noValidate>
      <input type="hidden" name="waqfId" value={waqfId} />
      {asset ? <input type="hidden" name="assetId" value={asset.id} /> : null}
      <input type="hidden" name="category" value={v.category} />
      <input type="hidden" name="title" value={v.title} />
      <input type="hidden" name="marketValue" value={v.value} />
      <input type="hidden" name="ownershipDocNo" value={v.ownershipDocNo} />
      <input type="hidden" name="sharePct" value={v.sharePct} />
      <input type="hidden" name="details" value={JSON.stringify(v.details)} />
      <AssetFields idPrefix={asset ? `ed-${asset.id.slice(0, 8)}` : "new"} value={v} onChange={setV} showHeld={false} />
      {v.category ? (
        <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-[13px] font-medium">محل الوقف
            <select name="subject" defaultValue={asset?.subject ?? "corpus"} className={inputCls}><option value="corpus">الأصل نفسه</option><option value="value">قيمته</option></select>
          </label>
          <label className="space-y-1 text-[13px] font-medium">الحالة التشغيلية
            <select name="status" defaultValue={asset?.status ?? "income"} className={inputCls}>{STATUS.filter(([k]) => !fin || ["income", "idle", "disputed"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className="space-y-1 text-[13px] font-medium">القيمة الدفترية (ريال)<input name="bookValue" defaultValue={asset?.bookValue ?? ""} inputMode="decimal" dir="ltr" className={cn(inputCls, "text-start")} /></label>
          <label className="space-y-1 text-[13px] font-medium">الدخل السنوي (ريال)<input name="annualIncome" defaultValue={asset?.annualIncome ?? ""} inputMode="decimal" dir="ltr" className={cn(inputCls, "text-start")} /></label>
          <label className="space-y-1 text-[13px] font-medium">تاريخ دخوله في الوقف<input type="date" name="acquiredOn" defaultValue={asset?.acquiredOn ?? ""} className={inputCls} /></label>
          <label className="flex items-center gap-2 self-end pb-2 text-[14px]"><input type="checkbox" name="inWaqfName" defaultChecked={asset?.inWaqfName ?? false} className="size-4 accent-[var(--ink)]" />مسجّل باسم الوقف</label>
          <label className="space-y-1 text-[13px] font-medium sm:col-span-2 lg:col-span-4">ملاحظات<textarea name="notes" defaultValue={asset?.notes ?? ""} maxLength={2000} className="block min-h-16 w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[14px]" /></label>
        </div>
      ) : null}
      <FormMessage state={state} />
      {added && /ينقصه/.test(state.message ?? "") ? <a href={`/app/w/${waqfId}/assets/${added}?edit=1#edit`} className="text-[14px] text-ink underline" data-testid="complete-added-asset">أكمل بيانات الأصل المضاف</a> : null}
      <button type="submit" disabled={pending || !v.category} className={buttonClass("primary", "md")}>{pending ? "جارٍ الحفظ…" : submitLabel}</button>
    </form>
  );
}
