import "server-only";
import { and, eq, inArray, max, notInArray } from "drizzle-orm";
import { withContext, withSystem, type Tx } from "@/server/db";
import {
  documentVersions, documents, featureFlags, outputs, permissions, processingRuns, processingSteps, requestItems, requestStages,
  rolePermissions, serviceRequests, userRoles, users, waqfs,
} from "@/server/db/schema";
import type { OutputSection } from "@/server/db/schema";
import type { Auth } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { notify } from "@/server/modules/notify";
import { loadRequestCtx, type RequestCtx } from "@/server/modules/requests/access";
import { logEvent } from "@/server/modules/requests/engine";
import { checkIntake, findField } from "@/server/modules/requests/intake/engine";
import { intakeOf, serviceForm, validDocMap } from "@/server/modules/requests/intake/server";
import { PROFILE_REFS, TEMPLATES, outputsFor } from "@/server/modules/outputs/catalog";
import { draftInputs } from "@/server/modules/outputs/live";
import { addVersion, ensureOutput, versionOf } from "@/server/modules/outputs/server";
import { syncConflicts, transitionGate } from "@/server/modules/outputs/quality";
import { mergeRegenerated } from "@/server/modules/outputs/pure";
import { specialistBinding } from "@/server/modules/outputs/binding";
import { readVersionPlain } from "@/server/modules/documents/core";
import { extractText } from "@/server/modules/ai/extract";
import { engineAuth } from "../actor";
import { ENGINE_VERSION } from "../constants";
import { retrieve, availableRefCodes } from "@/server/knowledge/retrieve";
import { matterOf, sectionQuestion } from "@/server/knowledge/question";
import { research, saveDossier } from "@/server/knowledge/fiqh/research";
import { maskPII } from "@/server/modules/ai/safety";
import { DRAFT_FLAG_AR, KIND_AR } from "@/server/knowledge/policy";

/** Outputs whose sections state what the rules require: a guide, a study or a book cannot be their only basis. */
const BINDING_PROFILES: ReadonlySet<string> = new Set(["legal_review", "legal_package", "nazara_study", "aml_program", "ops_package", "investment_policy", "deed_draft"]);
import { dataClassOf, maskFacts, modelAllowed } from "../llm/guard";
import { llmProvider } from "../llm/provider";
import { PROMPT_VERSION, type LlmSource } from "../llm/types";
import { applyPacks, fillTemplate, packsFor, writerFor } from "../rules/evaluate";
import { rulePacks } from "../rules/packs";
import type { DecisionResult, Finding } from "../rules/types";
import { checkSection } from "../verify/pure";
import type { ClaimedJob } from "../queue/queue";

/**
 * One processing run of a request (owner's order of 2026-11-01): intake check → documents → rules (and what the
 * client must complete) → workflow → knowledge → analysis → document → verification → hand-off to the system
 * administrator. Every step is recorded with a short rationale; no step fails silently: a run ends «ready» (in the
 * administrator's queue), «needs_client» (the client was asked for something), «waiting» (a condition outside the
 * engine, such as payment), «blocked» (what stops it is listed for the administrator) or «failed» (an error, retried).
 * Nothing here releases anything to the client.
 */

export type RunOutcome = { status: "ready" | "needs_client" | "waiting" | "blocked" | "skipped"; summary: string; blockers?: string[]; warnings?: string[] };

const WORKABLE = ["submitted", "triage", "awaiting_client", "in_progress"];

