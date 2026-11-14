import { roundHalfUp } from "@aksjeliga/core";
import { DateTime } from "luxon";

import {
  asArray,
  asEpochSeconds,
  asObject,
  asPositiveDecimal,
  asString,
  type HttpGet,
  httpGet,
  type JsonValue,
  mapLimited,
  parseJson,
} from "./http";
import { type ListedInstrument, MarketDataError, type SourceQuote } from "./types";

/*
 * Finnhub (https://finnhub.io), free plan: real-time US quotes and US symbol lists, 60 calls
 * a minute. Candles, splits, dividends, FX and non-US exchanges need a paid plan (checked
 * with scripts/probe-sources.ts, see docs/decisions.md).
 */

const BASE_URL = "https://finnhub.io/api/v1";
const CONCURRENCY = 5;
const PRICE_DECIMALS = 4;

/** Security types we list: ordinary shares and their equivalents. No funds, warrants or units. */
const SHARE_TYPES = new Set(["Common Stock", "ADR", "NY Reg Shrs", "REIT"]);
/** Plain tickers only ("AAPL", "BRK.B"): the other sources must be able to find them too. */
const TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;

export class FinnhubSource {
  constructor(
    private readonly apiKey: string,
    private readonly http: HttpGet = httpGet,
  ) {}

  /** Latest price per symbol (one call each). Unknown or failing symbols are absent. */
  async quotes(symbols: readonly string[]): Promise<Map<string, SourceQuote>> {
    const found = new Map<string, SourceQuote>();
    await mapLimited(symbols, CONCURRENCY, async (symbol) => {
      try {
        const json = asObject(await this.get(`/quote?symbol=${encodeURIComponent(symbol)}`));
        // An unknown symbol answers 200 with zeros.
        const price = asPositiveDecimal(json?.["c"]);
        const time = asEpochSeconds(json?.["t"]);
        if (price === null || time === null || time === 0) return;
        found.set(symbol, {
          price: roundHalfUp(price, PRICE_DECIMALS),
          at: DateTime.fromSeconds(time, { zone: "utc" }),
        });
      } catch (error) {
        // One failing symbol (e.g. the rate limit) must not lose the others.
        if (!(error instanceof MarketDataError)) throw error;
      }
    });
    return found;
  }

  /** Shares listed on a US exchange, by MIC ("XNAS", "XNYS"). */
  async listShares(mic: string): Promise<ListedInstrument[]> {
    const json = await this.get(`/stock/symbol?exchange=US&mic=${encodeURIComponent(mic)}`);
    const listed: ListedInstrument[] = [];
    for (const entry of asArray(json)) {
      const row = asObject(entry);
      const ticker = asString(row?.["displaySymbol"]);
      const name = asString(row?.["description"]);
      const type = asString(row?.["type"]);
      if (ticker === null || name === null || type === null) continue;
      if (!SHARE_TYPES.has(type) || !TICKER.test(ticker) || name.trim() === "") continue;
      if (asString(row?.["currency"]) !== "USD") continue;
      const isin = asString(row?.["isin"]);
      listed.push({
        ticker,
        name: name.trim(),
        isin: isin === null || isin === "" ? null : isin,
        currency: "USD",
      });
    }
    return listed;
  }

  private async get(path: string): Promise<JsonValue> {
    const response = await this.http(BASE_URL + path, {
      headers: { "X-Finnhub-Token": this.apiKey },
    });
    if (response.status !== 200)
      throw new MarketDataError(`Finnhub answered ${String(response.status)}`);
    return parseJson(response.text, "Finnhub");
  }
}
