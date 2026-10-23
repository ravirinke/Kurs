import type { DateTime } from "luxon";

import { zonedTime } from "../time";

import type { Exchange, ExchangeHoliday, MarketStatus, TradingSession } from "./types";

/** Long enough to skip any run of holidays and weekends. */
const SEARCH_DAYS = 21;

const holidayIndex = new WeakMap<Exchange, ReadonlyMap<string, ExchangeHoliday>>();

function holidaysOf(exchange: Exchange): ReadonlyMap<string, ExchangeHoliday> {
  let index = holidayIndex.get(exchange);
  if (!index) {
    index = new Map(exchange.holidays.map((holiday) => [holiday.date, holiday]));
    holidayIndex.set(exchange, index);
  }
  return index;
}

/**
 * The regular session on an exchange-local date, or null if the exchange is closed that day
 * (weekend or holiday). Times are resolved in the exchange's IANA zone, so daylight saving
 * is handled per exchange.
 */
export function getSession(exchange: Exchange, date: string): TradingSession | null {
  const { weekday } = zonedTime(date, "12:00", exchange.timeZone);
  const rule = exchange.sessions.find((session) => session.weekday === weekday);
  if (!rule) return null;

  const holiday = holidaysOf(exchange).get(date);
  if (holiday && holiday.closesEarlyAt === undefined) return null;

  const close = holiday?.closesEarlyAt ?? rule.close;
  return {
    date,
    opensAt: zonedTime(date, rule.open, exchange.timeZone),
    closesAt: zonedTime(date, close, exchange.timeZone),
    isEarlyClose: holiday?.closesEarlyAt !== undefined,
  };
}

function shiftDate(exchange: Exchange, date: string, days: number): string {
  return zonedTime(date, "12:00", exchange.timeZone).plus({ days }).toFormat("yyyy-MM-dd");
}

/** Open from `opensAt` (inclusive) to `closesAt` (exclusive). */
function contains(session: TradingSession, at: DateTime): boolean {
  const t = at.toMillis();
  return t >= session.opensAt.toMillis() && t < session.closesAt.toMillis();
}

export function isMarketOpen(exchange: Exchange, at: DateTime): boolean {
  const session = getSession(exchange, at.setZone(exchange.timeZone).toFormat("yyyy-MM-dd"));
  return session !== null && contains(session, at);
}

/** The most recent session close at or before `at`. */
export function getLastCloseAt(exchange: Exchange, at: DateTime): DateTime | null {
  const today = at.setZone(exchange.timeZone).toFormat("yyyy-MM-dd");
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const session = getSession(exchange, shiftDate(exchange, today, -offset));
    if (session && session.closesAt.toMillis() <= at.toMillis()) return session.closesAt;
  }
  return null;
}

/** The next session open strictly after `at`. */
export function getNextOpenAt(exchange: Exchange, at: DateTime): DateTime | null {
  const today = at.setZone(exchange.timeZone).toFormat("yyyy-MM-dd");
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const session = getSession(exchange, shiftDate(exchange, today, offset));
    if (session && session.opensAt.toMillis() > at.toMillis()) return session.opensAt;
  }
  return null;
}

export function getMarketStatus(exchange: Exchange, at: DateTime): MarketStatus {
  const today = getSession(exchange, at.setZone(exchange.timeZone).toFormat("yyyy-MM-dd"));
  const isOpen = today !== null && contains(today, at);
  return {
    exchangeId: exchange.id,
    isOpen,
    currentSession: isOpen ? today : null,
    nextOpenAt: getNextOpenAt(exchange, at),
    lastCloseAt: getLastCloseAt(exchange, at),
  };
}
