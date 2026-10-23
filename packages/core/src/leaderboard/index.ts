import type { DateTime } from "luxon";

import type { Decimal, Money } from "../money";

export interface LeaderboardInput {
  memberId: string;
  /** Current (or final) portfolio value. Rounded to øre before ranking. */
  value: Money;
  startAmount: Money;
  /** Latest buy or sell; null if the member never traded. */
  lastTradeAt: DateTime | null;
}

export interface LeaderboardEntry {
  memberId: string;
  value: Money;
  startAmount: Money;
  lastTradeAt: DateTime | null;
  /** (value − start) / start, as a fraction (0.0234 = 2.34 %). */
  returnFraction: Decimal;
  /** Competition ranking: 1, 1, 3. */
  rank: number;
  /** True when the rank is shared with someone else. */
  isTied: boolean;
}

export function returnFraction(value: Money, startAmount: Money): Decimal {
  return value.minus(startAmount).ratioTo(startAmount);
}

/**
 * Ranking rule (docs/decisions.md):
 * 1. Higher return first.
 * 2. Equal return: the member whose last trade is OLDEST ranks higher. They locked in the
 *    result first, and a copycat always trades later.
 * 3. Equal return and never traded: shared place, after tied members who did trade.
 * 4. Equal return and identical last-trade time: shared place.
 */
function compareStanding(a: LeaderboardEntry, b: LeaderboardEntry): number {
  const byReturn = b.returnFraction.comparedTo(a.returnFraction);
  if (byReturn !== 0) return byReturn;
  if (a.lastTradeAt && b.lastTradeAt) return a.lastTradeAt.toMillis() - b.lastTradeAt.toMillis();
  if (a.lastTradeAt) return -1;
  if (b.lastTradeAt) return 1;
  return 0;
}

export function rankLeaderboard(inputs: readonly LeaderboardInput[]): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = inputs.map((input) => {
    const value = input.value.round();
    return {
      ...input,
      value,
      returnFraction: returnFraction(value, input.startAmount),
      rank: 0,
      isTied: false,
    };
  });

  // Members who share a place are listed by id, so the order is stable between renders.
  entries.sort((a, b) => compareStanding(a, b) || a.memberId.localeCompare(b.memberId));

  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    entry.rank = previous && compareStanding(previous, entry) === 0 ? previous.rank : index + 1;
  });
  entries.forEach((entry, index) => {
    const neighbours = [entries[index - 1], entries[index + 1]];
    entry.isTied = neighbours.some((other) => other?.rank === entry.rank);
  });

  return entries;
}

export interface FinalStandings {
  standings: LeaderboardEntry[];
  /** Everyone ranked first. More than one when first place is shared. */
  winnerIds: string[];
}

export function computeFinalStandings(inputs: readonly LeaderboardInput[]): FinalStandings {
  const standings = rankLeaderboard(inputs);
  return {
    standings,
    winnerIds: standings.filter((entry) => entry.rank === 1).map((entry) => entry.memberId),
  };
}

/**
 * Places gained since an earlier ranking (positive = moved up). Members missing from the
 * earlier ranking (new members) are left out.
 */
export function rankMovement(
  current: readonly LeaderboardEntry[],
  previous: readonly LeaderboardEntry[],
): Map<string, number> {
  const previousRanks = new Map(previous.map((entry) => [entry.memberId, entry.rank]));
  const movement = new Map<string, number>();
  for (const entry of current) {
    const before = previousRanks.get(entry.memberId);
    if (before !== undefined) movement.set(entry.memberId, before - entry.rank);
  }
  return movement;
}
