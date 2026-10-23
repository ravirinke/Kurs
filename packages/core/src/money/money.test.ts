import { describe, expect, it } from "vitest";

import { decimal } from "./decimal";
import { CurrencyMismatchError, Money } from "./money";
import { roundHalfUp } from "./rounding";

describe("rounding (half-up)", () => {
  it.each([
    ["0.005", "0.01"],
    ["0.004999", "0"],
    ["2.345", "2.35"],
    ["2.355", "2.36"],
    ["19775.99952", "19776"],
    ["-2.345", "-2.35"],
  ])("rounds %s to %s at 2 decimals", (input, expected) => {
    expect(roundHalfUp(decimal(input), 2).toString()).toBe(expected);
  });

  it("does not suffer from binary floating point", () => {
    // In JS numbers 0.1 + 0.2 = 0.30000000000000004 and 1.005 rounds to 1.00.
    expect(decimal("0.1").plus("0.2").toString()).toBe("0.3");
    expect(Money.of("1.005", "NOK").round().amount.toString()).toBe("1.01");
  });
});

describe("Money", () => {
  it("keeps full precision until rounded", () => {
    const amount = Money.of("10", "NOK").times("0.333333333333");
    expect(amount.amount.toString()).toBe("3.33333333333");
    expect(amount.round().amount.toString()).toBe("3.33");
  });

  it("refuses to mix currencies", () => {
    expect(() => Money.of("1", "NOK").plus(Money.of("1", "USD"))).toThrow(CurrencyMismatchError);
    expect(() => Money.of("1", "NOK").gt(Money.of("1", "USD"))).toThrow(CurrencyMismatchError);
  });

  it("compares", () => {
    const a = Money.of("10.00", "SEK");
    const b = Money.of("10", "SEK");
    expect(a.equals(b)).toBe(true);
    expect(a.max(Money.of("12", "SEK")).amount.toString()).toBe("12");
    expect(Money.of("-0.01", "SEK").isNegative()).toBe(true);
    expect(Money.of("-0", "SEK").isNegative()).toBe(false);
  });

  it("serialises without losing digits", () => {
    expect(Money.of("19805.123456789", "NOK").toJSON()).toEqual({
      amount: "19805.123456789",
      currency: "NOK",
    });
  });

  it("rejects values that are not finite", () => {
    expect(() => decimal("NaN")).toThrow();
    expect(() => decimal("Infinity")).toThrow();
  });
});
