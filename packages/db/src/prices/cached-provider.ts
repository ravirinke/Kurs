import {
  type Clock,
  type ClosingPrice,
  type CorporateAction,
  CURRENCIES,
  type Currency,
  decimal,
  type Decimal,
  type Exchange,
  type ExchangeId,
  fxRate,
  type FxRate,
  getLastCloseAt,
  getMarketStatus,
  getSession,
  identityRate,
  type Instrument,
  type InstrumentId,
  isMarketOpen,
  localDate,
  type MarketStatus,
  Money,
  ONE,
  PriceDataError,
  type PricePoint,
  type PriceProvider,
  type PriceQuote,
  type PriceResolution,
  splitFactor,
  startOfExchangeDay,
} from "@aksjeliga/core";
import type { DateTime } from "luxon";

import type { Database } from "../client";
import {
  loadReportedCorporateActions,
  storeCorporateActions,
} from "../repositories/corporate-actions";
import { loadInstruments } from "../repositories/reference";

import { Batcher } from "./batcher";
import { type DailyHistory, type MarketData, MarketDataError } from "./sources/types";
import {
  claimFetch,
  fxAtOrBefore,
  lastPriceAtOrBefore,
  loadFetchState,
  loadLatestQuotes,
  markFailed,
  markFetched,
  pricesBetween,
  saveFxPoints,
  saveLatestQuotes,
  savePrices,
  type StoredPrice,
  type StoredQuote,
} from "./store";

/*
 * The real PriceProvider: a read-through cache in Postgres in front of the market-data
 * sources. Users always read prices from the database. When what is stored is too old, the
 * server fetches it, stores it and uses it. A source being down only makes prices older:
 * the stored ones are still returned, with the time they are from.
 *
 * Stored prices are as traded (not adjusted for later splits), so a stored row never has to
 * be rewritten; charts are adjusted when they are read.
 */

/** A live quote or FX rate is fetched again when it is older than this. */
export const LIVE_MAX_AGE_SECONDS = 60;
/** A request within this of "now" wants the current price; older ones are history. */
const LIVE_WINDOW_MINUTES = 2;
/**
 * A close is final when fetched at least this long after the closing time: by then the
 * closing auction is over and a delayed source has caught up.
 */
export const SETTLE_MINUTES = 30;
/** Daily history fetched the first time an instrument is needed. */
const HISTORY_YEARS = 2;
/** Overlap when topping up daily history, so late corrections are picked up. */
const DAILY_OVERLAP_DAYS = 10;
/** 5-minute bars are kept and fetched for about a week. */
const INTRADAY_DAYS = 8;
/** Splits and dividends are looked for again when the daily history is older than this. */
const CORPORATE_ACTIONS_MAX_AGE_HOURS = 6;
/** Dividends older than this are not stored: no league can still be owed them. */
const DIVIDEND_LOOKBACK_DAYS = 90;
/** How long to wait for another server instance that is fetching the same thing. */
const WAIT_POLL_MS = 300;
const WAIT_POLLS = 12;

const BASE: Currency = "USD";
/** Start of the ids of the corporate actions this provider reports. */
const ACTION_ID_PREFIX = "live:";

export interface CachedPriceProviderOptions {
  db: Database;
  clock: Clock;
  exchanges: readonly Exchange[];
  marketData: MarketData;
  /** Replaces the wait between polls in tests. */
  sleep?: (ms: number) => Promise<void>;
}

function earliest(a: DateTime, b: DateTime): DateTime {
  return a.toMillis() <= b.toMillis() ? a : b;
}

