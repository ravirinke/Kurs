import { describe, expect, it } from "vitest";

import type { LeagueStatus, Visibility } from "../league/types";
import { deposit, EQNR, nok, trade } from "../testing/fixtures";
import { instant } from "../time";

import { canSeeHoldings, resolvePortfolioAccess, visibleEvents } from "./index";

const now = instant("2026-10-28T12:00:00Z");

function access(
  visibility: Visibility,
  leagueStatus: LeagueStatus,
  overrides: Partial<{ viewer: string | null; member: boolean }> = {},
) {
  return resolvePortfolioAccess({
    visibility,
    leagueStatus,
    viewerIsMember: overrides.member ?? true,
    viewerMemberId: overrides.viewer === undefined ? "kari" : overrides.viewer,
    targetMemberId: "ola",
    now,
  });
}

describe("visibility", () => {
  describe("while the league is active", () => {
    it("open: shows everything in real time", () => {
      expect(access("open", "active")).toEqual({ kind: "full" });
    });

    it("delayed: shows holdings and trades as of 24 hours ago", () => {
      const result = access("delayed", "active");
      expect(result.kind).toBe("delayed");
      expect(result.kind === "delayed" && result.asOf.toUTC().toISO()).toBe(
        "2026-10-27T12:00:00.000Z",
      );
    });

    it("hidden: shows only the return", () => {
      expect(access("hidden", "active")).toEqual({ kind: "returnOnly" });
      expect(canSeeHoldings(access("hidden", "active"))).toBe(false);
    });

    it("upcoming leagues follow the same rule", () => {
      expect(access("hidden", "upcoming")).toEqual({ kind: "returnOnly" });
    });
  });

  describe("after the league is finished", () => {
    it.each(["open", "delayed", "hidden"] as const)("%s: shows everything", (visibility) => {
      expect(access(visibility, "finished")).toEqual({ kind: "full" });
    });
  });

  it.each(["open", "delayed", "hidden"] as const)(
    "%s: members always see their own portfolio in full",
    (visibility) => {
      expect(access(visibility, "active", { viewer: "ola" })).toEqual({ kind: "full" });
    },
  );

  it("shows nothing to someone who is not a member, even after the end", () => {
    expect(access("open", "finished", { member: false, viewer: null })).toEqual({ kind: "none" });
  });

  describe("visibleEvents", () => {
    const events = [
      deposit(nok("100000"), instant("2026-10-26T08:00:00Z")),
      trade({
        id: "old",
        side: "buy",
        at: instant("2026-10-27T11:59:59Z"),
        instrument: EQNR,
        quantity: "10",
        price: "100",
        fee: "29",
      }),
      trade({
        id: "new",
        side: "buy",
        at: instant("2026-10-27T12:00:01Z"),
        instrument: EQNR,
        quantity: "10",
        price: "100",
        fee: "29",
      }),
    ];

    it("hides trades from the last 24 hours when delayed", () => {
      expect(visibleEvents(events, access("delayed", "active")).map((event) => event.id)).toEqual([
        "deposit",
        "old",
      ]);
    });

    it("hides all trades when hidden", () => {
      expect(visibleEvents(events, access("hidden", "active"))).toEqual([]);
    });

    it("shows all trades when open or finished", () => {
      expect(visibleEvents(events, access("open", "active"))).toHaveLength(3);
      expect(visibleEvents(events, access("hidden", "finished"))).toHaveLength(3);
    });
  });
});
