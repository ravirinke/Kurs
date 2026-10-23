import {
  type Currency,
  decimal,
  type Decimal,
  type DecimalInput,
  FX_RATE_DECIMALS,
  Money,
  ONE,
  roundHalfUp,
} from "../money";

/** 1 unit of `from` = `rate` units of `to`. */
export interface FxRate {
  from: Currency;
  to: Currency;
  rate: Decimal;
}

export function fxRate(from: Currency, to: Currency, rate: DecimalInput): FxRate {
  const value = decimal(rate);
  if (!value.greaterThan(0))
    throw new RangeError(`FX rate must be positive: ${from}/${to} ${value.toString()}`);
  if (from === to && !value.equals(ONE)) throw new RangeError(`FX rate ${from}/${to} must be 1`);
  return { from, to, rate: value };
}

export function identityRate(currency: Currency): FxRate {
  return { from: currency, to: currency, rate: ONE };
}

/** Converts at full precision. Round the result only when booking or displaying it. */
export function convert(money: Money, rate: FxRate): Money {
  if (money.currency !== rate.from) {
    throw new RangeError(`Cannot convert ${money.currency} with a ${rate.from}/${rate.to} rate`);
  }
  return Money.of(money.amount.times(rate.rate), rate.to);
}

/** The rate a quote locks: half-up to 6 decimals (docs/decisions.md). */
export function lockFxRate(rate: FxRate): FxRate {
  return { ...rate, rate: roundHalfUp(rate.rate, FX_RATE_DECIMALS) };
}

export function invertRate(rate: FxRate): FxRate {
  return { from: rate.to, to: rate.from, rate: ONE.dividedBy(rate.rate) };
}

/**
 * Derives from→to from two rates against a common base currency.
 * `base→from` and `base→to` give `from→to = (base→to) / (base→from)`.
 */
export function crossRate(baseToFrom: FxRate, baseToTo: FxRate): FxRate {
  if (baseToFrom.from !== baseToTo.from)
    throw new RangeError("Cross rate needs a common base currency");
  if (baseToFrom.to === baseToTo.to) return identityRate(baseToFrom.to);
  return fxRate(baseToFrom.to, baseToTo.to, baseToTo.rate.dividedBy(baseToFrom.rate));
}
