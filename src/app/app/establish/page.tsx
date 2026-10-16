import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText, Sprout } from "lucide-react";
import { Alert, Badge, EmptyState, PageHeader, Panel, ProgressBar } from "@/components/ui";
import { ActionButton } from "@/components/waqf/action-form";
import { fmtDateTime, STATUS_LABEL, TYPE_LABEL } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { startEstablishDraft } from "@/server/modules/establish/actions";
import { ESTABLISH_STEPS } from "@/server/modules/establish/pure";
import { myDrafts } from "@/server/modules/establish/queries";
import { missingItems } from "@/server/modules/establish/pure";
import { firstIncompleteWizardStep } from "@/server/modules/establish/journey";
import { ActionLink } from "@/components/portal/action-link";

export const metadata: Metadata = { title: "تأسيس وقف جديد" };

const PATH = [
  "نحدد نوع الوقف من مصارفه أولًا (عام أو خاص أو مشترك).",
  "ثم الواقف، والأصول الموقوفة، والمصارف والشروط، والنظارة، وتوزيع الغلة.",
  "وتحصل في النهاية على مسودة أولية لوثيقة الوقف بصياغة عربية محكمة، جاهزة للمراجعة الشرعية والقانونية قبل التوثيق.",
];

export default async function EstablishPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const sp = await searchParams;
  const auth = await requireAuth({ next: "/app/establish" });
  const drafts = await read(auth, (tx) => myDrafts(tx, auth.user.id));
  const n = ESTABLISH_STEPS.length;
  // one open draft at a time: the main action resumes it; another waqf is a deliberate, explained choice
  const openDraft = drafts.find((d) => d.state && !d.state.finishedAt) ?? null;
  const resumeHref = openDraft?.state ? `/app/establish/${openDraft.id}?step=${firstIncompleteWizardStep({ completed: openDraft.state.completed, missing: missingItems(openDraft.state) })}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="تأسيس وقف جديد"
        description="معالج يرافقك من الفكرة إلى مسودة وثيقة الوقف، وفق الدليل الإرشادي لصياغة وثيقة الوقف والدليل الإرشادي للواقفين. تُحفظ إجاباتك في كل خطوة، وتعود إليها متى شئت."
        actions={resumeHref ? <ActionLink href={resumeHref} data-testid="resume-draft">استكمال تأسيس الوقف</ActionLink> : <ActionButton action={startEstablishDraft} hidden={{}} label="ابدأ وقفًا جديدًا" variant="primary" size="md" />}
      />
      {openDraft ? (
        <Alert tone="info" title={`لديك مسودة تأسيس مفتوحة: ${openDraft.name}`}>
          تُستكمل المسودة نفسها من آخر خطوة لم تُستكمل، ولا يُنشأ ملف جديد. إن أردت تأسيس وقف آخر مختلف فاذكر الغرض منه:
          <details className="mt-2" data-testid="another-waqf">
            <summary className="cursor-pointer text-ink">تأسيس وقف آخر مختلف</summary>
            <div className="mt-2">
              <ActionButton action={startEstablishDraft} hidden={{ another: "yes" }} label="ابدأ مسودة وقف آخر" variant="secondary" size="sm">
                <label className="block text-[14px]">الغرض من الوقف الآخر<input name="purpose" minLength={10} required className="mt-1 block h-10 w-full max-w-md rounded-md border border-line-strong bg-surface px-3" /></label>
              </ActionButton>
            </div>
          </details>
        </Alert>
      ) : null}
      {sp.saved ? <Alert tone="ok" title="حُفظت المسودة">تجدها في القائمة أدناه، وتكمل من حيث توقفت.</Alert> : null}

      <Panel title="كيف يعمل المعالج">
        <ol className="list-decimal space-y-1 ps-5 text-[15px] leading-7">
          {PATH.map((p) => <li key={p}>{p}</li>)}
        </ol>
      </Panel>

      <Panel title="مسوداتي" tight>
        {drafts.length ? (
          <ul className="divide-y divide-line" data-testid="drafts">
            {drafts.map((d) => {
              const done = !!d.state?.finishedAt;
              const completed = d.state?.completed.length ?? 0;
              const step = d.state?.step ?? 1;
              return (
                <li key={d.id}>
                  <Link href={`/app/establish/${d.id}?step=${done ? n : step}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-surface-2 sm:flex-row sm:items-center md:px-5" data-testid="draft-link">
                    <FileText aria-hidden className="hidden size-5 shrink-0 text-muted sm:block" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{d.name}</p>
                      <p className="text-[13px] text-muted">
                        {d.legalType ? `${TYPE_LABEL[d.legalType]} · ` : ""}آخر حفظ {fmtDateTime(d.updatedAt)}
                      </p>
                      {!done ? <div className="mt-1.5 max-w-xs"><ProgressBar value={(completed / n) * 100} label="تقدم المسودة" /></div> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {done ? <Badge tone="ok">المسودة جاهزة</Badge> : <Badge tone="neutral" icon={false}>{STATUS_LABEL[d.status]} · الخطوة {step} من {n}</Badge>}
                      <ArrowLeft aria-hidden className="size-4 text-muted" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4 md:p-5">
            <EmptyState icon={Sprout} title="لا مسودات بعد" action={<ActionButton action={startEstablishDraft} hidden={{}} label="ابدأ الآن" variant="primary" />}>
              ابدأ بإجابة سؤال واحد: على من تريد أن تُصرف غلة وقفك؟
            </EmptyState>
          </div>
        )}
      </Panel>
    </div>
  );
}
