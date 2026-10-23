import { Decimal } from "./decimal";

/*
 * Rounding policy (docs/decisions.md):
 * - Always half-up.
 * - Only when an amount is booked (written to a transaction) or displayed.
 * - Everything in between keeps full precision.
 */

/** Decimals for booked amounts in every supported currency. */
export const MONEY_DECIMALS = 2;
/** Decimals a quote locks the FX rate with. */
export const FX_RATE_DECIMALS = 6;
/** Decimals a quote locks the instrument price with. */
export const PRICE_DECIMALS = 4;

export function roundHalfUp(value: Decimal, decimals: number): Decimal {
  return value.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}
