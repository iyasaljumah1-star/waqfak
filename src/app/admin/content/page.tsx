import type { Metadata } from "next";
import Link from "next/link";
import { BookA, HelpCircle, Plus } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listContent } from "@/server/modules/admin/editors/content.queries";
import { CONTENT_KINDS, PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE, REVIEW_REQUIRED_KINDS, SPECIALTIES } from "@/server/modules/admin/editors/pure";
import { Badge, ButtonLink, DataTable, PageHeader, Panel } from "@/components/ui";
import { EditorPage, Flash } from "@/components/admin-editors/shell";
import { fmtDate } from "@/lib/utils";
import { addDays, todayISO } from "@/server/engines/dates";

export const metadata: Metadata = { title: "المحتوى والمكتبة" };
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function ContentAdmin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.content");
  const sp = await searchParams;
  const f = { kind: one(sp.kind), status: one(sp.status), q: one(sp.q).trim() };
  const rows = await read(auth, (tx) => listContent(tx, f));
  const staleBefore = addDays(todayISO(), -365); // sources not re-verified for a year are highlighted
  return (
    <EditorPage wide>
      <PageHeader
        title="المحتوى والمكتبة"
        description="المقالات والأدلة والأنظمة وصفحات الموقع. المسار: مسودة ← قيد المراجعة ← منشور. الأنظمة والأدلة لا تُنشر دون مراجعة متخصص مسجّلة على النص الحالي."
        actions={
          <>
            <ButtonLink href="/admin/content/faqs" variant="secondary"><HelpCircle aria-hidden className="size-4" /> الأسئلة الشائعة</ButtonLink>
            <ButtonLink href="/admin/content/glossary" variant="secondary"><BookA aria-hidden className="size-4" /> المصطلحات</ButtonLink>
            <ButtonLink href="/admin/content/new"><Plus aria-hidden className="size-4" /> محتوى جديد</ButtonLink>
          </>
        }
      />
      <Flash sp={sp} />
      <Panel tight>
        <form className="flex flex-wrap gap-2 border-b border-line p-3" role="search">
          <label htmlFor="q" className="sr-only">ابحث</label>
          <input id="q" name="q" defaultValue={f.q} placeholder="ابحث بالعنوان أو المعرّف" className="h-10 min-w-0 flex-1 basis-48 rounded-md border border-line-strong bg-surface px-3" />
          <label htmlFor="kind" className="sr-only">النوع</label>
          <select id="kind" name="kind" defaultValue={f.kind} className="h-10 rounded-md border border-line-strong bg-surface px-2">
            <option value="">كل الأنواع</option>
            {CONTENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <label htmlFor="status" className="sr-only">الحالة</label>
          <select id="status" name="status" defaultValue={f.status} className="h-10 rounded-md border border-line-strong bg-surface px-2">
            <option value="">كل الحالات</option>
            {Object.entries(PUBLISH_STATUS_AR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="h-10 rounded-md border border-line-strong px-4">تصفية</button>
        </form>
        <div className="px-3 md:px-2">
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            caption="المحتوى"
            columns={[
              { key: "t", label: "العنوان", render: (r) => <Link href={`/admin/content/${r.id}`} className="font-medium text-ink hover:underline">{r.titleAr}</Link> },
              { key: "k", label: "النوع", render: (r) => <span>{CONTENT_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind}{REVIEW_REQUIRED_KINDS.includes(r.kind) ? <span className="block text-[11px] text-muted">يتطلب مراجعة</span> : null}</span> },
              { key: "s", label: "الحالة", render: (r) => <Badge tone={PUBLISH_STATUS_TONE[r.status]}>{PUBLISH_STATUS_AR[r.status]}</Badge> },
              { key: "r", label: "المراجعة", render: (r) => (r.reviewedAt ? <span className="text-[13px]">{SPECIALTIES.find((s) => s.value === r.reviewerSpecialty)?.label ?? r.reviewerSpecialty} · {fmtDate(r.reviewedAt)}</span> : <span className="text-[13px] text-muted">لم يُراجع</span>), hideOnMobile: true },
              { key: "v", label: "آخر تحقق", render: (r) => (r.lastVerifiedAt ? <span className={r.lastVerifiedAt < staleBefore ? "text-fine" : ""}>{fmtDate(r.lastVerifiedAt)}</span> : "—"), hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </EditorPage>
  );
}
