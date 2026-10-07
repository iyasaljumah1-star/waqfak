import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefcaseBusiness } from "lucide-react";
import { Badge } from "@/components/ui";
import { STATUS_TONE } from "@/components/portal/labels";
import { WaqfSectionNav } from "@/components/portal/waqf-nav";
import { WAQF_NAV } from "@/config/nav";
import { fmtBoth, NAZIR_MODE_LABEL, SIZE_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/utils";
import { requireAuth } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { isUuid, waqfAccess } from "@/server/modules/waqf-core/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "ملف الوقف" };
  const auth = await requireAuth();
  const access = await waqfAccess(auth, id);
  return { title: { default: access.waqf.name, template: `%s — ${access.waqf.name} | وقفك` } };
}

export default async function WaqfLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) redirect("/app?notfound=1");
  const auth = await requireAuth({ next: `/app/w/${id}` });
  const access = await waqfAccess(auth, id); // beneficiary-only members are redirected to /app/b/[id]
  const w = access.waqf;
  const base = `/app/w/${id}`;
  const sections = WAQF_NAV.filter((n) => !n.perm || access.perms.has(n.perm)).map((n) => ({
    href: n.segment ? `${base}/${n.segment}` : base,
    label: n.label,
    icon: n.icon,
  }));
  const asStaff = (access.isStaffAssigned || access.viaGlobal) && access.roles.length === 0;

  return (
    <div>
      <header className="mb-4">
        <nav aria-label="مسار التنقل" className="mb-1 text-sm text-muted">
          <Link href="/app/waqfs" className="hover:text-ink hover:underline">أوقافي</Link>
          <span aria-hidden className="mx-1 text-line-strong">/</span>
          <span dir="ltr" className="tabular">{w.internalNumber}</span>
        </nav>
        <p className="font-naskh text-[1.6rem] font-bold leading-snug text-ink md:text-[1.9rem]">{w.name}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[w.status] ?? "neutral"} icon={false}>{STATUS_LABEL[w.status] ?? w.status}</Badge>
          {w.legalType ? <Badge icon={false}>{TYPE_LABEL[w.legalType]}</Badge> : null}
          {w.sizeClass ? <Badge icon={false}>{SIZE_LABEL[w.sizeClass]}</Badge> : null}
          {w.nazirMode ? <Badge icon={false}>النظارة: {NAZIR_MODE_LABEL[w.nazirMode]}</Badge> : null}
          {access.roles.length ? (
            <span className="ms-1 text-[13px] text-muted">بصفتك {access.roles.map(roleName).join("، ")}</span>
          ) : null}
        </div>
        {asStaff ? (
          <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] text-muted">
            <BriefcaseBusiness aria-hidden className="size-4 text-ink" />
            وصول بصفتك موظفًا مكلّفًا، للاطلاع في حدود ما يلزم لإنجاز الطلب المسند إليك.
          </p>
        ) : null}
        {access.delegation ? (
          <p className="mt-3 text-[13px] text-muted">تعمل هنا بوكالة سارية حتى {fmtBoth(access.delegation.validTo)}، وفي حدود نطاقها فقط.</p>
        ) : null}
      </header>
      <WaqfSectionNav base={base} sections={sections} variant="tabs" />
      <div className="xl:mt-6 xl:grid xl:grid-cols-[12.5rem_minmax(0,1fr)] xl:gap-8">
        <div className="hidden xl:block">
          <div className="sticky top-20">
            <WaqfSectionNav base={base} sections={sections} variant="list" />
          </div>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
