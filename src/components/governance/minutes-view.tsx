import { inlineRuns, parseMd } from "@/server/modules/governance/pure";

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineRuns(text).map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>))}
    </>
  );
}

/** Renders minutes text (safe subset of markdown: headings, bold, bullet lists, paragraphs). No raw HTML. */
export function MinutesView({ body }: { body: string }) {
  return (
    <div className="deed-paper naskh space-y-3 rounded-lg border border-line p-4 text-[16px] leading-8 md:p-8">
      {parseMd(body).map((b, i) => {
        if (b.t === "h") {
          const cls = b.level === 1 ? "text-[1.4rem] font-bold text-ink" : b.level === 2 ? "mt-4 text-[1.15rem] font-bold text-ink" : "mt-3 font-bold";
          return b.level === 1 ? <h3 key={i} className={cls}><Inline text={b.text} /></h3> : b.level === 2 ? <h4 key={i} className={cls}><Inline text={b.text} /></h4> : <h5 key={i} className={cls}><Inline text={b.text} /></h5>;
        }
        if (b.t === "ul")
          return (
            <ul key={i} className="list-disc space-y-1 ps-6">
              {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
            </ul>
          );
        return <p key={i} className="whitespace-pre-line"><Inline text={b.text} /></p>;
      })}
    </div>
  );
}
