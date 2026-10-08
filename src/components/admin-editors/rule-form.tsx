"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { ActionState } from "@/lib/utils";
import { EditorForm, type Act } from "./editor-form";

type RecLite = { ruleCode: string; titleAr: string; severity: string; priority: number; wave: number; status: string; serviceCodes: string[] };
type Result = {
  match: boolean;
  conditionValue: string;
  suppressed: boolean;
  factsCount: number;
  source: string;
  thisRule: (Omit<RecLite, "ruleCode"> & { removed: { code: string; why: string }[]; suppressedNote: string | null; reasonAr: string }) | null;
  recs: RecLite[];
  missingVars: string[];
};
const SEV: Record<string, { l: string; t: "critical" | "fine" | "warn" | "info" }> = {
  critical: { l: "حرج", t: "critical" }, high: { l: "مرتفع", t: "fine" }, medium: { l: "متوسط", t: "warn" }, low: { l: "منخفض", t: "info" },
};
const WAVE: Record<number, string> = { 1: "الموجة 1 (30 يومًا)", 2: "الموجة 2 (90 يومًا)", 3: "الموجة 3 (12 شهرًا)" };

function TestResult({ r, code }: { r: Result; code: string }) {
  return (
    <section aria-label="نتيجة اختبار القاعدة" data-testid="rule-test-result" className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={r.match ? "ok" : "neutral"}>{r.match ? "تنطبق" : "لا تنطبق"}</Badge>
        {r.suppressed ? <Badge tone="warn">مكتومة</Badge> : null}
        <span className="text-[13px] text-muted">{r.source} · {r.factsCount} حقيقة · قيمة الشرط <code dir="ltr">{r.conditionValue}</code></span>
      </div>
      {r.missingVars.length ? <p className="text-[13px] text-fine">حقائق يستخدمها الشرط وغير موجودة في المدخلات: <span dir="ltr">{r.missingVars.join(", ")}</span></p> : null}
      {r.thisRule ? (
        <div className="rounded-md bg-surface-2 p-3 text-[14px]">
          <p className="font-semibold">{r.thisRule.titleAr}</p>
          <p className="text-muted">{r.thisRule.reasonAr}</p>
          <p className="mt-1 flex flex-wrap gap-2">
            <Badge tone={SEV[r.thisRule.severity]?.t ?? "neutral"}>{SEV[r.thisRule.severity]?.l}</Badge>
            <span>الأولوية <span className="tabular">{r.thisRule.priority}</span></span>
            <span>{WAVE[r.thisRule.wave]}</span>
          </p>
          <p className="mt-1">الخدمات المقترحة: {r.thisRule.serviceCodes.length ? r.thisRule.serviceCodes.join("، ") : "لا شيء"}</p>
          {r.thisRule.removed.length ? (
            <ul className="mt-1 list-disc ps-6 text-[13px] text-muted">
              {r.thisRule.removed.map((x) => <li key={x.code}>{x.code}: {x.why}</li>)}
            </ul>
          ) : null}
          {r.thisRule.suppressedNote ? <p className="mt-1 text-[13px] text-fine">{r.thisRule.suppressedNote}</p> : null}
        </div>
      ) : null}
      <details>
        <summary className="cursor-pointer text-[14px] font-medium">التوصيات الناتجة من مجموعة القواعد المنشورة مع هذه النسخة ({r.recs.length})</summary>
        <ol className="mt-2 space-y-1 text-[13px]">
          {r.recs.map((x) => (
            <li key={x.ruleCode} className={x.ruleCode === code ? "font-semibold text-ink" : ""}>
              <span dir="ltr" className="tabular">{x.ruleCode}</span> — {x.titleAr} · {SEV[x.severity]?.l} · موجة {x.wave} · أولوية {x.priority}{x.status === "suppressed" ? " · مكتومة" : ""}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

/** Rule editor: save the draft, or test the rule as currently typed (no save needed). */
export function RuleForm({ save, test, children, code, readOnly }: { save: Act; test: Act; children: ReactNode; code: string; readOnly?: boolean }) {
  const render = (s: ActionState) => (s.data?.result ? <TestResult r={s.data.result as Result} code={code} /> : null);
  return (
    <EditorForm action={save} alt={test} altLabel="اختبر القاعدة" altVariant="seal" submitLabel="احفظ المسودة" hideMain={readOnly} renderAlt={render}>
      {children}
    </EditorForm>
  );
}
