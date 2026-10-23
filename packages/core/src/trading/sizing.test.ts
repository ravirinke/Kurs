import { describe, expect, it } from "vitest";

import { fxRate, identityRate } from "../fx";
import { decimal, Money } from "../money";

import { defaultFeeRule } from "./fees";
import { buyCost, maxQuantityForAmount } from "./sizing";

const nokRule = defaultFeeRule("NOK");

describe("maxQuantityForAmount", () => {
  it("buys as many whole shares as fit, brokerage included", () => {
    // 10 × 100 + 29 = 1 029 ≤ 1 100; 11 × 100 + 29 = 1 129 > 1 100
    const quantity = maxQuantityForAmount({
      amount: Money.of("1100", "NOK"),
      price: Money.of("100", "NOK"),
      fxRate: identityRate("NOK"),
      feeRule: nokRule,
    });
    expect(quantity.toString()).toBe("10");
  });

  it("is exact at the boundary", () => {
    const quantity = maxQuantityForAmount({
      amount: Money.of("1029", "NOK"),
      price: Money.of("100", "NOK"),
      fxRate: identityRate("NOK"),
      feeRule: nokRule,
    });
    expect(quantity.toString()).toBe("10");
    const justBelow = maxQuantityForAmount({
      amount: Money.of("1028.99", "NOK"),
      price: Money.of("100", "NOK"),
      fxRate: identityRate("NOK"),
      feeRule: nokRule,
    });
    expect(justBelow.toString()).toBe("9");
  });

  it("converts foreign prices with the same rounding as a quote", () => {
    const price = Money.of("182.40", "USD");
    const rate = fxRate("USD", "NOK", "10.8421053");
    const quantity = maxQuantityForAmount({
      amount: Money.of("20000", "NOK"),
      price,
      fxRate: rate,
      feeRule: nokRule,
    });
    // 10 shares cost 19 805,00 NOK (the brief's example); 11 would cost far more.
    expect(quantity.toString()).toBe("10");
    expect(buyCost(quantity, price, rate, nokRule).totalAmount.toString()).toBe("19805 NOK");
  });

  it("accounts for the percentage fee on large amounts", () => {
    // 1 000 000 NOK at 100: 9 995 × 100 = 999 500 + 499,75 fee = 999 999,75 ≤ 1 000 000
    const quantity = maxQuantityForAmount({
      amount: Money.of("1000000", "NOK"),
      price: Money.of("100", "NOK"),
      fxRate: identityRate("NOK"),
      feeRule: nokRule,
    });
    expect(quantity.toString()).toBe("9995");
    expect(
      buyCost(
        quantity.plus(1),
        Money.of("100", "NOK"),
        identityRate("NOK"),
        nokRule,
      ).totalAmount.gt(Money.of("1000000", "NOK")),
    ).toBe(true);
  });

  it("returns 0 when not even one share plus the fee fits", () => {
    expect(
      maxQuantityForAmount({
        amount: Money.of("120", "NOK"),
        price: Money.of("100", "NOK"),
        fxRate: identityRate("NOK"),
        feeRule: nokRule,
      }).toString(),
    ).toBe("0");
    expect(
      maxQuantityForAmount({
        amount: Money.of("0", "NOK"),
        price: Money.of("100", "NOK"),
        fxRate: identityRate("NOK"),
        feeRule: nokRule,
      }).toString(),
    ).toBe("0");
  });

  it("handles cheap shares where the minimum fee dominates", () => {
    const quantity = maxQuantityForAmount({
      amount: Money.of("100", "NOK"),
      price: Money.of("0.5", "NOK"),
      fxRate: identityRate("NOK"),
      feeRule: nokRule,
    });
    // 142 × 0,5 = 71 + 29 = 100
    expect(quantity.toString()).toBe("142");
  });

  it("refuses an amount in another currency than the league", () => {
    expect(() =>
      maxQuantityForAmount({
        amount: Money.of("100", "SEK"),
        price: Money.of("1", "NOK"),
        fxRate: identityRate("NOK"),
        feeRule: nokRule,
      }),
    ).toThrow();
  });

  it("never returns a fraction", () => {
    const quantity = maxQuantityForAmount({
      amount: Money.of("12345.67", "NOK"),
      price: Money.of("33.33", "NOK"),
      fxRate: identityRate("NOK"),
      feeRule: nokRule,
    });
    expect(quantity.isInteger()).toBe(true);
    expect(quantity.greaterThan(decimal("0"))).toBe(true);
  });
});
