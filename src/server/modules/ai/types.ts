/** Types shared by the assistant engine, the API and the client UI (no server imports). */

export const AI_DISCLOSURE = "إجابة آلية مستندة إلى المصادر المذكورة؛ وللرأي المهني في حالتك اطلب استشارة موقّعة";

export type CitationKind = "content" | "faq" | "glossary" | "requirement" | "data";

export type Citation = {
  n: number;
  kind: CitationKind;
  title: string;
  href: string;
  /** Short label for the chip: "دليل"، "سؤال شائع"، "REQ-012"، "بيانات وقفك". */
  label: string;
  snippet?: string;
};

export type ListItem = { text: string; href?: string; meta?: string; tone?: "critical" | "fine" | "warn" | "ok" | "info" | "neutral"; cite?: number };

export type AnswerBlock =
  | { type: "p"; text: string }
  | { type: "quote"; text: string; cite: number }
  | { type: "list"; items: ListItem[] }
  | { type: "actions"; items: { label: string; href: string }[] };

export type AskIntent = "obligations" | "assessment" | "documents_missing" | "requests" | "greeting" | "help" | "knowledge" | "refused" | "no_answer";

export type AskResult = {
  id: string | null;
  intent: AskIntent;
  refused: boolean;
  refusal?: { category: string; title: string; message: string; serviceHref: string | null; serviceLabel: string | null };
  blocks: AnswerBlock[];
  citations: Citation[];
  provider: "local" | "external";
  latencyMs: number;
  disclosure: string;
};

export type AskError = { error: string };

export type AssistDoc = { id: string; title: string; docType: string; mime: string };
export type SuggestionView = { id: string; field: string; label: string; value: string; display: string; confidence: number; status: string; current: string | null; evidence: string | null };
