import type { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { instant } from "../time";

import { getMarketStatus, getSession, isMarketOpen } from "./calendar";
import { NASDAQ_STOCKHOLM, NASDAQ_US, NYSE, OSLO_BORS } from "./exchanges";

const osloTime = (at: DateTime) => at.setZone("Europe/Oslo").toFormat("yyyy-MM-dd HH:mm");

describe("regular sessions", () => {
  it("Oslo Børs trades 09:00–16:20 local time", () => {
    const session = getSession(OSLO_BORS, "2026-10-21");
    expect(session?.opensAt.toFormat("HH:mm")).toBe("09:00");
    expect(session?.closesAt.toFormat("HH:mm")).toBe("16:20");
    expect(session?.isEarlyClose).toBe(false);
  });

  it("opening is inclusive and closing is exclusive", () => {
    // Wednesday 21 Oct 2026, Oslo is UTC+2 (summer time).
    expect(isMarketOpen(OSLO_BORS, instant("2026-10-21T06:59:59Z"))).toBe(false);
    expect(isMarketOpen(OSLO_BORS, instant("2026-10-21T07:00:00Z"))).toBe(true);
    expect(isMarketOpen(OSLO_BORS, instant("2026-10-21T14:19:59Z"))).toBe(true);
    expect(isMarketOpen(OSLO_BORS, instant("2026-10-21T14:20:00Z"))).toBe(false);
  });
});

describe("daylight saving: Europe and the US switch on different dates", () => {
  // Europe leaves summer time on Sunday 25 Oct 2026, the US on Sunday 1 Nov 2026.

  it("before either switch, Nasdaq opens 15:30 Oslo time", () => {
    const session = getSession(NASDAQ_US, "2026-10-23");
    expect(osloTime(session!.opensAt)).toBe("2026-10-23 15:30");
  });

  it("in the week Europe is on winter time and the US is not, Nasdaq opens 14:30 Oslo time", () => {
    for (const date of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]) {
      const session = getSession(NASDAQ_US, date);
      expect(session?.opensAt.toFormat("HH:mm")).toBe("09:30");
      expect(osloTime(session!.opensAt)).toBe(`${date} 14:30`);
      expect(osloTime(session!.closesAt)).toBe(`${date} 21:00`);
    }
  });

  it("is open at 14:30 Oslo time that week, and closed one second before", () => {
    // Monday 26 Oct 2026: Oslo UTC+1, New York UTC−4 → 09:30 ET = 13:30Z = 14:30 Oslo.
    expect(isMarketOpen(NASDAQ_US, instant("2026-10-26T13:29:59Z"))).toBe(false);
    expect(isMarketOpen(NASDAQ_US, instant("2026-10-26T13:30:00Z"))).toBe(true);
    expect(isMarketOpen(NYSE, instant("2026-10-26T13:30:00Z"))).toBe(true);
  });

  it("Oslo Børs itself moves with European time that week", () => {
    const session = getSession(OSLO_BORS, "2026-10-26");
    expect(session?.opensAt.toUTC().toFormat("HH:mm")).toBe("08:00");
  });

  it("after both switches, Nasdaq opens 15:30 Oslo time again", () => {
    const session = getSession(NASDAQ_US, "2026-11-02");
    expect(osloTime(session!.opensAt)).toBe("2026-11-02 15:30");
  });

  it("in spring the US switches first, so Nasdaq also opens 14:30 Oslo time", () => {
    // US summer time from 8 Mar 2026, Europe from 29 Mar 2026.
    const session = getSession(NASDAQ_US, "2026-03-09");
    expect(osloTime(session!.opensAt)).toBe("2026-03-09 14:30");
  });
});

