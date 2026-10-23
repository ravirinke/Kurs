import type { DateTime } from "luxon";

import { type CorporateAction, splitFactor, startOfExchangeDay } from "../../corporate-actions";
import { type FxRate, fxRate, identityRate } from "../../fx";
import {
  type Exchange,
  type ExchangeId,
  getLastCloseAt,
  getMarketStatus,
  getSession,
  type Instrument,
  type InstrumentId,
  isMarketOpen,
  type MarketStatus,
} from "../../market";
import { type Currency, decimal, type Decimal, Money, roundHalfUp } from "../../money";
import { type Clock, localDate, zonedTime } from "../../time";
import {
  type ClosingPrice,
  PriceDataError,
  type PricePoint,
  type PriceProvider,
  type PriceQuote,
  type PriceResolution,
} from "../provider";

import { hashString, valueNoise } from "./noise";

export interface MockInstrument {
  instrument: Instrument;
  /** Typical price level in the trading currency, e.g. "275.40". */
  basePrice: string;
  /**
   * Scale of the movement (log-return amplitude). Default 0.04: the price wanders roughly
   * ±10 % around the base over weeks and a little within each day.
   */
  volatility?: number;
}

export interface MockPriceProviderOptions {
  clock: Clock;
  exchanges: readonly Exchange[];
  instruments: readonly MockInstrument[];
  /** Units of each currency per 1 USD. */
  fxPerUsd?: Partial<Record<Currency, string>>;
  corporateActions?: readonly CorporateAction[];
  /** Changes every generated series. */
  seed?: string;
}

export const DEFAULT_FX_PER_USD: Readonly<Record<Currency, string>> = {
  USD: "1",
  NOK: "10.84",
  SEK: "10.45",
  DKK: "6.85",
  EUR: "0.918",
};

const MINUTES_PER_DAY = 60 * 24;
const DEFAULT_VOLATILITY = 0.04;
const PRICE_TICK_DECIMALS = 2;
const RESOLUTION_MINUTES: Readonly<Record<Exclude<PriceResolution, "1d">, number>> = {
  "5m": 5,
  "1h": 60,
};
/** Upper bound on days scanned by one history request (a bit more than a year). */
const MAX_HISTORY_DAYS = 400;

/** Runs synchronous mock logic behind the async interface, turning throws into rejections. */
function settle<T>(compute: () => T): Promise<T> {
  try {
    return Promise.resolve(compute());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new PriceDataError(String(error)));
  }
}

/**
 * Realistic, deterministic prices: the same instrument at the same instant always gives the
 * same price. Prices move only while the exchange is open; when it is closed, the quote is
 * the last close. Splits configured in `corporateActions` make earlier prices higher by the
 * split factor, as on a real chart before adjustment.
 */
export class MockPriceProvider implements PriceProvider {
  private readonly clock: Clock;
  private readonly exchanges: ReadonlyMap<ExchangeId, Exchange>;
  private readonly instruments: ReadonlyMap<InstrumentId, MockInstrument>;
  private readonly fxPerUsd: Readonly<Record<Currency, string>>;
  private readonly corporateActions: CorporateAction[];
  private readonly seed: string;

  constructor(options: MockPriceProviderOptions) {
    this.clock = options.clock;
    this.exchanges = new Map(options.exchanges.map((exchange) => [exchange.id, exchange]));
    this.instruments = new Map(options.instruments.map((mock) => [mock.instrument.id, mock]));
    this.fxPerUsd = { ...DEFAULT_FX_PER_USD, ...options.fxPerUsd };
    this.corporateActions = [...(options.corporateActions ?? [])];
    this.seed = options.seed ?? "aksjeliga";
  }

  /** Adds a corporate action at runtime, so tests and the dev UI can simulate one. */
  addCorporateAction(action: CorporateAction): void {
    this.corporateActions.push(action);
  }

  getQuote(instrumentId: InstrumentId, at?: DateTime): Promise<PriceQuote> {
    return settle((): PriceQuote => {
      const time = at ?? this.clock.now();
      const { mock, exchange } = this.lookup(instrumentId);
      if (isMarketOpen(exchange, time)) {
        return {
          instrumentId,
          price: this.priceAt(mock, exchange, time),
          at: time,
          source: "live",
        };
      }
      const close = this.closeAt(mock, exchange, time);
      return { instrumentId, price: close.price, at: close.closedAt, source: "last_close" };
    });
  }

  getLastClose(instrumentId: InstrumentId, at?: DateTime): Promise<ClosingPrice> {
    return settle(() => {
      const { mock, exchange } = this.lookup(instrumentId);
      return this.closeAt(mock, exchange, at ?? this.clock.now());
    });
  }

  getFxRate(from: Currency, to: Currency, at?: DateTime): Promise<FxRate> {
    return settle(() => {
      if (from === to) return identityRate(from);
      const time = at ?? this.clock.now();
      return fxRate(from, to, this.usdRate(to, time).dividedBy(this.usdRate(from, time)));
    });
  }

  getMarketStatus(exchangeId: ExchangeId, at?: DateTime): Promise<MarketStatus> {
    return settle(() => {
      const exchange = this.exchanges.get(exchangeId);
      if (!exchange) throw new PriceDataError(`Unknown exchange ${exchangeId}`);
      return getMarketStatus(exchange, at ?? this.clock.now());
    });
  }

