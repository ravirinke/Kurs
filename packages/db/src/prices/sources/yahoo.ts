import { type Decimal, ONE, roundHalfUp } from "@aksjeliga/core";
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
import {
  type DailyHistory,
  MarketDataError,
  type SourceDividend,
  type SourcePoint,
  type SourceQuote,
  type SourceSplit,
} from "./types";

/*
 * Yahoo Finance's chart endpoints. They are unofficial: no key, no contract, and they can
 * change without notice (docs/decisions.md). Everything Yahoo-specific stays in this file.
 */

const BASE_URL = "https://query1.finance.yahoo.com";
/** Symbols per batched quote request. */
const QUOTE_BATCH = 20;
const CONCURRENCY = 4;
/** "Until now", without reading the clock: Yahoo accepts an end far in the future. */
const FAR_FUTURE = "9999999999";
const FIVE_MINUTES = 300;
const ONE_DAY = 86_400;

export const EQUITY_DECIMALS = 4;
export const FX_DECIMALS = 6;
const DIVIDEND_DECIMALS = 6;

interface Chart {
  timeZone: string;
  timestamps: number[];
  closes: (Decimal | null)[];
  events: Record<string, JsonValue> | null;
}

function localDate(epochSeconds: number, timeZone: string): string {
  return DateTime.fromSeconds(epochSeconds, { zone: timeZone }).toFormat("yyyy-MM-dd");
}

export class YahooSource {
  constructor(private readonly http: HttpGet = httpGet) {}

  /** Latest price per symbol. Symbols Yahoo does not know are absent from the result. */
  async quotes(symbols: readonly string[], decimals: number): Promise<Map<string, SourceQuote>> {
    const batches: string[][] = [];
    for (let i = 0; i < symbols.length; i += QUOTE_BATCH)
      batches.push(symbols.slice(i, i + QUOTE_BATCH));
    const found = new Map<string, SourceQuote>();
    await mapLimited(batches, CONCURRENCY, async (batch) => {
      const list = batch.map((symbol) => encodeURIComponent(symbol)).join(",");
      const json = await this.get(`/v7/finance/spark?symbols=${list}&range=1d&interval=1d`);
      for (const entry of asArray(asObject(asObject(json)?.["spark"])?.["result"])) {
        const symbol = asString(asObject(entry)?.["symbol"]);
        const meta = asObject(asObject(asArray(asObject(entry)?.["response"])[0])?.["meta"]);
        const price = asPositiveDecimal(meta?.["regularMarketPrice"]);
        const time = asEpochSeconds(meta?.["regularMarketTime"]);
        if (symbol === null || price === null || time === null) continue;
        found.set(symbol, {
          price: roundHalfUp(price, decimals),
          at: DateTime.fromSeconds(time, { zone: "utc" }),
        });
      }
    });
    return found;
  }

  /** 5-minute points since `from`, each at the end of its bar. */
  async intraday(symbol: string, from: DateTime, decimals: number): Promise<SourcePoint[]> {
    const chart = await this.chart(symbol, "5m", from, false);
    return this.points(chart, FIVE_MINUTES, decimals);
  }

  /** One point per day since `from`, at the end of the day (used for FX). */
  async dailyPoints(symbol: string, from: DateTime, decimals: number): Promise<SourcePoint[]> {
    const chart = await this.chart(symbol, "1d", from, false);
    return this.points(chart, ONE_DAY, decimals);
  }

