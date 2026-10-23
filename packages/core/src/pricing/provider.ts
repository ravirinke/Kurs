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
}

export interface ClosingPrice {
  instrumentId: InstrumentId;
  price: Money;
  closedAt: DateTime;
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
}

export class PriceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceDataError";
  }
}
