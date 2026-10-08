import type { Metadata } from "next";
import Link from "next/link";
import { Flag } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listBankVersions } from "@/server/modules/admin/editors/bank.queries";
import { cloneBankVersion } from "@/server/modules/admin/editors/bank.actions";
import { PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE } from "@/server/modules/admin/editors/pure";
import { Alert, Badge, ButtonLink, DataTable, PageHeader, Panel } from "@/components/ui";
import { ActionButton } from "@/components/admin-editors/editor-form";
import { EditorPage, Flash } from "@/components/admin-editors/shell";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "بنك الأسئلة" };

export default async function QuestionBank({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.rules");
  const sp = await searchParams;
  const versions = await read(auth, listBankVersions);
  const active = versions.find((v) => v.v.status === "published");
  const draft = versions.find((v) => v.v.status === "draft");
  return (
    <EditorPage>
      <PageHeader
        title="بنك الأسئلة"
        description="أسئلة التقييم ومحاوره وأوزانه مُصدَرة بنسخ: النسخة المنشورة ثابتة لا تُعدّل، وكل تعديل يبدأ بنسخة جديدة كمسودة ثم يُنشر. التقييم يحتفظ دائمًا بالنسخة التي أُجري عليها."
        actions={<ButtonLink href="/admin/question-bank/flags" variant="secondary"><Flag aria-hidden className="size-4" /> الإشارات الحرجة</ButtonLink>}
      />
      <Flash sp={sp} />
      {active ? (
        <Alert tone="info" title={`النسخة المعتمدة للتقييمات الجديدة: الإصدار ${active.v.version}`}>
          {draft ? <>توجد مسودة مفتوحة (الإصدار {draft.v.version}). <Link className="underline" href={`/admin/question-bank/${draft.v.id}`}>تابع تعديلها</Link>.</> : "لتعديل الأسئلة أنشئ نسخة جديدة من النسخة المنشورة."}
        </Alert>
      ) : <Alert tone="critical" title="لا توجد نسخة منشورة؛ التقييمات الجديدة متوقفة." />}
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={versions}
            rowKey={(r) => r.v.id}
            caption="نسخ بنك الأسئلة"
            columns={[
              { key: "v", label: "الإصدار", render: (r) => <Link href={`/admin/question-bank/${r.v.id}`} className="tabular font-semibold text-ink hover:underline">الإصدار {r.v.version}</Link> },
              { key: "s", label: "الحالة", render: (r) => <Badge tone={PUBLISH_STATUS_TONE[r.v.status]}>{PUBLISH_STATUS_AR[r.v.status]}</Badge> },
              { key: "q", label: "الأسئلة", render: (r) => <span className="tabular">{r.questions}</span> },
              { key: "a", label: "تقييمات عليها", render: (r) => <span className="tabular">{r.assessments}</span>, hideOnMobile: true },
              { key: "p", label: "النشر", render: (r) => (r.v.publishedAt ? `${fmtDateTime(r.v.publishedAt)}${r.publisher ? ` — ${r.publisher}` : ""}` : "—"), hideOnMobile: true },
              { key: "n", label: "ملاحظات", render: (r) => <span className="text-[13px] text-muted">{r.v.notes ?? "—"}</span>, hideOnMobile: true },
              {
                key: "x", label: "إجراء",
                render: (r) => (draft ? null : <ActionButton action={cloneBankVersion} fields={{ sourceId: r.v.id }} label="أنشئ نسخة جديدة منها" pendingText="جارٍ النسخ…" />),
              },
            ]}
          />
        </div>
      </Panel>
    </EditorPage>
  );
}