export async function processRequest(job: ClaimedJob): Promise<RunOutcome> {
  const eauth = await withSystem((tx) => engineAuth(tx));
  const ctx = (fn: (tx: Tx) => Promise<unknown>) => withContext(eauth.db, fn);

  // the run row first (its own transaction), so that even a failure leaves a trace
  const run = (await ctx(async (tx) => {
    const [r] = await tx.insert(processingRuns).values({ jobId: job.id, requestId: job.requestId, waqfId: job.waqfId, attempt: job.attempts, engineVersion: ENGINE_VERSION, instruction: job.instruction }).returning({ id: processingRuns.id });
    return r;
  })) as { id: string };
  let seq = 0;
  const step = async <T>(name: string, fn: (tx: Tx) => Promise<{ status: "ok" | "warn" | "skipped" | "blocked"; summary: Record<string, unknown>; value?: T }>): Promise<{ status: string; value?: T }> => {
    const n = ++seq;
    const startedAt = new Date();
    try {
      const out = (await ctx((tx) => fn(tx))) as { status: "ok" | "warn" | "skipped" | "blocked"; summary: Record<string, unknown>; value?: T };
      await ctx((tx) => tx.insert(processingSteps).values({ runId: run.id, requestId: job.requestId, waqfId: job.waqfId, seq: n, step: name, status: out.status, summary: out.summary, startedAt, finishedAt: new Date() }));
      return out;
    } catch (e) {
      await ctx((tx) => tx.insert(processingSteps).values({ runId: run.id, requestId: job.requestId, waqfId: job.waqfId, seq: n, step: name, status: "failed", summary: {}, error: e instanceof Error ? e.message.slice(0, 400) : "error", startedAt, finishedAt: new Date() }));
      throw e;
    }
  };
  const finish = async (o: RunOutcome, extra: Partial<typeof processingRuns.$inferInsert> = {}) => {
    await ctx((tx) => tx.update(processingRuns).set({ status: o.status === "skipped" ? "ready" : o.status, outcome: o as unknown as Record<string, unknown>, finishedAt: new Date(), ...extra }).where(eq(processingRuns.id, run.id)));
    return o;
  };

  try {
    // ── 1. the request and whether it is the engine's to process
    const pre = await step<{ skip?: string }>("intake", async (tx) => {
      const rc = await loadRequestCtx(tx, eauth, job.requestId, "staff");
      if (rc.req.processingMode !== "engine") return { status: "skipped", summary: { reason: "الطلب على مسار الفريق" }, value: { skip: "manual" } };
      if (!WORKABLE.includes(rc.req.status) && !(job.instruction && rc.req.status === "quality_review")) return { status: "skipped", summary: { reason: `حالة الطلب ${rc.req.status}` }, value: { skip: rc.req.status } };
      const form = serviceForm(rc.service);
      const intake = intakeOf(rc.req);
      const docs = await validDocMap(tx, rc.req.id, rc.req.waqfId, intake.docs ?? {});
      const check = checkIntake(form, intake.answers ?? {}, docs);
      return { status: check.fieldsComplete && check.docsComplete ? "ok" : "warn", summary: { service: rc.service.code, fieldsComplete: check.fieldsComplete, docsComplete: check.docsComplete, missingFields: Object.keys(check.errors).length, missingDocs: check.missingDocs.length } };
    });
    if (pre.value?.skip) return await finish({ status: "skipped", summary: pre.value.skip === "manual" ? "الطلب ليس على مسار المعالجة الآلية." : "لا معالجة في حالة الطلب الحالية." });

    // ── 2. documents: text extracted where possible (never logged), readable or not
    const docInfo = await step<{ total: number; unreadable: number; texts: { slot: string; label: string; chars: number }[] }>("documents", async (tx) => {
      const rc = await loadRequestCtx(tx, eauth, job.requestId, "staff");
      const intake = intakeOf(rc.req);
      const map = await validDocMap(tx, rc.req.id, rc.req.waqfId, intake.docs ?? {});
      const ids = Object.values(map).flat();
      const out: { slot: string; label: string; chars: number }[] = [];
      for (const [slot, list] of Object.entries(map)) {
        for (const id of list) {
          const [d] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1);
          if (!d) continue;
          const [v] = await tx.select().from(documentVersions).where(and(eq(documentVersions.documentId, d.id), eq(documentVersions.version, d.currentVersion))).limit(1);
          let chars = 0;
          if (v) {
            try { chars = extractText(await readVersionPlain(tx, d, v), v.mimeType).trim().length; } catch { chars = 0; }
          }
          out.push({ slot, label: d.title, chars });
        }
      }
      const unreadable = out.filter((x) => x.chars < 200).length;
      return { status: unreadable ? "warn" : "ok", summary: { attached: ids.length, readable: out.length - unreadable, unreadable, slots: out.map((x) => ({ slot: x.slot, readable: x.chars >= 200 })) }, value: { total: out.length, unreadable, texts: out } };
    });

    // ── 3. accept answered client items, then the facts and the rules
    const ruled = await step<{ findings: Finding[]; decisions: DecisionResult[]; applied: { id: string; version: string }[]; facts: Record<string, unknown>; gaps: { key: string; label: string; field?: string }[]; missing: MissingInput[]; dataClass: string; refs: string[]; missingRefs: string[] }>("rules", async (tx) => {
      const rc = await loadRequestCtx(tx, eauth, job.requestId, "staff");
      await tx.update(requestItems).set({ status: "accepted", resolvedBy: eauth.user.id, resolvedAt: new Date(), updatedBy: eauth.user.id })
        .where(and(eq(requestItems.requestId, rc.req.id), eq(requestItems.status, "answered"), eq(requestItems.createdBy, eauth.user.id)));
      const form = serviceForm(rc.service);
      const intake = intakeOf(rc.req);
      const docs = await validDocMap(tx, rc.req.id, rc.req.waqfId, intake.docs ?? {});
      const check = checkIntake(form, intake.answers ?? {}, docs);
      const [w] = rc.req.waqfId ? await tx.select({ status: waqfs.status, sizeClass: waqfs.sizeClass, isDemo: waqfs.isDemo }).from(waqfs).where(eq(waqfs.id, rc.req.waqfId)).limit(1) : [];
      // the output's own data needs (gaps the client owns), from the same draft the document will be built from
      const defs = outputsFor(rc.service).filter((d) => !d.key.includes("@c"));
      const clientGaps: { key: string; label: string; field?: string }[] = [];
      let material = 0;
      const refs = new Set<string>();
      for (const def of defs) {
        const inp = await draftInputs(tx, rc, def.key);
        if (!inp) continue;
        for (const g of inp.draft.gaps) if (g.severity === "blocking" && g.owner === "client" && !clientGaps.some((x) => x.key === g.key)) clientGaps.push({ key: g.key, label: g.label, field: g.field });
        material += (inp.ctx.conflicts ?? []).filter((c) => c.severity === "material").length;
        for (const r of PROFILE_REFS[def.profile] ?? []) refs.add(r);
      }
      const packs = packsFor(rulePacks(), rc.service.code);
      const essential = [...new Set(packs.flatMap((p) => p.essentialRefs ?? []))];
      // an essential reference must be present with a usable text for the draft (owner's order 2026-11-07, §5: its use is
      // reviewed passage by passage at the final approval, not before the draft — B13)
      const ready = await availableRefCodes(tx, essential, new Date().toISOString().slice(0, 10));
      const missingRefs = essential.filter((c) => !ready.has(c));
      const facts = {
        service: { code: rc.service.code, pricing: rc.service.pricingModel },
        request: { number: rc.req.number, hasWaqf: !!rc.req.waqfId, conflict: rc.req.conflictCheck },
        waqf: w ? { status: w.status, sizeClass: w.sizeClass, isDemo: w.isDemo } : null,
        intake: { missingFields: Object.keys(check.errors).length, missingDocs: check.missingDocs.length },
        docs: { count: docInfo.value?.total ?? 0, unreadable: docInfo.value?.unreadable ?? 0 },
        conflicts: { material },
        gaps: { clientBlocking: clientGaps.length },
        kb: { missingEssentialCount: missingRefs.length, missingEssential: missingRefs },
      };
      const res = applyPacks(packs, facts);
      // what exactly is missing from the submission, so that the client is asked for each field and document by name
      const missing: MissingInput[] = [
        ...Object.entries(check.errors).map(([key, why]) => ({ kind: "field" as const, key, label: findField(form, key)?.field.label ?? key, why })),
        ...check.missingDocs.map((d) => ({ kind: "doc" as const, key: d.key, label: d.label, docType: d.docType, why: "مستند مطلوب لم يُرفق." })),
      ];
      const dataClass = dataClassOf({ waqfIsDemo: w?.isDemo, hasWaqf: !!w });
      const blocked = res.findings.some((f) => f.effect === "block");
      const client = res.findings.some((f) => f.effect === "client");
      return {
        status: blocked ? "blocked" : client ? "warn" : res.findings.length ? "warn" : "ok",
        summary: { packs: res.applied, findings: res.findings.map((f) => ({ rule: `${f.pack}/${f.ruleId}`, effect: f.effect, message: f.message })), decisions: res.decisions, errors: res.errors, dataClass, clientGaps: clientGaps.map((g) => g.label) },
        value: { ...res, facts, gaps: clientGaps, missing, dataClass, refs: [...refs], missingRefs },
      };
    });
    const R = ruled.value!;
    await ctx((tx) => tx.update(processingRuns).set({ rules: R.applied }).where(eq(processingRuns.id, run.id)));

    const blockers = R.findings.filter((f) => f.effect === "block");
    if (blockers.length) return await finish(await blockedHandoff(eauth, job, blockers.map((b) => b.message), []), {});

    // ── 4. what the client must complete: items on the request, the request waits for the client, processing resumes on reply
    const asks = R.findings.filter((f) => f.effect === "client");
    if (asks.length) {
      const asked = await step<{ unresolved: string[] }>("gaps", async (tx) => {
        const rc = await loadRequestCtx(tx, eauth, job.requestId, "staff");
        const r = await askClient(tx, eauth, rc, asks, R.gaps, R.missing);
        return { status: "blocked", summary: { asked: r.asked, items: r.titles, unresolved: r.unresolved, gaps: R.gaps.map((g) => g.label) }, value: { unresolved: r.unresolved } };
      });
      // the client already answered these and they are still missing: asking again would loop — the administrator decides
      const unresolved = asked.value?.unresolved ?? [];
      if (unresolved.length) return await finish(await blockedHandoff(eauth, job, unresolved.map((t) => `أجاب العميل عن «${t}» وما زال ناقصًا: يلزم قرار مدير النظام أو تواصل مع العميل.`), []), {});
      return await finish({ status: "needs_client", summary: "طُلب من العميل استكمال ما يلزم؛ تُستأنف المعالجة عند رده." });
    }

    // ── 5. workflow: the platform verifies and accepts; payment conditions are respected, never assumed
    const wf = await step<{ waiting?: string }>("workflow", async (tx) => {
      const rc = await loadRequestCtx(tx, eauth, job.requestId, "staff");
      const now = new Date();
      if (rc.service.pricingModel !== "free" && !rc.req.startApprovedAt) {
        // fixed price: collected before processing; special pricing: after the quote is accepted and its conditions met.
        // Real collection is off (owner's decision); the request waits — nothing is processed for free by mistake.
        return { status: "blocked", summary: { waiting: "commercial", pricing: rc.service.pricingModel }, value: { waiting: "بانتظار استيفاء شروط السداد (الدفع الحي غير مفعّل)" } };
      }
      const from = rc.req.status;
      await tx.update(serviceRequests).set({
        status: "in_progress", intakeVerifiedAt: rc.req.intakeVerifiedAt ?? now, intakeVerifiedBy: rc.req.intakeVerifiedBy ?? eauth.user.id,
        acceptedAt: rc.req.acceptedAt ?? now, acceptedBy: rc.req.acceptedBy ?? eauth.user.id, startApprovedAt: rc.req.startApprovedAt ?? now, startApprovedBy: rc.req.startApprovedBy ?? eauth.user.id,
        updatedBy: eauth.user.id,
      }).where(eq(serviceRequests.id, rc.req.id));
      if (from !== "in_progress") await logEvent(tx, rc.req, eauth.user.id, "تحققت المنصة من البيانات والمستندات وبدأت معالجة الطلب", from, "in_progress", { internal: true });
      return { status: "ok", summary: { from, to: "in_progress" } };
    });
    if (wf.value?.waiting) return await finish({ status: "waiting", summary: wf.value.waiting });

    // ── 6–8. knowledge, analysis and the document, for each output of the service
    const provider = llmProvider();
    const realFlag = await ctx(async (tx) => {
      const [f] = await tx.select({ on: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, "engine.llm_real_data")).limit(1);
      return !!f?.on;
    }) as boolean;
    const allowed = modelAllowed({ dataClass: R.dataClass as "synthetic" | "real", realDataFlag: realFlag, providerId: provider.configured() ? provider.id : "disabled" });
    const used: { code: string; version: string }[] = [];
    let modelCalls = 0;
    const problems: string[] = [];
    const warnings: string[] = [...R.findings.filter((f) => f.effect === "warn").map((f) => f.message)];
    let outputRef: { id: string; version: number } | null = null;

    const docStep = await step<{ outputs: { id: string; version: number }[] }>("document", async (tx) => {
      const rc = await loadRequestCtx(tx, eauth, job.requestId, "staff");
      const packs = packsFor(rulePacks(), rc.service.code);
      const made: { id: string; version: number }[] = [];
      const sectionLog: Record<string, unknown>[] = [];
      for (const def of outputsFor(rc.service).filter((d) => !d.key.includes("@c"))) {
        const inp = await draftInputs(tx, rc, def.key);
        if (!inp) continue;
        let o = await ensureOutput(tx, rc, def, eauth.user.id, null);
        // a version under review is reopened for the regeneration the administrator asked for
        if (o.status === "in_review" && job.instruction) {
          await tx.update(outputs).set({ status: "returned", reviewNote: `إعادة توليد بتوجيه: ${job.instruction}`, updatedBy: eauth.user.id }).where(eq(outputs.id, o.id));
          o = { ...o, status: "returned" };
        }
        if (o.status === "approved" || o.status === "in_review") { made.push({ id: o.id, version: o.currentVersion }); continue; }
        // after the administrator's edit only the edited version is verified: nothing is regenerated over it
        if (job.kind === "verify" && o.currentVersion) { made.push({ id: o.id, version: o.currentVersion }); continue; }
        const sections: OutputSection[] = structuredClone(inp.draft.sections);
        for (const sec of sections) {
          for (const b of sec.blocks) {
            if (b.type !== "specialist" || b.text.trim()) continue;
            const w = writerFor(packs, sec.key) ?? { section: "*", mode: "model" as const, requireCitation: true };
            if (w.mode === "template" && w.template) {
              const t = fillTemplate(w.template, R.facts, R.decisions);
              if (!t.missing.length) {
                b.text = t.text; b.by = "engine"; b.runId = run.id; b.writer = "template"; b.refs = []; b.basis = [];
                b.binding = specialistBinding(b);
                sectionLog.push({ section: sec.title, by: "template" });
              }
              else problems.push(`${sec.title}: قالب القاعدة يحتاج ${t.missing.join("، ")}`);
              continue;
            }
            if (!allowed.ok) { problems.push(`${sec.title}: لم يُكتب — ${allowed.reason}`); sectionLog.push({ section: sec.title, by: "none", reason: allowed.reason }); continue; }
            const refCodes = w.refCodes?.length ? w.refCodes : PROFILE_REFS[def.profile] ?? [];
            const analysisDef = TEMPLATES[def.profile].analysis.find((a) => `analysis:${a.key}` === sec.key);
            // the single retrieval route: only passages the citation policy authorises reach the model as sources
            // the question is the request's matter (masked, local retrieval only), not the section's writing instruction
            const question = sectionQuestion({ serviceName: rc.service.nameAr, sectionTitle: sec.title, instruction: analysisDef?.prompt, query: w.query, matter: matterOf(rc.req, maskPII) });
            const kb = await retrieve(tx, { question, service: rc.service.code, asOf: new Date().toISOString().slice(0, 10), refCodes, needBinding: BINDING_PROFILES.has(def.profile), limit: 4 });
            // an internal draft (owner's order 2026-11-07, §4–§5): the passages usable for a draft — reviewed or not, each
            // passed on with its flags (unreviewed, OCR, contemporary book, not the school's view…). Nothing reaches the
            // model unless the draft basis is sufficient. A registry instrument's text is its official text (retrieve()).
            // The final approval requires the human review of every passage the version cites (outputs/quality.ts).
            const picked = kb.draftSufficiency.sufficient ? kb.usable : [];
            const hits = picked.map((r) => r.hit);
            for (const h of hits) if (!used.some((u) => u.code === h.refCode && u.version === h.version)) used.push({ code: h.refCode, version: h.version });
            const sources: LlmSource[] = picked.map((r, i) => {
              const h = r.hit;
              const flags = r.draft.usable ? r.draft.flags.map((f) => DRAFT_FLAG_AR[f]) : [];
              return { n: i + 1, chunkId: h.chunkId, refCode: h.refCode, locator: `${KIND_AR[h.refKind]}: ${h.title} — ${h.locator}${flags.length ? ` [${flags.join("؛ ")}]` : ""}`, text: h.text };
            });
            if (w.requireCitation && !kb.draftSufficiency.sufficient) {
              const why = kb.draftSufficiency.reason;
              problems.push(`${sec.title}: ${why}`);
              sectionLog.push({ section: sec.title, by: "none", reason: why, refused: kb.results.filter((r) => !r.decision.citable).map((r) => `${r.hit.refCode} ${r.hit.locator}: ${(r.decision as { detail: string }).detail}`) });
              continue;
            }
            modelCalls++;
            const result = await provider.analyze({
              section: { key: sec.key, title: sec.title, instruction: analysisDef?.prompt ?? b.prompt }, service: { code: rc.service.code, name: rc.service.nameAr },
              facts: maskFacts(R.facts), decisions: R.decisions.map((d) => ({ key: d.key, value: d.value, basis: d.basis })), sources, instruction: job.instruction, promptVersion: PROMPT_VERSION,
            });
            if (!result) { problems.push(`${sec.title}: لم يُرجع النموذج نصًا صالحًا.`); continue; }
            const chk = checkSection({ text: result.text, citations: result.citations, sources, sourceArticles: new Map(hits.map((h, i) => [i + 1, h.articleNo])), requireCitation: !!w.requireCitation });
            warnings.push(...chk.warnings.map((x) => `${sec.title}: ${x}`));
            if (!chk.ok) { problems.push(...chk.problems.map((x) => `${sec.title}: ${x}`)); sectionLog.push({ section: sec.title, by: provider.id, rejected: chk.problems }); continue; }
            const cited = new Set([...result.citations, ...[...result.text.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]))]);
            b.text = result.text;
            b.by = "engine";
            b.runId = run.id;
            // each reference keeps its standing and flags: what the final approval will require reviewed (B13)
            b.refs = picked.map((r, i) => ({ n: i + 1, refCode: r.hit.refCode, version: r.hit.version, locator: r.hit.locator, chunkId: r.hit.chunkId, status: r.draft.usable ? r.draft.status : "rejected", flags: r.draft.usable ? r.draft.flags : [] })).filter((r) => cited.has(r.n));
            // what the model saw shapes the text whether cited or not: the final gate checks every one (N7-14)
            b.basis = picked.map((r) => ({ chunkId: r.hit.chunkId, refCode: r.hit.refCode, locator: r.hit.locator }));
            // a section resting on the school's books or «الميسّر» carries a research dossier for the sharia reviewer:
            // the document is not approved before the dossier's result is approved or modified (§7.9)
            if (picked.some((r) => r.hit.refKind === "classical_fiqh" || r.hit.refKind === "contemporary_book")) {
              const matter = matterOf(rc.req, maskPII);
              const dossier = await research(tx, { question: question, facts: matter ? [{ text: matter, status: "established" }] : [], service: rc.service.code, asOf: new Date().toISOString().slice(0, 10), stage: "draft" });
              const saved = await saveDossier(tx, dossier, { createdBy: eauth.user.id, requestId: rc.req.id, outputId: o.id });
              b.dossierId = saved.id;
            }
            // text, run, references, basis and dossier bound together (N9-9): the final gate recomputes it
            b.writer = "model";
            b.binding = specialistBinding(b);
            sectionLog.push({ section: sec.title, by: provider.id, model: provider.model, cited: b.refs.map((r) => `${r.refCode} ${r.locator}`), rationale: result.rationale });
          }
        }
        // the conflict register follows this run, then the version is saved (human edits of earlier versions are kept)
        await syncConflicts(tx, rc, inp.ctx.conflicts ?? [], { actorId: eauth.user.id, ip: "engine", userAgent: ENGINE_VERSION, outputId: o.id, reason: "عند المعالجة الآلية" });
        const cur = o.currentVersion ? await versionOf(tx, o.id, o.currentVersion) : null;
        const merged = cur ? mergeRegenerated(cur.sections, sections, inp.draft.gaps) : { sections, gaps: inp.draft.gaps, kept: 0 };
        const version = await addVersion(tx, { ...o, status: o.status === "returned" ? "draft" : o.status }, {
          origin: cur ? "regenerated" : "generated", sections: merged.sections, gaps: merged.gaps, sources: inp.draft.sources, inputsHash: inp.draft.inputsHash,
          dataHash: inp.draft.dataHash, dataSnapshot: inp.draft.dataSnapshot, basedOn: cur?.version ?? null, actorId: eauth.user.id,
          note: `أعدّتها المنصة آليًا (التشغيل ${run.id.slice(0, 8)})${job.instruction ? ` بتوجيه مدير النظام: ${job.instruction}` : ""}`,
        });
        made.push({ id: o.id, version });
      }
      return { status: problems.length ? "warn" : "ok", summary: { outputs: made, sections: sectionLog, problems, model: allowed.ok ? { provider: provider.id, model: provider.model } : { provider: "none", reason: allowed.reason } }, value: { outputs: made } };
    });
    outputRef = docStep.value?.outputs[0] ?? null;
    await ctx((tx) => tx.update(processingRuns).set({ sources: used, model: modelCalls ? { provider: provider.id, model: provider.model, promptVersion: PROMPT_VERSION, calls: modelCalls } : null, outputId: outputRef?.id ?? null, outputVersion: outputRef?.version ?? null }).where(eq(processingRuns.id, run.id)));

    // ── 9. verification on live data (the same gate as for a person), then the hand-off to the system administrator
    const verified = await step<{ errors: string[] }>("verify", async (tx) => {
      const rc = await loadRequestCtx(tx, eauth, job.requestId, "staff");
      const errors: string[] = [];
      for (const o of await tx.select().from(outputs).where(and(eq(outputs.requestId, rc.req.id), notInArray(outputs.status, ["approved"])))) {
        if (o.outputKey.includes("@c")) continue;
        const cur = await versionOf(tx, o.id, o.currentVersion);
        if (!cur) { errors.push(`${o.title}: لا نسخة.`); continue; }
        if (o.status === "in_review") continue;
        const gate = await transitionGate(tx, rc, o, cur, "submit", { actorId: eauth.user.id, ip: "engine", userAgent: ENGINE_VERSION });
        errors.push(...gate.errors.map((e) => `${o.title}: ${e}`));
      }
      return { status: errors.length ? "blocked" : "ok", summary: { errors, problems, warnings }, value: { errors } };
    });
    const allErrors = [...new Set([...(verified.value?.errors ?? []), ...problems])];
    if (allErrors.length) return await finish(await blockedHandoff(eauth, job, allErrors, warnings), {});

    await step("handoff", async (tx) => {
      const rc = await loadRequestCtx(tx, eauth, job.requestId, "staff");
      const now = new Date();
      for (const o of await tx.select().from(outputs).where(and(eq(outputs.requestId, rc.req.id), inArray(outputs.status, ["draft", "returned"])))) {
        if (o.outputKey.includes("@c")) continue;
        await tx.update(outputs).set({ status: "in_review", submittedBy: eauth.user.id, submittedAt: now, reviewNote: null, updatedBy: eauth.user.id }).where(eq(outputs.id, o.id));
      }
      // the work stages are the engine's: done; the final review is the only one left
      await tx.update(requestStages).set({ status: "done", completedAt: now, completedBy: eauth.user.id }).where(and(eq(requestStages.requestId, rc.req.id), inArray(requestStages.status, ["pending", "active"]), notInArray(requestStages.stageKey, ["qa", "client_review", "delivery", "client_submit"])));
      await tx.update(requestStages).set({ status: "active", startedAt: now }).where(and(eq(requestStages.requestId, rc.req.id), eq(requestStages.stageKey, "qa")));
      // the client's approval is not a closing step of an engine request (owner's decision 3): the administrator's approval is final
      await tx.update(requestStages).set({ status: "skipped" }).where(and(eq(requestStages.requestId, rc.req.id), inArray(requestStages.stageKey, ["client_review"]), inArray(requestStages.status, ["pending", "active"])));
      if (rc.req.status !== "quality_review") {
        await tx.update(serviceRequests).set({ status: "quality_review", updatedBy: eauth.user.id }).where(eq(serviceRequests.id, rc.req.id));
        await logEvent(tx, rc.req, eauth.user.id, "اكتملت المعالجة الآلية؛ النتيجة بانتظار المراجعة والاعتماد النهائي", rc.req.status, "quality_review");
      }
      await audit(tx, { actorUserId: eauth.user.id, action: "engine.ready", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: "engine", userAgent: ENGINE_VERSION, after: { run: run.id, outputs: docStep.value?.outputs ?? [], warnings: warnings.length } });
      for (const uid of await finalApproverIds(tx))
        await notify(uid, "request.status", { number: rc.req.number, status: "جاهز للمراجعة والاعتماد النهائي" }, { waqfId: rc.req.waqfId, link: `/admin/review/${rc.req.id}`, tx });
      return { status: "ok", summary: { to: "quality_review", warnings } };
    });
    return await finish({ status: "ready", summary: "اكتملت المعالجة؛ المخرج بانتظار المراجعة والاعتماد النهائي.", warnings });
  } catch (e) {
    await ctx((tx) => tx.update(processingRuns).set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 400) : "error", finishedAt: new Date() }).where(eq(processingRuns.id, run.id)));
    throw e;
  }
}

