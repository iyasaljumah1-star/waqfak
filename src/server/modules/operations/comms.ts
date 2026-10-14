/**
 * Communications of a request, by channel (PURE): what is waiting and on whom, so nobody has to guess.
 * Channels are kept apart — internal notes, messages with the client, completion requests (deficiencies) and the
 * client's replies, reviewers' notes, approval/rejection decisions, and the automatic history.
 * A reply is never counted as closing a deficiency until the team reviews it.
 */
export type CommsState = "waiting_client" | "needs_review" | "open" | "waiting_approval" | "clear";
export const COMMS_STATE_AR: Record<CommsState, string> = {
  waiting_client: "بانتظار رد العميل", needs_review: "وصل رد يحتاج مراجعتك", open: "مفتوح لدى الفريق", waiting_approval: "بانتظار اعتماد", clear: "لا إجراء مطلوب",
};
export const COMMS_STATE_TONE: Record<CommsState, "warn" | "info" | "fine" | "seal" | "ok"> = {
  waiting_client: "warn", needs_review: "info", open: "fine", waiting_approval: "seal", clear: "ok",
};

export type CommsInput = {
  items: { id: string; seq: number; title: string; kind: string; status: string; visibility: string; required: boolean; fieldKey: string | null; createdAt: Date; answeredAt: Date | null; dueOn: string | null }[];
  notes: { id: string; visibility: string; authorIsStaff: boolean; createdAt: Date }[];
  outputs: { id: string; title: string; status: string; reviewNote: string | null }[];
  quotes: { number: string; status: string; respondedAt: Date | null; responseNote: string | null }[];
  deliverables: { title: string; status: string; revisionNote: string | null; approvedAt: Date | null }[];
};

export type Channel = { key: "requests" | "replies" | "client" | "internal" | "review" | "decisions"; title: string; state: CommsState; count: number; summary: string };

export function commsChannels(x: CommsInput): Channel[] {
  const clientItems = x.items.filter((i) => i.visibility === "client");
  const waiting = clientItems.filter((i) => i.status === "open" || i.status === "correction_requested");
  const answered = x.items.filter((i) => i.status === "answered");
  const internalOpen = x.items.filter((i) => i.visibility === "internal" && i.status === "open");
  const clientNotes = x.notes.filter((n) => n.visibility === "client");
  const lastClient = [...clientNotes].sort((a, b) => +b.createdAt - +a.createdAt)[0];
  const returned = x.outputs.filter((o) => o.status === "returned" && o.reviewNote);
  const inReview = x.outputs.filter((o) => o.status === "in_review");
  const revisions = x.deliverables.filter((d) => d.status === "revision_requested" && d.revisionNote);
  const quoteAsks = x.quotes.filter((q) => q.status === "change_requested");
  const ch: Channel[] = [
    {
      key: "requests", title: "طلبات الاستكمال", count: clientItems.length,
      state: waiting.length ? "waiting_client" : "clear",
      summary: waiting.length ? `${waiting.length} بانتظار العميل${waiting.some((i) => i.required) ? "، منها مطلوب يوقف الطلب" : ""}` : clientItems.length ? "كلها مستوفاة أو مغلقة" : "لا طلبات استكمال",
    },
    {
      key: "replies", title: "الردود الواردة", count: answered.length,
      state: answered.length ? "needs_review" : "clear",
      summary: answered.length ? `${answered.length} رد بانتظار مراجعتك — لا يُعد النقص مستوفى قبل قبوله` : "لا ردود بانتظار المراجعة",
    },
    {
      key: "client", title: "مراسلات العميل", count: clientNotes.length,
      state: lastClient && !lastClient.authorIsStaff ? "needs_review" : "clear",
      summary: lastClient ? (lastClient.authorIsStaff ? "آخر رسالة من الفريق" : "آخر رسالة من العميل ولم يُرد عليها") : "لا رسائل",
    },
    {
      key: "internal", title: "الملاحظات الداخلية", count: x.notes.filter((n) => n.visibility === "internal").length + x.items.filter((i) => i.visibility === "internal").length,
      state: internalOpen.length ? "open" : "clear",
      summary: internalOpen.length ? `${internalOpen.length} بند داخلي مفتوح` : "لا يراها العميل",
    },
    {
      key: "review", title: "ملاحظات المراجعة", count: returned.length + revisions.length + quoteAsks.length,
      state: returned.length || revisions.length || quoteAsks.length ? "open" : inReview.length ? "waiting_approval" : "clear",
      summary: [
        returned.length ? `${returned.length} مخرج أعاده المراجع للتعديل` : "",
        revisions.length ? "طلب العميل تعديل المخرجات" : "",
        quoteAsks.length ? "طلب العميل تعديل العرض" : "",
        !returned.length && !revisions.length && !quoteAsks.length && inReview.length ? `${inReview.length} مخرج بانتظار المراجعة` : "",
      ].filter(Boolean).join("، ") || "لا ملاحظات قائمة",
    },
    {
      key: "decisions", title: "الاعتمادات والرفض", count: x.quotes.filter((q) => q.respondedAt).length + x.deliverables.filter((d) => d.approvedAt).length + x.outputs.filter((o) => o.status === "approved").length,
      state: inReview.length ? "waiting_approval" : "clear",
      summary: inReview.length ? `${inReview.length} مخرج بانتظار الاعتماد` : "سجل القرارات",
    },
  ];
  return ch;
}

/** The single line shown on the section header. */
export function commsHeadline(ch: Channel[]): { state: CommsState; text: string } {
  const order: CommsState[] = ["needs_review", "waiting_client", "open", "waiting_approval"];
  for (const s of order) {
    const c = ch.filter((x) => x.state === s);
    if (c.length) return { state: s, text: c.map((x) => `${x.title}: ${x.summary}`).join(" · ") };
  }
  return { state: "clear", text: "لا إجراء مطلوب في المراسلات" };
}
