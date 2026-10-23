import type { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { fxRate, identityRate } from "../fx";
import { replay } from "../ledger";
import { AAPL, deposit, EQNR, mockProvider, nok, trade, usd } from "../testing/fixtures";
import { instant } from "../time";

import { type Mark, MissingMarkError, resolveMarks, valueChange, valuePortfolio } from "./index";

const start = deposit(nok("100000"), instant("2026-10-26T07:00:00Z"));
const buyEqnr = trade({
  id: "b1",
  side: "buy",
  at: instant("2026-10-26T09:00:00Z"),
  instrument: EQNR,
  quantity: "100",
  price: "265",
  fee: "29",
});
const buyApple = trade({
  id: "b2",
  side: "buy",
  at: instant("2026-10-26T14:00:00Z"),
  instrument: AAPL,
  quantity: "10",
  price: "182.40",
  fx: "10.842105",
  fee: "29",
});
const ledger = replay("NOK", [start, buyEqnr, buyApple]);

function marksFor(eqnr: string, apple: string, usdNok: string): Map<string, Mark> {
  const asOf = instant("2026-10-26T15:00:00Z");
  return new Map<string, Mark>([
    [
      EQNR.id,
      {
        instrumentId: EQNR.id,
        price: nok(eqnr),
        fxRate: identityRate("NOK"),
        source: "live",
        asOf,
      },
    ],
    [
      AAPL.id,
      {
        instrumentId: AAPL.id,
        price: usd(apple),
        fxRate: fxRate("USD", "NOK", usdNok),
        source: "live",
        asOf,
      },
    ],
  ]);
}

async function valueAt(at: DateTime) {
  const marks = await resolveMarks(mockProvider(at.toISO()!), [EQNR, AAPL], "NOK", at);
  return valuePortfolio(ledger, marks).totalValue;
}

describe("valuePortfolio", () => {
  it("is cash plus every holding converted to the league currency", () => {
    // Cash 100 000 − 26 529 − 19 805 = 53 666
    // EQNR 100 × 270 = 27 000; AAPL 10 × 190 × 10.9 = 20 710 → 101 376
    const valuation = valuePortfolio(ledger, marksFor("270", "190", "10.9"));
    expect(valuation.cash.toString()).toBe("53666 NOK");
    expect(valuation.totalValue.toString()).toBe("101376 NOK");
    const apple = valuation.holdings.find((holding) => holding.instrumentId === AAPL.id)!;
    expect(apple.unrealizedGain.toString()).toBe("905 NOK");
  });

  it("rounds only the total", () => {
    const valuation = valuePortfolio(ledger, marksFor("270.001", "190.0049", "10.90001"));
    expect(valuation.totalValue.amount.decimalPlaces()).toBeLessThanOrEqual(2);
    const apple = valuation.holdings.find((holding) => holding.instrumentId === AAPL.id)!;
    expect(apple.marketValue.amount.decimalPlaces()).toBeGreaterThan(2);
  });

  it("fails loudly when a price is missing", () => {
    expect(() => valuePortfolio(ledger, new Map())).toThrow(MissingMarkError);
  });

  it("computes the day's change", () => {
    const change = valueChange(nok("102340"), nok("100000"));
    expect(change.amount.toString()).toBe("2340 NOK");
    expect(change.fraction.toString()).toBe("0.0234");
  });
});

describe("resolveMarks", () => {
  it("uses live prices and FX while the exchange is open", async () => {
    // Monday 26 Oct 15:00Z: Oslo (until 15:20Z) and Nasdaq (from 13:30Z) are both open.
    const at = instant("2026-10-26T15:00:00Z");
    const result = await resolveMarks(mockProvider(at.toISO()!), [EQNR, AAPL], "NOK", at);
    expect(result.get(EQNR.id)?.source).toBe("live");
    expect(result.get(AAPL.id)?.source).toBe("live");
    expect(result.get(AAPL.id)?.fxRate.from).toBe("USD");
  });

  it("uses the last close, and FX frozen at that exchange's close, when it is closed", async () => {
    // 10:00Z: Oslo open, Nasdaq closed since 20:00Z the day before.
    const at = instant("2026-10-27T10:00:00Z");
    const provider = mockProvider(at.toISO()!);
    const result = await resolveMarks(provider, [EQNR, AAPL], "NOK", at);
    const apple = result.get(AAPL.id)!;
    expect(result.get(EQNR.id)?.source).toBe("live");
    expect(apple.source).toBe("last_close");
    expect(apple.asOf.toUTC().toISO()).toBe("2026-10-26T20:00:00.000Z");
    const rateAtClose = await provider.getFxRate("USD", "NOK", instant("2026-10-26T20:00:00Z"));
    expect(apple.fxRate.rate.equals(rateAtClose.rate)).toBe(true);
  });

  it("stands still over the weekend", async () => {
    const [saturday, sunday] = await Promise.all([
      valueAt(instant("2026-10-31T10:00:00Z")),
      valueAt(instant("2026-11-01T21:00:00Z")),
    ]);
    expect(saturday.equals(sunday)).toBe(true);
  });

  it("moves while the market is open", async () => {
    const [morning, afternoon] = await Promise.all([
      valueAt(instant("2026-10-27T08:30:00Z")),
      valueAt(instant("2026-10-27T14:30:00Z")),
    ]);
    expect(morning.equals(afternoon)).toBe(false);
  });
});
