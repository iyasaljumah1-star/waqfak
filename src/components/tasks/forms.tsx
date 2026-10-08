"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { Checkbox, Field, FormMessage, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { cn, initialState } from "@/lib/utils";
import { addChecklistItem, addTaskComment, createTask, editTask, setTaskStatus, toggleChecklist } from "@/server/modules/tasks/actions";

type Opt = { value: string; label: string };
const PRIORITY: Opt[] = [{ value: "urgent", label: "عاجلة" }, { value: "high", label: "عالية" }, { value: "normal", label: "عادية" }, { value: "low", label: "منخفضة" }];

export function NewTaskForm({ waqfId, members, staff }: { waqfId: string; members: Opt[]; staff: boolean }) {
  const [state, run] = useActionState(createTask, initialState);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={run} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="waqfId" value={waqfId} />
      <Field label="عنوان المهمة" name="title" error={fe.title} required className="md:col-span-2">
        <Input name="title" maxLength={200} required />
      </Field>
      <Field label="الوصف" name="description" className="md:col-span-2">
        <Textarea name="description" maxLength={4000} className="min-h-20" />
      </Field>
      <Field label="المكلّف" name="assigneeUserId">
        <Select name="assigneeUserId" defaultValue="" placeholder="بدون تكليف" options={members} />
      </Field>
      <Field label="الموعد النهائي" name="dueOn" error={fe.dueOn}>
        <Input name="dueOn" type="date" dir="ltr" className="text-start" />
      </Field>
      <Field label="الأولوية" name="priority">
        <Select name="priority" defaultValue="normal" options={PRIORITY} />
      </Field>
      <Field label="الظهور" name="visibility" hint={staff ? "الداخلية لا تظهر لأطراف الوقف إلا للمكلّف." : undefined}>
        <Select name="visibility" defaultValue="shared" options={staff ? [{ value: "shared", label: "مشتركة مع أطراف الوقف" }, { value: "internal", label: "داخلية لفريق وقفك" }] : [{ value: "shared", label: "مشتركة مع أطراف الوقف" }]} />
      </Field>
      <Field label="قائمة التحقق" name="checklist" className="md:col-span-2" hint="سطر لكل بند (اختياري). يُحسب التقدم من البنود المنجزة.">
        <Textarea name="checklist" className="min-h-20" />
      </Field>
      <div className="space-y-2 md:col-span-2">
        <FormMessage state={state} />
        <SubmitButton pendingText="جارٍ الإضافة…">أضف المهمة</SubmitButton>
      </div>
    </form>
  );
}

export function StatusForm({ taskId, status, progress, hasChecklist, canCancel }: { taskId: string; status: string; progress: number; hasChecklist: boolean; canCancel: boolean }) {
  const [state, run] = useActionState(setTaskStatus, initialState);
  const opts: Opt[] = [{ value: "todo", label: "للتنفيذ" }, { value: "in_progress", label: "قيد التنفيذ" }, { value: "done", label: "منجزة" }, ...(canCancel ? [{ value: "cancelled", label: "ملغاة" }] : [])];
  const p = taskId.slice(0, 8);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="الحالة" name={`status-${p}`}>
          <Select id={`status-${p}`} name="status" defaultValue={status} options={opts} className="h-10 w-40" />
        </Field>
        {!hasChecklist ? (
          <Field label="نسبة الإنجاز" name={`progress-${p}`}>
            <Input id={`progress-${p}`} name="progress" type="number" min={0} max={100} defaultValue={progress} dir="ltr" className="h-10 w-24 text-start" />
          </Field>
        ) : null}
        <SubmitButton size="sm" variant="secondary" pendingText="…" className="h-10">حدّث</SubmitButton>
      </div>
      {state.data?.needForce ? <Checkbox name="force" label="أغلق المهمة رغم البنود غير المنجزة" /> : null}
      <FormMessage state={state} />
    </form>
  );
}

export function ChecklistToggle({ taskId, index, text, done, disabled }: { taskId: string; index: number; text: string; done: boolean; disabled: boolean }) {
  const [state, run] = useActionState(toggleChecklist, initialState);
  return (
    <form action={run}>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="index" value={index} />
      <button type="submit" disabled={disabled} aria-pressed={done} className="flex w-full items-start gap-3 rounded-md px-1 py-1.5 text-start hover:bg-surface-2 disabled:hover:bg-transparent">
        <span aria-hidden className={cn("mt-1 flex size-5 shrink-0 items-center justify-center rounded border", done ? "border-ok bg-ok text-white" : "border-line-strong bg-surface")}>
          {done ? <Check className="size-3.5" /> : null}
        </span>
        <span className={cn("text-[15px]", done && "text-muted line-through")}>{text}</span>
      </button>
      {state.error ? <p role="alert" className="text-[13px] text-critical">{state.error}</p> : null}
    </form>
  );
}

export function ChecklistAddForm({ taskId }: { taskId: string }) {
  const [state, run] = useActionState(addChecklistItem, initialState);
  return (
    <form action={run} className="flex gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <label htmlFor="cl-text" className="sr-only">بند جديد</label>
      <Input name="text" id="cl-text" placeholder="بند جديد" maxLength={300} className="h-10" />
      <SubmitButton size="sm" variant="secondary" pendingText="…" className="h-10">أضف</SubmitButton>
      {state.error ? <p role="alert" className="text-[13px] text-critical">{state.error}</p> : null}
    </form>
  );
}

export function EditTaskForm({ task, members, staff }: { task: { id: string; assigneeUserId: string | null; dueOn: string | null; priority: string; visibility: string }; members: Opt[]; staff: boolean }) {
  const [state, run] = useActionState(editTask, initialState);
  return (
    <form action={run} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="taskId" value={task.id} />
      <Field label="المكلّف" name="assigneeUserId">
        <Select name="assigneeUserId" defaultValue={task.assigneeUserId ?? ""} placeholder="بدون تكليف" options={members} />
      </Field>
      <Field label="الموعد النهائي" name="dueOn" error={state.fieldErrors?.dueOn}>
        <Input name="dueOn" type="date" defaultValue={task.dueOn ?? ""} dir="ltr" className="text-start" />
      </Field>
      <Field label="الأولوية" name="priority">
        <Select name="priority" defaultValue={task.priority} options={PRIORITY} />
      </Field>
      <Field label="الظهور" name="visibility">
        <Select name="visibility" defaultValue={task.visibility} options={staff || task.visibility === "internal" ? [{ value: "shared", label: "مشتركة" }, { value: "internal", label: "داخلية لفريق وقفك" }] : [{ value: "shared", label: "مشتركة" }]} />
      </Field>
      <div className="space-y-2 sm:col-span-2">
        <FormMessage state={state} />
        <SubmitButton size="sm" variant="secondary" pendingText="جارٍ الحفظ…">احفظ التعديل</SubmitButton>
      </div>
    </form>
  );
}

export function CommentForm({ taskId }: { taskId: string }) {
  const [state, run] = useActionState(addTaskComment, initialState);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <Field label="تعليق" name="body" error={state.fieldErrors?.body}>
        <Textarea name="body" maxLength={4000} className="min-h-20" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="sm" pendingText="جارٍ الإرسال…">أضف التعليق</SubmitButton>
    </form>
  );
}
