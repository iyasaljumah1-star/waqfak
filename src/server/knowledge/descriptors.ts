/**
 * Arabic descriptors of foreign-language passages (owner's order of 2026-11-08, case 7L). A specialist who recorded a
 * verified passage also recorded the Arabic question it answers (data/knowledge/specialist/passages-*.json). For a
 * passage whose text is not Arabic — an English press release — that descriptor is what an Arabic question can be
 * matched against. It is curated metadata, used for MATCHING ONLY: never quoted, never passed on as the source's text
 * (the passage keeps its own words), and the match is flagged as made through the descriptor.
 */
import accounting from "../../../data/knowledge/specialist/passages-accounting.json";
import fiqh from "../../../data/knowledge/specialist/passages-fiqh.json";
import investment from "../../../data/knowledge/specialist/passages-investment.json";
import t02 from "../../../data/knowledge/specialist/passages-t02.json";

type P = { refId: string; locator: string; question?: string };
const MAP = new Map<string, string>();
for (const p of [...accounting, ...fiqh, ...investment, ...t02] as P[]) if (p.question) MAP.set(`${p.refId}|${p.locator}`, p.question);

/** Share of Arabic letters among the letters of a text. */
export const arabicShare = (s: string) => {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => /[؀-ۿ]/.test(c)).length / letters.length : 1;
};

/** The specialist's Arabic descriptor of a passage, when the passage itself is not in Arabic; else null. */
export function arabicDescriptor(refCode: string, locator: string, text: string): string | null {
  if (arabicShare(text.replace(/^\[[^\]]+\]\s*/, "")) >= 0.3) return null;
  return MAP.get(`${refCode}|${locator}`) ?? null;
}
