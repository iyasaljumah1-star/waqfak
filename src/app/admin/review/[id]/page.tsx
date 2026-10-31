import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { reviewDetail } from "@/server/engine/review/queries";
import { finalApprove, regenerateWithInstruction, reopenForEdit, retryProcessing, verifyAfterEdit } from "@/server/engine/review/actions";
import { raiseItem } from "@/server/modules/requests/items-actions";
import type { OutputSection } from "@/server/db/schema";
import { Alert, Badge, ButtonLink, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { SectionView } from "@/components/outputs/section-view";
import { StatusBadge } from "@/components/requests/bits";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "مراجعة الطلب واعتماده" };

const STEP_AR: Record<string, string> = {
  intake: "اكتمال التقديم", documents: "المستندات", rules: "القواعد", gaps: "النواقص على العميل", workflow: "التحقق والقبول",
  document: "التحليل والمخرج", verify: "التحقق الآلي", handoff: "الإحالة للاعتماد",
};
const STEP_TONE: Record<string, "ok" | "fine" | "critical" | "neutral" | "info"> = { ok: "ok", warn: "fine", blocked: "critical", failed: "critical", skipped: "neutral" };

/**
 * The system administrator's single screen for an engine-processed request: what was asked and given, what the platform
 * did and on what basis, the complete output, the verification, and the decisions — edit, regenerate with guidance,
 * ask the client, approve. Nothing here is visible to the client before the final approval.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireStaff("admin.requests.all");
  const d = await reviewDetail(auth, id);
  if (!d) notFound();
  const r = d.request;
  const lastRun = d.runs[0] ?? null;
  const outcome = (lastRun?.outcome ?? null) as { status?: string; summary?: string; blockers?: string[]; warnings?: string[] } | null;
  const verify = d.steps.find((s) => s.step === "verify");
  const docStep = d.steps.find((s) => s.step === "document");
  const rules = d.steps.find((s) => s.step === "rules");
  const deadJob = d.jobs.find((j) => j.status === "dead");
  const activeJob = d.jobs.find((j) => ["queued", "running"].includes(j.status));
  const ready = r.status === "quality_review";
  const answers = (r.details ?? "").trim();

  return (
    <div className="space-y-6" data-testid="review-page">
      <PageHeader
        crumbs={[{ href: "/admin/review", label: "المراجعة والاعتماد النهائي" }, { label: r.number }]}
        title={`${d.service.code} — ${d.service.nameAr}`}
        description={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="tabular">{r.number}</span><StatusBadge status={r.status} />{d.waqf ? <span>{d.waqf.name}{d.waqf.isDemo ? " (تجريبي)" : ""}</span> : null}<span>— {d.requester}</span></span>}
        actions={<ButtonLink href={`/admin/requests/${r.id}`} variant="secondary" size="sm">صفحة الطلب الكاملة</ButtonLink>}
      />
      {r.processingMode !== "engine" ? <Alert tone="info" title="طلب على مسار الفريق">هذا الطلب لا تعالجه المنصة آليًا؛ يُدار من صفحة الطلب.</Alert> : null}
      {activeJob ? <Alert tone="info" title="المعالجة جارية">{activeJob.reason} — المحاولة {activeJob.attempts || 1}. حدّث الصفحة بعد قليل.</Alert> : null}
      {deadJob && !activeJob ? (
        <Alert tone="critical" title="توقفت المعالجة بعد محاولاتها" action={d.canApprove ? <ActionForm action={retryProcessing} hidden={{ id: r.id }} submit="أعد المعالجة" size="sm" inline /> : null}>
          {deadJob.lastError ?? "خطأ غير محدد"}
        </Alert>
      ) : null}
      {outcome?.status === "blocked" ? (
        <div data-testid="review-blocked">
          <Alert tone="critical" title="تعذّر إكمال المخرج آليًا">
            <ul className="list-disc ps-5">{(outcome.blockers ?? []).slice(0, 12).map((b, i) => <li key={i}>{b}</li>)}</ul>
          </Alert>
        </div>
      ) : null}
      {outcome?.status === "waiting" ? <Alert tone="fine" title="بانتظار شرط خارج المنصة">{outcome.summary}</Alert> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6 break-words">
          <Panel title="الطلب ومدخلاته" id="inputs">
            <DefinitionList items={[
              { label: "أُرسل", value: fmtDateTime(r.submittedAt) },
              { label: "مقدم الطلب", value: d.requester ?? "—" },
              { label: "الوقف", value: d.waqf?.name ?? "بلا وقف" },
              { label: "الاستقلال", value: r.conflictCheck },
            ]} />
            {answers ? <pre className="mt-3 whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[14px] leading-7">{answers}</pre> : null}
            <h3 className="mt-4 font-semibold">المستندات</h3>
            <ul className="mt-1 space-y-1 text-[14px]">
              {d.docs.length ? d.docs.map((x) => <li key={x.id}><Link className="underline" href={`/api/files/${x.id}`}>{x.title}</Link> <span className="text-muted">({x.docType}{x.approvalStatus ? ` · ${x.approvalStatus}` : ""})</span></li>) : <li className="text-muted">لا مستندات.</li>}
            </ul>
            {d.items.length ? (
              <>
                <h3 className="mt-4 font-semibold">ما طُلب من العميل</h3>
                <ul className="mt-1 space-y-1 text-[14px]">{d.items.map((i) => <li key={i.id}>#{i.seq} {i.title} — <span className="text-muted">{i.status}{i.responseText ? `: ${i.responseText}` : ""}</span></li>)}</ul>
              </>
            ) : null}
          </Panel>

          <Panel title="التحليل وأساسه" id="basis" description="ما نفذته المنصة في آخر معالجة، والقواعد والمراجع التي استندت إليها. لا تُحفظ سلسلة تفكير النموذج؛ يُحفظ مبرر موجز ومصادره.">
            {lastRun ? (
              <div className="space-y-3 text-[14px]" data-testid="processing-record">
                <p>التشغيل <span dir="ltr" className="tabular">{lastRun.id.slice(0, 8)}</span> — المحاولة {lastRun.attempt} — {fmtDateTime(lastRun.startedAt)} — الإصدار <span dir="ltr">{lastRun.engineVersion}</span></p>
                <p>القواعد: {lastRun.rules.map((x) => `${x.id}@${x.version}`).join("، ") || "—"} · النموذج: {lastRun.model ? `${lastRun.model.provider} / ${lastRun.model.model} (${lastRun.model.calls} استدعاء، تعليمات ${lastRun.model.promptVersion})` : "لم يُستدعَ"} · المراجع: {lastRun.sources.map((x) => `${x.code} (${x.version})`).join("، ") || "—"}</p>
                {lastRun.instruction ? <p>توجيه مدير النظام: {lastRun.instruction}</p> : null}
                <ol className="space-y-1">
                  {d.steps.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2"><Badge tone={STEP_TONE[s.status] ?? "neutral"}>{STEP_AR[s.step] ?? s.step}</Badge><span className="text-muted">{s.status}{s.error ? ` — ${s.error}` : ""}</span></li>)}
                </ol>
                {rules ? <Findings summary={rules.summary} /> : null}
                {docStep ? <SectionsLog summary={docStep.summary} /> : null}
              </div>
            ) : <p className="text-muted">لم تبدأ المعالجة بعد.</p>}
          </Panel>

          {d.outputs.map((o) => {
            const v = d.versions.find((x) => x.outputId === o.id && x.version === o.currentVersion);
            return (
              <Panel key={o.id} title={`${o.title} — نسخة ${o.currentVersion}`} id={`output-${o.id}`} description={`الحالة: ${o.status}${o.approvedVersion ? ` · المعتمدة: ${o.approvedVersion}` : ""}`}
                actions={<ButtonLink href={`/admin/requests/${r.id}/outputs/${o.id}`} variant="secondary" size="sm">افتح في المحرر والمعاينة</ButtonLink>}>
                <div data-testid="review-output" className="space-y-4 overflow-x-auto">
                  {(v?.sections as OutputSection[] | undefined)?.filter((s) => !s.removed).map((s) => <SectionView key={s.key} s={s} internal />)}
                </div>
                <details className="mt-4 text-[14px]">
                  <summary className="cursor-pointer">سجل النسخ ({d.versions.filter((x) => x.outputId === o.id).length})</summary>
                  <ul className="mt-2 space-y-1">{d.versions.filter((x) => x.outputId === o.id).map((x) => <li key={x.version}>نسخة {x.version} — {x.origin} — {fmtDateTime(x.createdAt)} — {x.note}</li>)}</ul>
                </details>
              </Panel>
            );
          })}

          <Panel title="سجل الطلب" id="log">
            <ul className="space-y-1 text-[14px]">{d.events.map((e) => <li key={e.id}>{fmtDateTime(e.at)} — {e.actor ?? "—"}: {e.note}{e.internal ? <span className="text-muted"> (داخلي)</span> : null}</li>)}</ul>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6 break-words">
          <Panel title="نتيجة التحقق الآلي" id="verification">
            {verify ? (
              <div className="space-y-2 text-[14px]" data-testid="verification">
                <Badge tone={verify.status === "ok" ? "ok" : "critical"}>{verify.status === "ok" ? "اجتاز التحقق" : "لم يجتز التحقق"}</Badge>
                {((verify.summary as { errors?: string[] }).errors ?? []).map((x, i) => <p key={i} className="text-critical">{x}</p>)}
                {((verify.summary as { warnings?: string[] }).warnings ?? []).map((x, i) => <p key={i} className="text-fine">{x}</p>)}
              </div>
            ) : <p className="text-muted text-[14px]">لم يُتحقق بعد.</p>}
          </Panel>

          {d.canApprove ? (
            <>
              {ready ? (
                <Panel title="الاعتماد النهائي" id="approve">
                  {d.professional ? <Alert tone="seal" title="شرط مهني لهذه الخدمة">{d.professional}. لا يغني عنه اعتماد مدير النظام.</Alert> : null}
                  <ActionForm action={finalApprove} hidden={{ id: r.id }} submit="اعتمد وأتح للعميل">
                    {d.professional ? (
                      <>
                        <Field label="اسم المختص المرخص وصفته" name="professionalName"><Input name="professionalName" /></Field>
                        <Field label="رقم الترخيص" name="professionalLicense"><Input name="professionalLicense" /></Field>
                      </>
                    ) : null}
                    <Field label="ملاحظة الاعتماد (اختيارية)" name="note"><Textarea name="note" rows={2} /></Field>
                    <Checkbox name="confirm" label="راجعت المخرج كاملًا ومدخلاته وأساسه، وأعتمد النسخة الحالية." />
                  </ActionForm>
                </Panel>
              ) : null}
              {["quality_review", "in_progress"].includes(r.status) ? (
                <Panel title="إعادة التوليد بتوجيه" id="regenerate">
                  <ActionForm action={regenerateWithInstruction} hidden={{ id: r.id }} submit="أعد التوليد" variant="secondary">
                    <Field label="التوجيه" name="instruction" hint="مثال: اربط التوصية بالمادة المعنية في لائحة النظارة، واذكر ما يلزم لحسم المسألة."><Textarea name="instruction" rows={3} /></Field>
                  </ActionForm>
                </Panel>
              ) : null}
              {ready ? (
                <Panel title="تعديل المخرج مباشرة" id="edit">
                  <ActionForm action={reopenForEdit} hidden={{ id: r.id }} submit="افتح للتعديل" variant="secondary" />
                </Panel>
              ) : null}
              {r.status === "in_progress" && d.outputs.some((o) => o.status === "returned" || o.status === "draft") ? (
                <Panel title="بعد التعديل" id="verify-after-edit">
                  <ActionForm action={verifyAfterEdit} hidden={{ id: r.id }} submit="أعد التحقق وأحِل للاعتماد" variant="secondary" />
                </Panel>
              ) : null}
              {["quality_review", "in_progress", "triage"].includes(r.status) ? (
                <Panel title="اطلب من العميل استكمالًا" id="ask">
                  <ActionForm action={raiseItem} hidden={{ id: r.id, kind: "question", required: "on" }} submit="أرسل الطلب للعميل" variant="secondary">
                    <Field label="العنوان" name="title"><Input name="title" /></Field>
                    <Field label="التفاصيل" name="body"><Textarea name="body" rows={3} /></Field>
                  </ActionForm>
                </Panel>
              ) : null}
            </>
          ) : <Alert tone="info" title="للاطلاع">الاعتماد النهائي لمدير النظام الأعلى وحده.</Alert>}

          {d.corrections.length ? (
            <Panel title="طلبات تصحيح من العميل" id="corrections">
              <ul className="space-y-2 text-[14px]">{d.corrections.map((t) => <li key={t.id}>{fmtDateTime(t.createdAt)} — {t.description} <span className="text-muted">({t.status})</span></li>)}</ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Findings({ summary }: { summary: Record<string, unknown> }) {
  const f = (summary.findings as { rule: string; effect: string; message: string }[] | undefined) ?? [];
  if (!f.length) return <p className="text-muted">لم تنطبق قاعدة تستوقف الطلب.</p>;
  return <ul className="list-disc ps-5">{f.map((x, i) => <li key={i}><span dir="ltr">{x.rule}</span> ({x.effect}): {x.message}</li>)}</ul>;
}

function SectionsLog({ summary }: { summary: Record<string, unknown> }) {
  const s = (summary.sections as { section: string; by: string; cited?: string[]; rationale?: string; reason?: string; rejected?: string[] }[] | undefined) ?? [];
  const problems = (summary.problems as string[] | undefined) ?? [];
  return (
    <div className="space-y-1">
      {s.map((x, i) => (
        <p key={i}><strong>{x.section}</strong>: {x.by === "none" ? `لم يُكتب (${x.reason})` : x.rejected ? `رُفض الناتج: ${x.rejected.join("؛ ")}` : `${x.by}${x.cited?.length ? ` — يستند إلى ${x.cited.join("؛ ")}` : ""}${x.rationale ? ` — ${x.rationale}` : ""}`}</p>
      ))}
      {problems.map((p, i) => <p key={`p${i}`} className="text-critical">{p}</p>)}
    </div>
  );
}
