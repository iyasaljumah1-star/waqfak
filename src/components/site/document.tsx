import Link from "next/link";
import type { ReactNode } from "react";
import { BookMarked, CalendarCheck, ListTree, UserCheck } from "lucide-react";
import { fmtDate } from "@/lib/utils";
import type { ContentRow } from "@/server/modules/public/queries";
import { Container, Crumbs } from "./bits";
import { Chip, IconTile, InfoPanel, ReferenceCard } from "./blocks";
import { kindIcon } from "./icons";
import { KIND_LABEL, TOPIC_LABEL } from "./labels";
import { headingsOf, Markdown, safeHref } from "./markdown";

const SPECIALTY: Record<string, string> = { sharia: "مختص شرعي", legal: "مختص قانوني", finance: "مختص مالي" };

/** Long-form reading layout shared by library items, legal pages and the about page. */
export function ContentDocument({ item, crumbs, after, showKind = true }: { item: ContentRow; crumbs: { href?: string; label: string }[]; after?: ReactNode; showKind?: boolean }) {
  const toc = headingsOf(item.bodyMd).filter((h) => h.level === 2);
  const updated = item.lastVerifiedAt ?? item.updatedAt;
  return (
    <article>
      <header className="border-b border-line bg-stone">
        <Container className="py-8 md:py-12">
          <Crumbs items={crumbs} />
          <div className="mt-5 max-w-3xl">
            {showKind ? (
              <div className="flex flex-wrap items-center gap-2">
                <IconTile icon={kindIcon(item.kind)} tone={item.kind === "regulation" ? "seal" : "surface"} size="sm" />
                <Chip tone="seal">{KIND_LABEL[item.kind] ?? item.kind}</Chip>
                {item.topic && TOPIC_LABEL[item.topic] ? <Chip>{TOPIC_LABEL[item.topic]}</Chip> : null}
                {item.readingMinutes ? <Chip className="tabular">{item.readingMinutes} دقائق قراءة</Chip> : null}
              </div>
            ) : null}
            <h1 className="mt-4 font-naskh text-[1.9rem] font-bold leading-[1.5] text-ink md:text-[2.4rem]">{item.titleAr}</h1>
            {item.summary ? (
              <p className="mt-4 border-s-4 border-seal ps-4 font-[family-name:var(--font-reading)] text-[18px] leading-9 text-text/85">{item.summary}</p>
            ) : null}
            <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <CalendarCheck aria-hidden className="size-4 text-ink" />
                {item.lastVerifiedAt ? "آخر تحقق من المراجع: " : "آخر تحديث: "}
                <time dateTime={new Date(updated).toISOString().slice(0, 10)}>{fmtDate(updated)}</time>
              </span>
              {item.reviewerSpecialty && item.reviewedAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <UserCheck aria-hidden className="size-4 text-ink" />
                  راجعه {SPECIALTY[item.reviewerSpecialty] ?? "مختص"}
                </span>
              ) : null}
            </p>
          </div>
        </Container>
      </header>

      <Container className="grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {toc.length > 2 ? (
            <details className="card mb-8 rounded-md border border-line bg-stone p-4 lg:hidden">
              <summary className="flex cursor-pointer items-center gap-2 font-semibold">
                <ListTree aria-hidden className="size-4 text-ink" />
                محتويات الصفحة
              </summary>
              <TocList toc={toc} />
            </details>
          ) : null}
          <Markdown source={item.bodyMd} className="prose-waqf text-[16.5px]" />

          {item.sourceRefs.length ? (
            <section aria-labelledby="sources" className="mt-14 max-w-[68ch]">
              <h2 id="sources" className="flex items-center gap-2 font-naskh text-[1.35rem] font-bold text-ink">
                <BookMarked aria-hidden className="size-5" />
                المراجع
              </h2>
              <ol className="mt-4 grid gap-3">
                {item.sourceRefs.map((r, i) => {
                  const href = r.url ? safeHref(r.url) : null;
                  return (
                    <li key={i} className="flex [&>div]:flex-1">
                      <ReferenceCard
                        headingLevel="none"
                        href={href}
                        external={!!href && !href.startsWith("/")}
                        icon={BookMarked}
                        title={r.label}
                        meta={<span className="tabular">مرجع {i + 1}</span>}
                      />
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {showKind ? (
            <InfoPanel tone="note" className="mt-8 max-w-[68ch]">
              <p className="text-[14.5px] leading-7">
                محتوى تعريفي يساعدك على فهم أحكام الوقف ومتطلباته، {item.lastVerifiedAt ? "تحققنا من مراجعه في " : "حُدِّث في "}
                <time dateTime={new Date(updated).toISOString().slice(0, 10)}>{fmtDate(updated)}</time>. ولتطبيقه على حالتك، يقدّم مستشارونا{" "}
                <Link href="/services/C08" className="font-medium text-ink underline underline-offset-4">رأيًا مهنيًا موقّعًا</Link>.
              </p>
            </InfoPanel>
          ) : null}
          {after}
        </div>

        {toc.length > 2 ? (
          <nav aria-label="محتويات الصفحة" className="hidden lg:block">
            <div className="card sticky top-24 rounded-md border border-line bg-stone p-4">
              <p className="flex items-center gap-2 text-[14px] font-bold text-text">
                <ListTree aria-hidden className="size-4 text-ink" />
                في هذه الصفحة
              </p>
              <TocList toc={toc} />
            </div>
          </nav>
        ) : null}
      </Container>
    </article>
  );
}

function TocList({ toc }: { toc: { id: string; text: string }[] }) {
  return (
    <ol className="mt-3 space-y-0.5 border-s border-line-strong/70">
      {toc.map((h) => (
        <li key={h.id}>
          <a href={`#${h.id}`} className="-ms-px block border-s-2 border-transparent py-1.5 ps-3 text-[14px] leading-6 text-muted hover:border-ink hover:text-ink">
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  );
}
