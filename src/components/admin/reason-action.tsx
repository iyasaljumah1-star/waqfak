import type { ReactNode } from "react";
import { Field, SubmitButton, Textarea } from "@/components/ui/form";
import type { ActionState } from "@/lib/utils";
import { ActionForm } from "./action-form";

/**
 * A consequential staff action that requires a written reason (saved to the audit log).
 * Rendered collapsed inside <details> so the reason box only appears when the admin chooses the action.
 */
export function ReasonAction({
  id, title, description, action, hidden, submit, variant = "secondary", reasonLabel = "السبب (يُحفظ في سجل العمليات)", reasonName = "reason", open,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  submit: string;
  variant?: "secondary" | "danger" | "primary";
  reasonLabel?: string;
  reasonName?: string;
  open?: boolean;
}) {
  return (
    <details className="group rounded-lg border border-line open:bg-surface-2/50" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-medium">{title}</span>
          {description ? <span className="block text-[13px] text-muted">{description}</span> : null}
        </span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        <ActionForm action={action} hidden={hidden}>
          <Field label={reasonLabel} name={`${reasonName}-${id}`} required>
            <Textarea name={reasonName} id={`${reasonName}-${id}`} className="min-h-20" required minLength={10} maxLength={500} />
          </Field>
          <SubmitButton variant={variant} pendingText="جارٍ التنفيذ…">{submit}</SubmitButton>
        </ActionForm>
      </div>
    </details>
  );
}
