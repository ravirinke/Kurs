import type { DateTime } from "luxon";

import type { LeagueStatus } from "../league/types";
import type { LedgerState } from "../ledger";
import type { ExchangeId, Instrument, MarketStatus } from "../market";
import { type Decimal, isPositiveQuantity, isWholeQuantity, type Money, ZERO } from "../money";

import { isQuoteExpired, type Order, type Quote } from "./quote";

/** Why a trade is refused. The web app maps each code to Norwegian text. */
export type TradeRejection =
  | { code: "INVALID_QUANTITY" }
  | { code: "FRACTIONAL_QUANTITY" }
  | { code: "LEAGUE_NOT_ACTIVE"; status: LeagueStatus }
  | { code: "EXCHANGE_NOT_ALLOWED"; exchangeId: ExchangeId }
  | { code: "MARKET_CLOSED"; nextOpenAt: DateTime | null }
  | { code: "QUOTE_EXPIRED" }
  | { code: "INSUFFICIENT_CASH"; required: Money; available: Money }
  | { code: "INSUFFICIENT_HOLDINGS"; requested: Decimal; held: Decimal }
  | { code: "MAX_POSITION_SHARE_EXCEEDED"; limit: Decimal; resultingShare: Decimal };

export type TradeRejectionCode = TradeRejection["code"];

export type TradeValidation = { ok: true } | { ok: false; rejections: TradeRejection[] };

/** The league rules a trade is checked against. */
export interface TradeRules {
  leagueStatus: LeagueStatus;
  allowedExchangeIds: readonly ExchangeId[];
  /** Fraction of portfolio value, e.g. 0.25. Null when the rule is off. */
  maxPositionShare: Decimal | null;
}

export interface TradeContext {
  quote: Quote;
  instrument: Instrument;
  rules: TradeRules;
  /** Status of the instrument's exchange at `now`. */
  marketStatus: MarketStatus;
  /** The member's current ledger state. */
  ledger: LedgerState;
  /** The member's portfolio value at quote time (before the trade). */
  portfolioValue: Money;
  now: DateTime;
}

function result(rejections: TradeRejection[]): TradeValidation {
  return rejections.length === 0 ? { ok: true } : { ok: false, rejections };
}

/** Checks that need no prices. Run before asking the PriceProvider for a quote. */
export function validateOrder(order: Order): TradeValidation {
  if (!isPositiveQuantity(order.quantity)) return result([{ code: "INVALID_QUANTITY" }]);
  if (!isWholeQuantity(order.quantity)) return result([{ code: "FRACTIONAL_QUANTITY" }]);
  return result([]);
}

/**
 * Validates a quote against every rule. Used both when the quote is created and again when
 * the user confirms it, with fresh state: the market may have closed, the quote may have
 * expired, or cash may have been spent in the meantime. Returns every rule that fails.
 */
export function validateTrade(context: TradeContext): TradeValidation {
  const { quote, instrument, rules, marketStatus, ledger, now } = context;
  const orderCheck = validateOrder({
    type: "market",
    side: quote.side,
    instrumentId: quote.instrumentId,
    quantity: quote.quantity,
  });
  if (!orderCheck.ok) return orderCheck;

  const rejections: TradeRejection[] = [];

  if (rules.leagueStatus !== "active") {
    rejections.push({ code: "LEAGUE_NOT_ACTIVE", status: rules.leagueStatus });
  }
  if (!rules.allowedExchangeIds.includes(instrument.exchangeId)) {
    rejections.push({ code: "EXCHANGE_NOT_ALLOWED", exchangeId: instrument.exchangeId });
  }
  if (!marketStatus.isOpen) {
    rejections.push({ code: "MARKET_CLOSED", nextOpenAt: marketStatus.nextOpenAt });
  }
  if (isQuoteExpired(quote, now)) {
    rejections.push({ code: "QUOTE_EXPIRED" });
  }

  const held = ledger.positions.get(quote.instrumentId)?.quantity ?? ZERO;

  if (quote.side === "buy") {
    if (quote.totalAmount.gt(ledger.cash)) {
      rejections.push({
        code: "INSUFFICIENT_CASH",
        required: quote.totalAmount,
        available: ledger.cash,
      });
    }
    if (rules.maxPositionShare !== null) {
      // Checked on buy only (docs/decisions.md). Existing shares are valued at the quoted price.
      const positionAfter = held
        .plus(quote.quantity)
        .times(quote.price.amount)
        .times(quote.fxRate.rate);
      const resultingShare = positionAfter.dividedBy(context.portfolioValue.amount);
      if (resultingShare.greaterThan(rules.maxPositionShare)) {
        rejections.push({
          code: "MAX_POSITION_SHARE_EXCEEDED",
          limit: rules.maxPositionShare,
          resultingShare,
        });
      }
    }
  } else {
    if (held.lessThan(quote.quantity)) {
      rejections.push({ code: "INSUFFICIENT_HOLDINGS", requested: quote.quantity, held });
    }
    // A minimum fee larger than the proceeds must not push cash below zero.
    if (ledger.cash.plus(quote.totalAmount).isNegative()) {
      rejections.push({
        code: "INSUFFICIENT_CASH",
        required: quote.totalAmount.negated(),
        available: ledger.cash,
      });
    }
  }

  return result(rejections);
}
