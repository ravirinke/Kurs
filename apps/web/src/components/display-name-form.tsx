"use client";

import { useActionState } from "react";

import { type FormState, saveDisplayName } from "@/app/actions/profile";
import { t } from "@/i18n";

import { FormError } from "./form-error";
import { SubmitButton } from "./submit-button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function DisplayNameForm({
  defaultName,
  next,
  submitLabel,
}: {
  defaultName: string;
  next?: string;
  submitLabel: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveDisplayName, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="neste" value={next} />}
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">{t.welcome.name}</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={defaultName}
          maxLength={30}
          autoComplete="nickname"
          required
        />
      </div>
      {state.status === "error" && <FormError message={state.message} />}
      {state.status === "saved" && <p className="text-positive text-sm">{t.profile.saved}</p>}
      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