export class CachedPriceProvider implements PriceProvider {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly exchanges: ReadonlyMap<ExchangeId, Exchange>;
  private readonly marketData: MarketData;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly instruments: Batcher<InstrumentId, Instrument>;
  /** Live quotes asked for in the same tick become one request to the source. */
  private readonly liveQuotes: Batcher<InstrumentId, StoredQuote | null>;
  /** Results reused for the lifetime of this provider (one request or one job run). */
  private readonly memo = new Map<string, Promise<unknown>>();
  /** Fetches of one series run one at a time, so the second sees what the first stored. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(options: CachedPriceProviderOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.exchanges = new Map(options.exchanges.map((exchange) => [exchange.id, exchange]));
    this.marketData = options.marketData;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.instruments = new Batcher(async (ids) => {
      const loaded = await loadInstruments(this.db, ids);
      return new Map(loaded.map((instrument) => [instrument.id, instrument]));
    });
    this.liveQuotes = new Batcher((ids) => this.refreshLiveQuotes(ids));
  }

  // ---------------------------------------------------------------- PriceProvider

  async getQuote(instrumentId: InstrumentId, at?: DateTime): Promise<PriceQuote> {
    const time = at ?? this.clock.now();
    const { instrument, exchange } = await this.lookup(instrumentId);
    const delayed = this.marketData.isDelayed(exchange.id);

    if (!isMarketOpen(exchange, time)) {
      const close = await this.closeAt(instrument, exchange, time);
      return {
        instrumentId,
        price: close.price,
        at: close.closedAt,
        source: "last_close",
        checkedAt: time,
        delayed,
      };
    }

    if (this.isLive(time)) {
      const quote = await this.liveQuotes.load(instrumentId);
      if (quote) {
        return {
          instrumentId,
          price: Money.of(quote.price, instrument.currency),
          at: quote.at,
          source: "live",
          checkedAt: quote.fetchedAt,
          delayed,
        };
      }
    } else {
      // A past moment while the exchange was open: 5-minute bars for the last week, and
      // the close before it for anything older.
      if (time.toMillis() >= this.clock.now().minus({ days: INTRADAY_DAYS }).toMillis())
        await this.ensureIntraday(instrument, exchange);
      await this.ensureDaily(instrument, exchange, {
        from: time,
        closedAt: getLastCloseAt(exchange, time),
      });
    }

    // History, or the source has never given us a quote: the newest stored price.
    const stored = await lastPriceAtOrBefore(this.db, instrumentId, time);
    if (!stored) throw new PriceDataError(`No price for ${instrument.ticker}`);
    return {
      instrumentId,
      price: Money.of(stored.price, instrument.currency),
      at: stored.at,
      source: "live",
      checkedAt: stored.fetchedAt,
      delayed,
    };
  }

  async getLastClose(instrumentId: InstrumentId, at?: DateTime): Promise<ClosingPrice> {
    const { instrument, exchange } = await this.lookup(instrumentId);
    return this.closeAt(instrument, exchange, at ?? this.clock.now());
  }

  async getFxRate(from: Currency, to: Currency, at?: DateTime): Promise<FxRate> {
    if (from === to) return identityRate(from);
    const time = at ?? this.clock.now();
    const [perUsdFrom, perUsdTo] = await Promise.all([
      this.perUsd(from, time),
      this.perUsd(to, time),
    ]);
    return fxRate(from, to, perUsdTo.dividedBy(perUsdFrom));
  }

  getMarketStatus(exchangeId: ExchangeId, at?: DateTime): Promise<MarketStatus> {
    const exchange = this.exchanges.get(exchangeId);
    if (!exchange) return Promise.reject(new PriceDataError(`Unknown exchange ${exchangeId}`));
    return Promise.resolve(getMarketStatus(exchange, at ?? this.clock.now()));
  }

  async getCorporateActions(
    instrumentId: InstrumentId,
    from: DateTime,
    to: DateTime,
  ): Promise<CorporateAction[]> {
    const { instrument, exchange } = await this.lookup(instrumentId);
    await this.ensureDaily(instrument, exchange, {
      from,
      closedAt: null,
      maxAgeHours: CORPORATE_ACTIONS_MAX_AGE_HOURS,
    });
    const inRange = (date: string) => {
      const start = startOfExchangeDay(exchange, date).toMillis();
      return start >= from.toMillis() && start <= to.toMillis();
    };
    return (await this.storedActions(instrumentId)).filter((action) =>
      inRange(action.kind === "split" ? action.effectiveDate : action.exDate),
    );
  }

  async getPriceHistory(
    instrumentId: InstrumentId,
    from: DateTime,
    to: DateTime,
    resolution: PriceResolution,
  ): Promise<PricePoint[]> {
    const { instrument, exchange } = await this.lookup(instrumentId);
    const now = this.clock.now();
    const end = earliest(to, now);
    if (end.toMillis() < from.toMillis()) return [];

    let points: { at: DateTime; price: Decimal }[];
    if (resolution === "1d") {
      await this.ensureDaily(instrument, exchange, {
        from,
        closedAt: getLastCloseAt(exchange, end),
      });
      points = await pricesBetween(this.db, instrumentId, "close", from, end);
      if (isMarketOpen(exchange, end) && this.isLive(end)) {
        // Today's point is the price so far.
        const quote = await this.getQuote(instrumentId, end);
        points.push({ at: end, price: quote.price.amount });
      }
    } else {
      await this.ensureIntraday(instrument, exchange);
      const bars = await pricesBetween(this.db, instrumentId, "intraday", from, end);
      points = resolution === "5m" ? bars : this.hourly(bars, exchange);
    }

    // Stored prices are as traded; a chart must not jump at a split.
    const splits = (await this.storedActions(instrumentId)).flatMap((action) =>
      action.kind === "split"
        ? [{ at: startOfExchangeDay(exchange, action.effectiveDate), factor: splitFactor(action) }]
        : [],
    );
    return points.map((point) => {
      const factor = splits
        .filter(
          (split) =>
            split.at.toMillis() > point.at.toMillis() && split.at.toMillis() <= now.toMillis(),
        )
        .reduce((product, split) => product.times(split.factor), ONE);
      return {
        at: point.at,
        price: Money.of(point.price.dividedBy(factor), instrument.currency),
      };
    });
  }

  // ---------------------------------------------------------------- lookups

  private async lookup(
    instrumentId: InstrumentId,
  ): Promise<{ instrument: Instrument; exchange: Exchange }> {
    let instrument: Instrument;
    try {
      instrument = await this.instruments.load(instrumentId);
    } catch (error) {
      if (error instanceof RangeError)
        throw new PriceDataError(`Unknown instrument ${instrumentId}`);
      throw error;
    }
    const exchange = this.exchanges.get(instrument.exchangeId);
    if (!exchange) throw new PriceDataError(`Unknown exchange ${instrument.exchangeId}`);
    if (!this.marketData.exchangeIds.includes(exchange.id))
      throw new PriceDataError(`No price source for ${exchange.name}`);
    return { instrument, exchange };
  }

  private isLive(time: DateTime): boolean {
    const age = this.clock.now().toMillis() - time.toMillis();
    return Math.abs(age) <= LIVE_WINDOW_MINUTES * 60_000;
  }

  private remember<T>(key: string, compute: () => Promise<T>): Promise<T> {
    let result = this.memo.get(key) as Promise<T> | undefined;
    if (!result) {
      result = compute();
      this.memo.set(key, result);
      // A failure is not remembered: the next caller tries again.
      result.catch(() => this.memo.delete(key));
    }
    return result;
  }

  /** Runs `task` after the previous task with the same key has finished. */
  private inTurn<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private storedActions(instrumentId: InstrumentId): Promise<CorporateAction[]> {
    return loadReportedCorporateActions(this.db, instrumentId, ACTION_ID_PREFIX);
  }

