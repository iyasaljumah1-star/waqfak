import "server-only";
import { and, eq } from "drizzle-orm";
import { withContext } from "@/server/db";
import { aiInteractions } from "@/server/db/schema";
import { ForbiddenError, loadWaqfAccess, type Auth } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { rateLimit } from "@/server/lib/rate-limit";
import { UserError } from "../_shared";
import { getIndex } from "./corpus";
import { answerAssessment, answerMissingDocuments, answerObligations, answerRequests, type ContextAnswer } from "./context";
import { externalAnswer, externalEnabled } from "./external";
import { classifyIntent } from "./intents";
import { classifyRefusal, maskPII } from "./safety";
import { AI_DISCLOSURE, type AnswerBlock, type AskIntent, type AskResult, type Citation } from "./types";

export const MAX_QUESTION = 500;
const MIN_COVERAGE = 0.5;

export class RateLimitedError extends Error {}

/** Flattens answer blocks into plain text for the interaction log (PII-masked, bounded). */
function blocksToText(blocks: AnswerBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "p") out.push(b.text);
    else if (b.type === "quote") out.push(`«${b.text}» [${b.cite}]`);
    else if (b.type === "list") for (const i of b.items) out.push(`- ${i.text}${i.meta ? ` (${i.meta})` : ""}`);
  }
  return maskPII(out.join("\n")).slice(0, 4000);
}

/** Retrieval over the published knowledge base; returns null when nothing is relevant enough. */
async function knowledgeAnswer(question: string): Promise<(ContextAnswer & { provider: "local" | "external"; model: string | null }) | null> {
  const index = await getIndex();
  const hits = index.search(question, { limit: 6 }).filter((h) => h.coverage >= MIN_COVERAGE);
  if (!hits.length) return null;
  const topScore = hits[0].score;
  const picked = hits.filter((h, i) => i === 0 || h.score >= topScore * 0.45).slice(0, 3);
  const citations: Citation[] = picked.map((h, i) => ({ n: i + 1, kind: h.doc.kind, title: h.doc.title, href: h.doc.href, label: h.doc.label, snippet: h.passage }));

  if (await externalEnabled()) {
    const ext = await externalAnswer(question, picked.map((h, i) => ({ n: i + 1, title: h.doc.title, text: h.passage })));
    if (ext) {
      return {
        provider: "external",
        model: ext.model,
        citations,
        blocks: [{ type: "p", text: ext.text }, ...picked.map((h, i): AnswerBlock => ({ type: "quote", text: h.passage, cite: i + 1 }))],
      };
    }
  }
  const blocks: AnswerBlock[] = [{ type: "p", text: picked.length > 1 ? "هذا ما تقوله المصادر المنشورة في المنصة عن سؤالك:" : "هذا ما يقوله المصدر المنشور في المنصة عن سؤالك:" }];
  for (const [i, h] of picked.entries()) blocks.push({ type: "quote", text: h.passage, cite: i + 1 });
  blocks.push({ type: "p", text: "اقرأ المصدر كاملًا قبل أي قرار، فالاقتباس جزء منه فقط." });
  return { provider: "local", model: null, citations, blocks };
}

const HELP_BLOCKS: AnswerBlock[] = [
  { type: "p", text: "أجيبك من بيانات وقفك ومن المكتبة المنشورة في المنصة، وأذكر المصدر مع كل إجابة. يمكنك أن تسألني مثلًا:" },
  {
    type: "list",
    items: [
      { text: "الالتزامات النظامية القادمة أو المتأخرة على وقفك" },
      { text: "ملخص آخر تقييم لوقفك وأهم توصياته" },
      { text: "الوثائق الناقصة أو المنتهية" },
      { text: "حالة طلبات الخدمات" },
      { text: "أسئلة عامة عن الأنظمة والحوكمة والنظارة، بإجابات مقتبسة من الأدلة المنشورة" },
    ],
  },
  { type: "p", text: "لا أصدر فتاوى ولا آراء قانونية ملزمة؛ أوجهك إلى مختص عند الحاجة." },
];

/**
 * Answers one question for one waqf. Auth + `ai.use` are checked inside the RLS transaction, the question is
 * screened by the refusal classifier, then routed by intent. Every call is logged (masked) and audited.
 */
