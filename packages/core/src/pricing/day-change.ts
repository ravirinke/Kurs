import type { DateTime } from "luxon";

import type { Instrument, InstrumentId } from "../market";
import type { Decimal, Money } from "../money";

import type { PriceProvider } from "./provider";

export interface PriceWithDayChange {
  instrumentId: InstrumentId;
  /** Live price, or the last close when the exchange is closed. */
  price: Money;
  source: "live" | "last_close";
  at: DateTime;
  /** The close before the current (or most recent) session. */
  previousClose: Money;
  change: Money;
  /** change / previousClose */
  changeFraction: Decimal;
}

/**
 * Today's move for an instrument, as on a stock list: the current price against the close
 * before the session it belongs to. Over a weekend this shows Friday's move.
 */
export async function priceWithDayChange(
  provider: PriceProvider,
  instrument: Instrument,
  at?: DateTime,
): Promise<PriceWithDayChange> {
  const [status, quote] = await Promise.all([
    provider.getMarketStatus(instrument.exchangeId, at),
    provider.getQuote(instrument.id, at),
  ]);
  const sessionStart = status.currentSession?.opensAt ?? quote.at;
  const previous = await provider.getLastClose(
    instrument.id,
    sessionStart.minus({ milliseconds: 1 }),
  );
  const change = quote.price.minus(previous.price);
  return {
    instrumentId: instrument.id,
    price: quote.price,
    source: quote.source,
    at: quote.at,
    previousClose: previous.price,
    change,
    changeFraction: change.ratioTo(previous.price),
  };
}
