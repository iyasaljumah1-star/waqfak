/**
 * Required-document checklist per waqf (pure: no DB / Next imports, unit-tested in tests/documents.test.ts).
 * The loader that feeds it lives in ./queries (requiredDocumentsChecklist).
 */
import { fmtBoth } from "@/lib/utils";
import { EXPIRING_SOON_DAYS, REQUIRED_DOCS, type ChecklistState, type RequiredDocKey } from "./labels";

export type ChecklistDoc = {
  id: string;
  docType: string;
  title: string;
  status: "quarantine" | "active" | "rejected" | "archived";
  expiresOn: string | null;
  issuedOn: string | null;
  createdAt: Date;
  /** Whether the current user passes the confidentiality gate for this document. */
  visible: boolean;
};

export type ChecklistInput = {
  today: string; // YYYY-MM-DD (Asia/Riyadh)
  fiscalYearEnd: string; // MM-DD
  docs: ChecklistDoc[]; // non-archived documents of the waqf
  realEstateAssets: { id: string; covered: boolean }[]; // covered = has an active ownership deed (linked or referenced)
  hasAnyAssets: boolean;
};

export type ChecklistItem = {
  key: RequiredDocKey;
  label: string;
  why: string;
  state: ChecklistState;
  detail: string;
  /** Best matching document, when one exists (only linked when visible to the user). */
  doc: { id: string; title: string; visible: boolean } | null;
  count: number;
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDays = (from: string, to: string) => Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Last fiscal-year end strictly before `today`. */
export function lastFiscalYearEnd(today: string, fiscalYearEnd: string): string {
  const mmdd = /^\d{2}-\d{2}$/.test(fiscalYearEnd) ? fiscalYearEnd : "12-31";
  const y = Number(today.slice(0, 4));
  const cand = `${y}-${mmdd}`;
  return cand < today ? cand : `${y - 1}-${mmdd}`;
}

/** Days after the fiscal year end during which missing statements show as "due" rather than "outdated". */
export const STATEMENTS_GRACE_DAYS = 120;

function expiryState(today: string, expiresOn: string | null): { state: ChecklistState; detail: string } | null {
  if (!expiresOn) return null;
  const d = diffDays(today, expiresOn);
  if (d < 0) return { state: "expired", detail: `انتهت منذ ${-d} يومًا. جدّدها وارفع النسخة الجديدة.` };
  if (d <= EXPIRING_SOON_DAYS) return { state: "expiring", detail: `تنتهي خلال ${d} يومًا. ابدأ التجديد الآن.` };
  return null;
}

/** Picks the most useful document: active first, then the latest expiry (no expiry counts as latest), then newest. */
function best(docs: ChecklistDoc[]) {
  return [...docs].sort((a, b) => {
    if ((a.status === "active") !== (b.status === "active")) return a.status === "active" ? -1 : 1;
    const ea = a.expiresOn ?? "9999-12-31";
    const eb = b.expiresOn ?? "9999-12-31";
    if (ea !== eb) return ea < eb ? 1 : -1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}

export function evaluateChecklist(input: ChecklistInput): ChecklistItem[] {
  const { today } = input;
  const usable = input.docs.filter((d) => d.status === "active" || d.status === "quarantine");
  const of = (t: string) => usable.filter((d) => d.docType === t);
  const ref = (d: ChecklistDoc | undefined) => (d ? { id: d.id, title: d.title, visible: d.visible } : null);

  return REQUIRED_DOCS.map(({ key, label, why }): ChecklistItem => {
    const docs = of(key);
    const active = docs.filter((d) => d.status === "active");
    const base = { key, label, why, count: active.length };

    if (key === "ownership_deed") {
      const n = input.realEstateAssets.length;
      const covered = input.realEstateAssets.filter((a) => a.covered).length;
      const doc = ref(best(docs));
      if (!n) {
        if (active.length) return { ...base, state: "ok", detail: `${active.length} صك مرفوع.`, doc };
        if (input.hasAnyAssets) return { ...base, state: "ok", detail: "لا توجد أصول عقارية مسجلة تتطلب صك ملكية.", doc };
        return { ...base, state: "missing", detail: "لم تُسجَّل أصول للوقف بعد. سجّل الأصول وارفع صكوك ملكيتها.", doc };
      }
      const detail = `${covered} من ${n} ${n === 1 ? "عقار مربوط" : "عقارات مربوطة"} بصك ملكية${active.length ? ` · ${active.length} صك مرفوع` : ""}.`;
      if (covered === n) return { ...base, state: "ok", detail, doc };
      return { ...base, state: covered > 0 || active.length > 0 ? "partial" : "missing", detail: `${detail} اربط كل صك بأصله من صفحة الأصول.`, doc };
    }

    if (key === "financial_statement") {
      const fye = lastFiscalYearEnd(today, input.fiscalYearEnd);
      const refDate = (d: ChecklistDoc) => d.issuedOn ?? isoOf(d.createdAt);
      const current = active.filter((d) => refDate(d) > fye);
      if (current.length) return { ...base, state: "ok", detail: `مرفوعة للسنة المالية المنتهية في ${fmtBoth(fye)}.`, doc: ref(best(current)) };
      const pendingCurrent = docs.filter((d) => d.status === "quarantine" && refDate(d) > fye);
      if (pendingCurrent.length) return { ...base, state: "pending", detail: "الملف قيد الفحص الأمني.", doc: ref(pendingCurrent[0]) };
      const older = best(active);
      if (!older) return { ...base, state: "missing", detail: `لم تُرفع قوائم مالية بعد. ارفع قوائم السنة المالية المنتهية في ${fmtBoth(fye)}.`, doc: null };
      if (diffDays(fye, today) <= STATEMENTS_GRACE_DAYS)
        return { ...base, state: "due", detail: `قوائم السنة المنتهية في ${fmtBoth(fye)} لم تُرفع بعد. ارفعها قبل ${fmtBoth(addDays(fye, STATEMENTS_GRACE_DAYS))}.`, doc: ref(older) };
      return { ...base, state: "outdated", detail: `آخر قوائم مرفوعة أقدم من السنة المالية المنتهية في ${fmtBoth(fye)}. ارفع القوائم الأحدث.`, doc: ref(older) };
    }

    const b = best(docs);
    if (!b) return { ...base, state: "missing", detail: "لم تُرفع بعد.", doc: null };
    if (b.status !== "active") return { ...base, state: "pending", detail: "الملف قيد الفحص الأمني.", doc: ref(b) };
    const exp = expiryState(today, b.expiresOn);
    if (exp) return { ...base, ...exp, doc: ref(b) };
    return { ...base, state: "ok", detail: b.expiresOn ? `سارية حتى ${fmtBoth(b.expiresOn)}.` : "مرفوعة.", doc: ref(b) };
  });
}
