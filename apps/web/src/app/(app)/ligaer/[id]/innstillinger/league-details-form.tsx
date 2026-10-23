"use client";

import { useActionState } from "react";

import { type SettingsState, updateLeagueAction } from "@/app/actions/leagues";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";

export function LeagueDetailsForm({
  leagueId,
  name,
  description,
  endDate,
  disabled,
}: {
  leagueId: string;
  name: string;
  description: string;
  endDate: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(updateLeagueAction, {
    status: "idle",
  });
  const errors = state.status === "error" ? state.errors : {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="leagueId" value={leagueId} />
      <fieldset disabled={disabled} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">{t.createLeague.name}</Label>
          <Input id="name" name="name" defaultValue={name} maxLength={60} required />
          {errors["name"] && <FormError message={errors["name"]} />}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="description">{t.createLeague.description}</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={description}
            maxLength={500}
            rows={3}
          />
          {errors["description"] && <FormError message={errors["description"]} />}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="endDate">{t.createLeague.endDate}</Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={endDate}
            className="w-auto"
            required
          />
          {errors["end"] && <FormError message={errors["end"]} />}
        </div>
        {errors["form"] && <FormError message={errors["form"]} />}
        {state.status === "saved" && <p className="text-positive text-sm">{t.settings.saved}</p>}
        <SubmitButton>{t.settings.saveDetails}</SubmitButton>
      </fieldset>
    </form>
  );
}
