import { describe, expect, it } from "vitest";

import { EXCHANGES, OSLO_BORS } from "../market";
import { decimal, Money } from "../money";
import { instant } from "../time";

import { checkJoin, checkJoinDecision, startingDeposit } from "./membership";
import {
  defaultLeagueSettings,
  suggestEndTime,
  validateEndTime,
  validateLeagueSettings,
  validateLeagueUpdate,
} from "./settings";
import { deriveLeagueStatus, needsFinalization } from "./status";
import type { League, LeagueSettings } from "./types";

const now = instant("2026-10-23T10:00:00Z");

function settings(overrides: Partial<LeagueSettings> = {}): LeagueSettings {
  return {
    ...defaultLeagueSettings("NOK", EXCHANGES),
    name: "Fredagsligaen",
    description: "",
    startsAt: now,
    // Friday 27 Nov 2026 22:00 Oslo: after every exchange has closed (US half day closes 19:00).
    endsAt: instant("2026-11-27T21:00:00Z"),
    ...overrides,
  };
}

function league(overrides: Partial<League> = {}): League {
  return {
    ...settings(),
    id: "l1",
    ownerId: "ola",
    inviteCode: "ABC123",
    finalizedAt: null,
    ...overrides,
  };
}

describe("league status", () => {
  const times = {
    startsAt: instant("2026-11-01T00:00:00Z"),
    endsAt: instant("2026-12-01T00:00:00Z"),
  };

  it("is upcoming, active and finished from the times", () => {
    expect(deriveLeagueStatus(times, instant("2026-10-31T23:59:59Z"))).toBe("upcoming");
    expect(deriveLeagueStatus(times, instant("2026-11-01T00:00:00Z"))).toBe("active");
    expect(deriveLeagueStatus(times, instant("2026-11-30T23:59:59Z"))).toBe("active");
    expect(deriveLeagueStatus(times, instant("2026-12-01T00:00:00Z"))).toBe("finished");
  });

  it("needs finalization once ended, until results are stored", () => {
    const after = instant("2026-12-01T00:00:01Z");
    expect(needsFinalization({ ...times, finalizedAt: null }, after)).toBe(true);
    expect(needsFinalization({ ...times, finalizedAt: after }, after)).toBe(false);
    expect(
      needsFinalization({ ...times, finalizedAt: null }, instant("2026-11-15T00:00:00Z")),
    ).toBe(false);
  });
});

describe("defaults", () => {
  it("are valid as they are", () => {
    expect(validateLeagueSettings(settings(), EXCHANGES, now)).toEqual([]);
  });

  it("match the brief", () => {
    const defaults = defaultLeagueSettings("SEK", EXCHANGES);
    expect(defaults.visibility).toBe("delayed");
    expect(defaults.maxPositionShare).toBeNull();
    expect(defaults.allowedExchangeIds).toEqual(["XOSL", "XSTO", "XCSE", "XNAS", "XNYS"]);
    expect(defaults.feeRule.minimum.toString()).toBe("29 SEK");
  });
});

