import { convert, type FxRate, lockFxRate } from "../fx";
import { type Decimal, decimal, Money, PRICE_DECIMALS, roundHalfUp, ZERO } from "../money";

import { calculateFee, type FeeRule } from "./fees";

export interface BuyCost {
  grossAmount: Money;
  fee: Money;
  totalAmount: Money;
}

/** What buying `quantity` shares costs, calculated exactly like a quote (same rounding). */
export function buyCost(quantity: Decimal, price: Money, rate: FxRate, feeRule: FeeRule): BuyCost {
  const lockedPrice = Money.of(roundHalfUp(price.amount, PRICE_DECIMALS), price.currency);
  const grossAmount = convert(lockedPrice.times(quantity), lockFxRate(rate)).round();
  const fee = calculateFee(grossAmount, feeRule);
  return { grossAmount, fee, totalAmount: grossAmount.plus(fee) };
}

/**
 * The most whole shares whose total cost, brokerage included, fits in `amount` (league
 * currency). Used when the user types an amount instead of a quantity. Returns 0 when not
 * even one share fits.
 */
export function maxQuantityForAmount(input: {
  amount: Money;
  price: Money;
  fxRate: FxRate;
  feeRule: FeeRule;
}): Decimal {
  const { amount, price, fxRate, feeRule } = input;
  if (amount.currency !== feeRule.minimum.currency)
    throw new RangeError("Amount must be in the league currency");
  if (!amount.amount.greaterThan(0) || !price.amount.greaterThan(0)) return ZERO;

  const fits = (quantity: Decimal) =>
    buyCost(quantity, price, fxRate, feeRule).totalAmount.lte(amount);
  const unitCost = price.amount.times(fxRate.rate);

  // Start just below the answer (fee as a rate on top), then step to the exact boundary.
  let quantity = amount.amount.dividedBy(unitCost.times(decimal("1").plus(feeRule.rate))).floor();
  while (quantity.greaterThan(0) && !fits(quantity)) quantity = quantity.minus(1);
  while (fits(quantity.plus(1))) quantity = quantity.plus(1);
  return quantity.isNegative() ? ZERO : quantity;
}
