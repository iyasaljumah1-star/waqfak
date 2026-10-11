/** Pure task helpers (shared by server pages and tests). */

export type ChecklistItem = { text: string; done: boolean };
export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "cancelled"];
export const TASK_STATUS_AR: Record<string, string> = { todo: "للتنفيذ", in_progress: "قيد التنفيذ", done: "منجزة", cancelled: "ملغاة" };
export const TASK_PRIORITY_AR: Record<string, string> = { urgent: "عاجلة", high: "عالية", normal: "عادية", low: "منخفضة" };
export const TASK_SOURCE_AR: Record<string, string> = { manual: "يدوية", request: "طلب خدمة", resolution: "قرار مجلس", compliance: "امتثال", assessment: "تقييم", nazara: "النظارة الاعتبارية" };
export const VISIBILITY_AR: Record<string, string> = { shared: "مشتركة مع أطراف الوقف", internal: "داخلية لفريق وقفك" };

/** Progress follows the checklist when there is one; otherwise it follows the status (with manual progress in between). */
export function computeProgress(status: string, checklist: ChecklistItem[], manual = 0): number {
  if (status === "done") return 100;
  if (checklist.length) return Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100);
  if (status === "todo") return 0;
  return Math.max(0, Math.min(99, Math.round(manual)));
}

export function isOverdue(dueOn: string | null, status: string, today: string): boolean {
  return !!dueOn && dueOn < today && (status === "todo" || status === "in_progress");
}

/** Who can see a task: shared tasks are visible to every waqf member; internal tasks to Waqfak staff, the creator and the assignee. */
export function canSeeTask(t: { visibility: string; createdBy: string | null; assigneeUserId: string | null }, me: { id: string; isStaff: boolean }) {
  return t.visibility !== "internal" || me.isStaff || t.createdBy === me.id || t.assigneeUserId === me.id;
}

export type DueBucket = "overdue" | "week" | "later" | "none" | "closed";
export const BUCKET_AR: Record<DueBucket, string> = { overdue: "متأخرة", week: "خلال 7 أيام", later: "لاحقًا", none: "بلا موعد", closed: "منجزة أو ملغاة" };

export function dueBucket(dueOn: string | null, status: string, today: string): DueBucket {
  if (status === "done" || status === "cancelled") return "closed";
  if (!dueOn) return "none";
  if (dueOn < today) return "overdue";
  const d = (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return d <= 7 ? "week" : "later";
}

export function sanitizeChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is { text: unknown; done: unknown } => !!x && typeof x === "object")
    .map((x) => ({ text: String(x.text ?? "").trim().slice(0, 300), done: x.done === true }))
    .filter((x) => x.text)
    .slice(0, 50);
}
