import type { Decimal } from "./decimal";

/**
 * Whole shares only (docs/decisions.md). Quantities are still Decimals, so fractional
 * shares can be allowed later without changing types or storage.
 */
export function isWholeQuantity(quantity: Decimal): boolean {
  return quantity.isInteger();
}

export function isPositiveQuantity(quantity: Decimal): boolean {
  return quantity.greaterThan(0);
}
