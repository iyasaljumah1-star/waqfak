import type { Metadata } from "next";
import Link from "next/link";
import { withSystem } from "@/server/db";
import { read } from "@/server/modules/_shared";
import { requireAdmin } from "@/server/modules/admin/guard";
import { comparisonQueue, REVIEW_ROLE_AR, reviewQueue } from "@/server/knowledge/review";
import { recordComparisonDecision, recordKnowledgeReview } from "@/server/modules/admin/knowledge/actions";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { Select, Textarea } from "@/components/ui/form";
import { EditorForm, EField } from "@/components/admin-editors/editor-form";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "مراجعة قاعدة المعرفة" };

const DECISIONS = [{ value: "accepted", label: "قبول للاستشهاد" }, { value: "rejected", label: "رفض" }];

/**
 * What needs a human review before the engine may cite it, and the form to record one. Reviewers are named by the owner
 * through the users page (roles «مراجع …»); no account holds a review permission by default. Every review is recorded
 * in the reviewer's own session, checked against the permission of the source's field, and audited.
 */
export default async function KnowledgeReviewAdmin({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const auth = await requireAdmin("knowledge.review.legal", "knowledge.review.sharia", "knowledge.review.accounting", "knowledge.review.data", "knowledge.review.investment", "admin.roles");
  const { ref } = await searchParams;
  const mine = (["legal", "sharia", "accounting", "data", "investment"] as const).filter((r) => auth.perms.has(`knowledge.review.${r}`));
  const queue = await read(auth, (tx) => reviewQueue(tx, ref ? { refCodes: [ref], passages: true } : {}));
  const runs = mine.includes("legal") ? await withSystem((tx) => comparisonQueue(tx)) : [];
  return (
    <EditorPage>
      <PageHeader
        title="مراجعة قاعدة المعرفة"
        description="لا يُستشهد بمصدر غير نظامي أو بمقطع مستخرج من ملف إلا بعد مراجعة مختص من مجاله. المراجعة تُسجل باسمك وفي جلستك، وتُقيد في سجل التدقيق، وتسقط إذا سُحبت صلاحيتك."
        crumbs={[{ href: "/admin", label: "الإدارة" }, { label: "مراجعة قاعدة المعرفة" }]}
      />
      <Panel title="صلاحياتك في المراجعة">
        {mine.length ? <p>{mine.map((r) => REVIEW_ROLE_AR[r]).join("، ")}</p> : <p className="text-muted">لا تحمل أي صلاحية مراجعة. يمنحها مسؤول النظام من صفحة المستخدمين بأحد أدوار «مراجع …».</p>}
      </Panel>
      {ref ? <p><Link href="/admin/knowledge" className="underline">كل المصادر</Link></p> : null}
      <Panel title={ref ? `ما يحتاج مراجعة في ${ref}` : "المصادر التي تحتاج مراجعة"} tight>
        <ul className="divide-y divide-line">
          {queue.map((q, i) => (
            <li key={`${q.refCode}-${q.locator ?? ""}-${i}`} className="px-4 py-3 md:px-5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span dir="ltr" className="text-[13px] text-muted">{q.refCode}</span>
                <span className="font-medium">{q.title}</span>
                {q.locator ? <span>{q.locator}</span> : null}
                <Badge tone="warn">{REVIEW_ROLE_AR[q.role]}</Badge>
                {!ref ? <Link href={`/admin/knowledge?ref=${encodeURIComponent(q.refCode)}`} className="text-[13px] underline">المقاطع</Link> : null}
              </div>
              <p className="mt-1 text-[13px] text-muted">{q.reason}</p>
              {q.excerpt ? <details className="mt-1"><summary className="cursor-pointer text-[13px]">نص المقطع كما في قاعدة المعرفة (قابله بصورة الصفحة)</summary><p className="mt-1 whitespace-pre-wrap text-[14px] leading-7">{q.excerpt}</p></details> : null}
              <p dir="ltr" className="mt-1 text-[12px] text-muted">source {q.sourceId}{q.chunkId ? ` · passage ${q.chunkId}` : ""}</p>
            </li>
          ))}
          {!queue.length ? <li className="px-4 py-3 text-muted">لا شيء.</li> : null}
        </ul>
      </Panel>
      {mine.length ? (
        <Panel title="تسجيل مراجعة مصدر أو مقطع">
          <EditorForm action={recordKnowledgeReview} submitLabel="سجّل المراجعة" confirmText="تُسجل المراجعة باسمك ولا تُعدل بعد ذلك. متابعة؟">
            <EField label="معرّف المصدر (النسخة الحالية)" name="sourceId" required><input name="sourceId" dir="ltr" className="h-11 w-full rounded border px-3" /></EField>
            <EField label="معرّف المقطع (اتركه فارغًا لمراجعة المصدر كله)" name="chunkId"><input name="chunkId" dir="ltr" className="h-11 w-full rounded border px-3" /></EField>
            <EField label="القرار" name="decision" required><Select name="decision" options={DECISIONS} /></EField>
            <EField label="الملاحظة: ما قابلته وبماذا (الصفحة، الطبعة، النسخة الرسمية)" name="note" required><Textarea name="note" /></EField>
          </EditorForm>
        </Panel>
      ) : null}
      {runs.length ? (
        <Panel title="مطابقات النصوص الرسمية (مراجعة نظامية)" tight>
          <ul className="divide-y divide-line">
            {runs.map((r) => (
              <li key={r.runId} className="px-4 py-3 md:px-5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span dir="ltr">{r.refId}</span><span>{r.versionLabel}</span><Badge tone="info">{r.outcome}</Badge>
                  <span className="text-[13px] text-muted">{r.reviews.length ? r.reviews.map((v) => `${v.decision} ${v.at.slice(0, 10)}`).join("، ") : "بلا مراجعة"}</span>
                </div>
                <EditorForm action={recordComparisonDecision} submitLabel="سجّل" idPrefix={`run-${r.runId}`} confirmText="تُسجل المراجعة باسمك ولا تُعدل بعد ذلك. متابعة؟">
                  <input type="hidden" name="runId" value={r.runId} />
                  <EField label="القرار" name="decision" required><Select name="decision" options={DECISIONS} /></EField>
                  <EField label="الملاحظة" name="note" required><Textarea name="note" /></EField>
                </EditorForm>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </EditorPage>
  );
}
