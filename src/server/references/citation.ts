/**
 * Citation guard. A unit may be cited only when every condition holds:
 *  1. the instrument is registered and in force on the date asked (a repealed text is never cited as in force);
 *  2. a version of its text applies on that date and comes from an official host;
 *  3. that version was compared with the official source and the cited article came out identical or editorial-only;
 *  4. a person reviewed and accepted that comparison run;
 *  5. the article / paragraph / item exists in that version.
 * Anything else is refused with the reason. The result carries what a citation must display.
 */
import { statusAt, type RegistryEntry } from "./registry";
import { CITABLE_OUTCOMES, OFFICIAL_HOSTS, type MatchOutcome, type RefStatus } from "./types";
import type { VersionStore } from "./versions";

export type CitationRequest = { refId: string; article: number; paragraph?: number; item?: string; asOf: string; historical?: boolean };

export type CitationDisplay = {
  refName: string;
  locator: string;
  heading: string | null;
  text: string;
  officialUrl: string;
  versionLabel: string;
  effectiveFrom: string;
  status: RefStatus;
  verification: { outcome: MatchOutcome; runId: string; reviewedBy: string; reviewedAt: string; provenance: string };
};

export type CitationRefusal =
  | "unknown_reference"
  | "not_in_force"
  | "status_unknown"
  | "no_version_for_date"
  | "source_not_official"
  | "not_compared"
  | "article_not_verified"
  | "not_reviewed"
  | "no_such_unit";

export type CitationResult = { ok: true; display: CitationDisplay } | { ok: false; refusal: CitationRefusal; detail: string };

const REFUSAL_AR: Record<CitationRefusal, string> = {
  unknown_reference: "المرجع غير مسجل",
  not_in_force: "المرجع غير ساري في التاريخ المطلوب",
  status_unknown: "حالة سريان المرجع غير ثابتة من مصدر رسمي",
  no_version_for_date: "لا يوجد نص محفوظ ينطبق على التاريخ المطلوب",
  source_not_official: "النص المحفوظ ليس من مصدر رسمي",
  not_compared: "لم تُجرَ مطابقة للنص المحفوظ",
  article_not_verified: "نتيجة مطابقة المادة لا تسمح بالاستشهاد بها",
  not_reviewed: "المطابقة لم تُراجع وتُعتمد من شخص مخول",
  no_such_unit: "المادة أو الفقرة غير موجودة في الإصدار المعتمد",
};
export const refusalText = (r: CitationRefusal) => REFUSAL_AR[r];

const refuse = (refusal: CitationRefusal, detail: string): CitationResult => ({ ok: false, refusal, detail: `${REFUSAL_AR[refusal]}: ${detail}` });

export function cite(registry: RegistryEntry[], store: VersionStore, req: CitationRequest): CitationResult {
  const entry = registry.find((e) => e.id === req.refId);
  if (!entry) return refuse("unknown_reference", req.refId);
  const status = statusAt(entry, req.asOf);
  if (status === "unknown" || status === "draft") return refuse("status_unknown", `${entry.officialName} في ${req.asOf}`);
  const inForce = status === "in_force" || status === "in_force_amended";
  if (!inForce && !(req.historical && (status === "repealed" || status === "historical"))) return refuse("not_in_force", `${entry.officialName}: ${status} في ${req.asOf}`);

  const version = store.versionAt(entry.id, req.asOf);
  if (!version || !version.effectiveFrom) return refuse("no_version_for_date", `${entry.officialName} في ${req.asOf}`);
  let host = "";
  try {
    host = new URL(version.source.url).host;
  } catch {
    /* invalid url: not official */
  }
  if (!(OFFICIAL_HOSTS as readonly string[]).includes(host)) return refuse("source_not_official", version.source.url);

  const locator = `م${req.article}${req.paragraph !== undefined ? `/ف${req.paragraph}` : ""}${req.item ? `/${req.item}` : ""}`;
  const unit = version.units.find((u) => u.locator === locator);
  if (!unit) return refuse("no_such_unit", `${locator} في ${version.label}`);

  const runs = store.matchRuns(version.id);
  if (!runs.length) return refuse("not_compared", version.label);
  const articleKey = `م${req.article}`;
  // The latest accepted run decides; an unreviewed run never authorises a citation.
  const reviewed = runs
    .map((r) => ({ r, rev: store.reviews(r.id).filter((x) => x.decision === "accepted").sort((a, b) => b.at.localeCompare(a.at))[0] }))
    .filter((x) => x.rev)
    .sort((a, b) => b.rev!.at.localeCompare(a.rev!.at));
  if (!reviewed.length) return refuse("not_reviewed", version.label);
  const { r: run, rev } = reviewed[0]!;
  const outcome = run.perArticle[articleKey];
  if (!outcome || !CITABLE_OUTCOMES.has(outcome)) return refuse("article_not_verified", `${articleKey}: ${outcome ?? "غير مقارن"}`);

  return {
    ok: true,
    display: {
      refName: entry.officialName,
      locator,
      heading: unit.heading,
      text: unit.text,
      officialUrl: version.source.url,
      versionLabel: version.label,
      effectiveFrom: version.effectiveFrom,
      status,
      verification: {
        outcome,
        runId: run.id,
        reviewedBy: rev!.reviewer,
        reviewedAt: rev!.at,
        provenance: version.source.directConfirmed ? "مسترجع مباشرة من المصدر الرسمي" : "مسترجع من المصدر الرسمي عبر وسيط، لم يُؤكد باسترجاع مباشر بعد",
      },
    },
  };
}
