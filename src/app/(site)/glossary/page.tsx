import type { Metadata } from "next";
import { Container, JsonLd, PageIntro, SITE_URL } from "@/components/site/bits";
import { getGlossary } from "@/server/modules/public/queries";

export const metadata: Metadata = {
  title: "قاموس مصطلحات الوقف",
  description: "تعريفات واضحة لمصطلحات الوقف: الناظر والواقف والموقوف عليه والغبطة والاستبدال والوقف الذري والمشترك وفئات الأوقاف، مع مصدر كل تعريف.",
  alternates: { canonical: "/glossary" },
};

const ALPHABET = "ا ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي".split(" ");

/** Dictionary convention: ignore the definite article «ال» and unify alef forms when indexing. */
function indexKey(term: string) {
  let t = term.trim().replace(/[ً-ْـ]/g, "");
  if (t.startsWith("ال") && t.length > 3) t = t.slice(2);
  return t.replace(/^[أإآٱ]/, "ا").replace(/^ى/, "ي");
}

export default async function GlossaryPage() {
  const terms = await getGlossary();
  const bySlug = new Map(terms.map((t) => [t.slug, t]));
  const sorted = [...terms].sort((a, b) => indexKey(a.term).localeCompare(indexKey(b.term), "ar"));
  const groups = new Map<string, typeof terms>();
  for (const t of sorted) {
    const first = indexKey(t.term)[0];
    const letter = ALPHABET.includes(first) ? first : "#";
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(t);
  }
  const letters = [...ALPHABET, "#"].filter((l) => groups.has(l));

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "DefinedTermSet",
          name: "قاموس مصطلحات الوقف",
          url: `${SITE_URL}/glossary`,
          hasDefinedTerm: terms.map((t) => ({ "@type": "DefinedTerm", name: t.term, description: t.definition, url: `${SITE_URL}/glossary#${t.slug}` })),
        }}
      />
      <PageIntro
        crumbs={[{ label: "قاموس المصطلحات" }]}
        title="قاموس مصطلحات الوقف"
        lede={`${terms.length} مصطلحًا مرتبة على حروف الهجاء دون «ال» التعريف، ولكل تعريف مصدره.`}
      />
      <nav aria-label="حروف الهجاء" className="sticky top-16 z-20 border-b border-line bg-surface/95 backdrop-blur md:top-[72px]">
        <Container>
          <ul className="flex gap-1 overflow-x-auto py-2">
            {ALPHABET.map((l) => (
              <li key={l}>
                {groups.has(l) ? (
                  <a href={`#letter-${l}`} className="grid size-9 place-items-center rounded-md font-naskh text-[17px] font-bold text-ink hover:bg-ink-soft">{l}</a>
                ) : (
                  <span aria-hidden className="grid size-9 place-items-center font-naskh text-[17px] text-line-strong">{l}</span>
                )}
              </li>
            ))}
          </ul>
        </Container>
      </nav>
      <Container className="py-10">
        <div className="space-y-12">
          {letters.map((l) => (
            <section key={l} id={`letter-${l}`} aria-labelledby={`lh-${l}`} className="scroll-mt-36 grid gap-4 md:grid-cols-[80px_minmax(0,1fr)]">
              <h2 id={`lh-${l}`} className="font-naskh text-[2.5rem] font-bold leading-none text-ink/80 md:sticky md:top-36 md:self-start">
                {l === "#" ? "أخرى" : l}
              </h2>
              <dl className="divide-y divide-line border-y border-line">
                {groups.get(l)!.map((t) => (
                  <div key={t.id} id={t.slug} className="scroll-mt-36 py-5 target:bg-seal-soft/50 target:px-3">
                    <dt className="font-naskh text-[1.25rem] font-bold text-text">
                      <a href={`#${t.slug}`} className="hover:text-ink">{t.term}</a>
                    </dt>
                    <dd className="mt-1 max-w-3xl">
                      <p className="text-[15.5px] leading-8">{t.definition}</p>
                      {t.synonyms.length ? <p className="mt-1 text-[14px] text-muted">ويُسمى أيضًا: {t.synonyms.join("، ")}</p> : null}
                      {t.related.length ? (
                        <p className="mt-1 text-[14px] text-muted">
                          انظر:{" "}
                          {t.related
                            .map((s) => bySlug.get(s))
                            .filter((r): r is NonNullable<typeof r> => !!r)
                            .map((r, i) => (
                              <span key={r.slug}>
                                {i ? "، " : null}
                                <a href={`#${r.slug}`} className="text-ink underline underline-offset-4">{r.term}</a>
                              </span>
                            ))}
                        </p>
                      ) : null}
                      {t.source ? <p className="mt-1 text-[13px] text-muted">المصدر: {t.source}</p> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Container>
    </>
  );
}
