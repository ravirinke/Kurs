import { decimal, instant, Money } from "@aksjeliga/core";
import { describe, expect, it } from "vitest";

import {
  arrow,
  direction,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatFxRate,
  formatMoney,
  formatMovement,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "./format";

/** Shows non-breaking spaces as normal spaces, so expectations are readable. */
const plain = (text: string | null) => text?.replace(/\u00A0/g, " ");

describe("money", () => {
  it("formats NOK the Norwegian way", () => {
    expect(plain(formatMoney(Money.of("19805", "NOK")))).toBe("19 805,00 kr");
    expect(plain(formatMoney(Money.of("1234567.891", "NOK")))).toBe("1 234 567,89 kr");
  });

  it("uses the currency code for other currencies", () => {
    expect(plain(formatMoney(Money.of("182.4", "USD")))).toBe("182,40 USD");
    expect(plain(formatMoney(Money.of("268", "SEK")))).toBe("268,00 SEK");
  });

  it("rounds half-up", () => {
    expect(plain(formatMoney(Money.of("1.005", "NOK")))).toBe("1,01 kr");
    expect(plain(formatMoney(Money.of("2.344999", "NOK")))).toBe("2,34 kr");
  });

  it("uses a real minus sign and shows signs on request", () => {
    expect(plain(formatMoney(Money.of("-1234.5", "NOK")))).toBe("−1 234,50 kr");
    expect(plain(formatMoney(Money.of("1200", "NOK"), { signed: true }))).toBe("+1 200,00 kr");
    expect(plain(formatMoney(Money.of("0", "NOK"), { signed: true }))).toBe("0,00 kr");
    expect(plain(formatMoney(Money.of("-0.001", "NOK")))).toBe("0,00 kr");
  });

  it("keeps the value together on one line", () => {
    expect(formatMoney(Money.of("19805", "NOK"))).toBe("19\u00A0805,00\u00A0kr");
  });

  it("shows up to 4 decimals for prices that have them", () => {
    expect(plain(formatPrice(Money.of("182.4", "USD")))).toBe("182,40 USD");
    expect(plain(formatPrice(Money.of("0.1234", "USD")))).toBe("0,1234 USD");
  });
});

describe("percent and direction", () => {
  it.each([
    ["0.0234", "+2,34 %"],
    ["-0.0195", "−1,95 %"],
    ["0", "0,00 %"],
    ["0.00004", "0,00 %"],
    ["1.5", "+150,00 %"],
  ])("formats %s as %s", (fraction, expected) => {
    expect(plain(formatPercent(decimal(fraction)))).toBe(expected);
  });

  it("never shows a direction for something that rounds to zero", () => {
    expect(direction(decimal("0.00004"))).toBe("flat");
    expect(direction(decimal("0.0234"))).toBe("up");
    expect(direction(decimal("-0.01"))).toBe("down");
    expect(arrow("up")).toBe("▲");
    expect(arrow("down")).toBe("▼");
    expect(arrow("flat")).toBe("");
  });

  it("formats leaderboard movement", () => {
    expect(plain(formatMovement(2))).toBe("▲ 2");
    expect(plain(formatMovement(-1))).toBe("▼ 1");
    expect(formatMovement(0)).toBe("–");
    expect(formatMovement(null)).toBe("–");
  });
});

describe("FX rates and quantities", () => {
  it("shows 2 decimals for rates ≥ 1 and 4 below", () => {
    expect(formatFxRate(decimal("10.842105"))).toBe("10,84");
    expect(formatFxRate(decimal("0.092234"))).toBe("0,0922");
  });

  it("shows the full locked rate in a trade breakdown", () => {
    expect(formatFxRate(decimal("10.842105"), { full: true })).toBe("10,842105");
    expect(formatFxRate(decimal("1"), { full: true })).toBe("1,00");
  });

  it("formats whole shares", () => {
    expect(plain(formatQuantity(decimal("1250")))).toBe("1 250");
  });
});

describe("dates and countdowns", () => {
  it("shows dates in Norwegian time", () => {
    // 13:30 UTC on 26 Oct 2026 is 14:30 in Oslo (winter time).
    expect(formatDateTime(instant("2026-10-26T13:30:00Z"))).toBe("26. okt. 14:30");
    expect(formatDate(instant("2026-12-31T22:00:00Z"))).toBe("31. des. 2026");
  });

  it("counts down in days, hours and minutes", () => {
    const now = instant("2026-10-26T10:00:00Z");
    expect(plain(formatCountdown(now, now.plus({ days: 29, hours: 4, minutes: 10 })))).toBe(
      "29 d 4 t",
    );
    expect(plain(formatCountdown(now, now.plus({ hours: 3, minutes: 12 })))).toBe("3 t 12 min");
    expect(plain(formatCountdown(now, now.plus({ minutes: 12, seconds: 30 })))).toBe("12 min");
    expect(formatCountdown(now, now.plus({ seconds: 30 }))).toBe("under 1 min");
    expect(formatCountdown(now, now.minus({ seconds: 1 }))).toBeNull();
  });
});

describe("month abbreviations", () => {
  it("only adds a dot when the month is actually shortened", () => {
    expect(formatDate(instant("2026-05-17T10:00:00Z"))).toBe("17. mai 2026");
    expect(formatDate(instant("2026-06-05T10:00:00Z"))).toBe("5. jun. 2026");
  });
});
