import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { AssistantChat } from "@/components/ai/chat";
import { DocAssist } from "@/components/ai/doc-assist";
import { requireAuth, requireWaqf, waqfCan } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listAssistableDocuments } from "@/server/modules/ai/doc-assist";
import { externalEnabled } from "@/server/modules/ai/external";
import { SUGGESTED_QUESTIONS } from "@/server/modules/ai/intents";

export const metadata: Metadata = { title: "المساعد الذكي" };

export default async function AssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth({ next: `/app/w/${id}/assistant` });
  const access = await requireWaqf(auth, id, "ai.use");
  const canDocs = waqfCan(access, "documents.view");
  const [docs, external] = await Promise.all([
    canDocs ? read(auth, (tx) => listAssistableDocuments(tx, auth, access)) : Promise.resolve([]),
    externalEnabled(),
  ]);
  const engineNote = external
    ? "يستعين المساعد بنموذج لغوي خارجي لصياغة الإجابة من المصادر المقتبسة فقط، بعد إخفاء الأرقام والبيانات الشخصية من السؤال، وتبقى بيانات وقفك داخل المنصة."
    : "يعمل المساعد بمحرك داخلي في المنصة، فتبقى أسئلتك وبيانات وقفك داخلها. يقتبس من المكتبة المنشورة ومن بيانات وقفك التي تملك صلاحية الاطلاع عليها.";

  return (
    <div className="space-y-6">
      <PageHeader
        title="المساعد الذكي"
        description="اسأل عن التزامات وقفك وتقييمه ووثائقه وطلباته، أو عن الأنظمة والحوكمة. كل إجابة تذكر مصدرها، وللمسائل الشرعية والقانونية الخاصة بحالتك يقدّم مستشارونا رأيًا موقّعًا."
      />
      <AssistantChat waqfId={id} suggestions={SUGGESTED_QUESTIONS} engineNote={engineNote} />
      {canDocs ? (
        <Panel title="استخراج بيانات وثيقة" description="يقرأ المساعد نص الوثيقة ويقترح رقمها وتواريخها وجهة إصدارها ونوعها. تراجع كل قيمة وتعتمدها بنفسك.">
          <DocAssist waqfId={id} docs={docs} canDecide={waqfCan(access, "documents.upload")} />
        </Panel>
      ) : null}
    </div>
  );
}
