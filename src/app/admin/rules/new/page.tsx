import type { Metadata } from "next";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { demoAssessments, listNeeds, serviceCodeOptions } from "@/server/modules/admin/editors/rules.queries";
import { saveRule, testRule } from "@/server/modules/admin/editors/rules.actions";
import { PageHeader, Panel } from "@/components/ui";
import { RuleForm } from "@/components/admin-editors/rule-form";
import { RuleFields } from "@/components/admin-editors/rule-fields";
import { EditorPage } from "@/components/admin-editors/shell";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "قاعدة توصية جديدة" };

export default async function NewRule() {
  const auth = await requireStaff("admin.rules");
  const data = await read(auth, async (tx) => ({ needs: (await listNeeds(tx)).map((n) => n.n), services: await serviceCodeOptions(tx), assessments: await demoAssessments(tx) }));
  const assessments = data.assessments.map((a) => ({ id: a.id, label: `${a.waqf ?? a.label ?? "تقييم بلا وقف"} · ${fmtDate(a.at)} · ${Math.round(Number(a.score))}` }));
  return (
    <EditorPage>
      <PageHeader title="قاعدة توصية جديدة" description="تُنشأ مسودة (الإصدار 1). اختبرها ثم انشرها من صفحتها." crumbs={[{ href: "/admin/rules", label: "محرك التوصيات" }, { label: "جديدة" }]} />
      <Panel>
        <RuleForm save={saveRule} test={testRule} code="">
          <RuleFields r={{ urgencyDays: 90, leverage: "1", severity: "medium" }} isNew needs={data.needs} services={data.services} assessments={assessments} />
        </RuleForm>
      </Panel>
    </EditorPage>
  );
}
