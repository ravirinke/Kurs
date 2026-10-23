import DecimalJs from "decimal.js";

/**
 * Decimal configured for money. A private clone, so the global decimal.js settings that
 * other libraries rely on are never changed. Precision is high enough that intermediate
 * results (quantity × price × FX) never lose digits before we round on purpose.
 */
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -20,
  toExpPos: 30,
});
export type Decimal = DecimalJs;

/** Values a decimal may be created from. JS `number` is deliberately not accepted. */
export type DecimalInput = string | bigint | DecimalJs;

export function decimal(value: DecimalInput): Decimal {
  const result = new Decimal(typeof value === "bigint" ? value.toString() : value);
  if (!result.isFinite()) throw new RangeError(`Not a finite decimal: ${String(value)}`);
  return result;
}

export function isDecimal(value: unknown): value is Decimal {
  return DecimalJs.isDecimal(value);
}

export const ZERO = decimal("0");
export const ONE = decimal("1");
