import { describe, expect, it } from "vitest";

import { nok } from "../testing/fixtures";
import { instant } from "../time";

import {
  computeFinalStandings,
  type LeaderboardInput,
  rankLeaderboard,
  rankMovement,
} from "./index";

const start = nok("100000");
const monday = instant("2026-10-26T10:00:00Z");
const tuesday = instant("2026-10-27T10:00:00Z");

function member(
  memberId: string,
  value: string,
  lastTradeAt: LeaderboardInput["lastTradeAt"] = monday,
): LeaderboardInput {
  return { memberId, value: nok(value), startAmount: start, lastTradeAt };
}

function summary(inputs: LeaderboardInput[]) {
  return rankLeaderboard(inputs).map(
    (entry) => `${entry.rank}:${entry.memberId}${entry.isTied ? "=" : ""}`,
  );
}

describe("leaderboard", () => {
  it("ranks by return", () => {
    const ranked = rankLeaderboard([
      member("ola", "101000"),
      member("kari", "105000"),
      member("per", "98000"),
    ]);
    expect(ranked.map((entry) => entry.memberId)).toEqual(["kari", "ola", "per"]);
    expect(ranked.map((entry) => entry.returnFraction.toString())).toEqual([
      "0.05",
      "0.01",
      "-0.02",
    ]);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it("breaks a tie in favour of the oldest last trade (the copycat trades later)", () => {
    const original = member("ola", "105000", monday);
    const copycat = member("kari", "105000", tuesday);
    expect(summary([copycat, original])).toEqual(["1:ola", "2:kari"]);
  });

  it("shares the place when nobody in the tie has traded", () => {
    expect(summary([member("ola", "100000", null), member("kari", "100000", null)])).toEqual([
      "1:kari=",
      "1:ola=",
    ]);
  });

  it("ranks tied members who traded ahead of tied members who did not", () => {
    // Ola bought and sold back to exactly the start value; Kari and Per never traded.
    const ranked = summary([
      member("kari", "100000", null),
      member("ola", "100000", monday),
      member("per", "100000", null),
    ]);
    expect(ranked).toEqual(["1:ola", "2:kari=", "2:per="]);
  });

  it("shares the place when return and last trade time are identical", () => {
    expect(summary([member("ola", "103000", monday), member("kari", "103000", monday)])).toEqual([
      "1:kari=",
      "1:ola=",
    ]);
  });

  it("uses competition ranking after a shared place (1, 1, 3)", () => {
    const ranked = rankLeaderboard([
      member("a", "110000", null),
      member("b", "110000", null),
      member("c", "90000"),
    ]);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 1, 3]);
  });

  it("compares values rounded to øre", () => {
    const ranked = summary([member("ola", "100500.004", null), member("kari", "100500.001", null)]);
    expect(ranked).toEqual(["1:kari=", "1:ola="]);
  });

  it("can have several winners", () => {
    const final = computeFinalStandings([
      member("ola", "120000", null),
      member("kari", "120000", null),
      member("per", "101000"),
    ]);
    expect(final.winnerIds).toEqual(["kari", "ola"]);
  });

  it("normally has one winner", () => {
    const final = computeFinalStandings([
      member("ola", "120000", monday),
      member("kari", "120000", tuesday),
    ]);
    expect(final.winnerIds).toEqual(["ola"]);
  });

  it("tracks who moves up and down", () => {
    const yesterday = rankLeaderboard([
      member("ola", "105000"),
      member("kari", "103000"),
      member("per", "101000"),
    ]);
    const today = rankLeaderboard([
      member("ola", "102000"),
      member("kari", "104000"),
      member("per", "106000"),
      member("ny", "100000"),
    ]);
    const movement = rankMovement(today, yesterday);
    expect(movement.get("per")).toBe(2);
    expect(movement.get("kari")).toBe(0);
    expect(movement.get("ola")).toBe(-2);
    expect(movement.has("ny")).toBe(false);
  });
});