  /**
   * Daily closes since `from` with the splits and dividends in the period. Yahoo adjusts
   * old closes (and dividends) for later splits; we undo that, so a close is the price the
   * share actually traded at that day.
   */
  async daily(symbol: string, from: DateTime): Promise<DailyHistory> {
    const chart = await this.chart(symbol, "1d", from, true);
    const splits = this.splits(chart);
    /** Product of the split factors that took effect after `date`. */
    const laterSplits = (date: string): Decimal =>
      splits
        .filter((split) => split.effectiveDate > date)
        .reduce((factor, split) => factor.times(split.ratioTo).dividedBy(split.ratioFrom), ONE);

    const bars = chart.timestamps.flatMap((timestamp, index) => {
      const close = chart.closes[index];
      if (!close) return [];
      const date = localDate(timestamp, chart.timeZone);
      return [{ date, close: roundHalfUp(close.times(laterSplits(date)), EQUITY_DECIMALS) }];
    });

    const dividends: SourceDividend[] = [];
    for (const entry of Object.values(asObject(chart.events?.["dividends"]) ?? {})) {
      const amount = asPositiveDecimal(asObject(entry)?.["amount"]);
      const time = asEpochSeconds(asObject(entry)?.["date"]);
      if (amount === null || time === null) continue;
      const exDate = localDate(time, chart.timeZone);
      dividends.push({
        exDate,
        amount: roundHalfUp(amount.times(laterSplits(exDate)), DIVIDEND_DECIMALS),
      });
    }
    dividends.sort((a, b) => a.exDate.localeCompare(b.exDate));
    return { bars, splits, dividends };
  }

  private splits(chart: Chart): SourceSplit[] {
    const splits: SourceSplit[] = [];
    for (const entry of Object.values(asObject(chart.events?.["splits"]) ?? {})) {
      const time = asEpochSeconds(asObject(entry)?.["date"]);
      // Yahoo: "4:1" is numerator 4, denominator 1: one old share becomes four.
      const ratioTo = asPositiveDecimal(asObject(entry)?.["numerator"]);
      const ratioFrom = asPositiveDecimal(asObject(entry)?.["denominator"]);
      if (time === null || ratioTo === null || ratioFrom === null) continue;
      splits.push({ effectiveDate: localDate(time, chart.timeZone), ratioFrom, ratioTo });
    }
    return splits.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  }

  private points(chart: Chart, shiftSeconds: number, decimals: number): SourcePoint[] {
    return chart.timestamps.flatMap((timestamp, index) => {
      const close = chart.closes[index];
      if (!close) return [];
      return [
        {
          at: DateTime.fromSeconds(timestamp + shiftSeconds, { zone: "utc" }),
          value: roundHalfUp(close, decimals),
        },
      ];
    });
  }

  private async chart(
    symbol: string,
    interval: "5m" | "1d",
    from: DateTime,
    withEvents: boolean,
  ): Promise<Chart> {
    const period1 = String(Math.floor(from.toSeconds()));
    const json = await this.get(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}` +
        `&period1=${period1}&period2=${FAR_FUTURE}${withEvents ? "&events=div%2Csplit" : ""}`,
    );
    const result = asObject(asArray(asObject(asObject(json)?.["chart"])?.["result"])[0]);
    const timeZone = asString(asObject(result?.["meta"])?.["exchangeTimezoneName"]);
    if (!result || timeZone === null) throw new MarketDataError(`Yahoo has no chart for ${symbol}`);
    const quote = asObject(asArray(asObject(result["indicators"])?.["quote"])[0]);
    const timestamps: number[] = [];
    const closes: (Decimal | null)[] = [];
    const rawCloses = asArray(quote?.["close"]);
    asArray(result["timestamp"]).forEach((raw, index) => {
      const timestamp = asEpochSeconds(raw);
      if (timestamp === null) return;
      timestamps.push(timestamp);
      closes.push(asPositiveDecimal(rawCloses[index]));
    });
    return { timeZone, timestamps, closes, events: asObject(result["events"]) };
  }

  private async get(path: string): Promise<JsonValue> {
    const response = await this.http(BASE_URL + path);
    if (response.status !== 200)
      throw new MarketDataError(`Yahoo answered ${String(response.status)}`);
    return parseJson(response.text, "Yahoo");
  }
}

/** Yahoo's symbol for units of `currency` per 1 USD. */
export function yahooFxSymbol(currency: string): string {
  return `USD${currency}=X`;
}
