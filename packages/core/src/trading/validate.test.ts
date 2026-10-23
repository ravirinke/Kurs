import type { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { fxRate } from "../fx";
import type { LeagueStatus } from "../league/types";
import { replay } from "../ledger";
import { getMarketStatus, NASDAQ_US } from "../market";
import { decimal, type Decimal, Money } from "../money";
import { AAPL, deposit, nok, trade } from "../testing/fixtures";
import { instant } from "../time";

import { defaultFeeRule } from "./fees";
import { buildQuote, type Quote, type TradeSide } from "./quote";
import {
  type TradeRejectionCode,
  validateOrder,
  validateTrade,
  type TradeValidation,
} from "./validate";

// Tuesday 27 Oct 2026, Nasdaq open 13:30Z–20:00Z (New York still on summer time).
const quoteTime = instant("2026-10-27T15:00:00Z");

function quote(side: TradeSide, quantity: string, at: DateTime = quoteTime): Quote {
  return buildQuote({
    id: "q",
    leagueId: "league",
    memberId: "member",
    order: { type: "market", side, instrumentId: AAPL.id, quantity: decimal(quantity) },
    instrument: AAPL,
    marketPrice: Money.of("100", "USD"),
    marketFxRate: fxRate("USD", "NOK", "10"),
    feeRule: defaultFeeRule("NOK"),
    now: at,
  });
}

interface Scenario {
  quote: Quote;
  now?: DateTime;
  cash?: string;
  applesHeld?: string;
  status?: LeagueStatus;
  allowedExchangeIds?: string[];
  maxPositionShare?: Decimal | null;
}

function check(scenario: Scenario): TradeValidation {
  const start = instant("2026-10-26T14:00:00Z");
  const events = [
    deposit(nok(scenario.cash ?? "100000"), start),
    ...(scenario.applesHeld
      ? [
          trade({
            id: "t0",
            side: "buy",
            at: start,
            instrument: AAPL,
            quantity: scenario.applesHeld,
            price: "0",
            fee: "0",
          }),
        ]
      : []),
  ];
  const ledger = replay("NOK", events);
  const now = scenario.now ?? quoteTime.plus({ seconds: 5 });
  const held = decimal(scenario.applesHeld ?? "0");
  return validateTrade({
    quote: scenario.quote,
    instrument: AAPL,
    rules: {
      leagueStatus: scenario.status ?? "active",
      allowedExchangeIds: scenario.allowedExchangeIds ?? ["XOSL", "XNAS"],
      maxPositionShare: scenario.maxPositionShare ?? null,
    },
    marketStatus: getMarketStatus(NASDAQ_US, now),
    ledger,
    // Existing apples valued at the quoted 100 USD × 10.
    portfolioValue: ledger.cash.plus(nok(held.times("1000").toString())),
    now,
  });
}

function codes(validation: TradeValidation): TradeRejectionCode[] {
  return validation.ok ? [] : validation.rejections.map((rejection) => rejection.code);
}

describe("validateOrder", () => {
  it.each([["0"], ["-1"]])("rejects quantity %s", (quantity) => {
    const result = validateOrder({
      type: "market",
      side: "buy",
      instrumentId: AAPL.id,
      quantity: decimal(quantity),
    });
    expect(codes(result)).toEqual(["INVALID_QUANTITY"]);
  });

  it("rejects a fraction of a share", () => {
    const result = validateOrder({
      type: "market",
      side: "buy",
      instrumentId: AAPL.id,
      quantity: decimal("1.5"),
    });
    expect(codes(result)).toEqual(["FRACTIONAL_QUANTITY"]);
  });

  it("accepts whole shares", () => {
    expect(
      validateOrder({ type: "market", side: "buy", instrumentId: AAPL.id, quantity: decimal("3") })
        .ok,
    ).toBe(true);
  });
});

describe("validateTrade", () => {
  it("accepts a valid buy", () => {
    expect(check({ quote: quote("buy", "10") })).toEqual({ ok: true });
  });

  it("accepts a valid sell", () => {
    expect(check({ quote: quote("sell", "5"), applesHeld: "5" })).toEqual({ ok: true });
  });

  describe("time-related", () => {
    it("rejects a quote confirmed after 30 seconds", () => {
      const result = check({ quote: quote("buy", "1"), now: quoteTime.plus({ seconds: 30 }) });
      expect(codes(result)).toEqual(["QUOTE_EXPIRED"]);
    });

    it("rejects when the exchange closes between quote and confirmation", () => {
      // Quoted 10 s before the 16:00 ET close (20:00Z), confirmed 2 s after it.
      const lastSecondQuote = quote("buy", "1", instant("2026-10-27T19:59:50Z"));
      const result = check({ quote: lastSecondQuote, now: instant("2026-10-27T20:00:02Z") });
      expect(codes(result)).toEqual(["MARKET_CLOSED"]);
      const closed = result.ok ? null : result.rejections[0];
      expect(closed?.code === "MARKET_CLOSED" && closed.nextOpenAt?.toUTC().toISO()).toBe(
        "2026-10-28T13:30:00.000Z",
      );
    });

    it("rejects trading on a closed exchange", () => {
      const saturday = instant("2026-10-31T15:00:00Z");
      const result = check({
        quote: quote("buy", "1", saturday),
        now: saturday.plus({ seconds: 1 }),
      });
      expect(codes(result)).toEqual(["MARKET_CLOSED"]);
    });

    it.each(["upcoming", "finished"] as const)("rejects when the league is %s", (status) => {
      expect(codes(check({ quote: quote("buy", "1"), status }))).toEqual(["LEAGUE_NOT_ACTIVE"]);
    });
  });

  describe("cash and holdings", () => {
    it("rejects a buy costing more than the cash balance", () => {
      // 10 × 100 USD × 10 = 10 000 + fee 29 = 10 029 NOK
      const result = check({ quote: quote("buy", "10"), cash: "10028.99" });
      expect(codes(result)).toEqual(["INSUFFICIENT_CASH"]);
    });

    it("accepts a buy that uses exactly all the cash", () => {
      expect(check({ quote: quote("buy", "10"), cash: "10029" }).ok).toBe(true);
    });

    it("rejects selling more shares than held", () => {
      const result = check({ quote: quote("sell", "6"), applesHeld: "5" });
      expect(codes(result)).toEqual(["INSUFFICIENT_HOLDINGS"]);
    });

    it("rejects selling a stock that is not held at all", () => {
      expect(codes(check({ quote: quote("sell", "1") }))).toEqual(["INSUFFICIENT_HOLDINGS"]);
    });

    it("rejects a sell whose minimum fee would make cash negative", () => {
      const cheap = buildQuote({
        id: "q",
        leagueId: "league",
        memberId: "member",
        order: { type: "market", side: "sell", instrumentId: AAPL.id, quantity: decimal("1") },
        instrument: AAPL,
        marketPrice: Money.of("1", "USD"),
        marketFxRate: fxRate("USD", "NOK", "10"),
        feeRule: defaultFeeRule("NOK"),
        now: quoteTime,
      });
      // Proceeds 10 NOK − fee 29 NOK = −19 NOK, but only 5 NOK in cash.
      expect(codes(check({ quote: cheap, applesHeld: "1", cash: "5" }))).toEqual([
        "INSUFFICIENT_CASH",
      ]);
    });
  });

  describe("league rules", () => {
    it("rejects an exchange the league does not allow", () => {
      expect(codes(check({ quote: quote("buy", "1"), allowedExchangeIds: ["XOSL"] }))).toEqual([
        "EXCHANGE_NOT_ALLOWED",
      ]);
    });

    it("rejects a buy that takes one stock above the max share", () => {
      // 26 × 1000 NOK = 26 000 of a 100 000 portfolio = 26 % > 25 %
      const result = check({ quote: quote("buy", "26"), maxPositionShare: decimal("0.25") });
      expect(codes(result)).toEqual(["MAX_POSITION_SHARE_EXCEEDED"]);
    });

    it("accepts a buy exactly at the max share", () => {
      expect(check({ quote: quote("buy", "25"), maxPositionShare: decimal("0.25") }).ok).toBe(true);
    });

    it("counts shares already held towards the max share", () => {
      // Holds 20 (20 000 NOK of 100 000) + buys 6 → 26 %.
      const result = check({
        quote: quote("buy", "6"),
        applesHeld: "20",
        cash: "80000",
        maxPositionShare: decimal("0.25"),
      });
      expect(codes(result)).toEqual(["MAX_POSITION_SHARE_EXCEEDED"]);
    });

    it("never blocks a sell because of the max share", () => {
      // Holds 40 % of the portfolio already; selling some is still allowed.
      const result = check({
        quote: quote("sell", "1"),
        applesHeld: "40",
        cash: "60000",
        maxPositionShare: decimal("0.25"),
      });
      expect(result.ok).toBe(true);
    });
  });

  it("reports every rule that fails", () => {
    const saturday = instant("2026-10-31T15:00:00Z");
    const result = check({
      quote: quote("buy", "1000", saturday),
      now: saturday.plus({ seconds: 40 }),
      allowedExchangeIds: ["XOSL"],
    });
    expect(codes(result).sort()).toEqual(
      ["EXCHANGE_NOT_ALLOWED", "INSUFFICIENT_CASH", "MARKET_CLOSED", "QUOTE_EXPIRED"].sort(),
    );
  });
});
