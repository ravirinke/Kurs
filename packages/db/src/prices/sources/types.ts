import type { Currency, Decimal, ExchangeId, Instrument, InstrumentId } from "@aksjeliga/core";
import type { DateTime } from "luxon";

/** A price (or FX rate) as a source reports it right now. */
export interface SourceQuote {
  price: Decimal;
  /** Time of the last trade, according to the source. */
  at: DateTime;
}

/** One point of a series: the value at an instant. */
export interface SourcePoint {
  at: DateTime;
  value: Decimal;
}

export interface DailyBar {
  /** Exchange-local trading date (yyyy-MM-dd). */
  date: string;
  /** The close as traded that day: NOT adjusted for later splits. */
  close: Decimal;
}

/** `ratioFrom` old shares become `ratioTo` new ones on `effectiveDate` (exchange-local). */
export interface SourceSplit {
  effectiveDate: string;
  ratioFrom: Decimal;
  ratioTo: Decimal;
}

export interface SourceDividend {
  /** Exchange-local ex-date. */
  exDate: string;
  /** Per share as held on the ex-date, in the instrument's trading currency. */
  amount: Decimal;
}

export interface DailyHistory {
  bars: DailyBar[];
  splits: SourceSplit[];
  dividends: SourceDividend[];
}

/** An instrument as an exchange's list gives it. */
export interface ListedInstrument {
  ticker: string;
  name: string;
  isin: string | null;
  currency: Currency;
}

/**
 * Everything the price cache needs from the outside world, per instrument. The live
 * implementation routes each request to Finnhub or Yahoo; tests use a fake. Only code in
 * `packages/db/src/prices` knows this exists: the rest of the app sees a PriceProvider.
 */
export interface MarketData {
  /** Exchanges we have a price source for. */
  readonly exchangeIds: readonly ExchangeId[];
  /** True when prices for the exchange come with a delay (typically 15 minutes). */
  isDelayed(exchangeId: ExchangeId): boolean;
  /** Current prices. Instruments the source could not price are absent from the result. */
  fetchQuotes(instruments: readonly Instrument[]): Promise<Map<InstrumentId, SourceQuote>>;
  /** 5-minute bars since `from`, each at the END of its bar. */
  fetchIntraday(instrument: Instrument, from: DateTime): Promise<SourcePoint[]>;
  /** Daily closes since `from`, with the splits and dividends in that period. */
  fetchDaily(instrument: Instrument, from: DateTime): Promise<DailyHistory>;
  /** Units of each currency per 1 USD, now. */
  fetchFxQuotes(currencies: readonly Currency[]): Promise<Map<Currency, SourceQuote>>;
  /** Units of `currency` per 1 USD: 5-minute points since `from`. */
  fetchFxIntraday(currency: Currency, from: DateTime): Promise<SourcePoint[]>;
  /** Units of `currency` per 1 USD: one point per day since `from`, at the end of the day. */
  fetchFxDaily(currency: Currency, from: DateTime): Promise<SourcePoint[]>;
  /** Every share listed on the exchange. */
  listInstruments(exchangeId: ExchangeId): Promise<ListedInstrument[]>;
}

/** A source answered with an error, timed out, or sent something we cannot read. */
export class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataError";
  }
}
