import { describe, expect, it } from "vitest";

import { fxRate, identityRate } from "../fx";
import { decimal, Money } from "../money";
import { AAPL, EQNR } from "../testing/fixtures";
import { instant } from "../time";

import { defaultFeeRule } from "./fees";
import { buildQuote, isQuoteExpired, QUOTE_TTL_SECONDS } from "./quote";

const now = instant("2026-10-26T14:00:00Z");

function appleQuote(side: "buy" | "sell", quantity: string, price = "182.40", rate = "10.8421053") {
  return buildQuote({
    id: "q1",
    leagueId: "league",
    memberId: "member",
    order: { type: "market", side, instrumentId: AAPL.id, quantity: decimal(quantity) },
    instrument: AAPL,
    marketPrice: Money.of(price, "USD"),
    marketFxRate: fxRate("USD", "NOK", rate),
    feeRule: defaultFeeRule("NOK"),
    now,
  });
}

describe("quote", () => {
  it("matches the brief's example: 10 × 182,40 USD × 10,842105 = 19 776,00 NOK + 29,00 = 19 805,00 NOK", () => {
    const quote = appleQuote("buy", "10");
    expect(quote.price.toString()).toBe("182.4 USD");
    expect(quote.fxRate.rate.toString()).toBe("10.842105");
    expect(quote.grossAmount.toString()).toBe("19776 NOK");
    expect(quote.fee.toString()).toBe("29 NOK");
    expect(quote.totalAmount.toString()).toBe("19805 NOK");
  });

  it("locks the FX rate to 6 decimals and the price to 4", () => {
    const quote = appleQuote("buy", "1", "182.404567", "10.84210549");
    expect(quote.price.amount.toString()).toBe("182.4046");
    expect(quote.fxRate.rate.toString()).toBe("10.842105");
  });

  it("calculates with the locked values, so the user can verify the sum", () => {
    const quote = appleQuote("buy", "3", "182.404567", "10.84210549");
    const byHand = decimal("3").times("182.4046").times("10.842105").toDecimalPlaces(2);
    expect(quote.grossAmount.amount.equals(byHand)).toBe(true);
  });

  it("subtracts the fee from the proceeds of a sale", () => {
    const quote = appleQuote("sell", "10");
    expect(quote.totalAmount.toString()).toBe("19747 NOK");
  });

  it("needs no conversion for a stock in the league currency", () => {
    const quote = buildQuote({
      id: "q2",
      leagueId: "league",
      memberId: "member",
      order: { type: "market", side: "buy", instrumentId: EQNR.id, quantity: decimal("400") },
      instrument: EQNR,
      marketPrice: Money.of("265.40", "NOK"),
      marketFxRate: identityRate("NOK"),
      feeRule: defaultFeeRule("NOK"),
      now,
    });
    expect(quote.grossAmount.toString()).toBe("106160 NOK");
    expect(quote.fee.toString()).toBe("53.08 NOK");
    expect(quote.totalAmount.toString()).toBe("106213.08 NOK");
  });

  it("refuses an FX rate that does not convert to the league currency", () => {
    expect(() =>
      buildQuote({
        id: "q3",
        leagueId: "league",
        memberId: "member",
        order: { type: "market", side: "buy", instrumentId: AAPL.id, quantity: decimal("1") },
        instrument: AAPL,
        marketPrice: Money.of("182.40", "USD"),
        marketFxRate: fxRate("USD", "SEK", "10.45"),
        feeRule: defaultFeeRule("NOK"),
        now,
      }),
    ).toThrow();
  });

  it(`expires after ${QUOTE_TTL_SECONDS} seconds`, () => {
    const quote = appleQuote("buy", "1");
    expect(quote.expiresAt.diff(quote.createdAt, "seconds").seconds).toBe(QUOTE_TTL_SECONDS);
    expect(isQuoteExpired(quote, now.plus({ milliseconds: QUOTE_TTL_SECONDS * 1000 - 1 }))).toBe(
      false,
    );
    expect(isQuoteExpired(quote, now.plus({ seconds: QUOTE_TTL_SECONDS }))).toBe(true);
  });
});
