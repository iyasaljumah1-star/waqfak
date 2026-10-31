/**
 * The engine's single interface to a language model (PURE types). Services never name a provider: they hand the
 * engine a task; the provider configured at runtime answers it. Replacing the model or its host is a configuration
 * change, not a rebuild.
 */

/** A passage the model may cite, numbered for the task: the model cites [n] and nothing else. */
export type LlmSource = { n: number; chunkId: string; refCode: string; locator: string; text: string };

export type LlmTask = {
  /** What the section is for (heading and the instruction of the section in the service's template). */
  section: { key: string; title: string; instruction: string };
  service: { code: string; name: string };
  /** Facts the rules established and the data of the request, already masked of personal identifiers. */
  facts: Record<string, unknown>;
  /** Decisions the rules took (the model must not contradict them). */
  decisions: { key: string; value: string; basis: string }[];
  sources: LlmSource[];
  /** Written guidance of the system administrator for a regeneration, if any. */
  instruction?: string | null;
  promptVersion: string;
};

/** What a provider returns for a section: the text, the source numbers it relies on, and a short auditable rationale. */
export type LlmSectionResult = { text: string; citations: number[]; rationale: string };

export interface LlmProvider {
  /** «openai-compatible», «mock», «disabled». */
  readonly id: string;
  readonly model: string;
  /** Whether the provider can be called now (configured and reachable by configuration — not a network probe). */
  configured(): boolean;
  analyze(task: LlmTask): Promise<LlmSectionResult | null>;
}

export const PROMPT_VERSION = "section-v1";
