import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { loadFlagDef } from "@/server/modules/admin/editors/bank.queries";
import { listPenalties } from "@/server/modules/admin/editors/compliance.queries";
import { saveFlagDef } from "@/server/modules/admin/editors/bank.actions";
import { PageHeader, Panel } from "@/components/ui";
import { EditorForm } from "@/components/admin-editors/editor-form";
import { EditorPage, Flash } from "@/components/admin-editors/shell";
import { FlagFields } from "@/components/admin-editors/flag-fields";

export const metadata: Metadata = { title: "إشارة حرجة" };

export default async function FlagEditor({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { code } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.rules");
  const data = await read(auth, async (tx) => ({ f: await loadFlagDef(tx, decodeURIComponent(code)), penalties: await listPenalties(tx) }));
  if (!data.f) notFound();
  return (
    <EditorPage>
      <PageHeader title={<span><span dir="ltr">{data.f.code}</span> — {data.f.titleAr}</span>} crumbs={[{ href: "/admin/question-bank/flags", label: "الإشارات الحرجة" }, { label: data.f.code }]} />
      <Flash sp={sp} />
      <Panel>
        <EditorForm action={saveFlagDef} submitLabel="احفظ الإشارة">
          <FlagFields f={data.f} penalties={data.penalties} />
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
