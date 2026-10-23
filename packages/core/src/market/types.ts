import type { DateTime } from "luxon";

import type { Currency } from "../money";

/** Exchange identifiers are ISO 10383 MIC codes, e.g. "XOSL". */
export type ExchangeId = string;

/** Luxon weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Regular trading hours for one weekday, in the exchange's local time ("HH:mm"). */
export interface TradingSessionRule {
  weekday: Weekday;
  open: string;
  close: string;
}

/**
 * A day that deviates from the regular hours. Without `closesEarlyAt` the exchange is
 * closed all day; with it, the exchange opens as usual and closes at that local time.
 */
export interface ExchangeHoliday {
  date: string;
  name: string;
  closesEarlyAt?: string;
}

export interface Exchange {
  id: ExchangeId;
  name: string;
  timeZone: string;
  currency: Currency;
  sessions: readonly TradingSessionRule[];
  holidays: readonly ExchangeHoliday[];
}

export type InstrumentId = string;

export interface Instrument {
  id: InstrumentId;
  ticker: string;
  isin: string;
  name: string;
  exchangeId: ExchangeId;
  /** Trading currency. */
  currency: Currency;
}

export interface TradingSession {
  /** Exchange-local calendar date (yyyy-MM-dd). */
  date: string;
  opensAt: DateTime;
  closesAt: DateTime;
  isEarlyClose: boolean;
}

export interface MarketStatus {
  exchangeId: ExchangeId;
  isOpen: boolean;
  /** The session in progress, if open. */
  currentSession: TradingSession | null;
  /** Next time the exchange opens (null only if none is found within the search window). */
  nextOpenAt: DateTime | null;
  /** Most recent close at or before the given instant. */
  lastCloseAt: DateTime | null;
}
