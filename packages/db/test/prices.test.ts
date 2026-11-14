import { randomUUID } from "node:crypto";

import {
  type Currency,
  decimal,
  fixedClock,
  instant,
  type Instrument,
  isPriceStale,
  PriceDataError,
} from "@aksjeliga/core";
import { eq, inArray, like, sql } from "drizzle-orm";
import type { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  CachedPriceProvider,
  createQuote,
  type DailyHistory,
  type Database,
  executeTrade,
  type ListedInstrument,
  loadExchanges,
  type MarketData,
  MarketDataError,
  schema,
  type SourcePoint,
  type SourceQuote,
  syncInstruments,
} from "../src";

import { connect, createTestLeague, createTestUser, T } from "./helpers";

const { db, close } = connect();
afterAll(close);

/** A market-data source that answers from memory and counts how often it is asked. */
class FakeMarketData implements MarketData {
  readonly exchangeIds = ["XOSL", "XNAS"];
  down = false;
  delayMs = 0;
  quotes = new Map<string, SourceQuote>();
  daily = new Map<string, DailyHistory>();
  intraday = new Map<string, SourcePoint[]>();
  fx = new Map<Currency, SourceQuote>();
  fxIntraday = new Map<Currency, SourcePoint[]>();
  fxDaily = new Map<Currency, SourcePoint[]>();
  listed = new Map<string, ListedInstrument[]>();
  readonly calls = {
    quotes: [] as string[][],
    daily: [] as DateTime[],
    intraday: 0,
    fxQuotes: 0,
    fxIntraday: 0,
    fxDaily: 0,
  };

  private async answer<T>(value: () => T): Promise<T> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.down) throw new MarketDataError("The source is down");
    return value();
  }

  isDelayed(exchangeId: string): boolean {
    return exchangeId === "XOSL";
  }
  fetchQuotes(instruments: readonly Instrument[]) {
    this.calls.quotes.push(instruments.map((instrument) => instrument.id));
    return this.answer(
      () =>
        new Map(
          instruments.flatMap((instrument) => {
            const quote = this.quotes.get(instrument.id);
            return quote ? [[instrument.id, quote] as const] : [];
          }),
        ),
    );
  }
  fetchIntraday(instrument: Instrument) {
    this.calls.intraday += 1;
    return this.answer(() => this.intraday.get(instrument.id) ?? []);
  }
  fetchDaily(instrument: Instrument, from: DateTime) {
    this.calls.daily.push(from);
    return this.answer(
      () => this.daily.get(instrument.id) ?? { bars: [], splits: [], dividends: [] },
    );
  }
  fetchFxQuotes(currencies: readonly Currency[]) {
    this.calls.fxQuotes += 1;
    return this.answer(
      () =>
        new Map(
          currencies.flatMap((currency) => {
            const quote = this.fx.get(currency);
            return quote ? [[currency, quote] as const] : [];
          }),
        ),
    );
  }
  fetchFxIntraday(currency: Currency) {
    this.calls.fxIntraday += 1;
    return this.answer(() => this.fxIntraday.get(currency) ?? []);
  }
  fetchFxDaily(currency: Currency) {
    this.calls.fxDaily += 1;
    return this.answer(() => this.fxDaily.get(currency) ?? []);
  }
  listInstruments(exchangeId: string) {
    return this.answer(() => this.listed.get(exchangeId) ?? []);
  }
}

/** A fresh instrument per test, inactive so it never shows up in other tests' lists. */
async function testInstrument(exchangeId: "XOSL" | "XNAS" = "XOSL"): Promise<Instrument> {
  const ticker = `T${randomUUID().replaceAll("-", "").slice(0, 11).toUpperCase()}`;
  const currency = exchangeId === "XOSL" ? "NOK" : "USD";
  const [row] = await db
    .insert(schema.instruments)
    .values({ ticker, name: `Test ${ticker}`, exchangeId, currency, isActive: false })
    .returning();
  if (!row) throw new Error("insert failed");
  return { id: row.id, ticker, isin: null, name: row.name, exchangeId, currency };
}