describe("validateLeagueSettings", () => {
  const codes = (overrides: Partial<LeagueSettings>) =>
    validateLeagueSettings(settings(overrides), EXCHANGES, now).map((error) => error.code);

  it("rejects an end time before an allowed exchange has closed that day", () => {
    // Thursday 26 Nov is Thanksgiving (US closed); Wednesday 25 Nov 20:00 Oslo = 14:00 New York.
    expect(codes({ endsAt: instant("2026-11-25T19:00:00Z") })).toEqual([
      "END_BEFORE_MARKET_CLOSE",
      "END_BEFORE_MARKET_CLOSE",
    ]);
  });

  it("accepts the same end time when only Nordic exchanges are allowed", () => {
    expect(
      codes({
        endsAt: instant("2026-11-25T19:00:00Z"),
        allowedExchangeIds: ["XOSL", "XSTO", "XCSE"],
      }),
    ).toEqual([]);
  });

  it("accepts an end time on a day the exchanges are closed", () => {
    expect(codes({ endsAt: instant("2026-11-28T09:00:00Z") })).toEqual([]); // Saturday
  });

  it.each([
    [{ name: "  " }, "NAME_REQUIRED"],
    [{ name: "x".repeat(61) }, "NAME_TOO_LONG"],
    [{ startAmount: Money.of("0", "NOK") }, "START_AMOUNT_INVALID"],
    [{ startAmount: Money.of("100.001", "NOK") }, "START_AMOUNT_INVALID"],
    [{ startAmount: Money.of("100000", "USD") }, "START_AMOUNT_INVALID"],
    [{ feeRule: { rate: decimal("0.06"), minimum: Money.of("29", "NOK") } }, "FEE_INVALID"],
    [{ allowedExchangeIds: [] }, "NO_EXCHANGES"],
    [{ allowedExchangeIds: ["XOSL", "XLON"] }, "UNKNOWN_EXCHANGE"],
    [{ startsAt: instant("2026-10-23T09:00:00Z") }, "START_IN_PAST"],
    [{ endsAt: instant("2026-10-23T09:59:00Z") }, "END_BEFORE_START"],
    [{ maxPositionShare: decimal("0") }, "MAX_POSITION_SHARE_INVALID"],
    [{ maxPositionShare: decimal("1.1") }, "MAX_POSITION_SHARE_INVALID"],
  ] as const)("rejects %o with %s", (overrides, code) => {
    expect(codes(overrides as Partial<LeagueSettings>)).toContain(code);
  });
});

