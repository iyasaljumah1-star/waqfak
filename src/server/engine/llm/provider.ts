import "server-only";
import { parseSectionAnswer, sectionMessages } from "./prompt";
import type { LlmProvider, LlmSectionResult, LlmTask } from "./types";

/**
 * Providers. Chosen at runtime by ENGINE_LLM_PROVIDER: «openai-compatible» (the current model hosting: any server
 * speaking the OpenAI chat-completions protocol — a self-hosted vLLM/TGI server or an external endpoint), «mock»
 * (deterministic, for tests and demonstrations on synthetic data only), or «disabled» (the default). Endpoint, key and
 * model come from the environment (ENGINE_LLM_BASE_URL / ENGINE_LLM_API_KEY / ENGINE_LLM_MODEL, falling back to the
 * assistant's AI_BASE_URL / AI_API_KEY / AI_MODEL) and are never stored in the code.
 */

class OpenAiCompatible implements LlmProvider {
  readonly id = "openai-compatible";
  constructor(private base: string, private key: string, readonly model: string, private timeoutMs = 60_000) {}
  configured() { return !!(this.base && this.model); }
  async analyze(task: LlmTask): Promise<LlmSectionResult | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.base.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify({ model: this.model, messages: sectionMessages(task), temperature: 0.1, max_tokens: 1800, response_format: { type: "json_object" } }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`llm_http_${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return parseSectionAnswer(json.choices?.[0]?.message?.content ?? "");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Deterministic stand-in: writes the section from the decisions and the first passages it is given, citing them. It
 * proves the plumbing (task, citations, verification, record), not the quality of a model; recorded as «mock».
 */
class MockProvider implements LlmProvider {
  readonly id = "mock";
  readonly model = "mock-deterministic-1";
  configured() { return true; }
  async analyze(task: LlmTask): Promise<LlmSectionResult | null> {
    const used = task.sources.slice(0, 2);
    const lines = [
      ...task.decisions.map((d) => `${d.value} (${d.basis}).`),
      ...used.map((s) => `ويُستأنس في ذلك بما ورد في ${s.locator} من المرجع ${s.refCode} [${s.n}].`),
    ];
    if (!lines.length) return null;
    return { text: `${task.section.title}: ${lines.join(" ")}`, citations: used.map((s) => s.n), rationale: "صياغة آلية تجريبية من القرارات والمراجع المعطاة." };
  }
}

class Disabled implements LlmProvider {
  readonly id = "disabled";
  readonly model = "none";
  configured() { return false; }
  async analyze(): Promise<LlmSectionResult | null> { return null; }
}

export function llmProvider(): LlmProvider {
  const id = (process.env.ENGINE_LLM_PROVIDER ?? "disabled").trim();
  if (id === "mock") return new MockProvider();
  if (id === "openai-compatible") {
    const base = process.env.ENGINE_LLM_BASE_URL || process.env.AI_BASE_URL || process.env.AI_API_URL || "";
    const key = process.env.ENGINE_LLM_API_KEY || process.env.AI_API_KEY || "";
    const model = process.env.ENGINE_LLM_MODEL || process.env.AI_MODEL || "";
    return new OpenAiCompatible(base, key, model, Number(process.env.ENGINE_LLM_TIMEOUT_MS ?? 60_000));
  }
  return new Disabled();
}
