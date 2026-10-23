// Shared test data. Not exported from the package.
import type { DateTime } from "luxon";

import { fxRate, identityRate } from "../fx";
import type { DepositEvent, TradeEvent } from "../ledger";
import { EXCHANGES, type Instrument } from "../market";
import { type Currency, decimal, Money } from "../money";
import { MockPriceProvider, type MockInstrument } from "../pricing";
import { fixedClock, instant } from "../time";

export const EQNR: Instrument = {
  id: "eqnr",
  ticker: "EQNR",
  isin: "NO0010096985",
  name: "Equinor",
  exchangeId: "XOSL",
  currency: "NOK",
};

export const AAPL: Instrument = {
  id: "aapl",
  ticker: "AAPL",
  isin: "US0378331005",
  name: "Apple",
  exchangeId: "XNAS",
  currency: "USD",
};

export const VOLV: Instrument = {
  id: "volv-b",
  ticker: "VOLV B",
  isin: "SE0000115446",
  name: "Volvo B",
  exchangeId: "XSTO",
  currency: "SEK",
};

export const MOCK_INSTRUMENTS: MockInstrument[] = [
  { instrument: EQNR, basePrice: "265.40" },
  { instrument: AAPL, basePrice: "182.40" },
  { instrument: VOLV, basePrice: "268.00" },
];

export function mockProvider(nowIso: string): MockPriceProvider {
  return new MockPriceProvider({
    clock: fixedClock(instant(nowIso)),
    exchanges: EXCHANGES,
    instruments: MOCK_INSTRUMENTS,
  });
}

export function nok(amount: string): Money {
  return Money.of(amount, "NOK");
}

export function usd(amount: string): Money {
  return Money.of(amount, "USD");
}

export function deposit(amount: Money, at: DateTime, id = "deposit"): DepositEvent {
  return { id, type: "deposit", at, amount };
}

interface TradeEventInput {
  id: string;
  side: "buy" | "sell";
  at: DateTime;
  instrument: Instrument;
  quantity: string;
  price: string;
  fx?: string;
  fee: string;
  leagueCurrency?: Currency;
}

/** A trade event with gross = quantity × price × fx, rounded. */
export function trade(input: TradeEventInput): TradeEvent {
  const leagueCurrency = input.leagueCurrency ?? "NOK";
  const rate =
    input.instrument.currency === leagueCurrency
      ? identityRate(leagueCurrency)
      : fxRate(input.instrument.currency, leagueCurrency, input.fx ?? "1");
  const price = Money.of(input.price, input.instrument.currency);
  const quantity = decimal(input.quantity);
  return {
    id: input.id,
    type: input.side,
    at: input.at,
    instrumentId: input.instrument.id,
    quantity,
    price,
    fxRate: rate,
    grossAmount: Money.of(quantity.times(price.amount).times(rate.rate), leagueCurrency).round(),
    fee: Money.of(input.fee, leagueCurrency),
    quoteId: `quote-${input.id}`,
  };
}
