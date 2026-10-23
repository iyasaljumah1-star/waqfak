import Link from "next/link";
import { Badge, Panel } from "@/components/ui";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtDateTime } from "@/lib/utils";
import type { OutputBlock, OutputCheck, OutputSection } from "@/server/db/schema/operations";
import { CHECK_STATUS_AR, CHECK_STATUS_TONE, REVIEW_STATUS_AR, DECISION_AR } from "@/server/modules/outputs/checks";
import { BINDING_AR, CITATION_REVIEW_AR, citationOf } from "@/server/modules/outputs/citations";
import type { Conflict } from "@/server/modules/outputs/conflicts";
import type { DiffSeg } from "@/server/modules/outputs/pure";
import { REQ_NEED_AR, REQ_OWNER_AR, REQ_SCOPE_AR, REQ_STATUS_AR, type Requirement, type ReqScope, type ReqStatus } from "@/server/modules/outputs/requirements";
import { recordCheckFinding, recordCitationReview, recordOfficialDoc, raiseConflictItem } from "@/server/modules/outputs/review-actions";
import { STAGES, type OutputStage } from "@/server/modules/outputs/stages";

/** Panels of the output page: stage, summary, conflicts, deficiency list, checks, references, official documentation. */

export function StagePanel({ stage, next }: { stage: OutputStage; next: string }) {
  const at = STAGES.findIndex((s) => s.key === stage);
  return (
    <section aria-label="مرحلة المخرج" className="rounded-lg border border-line bg-surface p-4" data-testid="output-stage" data-stage={stage}>
      <ol className="flex flex-wrap gap-x-1 gap-y-2 text-[13px]">
        {STAGES.map((s, i) => (
          <li key={s.key} aria-current={i === at ? "step" : undefined}
            className={i === at ? "rounded-full bg-ink px-3 py-0.5 font-semibold text-white" : i < at && s.key !== "returned" ? "rounded-full bg-ink-soft px-3 py-0.5 text-ink" : "rounded-full border border-line px-3 py-0.5 text-muted"}>
            {s.label}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[15px]"><span className="font-semibold">الإجراء التالي: </span><span data-testid="output-next">{next}</span></p>
    </section>
  );
}

export function SummaryPanel({ conflicts, mandatory, specialist, failed, stale }: { conflicts: number; mandatory: number; specialist: number; failed: number; stale: boolean }) {
  const items = [
    { href: "#conflicts", n: conflicts, label: "تعارض في البيانات", tone: "critical" as const },
    { href: "#requirements", n: mandatory, label: "بند إلزامي ناقص", tone: "critical" as const },
    { href: "#checks", n: failed, label: "فحص فشل", tone: "critical" as const },
    { href: "#checks", n: specialist, label: "بانتظار رأي المختص", tone: "seal" as const },
  ];
  return (
    <nav aria-label="ملخص النواقص والتعارضات" className="flex flex-wrap gap-2" data-testid="output-summary">
      {items.map((x) => (
        <a key={x.label} href={x.href} className="rounded-md border border-line px-3 py-2 text-[14px] hover:bg-ink-soft">
          <span className={x.n ? (x.tone === "critical" ? "font-semibold text-critical" : "font-semibold text-seal") : "text-muted"}>{x.n}</span> {x.label}
        </a>
      ))}
      {stale ? <a href="#actions" className="rounded-md border border-fine px-3 py-2 text-[14px] text-fine">تغيّرت بيانات الطلب بعد هذه النسخة — أعد التوليد</a> : null}
    </nav>
  );
}

type RegisterRow = { id: string; conflictKey: string; label: string; status: string; severity: string; sides: Conflict["sides"]; action: string; detectedAt: Date; resolvedAt: Date | null; resolution: string | null; itemId: string | null; detectedByName: string | null; resolvedByName: string | null };

export function ConflictsPanel({ live, register, requestId, canAct }: { live: Conflict[]; register: RegisterRow[]; requestId: string; canAct: boolean }) {
  const openRows = new Map(register.filter((r) => r.status === "open").map((r) => [r.conflictKey, r]));
  const history = register.filter((r) => r.status === "resolved");
  return (
    <Panel id="conflicts" title="التعارضات في البيانات" description="لا تختار المنصة قيمة ولا تخفي التعارض. يُصحَّح من مصدره (إجابة العميل أو ملف الوقف أو المستند) ثم يُعاد التحقق.">
      {live.length ? (
        <ul className="space-y-3" data-testid="conflicts-live">
          {live.map((c) => {
            const row = openRows.get(c.key);
            return (
              <li key={c.key} className="rounded-md border border-critical/40 p-3" data-testid={`conflict-${c.key}`}>
                <p className="font-semibold text-critical">{c.label} <Badge tone={c.severity === "material" ? "critical" : "fine"} icon={false}>{c.severity === "material" ? "جوهري: يمنع المراجعة والاعتماد" : "غير جوهري"}</Badge></p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-[14px]">
                    <thead><tr className="border-b border-line text-muted"><th className="px-2 py-1 text-start font-medium">الحقل</th><th className="px-2 py-1 text-start font-medium">القيمة</th><th className="px-2 py-1 text-start font-medium">المصدر</th></tr></thead>
                    <tbody>{c.sides.map((s, i) => <tr key={i} className="border-b border-line/60"><td className="px-2 py-1">{s.label}</td><td className="px-2 py-1">«{s.value}»</td><td className="px-2 py-1 text-muted">{s.source}</td></tr>)}</tbody>
                  </table>
                </div>
                <p className="mt-2 text-[14px]"><span className="font-medium">المطلوب: </span>{c.action}</p>
                <p className="mt-1 text-[13px] text-muted">
                  {row ? <>رُصد {fmtDateTime(row.detectedAt)}{row.detectedByName ? ` (${row.detectedByName})` : ""}. </> : "يُسجَّل في السجل عند التوليد أو الإرسال. "}
                  <Link className="text-ink underline" href={`/admin/requests/${requestId}#intake`}>صحّح البيانات من صفحة الطلب</Link>
                  {row?.itemId ? " · طُلب من العميل تصحيحه في سجل النواقص." : ""}
                </p>
                {canAct && row && !row.itemId ? (
                  <ActionForm action={raiseConflictItem} hidden={{ requestId, conflictId: row.id }} submit="اطلب من العميل تحديد القيمة المقصودة" size="sm" variant="secondary" />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-[15px] text-ok" data-testid="conflicts-none">لا تعارض في البيانات الحالية.</p>}
      {history.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[14px] text-ink">تعارضات حُلّت ({history.length})</summary>
          <ul className="mt-2 space-y-2 text-[13px]" data-testid="conflicts-history">
            {history.map((r) => (
              <li key={r.id} className="rounded-md border border-line p-2">
                <p className="font-medium">{r.label}</p>
                <p className="text-muted">{r.sides.map((s) => `${s.label}: «${s.value}»`).join(" ↔ ")}</p>
                <p className="text-muted">رُصد {fmtDateTime(r.detectedAt)}{r.detectedByName ? ` (${r.detectedByName})` : ""} · حُلّ {r.resolvedAt ? fmtDateTime(r.resolvedAt) : "—"}{r.resolvedByName ? ` (${r.resolvedByName})` : ""} — {r.resolution}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

const REQ_TONE: Record<ReqStatus, "ok" | "info" | "critical" | "seal" | "neutral" | "fine"> = { met: "ok", attested: "info", missing: "critical", conflict: "critical", failed: "critical", pending_review: "seal", na: "neutral" };
const SCOPES: ReqScope[] = ["common", "service", "document", "specialist"];

export function RequirementsPanel({ list }: { list: Requirement[] }) {
  return (
    <Panel id="requirements" title="قائمة المتطلبات والنواقص" description="لكل بند: لماذا يلزم، وأهميته، ومصدره، ومن يستكمله، وحالته، وأثره على المرحلة التالية. المعاينة والحفظ والتعديل الداخلي متاحة دائمًا.">
      <div className="space-y-4" data-testid="requirements">
        {SCOPES.map((sc) => {
          const rows = list.filter((r) => r.scope === sc);
          if (!rows.length) return null;
          return (
            <div key={sc}>
              <h3 className="mb-1 text-[15px] font-semibold">{REQ_SCOPE_AR[sc]}</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-[13px]">
                  <thead><tr className="border-b border-line text-muted">{["البند", "لماذا يلزم", "الأهمية", "المصدر", "المسؤول", "الحالة", "الأثر"].map((h) => <th key={h} className="px-2 py-1 text-start font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-b border-line/60 align-top" data-testid={`req-${r.key}`} data-status={r.status}>
                        <td className="px-2 py-1 font-medium">{r.label}{r.detail ? <p className="font-normal text-muted">{r.detail}</p> : null}</td>
                        <td className="px-2 py-1">{r.why}</td>
                        <td className="px-2 py-1">{REQ_NEED_AR[r.need]}</td>
                        <td className="px-2 py-1 text-muted">{r.source}</td>
                        <td className="px-2 py-1">{REQ_OWNER_AR[r.owner]}</td>
                        <td className="px-2 py-1"><Badge tone={REQ_TONE[r.status]} icon={false}>{REQ_STATUS_AR[r.status]}</Badge></td>
                        <td className="px-2 py-1 text-muted">{r.effect || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

type Finding = { status: "verified" | "failed" | "na"; note: string; byName: string | null; at: string; version: number };

export function ChecksPanel({ checks, findings, canReview, outputId, requestId, open }: { checks: OutputCheck[]; findings: Map<string, Finding>; canReview: boolean; outputId: string; requestId: string; open: boolean }) {
  if (!checks.length) return null;
  return (
    <Panel id="checks" title="فحوص الصياغة" description="لا تظهر علامة نجاح لمجرد وجود إجابة. كل فحص يبيّن سببه ومصدر بياناته وقاعدته، وهل نتيجته آلية أم تحتاج مختصًا. هذه ملاحظات داخلية لا تظهر في نسخة العميل.">
      <ul className="space-y-3" data-testid="checks">
        {checks.map((c) => {
          const f = findings.get(c.key);
          const reviewable = c.status === "specialist" || c.status === "client_attested";
          return (
            <li key={c.key} className="rounded-md border border-line p-3" data-testid={`check-${c.key}`} data-status={c.status}>
              <p className="flex flex-wrap items-center gap-2 font-semibold">{c.label}<Badge tone={CHECK_STATUS_TONE[c.status]} icon={c.status === "verified" || c.status === "failed"}>{CHECK_STATUS_AR[c.status]}</Badge><span className="text-[12px] font-normal text-muted">{c.mode === "auto" ? "نتيجة آلية" : "تحقق مهني"}</span></p>
              <p className="mt-1 text-[14px]">{c.reason}</p>
              <dl className="mt-1 grid gap-x-3 text-[12px] text-muted sm:grid-cols-[6rem_1fr]">
                <dt>البيانات</dt><dd>{c.source}</dd>
                <dt>القاعدة</dt><dd>{c.rule}</dd>
              </dl>
              {f ? <p className="mt-2 rounded bg-seal-soft/40 p-2 text-[13px]" data-testid={`finding-${c.key}`}><span className="font-medium">{c.kind === "decision" ? DECISION_AR[f.status] : REVIEW_STATUS_AR[f.status]}</span> — {f.note} <span className="text-muted">({f.byName ?? "—"}، {fmtDateTime(new Date(f.at))}، النسخة {f.version})</span></p> : null}
              {canReview && reviewable && open ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[13px] text-ink">{f ? "حدّث رأيك" : "سجّل رأي المختص"}</summary>
                  <ActionForm action={recordCheckFinding} hidden={{ outputId, requestId, key: c.key }} submit="سجّل الرأي" size="sm" className="mt-2">
                    {c.kind === "decision" ? (
                      <>
                        <Field label="القرار" name={`st-${c.key}`}><Select name="status" id={`st-${c.key}`} options={[{ value: "verified", label: DECISION_AR.verified }, { value: "failed", label: DECISION_AR.failed }, { value: "na", label: DECISION_AR.na }]} /></Field>
                        <Field label="القرار ومبرره (ما قرره الواقف أو المختص، والبند الذي طُبق فيه، أو سبب عدم الانطباق)" name={`nt-${c.key}`} hint="«تحتاج قرار الواقف أو إيضاحه» يمنع الاعتماد حتى يُحسم؛ أرسل للعميل استفسارًا من «طلب استكمال» على الحقل المعني."><Textarea id={`nt-${c.key}`} name="note" required minLength={10} className="min-h-16" /></Field>
                      </>
                    ) : (
                      <>
                        <Field label="الرأي" name={`st-${c.key}`}><Select name="status" id={`st-${c.key}`} options={[{ value: "verified", label: "تحقق منه المختص" }, { value: "failed", label: "غير مستوفٍ" }, { value: "na", label: "لا ينطبق" }]} /></Field>
                        <Field label="سند الرأي (المستند أو المرجع الذي اطلعت عليه)" name={`nt-${c.key}`}><Textarea id={`nt-${c.key}`} name="note" required minLength={10} className="min-h-16" /></Field>
                      </>
                    )}
                  </ActionForm>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

type RefRow = { code: string; name: string; binding: string; verification: string; url: string | null; documentId: string | null; lastVerifiedOn: string | null };
type CitationReview = { status: string; note: string; location: string | null; byName: string | null; at: string; version: number };

export function ReferencesPanel({ sections, refs, reviews, outputId, requestId, canReview }: { sections: OutputSection[]; refs: Map<string, RefRow>; reviews: Map<string, CitationReview>; outputId: string; requestId: string; canReview: boolean }) {
  const clauses = sections.flatMap((s) => s.blocks.filter((b): b is Extract<OutputBlock, { type: "clause" }> => b.type === "clause"));
  if (!clauses.length) return null;
  return (
    <Panel id="references" title="مراجع البنود" description="كل بند مربوط بمصدره وموضعه. يسجّل المختص هل يؤيد المصدر الصياغة، أو يحتاج مصدرًا آخر، أو أن المصدر غير متاح أو لم يُتحقق منه. لا تُنشأ أرقام مواد أو مراجع غير موجودة.">
      <ul className="space-y-3" data-testid="references">
        {clauses.map((cl) => (
          <li key={cl.key} className="rounded-md border border-line p-3">
            <p className="font-medium">{cl.n}. {cl.title}</p>
            {(cl.refs ?? []).map((ref) => {
              const c = citationOf(ref);
              const r = c ? refs.get(c.refCode) : undefined;
              const rv = reviews.get(`${cl.key}|${ref}`);
              return (
                <div key={ref} className="mt-2 rounded bg-surface-2 p-2 text-[13px]" data-testid={`ref-${cl.key}-${ref}`}>
                  {c ? (
                    <>
                      <p><span className="font-medium">{r?.name ?? c.refCode}</span> — {c.location}</p>
                      <p className="text-muted">ما يُستشهد به: {c.topic}</p>
                      <p className="flex flex-wrap gap-2 text-muted">
                        <span>{r ? BINDING_AR[r.binding] ?? r.binding : "غير مسجل في سجل المراجع"}</span>
                        <span>· {r?.verification === "verified" ? `متحقق من صيغته${r.lastVerifiedOn ? ` (${r.lastVerifiedOn})` : ""}` : "بانتظار التحقق من صيغته"}</span>
                        {r?.url ? <a className="text-ink underline" href={r.url} target="_blank" rel="noopener noreferrer">افتح المصدر</a> : null}
                        {r?.documentId ? <a className="text-ink underline" href={`/api/files/${r.documentId}?disposition=inline`} target="_blank" rel="noopener">النسخة المحفوظة</a> : <span>· لا نسخة محفوظة في المنصة</span>}
                      </p>
                    </>
                  ) : <p className="text-fine">مرجع نصي غير مربوط بسجل المراجع: «{ref}» — لم يُتحقق منه.</p>}
                  {rv ? <p className="mt-1" data-testid={`refreview-${cl.key}-${ref}`}><Badge tone={rv.status === "supports" ? "ok" : rv.status === "needs_more" ? "fine" : "neutral"} icon={false}>{CITATION_REVIEW_AR[rv.status as keyof typeof CITATION_REVIEW_AR] ?? rv.status}</Badge> {rv.note}{rv.location ? ` (الموضع: ${rv.location})` : ""} <span className="text-muted">— {rv.byName ?? "—"}، النسخة {rv.version}</span></p> : <p className="mt-1 text-muted">لم يراجعه مختص بعد.</p>}
                  {canReview ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-ink">سجّل مراجعة المرجع</summary>
                      <ActionForm action={recordCitationReview} hidden={{ outputId, requestId, clause: cl.key, ref }} submit="سجّل" size="sm" className="mt-2">
                        <Field label="النتيجة" name={`cs-${cl.key}-${ref}`}><Select id={`cs-${cl.key}-${ref}`} name="status" options={Object.entries(CITATION_REVIEW_AR).map(([value, label]) => ({ value, label }))} /></Field>
                        <Field label="الموضع الذي اطلعت عليه (صفحة أو مادة)" name={`cl-${cl.key}-${ref}`}><Input id={`cl-${cl.key}-${ref}`} name="location" defaultValue={c?.location ?? ""} /></Field>
                        <Field label="وجه الاستدلال أو سبب الحكم" name={`cn-${cl.key}-${ref}`}><Textarea id={`cn-${cl.key}-${ref}`} name="note" required minLength={5} className="min-h-16" /></Field>
                      </ActionForm>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type OfficialRow = { r: { id: string; authority: string; referenceNo: string; issuedOn: string; documentId: string; version: number; createdAt: Date; note: string | null }; by: string | null };

export function OfficialPanel({ rows, approved, canRecord, docs, outputId, requestId }: { rows: OfficialRow[]; approved: boolean; canRecord: boolean; docs: { id: string; title: string }[]; outputId: string; requestId: string }) {
  return (
    <Panel id="official" title="التوثيق الرسمي" description="اعتماد «وقفك» داخلي ولا يُعد توثيقًا. يُسجَّل التوثيق بعد حصوله فقط، مع الوثيقة الرسمية نفسها.">
      {rows.length ? (
        <ul className="space-y-2 text-[14px]" data-testid="official-records">
          {rows.map(({ r, by }) => <li key={r.id}>{r.authority} — رقم {r.referenceNo} بتاريخ {r.issuedOn} (النسخة {r.version}) · <a className="text-ink underline" href={`/api/files/${r.documentId}?disposition=inline`} target="_blank" rel="noopener">الوثيقة</a> <span className="text-muted">— سجّله {by ?? "—"} {fmtDateTime(r.createdAt)}</span></li>)}
        </ul>
      ) : <p className="text-[14px] text-muted" data-testid="official-none">لم يُسجَّل توثيق رسمي.</p>}
      {approved && canRecord ? (
        docs.length ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-[14px] text-ink">سجّل التوثيق الرسمي</summary>
            <ActionForm action={recordOfficialDoc} hidden={{ outputId, requestId }} submit="سجّل التوثيق" size="sm" className="mt-2">
              <Field label="الجهة" name="authority"><Input name="authority" id="authority" required /></Field>
              <Field label="رقم الوثيقة الرسمية" name="referenceNo"><Input name="referenceNo" id="referenceNo" required /></Field>
              <Field label="تاريخ التوثيق" name="issuedOn"><Input type="date" name="issuedOn" id="issuedOn" required /></Field>
              <Field label="الوثيقة (من مستندات الطلب)" name="documentId"><Select name="documentId" id="documentId" options={docs.map((x) => ({ value: x.id, label: x.title }))} /></Field>
              <Checkbox name="verified" required label="اطلعت على الوثيقة الرسمية نفسها وطابقت بياناتها مع النسخة المعتمدة." />
              <Field label="ملاحظة" name="onote"><Input name="note" id="onote" /></Field>
            </ActionForm>
          </details>
        ) : <p className="text-[13px] text-muted">ارفع الوثيقة الرسمية في مستندات الطلب ثم سجّل التوثيق.</p>
      ) : null}
    </Panel>
  );
}

/** Word-level highlights of a changed section (removed words struck, added words marked). */
export function WordDiff({ segs }: { segs: DiffSeg[] }) {
  return (
    <p className="whitespace-pre-wrap text-[14px] leading-7" data-testid="word-diff">
      {segs.map((x, i) => x.t === "same" ? <span key={i}>{x.s}</span> : x.t === "add" ? <ins key={i} className="rounded bg-ok-soft px-0.5 text-ok no-underline">{x.s}</ins> : <del key={i} className="rounded bg-critical-soft px-0.5 text-critical">{x.s}</del>)}
    </p>
  );
}

/** The data a clause rests on (internal view): field, value, state, source and date. */
export function ClauseData({ b }: { b: Extract<OutputBlock, { type: "clause" }> }) {
  if (!b.data?.length) return null;
  const ST: Record<string, string> = { provided: "مُدخل", missing: "ناقص", conflict: "متعارض", default: "قيمة افتراضية", computed: "محسوب" };
  return (
    <details className="mt-1 text-[12px]">
      <summary className="cursor-pointer text-muted">البيانات التي بُني عليها البند ({b.data.length})</summary>
      <ul className="mt-1 space-y-0.5">
        {b.data.map((x, i) => <li key={i} className={x.status === "conflict" ? "text-critical" : x.status === "missing" ? "text-fine" : ""}>{x.label ?? x.field}: {x.value || "—"} · {ST[x.status] ?? x.status}{x.source ? ` · ${x.source}` : ""}{x.at ? ` · ${x.at}` : ""}</li>)}
      </ul>
    </details>
  );
}
