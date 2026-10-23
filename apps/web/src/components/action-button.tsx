"use client";

import { useTransition, type ComponentProps, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "./ui/button";

/**
 * A button that runs a server action with some hidden fields and shows its message as a
 * toast. Optional confirmation before it runs (for things that cannot be undone).
 */
export function ActionButton({
  action,
  fields,
  confirm,
  children,
  ...props
}: {
  action: (form: FormData) => Promise<{ ok: boolean; message: string } | undefined>;
  fields: Record<string, string>;
  confirm?: string;
  children: ReactNode;
} & Omit<ComponentProps<typeof Button>, "onClick" | "action">) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      {...props}
      disabled={pending || props.disabled}
      aria-busy={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        const form = new FormData();
        for (const [name, value] of Object.entries(fields)) form.set(name, value);
        startTransition(async () => {
          const result = await action(form);
          if (result) (result.ok ? toast.success : toast.error)(result.message);
        });
      }}
    >
      {children}
    </Button>
  );
}
