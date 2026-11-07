import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { fiqhDossiers } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { requireAdmin } from "@/server/modules/admin/guard";
import { dossierStanding, FIQH_DECISION_AR, type FiqhDecision } from "@/server/knowledge/review";
import { STAGE_AR, type Stage } from "@/server/knowledge/fiqh/types";
import { startFiqhResearch } from "@/server/modules/admin/knowledge/actions";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { Select, Textarea } from "@/components/ui/form";
import { EditorForm, EField } from "@/components/admin-editors/editor-form";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "البحث الفقهي والمراجعة الشرعية" };

const STAGES = (["research", "summary", "extraction", "comparison", "preliminary", "draft"] as Stage[]).map((s) => ({ value: s, label: STAGE_AR[s] }));

/**
 * The sharia reviewer's queue (owner's order 2026-11-07, §7): research dossiers prepared by the engine, each a research
 * recommendation awaiting a qualified reviewer's decision. Nothing here is a ruling until a reviewer approves or modifies
 * it, in their own session, recorded and audited.
 */
export default async function FiqhQueue() {
  const auth = await requireAdmin("knowledge.review.sharia", "knowledge.review.legal", "knowledge.review.accounting", "knowledge.review.data", "knowledge.review.investment", "admin.roles");
  const rows = await read(auth, (tx) => tx.select({ id: fiqhDossiers.id, question: fiqhDossiers.question, stage: fiqhDossiers.stage, role: fiqhDossiers.reviewRole, at: fiqhDossiers.createdAt, requestId: fiqhDossiers.requestId }).from(fiqhDossiers).orderBy(desc(fiqhDossiers.createdAt)).limit(200));
  const standing = await read(auth, (tx) => dossierStanding(tx, rows.map((r) => r.id)));
  return (
    <EditorPage>
      <PageHeader
        title="البحث الفقهي والمراجعة الشرعية"
        description="ملفات بحثية أعدّها المحرك من قاعدة المعرفة: المسألة ووقائعها، والأقوال ونصوصها ومراتبها، والمقارنة، والترجيح المبدئي. كل ملف توصية بحثية لا حكم؛ ولا يصير معتمدًا إلا بقرار المراجع المختص."
        crumbs={[{ href: "/admin", label: "الإدارة" }, { href: "/admin/knowledge", label: "مراجعة قاعدة المعرفة" }, { label: "البحث الفقهي" }]}
      />
      <Panel title="الملفات" tight>
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const st = standing.get(r.id);
            return (
              <li key={r.id} className="px-4 py-3 md:px-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link href={`/admin/knowledge/fiqh/${r.id}`} className="font-medium underline">{r.question.slice(0, 140)}</Link>
                  <Badge tone="info">{STAGE_AR[r.stage as Stage]}</Badge>
                  {st?.final ? <Badge tone="ok">{STAGE_AR.final}</Badge> : st?.latest ? <Badge tone="warn">{FIQH_DECISION_AR[st.latest.decision as FiqhDecision]}</Badge> : <Badge tone="warn">بانتظار المراجعة</Badge>}
                  {r.requestId ? <span className="text-[13px] text-muted">مرتبط بطلب</span> : null}
                </div>
                <p dir="ltr" className="mt-1 text-[12px] text-muted">{r.id} · {r.at.toISOString().slice(0, 16).replace("T", " ")}</p>
              </li>
            );
          })}
          {!rows.length ? <li className="px-4 py-3 text-muted">لا ملفات بعد.</li> : null}
        </ul>
      </Panel>
      <Panel title="إعداد ملف بحثي لمسألة">
        <EditorForm action={startFiqhResearch} submitLabel="أعدّ الملف" pendingText="جارٍ البحث…">
          <EField label="المسألة كما تُسأل" name="question" required><Textarea name="question" /></EField>
          <EField label="الوقائع، واقعة في كل سطر (ابدأ السطر بـ«مفترض:» إن كانت افتراضًا). لا تكتب أسماء أو أرقام هويات." name="facts"><Textarea name="facts" /></EField>
          <EField label="المرحلة المطلوبة" name="stage"><Select name="stage" options={STAGES} defaultValue="preliminary" /></EField>
        </EditorForm>
      </Panel>
    </EditorPage>
  );
}