async function providerAt(now: DateTime, marketData: MarketData, database: Database = db) {
  return new CachedPriceProvider({
    db: database,
    clock: fixedClock(now),
    exchanges: await loadExchanges(db),
    marketData,
    sleep: () => Promise.resolve(),
  });
}

const price = (value: string, at: DateTime): SourceQuote => ({ price: decimal(value), at });
const bar = (date: string, close: string) => ({ date, close: decimal(close) });

/** FX state is shared by every test, so each test starts without any. */
async function clearFx(): Promise<void> {
  await db.delete(schema.fxRates);
  await db.delete(schema.priceFetchState).where(like(schema.priceFetchState.key, "fx%"));
}
beforeEach(clearFx);

/** Oslo closed at 15:20Z on Tuesday 27 Oct 2026 (T is 15:00Z, while it is open). */
const OSLO_CLOSE = instant("2026-10-27T15:20:00Z");
const MONDAY_CLOSE = instant("2026-10-26T15:20:00Z");
const EVENING = instant("2026-10-27T18:00:00Z");

describe("live quotes", () => {
  it("fetches a price once, stores it, and reuses it for a minute", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    source.quotes.set(stock.id, price("101.5", T.minus({ minutes: 15 })));

    const first = await (await providerAt(T, source)).getQuote(stock.id, T);
    expect(first.price.amount.toFixed()).toBe("101.5");
    expect(first.source).toBe("live");
    // `at` is the last trade according to the source; `checkedAt` is when we asked.
    expect(first.at.toMillis()).toBe(T.minus({ minutes: 15 }).toMillis());
    expect(first.checkedAt.toMillis()).toBe(T.toMillis());
    expect(first.delayed).toBe(true);

    source.quotes.set(stock.id, price("102", T));
    const soon = T.plus({ seconds: 30 });
    const second = await (await providerAt(soon, source)).getQuote(stock.id, soon);
    expect(second.price.amount.toFixed()).toBe("101.5");
    expect(source.calls.quotes).toHaveLength(1);

    const later = T.plus({ seconds: 61 });
    const third = await (await providerAt(later, source)).getQuote(stock.id, later);
    expect(third.price.amount.toFixed()).toBe("102");
    expect(third.checkedAt.toMillis()).toBe(later.toMillis());
    expect(source.calls.quotes).toHaveLength(2);
  });

  it("asks the source once for all prices needed at the same time", async () => {
    const source = new FakeMarketData();
    const stocks = await Promise.all([testInstrument(), testInstrument(), testInstrument("XNAS")]);
    stocks.forEach((stock, index) => source.quotes.set(stock.id, price(String(10 + index), T)));

    const provider = await providerAt(T, source);
    const quotes = await Promise.all(stocks.map((stock) => provider.getQuote(stock.id, T)));
    expect(quotes.map((quote) => quote.price.amount.toFixed())).toEqual(["10", "11", "12"]);
    expect(quotes.map((quote) => quote.delayed)).toEqual([true, true, false]);
    expect(source.calls.quotes).toHaveLength(1);
    expect(source.calls.quotes[0]).toHaveLength(3);
    // Asking again within the request does not ask the source again.
    await provider.getQuote(stocks[0].id, T);
    expect(source.calls.quotes).toHaveLength(1);
  });

  it("lets only one of many simultaneous requests fetch a stale price", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    source.quotes.set(stock.id, price("50", T));
    await (await providerAt(T, source)).getQuote(stock.id, T);

    source.delayMs = 50;
    const later = T.plus({ minutes: 2 });
    const quotes = await Promise.all(
      Array.from({ length: 5 }, async () =>
        (await providerAt(later, source)).getQuote(stock.id, later),
      ),
    );
    expect(quotes).toHaveLength(5);
    expect(source.calls.quotes).toHaveLength(2);
  });

  it("keeps serving the stored price when the source is down, and marks it as old", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    source.quotes.set(stock.id, price("75.25", T));
    await (await providerAt(T, source)).getQuote(stock.id, T);

    source.down = true;
    const later = T.plus({ minutes: 10 });
    const quote = await (await providerAt(later, source)).getQuote(stock.id, later);
    expect(quote.price.amount.toFixed()).toBe("75.25");
    expect(quote.checkedAt.toMillis()).toBe(T.toMillis());
    expect(isPriceStale(quote, later)).toBe(true);
    expect(isPriceStale(quote, T.plus({ minutes: 4 }))).toBe(false);

    const [state] = await db
      .select()
      .from(schema.priceFetchState)
      .where(eq(schema.priceFetchState.key, `quote:${stock.id}`));
    expect(state?.lastError).toBe("The source is down");
    // A failing source is not asked again within the minute.
    const again = later.plus({ seconds: 20 });
    await (await providerAt(again, source)).getQuote(stock.id, again);
    expect(source.calls.quotes).toHaveLength(2);
  });

  it("fails clearly when there has never been a price", async () => {
    const source = new FakeMarketData();
    source.down = true;
    const stock = await testInstrument();
    await expect((await providerAt(T, source)).getQuote(stock.id, T)).rejects.toThrow(
      PriceDataError,
    );
  });

  it("has no prices for an exchange without a source", async () => {
    const source = new FakeMarketData();
    const [volvo] = await db
      .select()
      .from(schema.instruments)
      .where(eq(schema.instruments.exchangeId, "XSTO"))
      .limit(1);
    await expect((await providerAt(T, source)).getQuote(volvo!.id, T)).rejects.toThrow(
      /No price source/,
    );
  });
});

