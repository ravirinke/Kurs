"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/** A submit button that disables itself while its form's server action runs. */
export function SubmitButton({
  children,
  pendingText,
  ...props
}: { children: ReactNode; pendingText?: string } & Omit<ComponentProps<typeof Button>, "type">) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
