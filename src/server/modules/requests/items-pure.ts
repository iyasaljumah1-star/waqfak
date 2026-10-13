/** Deficiency/query register: labels and rules (PURE, client-safe). */
import type { RequestItemKind, RequestItemStatus } from "@/server/db/schema/commerce";

export const ITEM_KIND_LABEL: Record<RequestItemKind, string> = {
  data: "بيانات ناقصة أو غير واضحة",
  document: "مستند ناقص أو غير مقبول",
  question: "استفسار",
  internal: "ملاحظة داخلية",
  technical: "مشكلة تقنية",
};

export const ITEM_STATUS_LABEL: Record<RequestItemStatus, string> = {
  open: "بانتظار العميل",
  answered: "استكمله العميل — قيد المراجعة",
  accepted: "مقبول ومغلق",
  correction_requested: "مطلوب تصحيحه",
  cancelled: "أُلغي",
};

/** Status label in context: an open internal item waits on the team, not the client. */
export function itemStatusLabel(i: { status: string; visibility: string }) {
  if (i.status === "open" && i.visibility === "internal") return "مفتوح لدى الفريق";
  return ITEM_STATUS_LABEL[i.status as RequestItemStatus] ?? i.status;
}

export const ITEM_STATUS_TONE: Record<RequestItemStatus, "warn" | "info" | "ok" | "fine" | "neutral"> = {
  open: "warn", answered: "info", accepted: "ok", correction_requested: "fine", cancelled: "neutral",
};

export const ITEM_EVENT_LABEL: Record<string, string> = {
  raised: "سُجّل", answered: "أجاب العميل", accepted: "قُبل وأُغلق", correction_requested: "طُلب تصحيحه", cancelled: "أُلغي", closed: "أُغلق",
};

type ItemLite = { kind: string; status: string; visibility: string; required: boolean };

/** Waiting on the client: client-visible items that are open or sent back for correction. */
export const awaitingClient = (i: ItemLite) => i.visibility === "client" && (i.status === "open" || i.status === "correction_requested");
/** Waiting on the team: client answers not reviewed yet, and open internal/technical items. */
export const awaitingTeam = (i: ItemLite) => i.status === "answered" || (i.visibility === "internal" && i.status === "open");
/** Still blocking: any required item not accepted or cancelled. */
export const blocking = (i: ItemLite) => i.required && !["accepted", "cancelled"].includes(i.status);

export function itemCounts(items: ItemLite[]) {
  return {
    clientOpen: items.filter(awaitingClient).length,
    clientRequiredOpen: items.filter((i) => awaitingClient(i) && i.required).length,
    awaitingReview: items.filter((i) => i.status === "answered").length,
    blocking: items.filter(blocking).length,
    total: items.length,
  };
}
