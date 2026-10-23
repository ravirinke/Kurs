import "server-only";

import { type Exchange, fixedClock, type Instrument, type PriceProvider } from "@aksjeliga/core";
import { buildMockPriceProvider, loadExchanges, loadInstruments } from "@aksjeliga/db";
import type { DateTime } from "luxon";

import { getDb } from "./db";

/*
 * The one place that decides which PriceProvider the app uses. Today: the mock. Swapping in
 * a real market-data API only changes this file.
 */

let referenceData: Promise<{ exchanges: Exchange[]; instruments: Instrument[] }> | undefined;

function loadReferenceData() {
  referenceData ??= (async () => {
    const db = getDb();
    const [exchanges, instruments] = await Promise.all([loadExchanges(db), loadInstruments(db)]);
    return { exchanges, instruments };
  })().catch((error: unknown) => {
    referenceData = undefined;
    throw error;
  });
  return referenceData;
}

/** A provider whose "now" is the request's now (so the dev time machine works too). */
export async function getPrices(now: DateTime): Promise<PriceProvider> {
  const { exchanges, instruments } = await loadReferenceData();
  return buildMockPriceProvider({ clock: fixedClock(now), exchanges, instruments });
}