describe("trading on cached prices", () => {
  async function leagueWith(stock: Instrument) {
    const owner = await createTestUser(db, "Ola");
    const league = await createTestLeague(db, owner, { allowedExchangeIds: [stock.exchangeId] });
    return { owner, ...league };
  }
  const order = (stock: Instrument) => ({
    type: "market" as const,
    side: "buy" as const,
    instrumentId: stock.id,
    quantity: decimal("10"),
  });

  it("prices and executes a trade from the cache", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument("XNAS");
    source.quotes.set(stock.id, price("182.40", T));
    source.fx.set("NOK", price("10.8421", T));
    for (const currency of ["SEK", "DKK", "EUR"] as const) source.fx.set(currency, price("1", T));
    const { owner, leagueId } = await leagueWith(stock);

    const provider = await providerAt(T, source);
    const quoted = await createQuote(db, provider, {
      userId: owner,
      leagueId,
      order: order(stock),
      now: T,
    });
    if (!quoted.ok) throw new Error(JSON.stringify(quoted.rejections));
    expect(quoted.quote.price.amount.toFixed()).toBe("182.4");
    expect(quoted.quote.fxRate.rate.toFixed()).toBe("10.8421");
    // 10 × 182.40 × 10.8421 = 19 775.9904, booked as 19 775.99.
    expect(quoted.quote.grossAmount.amount.toFixed(2)).toBe("19775.99");

    const confirmAt = T.plus({ seconds: 10 });
    const traded = await executeTrade(db, await providerAt(confirmAt, source), {
      userId: owner,
      quoteId: quoted.quote.id,
      idempotencyKey: randomUUID(),
      now: confirmAt,
    });
    expect(traded.ok).toBe(true);
    // One fetch of the quote and one of the FX rates, for both steps together.
    expect(source.calls.quotes).toHaveLength(1);
    expect(source.calls.fxQuotes).toBe(1);
  });

  it("refuses to lock a price the source has not confirmed for five minutes", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    source.quotes.set(stock.id, price("100", T));
    const { owner, leagueId } = await leagueWith(stock);
    await (await providerAt(T, source)).getQuote(stock.id, T);

    source.down = true;
    const later = T.plus({ minutes: 6 });
    const result = await createQuote(db, await providerAt(later, source), {
      userId: owner,
      leagueId,
      order: order(stock),
      now: later,
    });
    expect(result).toEqual({ ok: false, rejections: [{ code: "PRICE_STALE" }] });
  });
});

