/**
 * Applying rule packs to a request's facts (PURE, unit-tested): findings, decisions and the section writers that apply.
 */
import { evaluate, type Facts } from "@/server/engines/logic";
import type { DecisionResult, Finding, RulePack, SectionWriter } from "./types";

export function packsFor(packs: RulePack[], serviceCode: string): RulePack[] {
  return packs.filter((p) => p.services === "*" || p.services.includes(serviceCode));
}

const truthy = (v: unknown) => !!v && !(Array.isArray(v) && v.length === 0);

export function applyPacks(packs: RulePack[], facts: Facts): { findings: Finding[]; decisions: DecisionResult[]; applied: { id: string; version: string }[]; errors: string[] } {
  const findings: Finding[] = [];
  const decisions: DecisionResult[] = [];
  const errors: string[] = [];
  for (const p of packs) {
    for (const r of p.rules) {
      try {
        if (truthy(evaluate(r.when, facts))) findings.push({ ruleId: r.id, pack: p.id, effect: r.effect, title: r.title, message: r.message, ref: r.ref, ask: r.ask });
      } catch (e) {
        errors.push(`${p.id}/${r.id}: ${(e as Error).message}`);
      }
    }
    for (const d of p.decisions ?? []) {
      const hit = d.options.find((o) => { try { return truthy(evaluate(o.when, facts)); } catch { return false; } });
      if (hit) decisions.push({ key: d.key, title: d.title, value: hit.value, basis: hit.basis, ref: hit.ref, pack: p.id });
      else if (d.fallback) decisions.push({ key: d.key, title: d.title, value: d.fallback.value, basis: d.fallback.basis, pack: p.id });
    }
  }
  return { findings, decisions, applied: packs.map((p) => ({ id: p.id, version: p.version })), errors };
}

/** The writer of a section: the most specific pack's own writer for that section, else a "*" writer, else null. */
export function writerFor(packs: RulePack[], sectionKey: string): SectionWriter | null {
  for (const p of [...packs].reverse()) {
    const own = p.sections?.find((s) => s.section === sectionKey);
    if (own) return own;
  }
  for (const p of [...packs].reverse()) {
    const any = p.sections?.find((s) => s.section === "*");
    if (any) return any;
  }
  return null;
}

/** Fills a template: {fact.path} from the facts, {decision:key} from the decisions; an unknown placeholder stays visible. */
export function fillTemplate(t: string, facts: Facts, decisions: DecisionResult[]): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = t.replace(/\{(decision:)?([\w.]+)\}/g, (m, dec, key: string) => {
    if (dec) {
      const d = decisions.find((x) => x.key === key);
      if (!d) { missing.push(`decision:${key}`); return m; }
      return d.value;
    }
    let cur: unknown = facts;
    for (const part of key.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined;
    if (cur === undefined || cur === null || cur === "") { missing.push(key); return m; }
    return String(cur);
  });
  return { text, missing };
}
