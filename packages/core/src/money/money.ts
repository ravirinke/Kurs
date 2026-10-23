import type { Currency } from "./currency";
import { decimal, type Decimal, type DecimalInput } from "./decimal";
import { MONEY_DECIMALS, roundHalfUp } from "./rounding";

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Currency mismatch: ${a} vs ${b}`);
    this.name = "CurrencyMismatchError";
  }
}

/** An immutable amount in a currency. Arithmetic across currencies throws. */
export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: Currency,
  ) {}

  static of(amount: DecimalInput, currency: Currency): Money {
    return new Money(decimal(amount), currency);
  }

  static zero(currency: Currency): Money {
    return new Money(decimal("0"), currency);
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  times(factor: DecimalInput): Money {
    return new Money(this.amount.times(decimal(factor)), this.currency);
  }

  dividedBy(divisor: DecimalInput): Money {
    return new Money(this.amount.dividedBy(decimal(divisor)), this.currency);
  }

  /** Ratio between two amounts in the same currency. */
  ratioTo(other: Money): Decimal {
    this.assertSameCurrency(other);
    return this.amount.dividedBy(other.amount);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  /** Rounds to booking precision (2 decimals, half-up). */
  round(): Money {
    return new Money(roundHalfUp(this.amount, MONEY_DECIMALS), this.currency);
  }

  max(other: Money): Money {
    return this.gte(other) ? this : other;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  gt(other: Money): boolean {
    return this.compare(other) > 0;
  }

  gte(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  lt(other: Money): boolean {
    return this.compare(other) < 0;
  }

  lte(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  /** Full-precision string form, for storage and transport. */
  toJSON(): { amount: string; currency: Currency } {
    return { amount: this.amount.toString(), currency: this.currency };
  }

  toString(): string {
    return `${this.amount.toString()} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
