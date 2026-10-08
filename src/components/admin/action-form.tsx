"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { FormMessage } from "@/components/ui/form";
import { cn, type ActionState } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** When fields are composed on the server they cannot read `fieldErrors`, so the messages are listed with the error. */
function Message({ state, detailed }: { state: ActionState; detailed: boolean }) {
  const fe = detailed && state.error ? Object.values(state.fieldErrors ?? {}).filter(Boolean) : [];
  if (!fe.length) return <FormMessage state={state} />;
  return (
    <div role="alert" className="rounded-md bg-critical-soft px-3 py-2 text-[15px] text-critical">
      <ul className="list-inside list-disc space-y-0.5">
        {fe.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Form bound to a server action through useActionState. `children` may be a render function receiving the latest
 * state, so fields can show `fieldErrors`. Hidden inputs carry ids.
 */
export function ActionForm({
  action, children, hidden, className, resetOnSuccess, messagePosition = "top",
}: {
  action: Action;
  children: ReactNode | ((s: ActionState) => ReactNode);
  hidden?: Record<string, string>;
  className?: string;
  resetOnSuccess?: boolean;
  messagePosition?: "top" | "bottom";
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={cn("space-y-4", className)} noValidate>
      {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      {messagePosition === "top" ? <Message state={state} detailed={typeof children !== "function"} /> : null}
      {typeof children === "function" ? children(state) : children}
      {messagePosition === "bottom" ? <Message state={state} detailed={typeof children !== "function"} /> : null}
    </form>
  );
}
