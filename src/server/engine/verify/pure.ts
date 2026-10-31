/**
 * Verification of generated text against its sources (PURE, unit-tested). A section is rejected — never silently
 * kept — when it cites a number it was not given, cites nothing although it rests on sources, names an article that
 * the cited passages do not contain, or still carries a placeholder.
 */
import type { LlmSource } from "../llm/types";
import { articleNumber } from "../knowledge/pure";

export type SectionCheck = { ok: boolean; problems: string[]; warnings: string[] };

const PLACEHOLDER = /\[(يُستكمل|يستكمل|تعارض يُحسم)[^\]]*\]|يستكمل المختص|يُستكمل المختص|لم يُكتب بعد|TODO|xxx/i;

/** Article mentions in a text: «المادة الخامسة», «المادة (12)», «م 12». */
export function articleMentions(text: string): { raw: string; no: number | null }[] {
  const out: { raw: string; no: number | null }[] = [];
  for (const m of text.matchAll(/المادة\s+(?:\(?\d{1,4}\)?|(?:ال[ء-ي]+(?:\s+و?ال[ء-ي]+){0,3}(?:\s+بعد\s+ال[ء-ي]+)?))/g)) out.push({ raw: m[0], no: articleNumber(m[0]) });
  for (const m of text.matchAll(/(?:^|\s)م\s?\.?\s?(\d{1,4})(?=[\s/،.)]|$)/g)) out.push({ raw: m[0].trim(), no: Number(m[1]) });
  return out;
}

export function checkSection(p: { text: string; citations: number[]; sources: LlmSource[]; sourceArticles: Map<number, number | null>; requireCitation: boolean }): SectionCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const given = new Set(p.sources.map((s) => s.n));
  const inText = [...p.text.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
  const cited = new Set([...p.citations, ...inText]);
  if (!p.text.trim()) problems.push("النص فارغ.");
  if (PLACEHOLDER.test(p.text)) problems.push("النص فيه عبارة مؤقتة أو موضع لم يُستكمل.");
  for (const n of cited) if (!given.has(n)) problems.push(`يستشهد بمرجع رقم [${n}] لم يُعطَ له.`);
  if (p.requireCitation && ![...cited].some((n) => given.has(n))) problems.push("لا يستند إلى أي مرجع من المراجع المعطاة.");
  for (const n of p.citations) if (!inText.includes(n)) warnings.push(`المرجع [${n}] مذكور في قائمة الاستشهاد ولا يظهر في النص.`);
  // an article named in the text must be the article of one of the cited passages
  const citedArticles = new Set([...cited].map((n) => p.sourceArticles.get(n)).filter((x): x is number => typeof x === "number"));
  const citedText = p.sources.filter((s) => cited.has(s.n)).map((s) => s.text).join("\n");
  for (const a of articleMentions(p.text)) {
    if (a.no === null) { if (!citedText.includes(a.raw)) warnings.push(`ذكر «${a.raw}» ولم يُتحقق منه آليًا.`); continue; }
    if (!citedArticles.has(a.no) && !citedText.includes(a.raw)) problems.push(`يذكر «${a.raw}» ولا تتضمنها المقاطع المستشهد بها.`);
  }
  return { ok: problems.length === 0, problems, warnings };
}

/** Facts named in the text must match the request's data: a date or an amount the request does not contain is flagged. */
export function unknownFigures(text: string, known: string[]): string[] {
  const haystack = known.join(" ");
  const figures = [...text.matchAll(/\b\d{1,3}(?:[,٬]\d{3})+(?:\.\d+)?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{3,}\b/g)].map((m) => m[0]);
  return [...new Set(figures)].filter((f) => !haystack.includes(f) && !haystack.includes(f.replace(/[,٬]/g, "")));
}
