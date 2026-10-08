import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listFaqs } from "@/server/modules/admin/editors/content.queries";
import { PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE } from "@/server/modules/admin/editors/pure";
import { Badge, ButtonLink, PageHeader, Panel } from "@/components/ui";
import { EditorPage, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "الأسئلة الشائعة" };

export default async function FaqAdmin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.content");
  const sp = await searchParams;
  const items = await read(auth, listFaqs);
  const topics = [...new Set(items.map((f) => f.topic))];
  return (
    <EditorPage>
      <PageHeader title="الأسئلة الشائعة" description={`${items.length} سؤالًا في ${topics.length} موضوعًا.`} crumbs={[{ href: "/admin/content", label: "المحتوى" }, { label: "الأسئلة الشائعة" }]} actions={<ButtonLink href="/admin/content/faqs/new"><Plus aria-hidden className="size-4" /> سؤال جديد</ButtonLink>} />
      <Flash sp={sp} />
      {topics.map((t) => (
        <Panel key={t} title={<span dir="ltr">{t}</span>} tight>
          <ul className="divide-y divide-line">
            {items.filter((f) => f.topic === t).map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-2 px-4 py-2.5 md:px-5">
                <Link href={`/admin/content/faqs/${f.id}`} className="min-w-0 flex-1 text-ink hover:underline">{f.question}</Link>
                {f.status !== "published" ? <Badge tone={PUBLISH_STATUS_TONE[f.status]}>{PUBLISH_STATUS_AR[f.status]}</Badge> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </EditorPage>
  );
}
