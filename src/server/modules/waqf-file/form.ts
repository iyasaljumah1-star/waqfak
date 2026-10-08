/**
 * Shared zod helpers and small utilities for the waqf-file feature modules (identity, deed, parties, beneficiaries,
 * assets, finance, establish, wills). Plain module: safe to import from "use server" action files.
 */
import { z } from "zod";

export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());

export const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `النص أطول من ${max} حرفًا.`)
    .optional()
    .transform((v) => v || null);

export const reqText = (max: number, msg: string, min = 2) => z.string({ error: msg }).trim().min(min, msg).max(max, `النص أطول من ${max} حرفًا.`);

export const optDate = z
  .union([z.literal(""), z.iso.date("أدخل تاريخًا صحيحًا.")])
  .optional()
  .transform((v) => v || null);

export const reqDate = (msg = "أدخل التاريخ.") => z.iso.date(msg);

export const flag = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

/** Money: accepts "12,500.50" or Arabic-Indic digits; returns a numeric string with 2 decimals or null. */
export const optMoney = z
  .string()
  .optional()
  .transform((v) => normalizeNumber(v))
  .refine((v) => v === null || (Number.isFinite(Number(v)) && Number(v) >= 0), "أدخل مبلغًا صحيحًا موجبًا.")
  .transform((v) => (v === null ? null : Number(v).toFixed(2)));

export const reqMoney = (msg = "أدخل المبلغ.") =>
  z
    .string({ error: msg })
    .transform((v) => normalizeNumber(v))
    .refine((v) => v !== null && Number.isFinite(Number(v)) && Number(v) > 0, msg)
    .transform((v) => Number(v).toFixed(2));

export const optPct = z
  .string()
  .optional()
  .transform((v) => normalizeNumber(v))
  .refine((v) => v === null || (Number(v) >= 0 && Number(v) <= 100), "النسبة بين 0 و100.")
  .transform((v) => (v === null ? null : Number(v).toFixed(2)));

export const optInt = (min = 0, max = 1_000_000) =>
  z
    .string()
    .optional()
    .transform((v) => normalizeNumber(v))
    .refine((v) => v === null || (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max), `أدخل رقمًا صحيحًا بين ${min} و${max}.`)
    .transform((v) => (v === null ? null : Number(v)));

export const uuidField = (msg = "معرّف غير صالح.") => z.uuid(msg);

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export function normalizeNumber(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/٫/g, ".").replace(/[,٬\s]/g, "");
  return s;
}

/** Reads repeated form fields `prefix.key` (in DOM order) into an array of row objects. Empty rows are dropped. */
export function readRows(fd: FormData, prefix: string, keys: string[]): Record<string, string>[] {
  const cols = keys.map((k) => fd.getAll(`${prefix}.${k}`).map((x) => (typeof x === "string" ? x : "")));
  const n = Math.max(0, ...cols.map((c) => c.length));
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, string> = {};
    keys.forEach((k, j) => (r[k] = (cols[j][i] ?? "").trim()));
    if (Object.values(r).some((x) => x !== "" && x !== "off")) rows.push(r);
  }
  return rows;
}

/** FormData → plain object of single values (first value wins), excluding Next's internal "$ACTION" keys. */
export function formObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$") && !(k in o)) o[k] = v;
  return o;
}
