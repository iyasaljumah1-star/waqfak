import "server-only";
import { eq } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { featureFlags } from "@/server/db/schema";
import { buildMessages } from "./prompt";

/**
 * Optional external LLM adapter (OpenAI-compatible chat completions over fetch; provider-agnostic).
 * Used ONLY when the feature flag `ai.external_llm` is ON **and** AI_API_KEY / AI_BASE_URL (or AI_API_URL) / AI_MODEL
 * are set at runtime. It receives only the masked question and the already-retrieved public snippets — never waqf
 * records, documents or user identity. The model has no tools; its output is used only if it cites the sources.
 */

let flagCache: { at: number; on: boolean } | null = null;

export async function externalEnabled(): Promise<boolean> {
  if (!flagCache || Date.now() - flagCache.at > 30_000) {
    const [f] = await withSystem((tx) => tx.select({ on: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, "ai.external_llm")).limit(1));
    flagCache = { at: Date.now(), on: !!f?.on };
  }
  if (!flagCache.on) return false;
  return !!(process.env.AI_API_KEY && (process.env.AI_BASE_URL || process.env.AI_API_URL) && process.env.AI_MODEL);
}

export async function externalAnswer(question: string, sources: { n: number; title: string; text: string }[]): Promise<{ text: string; model: string } | null> {
  const key = process.env.AI_API_KEY;
  const base = (process.env.AI_BASE_URL || process.env.AI_API_URL || "").replace(/\/+$/, "");
  const model = process.env.AI_MODEL;
  if (!key || !base || !model) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: buildMessages(question, sources), temperature: 0.1, max_tokens: 700 }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim();
    // Accept only grounded output: it must cite at least one provided source number.
    if (!text || !/\[\d+\]/.test(text)) return null;
    const valid = new Set(sources.map((s) => s.n));
    if ([...text.matchAll(/\[(\d+)\]/g)].some((m) => !valid.has(Number(m[1])))) return null;
    return { text: text.replace(/<[^>]*>/g, "").slice(0, 3000), model };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
