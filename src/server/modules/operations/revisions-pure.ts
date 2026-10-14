/**
 * Going back to an earlier point of a request (PURE rules). Going back never erases: approvals, sent quotes, signed
 * contracts and issued invoices stay in the record, and the impact list says what must be redone or corrected and by
 * which path (new output version, amendment quote/contract, credit note) instead of an uncontrolled undo.
 */
import type { RevisionImpact } from "@/server/db/schema/operations";

export type RollbackTarget = "intake" | "scope" | "execution" | `stage:${string}`;
export type RollbackOption = { target: RollbackTarget; label: string; detail: string; opsOnly: boolean };

export type ImpactInput = {
  outputs: { id: string; title: string; status: string }[];
  quotes: { id: string; number: string; status: string; kind: string }[];
  contracts: { id: string; number: string; status: string }[];
  invoices: { id: string; number: string; status: string; kind: string }[];
  verified: boolean;
  accepted: boolean;
};

/** What a correction affects, with the controlled path for each record. */
export function revisionImpact(x: ImpactInput, kind: "intake_edit" | RollbackTarget): RevisionImpact {
  const out: RevisionImpact = [];
  for (const o of x.outputs) {
    if (o.status === "approved") out.push({ kind: "output", id: o.id, label: `المخرج «${o.title}» معتمد على البيانات السابقة`, action: "افتح مراجعة جديدة له وأعد توليده؛ يبقى الاعتماد السابق في سجل النسخ" });
    else if (o.status === "in_review") out.push({ kind: "output", id: o.id, label: `المخرج «${o.title}» بانتظار المراجعة`, action: "أعده للتعديل ثم أعد توليده من البيانات المصححة" });
    else out.push({ kind: "output", id: o.id, label: `مسودة «${o.title}»`, action: "أعد توليدها؛ تبقى تعديلات المختص" });
  }
  const sentQuotes = x.quotes.filter((q) => ["sent", "accepted"].includes(q.status));
  for (const q of sentQuotes) out.push({ kind: "quote", id: q.id, label: `العرض ${q.number} ${q.status === "accepted" ? "مقبول" : "مرسل"}`, action: q.status === "accepted" ? "إن تغيّر النطاق أو السعر: ملحق تعديل بعرض جديد يقبله العميل" : "اسحبه وأرسل نسخة جديدة إن تغيّر النطاق" });
  for (const k of x.contracts.filter((k) => ["sent", "partially_signed", "signed"].includes(k.status))) out.push({ kind: "contract", id: k.id, label: `العقد ${k.number} ${k.status === "signed" ? "نافذ" : "قيد التوقيع"}`, action: k.status === "signed" ? "لا يُعدّل: ملحق تعديل يوقّعه الأطراف" : "يُلغى قبل نفاذه ويُعاد إعداده إن تغيّرت الأطراف أو النطاق" });
  for (const i of x.invoices.filter((i) => i.kind !== "credit_note" && i.status !== "void")) {
    if (["draft", "approved"].includes(i.status)) out.push({ kind: "invoice", id: i.id, label: `الفاتورة ${i.number} لم تُرسل`, action: "تُصحح المسودة أو تُسحب قبل الإرسال" });
    else out.push({ kind: "invoice", id: i.id, label: `الفاتورة ${i.number} صادرة`, action: "لا تُعدّل: تُلغى أو يصدر إشعار دائن من المالية إن لزم" });
  }
  if (kind === "intake_edit" || kind === "intake") {
    if (x.verified) out.push({ kind: "verification", label: "التحقق من البيانات سُجّل قبل التصحيح", action: kind === "intake" ? "يُلغى التحقق ويُعاد" : "راجع أن التصحيح لا يغيّر ما تحققت منه" });
    if (x.accepted && kind === "intake") out.push({ kind: "acceptance", label: "قبول الطلب للخدمة", action: "يُعاد القبول بعد التحقق" });
  }
  return out;
}

/** Points a request can go back to, by its status and stages (stage keys of the work stages done or active). */
export function rollbackOptions(p: { status: string; hasSentQuote: boolean; workStages: { key: string; name: string; status: string }[] }): RollbackOption[] {
  const o: RollbackOption[] = [];
  if (["triage", "awaiting_client"].includes(p.status) && !p.hasSentQuote)
    o.push({ target: "intake", label: "مراجعة البيانات والتحقق من جديد", detail: "يُلغى تسجيل التحقق والقبول ليعاد بعد التصحيح", opsOnly: false });
  if (p.status === "quote") o.push({ target: "scope", label: "إعادة دراسة النطاق والعرض", detail: "يعود الطلب للفرز؛ العرض المرسل يُسحب أو يُستبدل بنسخة جديدة", opsOnly: false });
  if (["quality_review", "awaiting_client_approval"].includes(p.status))
    o.push({ target: "execution", label: "إعادة الطلب للتنفيذ للتصحيح", detail: p.status === "awaiting_client_approval" ? "يُسحب ما أُرسل للعميل ويُعلَّم «مطلوب تعديله»، ويُبلَّغ العميل" : "يعود من مراجعة الجودة إلى التنفيذ", opsOnly: p.status === "awaiting_client_approval" });
  if (p.status === "in_progress") {
    const active = p.workStages.findIndex((s) => s.status === "active");
    p.workStages.forEach((s, i) => {
      if (i < active && s.status === "done") o.push({ target: `stage:${s.key}`, label: `إعادة فتح مرحلة «${s.name}»`, detail: "تصبح المرحلة نشطة، وما بعدها لم يبدأ؛ وتُعاد مهمتها", opsOnly: false });
    });
  }
  return o;
}

/** Statuses of the work stages after reopening `key` (earlier done, target active, later pending). */
export function reopenStagePlan(stages: { key: string; status: string }[], key: string): string[] | null {
  const i = stages.findIndex((s) => s.key === key);
  const a = stages.findIndex((s) => s.status === "active");
  if (i < 0 || a < 0 || i >= a || stages[i].status !== "done") return null;
  return stages.map((s, j) => (j < i ? s.status : j === i ? "active" : j <= a ? "pending" : s.status));
}
