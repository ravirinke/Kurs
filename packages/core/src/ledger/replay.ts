import type { DateTime } from "luxon";

import type { InstrumentId } from "../market";
import { type Currency, type Decimal, Money, ZERO } from "../money";

import type { LedgerEvent } from "./events";

export interface Position {
  instrumentId: InstrumentId;
  quantity: Decimal;
  /** Total cost of the shares held, including brokerage, in the league currency. */
  costBasis: Money;
}

export interface LedgerState {
  currency: Currency;
  cash: Money;
  /** Only positions with a quantity above zero. */
  positions: ReadonlyMap<InstrumentId, Position>;
  /** Time of the latest buy or sell, used for the leaderboard tie-break. */
  lastTradeAt: DateTime | null;
}

/** The ledger would end up in a state that must never happen (negative cash or shares). */
export class LedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerInvariantError";
  }
}

export function averageCost(position: Position): Money {
  return position.costBasis.dividedBy(position.quantity);
}

export function emptyLedger(currency: Currency): LedgerState {
  return { currency, cash: Money.zero(currency), positions: new Map(), lastTradeAt: null };
}

/**
 * Rebuilds cash and holdings from events. Events must be in chronological order
 * (ties keep their given order). Throws LedgerInvariantError on impossible states.
 */
export function replay(currency: Currency, events: readonly LedgerEvent[]): LedgerState {
  let cash = Money.zero(currency);
  const positions = new Map<InstrumentId, Position>();
  let lastTradeAt: DateTime | null = null;
  let previousAt: DateTime | null = null;

  for (const event of events) {
    if (previousAt && event.at.toMillis() < previousAt.toMillis()) {
      throw new LedgerInvariantError(`Events out of order at ${event.id}`);
    }
    previousAt = event.at;

    switch (event.type) {
      case "deposit":
        cash = cash.plus(event.amount);
        break;

      case "fee":
        cash = cash.minus(event.amount);
        break;

      case "buy": {
        const cost = event.grossAmount.plus(event.fee);
        cash = cash.minus(cost);
        const current = positions.get(event.instrumentId);
        positions.set(event.instrumentId, {
          instrumentId: event.instrumentId,
          quantity: (current?.quantity ?? ZERO).plus(event.quantity),
          costBasis: (current?.costBasis ?? Money.zero(currency)).plus(cost),
        });
        lastTradeAt = event.at;
        break;
      }

      case "sell": {
        const current = positions.get(event.instrumentId);
        if (!current || current.quantity.lessThan(event.quantity)) {
          throw new LedgerInvariantError(`Sell of more shares than held in ${event.id}`);
        }
        cash = cash.plus(event.grossAmount).minus(event.fee);
        const remaining = current.quantity.minus(event.quantity);
        if (remaining.isZero()) {
          positions.delete(event.instrumentId);
        } else {
          // Selling keeps the average cost: reduce the cost basis proportionally.
          positions.set(event.instrumentId, {
            instrumentId: event.instrumentId,
            quantity: remaining,
            costBasis: current.costBasis.times(remaining.dividedBy(current.quantity)),
          });
        }
        lastTradeAt = event.at;
        break;
      }

      case "dividend":
        cash = cash.plus(event.amount);
        break;

      case "split": {
        const current = positions.get(event.instrumentId);
        const held = current?.quantity ?? ZERO;
        if (!held.equals(event.quantityBefore)) {
          throw new LedgerInvariantError(
            `Split ${event.id} expects ${event.quantityBefore.toString()} shares, ledger has ${held.toString()}`,
          );
        }
        cash = cash.plus(event.cashInLieu);
        if (!current) break;
        if (event.quantityAfter.isZero()) {
          positions.delete(event.instrumentId);
          break;
        }
        // The cost basis follows the shares: the part paid out as cash in lieu leaves with it.
        const exactAfter = event.quantityBefore.times(event.ratioTo).dividedBy(event.ratioFrom);
        positions.set(event.instrumentId, {
          instrumentId: event.instrumentId,
          quantity: event.quantityAfter,
          costBasis: current.costBasis.times(event.quantityAfter.dividedBy(exactAfter)),
        });
        break;
      }
    }

    if (cash.isNegative()) {
      throw new LedgerInvariantError(`Cash would be negative after ${event.id}`);
    }
  }

  return { currency, cash, positions, lastTradeAt };
}

/** The ledger as it looked at `asOf` (inclusive). Used for delayed visibility. */
export function replayUntil(
  currency: Currency,
  events: readonly LedgerEvent[],
  asOf: DateTime,
): LedgerState {
  return replay(
    currency,
    events.filter((event) => event.at.toMillis() <= asOf.toMillis()),
  );
}

/** Shares of an instrument held strictly before `at`. Used for dividend eligibility. */
export function quantityHeldBefore(
  currency: Currency,
  events: readonly LedgerEvent[],
  instrumentId: InstrumentId,
  at: DateTime,
): Decimal {
  const state = replay(
    currency,
    events.filter((event) => event.at.toMillis() < at.toMillis()),
  );
  return state.positions.get(instrumentId)?.quantity ?? ZERO;
}
