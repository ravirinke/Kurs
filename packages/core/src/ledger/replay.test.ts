import { describe, expect, it } from "vitest";

import { AAPL, deposit, EQNR, nok, trade } from "../testing/fixtures";
import { instant } from "../time";

import {
  averageCost,
  LedgerInvariantError,
  quantityHeldBefore,
  replay,
  replayUntil,
} from "./replay";

const t1 = instant("2026-10-26T09:00:00Z");
const t2 = instant("2026-10-27T09:00:00Z");
const t3 = instant("2026-10-28T09:00:00Z");

const start = deposit(nok("100000"), instant("2026-10-26T08:00:00Z"));
const buyEqnr = trade({
  id: "b1",
  side: "buy",
  at: t1,
  instrument: EQNR,
  quantity: "10",
  price: "100",
  fee: "29",
});

describe("replay", () => {
  it("starts from the deposit", () => {
    const state = replay("NOK", [start]);
    expect(state.cash.toString()).toBe("100000 NOK");
    expect(state.positions.size).toBe(0);
    expect(state.lastTradeAt).toBeNull();
  });

  it("includes the fee in the average cost", () => {
    const state = replay("NOK", [start, buyEqnr]);
    const position = state.positions.get(EQNR.id)!;
    expect(state.cash.toString()).toBe("98971 NOK");
    expect(position.quantity.toString()).toBe("10");
    expect(position.costBasis.toString()).toBe("1029 NOK");
    expect(averageCost(position).toString()).toBe("102.9 NOK");
  });

  it("averages several buys", () => {
    const second = trade({
      id: "b2",
      side: "buy",
      at: t2,
      instrument: EQNR,
      quantity: "10",
      price: "120",
      fee: "29",
    });
    const position = replay("NOK", [start, buyEqnr, second]).positions.get(EQNR.id)!;
    expect(averageCost(position).toString()).toBe("112.9 NOK");
  });

  it("keeps the average cost when selling part of a position", () => {
    const sell = trade({
      id: "s1",
      side: "sell",
      at: t2,
      instrument: EQNR,
      quantity: "4",
      price: "150",
      fee: "29",
    });
    const state = replay("NOK", [start, buyEqnr, sell]);
    const position = state.positions.get(EQNR.id)!;
    expect(position.quantity.toString()).toBe("6");
    expect(averageCost(position).toString()).toBe("102.9 NOK");
    expect(state.cash.toString()).toBe("99542 NOK"); // 98 971 + 600 − 29
    expect(state.lastTradeAt?.toMillis()).toBe(t2.toMillis());
  });

  it("removes a position that is sold out", () => {
    const sell = trade({
      id: "s1",
      side: "sell",
      at: t2,
      instrument: EQNR,
      quantity: "10",
      price: "100",
      fee: "29",
    });
    expect(replay("NOK", [start, buyEqnr, sell]).positions.has(EQNR.id)).toBe(false);
  });

  it("books foreign trades in the league currency", () => {
    const buyApple = trade({
      id: "b2",
      side: "buy",
      at: t2,
      instrument: AAPL,
      quantity: "10",
      price: "182.40",
      fx: "10.842105",
      fee: "29",
    });
    const state = replay("NOK", [start, buyApple]);
    expect(state.cash.toString()).toBe("80195 NOK"); // 100 000 − 19 776 − 29
    expect(state.positions.get(AAPL.id)?.costBasis.toString()).toBe("19805 NOK");
  });

  it("gives the same result every time it is rebuilt", () => {
    const events = [start, buyEqnr];
    expect(replay("NOK", events)).toEqual(replay("NOK", events));
  });

  describe("invariants", () => {
    it("refuses to sell more than is held", () => {
      const sell = trade({
        id: "s1",
        side: "sell",
        at: t2,
        instrument: EQNR,
        quantity: "11",
        price: "100",
        fee: "29",
      });
      expect(() => replay("NOK", [start, buyEqnr, sell])).toThrow(LedgerInvariantError);
    });

    it("refuses negative cash", () => {
      const huge = trade({
        id: "b9",
        side: "buy",
        at: t1,
        instrument: EQNR,
        quantity: "1001",
        price: "100",
        fee: "29",
      });
      expect(() => replay("NOK", [start, huge])).toThrow(LedgerInvariantError);
    });

    it("refuses events out of order", () => {
      const early = trade({
        id: "b0",
        side: "buy",
        at: instant("2026-10-26T07:00:00Z"),
        instrument: EQNR,
        quantity: "1",
        price: "1",
        fee: "0",
      });
      expect(() => replay("NOK", [start, early])).toThrow(LedgerInvariantError);
    });
  });
});

describe("history", () => {
  const sell = trade({
    id: "s1",
    side: "sell",
    at: t3,
    instrument: EQNR,
    quantity: "10",
    price: "100",
    fee: "29",
  });
  const events = [start, buyEqnr, sell];

  it("rebuilds the state at an earlier time", () => {
    expect(replayUntil("NOK", events, t2).positions.get(EQNR.id)?.quantity.toString()).toBe("10");
    expect(replayUntil("NOK", events, t3).positions.has(EQNR.id)).toBe(false);
  });

  it("counts shares held strictly before an instant", () => {
    expect(quantityHeldBefore("NOK", events, EQNR.id, t1).toString()).toBe("0");
    expect(
      quantityHeldBefore("NOK", events, EQNR.id, t1.plus({ milliseconds: 1 })).toString(),
    ).toBe("10");
  });
});
