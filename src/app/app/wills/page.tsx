import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";
import { Alert, Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { ActionButton } from "@/components/waqf/action-form";
import { fmtDateTime, fmtSAR } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { startWill } from "@/server/modules/wills/actions";
import { bequestCheck } from "@/server/modules/wills/pure";
import { myWills } from "@/server/modules/wills/queries";

export const metadata: Metadata = { title: "الوصايا" };

export default async function WillsPage() {
  const auth = await requireAuth({ next: "/app/wills" });
  const wills = await read(auth, (tx) => myWills(tx, auth.user.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="الوصية بالوقف"
        description="خطّط لوقف يُنشأ بعد وفاتك: قدّر تركتك، وتحقق أن الوصية في حدود الثلث، واحصل على مسودة أولية للوصية تراجعها مع مختص قبل توثيقها."
        actions={<ActionButton action={startWill} hidden={{}} label="ابدأ مخطط وصية" variant="primary" size="md" />}
      />
      <Alert tone="info" title="قاعدة الثلث">
        الوقف المعلّق على الموت يأخذ حكم الوصية: للموصي الرجوع عنه ما دام حيًا، ولا ينفذ إلا في ثلث التركة بعد الديون، وما زاد عليه أو كان لوارث يتوقف على إجازة الورثة بعد الوفاة.
      </Alert>
      <Panel title="مخططاتي" tight>
        {wills.length ? (
          <ul className="divide-y divide-line">
            {wills.map((w) => {
              const c = bequestCheck(w.plan);
              return (
                <li key={w.id}>
                  <Link href={`/app/wills/${w.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-surface-2 sm:flex-row sm:items-center md:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{w.name}</p>
                      <p className="text-[13px] text-muted">الوصية {fmtSAR(c.bequest)} من صافي {fmtSAR(c.net)} · آخر حفظ {fmtDateTime(w.updatedAt)}</p>
                    </div>
                    {c.net > 0 ? <Badge tone={c.needsHeirConsent ? "fine" : "ok"}>{c.needsHeirConsent ? "تحتاج إجازة الورثة" : "في حدود الثلث"}</Badge> : <Badge tone="neutral" icon={false}>غير مكتمل</Badge>}
                    <ArrowLeft aria-hidden className="hidden size-4 text-muted sm:block" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4 md:p-5">
            <EmptyState icon={ScrollText} title="لا مخططات بعد" action={<ActionButton action={startWill} hidden={{}} label="ابدأ الآن" variant="primary" />}>
              المخطط خاص بك وحدك، ولا يطّلع عليه غيرك ما لم تطلب خدمة.
            </EmptyState>
          </div>
        )}
      </Panel>
    </div>
  );
}
