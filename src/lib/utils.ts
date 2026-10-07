import { clsx, type ClassValue } from "clsx";

export const cn = (...v: ClassValue[]) => clsx(v);

/** Server action result shared by every form (used with React's useActionState). */
export type ActionState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string | undefined>;
  data?: Record<string, unknown>;
};
export const initialState: ActionState = {};

const nf = new Intl.NumberFormat("ar-SA-u-nu-latn", { maximumFractionDigits: 2 });
export const fmtNumber = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "—" : nf.format(Number(n)));
export const fmtSAR = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "—" : `${nf.format(Number(n))} ر.س`);
export const fmtPct = (n: number | string | null | undefined) => (n === null || n === undefined ? "—" : `${nf.format(Number(n))}%`);

const dtf = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" });
const hdtf = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" });
const dttf = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" });

const toDate = (d: Date | string) => (typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00+03:00` : d) : d);
export const fmtDate = (d: Date | string | null | undefined) => (d ? dtf.format(toDate(d)) : "—");
export const fmtHijri = (d: Date | string | null | undefined) => (d ? hdtf.format(toDate(d)) : "—");
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? dttf.format(toDate(d)) : "—");
/** Regulatory dates are shown in both calendars. */
export const fmtBoth = (d: Date | string | null | undefined) => (d ? `${fmtDate(d)} (${fmtHijri(d)})` : "—");

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()) + "T12:00:00Z");
  const d = new Date(`${iso}T12:00:00Z`);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export function relDays(iso: string | null | undefined): string {
  const n = daysUntil(iso);
  if (n === null) return "بلا موعد محدد";
  if (n === 0) return "اليوم";
  if (n === 1) return "غدًا";
  if (n === -1) return "فات أمس";
  if (n < 0) return `متأخر ${Math.abs(n)} يومًا`;
  return `بعد ${n} يومًا`;
}

export const SIZE_LABEL: Record<string, string> = { large: "كبير", medium: "متوسط", small: "صغير", direct_benefit: "ذو انتفاع مباشر" };
export const TYPE_LABEL: Record<string, string> = { public: "عام (خيري)", private: "خاص (أهلي)", joint: "مشترك" };
export const STATUS_LABEL: Record<string, string> = {
  idea: "فكرة", draft: "مسودة", documenting: "قيد التوثيق", documented: "موثّق", registered: "مسجّل", active: "نشط", suspended: "معلّق", ended: "منتهٍ",
};
export const NAZIR_MODE_LABEL: Record<string, string> = {
  founder: "الواقف نفسه", individual: "ناظر فرد", board: "مجلس نظارة", legal_entity: "شخص اعتباري", gaa: "الهيئة العامة للأوقاف", vacant: "شاغرة",
};
export const WAQFAK_ROLE_LABEL: Record<string, string> = {
  none: "لا يوجد", advisor: "مستشار", delegated_manager: "مدير مفوّض", nazir: "ناظر", board_member: "عضو مجلس", bookkeeper: "ماسك دفاتر",
};
