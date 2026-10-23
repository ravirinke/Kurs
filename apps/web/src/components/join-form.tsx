"use client";

import { useActionState } from "react";

import { joinByCodeAction, type JoinState } from "@/app/actions/leagues";
import { t } from "@/i18n";

import { FormError } from "./form-error";
import { SubmitButton } from "./submit-button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** With `code` set, the code is fixed (invite link page) and only the button is shown. */
export function JoinForm({ code, submitLabel }: { code?: string; submitLabel: string }) {
  const [state, action] = useActionState<JoinState, FormData>(joinByCodeAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-4">
      {code ? (
        <input type="hidden" name="code" value={code} />
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">{t.join.code}</Label>
          <Input
            id="code"
            name="code"
            placeholder={t.join.codePlaceholder}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono text-lg tracking-widest uppercase"
            maxLength={12}
            required
          />
        </div>
      )}
      {state.status === "error" && <FormError message={state.message} />}
      <SubmitButton size="lg">{submitLabel}</SubmitButton>
    </form>
  );
}
