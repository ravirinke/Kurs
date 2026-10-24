"use client";

import { CURRENCIES } from "@aksjeliga/core";
import { useActionState } from "react";

import { type DevFormState, runJobsNow, simulateDividend, simulateSplit } from "@/app/actions/dev";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

const text = t.profile.simulate;
const SELECT = "border-input bg-background h-9 rounded-md border px-3 text-sm";

export interface DevInstrument {
  id: string;
  label: string;
}

function Result({ state }: { state: DevFormState }) {
  if (state.status === "error") return <FormError message={state.message} />;
  if (state.status === "done") return <p className="text-positive text-sm">{state.message}</p>;
  return null;
}

function InstrumentSelect({ id, instruments }: { id: string; instruments: DevInstrument[] }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{text.instrument}</Label>
      <select id={id} name="instrumentId" className={SELECT} required>
        {instruments.map((instrument) => (
          <option key={instrument.id} value={instrument.id}>
            {instrument.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({
  id,
  label,
  ...props
}: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  );
}

export function SimulateSplitForm({
  instruments,
  today,
}: {
  instruments: DevInstrument[];
  today: string;
}) {
  const [state, action] = useActionState(simulateSplit, { status: "idle" } as DevFormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <h3 className="font-semibold">{text.split}</h3>
      <InstrumentSelect id="split-instrument" instruments={instruments} />
      <Field
        id="effectiveDate"
        name="effectiveDate"
        label={text.effectiveDate}
        type="date"
        defaultValue={today}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="ratioFrom"
          name="ratioFrom"
          label={text.ratioFrom}
          defaultValue="1"
          inputMode="decimal"
          required
        />
        <Field
          id="ratioTo"
          name="ratioTo"
          label={text.ratioTo}
          defaultValue="10"
          inputMode="decimal"
          required
        />
      </div>
      <p className="text-muted-foreground text-xs">{text.ratioHint}</p>
      <Result state={state} />
      <SubmitButton variant="secondary">{text.addSplit}</SubmitButton>
    </form>
  );
}

export function SimulateDividendForm({
  instruments,
  today,
}: {
  instruments: DevInstrument[];
  today: string;
}) {
  const [state, action] = useActionState(simulateDividend, { status: "idle" } as DevFormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <h3 className="font-semibold">{text.dividend}</h3>
      <InstrumentSelect id="dividend-instrument" instruments={instruments} />
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="exDate"
          name="exDate"
          label={text.exDate}
          type="date"
          defaultValue={today}
          required
        />
        <Field
          id="payDate"
          name="payDate"
          label={text.payDate}
          type="date"
          defaultValue={today}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="amountPerShare"
          name="amountPerShare"
          label={text.amountPerShare}
          inputMode="decimal"
          defaultValue="2,50"
          required
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="dividend-currency">{text.currency}</Label>
          <select id="dividend-currency" name="currency" className={SELECT} defaultValue="USD">
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Result state={state} />
      <SubmitButton variant="secondary">{text.addDividend}</SubmitButton>
    </form>
  );
}

export function RunJobsForm() {
  const [state, action] = useActionState(runJobsNow, { status: "idle" } as DevFormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Result state={state} />
      <SubmitButton variant="secondary" pendingText={t.profile.jobs.running}>
        {t.profile.jobs.run}
      </SubmitButton>
    </form>
  );
}
