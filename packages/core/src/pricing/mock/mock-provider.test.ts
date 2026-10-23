import { describe, expect, it } from "vitest";

import { decimal } from "../../money";
import { AAPL, EQNR, mockProvider, MOCK_INSTRUMENTS } from "../../testing/fixtures";
import { fixedClock, instant } from "../../time";
import { EXCHANGES } from "../../market";

import { MockPriceProvider } from "./mock-provider";

describe("MockPriceProvider", () => {
  it("is deterministic: same instrument and time, same price", async () => {
    const at = "2026-10-27T15:00:00Z";
    const [a, b] = await Promise.all([
      mockProvider(at).getQuote(AAPL.id),
      mockProvider(at).getQuote(AAPL.id),
    ]);
    expect(a.price.equals(b.price)).toBe(true);
  });

  it("moves during the trading day", async () => {
    const provider = mockProvider("2026-10-27T15:00:00Z");
    const prices = await Promise.all(
      ["14:00", "15:00", "16:00", "17:00", "18:00", "19:00"].map((time) =>
        provider.getQuote(AAPL.id, instant(`2026-10-27T${time}:00Z`)),
      ),
    );
    const distinct = new Set(prices.map((quote) => quote.price.amount.toString()));
    expect(distinct.size).toBeGreaterThan(3);
    expect(prices.every((quote) => quote.source === "live")).toBe(true);
  });

  it("returns the last close while the exchange is closed", async () => {
    const provider = mockProvider("2026-10-31T12:00:00Z"); // Saturday
    const quote = await provider.getQuote(EQNR.id);
    const close = await provider.getLastClose(EQNR.id);
    expect(quote.source).toBe("last_close");
    expect(quote.price.equals(close.price)).toBe(true);
    expect(close.closedAt.setZone("Europe/Oslo").toFormat("yyyy-MM-dd HH:mm")).toBe(
      "2026-10-30 16:20",
    );
  });

  it("stays within a realistic range of the base price over a year", async () => {
    const provider = mockProvider("2026-10-27T15:00:00Z");
    for (let day = 0; day < 365; day += 3) {
      const quote = await provider.getQuote(
        EQNR.id,
        instant("2026-01-01T12:00:00Z").plus({ days: day }),
      );
      const ratio = quote.price.amount.dividedBy("265.40");
      expect(ratio.greaterThan("0.7") && ratio.lessThan("1.3")).toBe(true);
    }
  });

  it("prices with at most 2 decimals", async () => {
    const quote = await mockProvider("2026-10-27T15:00:00Z").getQuote(AAPL.id);
    expect(quote.price.amount.decimalPlaces()).toBeLessThanOrEqual(2);
    expect(quote.price.currency).toBe("USD");
  });

  describe("FX", () => {
    it("is 1 for the same currency", async () => {
      expect(
        (await mockProvider("2026-10-27T15:00:00Z").getFxRate("NOK", "NOK")).rate.toString(),
      ).toBe("1");
    });

    it("is consistent in both directions", async () => {
      const provider = mockProvider("2026-10-27T15:00:00Z");
      const there = await provider.getFxRate("USD", "NOK");
      const back = await provider.getFxRate("NOK", "USD");
      expect(there.rate.times(back.rate).toDecimalPlaces(20).toString()).toBe("1");
    });

    it("is close to the configured level", async () => {
      const rate = await mockProvider("2026-10-27T15:00:00Z").getFxRate("USD", "NOK");
      expect(rate.rate.minus("10.84").abs().lessThan("0.25")).toBe(true);
    });

    it("drifts a little over time", async () => {
      const provider = mockProvider("2026-10-27T15:00:00Z");
      const a = await provider.getFxRate("EUR", "SEK", instant("2026-10-27T09:00:00Z"));
      const b = await provider.getFxRate("EUR", "SEK", instant("2026-10-29T09:00:00Z"));
      expect(a.rate.equals(b.rate)).toBe(false);
    });
  });

  describe("corporate actions", () => {
    const split = {
      kind: "split" as const,
      id: "s1",
      instrumentId: AAPL.id,
      effectiveDate: "2026-11-02",
      ratioFrom: decimal("1"),
      ratioTo: decimal("4"),
    };

    it("makes prices before a split higher by the split factor", async () => {
      const at = instant("2026-10-30T15:00:00Z");
      const plain = await mockProvider("2026-10-30T15:00:00Z").getQuote(AAPL.id, at);
      const withSplit = new MockPriceProvider({
        clock: fixedClock(at),
        exchanges: EXCHANGES,
        instruments: MOCK_INSTRUMENTS,
        corporateActions: [split],
      });
      const adjusted = await withSplit.getQuote(AAPL.id, at);
      expect(adjusted.price.equals(plain.price.times("4"))).toBe(true);
    });

    it("can simulate actions added at runtime and lists them by date", async () => {
      const provider = mockProvider("2026-10-27T15:00:00Z");
      provider.addCorporateAction(split);
      const found = await provider.getCorporateActions(
        AAPL.id,
        instant("2026-11-01T00:00:00Z"),
        instant("2026-11-03T00:00:00Z"),
      );
      const none = await provider.getCorporateActions(
        AAPL.id,
        instant("2026-11-03T00:00:00Z"),
        instant("2026-11-10T00:00:00Z"),
      );
      expect(found.map((action) => action.id)).toEqual(["s1"]);
      expect(none).toEqual([]);
    });
  });

  it("reports market status through the shared calendar", async () => {
    const status = await mockProvider("2026-10-26T13:30:00Z").getMarketStatus("XNAS");
    expect(status.isOpen).toBe(true);
  });

  it("rejects unknown instruments and exchanges", async () => {
    const provider = mockProvider("2026-10-27T15:00:00Z");
    await expect(provider.getQuote("unknown")).rejects.toThrow("Unknown instrument");
    await expect(provider.getMarketStatus("XLON")).rejects.toThrow();
  });
});
