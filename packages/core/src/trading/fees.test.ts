import { describe, expect, it } from "vitest";

import { decimal, Money } from "../money";

import { calculateFee, defaultFeeRule } from "./fees";

const nokRule = defaultFeeRule("NOK");

describe("brokerage (0.05 %, minimum per currency)", () => {
  it("uses the minimum when the percentage is lower", () => {
    // 0.05 % of 19 776,00 = 9,888 < 29
    expect(calculateFee(Money.of("19776.00", "NOK"), nokRule).amount.toString()).toBe("29");
  });

  it("uses the percentage when it is higher", () => {
    // 0.05 % of 100 000 = 50
    expect(calculateFee(Money.of("100000", "NOK"), nokRule).amount.toString()).toBe("50");
  });

  it("is exactly the minimum at the break-even amount", () => {
    // 29 / 0.0005 = 58 000
    expect(calculateFee(Money.of("58000", "NOK"), nokRule).amount.toString()).toBe("29");
  });

  it("rounds the percentage half-up to øre", () => {
    // 0.05 % of 58 010 = 29,005 → 29,01
    expect(calculateFee(Money.of("58010", "NOK"), nokRule).amount.toString()).toBe("29.01");
    // 0.05 % of 58 009,98 = 29,00499 → 29,00
    expect(calculateFee(Money.of("58009.98", "NOK"), nokRule).amount.toString()).toBe("29");
  });

  it.each([
    ["NOK", "29"],
    ["SEK", "29"],
    ["DKK", "19"],
    ["EUR", "3"],
    ["USD", "3"],
  ] as const)("defaults the %s minimum to %s", (currency, minimum) => {
    const rule = defaultFeeRule(currency);
    expect(rule.minimum.amount.toString()).toBe(minimum);
    expect(rule.minimum.currency).toBe(currency);
    expect(rule.rate.toString()).toBe("0.0005");
  });

  it("supports custom league rules", () => {
    const rule = { rate: decimal("0.001"), minimum: Money.of("0", "EUR") };
    expect(calculateFee(Money.of("1234.56", "EUR"), rule).amount.toString()).toBe("1.23");
  });
});
