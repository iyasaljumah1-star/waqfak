/**
 * The penalties table of the nazara regulation (decision 100/1/34/46, 15 جمادى الآخرة 1446هـ) as structured data.
 *
 * Three things are kept apart, as the order requires:
 *  - the violation (code, group, description), read from the table;
 *  - the sanction for each waqf size and repetition, read from the table's cells;
 *  - the procedure for examining violations and issuing sanctions, which belongs to «قواعد معالجة المخالفات»
 *    (NZR art. 23/2, registry id NZR-VIOL). That text was not found; nothing here describes or assumes a procedure.
 *
 * Extraction success is not proof of correctness: every row carries the visual-check record, and the table as a whole
 * stays «not verified against the authority's published file» until a direct fetch and hash comparison succeed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { REFERENCES_DIR } from "./snapshots";

export const SIZES = ["large", "medium", "small"] as const;
export const REPS = ["first", "second", "third"] as const;
export type Size = (typeof SIZES)[number];
export type Rep = (typeof REPS)[number];
export const SIZE_AR: Record<Size, string> = { large: "الأوقاف الكبيرة", medium: "الأوقاف المتوسطة", small: "الأوقاف الصغيرة" };
export const REP_AR: Record<Rep, string> = { first: "المرة الأولى", second: "المرة الثانية", third: "المرة الثالثة" };

/** NZR definitions (art. 1): the size categories the table's columns refer to. */
export const SIZE_DEFINITION_AR: Record<Size, string> = {
  large: "إجمالي قيمة الأصول الموقوفة 200 مليون ريال فأكثر",
  medium: "من 50 مليون ريال حتى أقل من 200 مليون ريال",
  small: "أقل من 50 مليون ريال",
};

export type Sanction =
  | { kind: "warning" } // إنذار كتابي
  | { kind: "fine"; amountSAR: number }
  | { kind: "removal" } // عزل الناظر
  | { kind: "removal_after_notice" } // عزل الناظر بعد إشعاره بالمخالفة دون تجاوبه في المعالجة
  | { kind: "none" } // dashes printed in the cell: no sanction at this level
  | { kind: "blank" }; // nothing printed in the cell (distinct from a dash; meaning not stated by the table)

export type Violation = {
  code: string; // "{group}-{item}"
  group: number;
  groupTitle: string;
  description: string;
  page: number;
  sanctions: Record<Size, Record<Rep, { raw: string; sanction: Sanction | null }>>;
};

export type PenaltyTable = {
  sourceSha256: string;
  instrument: { number: string; dateHijri: string };
  groups: { group: number; title: string }[];
  violations: Violation[];
  footnote: string | null;
  visualCheck: { pages: number[]; by: string; at: string; result: string; humanReviewed: boolean };
  identicalToOfficial: boolean | null;
};

const REMOVAL_AFTER = "عزل الناظر بعد إشعاره بالمخالفة دون تجاوبه في المعالجة";

/** Amount printed with «.» or «,» as the thousands separator («10.000», «2,500»); «500» alone. */
export function parseAmount(s: string): number | null {
  const m = s.replace(/\s+/g, " ").trim().match(/^(\d{1,3}(?:[.,]\d{3})*|\d+) ?ريال$/);
  if (!m) return null;
  return Number(m[1].replace(/[.,]/g, ""));
}

/** Parses one cell. Returns null for anything not recognised (it is then reported, never guessed). */
export function parseCell(raw: string): Sanction | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t === "") return { kind: "blank" };
  if (/^-+( -+)*$/.test(t)) return { kind: "none" };
  if (t === "إنذار كتابي") return { kind: "warning" };
  if (t === "عزل الناظر") return { kind: "removal" };
  if (t === REMOVAL_AFTER) return { kind: "removal_after_notice" };
  const a = parseAmount(t);
  return a === null ? null : { kind: "fine", amountSAR: a };
}

export function sanctionAr(s: Sanction | null): string {
  if (!s) return "غير مقروء";
  switch (s.kind) {
    case "warning":
      return "إنذار كتابي";
    case "fine":
      return `غرامة ${s.amountSAR.toLocaleString("en-US")} ريال`;
    case "removal":
      return "عزل الناظر";
    case "removal_after_notice":
      return REMOVAL_AFTER;
    case "none":
      return "لا جزاء مقرر في الجدول (شرطات)";
    case "blank":
      return "خلية فارغة في الجدول (لم يبيّن الجدول معناها)";
  }
}

type RawRow =
  | { kind: "group"; group: number; title: string; page: number }
  | { kind: "violation"; code: string; printed: string; page: number; description: string; cells: Record<string, { raw: string }> };

type RawFile = {
  source: { sha256: string; identicalToOfficial: boolean | null };
  visualCheck: PenaltyTable["visualCheck"];
  pages: { page: number; text: string }[];
  rows: RawRow[];
  notes: { page: number; text: string }[];
};

export const PEN_TABLE_FILE = "structured/PEN-TABLE/upload-665344b8.json";

