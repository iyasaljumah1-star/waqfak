import type { ComponentProps } from "react";
import { ButtonLink } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * ButtonLink with readable text on filled variants. globals.css sets an unlayered `a { color: inherit }`, which beats
 * Tailwind's layered `text-white` on links (reported to the integrator); this restores the intended foreground.
 */
export function ActionLink({ variant = "primary", className, ...p }: ComponentProps<typeof ButtonLink>) {
  const fix =
    variant === "primary" || variant === "danger" || variant === "seal"
      ? variant === "primary"
        ? "!text-white dark:!text-[#0f141c]"
        : variant === "danger"
          ? "!text-white dark:!text-[#1a0b0a]"
          : "!text-white dark:!text-[#1d160a]"
      : "";
  return <ButtonLink variant={variant} className={cn(fix, className)} {...p} />;
}
