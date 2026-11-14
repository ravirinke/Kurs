import type { DateTime } from "luxon";

import type { CorporateAction } from "../corporate-actions";
import type { FxRate } from "../fx";
import type { ExchangeId, InstrumentId, MarketStatus } from "../market";
import type { Currency, Money } from "../money";

export interface PriceQuote {
  instrumentId: InstrumentId;
  /** In the trading currency. */
  price: Money;
  at: DateTime;
  /** "last_close" when the exchange is closed. */
  source: "live" | "last_close";
  /**
   * When the source last confirmed this price. `at` is the time of the last trade, which can
   * be long ago for a quiet stock; this tells how old our knowledge is.
   */
  checkedAt: DateTime;
  /** True when the source publishes this exchange's prices with a delay (typically 15 min). */
  delayed: boolean;
}

/** A live price not confirmed by its source for this long is too old to trade on. */
export const MAX_LIVE_PRICE_AGE_MINUTES = 5;

/**
 * True when a live price is too old to lock a trade on (the source is down or slow). A last
 * close is never stale: trading is closed then anyway.
 */
export function isPriceStale(quote: PriceQuote, now: DateTime): boolean {
  if (quote.source !== "live") return false;
  return now.toMillis() - quote.checkedAt.toMillis() > MAX_LIVE_PRICE_AGE_MINUTES * 60_000;
}

export interface ClosingPrice {
  instrumentId: InstrumentId;
  price: Money;
  closedAt: DateTime;
  /**
   * True while the source may still change this close (just after the bell: the closing
   * auction, a delayed feed). Fine to show, but a final result must wait for the real one.
   */
  provisional?: boolean;
}

/** Spacing between points in a price history. */
export type PriceResolution = "5m" | "1h" | "1d";

export interface PricePoint {
  at: DateTime;
  /** In the trading currency. */
  price: Money;
}

/**
 * The only way the app gets market data. Implementations: MockPriceProvider now, a real
 * market-data API later. Nothing outside the provider should know which one is in use.
 *
 * Methods take an optional `at` for historical lookups (frozen FX at a close, dividends on
 * a pay date, finalization at a league's end). Without it they mean "now".
 */
export interface PriceProvider {
  getQuote(instrumentId: InstrumentId, at?: DateTime): Promise<PriceQuote>;
  getLastClose(instrumentId: InstrumentId, at?: DateTime): Promise<ClosingPrice>;
  getFxRate(from: Currency, to: Currency, at?: DateTime): Promise<FxRate>;
  getMarketStatus(exchangeId: ExchangeId, at?: DateTime): Promise<MarketStatus>;
  getCorporateActions(
    instrumentId: InstrumentId,
    from: DateTime,
    to: DateTime,
  ): Promise<CorporateAction[]>;
  /**
   * Prices in [from, to] (and never after now) at the given spacing, only while the exchange
   * was open. "1d" gives one point per trading day: its close (or the latest price today).
   * Prices are adjusted for splits up to now, so a chart has no jump at a split.
   */
  getPriceHistory(
    instrumentId: InstrumentId,
    from: DateTime,
    to: DateTime,
    resolution: PriceResolution,
  ): Promise<PricePoint[]>;
}

export class PriceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceDataError";
  }
}
