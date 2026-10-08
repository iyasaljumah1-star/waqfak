import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadContent } from "@/server/modules/admin/editors/content.queries";
import { addReview, markVerified, saveContent, transitionContent } from "@/server/modules/admin/editors/content.actions";
import { CONTENT_KINDS, PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE, REVIEW_REQUIRED_KINDS, SPECIALTIES } from "@/server/modules/admin/editors/pure";
import { Alert, Badge, PageHeader, Panel, Steps } from "@/components/ui";
import { Select, Textarea } from "@/components/ui/form";
import { ActionButton, EditorForm, EField } from "@/components/admin-editors/editor-form";
import { ContentFields } from "@/components/admin-editors/content-fields";
import { EditorPage, FieldGrid, Flash } from "@/components/admin-editors/shell";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "تحرير المحتوى" };

const PUBLIC_PATH: Record<string, (slug: string) => string> = {
  regulation: (s) => `/regulations#${s}`, page: (s) => (["terms", "privacy", "cookies", "ai", "accessibility", "disclaimer"].includes(s) ? `/legal/${s}` : `/library/${s}`),
};

export default async function ContentEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.content");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await read(auth, (tx) => loadContent(tx, id));
  if (!data) notFound();
  const { c, reviews } = data;
  const needsReview = REVIEW_REQUIRED_KINDS.includes(c.kind);
  const lastReview = reviews[0]?.r ?? null;
  const reviewedOk = !!c.reviewedAt && lastReview?.decision === "approved";
  const kindLabel = CONTENT_KINDS.find((k) => k.value === c.kind)?.label ?? c.kind;
  const publicHref = (PUBLIC_PATH[c.kind] ?? ((s: string) => `/library/${s}`))(c.slug);
  const step = (k: string) => (c.status === k ? "active" : ["draft", "in_review", "published"].indexOf(c.status) > ["draft", "in_review", "published"].indexOf(k) ? "done" : "pending") as "active" | "done" | "pending";

  return (
    <EditorPage wide>
      <PageHeader
        title={c.titleAr}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={PUBLISH_STATUS_TONE[c.status]}>{PUBLISH_STATUS_AR[c.status]}</Badge><span>{kindLabel}</span><span dir="ltr" className="text-[13px]">{c.slug}</span></span>}
        crumbs={[{ href: "/admin/content", label: "المحتوى" }, { label: c.titleAr.slice(0, 40) }]}
        actions={c.status === "published" ? <Link href={publicHref} className="text-[14px] text-ink underline">عرض في الموقع</Link> : null}
      />
      <Flash sp={sp} />
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Panel title="النص والبيانات">
          <EditorForm action={saveContent} submitLabel="احفظ المحتوى">
            <ContentFields c={c} />
          </EditorForm>
        </Panel>
        <div className="space-y-6">
          <Panel title="مسار النشر">
            <Steps
              steps={[
                { label: "مسودة", status: step("draft") },
                { label: "قيد المراجعة", status: step("in_review"), meta: needsReview ? "مراجعة متخصص مطلوبة" : undefined },
                { label: "منشور", status: c.status === "published" ? "done" : "pending", meta: c.publishedAt ? fmtDate(c.publishedAt) : undefined },
              ]}
            />
            {c.status === "retired" ? <Alert tone="neutral" title="المحتوى موقوف ولا يظهر للزوار." className="mt-3" /> : null}
            <div className="mt-4 flex flex-col items-start gap-2">
              {c.status === "draft" ? <ActionButton action={transitionContent} fields={{ id: c.id, to: "in_review" }} label="أرسل للمراجعة" variant="primary" /> : null}
              {c.status === "in_review" ? (
                <>
                  {needsReview && !reviewedOk ? <p className="text-[13px] text-fine">سجّل مراجعة متخصص معتمدة أدناه ليُتاح النشر.</p> : null}
                  <ActionButton action={transitionContent} fields={{ id: c.id, to: "published" }} label="انشر" variant="primary" confirmText="نشر هذا المحتوى للزوار؟" />
                  <ActionButton action={transitionContent} fields={{ id: c.id, to: "draft" }} label="أعده مسودة" variant="ghost" />
                </>
              ) : null}
              {c.status === "published" ? (
                <>
                  <ActionButton action={transitionContent} fields={{ id: c.id, to: "draft" }} label="ألغِ النشر (مسودة)" variant="secondary" confirmText="إلغاء النشر؟ سيختفي من الموقع." />
                  <ActionButton action={transitionContent} fields={{ id: c.id, to: "retired" }} label="أوقف المحتوى" variant="ghost" confirmText="إيقاف المحتوى نهائيًا؟" />
                </>
              ) : null}
              {c.status === "retired" ? <ActionButton action={transitionContent} fields={{ id: c.id, to: "draft" }} label="أعده مسودة" variant="secondary" /> : null}
            </div>
          </Panel>
          <Panel title="التحقق من المصادر">
            <p className="text-[14px]">آخر تحقق: {c.lastVerifiedAt ? fmtDate(c.lastVerifiedAt) : "لم يُسجّل"}</p>
            <div className="mt-3"><ActionButton action={markVerified} fields={{ id: c.id }} label="تحققت من المصادر اليوم" /></div>
          </Panel>
          <Panel title="مراجعة المتخصص" description={needsReview ? "مطلوبة قبل نشر الأنظمة والأدلة." : "اختيارية لهذا النوع."}>
            {c.reviewedAt ? <p className="mb-3 text-[14px] text-ok">معتمد: {SPECIALTIES.find((s) => s.value === c.reviewerSpecialty)?.label} · {fmtDate(c.reviewedAt)}</p> : <p className="mb-3 text-[14px] text-muted">النص الحالي لم يُراجع.</p>}
            {c.status !== "retired" ? (
              <EditorForm action={addReview} submitLabel="سجّل المراجعة">
                <input type="hidden" name="id" value={c.id} />
                <FieldGrid>
                  <EField label="التخصص" name="specialty" required><Select name="specialty" defaultValue={c.reviewerSpecialty ?? (c.kind === "regulation" ? "legal" : "sharia")} options={SPECIALTIES} /></EField>
                  <EField label="النتيجة" name="decision" required><Select name="decision" defaultValue="approved" options={[{ value: "approved", label: "معتمد" }, { value: "changes_requested", label: "يحتاج تعديلًا" }]} /></EField>
                </FieldGrid>
                <EField label="ملاحظات المراجع" name="notes"><Textarea name="notes" className="min-h-20" /></EField>
              </EditorForm>
            ) : null}
            {reviews.length ? (
              <ol className="mt-4 space-y-2 border-t border-line pt-3 text-[14px]">
                {reviews.map(({ r, reviewer }) => (
                  <li key={r.id}>
                    <p><Badge tone={r.decision === "approved" ? "ok" : "warn"}>{r.decision === "approved" ? "معتمد" : "يحتاج تعديلًا"}</Badge> <span className="text-muted">{SPECIALTIES.find((s) => s.value === r.specialty)?.label} · {reviewer ?? "—"} · {fmtDateTime(r.at)}</span></p>
                    {r.notes ? <p className="mt-1 text-[13px]">{r.notes}</p> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </Panel>
        </div>
      </div>
    </EditorPage>
  );
}
