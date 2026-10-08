import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listFlagDefs } from "@/server/modules/admin/editors/bank.queries";
import { SEVERITY_OPTIONS, SEVERITY_TONE } from "@/server/modules/admin/editors/pure";
import { Badge, ButtonLink, DataTable, PageHeader, Panel } from "@/components/ui";
import { EditorPage, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "الإشارات الحرجة" };

export default async function Flags({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.rules");
  const sp = await searchParams;
  const flags = await read(auth, listFlagDefs);
  return (
    <EditorPage>
      <PageHeader
        title="الإشارات الحرجة"
        description="الإشارة الحرجة تتجاوز الدرجة: تضع الوقف في حالة «حرج» وتحدّ المحور المتأثر. تُربط بالأسئلة من محرر السؤال."
        crumbs={[{ href: "/admin/question-bank", label: "بنك الأسئلة" }, { label: "الإشارات الحرجة" }]}
        actions={<ButtonLink href="/admin/question-bank/flags/new"><Plus aria-hidden className="size-4" /> إشارة جديدة</ButtonLink>}
      />
      <Flash sp={sp} />
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={flags}
            rowKey={(f) => f.code}
            caption="الإشارات الحرجة"
            columns={[
              { key: "c", label: "الرمز", render: (f) => <Link href={`/admin/question-bank/flags/${f.code}`} className="tabular font-semibold text-ink hover:underline" dir="ltr">{f.code}</Link> },
              { key: "t", label: "الإشارة", render: (f) => f.titleAr },
              { key: "s", label: "الخطورة", render: (f) => <Badge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_OPTIONS.find((o) => o.value === f.severity)?.label}</Badge> },
              { key: "r", label: "المرجع", render: (f) => <span className="text-[13px] text-muted">{f.referenceText}</span>, hideOnMobile: true },
              { key: "a", label: "الحالة", render: (f) => (f.active ? <Badge tone="ok">مفعّلة</Badge> : <Badge tone="neutral">موقوفة</Badge>) },
            ]}
          />
        </div>
      </Panel>
    </EditorPage>
  );
}
