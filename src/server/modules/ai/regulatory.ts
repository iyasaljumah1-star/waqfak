import "server-only";
import { withSystem, type Tx } from "@/server/db";
import { retrieve } from "@/server/knowledge/retrieve";

/**
 * The public assistant and regulatory or sharia questions (owner's order 2026-11-06, §2.7; independent review B11).
 * The assistant's own index holds the platform's library: articles explaining the regulations, FAQs, glossary terms
 * and descriptions of regulatory requirements. Those are not the text of any regulation or fiqh book, and the assistant
 * must not present them as a regulatory or sharia basis. When a question asks what a regulation provides or what the
 * ruling is, the basis is sought ONLY through the knowledge engine (knowledge/retrieve.ts) and its citation policy:
 *  - if the policy finds a sufficient, citable basis, that basis is what the answer quotes, with the policy's label;
 *  - otherwise the answer says «المراجع غير كافية», may still list library material clearly labelled as explanatory,
 *    and no external model is asked to compose an answer from the library material.
 * Reference texts carry no waqf data; they are read in the system context, as the assistant reads its library.
 */

/** A question about what a regulation, an article or the fiqh provides (rather than about the user's own waqf). */
export const REGULATORY_QUESTION =
  /(?:^|\s)(?:المادة|مادة|م\s?\d|نص\s+(?:النظام|اللائحة)|اللائحة|لائحة|النظام|نظام\s+(?:الهيئة|المعاملات|الشركات|الأوقاف)|يجوز|لا\s+يجوز|يجب|يلزم|يحق|حكم|الحكم|شرعا|شرعًا|شرعي|نظاما|نظامًا|نظامي|المذهب|الحنابلة|الحنبلي|(?:ال)?(?:غرامة|غرامات|جزاء|جزاءات|مخالفة|مخالفات|عقوبة|عقوبات))(?=\s|$|[؟?.,،])/;

export const isRegulatoryQuestion = (q: string) => REGULATORY_QUESTION.test(q);

/** Relevance a passage must reach to be quoted to a customer by the assistant (the engine's bar is 0.5). */
export const ASSISTANT_MIN_COVERAGE = 0.75;

/** Binding basis needed: the question asks what a regulation requires or provides (not a fiqh or general question). */
const NEEDS_BINDING = /(?:^|\s)(?:المادة|مادة|م\s?\d|نص\s+(?:النظام|اللائحة)|اللائحة|لائحة|النظام|يجب|يلزم|نظاما|نظامًا|نظامي|(?:ال)?(?:غرامة|غرامات|جزاء|جزاءات|مخالفة|مخالفات|عقوبة|عقوبات))(?=\s|$|[؟?.,،])/;

export type RegulatoryBasis =
  | { sufficient: true; quotes: { label: string; text: string; refCode: string; locator: string; binding: boolean }[] }
  | { sufficient: false; reason: string };

export function regulatoryBasis(question: string, asOf = new Date().toISOString().slice(0, 10)): Promise<RegulatoryBasis> {
  return withSystem((tx) => regulatoryBasisIn(tx, question, asOf));
}

/** The same within a given transaction (tests and the probes run it on the test database). */
export async function regulatoryBasisIn(tx: Tx, question: string, asOf: string): Promise<RegulatoryBasis> {
  const r = await retrieve(tx, { question, service: "*", asOf, needBinding: NEEDS_BINDING.test(question), limit: 4 });
  if (!r.sufficiency.sufficient) return { sufficient: false, reason: r.sufficiency.reason };
  // the assistant answers a customer directly, without an analyst between: only a passage that clearly covers the
  // question is quoted as the basis (independent review N5-5)
  const strong = r.citable.filter((x) => x.hit.coverage >= ASSISTANT_MIN_COVERAGE);
  if (!strong.length) return { sufficient: false, reason: "المراجع غير كافية: لا نص قابل للاستشهاد يغطي سؤالك بوضوح." };
  return {
    sufficient: true,
    quotes: strong.slice(0, 3).map((x) => ({
      label: x.decision.citable ? x.decision.label : x.hit.refCode, text: x.hit.text, refCode: x.hit.refCode, locator: x.hit.locator,
      binding: x.decision.citable ? x.decision.binding : false,
    })),
  };
}
