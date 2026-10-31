import type { Logic } from "@/server/engines/logic";

/**
 * Rule packs (PURE types). A pack is data with a version: the conditions are JSON-logic over the request's facts
 * (engines/logic.ts — evaluated, never executed as code), each with its effect, message and reference. Every run
 * records the packs and versions it applied. A pack is changed by publishing a new version, never in place.
 */
export type RuleEffect = "block" | "warn" | "client";

export type Rule = {
  id: string;
  title: string;
  /** True when the rule fires (the finding applies). */
  when: Logic;
  effect: RuleEffect;
  message: string;
  /** For «client»: what the client is asked to complete (an item on the request). */
  ask?: { kind: "data" | "document" | "question"; title: string; body: string; docType?: string; fieldKey?: string };
  ref?: { refCode: string; locator?: string };
};

/** A decision the pack takes from the facts: the first option whose condition holds, else the default. */
export type Decision = {
  key: string;
  title: string;
  options: { value: string; when: Logic; basis: string; ref?: { refCode: string; locator?: string } }[];
  fallback?: { value: string; basis: string };
};

/** How a section of the output is written: by a rule template (deterministic) or by the model under the rules. */
export type SectionWriter = {
  /** The output section key (`analysis:<key>`), or "*" for every analysis section without its own writer. */
  section: string;
  mode: "template" | "model";
  /** Template text with {fact} placeholders filled from the facts and {decision:key} from the decisions. */
  template?: string;
  /** References searched for the section (registry codes); empty = the output profile's references. */
  refCodes?: string[];
  /** Extra search words for the section. */
  query?: string;
  /** The section must rest on at least one source (otherwise it is not accepted). */
  requireCitation?: boolean;
};

export type RulePack = {
  id: string;
  version: string;
  title: string;
  /** Service codes the pack applies to, or "*" for all. */
  services: string[] | "*";
  rules: Rule[];
  decisions?: Decision[];
  sections?: SectionWriter[];
  /** References without which the service is not automated: missing, unreadable or unverified → the run stops. */
  essentialRefs?: string[];
};

export type Finding = { ruleId: string; pack: string; effect: RuleEffect; title: string; message: string; ref?: Rule["ref"]; ask?: Rule["ask"] };
export type DecisionResult = { key: string; title: string; value: string; basis: string; ref?: Rule["ref"]; pack: string };
