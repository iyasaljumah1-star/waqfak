import { Badge } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export type Decision = { at: Date | null; label: string; note: string | null; tone: "ok" | "fine" | "critical" | "info"; open?: boolean };

/** Reviewers' notes still open first, then approval / rejection decisions, newest first. */
export function ReviewDecisions({ rows }: { rows: Decision[] }) {
  if (!rows.length) return <p className="text-sm text-muted">لا ملاحظات مراجعة ولا قرارات بعد.</p>;
  const sorted = [...rows].sort((a, b) => (a.open === b.open ? (+(b.at ?? 0) - +(a.at ?? 0)) : a.open ? -1 : 1));
  return (
    <ul className="divide-y divide-line" data-testid="review-decisions">
      {sorted.map((r, i) => (
        <li key={i} className="flex flex-col gap-1 py-2 text-[14px]">
          <span className="flex flex-wrap items-center gap-2">
            {r.open ? <Badge tone="fine" icon={false}>تحتاج معالجة</Badge> : null}
            <span className="font-medium">{r.label}</span>
            {r.at ? <span className="text-[12px] text-muted">{fmtDateTime(r.at)}</span> : null}
          </span>
          {r.note ? <span className="whitespace-pre-line text-muted">{r.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}
