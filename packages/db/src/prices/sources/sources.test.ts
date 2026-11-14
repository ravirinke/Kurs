import { readFileSync } from "node:fs";

import { type Instrument, instant } from "@aksjeliga/core";
import { describe, expect, it } from "vitest";

import { createLiveMarketData, yahooSymbol } from "../live-market-data";

import { parseEuronextList } from "./euronext";
import { FinnhubSource } from "./finnhub";
import { type HttpGet, parseJson } from "./http";
import { MarketDataError } from "./types";
import { EQUITY_DECIMALS, FX_DECIMALS, YahooSource } from "./yahoo";

/*
 * The fixtures are real answers from the sources (2026-11-14), so these tests show that we
 * read the formats as they are. No network.
 */

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

/** Answers every request whose URL contains a key with that text. */
function fakeHttp(answers: Record<string, string | number>): HttpGet & { urls: string[] } {
  const urls: string[] = [];
  const http: HttpGet = (url) => {
    urls.push(url);
    const match = Object.entries(answers).find(([part]) => url.includes(part));
    if (!match) return Promise.resolve({ status: 404, text: "{}" });
    const [, answer] = match;
    return Promise.resolve(
      typeof answer === "number" ? { status: answer, text: "{}" } : { status: 200, text: answer },
    );
  };
  return Object.assign(http, { urls });
}

const instrument = (ticker: string, exchangeId: string): Instrument => ({
  id: `${exchangeId}:${ticker}`,
  ticker,
  isin: null,
  name: ticker,
  exchangeId,
  currency: exchangeId === "XOSL" ? "NOK" : "USD",
});

describe("parseJson", () => {
  it("keeps numbers as the exact text the source sent", () => {
    expect(parseJson('{"price":407.60,"tiny":1e-7,"list":[0.1,0.2],"ok":true}', "test")).toEqual({
      price: "407.60",
      tiny: "1e-7",
      list: ["0.1", "0.2"],
      ok: true,
    });
  });

  it("turns something that is not JSON into a MarketDataError", () => {
    expect(() => parseJson("<html>Too many requests</html>", "Yahoo")).toThrow(MarketDataError);
  });
});

describe("YahooSource", () => {
  it("reads the latest price and its time for several symbols in one request", async () => {
    const http = fakeHttp({ "/v7/finance/spark": fixture("spark.json") });
    const quotes = await new YahooSource(http).quotes(["EQNR.OL", "AAPL"], EQUITY_DECIMALS);
    expect(http.urls).toHaveLength(1);
    expect(quotes.get("EQNR.OL")?.price.toFixed()).toBe("407.6");
    expect(quotes.get("EQNR.OL")?.at.toISO()).toBe("2026-11-13T15:29:54.000Z");
    expect(quotes.get("AAPL")?.price.toFixed()).toBe("356.27");
  });

  it("reads an FX rate as units per US dollar", async () => {
    const http = fakeHttp({ "/v7/finance/spark": fixture("spark.json") });
    const quotes = await new YahooSource(http).quotes(["USDNOK=X"], FX_DECIMALS);
    expect(quotes.get("USDNOK=X")?.price.toFixed()).toBe("9.5748");
    expect(http.urls[0]).toContain("USDNOK%3DX");
  });

  it("undoes Yahoo's split adjustment, so a close is the price traded that day", async () => {
    const http = fakeHttp({ "/v8/finance/chart/AAPL": fixture("yahoo-daily-aapl-split.json") });
    const history = await new YahooSource(http).daily("AAPL", instant("2020-08-01T00:00:00Z"));

    // Apple split 4:1 on Monday 31 Aug 2020. Friday's real close was 499.23.
    expect(history.splits).toEqual([expect.objectContaining({ effectiveDate: "2020-08-31" })]);
    expect(history.splits[0]?.ratioFrom.toFixed()).toBe("1");
    expect(history.splits[0]?.ratioTo.toFixed()).toBe("4");
    const close = (date: string) => history.bars.find((bar) => bar.date === date)?.close.toFixed(2);
    expect(close("2020-08-28")).toBe("499.23");
    // From the split day on, prices are as Yahoo gives them.
    expect(close("2020-08-31")).toBe("129.04");
    // No float noise is stored: at most four decimals.
    expect(history.bars.every((bar) => bar.close.decimalPlaces() <= EQUITY_DECIMALS)).toBe(true);
    // The dividend before the split was 0.82 per share then (Yahoo shows 0.205).
    expect(history.dividends).toHaveLength(1);
    expect(history.dividends[0]?.exDate).toBe("2020-08-07");
    expect(history.dividends[0]?.amount.toFixed()).toBe("0.82");
  });

  it("asks for history from the given time and reports an unknown symbol", async () => {
    const http = fakeHttp({});
    await expect(
      new YahooSource(http).daily("NOPE", instant("2026-01-01T00:00:00Z")),
    ).rejects.toThrow(MarketDataError);
    expect(http.urls[0]).toContain("period1=1767225600");
    expect(http.urls[0]).toContain("events=div%2Csplit");
  });
});

