import type { DateTime } from "luxon";

import type { FxRate } from "../fx";
import type { InstrumentId } from "../market";
import type { Decimal, Money } from "../money";

/*
 * Immutable ledger events: the source of truth for a member's cash and holdings.
 * All amounts named `…Amount`, `fee`, `cashInLieu` are booked (already rounded) and in the
 * league currency. Prices and per-share amounts are in the instrument's/dividend's currency.
 */

interface EventBase {
  id: string;
  at: DateTime;
}

/** Starting capital (and any future top-ups). */
export interface DepositEvent extends EventBase {
  type: "deposit";
  amount: Money;
}

export interface TradeEvent extends EventBase {
  type: "buy" | "sell";
  instrumentId: InstrumentId;
  quantity: Decimal;
  /** Locked price per share in the trading currency. */
  price: Money;
  /** Locked rate from trading currency to league currency. */
  fxRate: FxRate;
  /** quantity × price × fxRate, rounded. */
  grossAmount: Money;
  fee: Money;
  quoteId: string;
}

/** A standalone fee not tied to a trade (brokerage is part of TradeEvent). */
export interface FeeEvent extends EventBase {
  type: "fee";
  amount: Money;
  description: string;
}

export interface DividendEvent extends EventBase {
  type: "dividend";
  instrumentId: InstrumentId;
  corporateActionId: string;
  /** Shares held at the start of the ex-date. */
  quantity: Decimal;
  amountPerShare: Money;
  /** Rate from the dividend currency to the league currency on the pay date. */
  fxRate: FxRate;
  amount: Money;
}

export interface SplitEvent extends EventBase {
  type: "split";
  instrumentId: InstrumentId;
  corporateActionId: string;
  /** `ratioFrom` old shares become `ratioTo` new shares (10:1 split: from 1, to 10). */
  ratioFrom: Decimal;
  ratioTo: Decimal;
  quantityBefore: Decimal;
  /** Whole shares after the split. */
  quantityAfter: Decimal;
  /** Paid for the fractional share left over by a reverse split. */
  cashInLieu: Money;
}

export type LedgerEvent = DepositEvent | TradeEvent | FeeEvent | DividendEvent | SplitEvent;
export type LedgerEventType = LedgerEvent["type"];
