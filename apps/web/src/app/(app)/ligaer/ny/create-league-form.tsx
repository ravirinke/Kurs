"use client";

import {
  APP_TIME_ZONE,
  type Currency,
  type Exchange,
  LEAGUE_CURRENCIES,
  suggestEndTime,
  suggestStartTime,
  type Visibility,
} from "@aksjeliga/core";
import { ChevronDown } from "lucide-react";
import { DateTime } from "luxon";
import { useActionState, useMemo, useState } from "react";

import { createLeagueAction, type CreateLeagueState } from "@/app/actions/leagues";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { currencyLabel, formatLongDateTime } from "@/lib/format";

const VISIBILITIES: readonly Visibility[] = ["delayed", "open", "hidden"];

function FieldError({ message }: { message: string | undefined }) {
  return message ? <FormError message={message} /> : null;
}

/** "100000" → "100 000" for the input field. */
function groupThousands(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function CreateLeagueForm({
  nowIso,
  exchanges,
  defaultStartAmounts,
  defaultFeeMinimums,
  defaultEndDate,
}: {
  nowIso: string;
  exchanges: Exchange[];
  defaultStartAmounts: Readonly<Record<Currency, string>>;
  defaultFeeMinimums: Readonly<Record<Currency, string>>;
  defaultEndDate: string;
}) {
  const [state, action] = useActionState<CreateLeagueState, FormData>(createLeagueAction, {
    status: "idle",
  });
  const errors = state.status === "error" ? state.errors : {};
  const now = useMemo(() => DateTime.fromISO(nowIso), [nowIso]);

  const [currency, setCurrency] = useState<Currency>("NOK");
  const [startAmount, setStartAmount] = useState(groupThousands(defaultStartAmounts.NOK));
  const [feeMinimum, setFeeMinimum] = useState(defaultFeeMinimums.NOK);
  const [selected, setSelected] = useState<string[]>(exchanges.map((exchange) => exchange.id));
  const [startMode, setStartMode] = useState<"next" | "now" | "custom">("next");
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [maxShareEnabled, setMaxShareEnabled] = useState(false);
  const [showMore, setShowMore] = useState(
    Boolean(errors["exchanges"] ?? errors["fee"] ?? errors["maxShare"]),
  );

  const chosen = exchanges.filter((exchange) => selected.includes(exchange.id));
  const nextOpen = suggestStartTime(chosen, now);
  const endTime = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ? suggestEndTime(endDate, APP_TIME_ZONE, chosen)
    : null;

  function changeCurrency(next: Currency) {
    // Keep the user's own amount; only replace our suggestion.
    if (startAmount === groupThousands(defaultStartAmounts[currency]))
      setStartAmount(groupThousands(defaultStartAmounts[next]));
    if (feeMinimum === defaultFeeMinimums[currency]) setFeeMinimum(defaultFeeMinimums[next]);
    setCurrency(next);
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t.createLeague.name}</Label>
            <Input
              id="name"
              name="name"
              placeholder={t.createLeague.namePlaceholder}
              maxLength={60}
              required
            />
            <FieldError message={errors["name"]} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">{t.createLeague.description}</Label>
            <Textarea
              id="description"
              name="description"
              placeholder={t.createLeague.descriptionPlaceholder}
              maxLength={500}
              rows={2}
            />
            <FieldError message={errors["description"]} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="currency">{t.createLeague.currency}</Label>
              <select
                id="currency"
                name="currency"
                value={currency}
                onChange={(event) => changeCurrency(event.target.value as Currency)}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              >
                {LEAGUE_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="startAmount">{t.createLeague.startAmount}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="startAmount"
                  name="startAmount"
                  inputMode="decimal"
                  value={startAmount}
                  onChange={(event) => setStartAmount(event.target.value)}
                  required
                />
                <span className="text-muted-foreground text-sm">{currencyLabel(currency)}</span>
              </div>
            </div>
          </div>
          <p className="text-muted-foreground -mt-3 text-xs">
            {t.createLeague.currencyHint} {t.createLeague.startAmountHint}
          </p>
          <FieldError message={errors["currency"] ?? errors["startAmount"]} />

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t.createLeague.start}</legend>
            <RadioGroup
              name="startMode"
              value={startMode}
              onValueChange={(value) => setStartMode(value as typeof startMode)}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="next" />{" "}
                {t.createLeague.startNextOpen(formatLongDateTime(nextOpen))}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="now" /> {t.createLeague.startNow}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="custom" /> {t.createLeague.startCustom}
              </label>
            </RadioGroup>
            {startMode === "custom" && (
              <Input
                type="datetime-local"
                name="startCustom"
                aria-label={t.createLeague.startCustom}
                defaultValue={nextOpen.setZone(APP_TIME_ZONE).toFormat("yyyy-MM-dd'T'HH:mm")}
                className="w-auto"
              />
            )}
            <FieldError message={errors["start"]} />
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="endDate">{t.createLeague.endDate}</Label>
            <Input
              id="endDate"
              name="endDate"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-auto"
              required
            />
            {endTime && (
              <p className="text-muted-foreground text-xs">
                {t.createLeague.endHint(formatLongDateTime(endTime))}
              </p>
            )}
            <FieldError message={errors["end"]} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-5">
          <button
            type="button"
            className="flex items-center justify-between text-left font-medium"
            aria-expanded={showMore}
            onClick={() => setShowMore((open) => !open)}
          >
            {t.createLeague.more}
            <ChevronDown
              aria-hidden
              className={`size-4 transition-transform ${showMore ? "rotate-180" : ""}`}
            />
          </button>

          {/* Fields stay in the form when collapsed, so their defaults are submitted. */}
          <div className={showMore ? "flex flex-col gap-6" : "hidden"}>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-medium">{t.createLeague.visibility}</legend>
              <RadioGroup name="visibility" defaultValue="delayed">
                {VISIBILITIES.map((visibility) => (
                  <label key={visibility} className="flex items-start gap-2 text-sm">
                    <RadioGroupItem value={visibility} className="mt-0.5" />
                    <span>
                      <span className="font-medium">
                        {t.createLeague.visibilityOptions[visibility].label}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {t.createLeague.visibilityOptions[visibility].hint}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t.createLeague.exchanges}</legend>
              {exchanges.map((exchange) => (
                <label key={exchange.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    name="exchanges"
                    value={exchange.id}
                    checked={selected.includes(exchange.id)}
                    onCheckedChange={(checked) =>
                      setSelected((current) =>
                        checked === true
                          ? [...current, exchange.id]
                          : current.filter((id) => id !== exchange.id),
                      )
                    }
                  />
                  {exchange.name}
                </label>
              ))}
              <p className="text-muted-foreground text-xs">{t.createLeague.exchangesHint}</p>
              <FieldError message={errors["exchanges"]} />
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t.createLeague.fee}</legend>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="feePercent" className="text-xs">
                    {t.createLeague.feeRate}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="feePercent"
                      name="feePercent"
                      inputMode="decimal"
                      defaultValue="0,05"
                    />
                    <span className="text-muted-foreground text-sm">%</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="feeMinimum" className="text-xs">
                    {t.createLeague.feeMinimum}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="feeMinimum"
                      name="feeMinimum"
                      inputMode="decimal"
                      value={feeMinimum}
                      onChange={(event) => setFeeMinimum(event.target.value)}
                    />
                    <span className="text-muted-foreground text-sm">{currencyLabel(currency)}</span>
                  </div>
                </div>
              </div>
              <p className="text-muted-foreground text-xs">{t.createLeague.feeHint}</p>
              <FieldError message={errors["fee"]} />
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t.createLeague.maxShare}</legend>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="maxShareEnabled"
                  checked={maxShareEnabled}
                  onCheckedChange={(checked) => setMaxShareEnabled(checked === true)}
                />
                {t.createLeague.maxShareEnabled}
              </label>
              {maxShareEnabled && (
                <div className="flex items-center gap-2">
                  <Input
                    name="maxSharePercent"
                    inputMode="decimal"
                    defaultValue="25"
                    className="w-24"
                    aria-label={t.createLeague.maxShare}
                  />
                  <span className="text-muted-foreground text-sm">%</span>
                </div>
              )}
              <p className="text-muted-foreground text-xs">{t.createLeague.maxShareHint}</p>
              <FieldError message={errors["maxShare"]} />
            </fieldset>
          </div>
        </CardContent>
      </Card>

      <FieldError message={errors["form"]} />
      <p className="text-muted-foreground text-center text-xs">{t.createLeague.fakeMoneyNote}</p>
      <SubmitButton size="lg" pendingText={t.createLeague.submitting}>
        {t.createLeague.submit}
      </SubmitButton>
    </form>
  );
}
