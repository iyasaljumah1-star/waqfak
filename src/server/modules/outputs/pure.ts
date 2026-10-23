/**
 * Output rules shared by the server and tests (PURE): approval policy, completeness, merging a regenerated draft with
 * human edits, and comparing versions.
 */
import type { OutputBlock, OutputGap, OutputSection, Provenance, ReviewPolicy } from "@/server/db/schema/operations";
import { DEFAULT_SEPARATION, makerChecker, type SeparationPolicy } from "@/server/authz/separation";

export const OUTPUT_STATUS_LABEL: Record<string, string> = { draft: "مسودة", in_review: "بانتظار المراجعة", returned: "أُعيدت للتعديل", approved: "معتمد" };
export const OUTPUT_STATUS_TONE: Record<string, "neutral" | "info" | "fine" | "ok"> = { draft: "neutral", in_review: "info", returned: "fine", approved: "ok" };
export const ORIGIN_LABEL: Record<string, string> = { generated: "مولّدة من بيانات النظام", regenerated: "أُعيد توليدها", edited: "عدّلها إنسان" };
export const PROV_LABEL: Record<Provenance, string> = {
  document: "من مستند", client: "من إجابة العميل", system: "من سجلات المنصة", computed: "محسوب", assumption: "افتراض", unverified: "يحتاج تحققًا", specialist: "كتبه المختص",
};

/** Empty specialist parts of the draft (their sections must be written before approval). */
export function emptySpecialist(sections: OutputSection[]): { section: string; prompt: string }[] {
  const out: { section: string; prompt: string }[] = [];
  for (const s of sections.filter((x) => !x.removed)) for (const b of s.blocks) {
    if (b.type === "specialist" && !b.text.trim()) out.push({ section: s.title, prompt: b.prompt });
    if (b.type === "clause" && !b.text.trim()) out.push({ section: `${s.title} — البند ${b.n}`, prompt: b.title });
  }
  return out;
}

/**
 * Closes the gaps a specialist settles by writing a clause: once the clause was edited by a person and no longer holds a
 * «[يُستكمل: …]» placeholder. Data gaps (the client's answers) stay open: they are corrected at their source.
 */
export function settleGaps(sections: OutputSection[], gaps: OutputGap[]): OutputGap[] {
  const written = new Set<string>();
  for (const s of sections) for (const b of s.blocks) if (b.type === "clause" && b.text !== b.generated && b.text.trim() && !b.text.includes("[يُستكمل")) written.add(b.key);
  return gaps.filter((g) => !(g.clause && g.owner === "specialist" && written.has(g.clause)));
}