describe("suggestEndTime", () => {
  it("suggests the latest close of the allowed exchanges", () => {
    const suggestion = suggestEndTime("2026-11-20", "Europe/Oslo", EXCHANGES);
    expect(suggestion.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-11-20 22:00");
    expect(validateEndTime(suggestion, EXCHANGES)).toEqual([]);
  });

  it("accounts for the DST gap between Europe and the US", () => {
    expect(suggestEndTime("2026-10-30", "Europe/Oslo", EXCHANGES).toFormat("HH:mm")).toBe("21:00");
  });

  it("accounts for half days", () => {
    expect(suggestEndTime("2026-11-27", "Europe/Oslo", EXCHANGES).toFormat("HH:mm")).toBe("19:00");
  });

  it("only considers the allowed exchanges", () => {
    expect(suggestEndTime("2026-11-20", "Europe/Oslo", [OSLO_BORS]).toFormat("HH:mm")).toBe(
      "16:20",
    );
  });

  it("falls back to 18:00 when no exchange trades that day", () => {
    expect(suggestEndTime("2026-11-21", "Europe/Oslo", EXCHANGES).toFormat("HH:mm")).toBe("18:00");
  });
});

describe("validateLeagueUpdate", () => {
  const afterStart = instant("2026-11-02T10:00:00Z");
  const codes = (patch: Partial<LeagueSettings>, at = afterStart) =>
    validateLeagueUpdate(league(), patch, EXCHANGES, at).map((error) => error.code);

  it("allows changing anything before the start", () => {
    const upcoming = league({ startsAt: instant("2026-11-01T00:00:00Z") });
    const errors = validateLeagueUpdate(
      upcoming,
      {
        currency: "SEK",
        startAmount: Money.of("50000", "SEK"),
        feeRule: { rate: decimal("0.001"), minimum: Money.of("10", "SEK") },
      },
      EXCHANGES,
      now,
    );
    expect(errors).toEqual([]);
  });

  it.each([
    [{ currency: "SEK" }],
    [{ startAmount: Money.of("50000", "NOK") }],
    [{ feeRule: { rate: decimal("0.001"), minimum: Money.of("29", "NOK") } }],
    [{ allowedExchangeIds: ["XOSL"] }],
    [{ visibility: "open" }],
  ] as const)("locks %o after the start", (patch) => {
    expect(codes(patch as Partial<LeagueSettings>)).toEqual(["FIELD_LOCKED"]);
  });

  it("accepts an unchanged locked field (a form that sends everything)", () => {
    expect(codes({ currency: "NOK", startAmount: Money.of("100000", "NOK") })).toEqual([]);
  });

  it("allows name, description and a later end time after the start", () => {
    expect(
      codes({
        name: "Nytt navn",
        description: "Mer moro",
        endsAt: instant("2026-12-18T21:00:00Z"),
      }),
    ).toEqual([]);
  });

  it("rejects an end time in the past", () => {
    expect(codes({ endsAt: instant("2026-10-31T12:00:00Z") })).toContain("END_IN_PAST");
  });

  it("rejects a new end time while markets are open", () => {
    expect(codes({ endsAt: instant("2026-12-18T15:00:00Z") })).toContain("END_BEFORE_MARKET_CLOSE");
  });

  it("rejects moving the end of a finished league", () => {
    expect(
      codes({ endsAt: instant("2027-01-29T22:00:00Z") }, instant("2026-12-01T00:00:00Z")),
    ).toEqual(["LEAGUE_FINISHED"]);
  });
});

describe("joining", () => {
  const base = {
    league: league({ startsAt: instant("2026-11-01T00:00:00Z") }),
    isAlreadyMember: false,
    hasPendingRequest: false,
  };
  const duringLeague = instant("2026-11-10T00:00:00Z");

  it("is direct before the start", () => {
    expect(checkJoin({ ...base, now })).toEqual({ ok: true, mode: "direct" });
  });

  it("needs the owner's approval after the start", () => {
    expect(checkJoin({ ...base, now: duringLeague })).toEqual({ ok: true, mode: "needs_approval" });
  });

  it("refuses a second request while one is pending", () => {
    expect(checkJoin({ ...base, hasPendingRequest: true, now: duringLeague })).toEqual({
      ok: false,
      rejection: { code: "ALREADY_REQUESTED" },
    });
  });

  it("is refused after the end", () => {
    expect(checkJoin({ ...base, now: instant("2026-11-27T21:00:00Z") })).toEqual({
      ok: false,
      rejection: { code: "LEAGUE_FINISHED" },
    });
  });

  it("is refused for existing members", () => {
    expect(checkJoin({ ...base, isAlreadyMember: true, now })).toEqual({
      ok: false,
      rejection: { code: "ALREADY_MEMBER" },
    });
  });

  it("has no member limit", () => {
    expect("maxMembers" in defaultLeagueSettings("NOK", EXCHANGES)).toBe(false);
  });

  describe("approving a late join", () => {
    const decide = (overrides: Partial<Parameters<typeof checkJoinDecision>[0]> = {}) =>
      checkJoinDecision({
        league: base.league,
        request: { status: "pending" },
        deciderId: "ola",
        decision: "approve",
        now: duringLeague,
        ...overrides,
      });

    it("is allowed for the owner", () => {
      expect(decide()).toBeNull();
      expect(decide({ decision: "decline" })).toBeNull();
    });

    it("is refused for anyone else", () => {
      expect(decide({ deciderId: "kari" })).toEqual({ code: "NOT_OWNER" });
    });

    it("is refused for a request that was already decided", () => {
      expect(decide({ request: { status: "approved" } })).toEqual({ code: "REQUEST_NOT_PENDING" });
      expect(decide({ request: { status: "declined" } })).toEqual({ code: "REQUEST_NOT_PENDING" });
    });

    it("is refused after the end, but declining is still possible", () => {
      const after = instant("2026-11-27T21:00:00Z");
      expect(decide({ now: after })).toEqual({ code: "LEAGUE_FINISHED" });
      expect(decide({ now: after, decision: "decline" })).toBeNull();
    });
  });

  it("gives late members the full start amount", () => {
    const event = startingDeposit(league(), "dep-late", instant("2026-11-20T10:00:00Z"));
    expect(event.amount.toString()).toBe("100000 NOK");
  });
});
