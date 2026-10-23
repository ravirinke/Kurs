import type { DateTime } from "luxon";

import type { TradeEvent } from "../ledger";

import type { Quote } from "./quote";

/**
 * Turns a confirmed quote into a ledger event at exactly the locked price. The caller must
 * have run validateTrade with fresh state inside the same database transaction.
 */
export function executeQuote(quote: Quote, eventId: string, executedAt: DateTime): TradeEvent {
  return {
    id: eventId,
    type: quote.side,
    at: executedAt,
    instrumentId: quote.instrumentId,
    quantity: quote.quantity,
    price: quote.price,
    fxRate: quote.fxRate,
    grossAmount: quote.grossAmount,
    fee: quote.fee,
    quoteId: quote.id,
  };
}
