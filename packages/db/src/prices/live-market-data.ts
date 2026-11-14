import type { Currency, ExchangeId, Instrument, InstrumentId } from "@aksjeliga/core";
import type { DateTime } from "luxon";

import { EuronextSource } from "./sources/euronext";
import { FinnhubSource } from "./sources/finnhub";
import type { HttpGet } from "./sources/http";
import {
  type DailyHistory,
  type ListedInstrument,
  type MarketData,
  MarketDataError,
  type SourcePoint,
  type SourceQuote,
} from "./sources/types";
import { EQUITY_DECIMALS, FX_DECIMALS, yahooFxSymbol, YahooSource } from "./sources/yahoo";

/*
 * Which source serves what (docs/decisions.md, 2026-11-14):
 *
 *   Real-time quotes, Nasdaq and NYSE    Finnhub (official API), Yahoo as fallback
 *   Quotes, Oslo Børs (delayed ~15 min)  Yahoo
 *   History, FX, splits and dividends    Yahoo
 *   Instrument lists                     Finnhub (US), Euronext (Oslo)
 *
 * Adding an exchange means adding it to EXCHANGE_SOURCES and, if needed, a new source.
 */

interface ExchangeSource {
  /** Suffix Yahoo adds to the ticker ("EQNR" → "EQNR.OL"). */
  yahooSuffix: string;
  /** Quotes come from Finnhub when a key is configured. */
  finnhubQuotes: boolean;
  /** Yahoo publishes this exchange's prices with a delay. */
  yahooDelayed: boolean;
}

const EXCHANGE_SOURCES: Readonly<Record<ExchangeId, ExchangeSource>> = {
  XOSL: { yahooSuffix: ".OL", finnhubQuotes: false, yahooDelayed: true },
  XNAS: { yahooSuffix: "", finnhubQuotes: true, yahooDelayed: false },
  XNYS: { yahooSuffix: "", finnhubQuotes: true, yahooDelayed: false },
};

/**
 * Finnhub allows 60 calls a minute and prices one symbol per call, so only small batches go
 * there (a trade, a stock page, a small portfolio). Big lists use Yahoo's batched endpoint.
 */
const FINNHUB_MAX_BATCH = 15;

function source(exchangeId: ExchangeId): ExchangeSource {
  const found = EXCHANGE_SOURCES[exchangeId];
  if (!found) throw new MarketDataError(`No price source for exchange ${exchangeId}`);
  return found;
}

/** "BRK.B" is "BRK-B" at Yahoo; Oslo tickers get ".OL". */
export function yahooSymbol(instrument: Pick<Instrument, "ticker" | "exchangeId">): string {
  return instrument.ticker.replaceAll(".", "-") + source(instrument.exchangeId).yahooSuffix;
}

export interface LiveMarketDataOptions {
  /** Without a key, Yahoo also serves the US quotes. */
  finnhubApiKey?: string | undefined;
  http?: HttpGet;
}

/** The real MarketData: routes each request to Finnhub, Yahoo or Euronext. */
export function createLiveMarketData(options: LiveMarketDataOptions = {}): MarketData {
  const yahoo = new YahooSource(options.http);
  const euronext = new EuronextSource(options.http);
  const finnhub = options.finnhubApiKey
    ? new FinnhubSource(options.finnhubApiKey, options.http)
    : null;

  async function yahooQuotes(
    instruments: readonly Instrument[],
  ): Promise<Map<InstrumentId, SourceQuote>> {
    if (instruments.length === 0) return new Map();
    const bySymbol = await yahoo.quotes(instruments.map(yahooSymbol), EQUITY_DECIMALS);
    const found = new Map<InstrumentId, SourceQuote>();
    for (const instrument of instruments) {
      const quote = bySymbol.get(yahooSymbol(instrument));
      if (quote) found.set(instrument.id, quote);
    }
    return found;
  }

  return {
    exchangeIds: Object.keys(EXCHANGE_SOURCES),

    isDelayed: (exchangeId) => source(exchangeId).yahooDelayed,

    async fetchQuotes(instruments) {
      const forFinnhub = finnhub
        ? instruments.filter((instrument) => source(instrument.exchangeId).finnhubQuotes)
        : [];
      const found = new Map<InstrumentId, SourceQuote>();
      if (finnhub && forFinnhub.length > 0 && forFinnhub.length <= FINNHUB_MAX_BATCH) {
        const bySymbol = await finnhub.quotes(forFinnhub.map((instrument) => instrument.ticker));
        for (const instrument of forFinnhub) {
          const quote = bySymbol.get(instrument.ticker);
          if (quote) found.set(instrument.id, quote);
        }
      }
      // Everything Finnhub did not answer (Oslo, big batches, failures) goes to Yahoo.
      const rest = instruments.filter((instrument) => !found.has(instrument.id));
      for (const [id, quote] of await yahooQuotes(rest)) found.set(id, quote);
      return found;
    },

    fetchIntraday: (instrument, from) =>
      yahoo.intraday(yahooSymbol(instrument), from, EQUITY_DECIMALS),

    fetchDaily: (instrument: Instrument, from: DateTime): Promise<DailyHistory> =>
      yahoo.daily(yahooSymbol(instrument), from),

    async fetchFxQuotes(currencies) {
      const bySymbol = await yahoo.quotes(currencies.map(yahooFxSymbol), FX_DECIMALS);
      const found = new Map<Currency, SourceQuote>();
      for (const currency of currencies) {
        const quote = bySymbol.get(yahooFxSymbol(currency));
        if (quote) found.set(currency, quote);
      }
      return found;
    },

    fetchFxIntraday: (currency, from): Promise<SourcePoint[]> =>
      yahoo.intraday(yahooFxSymbol(currency), from, FX_DECIMALS),

    fetchFxDaily: (currency, from): Promise<SourcePoint[]> =>
      yahoo.dailyPoints(yahooFxSymbol(currency), from, FX_DECIMALS),

    async listInstruments(exchangeId): Promise<ListedInstrument[]> {
      if (exchangeId === "XOSL") return euronext.listOsloShares();
      source(exchangeId);
      if (!finnhub) throw new MarketDataError(`Listing ${exchangeId} needs FINNHUB_API_KEY`);
      return finnhub.listShares(exchangeId);
    },
  };
}