describe("weekends", () => {
  it("has no session on Saturday or Sunday", () => {
    expect(getSession(OSLO_BORS, "2026-10-24")).toBeNull();
    expect(getSession(NASDAQ_US, "2026-10-25")).toBeNull();
  });

  it("reports Friday's close and Monday's open across the weekend (and the DST switch)", () => {
    const status = getMarketStatus(OSLO_BORS, instant("2026-10-24T12:00:00Z"));
    expect(status.isOpen).toBe(false);
    expect(status.currentSession).toBeNull();
    // Friday 23 Oct 16:20 CEST = 14:20Z; Monday 26 Oct 09:00 CET = 08:00Z.
    expect(status.lastCloseAt?.toUTC().toISO()).toBe("2026-10-23T14:20:00.000Z");
    expect(status.nextOpenAt?.toUTC().toISO()).toBe("2026-10-26T08:00:00.000Z");
  });
});

describe("holidays", () => {
  it("is closed all day on a holiday", () => {
    expect(getSession(NASDAQ_US, "2026-11-26")).toBeNull(); // Thanksgiving
    expect(getSession(OSLO_BORS, "2026-12-24")).toBeNull(); // Julaften
    expect(isMarketOpen(NASDAQ_US, instant("2026-11-26T16:00:00Z"))).toBe(false);
  });

  it("skips a run of holidays when finding the next open (Easter in Oslo)", () => {
    // Skjærtorsdag 2 Apr, langfredag 3 Apr, weekend, andre påskedag 6 Apr 2026.
    const status = getMarketStatus(OSLO_BORS, instant("2026-04-02T10:00:00Z"));
    expect(status.isOpen).toBe(false);
    expect(status.nextOpenAt?.setZone("Europe/Oslo").toFormat("yyyy-MM-dd HH:mm")).toBe(
      "2026-04-07 09:00",
    );
    // Wednesday 1 Apr was a half day.
    expect(status.lastCloseAt?.setZone("Europe/Oslo").toFormat("yyyy-MM-dd HH:mm")).toBe(
      "2026-04-01 13:00",
    );
  });

  it("does not affect other exchanges", () => {
    // Juneteenth closes the US but not Oslo.
    expect(getSession(NASDAQ_US, "2026-06-19")).toBeNull();
    expect(getSession(OSLO_BORS, "2026-06-19")).not.toBeNull();
  });
});

describe("half days", () => {
  it("closes early on the day after Thanksgiving", () => {
    const session = getSession(NASDAQ_US, "2026-11-27");
    expect(session?.isEarlyClose).toBe(true);
    expect(session?.opensAt.toFormat("HH:mm")).toBe("09:30");
    expect(session?.closesAt.toFormat("HH:mm")).toBe("13:00");
  });

  it("is open just before the early close and closed at it", () => {
    // New York is UTC−5 after 1 Nov: 13:00 ET = 18:00Z.
    expect(isMarketOpen(NASDAQ_US, instant("2026-11-27T17:59:59Z"))).toBe(true);
    expect(isMarketOpen(NASDAQ_US, instant("2026-11-27T18:00:00Z"))).toBe(false);
  });

  it("reports the early close as the last close afterwards", () => {
    const status = getMarketStatus(NASDAQ_STOCKHOLM, instant("2026-01-05T15:00:00Z"));
    expect(status.isOpen).toBe(false);
    expect(status.lastCloseAt?.setZone("Europe/Stockholm").toFormat("yyyy-MM-dd HH:mm")).toBe(
      "2026-01-05 13:00",
    );
    // Trettondedag jul (6 Jan) is closed.
    expect(status.nextOpenAt?.setZone("Europe/Stockholm").toFormat("yyyy-MM-dd HH:mm")).toBe(
      "2026-01-07 09:00",
    );
  });
});

describe("market status while open", () => {
  it("includes the current session and the previous close", () => {
    const status = getMarketStatus(OSLO_BORS, instant("2026-10-22T10:00:00Z"));
    expect(status.isOpen).toBe(true);
    expect(status.currentSession?.date).toBe("2026-10-22");
    expect(status.lastCloseAt?.setZone("Europe/Oslo").toFormat("yyyy-MM-dd HH:mm")).toBe(
      "2026-10-21 16:20",
    );
    expect(status.nextOpenAt?.setZone("Europe/Oslo").toFormat("yyyy-MM-dd HH:mm")).toBe(
      "2026-10-23 09:00",
    );
  });
});