  /** The points at whole hours after the open, plus each day's last bar. */
  private hourly(
    bars: readonly { at: DateTime; price: Decimal }[],
    exchange: Exchange,
  ): { at: DateTime; price: Decimal }[] {
    return bars.filter((bar, index) => {
      const session = getSession(exchange, localDate(bar.at, exchange.timeZone));
      if (!session) return false;
      const minutes = Math.round((bar.at.toMillis() - session.opensAt.toMillis()) / 60_000);
      const next = bars[index + 1];
      const lastOfDay =
        !next || localDate(next.at, exchange.timeZone) !== localDate(bar.at, exchange.timeZone);
      return minutes % 60 === 0 || lastOfDay;
    });
  }

  // ---------------------------------------------------------------- fetching

  /**
   * Claims the fetch of one series and runs it. When another server instance holds the
   * claim, waits a moment for its result instead. A failing source is recorded, not thrown:
   * the caller goes on with what is stored.
   */
  private async refresh(
    key: string,
    fetch: () => Promise<{ coveredFrom?: DateTime }>,
  ): Promise<void> {
    const now = this.clock.now();
    const claimed = await claimFetch(this.db, [key], now, LIVE_MAX_AGE_SECONDS);
    if (!claimed.has(key)) {
      await this.waitForOther(key);
      return;
    }
    try {
      const { coveredFrom } = await fetch();
      await markFetched(this.db, [key], now, coveredFrom);
    } catch (error) {
      if (!(error instanceof MarketDataError)) throw error;
      await markFailed(this.db, [key], now, error);
    }
  }

