import { Badge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import type { FileReview } from "@/server/modules/waqf-core/file-review";
import { FileReviewForm } from "./file-review-form";

const KEY_AR: Record<string, string> = {
  name: "الاسم", title: "العنوان", displayName: "الاسم", literalText: "نص الشرط", category: "التصنيف", clauseRef: "رقم البند", tier: "الطبقة",
  sharePct: "النسبة", criteria: "الوصف والضوابط", divisionRule: "طريقة القسمة", kind: "النوع", role: "الصفة", personName: "الاسم", capacity: "الصفة",
  ownershipDocNo: "رقم مستند الملكية", marketValue: "القيمة", subject: "محل الأصل", status: "الحالة", isChair: "رئيس", startsOn: "من", endsOn: "إلى",
  deedNo: "رقم الصك", nationalUnifiedNumber: "الرقم الموحد", legalType: "نوع الوقف", text: "النص", body: "النص", percent: "النسبة",
};
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 120));

/** What changed in one audited change: the fields whose value differs, before → after. */
function diff(before: unknown, after: unknown) {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !/(^id$|Id$|At$|By$)/.test(k) && JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null));
  return keys.slice(0, 6).map((k) => ({ k: KEY_AR[k] ?? k, before: show(b[k]), after: show(a[k]) }));
}

/**
 * Changes to the waqf's file that need (or had) the team's review. Saved data is the file's data; this list says which
 * changes are still to be reviewed, why, and what they were.
 */
export function FileReviews({ reviews, waqfId, canReview, viewerId, staffView = false }: { reviews: FileReview[]; waqfId: string; canReview: boolean; viewerId: string; staffView?: boolean }) {
  if (!reviews.length) return null;
  const open = reviews.filter((r) => r.status === "todo" || r.status === "in_progress");
  return (
    <section id="file-reviews" aria-labelledby="file-reviews-h" className="rounded-lg border border-line bg-surface" data-testid="file-reviews">
      <div className="border-b border-line px-4 py-3 md:px-5">
        <h2 id="file-reviews-h" className="font-semibold">تعديلات ملف الوقف ومراجعتها</h2>
        <p className="text-[13px] text-muted">
          {open.length ? `${open.length} تعديل محفوظ بانتظار مراجعة الفريق.` : "لا تعديلات بانتظار المراجعة."} القيمة السابقة لكل تعديل محفوظة في سجل التدقيق، والمخرجات المعتمدة لا تتغير.
        </p>
      </div>
      <ul className="divide-y divide-line">
        {reviews.map((r) => {
          const pending = r.status === "todo" || r.status === "in_progress";
          return (
            <li key={r.id} className="space-y-2 px-4 py-3 md:px-5" data-testid={`file-review-${r.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={pending ? "fine" : r.note?.startsWith("يحتاج") ? "warn" : "ok"} icon={false}>{pending ? "بانتظار المراجعة" : r.note?.startsWith("يحتاج") ? "يحتاج تصحيحًا" : "اعتُمد"}</Badge>
                <span className="font-medium">{r.title.replace(/^مراجعة تعديل على ملف الوقف: /, "")}</span>
              </div>
              <p className="text-[13px] text-muted">
                عدّله {r.createdByStaff && !staffView ? "فريق «وقفك»" : r.createdByName ?? "—"} في {fmtDate(r.createdAt)}
                {!pending ? ` · رُوجع في ${fmtDate(r.completedAt)}${staffView && r.completedByName ? ` (${r.completedByName})` : ""}` : ""}
              </p>
              {r.description?.split("\n").find((l) => l.startsWith("السبب:")) ? <p className="text-[13px]">{r.description.split("\n").find((l) => l.startsWith("السبب:"))}</p> : null}
              {r.changes.length ? (
                <ul className="space-y-1 text-[13px]">
                  {r.changes.map((c) => {
                    const d = diff(c.before, c.after);
                    return (
                      <li key={c.id}>
                        <span className="text-muted">{c.section}</span>
                        {d.length ? <ul className="ms-4 list-disc">{d.map((x) => <li key={x.k}>{x.k}: <span className="text-muted line-through">{x.before}</span> ← {x.after}</li>)}</ul> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {!pending && r.note ? <p className="text-[13px]">نتيجة المراجعة: {r.note}</p> : null}
              {pending && canReview && r.createdBy !== viewerId ? <FileReviewForm taskId={r.id} waqfId={waqfId} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
