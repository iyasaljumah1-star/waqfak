/**
 * PURE billing helpers (no server imports): VAT math, ZATCA phase-1 QR (TLV → base64), contract templating.
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeInvoice(subtotal: number, vatRate: number, discount = 0) {
  const net = round2(Math.max(0, subtotal - discount));
  const vat = round2((net * vatRate) / 100);
  return { subtotal: round2(subtotal), discount: round2(discount), net, vat, total: round2(net + vat) };
}

/**
 * ZATCA e-invoicing phase 1 (simplified tax invoice) QR payload:
 * TLV records — 1 seller name, 2 VAT registration number, 3 timestamp (ISO 8601), 4 invoice total (with VAT), 5 VAT total.
 * Each record = tag byte, length byte (UTF-8 byte length), value bytes. The concatenation is base64-encoded.
 */
export function zatcaTlvBase64(f: { sellerName: string; vatNumber: string; timestamp: string; total: string; vat: string }): string {
  const parts = [f.sellerName, f.vatNumber, f.timestamp, f.total, f.vat].map((v, i) => {
    const bytes = Buffer.from(v, "utf8");
    if (bytes.length > 255) throw new Error("TLV value too long");
    return Buffer.concat([Buffer.from([i + 1, bytes.length]), bytes]);
  });
  return Buffer.concat(parts).toString("base64");
}

export function decodeTlv(b64: string): string[] {
  const buf = Buffer.from(b64, "base64");
  const out: string[] = [];
  let i = 0;
  while (i < buf.length) {
    const len = buf[i + 1];
    out[buf[i] - 1] = buf.subarray(i + 2, i + 2 + len).toString("utf8");
    i += 2 + len;
  }
  return out;
}

/** Replaces {{key}} placeholders; unknown keys become an empty string. */
export function fillTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90p";
export const AGING_LABEL: Record<AgingBucket, string> = { current: "غير مستحقة بعد", d1_30: "متأخرة 1–30 يومًا", d31_60: "31–60 يومًا", d61_90: "61–90 يومًا", d90p: "أكثر من 90 يومًا" };

/** Pure: aging bucket for an unpaid invoice by days past due. */
export function agingBucket(dueOn: string | null, today: string): AgingBucket {
  if (!dueOn || dueOn >= today) return "current";
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000);
  return days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90p";
}

