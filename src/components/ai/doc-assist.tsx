"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, FileSearch, LoaderCircle, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import type { AssistDoc, SuggestionView } from "@/server/modules/ai/types";

const STATUS: Record<string, { label: string; tone: "neutral" | "ok" | "info" | "critical" }> = {
  suggested: { label: "مقترح — بانتظار مراجعتك", tone: "neutral" },
  approved: { label: "معتمد دون تطبيق", tone: "info" },
  applied: { label: "طُبق على الوثيقة", tone: "ok" },
  rejected: { label: "مرفوض", tone: "critical" },
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function DocAssist({ waqfId, docs, canDecide }: { waqfId: string; docs: AssistDoc[]; canDecide: boolean }) {
  const [docId, setDocId] = useState(docs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [items, setItems] = useState<SuggestionView[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  async function extract() {
    if (!docId) return;
    setBusy(true);
    setMsg(null);
    setItems([]);
    try {
      const res = await fetch("/api/ai/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waqfId, documentId: docId }) });
      const data = await res.json().catch(() => ({ error: "تعذر قراءة الرد." }));
      if (!res.ok) setMsg({ ok: false, text: data.error ?? "تعذر الاستخراج. أعد المحاولة." });
      else {
        setMsg({ ok: !!data.ok, text: data.message });
        if (data.ok) setItems(data.suggestions);
      }
    } catch {
      setMsg({ ok: false, text: "انقطع الاتصال. أعد المحاولة." });
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setPending(id);
    try {
      const res = await fetch("/api/ai/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waqfId, fieldId: id, decision }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: data.error ?? "تعذر حفظ القرار." });
      else {
        setMsg({ ok: true, text: data.message });
        const applied = /طُبقت/.test(data.message ?? "");
        setItems((xs) => xs.map((x) => (x.id === id ? { ...x, status: decision === "reject" ? "rejected" : applied ? "applied" : "approved" } : x)));
      }
    } finally {
      setPending(null);
    }
  }

  if (!docs.length) {
    return <p className="text-[15px] text-muted">لا توجد وثائق نصية (PDF أو Word أو نص) يمكن للمساعد قراءتها في هذا الوقف. الوثائق السرية جدًا لا تُعالج آليًا.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="assist-doc" className="mb-1 block text-sm font-medium text-text">الوثيقة</label>
          <select id="assist-doc" value={docId} onChange={(e) => setDocId(e.target.value)} className="h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-[15px] text-text">
            {docs.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        </div>
        <Button type="button" variant="secondary" onClick={() => void extract()} disabled={busy || !docId}>
          {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <FileSearch aria-hidden className="size-4" />}
          {busy ? "أقرأ الملف…" : "اقترح البيانات"}
        </Button>
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-[15px] text-ok" : "text-[15px] text-fine"}>{msg.text}</p>
      ) : null}
      {items.length ? (
        <ul className="divide-y divide-line rounded-md border border-line" data-testid="assist-suggestions">
          {items.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">{s.label}</p>
                <p className="text-[15px] font-semibold text-text"><bdi>{s.display}</bdi></p>
                <p className="text-[13px] text-muted">
                  الثقة {pct(s.confidence)}
                  {s.current ? <> · المسجل الآن: <bdi>{s.current}</bdi></> : " · الحقل فارغ في الوثيقة"}
                </p>
                {s.evidence ? <p className="mt-1 truncate text-[13px] text-muted" title={s.evidence}>من النص: «{s.evidence}»</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS[s.status]?.tone ?? "neutral"} icon={false}>{STATUS[s.status]?.label ?? s.status}</Badge>
                {canDecide && s.status === "suggested" ? (
                  <>
                    <Button type="button" size="sm" onClick={() => void decide(s.id, "approve")} disabled={pending === s.id} aria-label={`اعتمد ${s.label}`}>
                      <Check aria-hidden className="size-4" /> اعتمد
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void decide(s.id, "reject")} disabled={pending === s.id} aria-label={`ارفض ${s.label}`}>
                      <X aria-hidden className="size-4" /> ارفض
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length && !canDecide ? <p className="text-[13px] text-muted">اعتماد القيم يحتاج صلاحية تعديل الوثائق. شارك الاقتراحات مع الناظر.</p> : null}
      {docId ? (
        <p className="text-[13px] text-muted">
          لا يُطبق أي اقتراح دون اعتمادك، ويُطبق فقط على الحقول الفارغة. <Link href={`/app/w/${waqfId}/documents/${docId}`} className="text-ink hover:underline">افتح صفحة الوثيقة</Link>
        </p>
      ) : null}
    </div>
  );
}
