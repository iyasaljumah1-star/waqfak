/**
 * Append-only version history of reference texts. A version is never edited or deleted: a new text is a new version,
 * and the text in force on a past date stays answerable. Comparison runs and their human reviews are separate,
 * equally append-only records.
 */
import { createHash } from "node:crypto";
import type { MatchOutcome, RefUnit, RetrievalVia } from "./types";

export type SourceCopy = {
  url: string;
  retrievedAt: string;
  via: RetrievalVia;
  sha256: string;
  /** True once the platform's own fetcher has re-fetched the official host and found the same text. */
  directConfirmed: boolean;
};

export type RefVersion = {
  id: string;
  refId: string;
  label: string;
  /** Date from which this text applies (ISO). Null: not placed on the time line, never returned for a date. */
  effectiveFrom: string | null;
  source: SourceCopy;
  text: string;
  units: RefUnit[];
  createdAt: string;
};

export type MatchRun = {
  id: string;
  versionId: string;
  candidateLabel: string;
  candidateSha256: string;
  outcome: MatchOutcome;
  /** Outcome per article locator («م8»). */
  perArticle: Record<string, MatchOutcome>;
  ranAt: string;
};

export type MatchReview = { runId: string; reviewer: string; at: string; decision: "accepted" | "rejected"; note: string };

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export class AppendOnlyViolation extends Error {}

export interface VersionStore {
  addVersion(v: RefVersion): RefVersion;
  versions(refId: string): RefVersion[];
  versionAt(refId: string, isoDate: string): RefVersion | null;
  addMatchRun(r: MatchRun): void;
  matchRuns(versionId: string): MatchRun[];
  addReview(r: MatchReview): void;
  reviews(runId: string): MatchReview[];
}

export class InMemoryVersionStore implements VersionStore {
  private vs: RefVersion[] = [];
  private runs: MatchRun[] = [];
  private revs: MatchReview[] = [];

  /** Adding the same text again returns the existing version; a different text under an existing id is refused. */
  addVersion(v: RefVersion): RefVersion {
    const sameId = this.vs.find((x) => x.id === v.id);
    if (sameId) {
      if (sameId.source.sha256 !== v.source.sha256 || sameId.text !== v.text) throw new AppendOnlyViolation(`version ${v.id} exists with different content`);
      return sameId;
    }
    const sameText = this.vs.find((x) => x.refId === v.refId && x.source.sha256 === v.source.sha256 && x.effectiveFrom === v.effectiveFrom);
    if (sameText) return sameText;
    const frozen = Object.freeze({ ...v, source: Object.freeze({ ...v.source }), units: Object.freeze(v.units.map((u) => Object.freeze({ ...u }))) as unknown as RefUnit[] });
    this.vs.push(frozen);
    return frozen;
  }

  versions(refId: string): RefVersion[] {
    return this.vs.filter((v) => v.refId === refId).sort((a, b) => (a.effectiveFrom ?? "").localeCompare(b.effectiveFrom ?? "") || a.createdAt.localeCompare(b.createdAt));
  }

  versionAt(refId: string, isoDate: string): RefVersion | null {
    const eligible = this.versions(refId).filter((v) => v.effectiveFrom !== null && v.effectiveFrom <= isoDate);
    return eligible[eligible.length - 1] ?? null;
  }

  addMatchRun(r: MatchRun): void {
    if (this.runs.some((x) => x.id === r.id)) throw new AppendOnlyViolation(`run ${r.id} exists`);
    this.runs.push(Object.freeze({ ...r, perArticle: Object.freeze({ ...r.perArticle }) }) as MatchRun);
  }

  matchRuns(versionId: string): MatchRun[] {
    return this.runs.filter((r) => r.versionId === versionId);
  }

  addReview(r: MatchReview): void {
    if (!this.runs.some((x) => x.id === r.runId)) throw new Error(`unknown run ${r.runId}`);
    this.revs.push(Object.freeze({ ...r }));
  }

  reviews(runId: string): MatchReview[] {
    return this.revs.filter((r) => r.runId === runId);
  }
}
