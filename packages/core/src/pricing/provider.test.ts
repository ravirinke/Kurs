import { describe, expect, it } from "vitest";

import { Money } from "../money";
import { instant } from "../time";

import { isPriceStale, MAX_LIVE_PRICE_AGE_MINUTES, type PriceQuote } from "./provider";

const NOW = instant("2026-10-27T15:00:00Z");

function quote(overrides: Partial<PriceQuote>): PriceQuote {
  return {
    instrumentId: "instrument",
    price: Money.of("100", "NOK"),
    at: NOW,
    source: "live",
    checkedAt: NOW,
    delayed: false,
    ...overrides,
  };
}

describe("isPriceStale", () => {
  it("accepts a live price confirmed within the limit", () => {
    const checkedAt = NOW.minus({ minutes: MAX_LIVE_PRICE_AGE_MINUTES });
    expect(isPriceStale(quote({ checkedAt }), NOW)).toBe(false);
  });

  it("rejects a live price the source has not confirmed for longer than the limit", () => {
    const checkedAt = NOW.minus({ minutes: MAX_LIVE_PRICE_AGE_MINUTES, seconds: 1 });
    expect(isPriceStale(quote({ checkedAt }), NOW)).toBe(true);
  });

  it("goes by when the source confirmed the price, not by when the share last traded", () => {
    // A quiet stock: no trade for an hour, but the source was asked a moment ago.
    expect(isPriceStale(quote({ at: NOW.minus({ hours: 1 }) }), NOW)).toBe(false);
    // A delayed source (15 minutes behind) is still fresh knowledge.
    expect(isPriceStale(quote({ at: NOW.minus({ minutes: 15 }), delayed: true }), NOW)).toBe(false);
  });

  it("never calls a last close stale", () => {
    const checkedAt = NOW.minus({ days: 3 });
    expect(isPriceStale(quote({ source: "last_close", checkedAt }), NOW)).toBe(false);
  });
});
