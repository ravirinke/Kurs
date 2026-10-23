/*
 * Conversions between database rows and packages/core types. Numbers cross the boundary
 * only as strings, so no value ever passes through a JS number.
 */
import {
  type Currency,
  decimal,
  type Decimal,
  type Exchange,
  type ExchangeHoliday,
  fxRate,
  identityRate,
  type Instrument,
  type League,
  type LedgerEvent,
  Money,
  type Quote,
  type TradingSessionRule,
  type Weekday,
} from "@aksjeliga/core";
import { DateTime } from "luxon";

import type * as schema from "./schema";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];
type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** Decimal → numeric string, never in exponent notation. */
export function toNumeric(value: Decimal): string {
  return value.toFixed();
}

export function toDateTime(value: Date): DateTime {
  return DateTime.fromJSDate(value).toUTC();
}

export function toDbTime(value: DateTime): Date {
  return value.toJSDate();
}

function required<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${field} in database row`);
  return value;
}

/** "09:30:00" → "09:30" */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

export function toExchange(
  row: Row<typeof schema.exchanges>,
  hours: readonly Row<typeof schema.exchangeTradingHours>[],
  holidays: readonly Row<typeof schema.exchangeHolidays>[],
): Exchange {
  return {
    id: row.id,
    name: row.name,
    timeZone: row.timeZone,
    currency: row.currency,
    sessions: hours.map((hour): TradingSessionRule => ({
      weekday: hour.weekday as Weekday,
      open: hhmm(hour.opensAt),
      close: hhmm(hour.closesAt),
    })),
    holidays: holidays.map((holiday): ExchangeHoliday => {
      const base = { date: holiday.date, name: holiday.name };
      return holiday.closesEarlyAt ? { ...base, closesEarlyAt: hhmm(holiday.closesEarlyAt) } : base;
    }),
  };
}

export function toInstrument(row: Row<typeof schema.instruments>): Instrument {
  return {
    id: row.id,
    ticker: row.ticker,
    isin: row.isin,
    name: row.name,
    exchangeId: row.exchangeId,
    currency: row.currency,
  };
}

export function toLeague(
  row: Row<typeof schema.leagues>,
  allowedExchangeIds: readonly string[],
): League {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description,
    currency: row.currency,
    startAmount: Money.of(row.startAmount, row.currency),
    startsAt: toDateTime(row.startsAt),
    endsAt: toDateTime(row.endsAt),
    visibility: row.visibility,
    allowedExchangeIds: [...allowedExchangeIds],
    feeRule: { rate: decimal(row.feeRate), minimum: Money.of(row.feeMinimum, row.currency) },
    maxPositionShare: row.maxPositionShare === null ? null : decimal(row.maxPositionShare),
    inviteCode: row.inviteCode,
    finalizedAt: row.finalizedAt ? toDateTime(row.finalizedAt) : null,
  };
}

export function toQuote(row: Row<typeof schema.quotes>, leagueCurrency: Currency): Quote {
  return {
    id: row.id,
    leagueId: row.leagueId,
    memberId: row.memberId,
    instrumentId: row.instrumentId,
    side: row.side,
    quantity: decimal(row.quantity),
    price: Money.of(row.price, row.priceCurrency),
    fxRate: rateFor(row.priceCurrency, leagueCurrency, row.fxRate),
    grossAmount: Money.of(row.grossAmount, leagueCurrency),
    fee: Money.of(row.fee, leagueCurrency),
    totalAmount: Money.of(row.totalAmount, leagueCurrency),
    createdAt: toDateTime(row.createdAt),
    expiresAt: toDateTime(row.expiresAt),
  };
}

export function quoteToRow(quote: Quote): Insert<typeof schema.quotes> {
  return {
    id: quote.id,
    leagueId: quote.leagueId,
    memberId: quote.memberId,
    instrumentId: quote.instrumentId,
    orderType: "market",
    side: quote.side,
    quantity: toNumeric(quote.quantity),
    price: toNumeric(quote.price.amount),
    priceCurrency: quote.price.currency,
    fxRate: toNumeric(quote.fxRate.rate),
    grossAmount: toNumeric(quote.grossAmount.amount),
    fee: toNumeric(quote.fee.amount),
    totalAmount: toNumeric(quote.totalAmount.amount),
    createdAt: toDbTime(quote.createdAt),
    expiresAt: toDbTime(quote.expiresAt),
  };
}

function rateFor(from: Currency, to: Currency, rate: string) {
  return from === to ? identityRate(from) : fxRate(from, to, rate);
}

/** The signed effect of an event on cash, as stored in `transactions.amount`. */
export function cashEffect(event: LedgerEvent): Money {
  switch (event.type) {
    case "deposit":
    case "dividend":
      return event.amount;
    case "fee":
      return event.amount.negated();
    case "buy":
      return event.grossAmount.plus(event.fee).negated();
    case "sell":
      return event.grossAmount.minus(event.fee);
    case "split":
      return event.cashInLieu;
  }
}

interface EventRowContext {
  leagueId: string;
  memberId: string;
  idempotencyKey?: string;
}

export function eventToRow(
  event: LedgerEvent,
  context: EventRowContext,
): Insert<typeof schema.transactions> {
  const base = {
    id: event.id,
    leagueId: context.leagueId,
    memberId: context.memberId,
    type: event.type,
    occurredAt: toDbTime(event.at),
    amount: toNumeric(cashEffect(event).amount),
  };
  switch (event.type) {
    case "deposit":
      return base;
    case "fee":
      return { ...base, description: event.description };
    case "buy":
    case "sell":
      return {
        ...base,
        instrumentId: event.instrumentId,
        quantity: toNumeric(event.quantity),
        price: toNumeric(event.price.amount),
        priceCurrency: event.price.currency,
        fxRate: toNumeric(event.fxRate.rate),
        grossAmount: toNumeric(event.grossAmount.amount),
        fee: toNumeric(event.fee.amount),
        quoteId: event.quoteId,
        idempotencyKey: required(context.idempotencyKey, "idempotencyKey"),
      };
    case "dividend":
      return {
        ...base,
        instrumentId: event.instrumentId,
        corporateActionId: event.corporateActionId,
        quantity: toNumeric(event.quantity),
        amountPerShare: toNumeric(event.amountPerShare.amount),
        dividendCurrency: event.amountPerShare.currency,
        fxRate: toNumeric(event.fxRate.rate),
      };
    case "split":
      return {
        ...base,
        instrumentId: event.instrumentId,
        corporateActionId: event.corporateActionId,
        ratioFrom: toNumeric(event.ratioFrom),
        ratioTo: toNumeric(event.ratioTo),
        quantityBefore: toNumeric(event.quantityBefore),
        quantityAfter: toNumeric(event.quantityAfter),
      };
  }
}

export function rowToEvent(row: Row<typeof schema.transactions>, currency: Currency): LedgerEvent {
  const at = toDateTime(row.occurredAt);
  const amount = Money.of(row.amount, currency);
  switch (row.type) {
    case "deposit":
      return { id: row.id, type: "deposit", at, amount };
    case "fee":
      return {
        id: row.id,
        type: "fee",
        at,
        amount: amount.negated(),
        description: row.description ?? "",
      };
    case "buy":
    case "sell": {
      const priceCurrency = required(row.priceCurrency, "price_currency");
      return {
        id: row.id,
        type: row.type,
        at,
        instrumentId: required(row.instrumentId, "instrument_id"),
        quantity: decimal(required(row.quantity, "quantity")),
        price: Money.of(required(row.price, "price"), priceCurrency),
        fxRate: rateFor(priceCurrency, currency, required(row.fxRate, "fx_rate")),
        grossAmount: Money.of(required(row.grossAmount, "gross_amount"), currency),
        fee: Money.of(required(row.fee, "fee"), currency),
        quoteId: required(row.quoteId, "quote_id"),
      };
    }
    case "dividend": {
      const dividendCurrency = required(row.dividendCurrency, "dividend_currency");
      return {
        id: row.id,
        type: "dividend",
        at,
        instrumentId: required(row.instrumentId, "instrument_id"),
        corporateActionId: required(row.corporateActionId, "corporate_action_id"),
        quantity: decimal(required(row.quantity, "quantity")),
        amountPerShare: Money.of(
          required(row.amountPerShare, "amount_per_share"),
          dividendCurrency,
        ),
        fxRate: rateFor(dividendCurrency, currency, required(row.fxRate, "fx_rate")),
        amount,
      };
    }
    case "split":
      return {
        id: row.id,
        type: "split",
        at,
        instrumentId: required(row.instrumentId, "instrument_id"),
        corporateActionId: required(row.corporateActionId, "corporate_action_id"),
        ratioFrom: decimal(required(row.ratioFrom, "ratio_from")),
        ratioTo: decimal(required(row.ratioTo, "ratio_to")),
        quantityBefore: decimal(required(row.quantityBefore, "quantity_before")),
        quantityAfter: decimal(required(row.quantityAfter, "quantity_after")),
        cashInLieu: amount,
      };
  }
}