export async function ask(auth: Auth, waqfId: string, rawQuestion: string, meta: { ip: string; userAgent: string }): Promise<AskResult> {
  const started = Date.now();
  const question = rawQuestion.replace(/\s+/g, " ").trim();
  if (question.length < 2) throw new UserError("اكتب سؤالك أولًا.");
  if (question.length > MAX_QUESTION) throw new UserError(`السؤال أطول من ${MAX_QUESTION} حرف. اختصره ثم أعد الإرسال.`);
  if (!(await rateLimit(`ai:min:${auth.user.id}`, 8, 60)) || !(await rateLimit(`ai:hour:${auth.user.id}`, 60, 3600))) {
    throw new RateLimitedError("أرسلت أسئلة كثيرة خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.");
  }

  return withContext(auth.db, async (tx) => {
    const access = await loadWaqfAccess(tx, auth, waqfId);
    if (!access) throw new ForbiddenError("لا يمكنك الوصول إلى هذا الوقف.");
    if (!access.perms.has("ai.use")) throw new ForbiddenError("ليست لديك صلاحية استخدام المساعد في هذا الوقف.");

    let intent: AskIntent;
    let blocks: AnswerBlock[];
    let citations: Citation[] = [];
    let provider: "local" | "external" = "local";
    let model: string | null = null;
    let refusal: AskResult["refusal"];

    const r = classifyRefusal(question);
    if (r) {
      intent = "refused";
      refusal = {
        category: r.category,
        title: r.title,
        message: r.message,
        serviceHref: r.serviceCode ? `/app/requests/new?service=${r.serviceCode}&waqf=${waqfId}` : null,
        serviceLabel: r.serviceLabel,
      };
      blocks = [];
      if (r.category !== "evasion" && r.category !== "injection") {
        const k = await knowledgeAnswer(question).catch(() => null);
        if (k?.citations.length) {
          citations = k.citations.slice(0, 2);
          blocks.push({ type: "p", text: "مواد عامة قد تفيدك قبل الاستشارة (ليست جوابًا عن حالتك):" });
          blocks.push({ type: "list", items: citations.map((c) => ({ text: c.title, href: c.href, meta: c.label, cite: c.n })) });
        }
      }
    } else {
      const it = classifyIntent(question);
      intent = it;
      if (it === "obligations") ({ blocks, citations } = await answerObligations(tx, access));
      else if (it === "assessment") ({ blocks, citations } = await answerAssessment(tx, access));
      else if (it === "documents_missing") ({ blocks, citations } = await answerMissingDocuments(tx, auth, access));
      else if (it === "requests") ({ blocks, citations } = await answerRequests(auth, access));
      else if (it === "greeting" || it === "help") blocks = HELP_BLOCKS;
      else {
        const k = await knowledgeAnswer(question);
        if (k) {
          ({ blocks, citations, provider, model } = k);
        } else {
          intent = "no_answer";
          blocks = [
            { type: "p", text: "لم أجد في المكتبة المنشورة مصدرًا يجيب عن سؤالك بدقة، ولا أجيب دون مصدر. جرّب صياغة أقصر بكلمات مفتاحية، أو تصفح المكتبة، أو اطلب رأي مختص." },
            { type: "actions", items: [{ label: "تصفح المكتبة", href: "/library" }, { label: "الأسئلة الشائعة", href: "/faq" }, { label: "اطلب استشارة", href: `/app/requests/new?service=C08&waqf=${waqfId}` }] },
          ];
        }
      }
    }

    const latencyMs = Date.now() - started;
    const [row] = await tx
      .insert(aiInteractions)
      .values({
        userId: auth.user.id,
        waqfId,
        kind: intent === "assessment" ? "explain_assessment" : "ask",
        input: maskPII(question).slice(0, MAX_QUESTION),
        sources: citations.map((c) => ({ title: c.title, snippet: (c.snippet ?? "").slice(0, 300), href: c.href, kind: c.kind, label: c.label })) as never,
        output: refusal ? `${refusal.title}: ${refusal.message}` : blocksToText(blocks),
        provider,
        model,
        refused: !!refusal,
        refusalReason: refusal?.category ?? null,
      })
      .returning({ id: aiInteractions.id });
    await audit(tx, {
      actorUserId: auth.user.id,
      action: "ai.ask",
      entityType: "ai_interaction",
      entityId: row.id,
      waqfId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      after: { intent, refused: !!refusal, refusalCategory: refusal?.category ?? null, provider, latencyMs, sources: citations.map((c) => c.label) },
    });
    return { id: row.id, intent, refused: !!refusal, refusal, blocks, citations, provider, latencyMs, disclosure: AI_DISCLOSURE };
  });
}

/** Stores helpful / not-helpful feedback on the caller's own interaction. */
export async function saveFeedback(auth: Auth, id: string, value: "helpful" | "not_helpful", meta: { ip: string; userAgent: string }) {
  return withContext(auth.db, async (tx) => {
    const [row] = await tx
      .update(aiInteractions)
      .set({ feedback: value })
      .where(and(eq(aiInteractions.id, id), eq(aiInteractions.userId, auth.user.id)))
      .returning({ id: aiInteractions.id, waqfId: aiInteractions.waqfId });
    if (!row) throw new UserError("لم نجد هذه الإجابة. حدّث الصفحة ثم أعد المحاولة.");
    await audit(tx, { actorUserId: auth.user.id, action: "ai.feedback", entityType: "ai_interaction", entityId: id, waqfId: row.waqfId, ip: meta.ip, userAgent: meta.userAgent, after: { feedback: value } });
    return true;
  });
}
