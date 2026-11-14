import "server-only";

import { type Exchange, fixedClock, type Instrument, type PriceProvider } from "@aksjeliga/core";
import {
  buildMockPriceProvider,
  CachedPriceProvider,
  createLiveMarketData,
  loadExchanges,
  loadInstruments,
  loadSimulatedCorporateActions,
  type MarketData,
} from "@aksjeliga/db";
import type { DateTime } from "luxon";

import { getDb } from "./db";
import { serverEnv } from "./env";

/*
 * The one place that decides which PriceProvider the app uses (PRICE_PROVIDER in .env):
 *
 *   mock  deterministic made-up prices. For tests and local development; the only one the
 *         dev time machine works with.
 *   live  real prices, fetched by the server and cached in Postgres (packages/db/src/prices).
 *
 * Nothing outside this file knows which one is in use.
 */

let exchangeData: Promise<Exchange[]> | undefined;
let mockInstruments: Promise<Instrument[]> | undefined;
let marketData: MarketData | undefined;

/** Loaded once per server instance; a failed load is tried again. */
function once<T>(current: Promise<T> | undefined, load: () => Promise<T>, reset: () => void) {
  return (
    current ??
    load().catch((error: unknown) => {
      reset();
      throw error;
    })
  );
}

function allExchanges(): Promise<Exchange[]> {
  exchangeData = once(
    exchangeData,
    () => loadExchanges(getDb()),
    () => (exchangeData = undefined),
  );
  return exchangeData;
}

function liveMarketData(): MarketData {
  if (serverEnv.timeTravelEnabled)
    throw new Error(
      "PRICE_PROVIDER=live cannot be combined with ALLOW_TIME_TRAVEL=1: real prices only exist for the real time.",
    );
  marketData ??= createLiveMarketData({ finnhubApiKey: serverEnv.finnhubApiKey });
  return marketData;
}

/**
 * A provider whose "now" is the request's now (so the dev time machine works with the mock).
 * In development the mock also knows the splits and dividends simulated on the profile page.
 */
export async function getPrices(now: DateTime): Promise<PriceProvider> {
  const exchanges = await allExchanges();
  if (serverEnv.priceProvider === "live") {
    return new CachedPriceProvider({
      db: getDb(),
      clock: fixedClock(now),
      exchanges,
      marketData: liveMarketData(),
    });
  }
  mockInstruments = once(
    mockInstruments,
    () => loadInstruments(getDb()),
    () => (mockInstruments = undefined),
  );
  const corporateActions = serverEnv.timeTravelEnabled
    ? await loadSimulatedCorporateActions(getDb())
    : [];
  return buildMockPriceProvider({
    clock: fixedClock(now),
    exchanges,
    instruments: await mockInstruments,
    corporateActions,
  });
}

/** True with the mock: prices are made up, and the UI says so. */
export function pricesAreFictional(): boolean {
  return serverEnv.priceProvider !== "live";
}

/** The source of instrument lists for the sync job, or null with the mock (it has none). */
export function getMarketData(): MarketData | null {
  return serverEnv.priceProvider === "live" ? liveMarketData() : null;
}

/** Ids of the exchanges that can be priced, or null when all of them can (the mock). */
export function pricedExchangeIds(): readonly string[] | null {
  return serverEnv.priceProvider === "live" ? liveMarketData().exchangeIds : null;
}

/** The exchanges a new league can choose from: those we have prices for. */
export async function loadPricedExchanges(): Promise<Exchange[]> {
  const priced = pricedExchangeIds();
  const exchanges = await allExchanges();
  return priced ? exchanges.filter((exchange) => priced.includes(exchange.id)) : exchanges;
}