export function loadPenaltyTable(dir = REFERENCES_DIR, file = PEN_TABLE_FILE): PenaltyTable {
  const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as RawFile;
  const groups: PenaltyTable["groups"] = [];
  const violations: Violation[] = [];
  let current: { group: number; title: string } | null = null;
  for (const r of raw.rows) {
    if (r.kind === "group") {
      current = { group: r.group, title: r.title };
      groups.push(current);
      continue;
    }
    const sanctions = {} as Violation["sanctions"];
    for (const s of SIZES) {
      sanctions[s] = {} as Record<Rep, { raw: string; sanction: Sanction | null }>;
      for (const p of REPS) {
        const rawCell = r.cells[`${s}.${p}`]?.raw ?? "";
        sanctions[s][p] = { raw: rawCell, sanction: parseCell(rawCell) };
      }
    }
    violations.push({ code: r.code, group: Number(r.code.split("-")[0]), groupTitle: current?.title ?? "", description: r.description, page: r.page, sanctions });
  }
  const header = raw.pages.find((p) => p.page === 3)?.text ?? "";
  const m = header.match(/رقم \((\d+\/\d+\/\d+\/\d+)\) وتاريخ (\d+) جمادى الأخرة (\d{4})/);
  return {
    sourceSha256: raw.source.sha256,
    instrument: m ? { number: m[1], dateHijri: `${m[3]}/06/${m[2].padStart(2, "0")}` } : { number: "", dateHijri: "" },
    groups,
    violations,
    footnote: raw.notes[0]?.text ?? null,
    visualCheck: raw.visualCheck,
    identicalToOfficial: raw.source.identicalToOfficial,
  };
}

/** NZR art. 24/1(ب): a fine may not exceed 500,000 riyals. */
export const NZR_MAX_FINE = 500_000;

/** Structural and legal-consistency checks. Returns findings; an empty list means none. */
export function validatePenaltyTable(t: PenaltyTable): string[] {
  const out: string[] = [];
  if (t.instrument.number !== "100/1/34/46") out.push(`رقم القرار المقروء «${t.instrument.number}» لا يطابق 100/1/34/46`);
  const expectedGroups = 7;
  if (t.groups.length !== expectedGroups) out.push(`عدد المجموعات ${t.groups.length} (المتوقع ${expectedGroups})`);
  for (const g of t.groups) {
    const items = t.violations.filter((v) => v.group === g.group).map((v) => Number(v.code.split("-")[1]));
    items.forEach((n, i) => {
      if (n !== i + 1) out.push(`المجموعة ${g.group}: ترقيم غير متسلسل عند ${g.group}-${n}`);
    });
    if (!items.length) out.push(`المجموعة ${g.group} بلا مخالفات`);
  }
  for (const v of t.violations) {
    if (!v.description) out.push(`${v.code}: وصف فارغ`);
    for (const s of SIZES)
      for (const p of REPS) {
        const c = v.sanctions[s][p];
        if (c.sanction === null) out.push(`${v.code} ${s}.${p}: خلية غير مقروءة «${c.raw}»`);
        else if (c.sanction.kind === "fine" && c.sanction.amountSAR > NZR_MAX_FINE) out.push(`${v.code} ${s}.${p}: غرامة ${c.sanction.amountSAR} تتجاوز الحد النظامي ${NZR_MAX_FINE}`);
      }
  }
  if (!t.footnote || !/500[.,]000/.test(t.footnote)) out.push("حاشية مضاعفة الغرامة (الحد 500.000 ريال) غير ملتقطة");
  return out;
}

/** Facts the table itself does not settle; reported, never resolved by the engine. */
export function openQuestions(t: PenaltyTable): string[] {
  const q: string[] = [];
  const blanks = t.violations.flatMap((v) => SIZES.flatMap((s) => REPS.filter((p) => v.sanctions[s][p].sanction?.kind === "blank").map((p) => `${v.code} (${SIZE_AR[s]}، ${REP_AR[p]})`)));
  if (blanks.length) q.push(`خلايا فارغة لا شرطات فيها ولا جزاء: ${blanks.join("، ")}. لم يبيّن الجدول هل الفراغ يعني عدم وجود جزاء.`);
  q.push("الجدول بثلاث فئات حجم (كبيرة، متوسطة، صغيرة)، ولائحة النظارة تعرّف أيضًا «الأوقاف ذات الانتفاع المباشر»؛ لا عمود لها في الجدول.");
  q.push("لا يذكر الجدول جزاء «إيقاف عمل الناظر» الوارد في المادة 24/1/ج من اللائحة.");
  q.push("حالات العزل في الجدول يلزم مطابقتها بالحالات الحصرية في المادة 24/2 من اللائحة (مراجعة بشرية).");
  q.push("تمهيد الجدول يذكر قرار اللائحة برقم (32/1/18/43)، والجريدة الرسمية تثبت (31/1/18/43).");
  q.push("المادة التاسعة من معايير المستفيد الحقيقي تحيل إلى هذا الجدول بتاريخ 1446/06/05هـ، والجدول يذكر 15 جمادى الآخرة 1446هـ.");
  q.push("إجراءات النظر في المخالفات وإصدار الجزاءات مكانها «قواعد معالجة المخالفات» (المادة 23/2)، ولم يُعثر عليها؛ الجدول لا يغني عنها.");
  if (t.identicalToOfficial !== true) q.push("لم يثبت أن الملف المرفوع مطابق لملف الهيئة المنشور (2026-04): يلزم جلب مباشر ومقارنة البصمة.");
  return q;
}
