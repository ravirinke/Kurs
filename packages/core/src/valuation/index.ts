import type { DateTime } from "luxon";

import { convert, type FxRate } from "../fx";
import type { LedgerState } from "../ledger";
import type { Instrument, InstrumentId } from "../market";
import type { Currency, Decimal, Money } from "../money";
import type { PriceProvider } from "../pricing/provider";

/** The price and FX rate a holding is valued at. */
export interface Mark {
  instrumentId: InstrumentId;
  /** In the trading currency. */
  price: Money;
  /** Trading currency → league currency. */
  fxRate: FxRate;
  source: "live" | "last_close";
  asOf: DateTime;
}

export interface HoldingValuation {
  instrumentId: InstrumentId;
  quantity: Decimal;
  mark: Mark;
  /** Full precision, league currency. */
  marketValue: Money;
  costBasis: Money;
  /** marketValue − costBasis. */
  unrealizedGain: Money;
}

export interface PortfolioValuation {
  cash: Money;
  holdings: HoldingValuation[];
  /** cash + Σ holdings, rounded to øre. */
  totalValue: Money;
}

export class MissingMarkError extends Error {
  constructor(instrumentId: InstrumentId) {
    super(`No price for ${instrumentId}`);
    this.name = "MissingMarkError";
  }
}

/** Portfolio value = cash + Σ (quantity × price × FX to league currency). */
export function valuePortfolio(
  ledger: LedgerState,
  marks: ReadonlyMap<InstrumentId, Mark>,
): PortfolioValuation {
  const holdings: HoldingValuation[] = [];
  let total = ledger.cash;

  for (const position of ledger.positions.values()) {
    const mark = marks.get(position.instrumentId);
    if (!mark) throw new MissingMarkError(position.instrumentId);
    const marketValue = convert(mark.price.times(position.quantity), mark.fxRate);
    total = total.plus(marketValue);
    holdings.push({
      instrumentId: position.instrumentId,
      quantity: position.quantity,
      mark,
      marketValue,
      costBasis: position.costBasis,
      unrealizedGain: marketValue.minus(position.costBasis),
    });
  }

  return { cash: ledger.cash, holdings, totalValue: total.round() };
}

/**
 * Looks up marks for a set of instruments. While an exchange is open: the live price and
 * the live FX rate. While it is closed: the last close and the FX rate frozen at the moment
 * that exchange closed, so values stand still over nights and weekends.
 */
export async function resolveMarks(
  provider: PriceProvider,
  instruments: readonly Instrument[],
  leagueCurrency: Currency,
  at?: DateTime,
): Promise<Map<InstrumentId, Mark>> {
  const entries = await Promise.all(
    instruments.map(async (instrument): Promise<[InstrumentId, Mark]> => {
      const status = await provider.getMarketStatus(instrument.exchangeId, at);
      if (status.isOpen) {
        const quote = await provider.getQuote(instrument.id, at);
        const rate = await provider.getFxRate(instrument.currency, leagueCurrency, at);
        return [
          instrument.id,
          {
            instrumentId: instrument.id,
            price: quote.price,
            fxRate: rate,
            source: "live",
            asOf: quote.at,
          },
        ];
      }
      const close = await provider.getLastClose(instrument.id, at);
      const rate = await provider.getFxRate(instrument.currency, leagueCurrency, close.closedAt);
      return [
        instrument.id,
        {
          instrumentId: instrument.id,
          price: close.price,
          fxRate: rate,
          source: "last_close",
          asOf: close.closedAt,
        },
      ];
    }),
  );
  return new Map(entries);
}

export interface ValueChange {
  amount: Money;
  /** As a fraction of the earlier value. */
  fraction: Decimal;
}

/** Change since an earlier value, e.g. the previous daily snapshot ("dagens endring"). */
export function valueChange(current: Money, previous: Money): ValueChange {
  const amount = current.minus(previous);
  return { amount, fraction: amount.ratioTo(previous) };
}
