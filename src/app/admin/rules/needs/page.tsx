import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listNeeds } from "@/server/modules/admin/editors/rules.queries";
import { deleteNeed, saveNeed } from "@/server/modules/admin/editors/rules.actions";
import { PageHeader, Panel } from "@/components/ui";
import { Input } from "@/components/ui/form";
import { ActionButton, EditorForm, EField } from "@/components/admin-editors/editor-form";
import { EditorPage, FieldGrid } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "الاحتياجات" };

function NeedFields({ n }: { n?: { code: string; groupCode: string; titleAr: string; description: string | null } }) {
  return (
    <div className="space-y-3">
      {n ? <input type="hidden" name="code" value={n.code} /> : <input type="hidden" name="isNew" value="1" />}
      <FieldGrid cols={3}>
        {!n ? <EField label="الرمز" name="code" required><Input name="code" dir="ltr" placeholder="NEED.FIN.NEW_THING" /></EField> : null}
        <EField label="المجموعة" name="groupCode" required><Input name="groupCode" dir="ltr" defaultValue={n?.groupCode ?? ""} placeholder="FIN" /></EField>
        <EField label="العنوان" name="titleAr" required className={n ? "lg:col-span-2" : ""}><Input name="titleAr" defaultValue={n?.titleAr ?? ""} /></EField>
      </FieldGrid>
      <EField label="الوصف" name="description"><Input name="description" defaultValue={n?.description ?? ""} /></EField>
    </div>
  );
}

export default async function NeedsAdmin() {
  const auth = await requireStaff("admin.rules");
  const needs = await read(auth, listNeeds);
  const groups = [...new Set(needs.map((n) => n.n.groupCode))];
  return (
    <EditorPage>
      <PageHeader title="الاحتياجات" description="الاحتياج هو ما تعالجه التوصية؛ يجمع قواعد متعددة ويمنع تكرار التوصية لنفس الاحتياج." crumbs={[{ href: "/admin/rules", label: "محرك التوصيات" }, { label: "الاحتياجات" }]} />
      <Panel title="احتياج جديد">
        <EditorForm action={saveNeed} submitLabel="أضف الاحتياج">
          <NeedFields />
        </EditorForm>
      </Panel>
      {groups.map((g) => (
        <Panel key={g} title={<span dir="ltr">{g}</span>} tight>
          <ul className="divide-y divide-line">
            {needs.filter((n) => n.n.groupCode === g).map((n) => (
              <li key={n.n.code} className="px-4 py-3 md:px-5">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3">
                    <span dir="ltr" className="text-[13px] text-muted">{n.n.code}</span>
                    <span className="font-medium">{n.n.titleAr}</span>
                    <span className="text-[13px] text-muted">{n.rules} قاعدة</span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <EditorForm action={saveNeed} submitLabel="احفظ" idPrefix={`n-${n.n.code}`}>
                      <NeedFields n={n.n} />
                    </EditorForm>
                    {!n.rules ? <ActionButton action={deleteNeed} fields={{ code: n.n.code }} label="احذف الاحتياج" variant="ghost" confirmText="حذف الاحتياج؟" /> : null}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </EditorPage>
  );
}