describe("closing prices", () => {
  it("uses the last close when the exchange is closed, fetched once", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    source.daily.set(stock.id, {
      bars: [bar("2026-10-26", "98"), bar("2026-10-27", "100.1234")],
      splits: [],
      dividends: [],
    });

    const provider = await providerAt(EVENING, source);
    const quote = await provider.getQuote(stock.id, EVENING);
    expect(quote.source).toBe("last_close");
    expect(quote.price.amount.toFixed()).toBe("100.1234");
    expect(quote.at.toMillis()).toBe(OSLO_CLOSE.toMillis());
    expect((await provider.getLastClose(stock.id, T)).price.amount.toFixed()).toBe("98");
    expect((await provider.getLastClose(stock.id, T)).closedAt.toMillis()).toBe(
      MONDAY_CLOSE.toMillis(),
    );

    const nextMorning = instant("2026-10-28T06:00:00Z");
    await (await providerAt(nextMorning, source)).getQuote(stock.id, nextMorning);
    expect(source.calls.daily).toHaveLength(1);
    // The first fetch asks for two years, enough for the one-year chart.
    expect(source.calls.daily[0]!.toMillis()).toBeLessThanOrEqual(
      EVENING.minus({ years: 2 }).toMillis(),
    );
  });

  it("treats a close fetched right after the bell as provisional", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    // Five minutes after the close a delayed source still shows an earlier price.
    source.daily.set(stock.id, { bars: [bar("2026-10-27", "100")], splits: [], dividends: [] });
    const early = OSLO_CLOSE.plus({ minutes: 5 });
    const first = await (await providerAt(early, source)).getQuote(stock.id, early);
    expect(first.price.amount.toFixed()).toBe("100");

    source.daily.set(stock.id, { bars: [bar("2026-10-27", "101")], splits: [], dividends: [] });
    const settled = OSLO_CLOSE.plus({ minutes: 40 });
    const second = await (await providerAt(settled, source)).getQuote(stock.id, settled);
    expect(second.price.amount.toFixed()).toBe("101");

    // Once final, a close never changes and is not fetched again.
    source.daily.set(stock.id, { bars: [bar("2026-10-27", "999")], splits: [], dividends: [] });
    const third = await (await providerAt(EVENING, source)).getQuote(stock.id, EVENING);
    expect(third.price.amount.toFixed()).toBe("101");
    expect(source.calls.daily).toHaveLength(2);
  });

  it("keeps the close before a day without trades, without asking again and again", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    source.daily.set(stock.id, { bars: [bar("2026-10-26", "55")], splits: [], dividends: [] });
    const provider = await providerAt(EVENING, source);
    expect((await provider.getLastClose(stock.id, EVENING)).price.amount.toFixed()).toBe("55");
    const later = EVENING.plus({ hours: 2 });
    await (await providerAt(later, source)).getLastClose(stock.id, later);
    expect(source.calls.daily).toHaveLength(1);
  });
});