  private async waitForOther(key: string): Promise<void> {
    for (let poll = 0; poll < WAIT_POLLS; poll++) {
      const state = await loadFetchState(this.db, key);
      if (!state) return;
      // The other instance has finished (or failed) the attempt it claimed.
      const since = (at: DateTime | null) =>
        at !== null && at.toMillis() >= state.attemptedAt.toMillis();
      if (since(state.fetchedAt) || since(state.failedAt)) return;
      await this.sleep(WAIT_POLL_MS);
    }
  }

  private async refreshLiveQuotes(
    ids: readonly InstrumentId[],
  ): Promise<Map<InstrumentId, StoredQuote | null>> {
    const now = this.clock.now();
    const instruments = await Promise.all(ids.map((id) => this.instruments.load(id)));
    const key = (id: InstrumentId) => `quote:${id}`;
    const claimed = await claimFetch(this.db, ids.map(key), now, LIVE_MAX_AGE_SECONDS);
    const stored = await loadLatestQuotes(this.db, ids);

    // Stale ones we claimed, and ones never fetched (even if another instance is at it).
    const toFetch = instruments.filter(
      (instrument) => claimed.has(key(instrument.id)) || !stored.has(instrument.id),
    );
    if (toFetch.length > 0) {
      const keys = toFetch.map((instrument) => key(instrument.id));
      try {
        const fetched = await this.marketData.fetchQuotes(toFetch);
        const answered = toFetch.filter((instrument) => fetched.has(instrument.id));
        const saved = answered.flatMap((instrument) => {
          const quote = fetched.get(instrument.id);
          if (!quote) return [];
          return [
            {
              instrumentId: instrument.id,
              currency: instrument.currency,
              price: quote.price,
              at: quote.at,
              delayed: this.marketData.isDelayed(instrument.exchangeId),
            },
          ];
        });
        await saveLatestQuotes(this.db, saved, now);
        for (const quote of saved) stored.set(quote.instrumentId, { ...quote, fetchedAt: now });
        await markFetched(
          this.db,
          answered.map((instrument) => key(instrument.id)),
          now,
        );
        await markFailed(
          this.db,
          toFetch
            .filter((instrument) => !fetched.has(instrument.id))
            .map((instrument) => key(instrument.id)),
          now,
          "The source has no quote for this instrument",
        );
      } catch (error) {
        if (!(error instanceof MarketDataError)) throw error;
        await markFailed(this.db, keys, now, error);
      }
    }
    return new Map(ids.map((id) => [id, stored.get(id) ?? null]));
  }

