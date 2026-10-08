"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUpLeft, BookOpen, Info, LoaderCircle, SendHorizontal, ShieldAlert, ThumbsDown, ThumbsUp, UserRound } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AnswerBlock, AskResult, Citation, ListItem } from "@/server/modules/ai/types";

type Msg = { key: string; role: "user"; text: string } | { key: string; role: "assistant"; result: AskResult } | { key: string; role: "error"; text: string };

const TONE_DOT: Record<NonNullable<ListItem["tone"]>, string> = {
  critical: "bg-critical", fine: "bg-fine", warn: "bg-warn", ok: "bg-ok", info: "bg-info", neutral: "bg-line-strong",
};

const MAX = 500;

export function AssistantChat({ waqfId, suggestions, engineNote }: { waqfId: string; suggestions: readonly string[]; engineNote: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (msgs.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  async function send(q: string) {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setBusy(true);
    setText("");
    const k = String(++seq.current);
    setMsgs((m) => [...m, { key: `u${k}`, role: "user", text: question }]);
    try {
      const res = await fetch("/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waqfId, question }) });
      const data = await res.json().catch(() => ({ error: "تعذر قراءة الرد. أعد المحاولة." }));
      if (!res.ok || "error" in data) setMsgs((m) => [...m, { key: `e${k}`, role: "error", text: data.error ?? "تعذر الحصول على إجابة. أعد المحاولة." }]);
      else setMsgs((m) => [...m, { key: `a${k}`, role: "assistant", result: data as AskResult }]);
    } catch {
      setMsgs((m) => [...m, { key: `e${k}`, role: "error", text: "انقطع الاتصال. تحقق من الشبكة ثم أعد المحاولة." }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  };

  return (
    <section aria-label="محادثة المساعد" className="rounded-lg border border-line bg-surface">
      <div className="flex items-start gap-2 border-b border-line px-4 py-3 text-[13px] leading-6 text-muted md:px-5">
        <Info aria-hidden className="mt-1 size-4 shrink-0" />
        <p>{engineNote}</p>
      </div>

      <div role="log" aria-live="polite" aria-relevant="additions" className="space-y-5 px-4 py-5 md:px-5">
        {msgs.length === 0 ? (
          <div>
            <p className="text-[15px] text-text">ابدأ بسؤال عن وقفك أو عن الأنظمة. أجيب من بيانات وقفك ومن المكتبة المنشورة، وأذكر المصدر دائمًا.</p>
            <p className="mt-4 mb-2 text-sm font-medium text-muted">أسئلة مقترحة</p>
            <ul className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => void send(s)} disabled={busy} className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-start text-sm text-ink hover:bg-ink-soft disabled:opacity-50">
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.key} className="flex justify-start">
              <div className="flex max-w-[92%] items-start gap-2 rounded-lg bg-ink-soft px-3.5 py-2.5 text-[15px] leading-7 text-text md:max-w-[80%]">
                <UserRound aria-hidden className="mt-1 size-4 shrink-0 text-ink" />
                <p className="min-w-0 break-words" data-testid="user-question">{m.text}</p>
              </div>
            </div>
          ) : m.role === "error" ? (
            <p key={m.key} role="alert" className="rounded-lg bg-critical-soft px-3.5 py-2.5 text-[15px] text-critical">{m.text}</p>
          ) : (
            <Answer key={m.key} r={m.result} />
          ),
        )}
        {busy ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <LoaderCircle aria-hidden className="size-4 animate-spin" /> أبحث في المصادر…
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 rounded-b-lg border-t border-line bg-surface px-3 py-3 md:px-5 lg:bottom-0">
        <label htmlFor="ai-question" className="sr-only">سؤالك</label>
        <div className="flex items-end gap-2">
          <textarea
            id="ai-question"
            ref={inputRef}
            value={text}
            maxLength={MAX}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder="اكتب سؤالك… مثل: ما الالتزامات القادمة على وقفي؟"
            className="min-h-[3rem] w-full min-w-0 resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] leading-7 text-text placeholder:text-muted focus:border-ink focus:outline-none"
          />
          <Button type="submit" disabled={busy || text.trim().length < 2} aria-label="أرسل السؤال" className="shrink-0 px-3">
            <SendHorizontal aria-hidden className="size-5 -scale-x-100" />
            <span className="hidden sm:inline">أرسل</span>
          </Button>
        </div>
        <p className="mt-1 text-[12px] text-muted">
          لا تكتب أرقام هوية أو حسابات بنكية؛ نخفيها تلقائيًا من السجل. <span className="tabular">{text.length}/{MAX}</span>
        </p>
      </form>
    </section>
  );
}

function CiteChip({ c }: { c: Citation | undefined }) {
  if (!c) return null;
  return (
    <Link href={c.href} title={c.title} className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-seal-soft px-1 align-text-top text-[11px] font-semibold text-seal tabular hover:underline">
      {c.n}
    </Link>
  );
}

/** Renders text that may contain [n] markers (external provider output) with citation chips. */
function withCites(text: string, cites: Citation[]): ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((p, i) => {
    const m = /^\[(\d+)\]$/.exec(p);
    return m ? <CiteChip key={i} c={cites.find((c) => c.n === Number(m[1]))} /> : <span key={i}>{p}</span>;
  });
}

function Blocks({ blocks, cites }: { blocks: AnswerBlock[]; cites: Citation[] }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === "p") return <p key={i} className="text-[15px] leading-7 text-text">{withCites(b.text, cites)}</p>;
        if (b.type === "quote")
          return (
            <blockquote key={i} className="border-s-2 border-seal ps-3">
              <p className="font-naskh text-[16px] leading-8 text-text">«{b.text}»</p>
              <CiteSource c={cites.find((c) => c.n === b.cite)} />
            </blockquote>
          );
        if (b.type === "list")
          return (
            <ul key={i} className="divide-y divide-line rounded-md border border-line">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2.5 px-3 py-2.5">
                  <span aria-hidden className={cn("mt-2.5 size-2 shrink-0 rounded-full", TONE_DOT[it.tone ?? "neutral"])} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-7 text-text">
                      {it.href ? <Link href={it.href} className="font-medium text-ink hover:underline">{it.text}</Link> : it.text}
                      {it.cite ? <CiteChip c={cites.find((c) => c.n === it.cite)} /> : null}
                    </p>
                    {it.meta ? <p className="text-[13px] leading-6 text-muted">{it.meta}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          );
        return (
          <div key={i} className="flex flex-wrap gap-2">
            {b.items.map((a) => (
              <Link key={a.href} href={a.href} className={buttonClass("secondary", "sm")}>
                {a.label}
                <ArrowUpLeft aria-hidden className="size-4" />
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CiteSource({ c }: { c: Citation | undefined }) {
  if (!c) return null;
  return (
    <p className="mt-1 text-[13px] text-muted">
      <CiteChip c={c} /> {c.label} — <Link href={c.href} className="text-ink hover:underline">{c.title}</Link>
    </p>
  );
}

function Answer({ r }: { r: AskResult }) {
  const [open, setOpen] = useState(false);
  const [fb, setFb] = useState<null | "helpful" | "not_helpful" | "error">(null);
  const srcId = `src-${useId().replace(/:/g, "")}`;

  async function feedback(value: "helpful" | "not_helpful") {
    if (!r.id) return;
    setFb(value);
    const res = await fetch("/api/ai/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, value }) }).catch(() => null);
    if (!res?.ok) setFb("error");
  }

  return (
    <article className="space-y-3" data-testid="ai-answer" data-intent={r.intent} data-refused={r.refused ? "true" : "false"}>
      {r.refused && r.refusal ? (
        <div className="rounded-lg border border-seal/40 bg-seal-soft p-4" data-testid="ai-refusal">
          <p className="flex items-center gap-2 font-semibold text-seal">
            <ShieldAlert aria-hidden className="size-5 shrink-0" />
            {r.refusal.title}
          </p>
          <p className="mt-1.5 text-[15px] leading-7 text-text">{r.refusal.message}</p>
          {r.refusal.serviceHref ? (
            <Link href={r.refusal.serviceHref} className={buttonClass("seal", "sm", "mt-3")}>
              {r.refusal.serviceLabel}
              <ArrowUpLeft aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      ) : null}
      {r.blocks.length ? <Blocks blocks={r.blocks} cites={r.citations} /> : null}

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2.5 text-[13px] text-muted">
        <p className="flex items-center gap-1.5" data-testid="ai-disclosure">
          <Info aria-hidden className="size-3.5 shrink-0" />
          {r.disclosure}
        </p>
        <button type="button" aria-expanded={open} aria-controls={srcId} onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 font-medium text-ink hover:underline">
          <BookOpen aria-hidden className="size-3.5" />
          {open ? "إخفاء المصادر" : "عرض المصادر"}
          {r.citations.length ? <span className="tabular">({r.citations.length})</span> : null}
        </button>
        <div className="ms-auto flex items-center gap-1">
          {fb === "helpful" || fb === "not_helpful" ? (
            <span role="status">شكرًا، سجلنا تقييمك.</span>
          ) : fb === "error" ? (
            <span role="alert" className="text-critical">لم نحفظ التقييم. أعد المحاولة.</span>
          ) : r.id ? (
            <>
              <span className="me-1">هل أفادتك؟</span>
              <button type="button" onClick={() => void feedback("helpful")} aria-label="الإجابة مفيدة" className="rounded p-1.5 hover:bg-ok-soft hover:text-ok"><ThumbsUp aria-hidden className="size-4" /></button>
              <button type="button" onClick={() => void feedback("not_helpful")} aria-label="الإجابة غير مفيدة" className="rounded p-1.5 hover:bg-critical-soft hover:text-critical"><ThumbsDown aria-hidden className="size-4" /></button>
            </>
          ) : null}
        </div>
      </footer>
      {open ? (
        <div id={srcId} className="rounded-md bg-surface-2 p-3" data-testid="ai-sources">
          {r.citations.length ? (
            <ol className="space-y-2">
              {r.citations.map((c) => (
                <li key={c.n} className="flex gap-2 text-[14px] leading-6">
                  <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-seal-soft px-1 text-[11px] font-semibold text-seal tabular">{c.n}</span>
                  <div className="min-w-0">
                    <Link href={c.href} className="font-medium text-ink hover:underline">{c.title}</Link>
                    <span className="ms-1.5 text-muted">· {c.label}</span>
                    {c.snippet ? <p className="text-[13px] text-muted">{c.snippet}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[14px] text-muted">لا مصادر لهذه الإجابة؛ لم يُقتبس فيها نص من المكتبة.</p>
          )}
        </div>
      ) : null}
    </article>
  );
}