describe("history and corporate actions", () => {
  it("stores prices as traded and adjusts charts for splits", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    // 4:1 split effective Tuesday 27 Oct: Monday closed at 400, Tuesday at 101.
    source.daily.set(stock.id, {
      bars: [bar("2026-10-23", "396"), bar("2026-10-26", "400"), bar("2026-10-27", "101")],
      splits: [{ effectiveDate: "2026-10-27", ratioFrom: decimal("1"), ratioTo: decimal("4") }],
      dividends: [
        { exDate: "2026-10-26", amount: decimal("2.5") },
        { exDate: "2026-01-15", amount: decimal("9") },
      ],
    });
    const provider = await providerAt(EVENING, source);

    // Valuing Monday evening needs Monday's real price: the holder had the old quantity.
    const monday = await provider.getLastClose(stock.id, instant("2026-10-26T20:00:00Z"));
    expect(monday.price.amount.toFixed()).toBe("400");

    const chart = await provider.getPriceHistory(
      stock.id,
      EVENING.minus({ months: 1 }),
      EVENING,
      "1d",
    );
    expect(chart.map((point) => point.price.amount.toFixed())).toEqual(["99", "100", "101"]);
    expect(chart.at(-1)?.at.toMillis()).toBe(OSLO_CLOSE.toMillis());

    const actions = await provider.getCorporateActions(
      stock.id,
      EVENING.minus({ days: 60 }),
      EVENING,
    );
    const split = actions.find((action) => action.kind === "split");
    const dividend = actions.find((action) => action.kind === "dividend");
    expect(split).toMatchObject({ effectiveDate: "2026-10-27" });
    // No pay date from the source: paid on the ex-date. The old dividend is not stored.
    expect(dividend).toMatchObject({ exDate: "2026-10-26", payDate: "2026-10-26" });
    expect(actions).toHaveLength(2);
    // Reported again with the same ids, so the job never books one twice.
    const again = await provider.getCorporateActions(
      stock.id,
      EVENING.minus({ days: 60 }),
      EVENING,
    );
    expect(again.map((action) => action.id).sort()).toEqual(
      actions.map((action) => action.id).sort(),
    );
    expect(source.calls.daily).toHaveLength(1);
  });

  it("shows only regular trading hours in the intraday chart", async () => {
    const source = new FakeMarketData();
    const stock = await testInstrument();
    const open = instant("2026-10-27T08:00:00Z");
    source.intraday.set(stock.id, [
      { at: open.minus({ minutes: 10 }), value: decimal("9") },
      { at: open.plus({ minutes: 5 }), value: decimal("10") },
      { at: open.plus({ minutes: 60 }), value: decimal("11") },
      { at: open.plus({ minutes: 65 }), value: decimal("12") },
      { at: OSLO_CLOSE, value: decimal("13") },
      { at: OSLO_CLOSE.plus({ minutes: 5 }), value: decimal("14") },
    ]);
    const provider = await providerAt(EVENING, source);
    const fiveMinutes = await provider.getPriceHistory(stock.id, open, EVENING, "5m");
    expect(fiveMinutes.map((point) => point.price.amount.toFixed())).toEqual([
      "10",
      "11",
      "12",
      "13",
    ]);
    const hourly = await provider.getPriceHistory(stock.id, open, EVENING, "1h");
    expect(hourly.map((point) => point.price.amount.toFixed())).toEqual(["11", "13"]);
    expect(source.calls.intraday).toBe(1);
  });
});

describe("exchange rates", () => {
  function liveFx(source: FakeMarketData, at: DateTime) {
    source.fx.set("NOK", price("10", at));
    source.fx.set("SEK", price("9.5", at));
    source.fx.set("DKK", price("6.8", at));
    source.fx.set("EUR", price("0.92", at));
  }

  it("derives any pair from the dollar rates and reuses them for a minute", async () => {
    const source = new FakeMarketData();
    liveFx(source, T);
    const provider = await providerAt(T, source);
    expect((await provider.getFxRate("USD", "NOK", T)).rate.toFixed()).toBe("10");
    expect((await provider.getFxRate("NOK", "USD", T)).rate.toFixed()).toBe("0.1");
    expect((await provider.getFxRate("NOK", "SEK", T)).rate.toFixed()).toBe("0.95");
    expect((await provider.getFxRate("NOK", "NOK", T)).rate.toFixed()).toBe("1");

    const soon = T.plus({ seconds: 40 });
    await (await providerAt(soon, source)).getFxRate("USD", "NOK", soon);
    expect(source.calls.fxQuotes).toBe(1);
    const later = T.plus({ seconds: 70 });
    await (await providerAt(later, source)).getFxRate("USD", "NOK", later);
    expect(source.calls.fxQuotes).toBe(2);
  });

  it("freezes the rate at an earlier moment, such as an exchange's close", async () => {
    const source = new FakeMarketData();
    liveFx(source, EVENING);
    source.fxIntraday.set("NOK", [
      { at: OSLO_CLOSE.minus({ minutes: 5 }), value: decimal("10.5") },
      { at: OSLO_CLOSE.plus({ minutes: 5 }), value: decimal("10.7") },
    ]);
    const provider = await providerAt(EVENING, source);
    expect((await provider.getFxRate("USD", "NOK", OSLO_CLOSE)).rate.toFixed()).toBe("10.5");
    expect((await provider.getFxRate("USD", "NOK", EVENING)).rate.toFixed()).toBe("10");
    // Asked again later for the same past moment: already stored.
    const later = EVENING.plus({ hours: 1 });
    expect(
      (await (await providerAt(later, source)).getFxRate("USD", "NOK", OSLO_CLOSE)).rate.toFixed(),
    ).toBe("10.5");
    expect(source.calls.fxIntraday).toBe(1);
  });

  it("uses daily rates for moments more than a week ago", async () => {
    const source = new FakeMarketData();
    const monthAgo = instant("2026-09-25T15:20:00Z");
    source.fxDaily.set("NOK", [
      { at: instant("2026-09-25T00:00:00Z"), value: decimal("11.1") },
      { at: instant("2026-09-26T00:00:00Z"), value: decimal("11.2") },
    ]);
    const provider = await providerAt(EVENING, source);
    expect((await provider.getFxRate("USD", "NOK", monthAgo)).rate.toFixed()).toBe("11.1");
    expect(source.calls.fxDaily).toBe(1);
    expect(source.calls.fxIntraday).toBe(0);
  });

  it("fails clearly when the source has no rates", async () => {
    const source = new FakeMarketData();
    source.down = true;
    await expect((await providerAt(T, source)).getFxRate("USD", "NOK", T)).rejects.toThrow(
      PriceDataError,
    );
  });
});

