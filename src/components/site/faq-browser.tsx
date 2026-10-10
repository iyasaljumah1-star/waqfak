"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, Search, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";

export type FaqItem = { id: string; question: string; answer: string; audience: string; topic: string; source: string | null };

const norm = (s: string) =>
  s.toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

const AUD: Record<string, string> = { all: "الجميع", waqif: "الواقف", nazir: "الناظر", board: "مجلس النظارة", beneficiary: "المستفيد", entities: "الجهات" };

export function FaqBrowser({ items, topics, initialAudience }: { items: FaqItem[]; topics: { key: string; label: string }[]; initialAudience?: string }) {
  const [q, setQ] = useState("");
  const [aud, setAud] = useState(initialAudience && AUD[initialAudience] ? initialAudience : "");
  const dq = useDeferredValue(q);

  const groups = useMemo(() => {
    const words = norm(dq).split(" ").filter((w) => w.length > 1);
    const hit = items.filter(
      (f) => (!aud || f.audience === aud || f.audience === "all") && words.every((w) => norm(`${f.question} ${f.answer}`).includes(w)),
    );
    return topics.map((t) => ({ ...t, items: hit.filter((f) => f.topic === t.key) })).filter((g) => g.items.length);
  }, [items, topics, dq, aud]);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const searching = !!dq.trim();

  return (
    <div className="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <div>
          <label htmlFor="faq-q" className="mb-2 block text-[14px] font-medium text-muted">ابحث في الأسئلة</label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              id="faq-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="مثل: الثلث، التسجيل، الصرف"
              className="h-11 w-full rounded-md border border-line-strong bg-surface ps-9 pe-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </div>
        </div>
        <div role="group" aria-label="لمن">
          <p className="mb-2 text-[14px] font-medium text-muted">لمن</p>
          <div className="flex flex-wrap gap-2">
            {[["", "الجميع"], ...Object.entries(AUD).filter(([k]) => k !== "all")].map(([k, v]) => (
              <button
                key={k}
                type="button"
                aria-pressed={aud === k}
                onClick={() => setAud(k)}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3.5 text-[14px] font-medium",
                  aud === k ? "border-ink bg-ink text-white dark:text-[#0f141c]" : "border-line-strong bg-surface hover:border-ink hover:text-ink",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {!searching ? (
          <nav aria-label="الموضوعات" className="hidden lg:block">
            <p className="mb-2 text-[14px] font-medium text-muted">الموضوعات</p>
            <ul className="space-y-1 border-s border-line">
              {groups.map((g) => (
                <li key={g.key}>
                  <a href={`#t-${g.key}`} className="-ms-px block border-s-2 border-transparent py-1 ps-3 text-[14.5px] text-muted hover:border-ink hover:text-ink">
                    {g.label} <span className="tabular text-[12.5px]">({g.items.length})</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>

      <div className="min-w-0">
        <p role="status" aria-live="polite" className="text-[14px] text-muted">
          {searching ? `${count} نتيجة للبحث عن «${dq.trim()}»` : `${count === 1 ? "سؤال واحد" : count === 2 ? "سؤالان" : count >= 3 && count <= 10 ? `${count} أسئلة` : `${count} سؤالًا`}`}
        </p>
        {groups.length ? (
          <div className="mt-4 space-y-10">
            {groups.map((g) => (
              <section key={g.key} id={`t-${g.key}`} aria-labelledby={`th-${g.key}`} className="scroll-mt-24">
                <h2 id={`th-${g.key}`} className="font-naskh text-[1.4rem] font-bold text-ink">{g.label}</h2>
                <ul className="mt-2 divide-y divide-line border-y border-line">
                  {g.items.map((f) => (
                    <li key={f.id}>
                      <details className="group" open={searching && count <= 3}>
                        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 text-[16px] font-medium leading-7 hover:text-ink [&::-webkit-details-marker]:hidden">
                          <span>{f.question}</span>
                          <ChevronDown aria-hidden className="mt-1 size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="pb-5 pe-9">
                          <p className="text-[15.5px] leading-8 text-text/90">{f.answer}</p>
                          {f.source ? <p className="mt-2 text-[13.5px] leading-6 text-muted">المرجع: {f.source}</p> : null}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
            <SearchX aria-hidden className="size-8 text-muted" />
            <p className="font-semibold">لا يوجد سؤال يطابق بحثك</p>
            <p className="max-w-md text-sm text-muted">
              جرّب كلمة أخرى أوضح، أو <a href="/contact?topic=question" className="text-ink underline">أرسل سؤالك إلينا</a>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
