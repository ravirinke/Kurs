import { type Currency, decimal, type Decimal, Money } from "../money";

/** Brokerage: a percentage of the trade amount, but never less than a minimum. */
export interface FeeRule {
  /** Fraction of the gross amount, e.g. 0.0005 for 0.05 %. */
  rate: Decimal;
  /** In the league currency. */
  minimum: Money;
}

export const DEFAULT_FEE_RATE = decimal("0.0005");

export const DEFAULT_MINIMUM_FEE: Readonly<Record<Currency, string>> = {
  NOK: "29",
  SEK: "29",
  DKK: "19",
  EUR: "3",
  USD: "3",
};

export function defaultFeeRule(currency: Currency): FeeRule {
  return { rate: DEFAULT_FEE_RATE, minimum: Money.of(DEFAULT_MINIMUM_FEE[currency], currency) };
}

/** Fee for a booked (rounded) gross amount: max(gross × rate, minimum), rounded half-up. */
export function calculateFee(grossAmount: Money, rule: FeeRule): Money {
  return grossAmount.times(rule.rate).max(rule.minimum).round();
}
