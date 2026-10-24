"use server";

import { isCurrency, Money } from "@aksjeliga/core";
import {
  addSimulatedCorporateAction,
  loadInstrument,
  type NewCorporateAction,
  runJob,
} from "@aksjeliga/db";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";

import { t } from "@/i18n";
import { field, parseDecimalInput } from "@/lib/parse";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { serverEnv } from "@/server/env";
import { getPrices } from "@/server/prices";
import { requireUser } from "@/server/session";

/*
 * Dev-only tools on the profile page (ALLOW_TIME_TRAVEL=1): simulate corporate actions for
 * the mock provider and run the daily jobs with the time machine's "now".
 */

export type DevFormState =
  { status: "idle" } | { status: "done"; message: string } | { status: "error"; message: string };

async function requireDevTools(): Promise<void> {
  await requireUser();
  if (!serverEnv.timeTravelEnabled) throw new Error("Dev tools are disabled");
}

function dateField(form: FormData, name: string): string | null {
  const value = field(form, name);
  return DateTime.fromISO(value, { zone: "utc" }).isValid && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

const invalid: DevFormState = { status: "error", message: t.profile.simulate.invalid };

async function addSimulated(action: NewCorporateAction): Promise<DevFormState> {
  if (!(await loadInstrument(getDb(), action.instrumentId))) return invalid;
  await addSimulatedCorporateAction(getDb(), action);
  revalidatePath("/", "layout");
  return { status: "done", message: t.profile.simulate.added };
}

export async function simulateSplit(
  _previous: DevFormState,
  form: FormData,
): Promise<DevFormState> {
  await requireDevTools();
  const effectiveDate = dateField(form, "effectiveDate");
  const ratioFrom = parseDecimalInput(field(form, "ratioFrom"));
  const ratioTo = parseDecimalInput(field(form, "ratioTo"));
  if (!effectiveDate || !ratioFrom?.greaterThan(0) || !ratioTo?.greaterThan(0)) return invalid;
  if (ratioFrom.equals(ratioTo)) return invalid;
  return addSimulated({
    kind: "split",
    instrumentId: field(form, "instrumentId"),
    effectiveDate,
    ratioFrom,
    ratioTo,
  });
}

export async function simulateDividend(
  _previous: DevFormState,
  form: FormData,
): Promise<DevFormState> {
  await requireDevTools();
  const exDate = dateField(form, "exDate");
  const payDate = dateField(form, "payDate");
  const amount = parseDecimalInput(field(form, "amountPerShare"));
  const currency = field(form, "currency");
  if (!exDate || !payDate || !amount?.greaterThan(0) || !isCurrency(currency)) return invalid;
  if (amount.decimalPlaces() > 4) return invalid;
  if (payDate < exDate) return { status: "error", message: t.profile.simulate.payBeforeEx };
  return addSimulated({
    kind: "dividend",
    instrumentId: field(form, "instrumentId"),
    exDate,
    payDate,
    amountPerShare: Money.of(amount, currency),
  });
}

/** Runs the daily jobs now (the time machine's now), like the 06:30 cron run. */
export async function runJobsNow(_previous: DevFormState): Promise<DevFormState> {
  await requireDevTools();
  const now = await serverNow();
  try {
    const report = await runJob("daily", getDb(), await getPrices(now), { now });
    revalidatePath("/", "layout");
    return {
      status: "done",
      message: t.profile.jobs.done(
        report.corporateActions?.booked ?? 0,
        report.finalized ?? 0,
        report.snapshots ?? 0,
      ),
    };
  } catch (error) {
    console.error("Jobs failed", error);
    return { status: "error", message: t.profile.jobs.failed };
  }
}
