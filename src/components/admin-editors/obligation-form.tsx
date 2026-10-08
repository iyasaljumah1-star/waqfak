"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { ActionState } from "@/lib/utils";
import { EditorForm, type Act } from "./editor-form";

type PreviewRow = { id: string; name: string; sizeClass: string | null; legalType: string | null; status: string; applies: boolean; reasons: string[] };
const SIZE: Record<string, string> = { large: "كبير", medium: "متوسط", small: "صغير", direct_benefit: "انتفاع مباشر" };
const TYPE: Record<string, string> = { public: "عام", private: "خاص", joint: "مشترك" };

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const n = rows.filter((r) => r.applies).length;
  return (
    <section aria-label="معاينة الانطباق" className="rounded-lg border border-line">
      <h3 className="border-b border-line px-4 py-2 text-[15px] font-semibold">
        معاينة الانطباق: <span className="tabular">{n}</span> من <span className="tabular">{rows.length}</span> وقفًا
      </h3>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-2 text-[14px]" data-testid="preview-row" data-applies={r.applies ? "yes" : "no"}>
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <Badge tone={r.applies ? "ok" : "neutral"}>{r.applies ? "ينطبق" : "لا ينطبق"}</Badge>
                <span className="font-medium">{r.name}</span>
                <span className="text-muted">{SIZE[r.sizeClass ?? ""] ?? "حجم غير محدد"} · {TYPE[r.legalType ?? ""] ?? "نوع غير محدد"}</span>
              </summary>
              <ul className="mt-1 list-disc ps-6 text-[13px] text-muted">
                {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Obligation editor form: save (re-syncs every waqf) + preview applicability against all waqfs before saving. */
export function ObligationForm({ save, preview, children, isNew }: { save: Act; preview: Act; children: ReactNode; isNew: boolean }) {
  const render = (s: ActionState) => (Array.isArray(s.data?.preview) ? <PreviewTable rows={s.data.preview as PreviewRow[]} /> : null);
  return (
    <EditorForm
      action={save}
      alt={preview}
      altLabel="عاين الانطباق على الأوقاف"
      submitLabel={isNew ? "احفظ الالتزام وطبّقه" : "احفظ وأعد المزامنة"}
      pendingText="جارٍ الحفظ وإعادة مزامنة الأوقاف…"
      confirmText={isNew ? undefined : "سيُعاد حساب التزامات جميع الأوقاف وفق التعريف الجديد. متابعة؟"}
      renderAlt={render}
    >
      {children}
    </EditorForm>
  );
}
