import type { DateTime } from "luxon";

import { convert, type FxRate } from "../fx";
import type { DividendEvent, SplitEvent } from "../ledger";
import type { Exchange, InstrumentId } from "../market";
import type { Decimal, Money } from "../money";
import { zonedTime } from "../time";

/** `ratioFrom` old shares become `ratioTo` new ones. A 10:1 split is from 1, to 10. */
export interface SplitAction {
  kind: "split";
  id: string;
  instrumentId: InstrumentId;
  /** Exchange-local date the split takes effect (first day trading at the new price). */
  effectiveDate: string;
  ratioFrom: Decimal;
  ratioTo: Decimal;
}

export interface DividendAction {
  kind: "dividend";
  id: string;
  instrumentId: InstrumentId;
  /** Exchange-local date. Shares held at the start of this day are entitled. */
  exDate: string;
  /** Exchange-local date the cash is paid. */
  payDate: string;
  /** Per share, in the dividend currency (may differ from the trading currency). */
  amountPerShare: Money;
}

export type CorporateAction = SplitAction | DividendAction;

/** Price and quantity factor of a split (10 for a 10:1 split, 0.1 for a 1:10 reverse split). */
export function splitFactor(action: SplitAction): Decimal {
  return action.ratioTo.dividedBy(action.ratioFrom);
}

/** Start of a local date on the exchange, as an instant. */
export function startOfExchangeDay(exchange: Exchange, date: string): DateTime {
  return zonedTime(date, "00:00", exchange.timeZone);
}

export interface SplitInput {
  action: SplitAction;
  eventId: string;
  at: DateTime;
  quantityBefore: Decimal;
  /** Last close before the split, at the pre-split price, in the trading currency. */
  lastClose: Money;
  /** Rate at that close, trading currency → league currency. */
  fxRate: FxRate;
}

/**
 * Applies a split to a holding. Quantity is multiplied by the factor and the value is
 * unchanged. Whole shares only: a fractional leftover (from a reverse split) is paid out
 * as cash at the post-split price (docs/decisions.md).
 */
export function computeSplitEvent(input: SplitInput): SplitEvent {
  const { action, quantityBefore, lastClose, fxRate } = input;
  const factor = splitFactor(action);
  const exactAfter = quantityBefore.times(factor);
  const quantityAfter = exactAfter.floor();
  const fraction = exactAfter.minus(quantityAfter);
  const postSplitPrice = lastClose.dividedBy(factor);
  const cashInLieu = convert(postSplitPrice.times(fraction), fxRate).round();

  return {
    id: input.eventId,
    type: "split",
    at: input.at,
    instrumentId: action.instrumentId,
    corporateActionId: action.id,
    ratioFrom: action.ratioFrom,
    ratioTo: action.ratioTo,
    quantityBefore,
    quantityAfter,
    cashInLieu,
  };
}

export interface DividendInput {
  action: DividendAction;
  eventId: string;
  /** When the dividend is booked (on the pay date). */
  at: DateTime;
  /** Shares held at the start of the ex-date (see quantityHeldBefore). */
  quantityHeld: Decimal;
  /** Rate on the pay date, dividend currency → league currency. */
  fxRate: FxRate;
}

/** Cash dividend for one member, or null if they held no shares on the ex-date. */
export function computeDividendEvent(input: DividendInput): DividendEvent | null {
  const { action, quantityHeld, fxRate } = input;
  if (!quantityHeld.greaterThan(0)) return null;
  return {
    id: input.eventId,
    type: "dividend",
    at: input.at,
    instrumentId: action.instrumentId,
    corporateActionId: action.id,
    quantity: quantityHeld,
    amountPerShare: action.amountPerShare,
    fxRate,
    amount: convert(action.amountPerShare.times(quantityHeld), fxRate).round(),
  };
}
