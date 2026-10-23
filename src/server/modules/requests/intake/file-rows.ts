/**
 * Rows of a request's tables built from the waqf file (PURE): the asset register and the nazara board. Each row keeps
 * the record it came from (`src: "file:<id>"`), so the team sees which values the client confirmed from the file and
 * which he added or changed, and the generator can compare a row with its record.
 */
export type FileAsset = {
  id: string; category: string; title: string; ownershipDocNo: string | null; sharePct: string | null; inWaqfName: boolean | null;
  details: Record<string, string>; deedNo?: string | null; city?: string | null; district?: string | null;
};
export type FileMember = { id: string; personName: string; role: string; capacity: string | null };

const KIND: Record<string, string> = { real_estate: "real_estate", shares: "shares", fund_units: "fund_units", sukuk: "sukuk", portfolio: "shares", cash: "cash", movable: "movable", usufruct: "usufruct", intellectual_property: "intellectual_property" };
const DOC: Record<string, string> = { real_estate: "deed", shares: "securities_statement", fund_units: "securities_statement", sukuk: "securities_statement", portfolio: "securities_statement", cash: "bank_statement" };

/** «عمارة … في الرياض، حي النرجس، مساحتها 900 م²» / «20000 سهم في شركة …» — what identifies the asset, from its record. */
export function assetDescription(a: FileAsset): string {
  const d = a.details ?? {};
  if (a.category === "real_estate") {
    const where = [a.city ?? d.city, a.district ?? d.district].filter(Boolean).join("، ");
    return [a.title, where ? `في ${where}` : "", d.areaSqm ? `مساحتها ${d.areaSqm} م²` : ""].filter(Boolean).join("، ");
  }
  if (["shares", "fund_units", "sukuk", "portfolio"].includes(a.category)) {
    const qty = d.quantity ? `${Number(d.quantity).toLocaleString("en-US")} ${a.category === "fund_units" ? "وحدة" : a.category === "sukuk" ? "صك" : "سهم"}` : "";
    return [qty && d.issuer ? `${qty} في ${d.issuer}` : a.title, d.custodian ? `لدى ${d.custodian}` : ""].filter(Boolean).join("، ");
  }
  return a.title;
}

export function assetRowFromFile(a: FileAsset): Record<string, string> {
  const pct = a.sharePct ? Number(a.sharePct) : null;
  const row: Record<string, string> = {
    kind: KIND[a.category] ?? "other",
    description: assetDescription(a),
    docKind: DOC[a.category] ?? "other",
    docNo: a.ownershipDocNo ?? a.deedNo ?? "",
    docDate: a.details?.deedDate ?? "",
    owned: a.inWaqfName === null || a.inWaqfName === undefined ? "" : "yes",
    share: pct !== null && pct < 100 ? "share" : "whole",
    sharePercent: pct !== null && pct < 100 ? String(pct) : "",
    src: `file:${a.id}`,
  };
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== ""));
}

const ROLE: Record<string, string> = { chair: "chair", member: "member", secretary: "secretary", vice_chair: "member" };
export function boardRowFromFile(m: FileMember): Record<string, string> {
  return Object.fromEntries(Object.entries({ name: m.personName, role: ROLE[m.role] ?? "member", capacity: m.capacity ?? "", src: `file:${m.id}` }).filter(([, v]) => v !== ""));
}

/** Where a row of the request differs from the waqf-file record it came from (field labels). */
export function rowDiff(row: Record<string, string>, fileRow: Record<string, string> | undefined, cols: { key: string; label: string }[]) {
  if (!fileRow) return [];
  return cols.filter((c) => c.key !== "src" && (fileRow[c.key] ?? "") !== "" && (row[c.key] ?? "") !== (fileRow[c.key] ?? "")).map((c) => ({ key: c.key, label: c.label, file: fileRow[c.key], request: row[c.key] ?? "" }));
}
