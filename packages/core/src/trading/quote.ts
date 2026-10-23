import type { DateTime } from "luxon";

import { type FxRate, lockFxRate } from "../fx";
import type { Instrument, InstrumentId } from "../market";
import { type Decimal, Money, PRICE_DECIMALS, roundHalfUp } from "../money";

import { calculateFee, type FeeRule } from "./fees";

export type TradeSide = "buy" | "sell";

/** What the client sends. Never a price or an amount: the server sets those. */
export interface MarketOrder {
  type: "market";
  side: TradeSide;
  instrumentId: InstrumentId;
  quantity: Decimal;
}

/** Only market orders for now. Add `LimitOrder` to this union later. */
export type Order = MarketOrder;

export const QUOTE_TTL_SECONDS = 30;

/** A price the server has locked for a short time, for the user to confirm. */
export interface Quote {
  id: string;
  leagueId: string;
  memberId: string;
  instrumentId: InstrumentId;
  side: TradeSide;
  quantity: Decimal;
  /** Locked price per share in the trading currency. */
  price: Money;
  /** Locked rate from trading currency to league currency (6 decimals). */
  fxRate: FxRate;
  /** quantity × price × fxRate, rounded half-up. League currency. */
  grossAmount: Money;
  fee: Money;
  /** Buy: what leaves the cash balance. Sell: what arrives. */
  totalAmount: Money;
  createdAt: DateTime;
  expiresAt: DateTime;
}

export interface BuildQuoteInput {
  id: string;
  leagueId: string;
  memberId: string;
  order: Order;
  instrument: Instrument;
  /** Current market price from the PriceProvider. */
  marketPrice: Money;
  /** Current rate from the PriceProvider, trading currency → league currency. */
  marketFxRate: FxRate;
  feeRule: FeeRule;
  now: DateTime;
}

export function buildQuote(input: BuildQuoteInput): Quote {
  const { order, instrument, marketPrice, marketFxRate, feeRule } = input;
  if (order.instrumentId !== instrument.id)
    throw new RangeError("Order and instrument do not match");
  if (marketPrice.currency !== instrument.currency)
    throw new RangeError("Price is not in the trading currency");
  if (marketFxRate.from !== instrument.currency || marketFxRate.to !== feeRule.minimum.currency) {
    throw new RangeError("FX rate must convert the trading currency to the league currency");
  }

  const price = Money.of(roundHalfUp(marketPrice.amount, PRICE_DECIMALS), instrument.currency);
  const fxRate = lockFxRate(marketFxRate);
  const grossAmount = Money.of(
    order.quantity.times(price.amount).times(fxRate.rate),
    fxRate.to,
  ).round();
  const fee = calculateFee(grossAmount, feeRule);
  const totalAmount = order.side === "buy" ? grossAmount.plus(fee) : grossAmount.minus(fee);

  return {
    id: input.id,
    leagueId: input.leagueId,
    memberId: input.memberId,
    instrumentId: instrument.id,
    side: order.side,
    quantity: order.quantity,
    price,
    fxRate,
    grossAmount,
    fee,
    totalAmount,
    createdAt: input.now,
    expiresAt: input.now.plus({ seconds: QUOTE_TTL_SECONDS }),
  };
}

/** A quote is valid until (not including) `expiresAt`. */
export function isQuoteExpired(quote: Quote, now: DateTime): boolean {
  return now.toMillis() >= quote.expiresAt.toMillis();
}
