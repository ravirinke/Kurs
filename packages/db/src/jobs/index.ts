import type { PriceProvider } from "@aksjeliga/core";
import type { DateTime } from "luxon";

import type { Database } from "../client";
import type { MarketData } from "../prices/sources/types";
import { pruneIntradayPrices } from "../prices/store";

import { type CorporateActionReport, processCorporateActions } from "./corporate-actions";
import { finalizeDueLeagues } from "./finalize";
import type { JobScope } from "./scope";
import { takeDailySnapshots } from "./snapshots";
import { type InstrumentSyncReport, syncInstruments } from "./sync-instruments";

export * from "./corporate-actions";
export * from "./finalize";
export * from "./scope";
export * from "./snapshots";
export * from "./sync-instruments";

export const JOB_NAMES = [
  "daily",
  "corporate-actions",
  "finalize",
  "snapshots",
  "instruments",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

export interface JobReport {
  corporateActions?: CorporateActionReport;
  finalized?: number;
  snapshots?: number;
  /** Absent when there is no real market-data source (the mock has no instrument lists). */
  instruments?: InstrumentSyncReport;
  /** How long each part took, to see how close a run is to the host's time limit. */
  durationsMs: Record<string, number>;
}

/** 5-minute bars older than this are deleted: charts only show the last week of them. */
const INTRADAY_RETENTION_DAYS = 30;

/**
 * Runs one job, or all of them ("daily", once a day at 06:30 Europe/Oslo: the only scheduled
 * run we have). The order matters: splits and dividends are booked first, so the final
 * results and the snapshots include them; the instrument lists come last, so a slow source
 * cannot delay the rest. Every job is idempotent, so a repeated, overlapping or interrupted
 * run is harmless: the next one picks up what is left.
 */
export async function runJob(
  name: JobName,
  db: Database,
  provider: PriceProvider,
  input: { now: DateTime; marketData?: MarketData | null } & JobScope,
): Promise<JobReport> {
  const report: JobReport = { durationsMs: {} };
  async function timed<T>(part: string, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await run();
    } finally {
      report.durationsMs[part] = Math.round(performance.now() - started);
    }
  }

  if (name === "daily" || name === "corporate-actions")
    report.corporateActions = await timed("corporateActions", () =>
      processCorporateActions(db, provider, input),
    );
  if (name === "daily" || name === "finalize")
    report.finalized = await timed("finalize", () => finalizeDueLeagues(db, provider, input));
  if (name === "daily" || name === "snapshots")
    report.snapshots = (
      await timed("snapshots", () => takeDailySnapshots(db, provider, input))
    ).taken;
  const { marketData } = input;
  if ((name === "daily" || name === "instruments") && marketData) {
    report.instruments = await timed("instruments", () => syncInstruments(db, marketData));
    await pruneIntradayPrices(db, input.now.minus({ days: INTRADAY_RETENTION_DAYS }));
  }
  return report;
}
