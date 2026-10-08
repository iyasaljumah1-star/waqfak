import { z } from "zod";

/** FormData → plain object; keys listed in `multi` keep every value (checkbox groups, multi-selects). */
export function formObj(fd: FormData, multi: string[] = []): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (multi.includes(k)) continue;
    o[k] = typeof v === "string" ? v : v;
  }
  for (const k of multi) o[k] = fd.getAll(k).map(String).filter(Boolean);
  return o;
}

export const optText = (max = 2000) =>
  z.string().trim().max(max, `النص أطول من ${max} حرف.`).optional().transform((v) => (v ? v : null));
export const reqText = (min: number, msg: string, max = 2000) => z.string({ error: msg }).trim().min(min, msg).max(max, `النص أطول من ${max} حرف.`);
export const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "أدخل تاريخًا صحيحًا (YYYY-MM-DD).");
export const optNumber = (min = 0, max = 1e12, msg = "أدخل رقمًا صحيحًا.") =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= min && v <= max), msg);
export const optInt = (min = 0, max = 1e9, msg = "أدخل عددًا صحيحًا.") =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= min && v <= max), msg);
export const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");
export const code = (msg = "الرمز بحروف إنجليزية كبيرة وأرقام وشرطات، مثل T01 أو OB-REG-04.") =>
  z.string({ error: msg }).trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, msg);
export const uuid = z.string().uuid("معرّف غير صالح.");