/** Holders of the final approval (system administrators), active accounts only. */
export async function finalApproverIds(tx: Tx): Promise<string[]> {
  const rows = await tx.select({ id: userRoles.userId }).from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(permissions.key, "outputs.final_approve"), eq(users.status, "active")));
  return [...new Set(rows.map((r) => r.id))];
}

/** A run that cannot produce a reviewable output: recorded with its reasons; the administrator is told (never silent). */
async function blockedHandoff(eauth: Auth, job: ClaimedJob, reasons: string[], warnings: string[]): Promise<RunOutcome> {
  await withContext(eauth.db, async (tx) => {
    const [r] = await tx.select({ id: serviceRequests.id, number: serviceRequests.number, waqfId: serviceRequests.waqfId }).from(serviceRequests).where(eq(serviceRequests.id, job.requestId)).limit(1);
    if (!r) return;
    await logEvent(tx, r, eauth.user.id, `تعذّر إكمال المخرج آليًا: ${reasons.slice(0, 3).join("؛ ")}${reasons.length > 3 ? "…" : ""}`, null, null, { internal: true });
    await audit(tx, { actorUserId: eauth.user.id, action: "engine.blocked", entityType: "service_request", entityId: r.id, waqfId: r.waqfId, ip: "engine", userAgent: ENGINE_VERSION, after: { reasons: reasons.slice(0, 20) } });
    for (const uid of await finalApproverIds(tx))
      await notify(uid, "request.status", { number: r.number, status: "تعذّر إكمال المخرج آليًا — راجع الأسباب" }, { waqfId: r.waqfId, link: `/admin/review/${r.id}`, tx });
  });
  return { status: "blocked", summary: "تعذّر إكمال المخرج آليًا؛ الأسباب معروضة لمدير النظام.", blockers: reasons, warnings };
}

