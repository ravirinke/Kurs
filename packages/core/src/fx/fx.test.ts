import { describe, expect, it } from "vitest";

import { Money } from "../money";

import { convert, crossRate, fxRate, identityRate, invertRate, lockFxRate } from "./index";

describe("fx", () => {
  it("converts at full precision", () => {
    const usdNok = fxRate("USD", "NOK", "10.84213377");
    expect(convert(Money.of("1824", "USD"), usdNok).amount.toString()).toBe("19776.05199648");
  });

  it("refuses to convert with a rate for another currency", () => {
    expect(() => convert(Money.of("1", "SEK"), fxRate("USD", "NOK", "10"))).toThrow();
  });

  it("locks rates half-up to 6 decimals", () => {
    expect(lockFxRate(fxRate("NOK", "USD", "0.0922345")).rate.toString()).toBe("0.092235");
    expect(lockFxRate(fxRate("NOK", "USD", "0.0922344999")).rate.toString()).toBe("0.092234");
    expect(lockFxRate(fxRate("USD", "NOK", "10.8421")).rate.toString()).toBe("10.8421");
  });

  it("keeps small rates meaningful (why 2 decimals is not enough)", () => {
    const nokUsd = lockFxRate(fxRate("NOK", "USD", "0.09223"));
    const booked = convert(Money.of("10000", "NOK"), nokUsd).round();
    expect(booked.amount.toString()).toBe("922.3");
  });

  it("uses 1 for the same currency", () => {
    expect(identityRate("NOK").rate.toString()).toBe("1");
    expect(() => fxRate("NOK", "NOK", "1.01")).toThrow();
  });

  it("rejects non-positive rates", () => {
    expect(() => fxRate("USD", "NOK", "0")).toThrow();
    expect(() => fxRate("USD", "NOK", "-1")).toThrow();
  });

  it("derives cross rates via a common base", () => {
    // 1 USD = 10 NOK, 1 USD = 10.5 SEK → 1 SEK = 10 / 10.5 NOK
    const rate = crossRate(fxRate("USD", "SEK", "10.5"), fxRate("USD", "NOK", "10"));
    expect(rate.from).toBe("SEK");
    expect(rate.to).toBe("NOK");
    expect(lockFxRate(rate).rate.toString()).toBe("0.952381");
  });

  it("inverts", () => {
    const inverted = invertRate(fxRate("USD", "NOK", "10"));
    expect(inverted.from).toBe("NOK");
    expect(inverted.rate.toString()).toBe("0.1");
  });
});
