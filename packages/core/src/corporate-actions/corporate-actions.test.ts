import { describe, expect, it } from "vitest";

import { fxRate, identityRate } from "../fx";
import { quantityHeldBefore, replay } from "../ledger";
import { OSLO_BORS } from "../market";
import { decimal, Money } from "../money";
import { MockPriceProvider } from "../pricing";
import { AAPL, deposit, EQNR, MOCK_INSTRUMENTS, nok, trade, usd } from "../testing/fixtures";
import { fixedClock, instant } from "../time";
import { resolveMarks, valuePortfolio } from "../valuation";
import { EXCHANGES } from "../market";

import {
  computeDividendEvent,
  computeSplitEvent,
  type DividendAction,
  type SplitAction,
  startOfExchangeDay,
} from "./index";

const opening = deposit(usd("100000"), instant("2026-10-01T12:00:00Z"));

function split(from: string, to: string): SplitAction {
  return {
    kind: "split",
    id: "split-aapl",
    instrumentId: AAPL.id,
    effectiveDate: "2026-11-02",
    ratioFrom: decimal(from),
    ratioTo: decimal(to),
  };
}

describe("split", () => {
  it("10:1 multiplies the shares and divides the price, leaving the value unchanged", () => {
    const buy = trade({
      id: "b1",
      side: "buy",
      at: instant("2026-10-26T15:00:00Z"),
      instrument: AAPL,
      quantity: "15",
      price: "1000",
      fee: "3",
      leagueCurrency: "USD",
    });
    const before = replay("USD", [opening, buy]);

    const event = computeSplitEvent({
      action: split("1", "10"),
      eventId: "e1",
      at: instant("2026-11-02T05:00:00Z"),
      quantityBefore: decimal("15"),
      lastClose: usd("1000"),
      fxRate: identityRate("USD"),
    });
    const after = replay("USD", [opening, buy, event]);

    expect(event.quantityAfter.toString()).toBe("150");
    expect(event.cashInLieu.isZero()).toBe(true);

    const valueBefore = valuePortfolio(before, new Map([[AAPL.id, mark("1000")]])).totalValue;
    const valueAfter = valuePortfolio(after, new Map([[AAPL.id, mark("100")]])).totalValue;
    expect(valueAfter.equals(valueBefore)).toBe(true);

    // The average cost follows the split: 15 003 / 150.
    const position = after.positions.get(AAPL.id)!;
    expect(position.costBasis.toString()).toBe("15003 USD");
    expect(position.costBasis.dividedBy(position.quantity).toString()).toBe("100.02 USD");
  });

  it("1:10 reverse split pays the fractional share as cash and keeps the value", () => {
    const buy = trade({
      id: "b1",
      side: "buy",
      at: instant("2026-10-26T15:00:00Z"),
      instrument: AAPL,
      quantity: "15",
      price: "10",
      fee: "3",
      leagueCurrency: "USD",
    });
    const event = computeSplitEvent({
      action: split("10", "1"),
      eventId: "e1",
      at: instant("2026-11-02T05:00:00Z"),
      quantityBefore: decimal("15"),
      lastClose: usd("10"),
      fxRate: identityRate("USD"),
    });

    // 15 / 10 = 1.5 → 1 share kept, 0.5 × 100 USD = 50 USD paid out.
    expect(event.quantityAfter.toString()).toBe("1");
    expect(event.cashInLieu.toString()).toBe("50 USD");

    const before = replay("USD", [opening, buy]);
    const after = replay("USD", [opening, buy, event]);
    const valueBefore = valuePortfolio(before, new Map([[AAPL.id, mark("10")]])).totalValue;
    const valueAfter = valuePortfolio(after, new Map([[AAPL.id, mark("100")]])).totalValue;
    expect(valueAfter.equals(valueBefore)).toBe(true);

    // Two thirds of the cost stays with the remaining share (1 of 1.5).
    expect(after.positions.get(AAPL.id)?.costBasis.toString()).toBe("102 USD");
  });

  it("converts cash in lieu to the league currency", () => {
    const event = computeSplitEvent({
      action: split("10", "1"),
      eventId: "e1",
      at: instant("2026-11-02T05:00:00Z"),
      quantityBefore: decimal("15"),
      lastClose: usd("10"),
      fxRate: fxRate("USD", "NOK", "10.5"),
    });
    expect(event.cashInLieu.toString()).toBe("525 NOK");
  });

  it("keeps the portfolio value unchanged across a split with the mock provider", async () => {
    const action = split("1", "10");
    const provider = new MockPriceProvider({
      clock: fixedClock(instant("2026-11-02T12:00:00Z")),
      exchanges: EXCHANGES,
      instruments: MOCK_INSTRUMENTS,
      corporateActions: [action],
    });

    // Saturday: Friday's close, still at the pre-split price.
    const saturday = instant("2026-10-31T12:00:00Z");
    const lastClose = await provider.getLastClose(AAPL.id, saturday);
    const buy = trade({
      id: "b1",
      side: "buy",
      at: instant("2026-10-30T15:00:00Z"),
      instrument: AAPL,
      quantity: "15",
      price: lastClose.price.amount.toString(),
      fee: "3",
      leagueCurrency: "USD",
    });
    const event = computeSplitEvent({
      action,
      eventId: "e1",
      at: instant("2026-11-02T05:00:00Z"),
      quantityBefore: decimal("15"),
      lastClose: lastClose.price,
      fxRate: identityRate("USD"),
    });

    // Monday 01:00 New York time: the split is in effect, the market has not opened yet.
    const monday = instant("2026-11-02T06:00:00Z");
    const preSplitValue = valuePortfolio(
      replay("USD", [opening, buy]),
      await resolveMarks(provider, [AAPL], "USD", saturday),
    ).totalValue;
    const postSplitMarks = await resolveMarks(provider, [AAPL], "USD", monday);
    const postSplitValue = valuePortfolio(
      replay("USD", [opening, buy, event]),
      postSplitMarks,
    ).totalValue;

    expect(postSplitMarks.get(AAPL.id)?.price.equals(lastClose.price.dividedBy("10"))).toBe(true);
    expect(postSplitValue.equals(preSplitValue)).toBe(true);
  });
});