  getCorporateActions(
    instrumentId: InstrumentId,
    from: DateTime,
    to: DateTime,
  ): Promise<CorporateAction[]> {
    return settle(() => {
      const { exchange } = this.lookup(instrumentId);
      const inRange = (date: string) => {
        const t = startOfExchangeDay(exchange, date).toMillis();
        return t >= from.toMillis() && t <= to.toMillis();
      };
      return this.corporateActions.filter(
        (action) =>
          action.instrumentId === instrumentId &&
          inRange(action.kind === "split" ? action.effectiveDate : action.exDate),
      );
    });
  }

  getPriceHistory(
    instrumentId: InstrumentId,
    from: DateTime,
    to: DateTime,
    resolution: PriceResolution,
  ): Promise<PricePoint[]> {
    return settle(() => {
      const { mock, exchange } = this.lookup(instrumentId);
      const now = this.clock.now();
      const end = to.toMillis() < now.toMillis() ? to : now;
      const points: PricePoint[] = [];
      const push = (at: DateTime) => {
        if (at.toMillis() >= from.toMillis() && at.toMillis() <= end.toMillis()) {
          points.push({ at, price: this.priceAt(mock, exchange, at, now) });
        }
      };

      let date = localDate(from, exchange.timeZone);
      const lastDate = localDate(end, exchange.timeZone);
      for (let day = 0; day < MAX_HISTORY_DAYS && date <= lastDate; day++) {
        const session = getSession(exchange, date);
        if (session) {
          if (resolution === "1d") {
            push(session.closesAt.toMillis() <= end.toMillis() ? session.closesAt : end);
          } else {
            const step = RESOLUTION_MINUTES[resolution];
            for (
              let at = session.opensAt;
              at.toMillis() < session.closesAt.toMillis();
              at = at.plus({ minutes: step })
            ) {
              push(at);
            }
            push(session.closesAt);
          }
        }
        date = zonedTime(date, "12:00", exchange.timeZone).plus({ days: 1 }).toFormat("yyyy-MM-dd");
      }
      return points;
    });
  }

  private lookup(instrumentId: InstrumentId): { mock: MockInstrument; exchange: Exchange } {
    const mock = this.instruments.get(instrumentId);
    if (!mock) throw new PriceDataError(`Unknown instrument ${instrumentId}`);
    const exchange = this.exchanges.get(mock.instrument.exchangeId);
    if (!exchange) throw new PriceDataError(`Unknown exchange ${mock.instrument.exchangeId}`);
    return { mock, exchange };
  }

  /** The last close as seen at `at`: split-adjusted if a split took effect since. */
  private closeAt(mock: MockInstrument, exchange: Exchange, at: DateTime): ClosingPrice {
    const closedAt = getLastCloseAt(exchange, at);
    if (!closedAt) throw new PriceDataError(`No close found before ${at.toISO() ?? ""}`);
    return {
      instrumentId: mock.instrument.id,
      price: this.priceAt(mock, exchange, closedAt, at),
      closedAt,
    };
  }

  /**
   * The price path at `at`, ignoring whether the market is open, adjusted for splits that
   * had not taken effect by `seenAt`.
   */
  private priceAt(
    mock: MockInstrument,
    exchange: Exchange,
    at: DateTime,
    seenAt: DateTime = at,
  ): Money {
    const seed = hashString(`${this.seed}:${mock.instrument.id}`);
    const minutes = at.toMillis() / 60_000;
    const volatility = mock.volatility ?? DEFAULT_VOLATILITY;
    const logReturn =
      volatility *
      (2.0 * valueNoise(seed, minutes / (MINUTES_PER_DAY * 7)) +
        1.0 * valueNoise(seed + 1, minutes / MINUTES_PER_DAY) +
        0.35 * valueNoise(seed + 2, minutes / 60) +
        0.1 * valueNoise(seed + 3, minutes / 5));

    const multiplier = decimal(Math.exp(logReturn).toFixed(12));
    // Round the post-split price to the tick first, so pre-split prices are exact multiples.
    const postSplitPrice = roundHalfUp(
      decimal(mock.basePrice).times(multiplier),
      PRICE_TICK_DECIMALS,
    );
    const price = postSplitPrice.times(this.splitAdjustment(mock, exchange, seenAt));
    return Money.of(price, mock.instrument.currency);
  }

  /** Before a split takes effect the price is higher by the split factor. */
  private splitAdjustment(mock: MockInstrument, exchange: Exchange, at: DateTime): Decimal {
    let factor = decimal("1");
    for (const action of this.corporateActions) {
      if (action.kind !== "split" || action.instrumentId !== mock.instrument.id) continue;
      if (at.toMillis() < startOfExchangeDay(exchange, action.effectiveDate).toMillis()) {
        factor = factor.times(splitFactor(action));
      }
    }
    return factor;
  }

  /** Units of `currency` per 1 USD at an instant, with a small deterministic drift. */
  private usdRate(currency: Currency, at: DateTime): Decimal {
    const base = decimal(this.fxPerUsd[currency]);
    if (currency === "USD") return base;
    const seed = hashString(`${this.seed}:fx:${currency}`);
    const minutes = at.toMillis() / 60_000;
    const logChange =
      0.01 * valueNoise(seed, minutes / (MINUTES_PER_DAY * 7)) +
      0.003 * valueNoise(seed + 1, minutes / MINUTES_PER_DAY) +
      0.0008 * valueNoise(seed + 2, minutes / 30);
    return base.times(decimal(Math.exp(logChange).toFixed(12)));
  }
}
