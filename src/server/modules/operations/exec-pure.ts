/**
 * Request execution tasks (PURE): which tasks a request gets, who may act on them, and which actions each state allows.
 * Tasks mirror the request's real work units — workflow stages and service outputs — so completing a task moves the
 * linked record (stage, output) and vice versa; see ./exec.ts for the synchronization rules.
 */
export type ExecKind = "intake" | "stage" | "prepare_output" | "review_output";
export type TaskAction = "start" | "complete" | "return" | "cancel" | "reopen" | "assign";

export const EXEC_KIND_LABEL: Record<ExecKind, string> = {
  intake: "مراجعة الاكتمال والقبول",
  stage: "مرحلة عمل",
  prepare_output: "إعداد مخرج",
  review_output: "مراجعة واعتماد مخرج",
};
export const TASK_ACTION_LABEL: Record<TaskAction, string> = {
  start: "ابدأ التنفيذ", complete: "أكمل المهمة", return: "أعدها للاستكمال", cancel: "ألغِ المهمة", reopen: "أعد فتحها", assign: "أسند المهمة",
};
export const TASK_EVENT_LABEL: Record<string, string> = {
  create: "أُنشئت", start: "بدأ التنفيذ", complete: "أُكملت", return: "أُعيدت للاستكمال", cancel: "أُلغيت", reopen: "أُعيد فتحها", assign: "أُسندت",
  note: "ملاحظة", attach: "أُرفق مستند", output: "مخرج",
};

type StageDef = { key: string; name: string; role: string; clientApproval?: boolean };

/** Work stages = after the first (intake) stage and before quality review / client approval (same rule as planStages). */
export function workStages(defs: StageDef[]): StageDef[] {
  const q = defs.findIndex((s) => s.role === "quality");
  const c = defs.findIndex((s) => !!s.clientApproval || s.role === "client");
  const end = q >= 0 ? q - 1 : c > 0 ? c - 1 : defs.length - 1;
  return defs.slice(1, end + 1);
}

export type PlannedTask = { kind: ExecKind; stageKey: string | null; outputKey: string | null; title: string };

export function intakeTask(): PlannedTask {
  return { kind: "intake", stageKey: null, outputKey: null, title: "مراجعة اكتمال الطلب ومستنداته وقبوله للخدمة" };
}

/** Execution tasks created when work starts: one per work stage, and a prepare + review pair per service output. */
export function planExecTasks(defs: StageDef[], outputs: { key: string; title: string }[]): PlannedTask[] {
  return [
    ...workStages(defs).map((s) => ({ kind: "stage" as const, stageKey: s.key, outputKey: null, title: s.name })),
    ...outputs.flatMap((o) => [
      { kind: "prepare_output" as const, stageKey: null, outputKey: o.key, title: `إعداد مسودة: ${o.title}` },
      { kind: "review_output" as const, stageKey: null, outputKey: o.key, title: `مراجعة واعتماد: ${o.title}` },
    ]),
  ];
}

/**
 * Who may execute a request task. An authorized manager (admin.requests.all) executes any task directly, with no
 * assignment needed; otherwise the task's assignee or the request's assignee (staff.requests.assigned).
 */
export function executeRight(p: { isStaff: boolean; perms: ReadonlySet<string> | string[]; userId: string; taskAssignee: string | null; requestAssignee: string | null }) {
  const has = (x: string) => (Array.isArray(p.perms) ? p.perms.includes(x) : (p.perms as ReadonlySet<string>).has(x));
  if (!p.isStaff) return { can: false, manager: false, direct: false };
  const manager = has("admin.requests.all");
  const own = p.userId === p.taskAssignee || (p.userId === p.requestAssignee && has("staff.requests.assigned"));
  const can = manager || own;
  return { can, manager, direct: can && p.userId !== p.taskAssignee };
}

/** Actions offered for a task, by its state and kind and the caller's right. Output tasks move with their output. */
export function taskActions(t: { status: string; kind: string | null }, right: { can: boolean; manager: boolean }): TaskAction[] {
  if (!right.can) return [];
  const a: TaskAction[] = [];
  const auto = t.kind === "review_output"; // completed by approving the output
  if (t.status === "todo") a.push("start");
  if ((t.status === "todo" || t.status === "in_progress") && !auto) a.push("complete");
  if (t.status === "in_progress") a.push("return");
  if ((t.status === "todo" || t.status === "in_progress") && right.manager) a.push("cancel", "assign");
  if ((t.status === "done" || t.status === "cancelled") && right.manager) a.push("reopen");
  return a;
}

/** Status after an action (null = not allowed from that status). */
export function nextTaskStatus(status: string, action: TaskAction): string | null {
  switch (action) {
    case "start": return status === "todo" ? "in_progress" : null;
    case "complete": return status === "todo" || status === "in_progress" ? "done" : null;
    case "return": return status === "in_progress" || status === "done" ? "todo" : null;
    case "cancel": return status === "todo" || status === "in_progress" ? "cancelled" : null;
    case "reopen": return status === "done" || status === "cancelled" ? "todo" : null;
    case "assign": return status === "todo" || status === "in_progress" ? status : null;
  }
}
