import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * A small, safe Markdown renderer for library/legal content.
 * Supports: ## / ### / #### headings, paragraphs, - and 1. lists (one nesting level), - [ ] task items,
 * GFM tables, > blockquotes, --- rules, **bold**, *italic*, `code`, [links](url).
 * It never emits raw HTML: every node is a React element and text is escaped by React.
 * Link targets are restricted to relative paths, anchors, http(s), mailto and tel.
 */

export type Heading = { id: string; text: string; level: number };

type Block =
  | { t: "h"; level: number; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "list"; ordered: boolean; items: ListItem[] }
  | { t: "table"; head: string[]; rows: string[][]; align: ("start" | "center" | "end")[] }
  | { t: "quote"; blocks: Block[] }
  | { t: "hr" };
type ListItem = { text: string; task?: boolean | null; children?: { ordered: boolean; items: ListItem[] } };

const UL = /^(\s*)[-*+]\s+(.*)$/;
const OL = /^(\s*)\d+[.)]\s+(.*)$/;
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let hIndex = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(Math.max(h[1].length, 2), 4); // a page has one h1 (its title)
      blocks.push({ t: "h", level, text: h[2], id: `s-${++hIndex}` });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", blocks: parseMarkdown(inner.join("\n")).map((b) => (b.t === "h" ? { t: "p", text: b.text } : b)) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "end" : "start") as "start" | "center" | "end");
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push({ t: "table", head, rows, align });
      continue;
    }
    if (UL.test(line) || OL.test(line)) {
      const ordered = !UL.test(line);
      const items: ListItem[] = [];
      const baseIndent = (UL.exec(line) ?? OL.exec(line))![1].length;
      while (i < lines.length) {
        const l = lines[i];
        const m = UL.exec(l) ?? OL.exec(l);
        if (!m) {
          // continuation line of the previous item (indented text), otherwise the list ends
          if (l.trim() && /^\s{2,}/.test(l) && items.length) {
            items[items.length - 1].text += ` ${l.trim()}`;
            i++;
            continue;
          }
          break;
        }
        const indent = m[1].length;
        if (indent > baseIndent && items.length) {
          const parent = items[items.length - 1];
          const childOrdered = !UL.test(l);
          parent.children ??= { ordered: childOrdered, items: [] };
          parent.children.items.push(toItem(m[2]));
          i++;
          continue;
        }
        if (indent < baseIndent) break;
        if (!ordered !== !!UL.test(l) && items.length) break; // list type switches → new list
        items.push(toItem(m[2]));
        i++;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }
    // paragraph: gather until blank line or another block starts
    const para: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !UL.test(lines[i]) &&
      !OL.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    )
      para.push(lines[i++].trim());
    blocks.push({ t: "p", text: para.join(" ") });
  }
  return blocks;
}

function toItem(text: string): ListItem {
  const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
  return task ? { text: task[2], task: task[1] !== " " } : { text };
}

export function headingsOf(src: string): Heading[] {
  return parseMarkdown(src).flatMap((b) => (b.t === "h" ? [{ id: b.id, text: stripInline(b.text), level: b.level }] : []));
}

export function stripInline(s: string) {
  return s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
}

// ───────────── inline ─────────────
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(\/(?!\/)|#)/.test(u)) return u;
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  return null;
}

const INLINE = /(\*\*([^*]+?)\*\*)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*\s][^*]*?)\*)/g;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${k++}`;
    if (m[1]) out.push(<strong key={key}>{renderInline(m[2], key)}</strong>);
    else if (m[3]) out.push(<code key={key} className="rounded bg-surface-2 px-1 text-[0.9em]" dir="ltr">{m[4]}</code>);
    else if (m[5]) {
      const href = safeHref(m[7]);
      const label = renderInline(m[6], key);
      if (!href) out.push(<Fragment key={key}>{label}</Fragment>);
      else if (href.startsWith("/")) out.push(<Link key={key} href={href}>{label}</Link>);
      else if (href.startsWith("#")) out.push(<a key={key} href={href}>{label}</a>);
      else out.push(<a key={key} href={href} rel="noopener noreferrer nofollow" target={/^https?:/.test(href) ? "_blank" : undefined}>{label}</a>);
    } else if (m[8]) out.push(<em key={key}>{renderInline(m[9], key)}</em>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ───────────── blocks ─────────────
function List({ ordered, items, k }: { ordered: boolean; items: ListItem[]; k: string }) {
  const Tag = ordered ? "ol" : "ul";
  const hasTasks = items.some((i) => i.task !== undefined && i.task !== null);
  return (
    <Tag className={hasTasks ? "!list-none !ps-0" : undefined}>
      {items.map((it, j) => (
        <li key={j} className={it.task !== undefined && it.task !== null ? "flex items-start gap-2" : undefined}>
          {it.task !== undefined && it.task !== null ? (
            <span aria-hidden className={`mt-2 inline-block size-3.5 shrink-0 rounded-sm border ${it.task ? "border-ok bg-ok" : "border-line-strong"}`} />
          ) : null}
          <span>
            {it.task !== undefined && it.task !== null ? <span className="sr-only">{it.task ? "منجز: " : "بند: "}</span> : null}
            {renderInline(it.text, `${k}-${j}`)}
            {it.children ? <List ordered={it.children.ordered} items={it.children.items} k={`${k}-${j}c`} /> : null}
          </span>
        </li>
      ))}
    </Tag>
  );
}

function renderBlocks(blocks: Block[], prefix = "b"): ReactNode[] {
  return blocks.map((b, n) => {
    const k = `${prefix}${n}`;
    switch (b.t) {
      case "h": {
        const Tag = (`h${b.level}`) as "h2" | "h3" | "h4";
        return <Tag key={k} id={b.id} className="scroll-mt-24">{renderInline(b.text, k)}</Tag>;
      }
      case "p":
        return <p key={k}>{renderInline(b.text, k)}</p>;
      case "hr":
        return <hr key={k} className="my-8 border-line" />;
      case "quote":
        return <blockquote key={k} className="my-5">{renderBlocks(b.blocks, `${k}q`)}</blockquote>;
      case "list":
        return <List key={k} ordered={b.ordered} items={b.items} k={k} />;
      case "table":
        return (
          <div key={k} className="my-5 -mx-1 overflow-x-auto px-1" role="region" aria-label="جدول" tabIndex={0}>
            <table className="!my-0 min-w-[480px]">
              <thead>
                <tr className="bg-surface-2">
                  {b.head.map((c, j) => (
                    <th key={j} scope="col" style={{ textAlign: b.align[j] ?? "start" }} className="font-semibold">{renderInline(c, `${k}h${j}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>
                    {b.head.map((_, j) => (
                      <td key={j} style={{ textAlign: b.align[j] ?? "start" }}>{renderInline(r[j] ?? "", `${k}r${ri}c${j}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={className ?? "prose-waqf"}>{renderBlocks(parseMarkdown(source))}</div>;
}