/** Markers of text that is not final: «[يُستكمل: …]» (missing) and «[تعارض يُحسم: …]» (conflicting data). */
const OPEN_MARK = /\[(?:يُستكمل|يستكمل|تعارض يُحسم|تعارض يحسم)/;

/**
 * Printed text that still holds a «[يُستكمل…]» or «[تعارض يُحسم…]» marker — whoever wrote it (generator or person).
 * A marker typed by a reviewer raises no gap, so without this a document could be sent and approved with it.
 * Gaps already tied to the clause are not repeated.
 */
export function openMarkers(sections: OutputSection[], gaps: OutputGap[] = []): { section: string; prompt: string }[] {
  const out: { section: string; prompt: string }[] = [];
  const covered = new Set(gaps.filter((g) => g.clause).map((g) => g.clause!));
  for (const s of sections) {
    if (s.audience === "internal" || s.removed) continue;
    for (const b of s.blocks) {
      if (b.type === "clause" && OPEN_MARK.test(b.text) && !covered.has(b.key)) out.push({ section: `${s.title} — البند ${b.n} «${b.title}» (فيه نص بين معقوفين)`, prompt: "نص ناقص أو متعارض بين معقوفين" });
      else if (b.type === "para" && !b.internal && OPEN_MARK.test(b.text)) out.push({ section: `${s.title} (فيه نص بين معقوفين)`, prompt: "نص ناقص أو متعارض بين معقوفين" });
      else if (b.type === "specialist" && OPEN_MARK.test(b.text)) out.push({ section: s.title, prompt: b.prompt });
    }
  }
  return out;
}

/** What blocks submission for review or approval: blocking data gaps, unwritten specialist parts, and open markers. */
export function readiness(sections: OutputSection[], gaps: OutputGap[]) {
  const blocking = gaps.filter((g) => g.severity === "blocking");
  const unwritten = [...emptySpecialist(sections), ...openMarkers(sections, blocking)];
  return { ready: !blocking.length && !unwritten.length, blocking, unwritten, warnings: gaps.filter((g) => g.severity === "warning") };
}

/**
 * Approval policy. `preparers` = everyone who created a version (generated or edited) or submitted it.
 * independent → the approver prepared nothing, except a holder of direct approval (recorded as a self-approval) when no
 * written policy requires a second person. self_allowed → a preparer may approve only as an authorized manager
 * (admin.requests.all), and it is recorded as a self-approval.
 */
export function approvalCheck(p: {
  policy: ReviewPolicy; approverId: string; preparers: string[]; canReview: boolean; isManager: boolean;
  /** Holds approvals.direct; `separation`: the written separation policy (when it requires a second person). */
  direct?: boolean; separation?: SeparationPolicy;
}): { ok: true; self: boolean } | { ok: false; error: string } {
  if (!p.canReview && !p.isManager) return { ok: false, error: "اعتماد المخرجات لمن يملك صلاحية مراجعة الجودة." };
  const prepared = p.preparers.includes(p.approverId);
  if (!prepared) return { ok: true, self: false };
  if (p.policy === "independent") {
    const mk = makerChecker({ key: "output", isMaker: true, canDirect: !!p.direct, policy: p.separation ?? DEFAULT_SEPARATION, fallback: "هذا المخرج يتطلب اعتمادًا مستقلًا: يعتمده زميل لم يُعدّ أي نسخة منه." });
    return mk.ok ? { ok: true, self: true } : mk;
  }
  if (!p.isManager) return { ok: false, error: "اعتماد المعدّ لمخرجه متاح لمدير مخوّل فقط، ويُسجَّل اعتمادًا ذاتيًا." };
  return { ok: true, self: true };
}

const blockText = (b: OutputBlock): string => {
  switch (b.type) {
    case "para": return b.text;
    case "specialist": return b.text;
    case "clause": return `${b.n}. ${b.title}: ${b.text}`;
    case "signatures": return b.rows.map((r) => `${r.role}: ${r.name} — التوقيع: ________`).join("\n");
    case "facts": return b.rows.map((r) => `${r.label}: ${r.value}`).join("\n");
    case "table": return [b.head.join(" | "), ...b.rows.map((r) => r.join(" | ")), ...(b.total ? [b.total.join(" | ")] : [])].join("\n");
    case "list": return b.items.map((i) => `- ${i.text}`).join("\n");
    case "checks": return b.items.map((c) => `${c.label}: ${c.status} — ${c.reason}`).join("\n");
  }
};
export const sectionText = (s: OutputSection) => s.blocks.map(blockText).join("\n");

/**
 * Rebuilds a draft from fresh data while keeping what people wrote: specialist texts, edited fact values, manual
 * sections, and optional sections a reviewer removed. Edited facts whose fresh value differs are flagged.
 */
export function mergeRegenerated(prev: OutputSection[], fresh: OutputSection[], freshGaps: OutputGap[]): { sections: OutputSection[]; gaps: OutputGap[]; kept: number } {
  const prevByKey = new Map(prev.map((s) => [s.key, s]));
  const gaps = [...freshGaps];
  let kept = 0;
  const out: OutputSection[] = [];
  for (const f of fresh) {
    const p = prevByKey.get(f.key);
    if (!p) {
      out.push(f);
      continue;
    }
    if (p.removed && !f.required) {
      out.push({ ...f, removed: true });
      continue;
    }
    const specialistTexts = p.blocks.filter((b): b is Extract<OutputBlock, { type: "specialist" }> => b.type === "specialist").map((b) => b.text);
    let si = 0;
    const editedFacts = new Map<string, { value: string; orig?: string }>();
    for (const b of p.blocks) if (b.type === "facts") for (const r of b.rows) if (r.prov === "specialist") editedFacts.set(r.label, { value: r.value, orig: r.ref });
    const prevClauses = new Map(p.blocks.filter((b): b is Extract<OutputBlock, { type: "clause" }> => b.type === "clause").map((b) => [b.key, b]));
    const blocks: OutputBlock[] = f.blocks.map((b) => {
      if (b.type === "clause") {
        const pc = prevClauses.get(b.key);
        if (!pc || pc.text === pc.generated) return b; // untouched clause: the fresh wording follows the fresh data
        kept++;
        if (pc.generated !== b.generated)
          gaps.push({ key: `conflict:${f.key}:${b.key}`, label: `البند «${b.title}» عدّله إنسان، وتغيّرت بياناته بعد ذلك`, severity: "warning", hint: "قارن نصه بالصياغة الجديدة المولدة من البيانات الحالية قبل الاعتماد.", owner: "specialist" });
        return { ...b, text: pc.text };
      }
      if (b.type === "specialist") {
        const t = specialistTexts[si++] ?? "";
        if (t) kept++;
        return { ...b, text: t };
      }
      if (b.type === "facts") {
        return {
          ...b,
          rows: b.rows.map((r) => {
            const e = editedFacts.get(r.label);
            if (!e) return r;
            kept++;
            if (e.orig !== undefined && e.orig !== r.value)
              gaps.push({ key: `conflict:${f.key}:${r.label}`, label: `«${r.label}» عدّله المراجع إلى «${e.value}»، والبيانات الحالية «${r.value}»`, severity: "warning", hint: "راجع القيمة قبل الاعتماد." });
            return { ...r, value: e.value, prov: "specialist" as Provenance, ref: r.value };
          }),
        };
      }
      return b;
    });
    // extra paragraphs a person added inside a generated section
    const added = p.blocks.filter((b) => b.type === "para" && b.prov === "specialist");
    kept += added.length;
    out.push({ ...f, blocks: [...blocks, ...added] });
  }
  for (const p of prev) if (p.manual) {
    kept++;
    const at = Math.max(0, out.findIndex((s) => s.key === "references"));
    out.splice(at >= 0 ? at : out.length, 0, p);
  }
  return { sections: out, gaps: settleGaps(out, gaps), kept };
}

export type SectionDiff = { key: string; title: string; change: "added" | "removed" | "changed" | "same"; before?: string; after?: string };

export function diffVersions(a0: OutputSection[], b0: OutputSection[]): SectionDiff[] {
  const a = a0.filter((s) => !s.removed), b = b0.filter((s) => !s.removed);
  const am = new Map(a.map((s) => [s.key, s]));
  const bm = new Map(b.map((s) => [s.key, s]));
  const keys = [...new Set([...a.map((s) => s.key), ...b.map((s) => s.key)])];
  return keys.map((k) => {
    const x = am.get(k), y = bm.get(k);
    if (!x && y) return { key: k, title: y.title, change: "added", after: sectionText(y) };
    if (x && !y) return { key: k, title: x.title, change: "removed", before: sectionText(x) };
    const before = sectionText(x!), after = sectionText(y!);
    return { key: k, title: y!.title, change: before === after ? "same" : "changed", before, after };
  });
}

/**
 * Applies a reviewer's edit form to a version's sections. `fields` maps:
 *  spec:<section>:<i> → specialist text i of a section; fact:<section>:<b>:<r> → value of a fact row;
 *  note:<section> → an added paragraph; drop:<section> → remove an optional section;
 *  new_title / new_body → a new manual section.
 */
export function applyEdits(sections: OutputSection[], fields: Record<string, string>): { sections: OutputSection[]; changed: boolean } {
  let changed = false;
  const out: OutputSection[] = [];
  for (const s of sections) {
    if (!s.required && !s.removed && fields[`drop:${s.key}`] === "on") {
      changed = true;
      out.push({ ...s, removed: true });
      continue;
    }
    let si = 0;
    const blocks: OutputBlock[] = s.blocks.map((b, bi) => {
      if (b.type === "clause") {
        const k = `clause:${s.key}:${b.key}`;
        if (k in fields) {
          const t = fields[k].trim().slice(0, 20_000);
          if (t && t !== b.text) {
            changed = true;
            return { ...b, text: t, prov: "specialist" as Provenance };
          }
        }
        return b;
      }
      if (b.type === "specialist") {
        const k = `spec:${s.key}:${si++}`;
        if (k in fields) {
          const t = fields[k].trim().slice(0, 20_000);
          if (t !== b.text) {
            changed = true;
            return { ...b, text: t };
          }
        }
        return b;
      }
      if (b.type === "facts") {
        return {
          ...b,
          rows: b.rows.map((r, ri) => {
            const k = `fact:${s.key}:${bi}:${ri}`;
            if (!(k in fields)) return r;
            const v = fields[k].trim().slice(0, 2000);
            if (v === r.value || !v) return r;
            changed = true;
            return { ...r, value: v, prov: "specialist" as Provenance, ref: r.prov === "specialist" ? r.ref : r.value };
          }),
        };
      }
      return b;
    });
    const note = fields[`note:${s.key}`]?.trim();
    if (note) {
      changed = true;
      blocks.push({ type: "para", text: note.slice(0, 20_000), prov: "specialist" });
    }
    out.push({ ...s, blocks });
  }
  const title = fields.new_title?.trim(), body = fields.new_body?.trim();
  if (title && body) {
    changed = true;
    const at = out.findIndex((s) => s.key === "references");
    const sec: OutputSection = { key: `manual:${Date.now().toString(36)}`, title: title.slice(0, 200), required: false, manual: true, blocks: [{ type: "para", text: body.slice(0, 20_000), prov: "specialist" }] };
    out.splice(at >= 0 ? at : out.length, 0, sec);
  }
  return { sections: out, changed };
}

/** Request statuses in which a draft may be saved (from receipt until hand-over; saving changes no status). */
export const DRAFT_STATUSES = ["submitted", "triage", "awaiting_client", "in_progress", "quality_review"];

/**
 * What a regeneration changed, for the person who ran it: clauses (and other blocks) whose text changed, those
 * unchanged, edits kept, and conflicts that appeared or were resolved since the previous version.
 */
export function regenSummary(prev: OutputSection[], next: OutputSection[], prevGaps: OutputGap[], nextGaps: OutputGap[]) {
  const text = (ss: OutputSection[]) => {
    const m = new Map<string, string>();
    for (const s of ss) s.blocks.forEach((b, i) => { if (b.type !== "checks") m.set(b.type === "clause" ? `${s.key}:${b.key}` : `${s.key}#${i}`, blockText(b)); });
    return m;
  };
  const a = text(prev);
  const b = text(next);
  let changed = 0, unchanged = 0, added = 0, removed = 0;
  for (const [k, v] of b) { if (!a.has(k)) added++; else if (a.get(k) === v) unchanged++; else changed++; }
  for (const k of a.keys()) if (!b.has(k)) removed++;
  const isConflict = (g: OutputGap) => g.kind === "conflict" || g.key.startsWith("conflict:");
  const pk = new Set(prevGaps.filter(isConflict).map((g) => g.key));
  const nk = new Set(nextGaps.filter(isConflict).map((g) => g.key));
  return {
    changed, unchanged, added, removed,
    newConflicts: nextGaps.filter((g) => isConflict(g) && !pk.has(g.key)).map((g) => g.label),
    resolvedConflicts: prevGaps.filter((g) => isConflict(g) && !nk.has(g.key)).map((g) => g.label),
  };
}

export function regenNote(s: ReturnType<typeof regenSummary>, kept: number) {
  return [
    `تغيّر ${s.changed}، وبقي ${s.unchanged} دون تغيير${s.added ? `، وأُضيف ${s.added}` : ""}${s.removed ? `، وحُذف ${s.removed}` : ""}`,
    kept ? `أُبقي على ${kept} من التعديلات البشرية` : "",
    s.newConflicts.length ? `تعارضات جديدة: ${s.newConflicts.join("؛ ")}` : "",
    s.resolvedConflicts.length ? `تعارضات زالت: ${s.resolvedConflicts.join("؛ ")}` : "",
  ].filter(Boolean).join(". ");
}

export type DiffSeg = { t: "same" | "add" | "del"; s: string };

/**
 * Word-level difference between two texts (LCS on words and line breaks), for highlighting what changed between two
 * versions. Long texts fall back to a whole-text replacement rather than an expensive comparison.
 */
export function wordDiff(a: string, b: string): DiffSeg[] {
  if (a === b) return [{ t: "same", s: a }];
  const tok = (x: string) => x.split(/(\s+)/).filter((w) => w !== "");
  const A = tok(a), B = tok(b);
  if (A.length * B.length > 4_000_000) return [{ t: "del", s: a }, { t: "add", s: b }];
  const n = A.length, m = B.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffSeg[] = [];
  const push = (t: DiffSeg["t"], s: string) => { const last = out[out.length - 1]; if (last && last.t === t) last.s += s; else out.push({ t, s }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push("del", A[i++]);
    else push("add", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}
