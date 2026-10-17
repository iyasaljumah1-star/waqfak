import { CONTEXT_STATUS_AR, type ContextBlock, type ContextStatus } from "@/server/modules/requests/context/types";
import { cn, fmtDate } from "@/lib/utils";

/**
 * Waqf-file records a service reads, shown with their source, last update and status. Used in the client's form (read
 * and confirm) and in the team's request workspace (with actions beside each block). Purely presentational.
 */

const TONE: Record<ContextStatus, string> = {
  recorded: "bg-ok-soft text-ok",
  partial: "bg-warn-soft text-warn",
  stale: "bg-fine-soft text-fine",
  missing: "bg-surface-2 text-muted",
};
const ROW_TONE: Record<string, string> = { stale: "text-fine", missing: "text-muted", warn: "text-warn" };

export function ContextStatusChip({ status }: { status: ContextStatus }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium", TONE[status])} data-status={status}>{CONTEXT_STATUS_AR[status]}</span>;
}

export function ContextBlockView({ b, waqfId, actions, children }: { b: ContextBlock; waqfId?: string | null; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section id={`ctx-${b.key}`} className="scroll-mt-24 rounded-lg border border-line bg-surface" data-testid={`ctx-${b.key}`} data-status={b.status}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold">{b.title}</h3>
          <p className="text-[13px] text-muted">
            المصدر: {waqfId && b.path ? <a className="underline-offset-4 hover:underline" href={`/app/w/${waqfId}${b.path}`}>{b.source}</a> : b.source}
            {b.asOf ? ` · آخر تحديث ${fmtDate(b.asOf)}` : ""}
          </p>
        </div>
        <ContextStatusChip status={b.status} />
      </header>
      <div className="space-y-3 px-4 py-3">
        {b.rows.length ? (
          <dl className="grid gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-2">
            {b.rows.map((r, i) => (
              <div key={i} className="flex justify-between gap-3 border-b border-line/60 pb-1 sm:block sm:border-0 sm:pb-0">
                <dt className="text-muted">{r.label}</dt>
                <dd className={cn("text-end sm:text-start", r.status ? ROW_TONE[r.status] : "")}>{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="text-[14px] text-muted">لا سجلات في ملف الوقف لهذا البند.</p>}
        {b.table ? (
          <details className="text-[14px]">
            <summary className="cursor-pointer text-ink">عرض التفاصيل ({b.table.rows.length})</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-start">
                <thead><tr className="text-[12px] text-muted">{b.table.columns.map((c) => <th key={c} className="px-2 py-1 text-start font-medium">{c}</th>)}</tr></thead>
                <tbody>{b.table.rows.map((row, i) => <tr key={i} className="border-t border-line">{row.map((c, j) => <td key={j} className="px-2 py-1 align-top">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </details>
        ) : null}
        {b.gaps.length ? (
          <ul className="space-y-0.5 text-[14px] text-fine" data-testid={`ctx-${b.key}-gaps`}>
            {b.gaps.map((g, i) => <li key={i}>• {g}</li>)}
          </ul>
        ) : null}
        {children}
        {actions ? <div className="flex flex-wrap gap-2 border-t border-line pt-3">{actions}</div> : null}
      </div>
    </section>
  );
}

export function ContextBlocksView({ blocks, waqfId }: { blocks: ContextBlock[]; waqfId?: string | null }) {
  if (!blocks.length) return null;
  return <div className="space-y-3" data-testid="context-blocks">{blocks.map((b) => <ContextBlockView key={b.key} b={b} waqfId={waqfId} />)}</div>;
}
