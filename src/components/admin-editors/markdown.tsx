import { Fragment, type ReactNode } from "react";

/**
 * Small, safe Markdown renderer for the content editor preview (and anywhere CMS text is shown).
 * It builds React elements — never HTML strings — so content cannot inject markup or scripts.
 * Supports: # headings (1–4), paragraphs, - / * / 1. lists, > quotes, | tables |, ---, ``` code ```,
 * **bold**, *italic*, `code`, [links](https://… or /path).
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={className ?? "md-body space-y-4 leading-8"}>{blocks(source ?? "")}</div>;
}

const safeHref = (u: string) => (/^https:\/\//.test(u) || /^\/(?!\/)/.test(u) || /^#/.test(u) ? u : null);

export function inline(text: string, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${n++}`;
    if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[3] !== undefined) out.push(<code key={k} className="rounded bg-surface-2 px-1 text-[0.9em]" dir="ltr">{m[3]}</code>);
    else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      out.push(href ? <a key={k} href={href} className="text-ink underline" {...(href.startsWith("https://") ? { rel: "noopener noreferrer", target: "_blank" } : {})}>{inline(m[4], k)}</a> : <span key={k}>{m[4]}</span>);
    } else if (m[6] !== undefined) out.push(<em key={k}>{m[6]}</em>);
    else if (m[7] !== undefined) out.push(<em key={k}>{m[7]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function blocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(<pre key={key} dir="ltr" className="overflow-x-auto rounded-md bg-surface-2 p-3 text-[13px] leading-6"><code>{buf.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = ["", "text-2xl font-bold", "text-xl font-semibold mt-6", "text-lg font-semibold mt-4", "font-semibold"][level];
      const content = inline(h[2], key);
      out.push(level === 1 ? <h2 key={key} className={cls}>{content}</h2> : level === 2 ? <h2 key={key} className={cls}>{content}</h2> : level === 3 ? <h3 key={key} className={cls}>{content}</h3> : <h4 key={key} className={cls}>{content}</h4>);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={key} className="border-line" />);
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) body.push(cells(lines[i++]));
      out.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr>{head.map((c, j) => <th key={j} className="border border-line bg-surface-2 px-2 py-1.5 text-start font-semibold">{inline(c, `${key}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{head.map((_, j) => <td key={j} className="border border-line px-2 py-1.5 align-top">{inline(r[j] ?? "", `${key}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(<blockquote key={key} className="border-s-4 border-seal ps-4 text-muted">{blocks(buf.join("\n"))}</blockquote>);
      continue;
    }
    if (/^\s*([-*])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      const itemRe = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && itemRe.test(lines[i])) {
        let t = lines[i++].replace(itemRe, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !itemRe.test(lines[i])) t += ` ${lines[i++].trim()}`;
        items.push(t);
      }
      const lis = items.map((t, j) => <li key={j}>{inline(t, `${key}l${j}`)}</li>);
      out.push(ordered ? <ol key={key} className="list-decimal space-y-1 ps-6">{lis}</ol> : <ul key={key} className="list-disc space-y-1 ps-6">{lis}</ul>);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>\s?|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) buf.push(lines[i++]);
    out.push(
      <p key={key}>
        {buf.map((b, j) => (
          <Fragment key={j}>
            {j ? <br /> : null}
            {inline(b, `${key}p${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return out;
}
