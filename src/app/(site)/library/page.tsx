import type { Metadata } from "next";
import Link from "next/link";
import { Search, SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { ContentRowLink, Container, FilterChip, PageIntro } from "@/components/site/bits";
import { CONTENT_AUDIENCE_LABEL, KIND_PLURAL, TOPIC_LABEL, TOPIC_ORDER } from "@/components/site/labels";
import { filterLibrary, getLibrary, normalizeAr, searchLibraryBodies } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: "المكتبة",
  description: "مقالات وأدلة وملخصات نظامية عن الأوقاف: التأسيس والتسجيل والنظارة والحوكمة والمالية والاستثمار والمستفيدين، مع مرجع كل معلومة.",
  alternates: { canonical: "/library" },
};

type SP = { kind?: string; topic?: string; audience?: string; q?: string };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const all = await getLibrary();
  const kinds = [...new Set(all.map((i) => i.kind))];
  const topics = TOPIC_ORDER.filter((t) => all.some((i) => i.topic === t));
  const kind = kinds.includes(sp.kind ?? "") ? sp.kind! : "";
  const topic = topics.includes(sp.topic ?? "") ? sp.topic! : "";
  const audience = sp.audience && CONTENT_AUDIENCE_LABEL[sp.audience] ? sp.audience : "";
  const q = (sp.q ?? "").slice(0, 80).trim();

  let items = filterLibrary(all, { kind, topic, audience });
  if (q) {
    const bodyHits = await searchLibraryBodies(q);
    const nq = normalizeAr(q);
    items = items
      .filter((i) => bodyHits.has(i.id) || normalizeAr(`${i.titleAr} ${i.summary ?? ""}`).includes(nq))
      .sort((a, b) => Number(normalizeAr(b.titleAr).includes(nq)) - Number(normalizeAr(a.titleAr).includes(nq)));
  }

  const href = (patch: Partial<SP>) => {
    const next = { kind, topic, audience, q, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/library${s ? `?${s}` : ""}`;
  };
  const filtered = !!(kind || topic || audience || q);

  return (
    <>
      <PageIntro
        crumbs={[{ label: "المكتبة" }]}
        title="المكتبة"
        lede="ما يحتاج إليه الواقف والناظر والمستفيد من معرفة، بلغة واضحة ومرجع لكل معلومة من الأنظمة والأدلة الرسمية."
      >
        <form action="/library" method="get" role="search" className="mt-6 flex max-w-xl gap-2">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          {topic ? <input type="hidden" name="topic" value={topic} /> : null}
          {audience ? <input type="hidden" name="audience" value={audience} /> : null}
          <label htmlFor="lib-q" className="sr-only">ابحث في المكتبة</label>
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              id="lib-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="مثل: تسجيل الوقف، الموازنة، المستفيد الحقيقي"
              className="h-12 w-full rounded-md border border-line-strong bg-surface ps-9 pe-3 text-[15px] placeholder:text-muted/80 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </div>
          <button type="submit" className="h-12 rounded-md bg-ink px-5 font-medium text-white hover:bg-ink-hover dark:text-[#0f141c]">ابحث</button>
        </form>
      </PageIntro>

      <Container className="grid gap-10 py-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="تصفية المكتبة" className="space-y-6">
          <FilterGroup title="النوع">
            <FilterChip href={href({ kind: "" })} active={!kind}>الكل</FilterChip>
            {kinds.map((k) => (
              <FilterChip key={k} href={href({ kind: k })} active={kind === k}>{KIND_PLURAL[k] ?? k}</FilterChip>
            ))}
          </FilterGroup>
          <FilterGroup title="لمن">
            <FilterChip href={href({ audience: "" })} active={!audience}>الجميع</FilterChip>
            {Object.entries(CONTENT_AUDIENCE_LABEL).map(([k, v]) => (
              <FilterChip key={k} href={href({ audience: k })} active={audience === k}>{v}</FilterChip>
            ))}
          </FilterGroup>
          <FilterGroup title="الموضوع">
            <FilterChip href={href({ topic: "" })} active={!topic}>كل الموضوعات</FilterChip>
            {topics.map((t) => (
              <FilterChip key={t} href={href({ topic: t })} active={topic === t}>{TOPIC_LABEL[t] ?? t}</FilterChip>
            ))}
          </FilterGroup>
        </aside>

        <section aria-label="نتائج المكتبة" className="min-w-0">
          <p role="status" className="text-[14px] text-muted">
            {q ? <>نتائج البحث عن «{q}»: </> : null}
            {items.length} {items.length === 1 ? "مادة" : items.length === 2 ? "مادتان" : items.length <= 10 ? "مواد" : "مادة"}
            {filtered ? <> — <Link href="/library" className="font-medium text-ink underline underline-offset-4">أزل التصفية</Link></> : null}
          </p>
          {items.length ? (
            <div className="mt-2 divide-y divide-line border-b border-line">
              {items.map((i) => (
                <ContentRowLink key={i.id} item={i} headingLevel={2} />
              ))}
            </div>
          ) : (
            <div className="mt-6">
              <EmptyState icon={SearchX} title="لم نجد مادة تطابق بحثك">
                جرّب كلمة أقصر أو مرادفًا لها، أو ابحث في <Link href="/faq" className="text-ink underline">الأسئلة الشائعة</Link> و<Link href="/glossary" className="text-ink underline">قاموس المصطلحات</Link>.
              </EmptyState>
            </div>
          )}
        </section>
      </Container>
    </>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={title}>
      <p className="mb-2 text-[14px] font-medium text-muted">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