describe("dividend", () => {
  // Equinor is listed in NOK but pays its dividend in USD.
  const dividend: DividendAction = {
    kind: "dividend",
    id: "div-eqnr",
    instrumentId: EQNR.id,
    exDate: "2026-11-11",
    payDate: "2026-11-25",
    amountPerShare: Money.of("0.37", "USD"),
  };
  const exDateStart = startOfExchangeDay(OSLO_BORS, dividend.exDate);
  const start = deposit(nok("100000"), instant("2026-10-01T08:00:00Z"));

  it("is paid in the league currency at the pay-date rate, even when paid in another currency", () => {
    const event = computeDividendEvent({
      action: dividend,
      eventId: "d1",
      at: instant("2026-11-25T08:00:00Z"),
      quantityHeld: decimal("100"),
      fxRate: fxRate("USD", "NOK", "10.8"),
    });
    // 100 × 0.37 USD × 10.8 = 399.60 NOK
    expect(event?.amount.toString()).toBe("399.6 NOK");
    const state = replay("NOK", [start, event!]);
    expect(state.cash.toString()).toBe("100399.6 NOK");
  });

  it("goes to whoever held the shares at the start of the ex-date", () => {
    const boughtBefore = trade({
      id: "b1",
      side: "buy",
      at: instant("2026-11-10T10:00:00Z"),
      instrument: EQNR,
      quantity: "100",
      price: "265",
      fee: "29",
    });
    const boughtOnExDate = trade({
      id: "b2",
      side: "buy",
      at: instant("2026-11-11T09:00:00Z"),
      instrument: EQNR,
      quantity: "50",
      price: "260",
      fee: "29",
    });
    const held = quantityHeldBefore(
      "NOK",
      [start, boughtBefore, boughtOnExDate],
      EQNR.id,
      exDateStart,
    );
    expect(held.toString()).toBe("100");
  });

  it("still goes to a member who sold on the ex-date", () => {
    const buy = trade({
      id: "b1",
      side: "buy",
      at: instant("2026-11-10T10:00:00Z"),
      instrument: EQNR,
      quantity: "100",
      price: "265",
      fee: "29",
    });
    const sell = trade({
      id: "s1",
      side: "sell",
      at: instant("2026-11-11T09:00:00Z"),
      instrument: EQNR,
      quantity: "100",
      price: "260",
      fee: "29",
    });
    expect(quantityHeldBefore("NOK", [start, buy, sell], EQNR.id, exDateStart).toString()).toBe(
      "100",
    );
  });

  it("is skipped for members without shares", () => {
    const event = computeDividendEvent({
      action: dividend,
      eventId: "d1",
      at: instant("2026-11-25T08:00:00Z"),
      quantityHeld: decimal("0"),
      fxRate: fxRate("USD", "NOK", "10.8"),
    });
    expect(event).toBeNull();
  });
});

function mark(price: string) {
  return {
    instrumentId: AAPL.id,
    price: usd(price),
    fxRate: identityRate("USD"),
    source: "last_close" as const,
    asOf: instant("2026-11-02T00:00:00Z"),
  };
}