  /** The last close at or before `time`, as traded then. */
  private closeAt(
    instrument: Instrument,
    exchange: Exchange,
    time: DateTime,
  ): Promise<ClosingPrice> {
    const closedAt = getLastCloseAt(exchange, time);
    if (!closedAt)
      return Promise.reject(new PriceDataError(`No close found before ${time.toISO() ?? ""}`));
    return this.remember(`close:${instrument.id}:${String(closedAt.toMillis())}`, async () => {
      const settledAt = closedAt.plus({ minutes: SETTLE_MINUTES });
      const isFinal = (row: StoredPrice | null) =>
        row?.at.toMillis() === closedAt.toMillis() &&
        row.fetchedAt.toMillis() >= settledAt.toMillis();
      let stored = await lastPriceAtOrBefore(this.db, instrument.id, closedAt, "close");
      let final = isFinal(stored);
      if (!final) {
        await this.ensureDaily(instrument, exchange, { from: closedAt, closedAt });
        stored = await lastPriceAtOrBefore(this.db, instrument.id, closedAt, "close");
        // A day without trades has no bar: the close before it stands, once the source has
        // been asked late enough to know there is none.
        const state = await loadFetchState(this.db, `daily:${instrument.id}`);
        final =
          isFinal(stored) ||
          ((state?.fetchedAt ?? null) !== null &&
            (state?.fetchedAt?.toMillis() ?? 0) >= settledAt.toMillis());
      }
      if (!stored) throw new PriceDataError(`No closing price for ${instrument.ticker}`);
      return {
        instrumentId: instrument.id,
        price: Money.of(stored.price, instrument.currency),
        closedAt,
        ...(final ? {} : { provisional: true }),
      };
    });
  }

  /**
   * Makes sure the stored daily closes reach back to `from` and, when `closedAt` is given,
   * that they were fetched late enough after that close to be final.
   */
  private ensureDaily(
    instrument: Instrument,
    exchange: Exchange,
    need: { from: DateTime; closedAt: DateTime | null; maxAgeHours?: number },
  ): Promise<void> {
    const key = `daily:${instrument.id}`;
    return this.inTurn(key, async () => {
      const now = this.clock.now();
      const state = await loadFetchState(this.db, key);
      const fetchedAt = state?.fetchedAt ?? null;
      const coveredFrom = state?.coveredFrom ?? null;
      const covers =
        fetchedAt !== null &&
        coveredFrom !== null &&
        coveredFrom.toMillis() <= need.from.toMillis();
      const settled =
        need.closedAt === null ||
        (fetchedAt !== null &&
          fetchedAt.toMillis() >= need.closedAt.plus({ minutes: SETTLE_MINUTES }).toMillis());
      const fresh =
        need.maxAgeHours === undefined ||
        (fetchedAt !== null &&
          fetchedAt.toMillis() >= now.minus({ hours: need.maxAgeHours }).toMillis());
      if (covers && settled && fresh) return;

      const fetchFrom = covers
        ? fetchedAt.minus({ days: DAILY_OVERLAP_DAYS })
        : earliest(
            need.from.minus({ days: DAILY_OVERLAP_DAYS }),
            now.minus({ years: HISTORY_YEARS }),
          );
      await this.refresh(key, async () => {
        const history = await this.marketData.fetchDaily(instrument, fetchFrom);
        await this.storeDaily(instrument, exchange, history);
        return covers ? {} : { coveredFrom: fetchFrom };
      });
    });
  }