describe("FinnhubSource", () => {
  const quote =
    '{"c":356.27,"d":1.39,"dp":0.3917,"h":360.83,"l":355.75,"o":357.96,"pc":354.88,"t":1794603600}';

  it("reads a quote, and treats zeros as an unknown symbol", async () => {
    const http = fakeHttp({
      "symbol=AAPL": quote,
      "symbol=NOPE": '{"c":0,"d":null,"dp":null,"h":0,"l":0,"o":0,"pc":0,"t":0}',
    });
    const quotes = await new FinnhubSource("key", http).quotes(["AAPL", "NOPE"]);
    expect([...quotes.keys()]).toEqual(["AAPL"]);
    expect(quotes.get("AAPL")?.price.toFixed()).toBe("356.27");
    expect(quotes.get("AAPL")?.at.toISO()).toBe("2026-11-13T21:00:00.000Z");
  });

  it("keeps the quotes that worked when one request is refused", async () => {
    const http = fakeHttp({ "symbol=AAPL": quote, "symbol=MSFT": 429 });
    const quotes = await new FinnhubSource("key", http).quotes(["AAPL", "MSFT"]);
    expect([...quotes.keys()]).toEqual(["AAPL"]);
  });

  it("lists ordinary shares only", async () => {
    const row = (symbol: string, type: string, currency = "USD") => ({
      currency,
      description: `${symbol} CORP`,
      displaySymbol: symbol,
      isin: "",
      mic: "XNAS",
      symbol,
      type,
    });
    const http = fakeHttp({
      "/stock/symbol": JSON.stringify([
        row("FSLR", "Common Stock"),
        row("BRK.B", "Common Stock"),
        row("ASML", "ADR"),
        row("TDOG", "ETP"),
        row("GSRFU", "Unit"),
        row("ABCDW", "Equity WRT"),
        row("ABC-P", "Common Stock"),
        row("EURO", "Common Stock", "EUR"),
      ]),
    });
    const listed = await new FinnhubSource("key", http).listShares("XNAS");
    expect(listed.map((entry) => entry.ticker)).toEqual(["FSLR", "BRK.B", "ASML"]);
    expect(listed[0]).toEqual({ ticker: "FSLR", name: "FSLR CORP", isin: null, currency: "USD" });
    expect(http.urls[0]).toContain("mic=XNAS");
  });
});

describe("parseEuronextList", () => {
  it("reads the shares and skips the description lines", () => {
    const listed = parseEuronextList(fixture("euronext-oslo.csv"));
    expect(listed.map((entry) => entry.ticker)).toEqual(["2020", "ABG", "AFG", "AGLX", "AKRBP"]);
    expect(listed[0]).toEqual({
      ticker: "2020",
      name: "2020 BULKERS",
      isin: "BMG9156K1018",
      currency: "NOK",
    });
  });

  it("fails loudly when the format has changed", () => {
    expect(() => parseEuronextList("Navn;Kode\nEquinor;EQNR")).toThrow(MarketDataError);
  });
});

describe("live market data routing", () => {
  it("writes symbols the way each source expects", () => {
    expect(yahooSymbol(instrument("EQNR", "XOSL"))).toBe("EQNR.OL");
    expect(yahooSymbol(instrument("BRK.B", "XNYS"))).toBe("BRK-B");
    expect(() => yahooSymbol(instrument("VOLV-B", "XSTO"))).toThrow(MarketDataError);
  });

  it("prices US shares at Finnhub and Oslo at Yahoo", async () => {
    const http = fakeHttp({
      "finnhub.io/api/v1/quote?symbol=AAPL":
        '{"c":356.30,"d":0,"dp":0,"h":0,"l":0,"o":0,"pc":0,"t":1794603600}',
      "/v7/finance/spark": fixture("spark.json"),
    });
    const data = createLiveMarketData({ finnhubApiKey: "key", http });
    const eqnr = instrument("EQNR", "XOSL");
    const aapl = instrument("AAPL", "XNAS");
    const quotes = await data.fetchQuotes([eqnr, aapl]);
    expect(quotes.get(aapl.id)?.price.toFixed()).toBe("356.3");
    expect(quotes.get(eqnr.id)?.price.toFixed()).toBe("407.6");
    expect(data.isDelayed("XOSL")).toBe(true);
    expect(data.isDelayed("XNAS")).toBe(false);
  });

  it("falls back to Yahoo when Finnhub fails, and uses Yahoo alone without a key", async () => {
    const answers = { "finnhub.io": 429, "/v7/finance/spark": fixture("spark.json") };
    const aapl = instrument("AAPL", "XNAS");
    const withKey = await createLiveMarketData({
      finnhubApiKey: "key",
      http: fakeHttp(answers),
    }).fetchQuotes([aapl]);
    expect(withKey.get(aapl.id)?.price.toFixed()).toBe("356.27");

    const http = fakeHttp(answers);
    const withoutKey = await createLiveMarketData({ http }).fetchQuotes([aapl]);
    expect(withoutKey.get(aapl.id)?.price.toFixed()).toBe("356.27");
    expect(http.urls.some((url) => url.includes("finnhub"))).toBe(false);
  });

  it("sends a big batch of US shares to Yahoo's batched endpoint", async () => {
    const http = fakeHttp({ "/v7/finance/spark": fixture("spark.json") });
    const many = Array.from({ length: 30 }, (_, index) =>
      instrument(`T${String.fromCharCode(65 + (index % 26))}${index < 26 ? "" : "X"}`, "XNAS"),
    );
    await createLiveMarketData({ finnhubApiKey: "key", http }).fetchQuotes(many);
    expect(http.urls.some((url) => url.includes("finnhub"))).toBe(false);
    // 30 symbols, 20 per request.
    expect(http.urls).toHaveLength(2);
  });
});