export type MissingInput = { kind: "field" | "doc"; key: string; label: string; docType?: string; why: string };

/**
 * Opens the client's items, puts the request in «awaiting the client» and tells the client what is needed. Missing
 * submission data is asked for field by field (and document by document), so that the reply fills the field itself.
 * An item the client already answered (and the engine accepted) is not asked again: it is returned as unresolved.
 */
async function askClient(tx: Tx, eauth: Auth, rc: RequestCtx, asks: Finding[], gaps: { key: string; label: string; field?: string }[], missing: MissingInput[]): Promise<{ asked: number; titles: string[]; unresolved: string[] }> {
  const prior = await tx.select({ title: requestItems.title, status: requestItems.status, createdBy: requestItems.createdBy }).from(requestItems).where(eq(requestItems.requestId, rc.req.id));
  const isOpen = (t: string) => prior.some((o) => o.title === t && ["open", "correction_requested", "answered"].includes(o.status));
  const wasAnswered = (t: string) => prior.some((o) => o.title === t && o.status === "accepted" && o.createdBy === eauth.user.id);
  const [{ m }] = await tx.select({ m: max(requestItems.seq) }).from(requestItems).where(eq(requestItems.requestId, rc.req.id));
  let seq = m ?? 0;
  const want: { kind: string; title: string; body: string; fieldKey?: string | null; docType?: string | null }[] = [];
  for (const a of asks) {
    if (!a.ask) continue;
    if (a.ruleId === "intake_incomplete" && missing.length) {
      for (const x of missing)
        want.push(x.kind === "field"
          ? { kind: "data", title: `استكمل: ${x.label}`, body: `${x.why} اكتب القيمة في ردك وتُحدَّث في طلبك.`, fieldKey: x.key }
          : { kind: "document", title: `أرفق: ${x.label}`, body: x.why, docType: x.docType ?? null });
      continue;
    }
    const list = a.ruleId === "client_gaps" && gaps.length ? `\n${gaps.slice(0, 12).map((g) => `• ${g.label}`).join("\n")}` : "";
    want.push({ kind: a.ask.kind, title: a.ask.title, body: `${a.ask.body}${list}`, fieldKey: a.ask.fieldKey ?? null, docType: a.ask.docType ?? null });
  }
  const unresolved = want.filter((w) => wasAnswered(w.title) && !isOpen(w.title)).map((w) => w.title);
  let n = 0;
  for (const w of want) {
    if (isOpen(w.title) || wasAnswered(w.title)) continue;
    await tx.insert(requestItems).values({
      requestId: rc.req.id, waqfId: rc.req.waqfId, seq: ++seq, kind: w.kind as typeof requestItems.$inferInsert["kind"], title: w.title, body: w.body, fieldKey: w.fieldKey ?? null, docType: w.docType ?? null,
      required: true, visibility: "client", createdBy: eauth.user.id,
    });
    n++;
  }
  if (unresolved.length && !n) return { asked: 0, titles: [], unresolved };
  if (rc.req.status !== "awaiting_client") {
    await tx.update(serviceRequests).set({ status: "awaiting_client", updatedBy: eauth.user.id }).where(eq(serviceRequests.id, rc.req.id));
    await logEvent(tx, rc.req, eauth.user.id, "طلبت المنصة من العميل استكمال ما يلزم للمعالجة", rc.req.status, "awaiting_client");
  }
  await notify(rc.req.requesterUserId, "request.awaiting_client", { number: rc.req.number, note: "نحتاج منك استكمال بعض البيانات لمعالجة طلبك" }, { waqfId: rc.req.waqfId, link: `/app/requests/${rc.req.id}#items`, tx });
  await audit(tx, { actorUserId: eauth.user.id, action: "engine.asked_client", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: "engine", userAgent: ENGINE_VERSION, after: { items: n, rules: asks.map((a) => a.ruleId) } });
  return { asked: n, titles: want.filter((w) => !wasAnswered(w.title)).map((w) => w.title), unresolved };
}