  private async storeDaily(
    instrument: Instrument,
    exchange: Exchange,
    history: DailyHistory,
  ): Promise<void> {
    const now = this.clock.now();
    const points = history.bars.flatMap((bar) => {
      const session = getSession(exchange, bar.date);
      if (!session) {
        // The source traded on a day our calendar says was closed: the calendar is wrong.
        console.warn(
          `[prices] ${exchange.id} has a price on ${bar.date}, a closed day in our calendar`,
        );
        return [];
      }
      // Today's bar is not a close until the session is over.
      if (session.closesAt.toMillis() > now.toMillis()) return [];
      return [{ at: session.closesAt, price: bar.close }];
    });
    await savePrices(this.db, {
      instrumentId: instrument.id,
      currency: instrument.currency,
      kind: "close",
      points,
      now,
      settleMinutes: SETTLE_MINUTES,
    });

    const oldestDividend = localDate(
      now.minus({ days: DIVIDEND_LOOKBACK_DAYS }),
      exchange.timeZone,
    );
    const actions: CorporateAction[] = [
      ...history.splits.map((split): CorporateAction => ({
        kind: "split",
        id: `${ACTION_ID_PREFIX}split:${instrument.id}:${split.effectiveDate}`,
        instrumentId: instrument.id,
        effectiveDate: split.effectiveDate,
        ratioFrom: split.ratioFrom,
        ratioTo: split.ratioTo,
      })),
      ...history.dividends
        .filter((dividend) => dividend.exDate >= oldestDividend)
        .map((dividend): CorporateAction => ({
          kind: "dividend",
          id: `${ACTION_ID_PREFIX}dividend:${instrument.id}:${dividend.exDate}`,
          instrumentId: instrument.id,
          exDate: dividend.exDate,
          // The sources give no pay date: the dividend is paid on the ex-date, the day the
          // price drops by it (docs/decisions.md).
          payDate: dividend.exDate,
          amountPerShare: Money.of(dividend.amount, instrument.currency),
        })),
    ];
    await storeCorporateActions(this.db, actions);
  }

  /** Makes sure the 5-minute bars of the last week are stored and up to date. */
  private ensureIntraday(instrument: Instrument, exchange: Exchange): Promise<void> {
    const key = `intraday:${instrument.id}`;
    return this.remember(key, () =>
      this.inTurn(key, async () => {
        const now = this.clock.now();
        const state = await loadFetchState(this.db, key);
        const fetchedAt = state?.fetchedAt ?? null;
        const lastClose = getLastCloseAt(exchange, now);
        // While open: at most a minute old. While closed: fetched after the day settled.
        const freshFrom = isMarketOpen(exchange, now)
          ? now.minus({ seconds: LIVE_MAX_AGE_SECONDS })
          : earliest(now, (lastClose ?? now).plus({ minutes: SETTLE_MINUTES }));
        if (fetchedAt && fetchedAt.toMillis() >= freshFrom.toMillis()) return;

        const oldest = now.minus({ days: INTRADAY_DAYS });
        const fetchFrom =
          fetchedAt && fetchedAt.toMillis() > oldest.toMillis()
            ? fetchedAt.minus({ days: 1 })
            : oldest;
        await this.refresh(key, async () => {
          const bars = await this.marketData.fetchIntraday(instrument, fetchFrom);
          const points = bars.flatMap((bar) => {
            if (bar.at.toMillis() > now.toMillis()) return [];
            const session = getSession(exchange, localDate(bar.at, exchange.timeZone));
            // Only regular hours: no pre-market, no closing auction after the bell.
            const inSession =
              session &&
              bar.at.toMillis() > session.opensAt.toMillis() &&
              bar.at.toMillis() <= session.closesAt.toMillis();
            return inSession ? [{ at: bar.at, price: bar.value }] : [];
          });
          await savePrices(this.db, {
            instrumentId: instrument.id,
            currency: instrument.currency,
            kind: "intraday",
            points,
            now,
            settleMinutes: SETTLE_MINUTES,
          });
          return {};
        });
      }),
    );
  }

  // ---------------------------------------------------------------- FX

