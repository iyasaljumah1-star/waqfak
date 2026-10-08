import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Tags } from "lucide-react";
import { requireStaff } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listNeeds, listRules } from "@/server/modules/admin/editors/rules.queries";
import { PUBLISH_STATUS_AR, PUBLISH_STATUS_TONE, SEVERITY_OPTIONS, SEVERITY_TONE } from "@/server/modules/admin/editors/pure";
import { Badge, ButtonLink, DataTable, PageHeader, Panel, Stat } from "@/components/ui";
import { EditorPage, Flash } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "محرك التوصيات" };

export default async function RulesAdmin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStaff("admin.rules");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const group = typeof sp.group === "string" ? sp.group : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const { rules, needs } = await read(auth, async (tx) => ({ rules: await listRules(tx), needs: await listNeeds(tx) }));
  const groups = [...new Set(needs.map((n) => n.n.groupCode))].sort();
  const needTitle = new Map(needs.map((n) => [n.n.code, n.n.titleAr]));
  const shown = rules.filter((r) => {
    const cur = r.draft ?? r.published ?? r.latest;
    if (group && !cur.needCode.startsWith(`NEED.${group}.`)) return false;
    if (status === "draft" && !r.draft) return false;
    if (status === "published" && !r.published) return false;
    if (status === "retired" && (r.published || r.draft)) return false;
    if (q && !`${cur.code} ${cur.titleAr} ${cur.needCode} ${cur.reference ?? ""}`.includes(q)) return false;
    return true;
  });
  const fired = rules.reduce((a, r) => a + (r.published?.timesFired ?? 0), 0);
  const converted = rules.reduce((a, r) => a + (r.published?.timesConverted ?? 0), 0);

  return (
    <EditorPage>
      <PageHeader
        title="محرك التوصيات"
        description="القواعد تحوّل حقائق التقييم إلى احتياجات وخدمات مرتبة بالأولوية. كل قاعدة مُصدَرة: تُعدّل كمسودة، وتُختبر، ثم تُنشر فتعمل في التقييمات التي تُحسب بعدها."
        actions={
          <>
            <ButtonLink href="/admin/rules/needs" variant="secondary"><Tags aria-hidden className="size-4" /> الاحتياجات</ButtonLink>
            <ButtonLink href="/admin/rules/new"><Plus aria-hidden className="size-4" /> قاعدة جديدة</ButtonLink>
          </>
        }
      />
      <Flash sp={sp} />
      <section aria-label="ملخص" className="grid gap-3 sm:grid-cols-3">
        <Stat label="قواعد منشورة" value={rules.filter((r) => r.published).length} sub={`مسودات مفتوحة: ${rules.filter((r) => r.draft).length}`} />
        <Stat label="مرات الظهور" value={fired} sub="في تقييمات محسوبة" />
        <Stat label="تحوّلت إلى طلبات" value={converted} sub={fired ? `${Math.round((converted / fired) * 100)}% من الظهور` : "—"} />
      </section>
      <Panel tight>
        <form className="flex flex-wrap gap-2 border-b border-line p-3" role="search">
          <label htmlFor="q" className="sr-only">ابحث</label>
          <input id="q" name="q" defaultValue={q} placeholder="ابحث بالرمز أو العنوان أو المرجع" className="h-10 min-w-0 flex-1 basis-48 rounded-md border border-line-strong bg-surface px-3" />
          <label htmlFor="group" className="sr-only">المجموعة</label>
          <select id="group" name="group" defaultValue={group} className="h-10 rounded-md border border-line-strong bg-surface px-2">
            <option value="">كل المجموعات</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <label htmlFor="status" className="sr-only">الحالة</label>
          <select id="status" name="status" defaultValue={status} className="h-10 rounded-md border border-line-strong bg-surface px-2">
            <option value="">كل الحالات</option>
            <option value="published">لها نسخة منشورة</option>
            <option value="draft">لها مسودة</option>
            <option value="retired">موقوفة</option>
          </select>
          <button className="h-10 rounded-md border border-line-strong px-4">تصفية</button>
        </form>
        <div className="px-3 md:px-2">
          <DataTable
            rows={shown}
            rowKey={(r) => r.latest.code}
            caption="قواعد التوصيات"
            columns={[
              { key: "c", label: "الرمز", render: (r) => <Link href={`/admin/rules/${r.latest.code}`} className="tabular font-semibold text-ink hover:underline" dir="ltr">{r.latest.code}</Link> },
              { key: "t", label: "التوصية", render: (r) => <span>{(r.published ?? r.latest).titleAr}<span className="block text-[12px] text-muted">{needTitle.get((r.published ?? r.latest).needCode) ?? (r.published ?? r.latest).needCode}</span></span> },
              { key: "s", label: "الخطورة", render: (r) => { const s = (r.published ?? r.latest).severity; return <Badge tone={SEVERITY_TONE[s]}>{SEVERITY_OPTIONS.find((o) => o.value === s)?.label}</Badge>; } },
              {
                key: "v", label: "الإصدار",
                render: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {r.published ? <Badge tone="ok" icon={false}>منشور v{r.published.version}</Badge> : null}
                    {r.draft ? <Badge tone="neutral" icon={false}>مسودة v{r.draft.version}</Badge> : null}
                    {!r.published && !r.draft ? <Badge tone={PUBLISH_STATUS_TONE.retired} icon={false}>{PUBLISH_STATUS_AR.retired}</Badge> : null}
                  </span>
                ),
              },
              { key: "f", label: "الظهور/التحويل", render: (r) => <span className="tabular">{r.published?.timesFired ?? 0} / {r.published?.timesConverted ?? 0}</span>, hideOnMobile: true },
            ]}
          />
        </div>
      </Panel>
    </EditorPage>
  );
}