describe("syncInstruments", () => {
  class Rollback extends Error {}

  /** Runs against the real tables, then rolls everything back. */
  async function inRollback(run: (tx: Database) => Promise<void>): Promise<void> {
    await db
      .transaction(async (tx) => {
        await run(tx);
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  }

  const listing = (count: number, prefix: string): ListedInstrument[] =>
    Array.from({ length: count }, (_, index) => ({
      ticker: `${prefix}${String(index)}`,
      name: `${prefix} COMPANY ${String(index)} ASA`,
      isin: null,
      currency: "NOK" as const,
    }));

  it("adds new shares, retires ones that left the list and brings back returning ones", async () => {
    await inRollback(async (tx) => {
      const source = new FakeMarketData();
      const before = await tx
        .select()
        .from(schema.instruments)
        .where(eq(schema.instruments.exchangeId, "XOSL"));
      const equinor = before.find((row) => row.ticker === "EQNR")!;
      const dnb = before.find((row) => row.ticker === "DNB")!;
      await tx
        .update(schema.instruments)
        .set({ isActive: false })
        .where(eq(schema.instruments.id, dnb.id));

      source.listed.set("XOSL", [
        ...listing(60, "ZZ"),
        { ticker: "DNB", name: "DNB BANK", isin: dnb.isin, currency: "NOK" },
      ]);
      // XNAS has no list in this fake: too short to be believed, so it is left alone.
      const report = await syncInstruments(tx, source);
      expect(report.added).toBe(60);
      expect(report.reactivated).toBe(1);
      expect(report.deactivated).toBe(before.filter((row) => row.isActive).length - 1);
      expect(report.failed).toEqual(["XNAS"]);

      const after = await tx
        .select()
        .from(schema.instruments)
        .where(inArray(schema.instruments.ticker, ["EQNR", "DNB", "ZZ7"]));
      const byTicker = new Map(after.map((row) => [row.ticker, row]));
      // Retired, not deleted: trades refer to it. Its name is kept as we had it.
      expect(byTicker.get("EQNR")).toMatchObject({ id: equinor.id, isActive: false });
      expect(byTicker.get("DNB")).toMatchObject({ isActive: true, name: dnb.name });
      expect(byTicker.get("ZZ7")).toMatchObject({ name: "ZZ Company 7 ASA", isActive: true });

      // Running it again changes nothing.
      expect(await syncInstruments(tx, source)).toMatchObject({
        added: 0,
        reactivated: 0,
        deactivated: 0,
      });
      const [{ nasdaq } = { nasdaq: 0 }] = await tx
        .select({ nasdaq: sql<number>`count(*)::int` })
        .from(schema.instruments)
        .where(eq(schema.instruments.exchangeId, "XNAS"));
      expect(nasdaq).toBeGreaterThan(0);
    });
  });

  it("leaves an exchange untouched when its list cannot be fetched", async () => {
    await inRollback(async (tx) => {
      const source = new FakeMarketData();
      source.down = true;
      expect(await syncInstruments(tx, source)).toEqual({
        added: 0,
        reactivated: 0,
        deactivated: 0,
        failed: ["XOSL", "XNAS"],
      });
    });
  });
});