  /** Units of `currency` per 1 USD at `time`. */
  private perUsd(currency: Currency, time: DateTime): Promise<Decimal> {
    if (currency === BASE) return Promise.resolve(decimal("1"));
    const live = this.isLive(time);
    return this.remember(`fx:${currency}:${live ? "live" : String(time.toMillis())}`, async () => {
      if (live) await this.ensureLiveFx();
      else await this.ensureFxHistory(currency, time);
      // Live: the newest rate we have (it may be stamped a moment after this request began).
      const stored =
        (await fxAtOrBefore(this.db, currency, live ? undefined : time)) ??
        (live ? null : await this.fallbackFx(currency, time));
      if (!stored) throw new PriceDataError(`No exchange rate for ${BASE}/${currency}`);
      return stored.rate;
    });
  }

  /** History can start a little after the instant asked for (a weekend, a new currency). */
  private async fallbackFx(
    currency: Currency,
    time: DateTime,
  ): Promise<{ rate: Decimal; at: DateTime } | null> {
    return fxAtOrBefore(this.db, currency, time.plus({ days: DAILY_OVERLAP_DAYS }));
  }

  private ensureLiveFx(): Promise<void> {
    const key = "fx:live";
    return this.remember(key, async () => {
      const now = this.clock.now();
      const state = await loadFetchState(this.db, key);
      const freshFrom = now.minus({ seconds: LIVE_MAX_AGE_SECONDS });
      if (state?.fetchedAt && state.fetchedAt.toMillis() >= freshFrom.toMillis()) return;
      await this.refresh(key, async () => {
        const currencies = CURRENCIES.filter((currency) => currency !== BASE);
        const quotes = await this.marketData.fetchFxQuotes(currencies);
        if (quotes.size < currencies.length)
          throw new MarketDataError("The source did not give every exchange rate");
        for (const [currency, quote] of quotes)
          await saveFxPoints(this.db, currency, [{ at: quote.at, rate: quote.price }]);
        return {};
      });
    });
  }

  /** Makes sure FX points around a past instant are stored. */
  private ensureFxHistory(currency: Currency, time: DateTime): Promise<void> {
    const now = this.clock.now();
    const recent = time.toMillis() >= now.minus({ days: INTRADAY_DAYS - 1 }).toMillis();
    const key = `${recent ? "fxintraday" : "fxdaily"}:${currency}`;
    return this.inTurn(key, async () => {
      const state = await loadFetchState(this.db, key);
      const fetchedAt = state?.fetchedAt ?? null;
      // Points up to the fetch time are stored, so a fetch after `time` covers it.
      const reaches = fetchedAt !== null && fetchedAt.toMillis() >= time.toMillis();
      if (recent) {
        if (reaches) return;
        await this.refresh(key, async () => {
          const points = await this.marketData.fetchFxIntraday(
            currency,
            now.minus({ days: INTRADAY_DAYS }),
          );
          await this.storeFx(currency, points);
          return {};
        });
        return;
      }
      const coveredFrom = state?.coveredFrom ?? null;
      const covers = coveredFrom !== null && coveredFrom.toMillis() <= time.toMillis();
      if (reaches && covers) return;
      const fetchFrom = covers
        ? (fetchedAt ?? now).minus({ days: DAILY_OVERLAP_DAYS })
        : earliest(time.minus({ days: DAILY_OVERLAP_DAYS }), now.minus({ years: HISTORY_YEARS }));
      await this.refresh(key, async () => {
        const points = await this.marketData.fetchFxDaily(currency, fetchFrom);
        await this.storeFx(currency, points);
        return covers ? {} : { coveredFrom: fetchFrom };
      });
    });
  }

  private async storeFx(
    currency: Currency,
    points: readonly { at: DateTime; value: Decimal }[],
  ): Promise<void> {
    const now = this.clock.now();
    await saveFxPoints(
      this.db,
      currency,
      points
        .filter((point) => point.at.toMillis() <= now.toMillis())
        .map((point) => ({ at: point.at, rate: point.value })),
    );
  }
}
