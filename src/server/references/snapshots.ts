/**
 * Loads verified source copies (snapshots) and knowledge-base candidates from data/references, checking each
 * snapshot against the sha256 recorded in the manifest: a changed file is refused, never silently used.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { segment, toUnits } from "./segment";
import type { RetrievalVia } from "./types";
import { sha256, type RefVersion } from "./versions";

export type SnapshotEntry = {
  id: string;
  refId: string;
  file: string;
  url: string;
  retrievedAt: string;
  via: RetrievalVia;
  relayRequestId?: string;
  httpStatus: number;
  sha256: string;
  directConfirmed: boolean;
  /** text: the instrument's text; decision: its issuing decision; visual_transcription: typed from page images of a
   *  file (never the comparison baseline); statement: an official page that records facts, never cited as a rule. */
  role: "text" | "decision" | "visual_transcription" | "statement";
  extractionNote?: string;
  /** For a transcription of a file: sha256 of that file. */
  sourceFileSha256?: string;
};

export class SnapshotIntegrityError extends Error {}

export const REFERENCES_DIR = path.join(process.cwd(), "data", "references");

export function loadManifest(dir = REFERENCES_DIR): SnapshotEntry[] {
  return (JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { snapshots: SnapshotEntry[] }).snapshots;
}

export function readSnapshot(entry: SnapshotEntry, dir = REFERENCES_DIR): string {
  const text = readFileSync(path.join(dir, entry.file), "utf8");
  const actual = sha256(text);
  if (actual !== entry.sha256) throw new SnapshotIntegrityError(`${entry.id}: sha256 ${actual} لا يطابق المسجل ${entry.sha256}`);
  return text;
}

export function readCandidate(relPath: string, dir = REFERENCES_DIR): { text: string; sha256: string } {
  const text = readFileSync(path.join(dir, "kb-candidates", relPath), "utf8");
  return { text, sha256: sha256(text) };
}

/** Builds an (immutable) version from a snapshot. effectiveFrom comes from the registry, never from the snapshot. */
export function versionFromSnapshot(entry: SnapshotEntry, effectiveFrom: string | null, label: string, dir = REFERENCES_DIR): RefVersion {
  const text = readSnapshot(entry, dir);
  return {
    id: `${entry.id}@${entry.sha256.slice(0, 12)}`,
    refId: entry.refId,
    label,
    effectiveFrom,
    source: { url: entry.url, retrievedAt: entry.retrievedAt, via: entry.via, sha256: entry.sha256, directConfirmed: entry.directConfirmed },
    text,
    units: toUnits(segment(text)),
    createdAt: entry.retrievedAt,
  };
}
