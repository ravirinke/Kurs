import type { PriceProvider } from "@aksjeliga/core";
import type { DateTime } from "luxon";

import type { Database } from "../client";

import { type CorporateActionReport, processCorporateActions } from "./corporate-actions";
import { finalizeDueLeagues } from "./finalize";
import type { JobScope } from "./scope";
import { takeDailySnapshots } from "./snapshots";

export * from "./corporate-actions";
export * from "./finalize";
export * from "./scope";
export * from "./snapshots";

export const JOB_NAMES = ["daily", "corporate-actions", "finalize", "snapshots"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

export interface JobReport {
  corporateActions?: CorporateActionReport;
  finalized?: number;
  snapshots?: number;
}

/**
 * Runs one job, or all of them ("daily", once a day at 06:30 Europe/Oslo). The order
 * matters: splits and dividends are booked first, so the final results and the snapshots
 * include them. Every job is idempotent, so a repeated or overlapping run is harmless.
 */
export async function runJob(
  name: JobName,
  db: Database,
  provider: PriceProvider,
  input: { now: DateTime } & JobScope,
): Promise<JobReport> {
  const report: JobReport = {};
  if (name === "daily" || name === "corporate-actions")
    report.corporateActions = await processCorporateActions(db, provider, input);
  if (name === "daily" || name === "finalize")
    report.finalized = await finalizeDueLeagues(db, provider, input);
  if (name === "daily" || name === "snapshots")
    report.snapshots = (await takeDailySnapshots(db, provider, input)).taken;
  return report;
}
