import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { fmtDate } from "@/lib/utils";
import type { ContentRow } from "@/server/modules/public/queries";
import { Container, Crumbs } from "./bits";
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
              <p className="flex flex-wrap gap-x-3 text-[14px] text-muted">
                <span className="font-medium text-seal">{KIND_LABEL[item.kind] ?? item.kind}</span>
                {item.topic && TOPIC_LABEL[item.topic] ? <span>{TOPIC_LABEL[item.topic]}</span> : null}
                {item.readingMinutes ? <span>{item.readingMinutes} دقائق قراءة</span> : null}
              </p>
            ) : null}
            <h1 className="mt-2 font-naskh text-[1.9rem] font-bold leading-[1.5] text-ink md:text-[2.4rem]">{item.titleAr}</h1>
            {item.summary ? <p className="mt-3 text-[17px] leading-8 text-muted">{item.summary}</p> : null}
            <p className="mt-4 text-[13.5px] text-muted">
              {item.lastVerifiedAt ? "آخر تحقق من المراجع: " : "آخر تحديث: "}
              <time dateTime={new Date(updated).toISOString().slice(0, 10)}>{fmtDate(updated)}</time>
              {item.reviewerSpecialty && item.reviewedAt ? <>، وراجعه {SPECIALTY[item.reviewerSpecialty] ?? "مختص"}</> : null}
            </p>
          </div>
        </Container>
      </header>

      <Container className="grid gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {toc.length > 2 ? (
            <details className="mb-6 rounded-lg border border-line p-4 lg:hidden">
              <summary className="cursor-pointer font-medium">محتويات الصفحة</summary>
              <TocList toc={toc} />
            </details>
          ) : null}
          <Markdown source={item.bodyMd} className="prose-waqf text-[16.5px]" />

          {item.sourceRefs.length ? (
            <section aria-labelledby="sources" className="mt-12 max-w-[68ch] border-t border-line pt-6">
              <h2 id="sources" className="text-[17px] font-semibold">المراجع</h2>
              <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-[15px] leading-7 text-muted">
                {item.sourceRefs.map((r, i) => {
                  const href = r.url ? safeHref(r.url) : null;
                  return (
                    <li key={i}>
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-ink underline underline-offset-4">
                          {r.label}
                          <ExternalLink aria-hidden className="ms-1 inline size-3.5" />
                          <span className="sr-only"> (يفتح في نافذة جديدة)</span>
                        </a>
                      ) : (
                        r.label
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {showKind ? (
            <p className="mt-8 max-w-[68ch] rounded-md bg-surface-2 p-4 text-[14px] leading-7 text-muted">
              محتوى تعريفي يساعدك على فهم أحكام الوقف ومتطلباته، {item.lastVerifiedAt ? "تحققنا من مراجعه في " : "حُدِّث في "}
              <time dateTime={new Date(updated).toISOString().slice(0, 10)}>{fmtDate(updated)}</time>. ولتطبيقه على حالتك، يقدّم مستشارونا{" "}
              <Link href="/services/C08" className="font-medium text-ink underline underline-offset-4">رأيًا مهنيًا موقّعًا</Link>.
            </p>
          ) : null}
          {after}
        </div>

        {toc.length > 2 ? (
          <nav aria-label="محتويات الصفحة" className="hidden lg:block">
            <div className="sticky top-24">
              <p className="text-[14px] font-medium text-muted">في هذه الصفحة</p>
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
    <ol className="mt-2 space-y-1 border-s border-line">
      {toc.map((h) => (
        <li key={h.id}>
          <a href={`#${h.id}`} className="-ms-px block border-s-2 border-transparent py-1 ps-3 text-[14.5px] leading-6 text-muted hover:border-ink hover:text-ink">
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  );
}
