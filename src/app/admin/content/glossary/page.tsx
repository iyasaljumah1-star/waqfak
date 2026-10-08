import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listTerms } from "@/server/modules/admin/editors/content.queries";
import { PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE } from "@/server/modules/admin/editors/pure";
import { Badge, ButtonLink, DataTable, PageHeader, Panel } from "@/components/ui";
import { EditorPage, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "المصطلحات" };

export default async function GlossaryAdmin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.content");
  const sp = await searchParams;
  const terms = await read(auth, listTerms);
  return (
    <EditorPage>
      <PageHeader title="المصطلحات" description={`${terms.length} مصطلحًا في قاموس الموقع.`} crumbs={[{ href: "/admin/content", label: "المحتوى" }, { label: "المصطلحات" }]} actions={<ButtonLink href="/admin/content/glossary/new"><Plus aria-hidden className="size-4" /> مصطلح جديد</ButtonLink>} />
      <Flash sp={sp} />
      <Panel tight>
        <div className="px-3 md:px-2">
          <DataTable
            rows={terms}
            rowKey={(t) => t.id}
            caption="المصطلحات"
            columns={[
              { key: "t", label: "المصطلح", render: (t) => <Link href={`/admin/content/glossary/${t.id}`} className="font-medium text-ink hover:underline">{t.term}</Link> },
              { key: "d", label: "التعريف", render: (t) => <span className="line-clamp-2 text-[14px] text-muted">{t.definition}</span>, hideOnMobile: true },
              { key: "s", label: "الحالة", render: (t) => <Badge tone={PUBLISH_STATUS_TONE[t.status]}>{PUBLISH_STATUS_AR[t.status]}</Badge> },
            ]}
          />
        </div>
      </Panel>
    </EditorPage>
  );
}
