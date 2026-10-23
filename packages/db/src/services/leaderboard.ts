import {
  decimal,
  type Decimal,
  deriveLeagueStatus,
  type Instrument,
  type League,
  type LeagueStatus,
  type LedgerEvent,
  type LedgerState,
  type Mark,
  Money,
  type PriceProvider,
  rankLeaderboard,
  rankMovement,
  replayUntil,
  resolveMarks,
  startOfAppDay,
  type ValueChange,
  valueChange,
  valuePortfolio,
} from "@aksjeliga/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Executor } from "../client";
import { must } from "../must";
import { rowToEvent, toDateTime } from "../mappers";
import { loadLeague } from "../repositories/leagues";
import { loadInstruments } from "../repositories/reference";
import { leagueMembers, profiles, transactions } from "../schema";

export interface ActiveMember {
  memberId: string;
  userId: string;
  displayName: string;
  joinedAt: DateTime;
  finalRank: number | null;
  finalValue: string | null;
  finalReturn: string | null;
  isWinner: boolean;
}

/** Members who have not been removed, with their display names. */
export async function loadActiveMembers(db: Executor, leagueId: string): Promise<ActiveMember[]> {
  const rows = await db
    .select({
      memberId: leagueMembers.id,
      userId: leagueMembers.userId,
      displayName: profiles.displayName,
      joinedAt: leagueMembers.joinedAt,
      finalRank: leagueMembers.finalRank,
      finalValue: leagueMembers.finalValue,
      finalReturn: leagueMembers.finalReturn,
      isWinner: leagueMembers.isWinner,
    })
    .from(leagueMembers)
    .innerJoin(profiles, eq(profiles.id, leagueMembers.userId))
    .where(and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.removedAt)))
    .orderBy(asc(leagueMembers.joinedAt));
  return rows.map((row) => ({ ...row, joinedAt: toDateTime(row.joinedAt) }));
}

/** Every event in a league, grouped by member, in order. */
export async function loadLeagueEvents(
  db: Executor,
  league: Pick<League, "id" | "currency">,
): Promise<Map<string, LedgerEvent[]>> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.leagueId, league.id))
    .orderBy(asc(transactions.occurredAt), asc(transactions.sequence));
  const byMember = new Map<string, LedgerEvent[]>();
  for (const row of rows) {
    const list = byMember.get(row.memberId) ?? [];
    list.push(rowToEvent(row, league.currency));
    byMember.set(row.memberId, list);
  }
  return byMember;
}

/** Values many ledger states at one instant, resolving each instrument's mark once. */
export async function valueStates(
  db: Executor,
  provider: PriceProvider,
  currency: League["currency"],
  states: readonly LedgerState[],
  at: DateTime,
): Promise<{ values: Money[]; marks: Map<string, Mark>; instruments: Instrument[] }> {
  const ids = [...new Set(states.flatMap((state) => [...state.positions.keys()]))];
  const instruments = await loadInstruments(db, ids);
  const marks = await resolveMarks(provider, instruments, currency, at);
  return {
    values: states.map((state) => valuePortfolio(state, marks).totalValue),
    marks,
    instruments,
  };
}

export interface LeaderboardRow {
  memberId: string;
  userId: string;
  displayName: string;
  rank: number;
  isTied: boolean;
  value: Money;
  returnFraction: Decimal;
  lastTradeAt: DateTime | null;
  /** Since the end of yesterday (app time zone). Null for members who joined today. */
  dayChange: ValueChange | null;
  /** Places gained since the end of yesterday (positive = up). Null for new members. */
  movement: number | null;
  isWinner: boolean;
}

export interface LeaderboardView {
  league: League;
  status: LeagueStatus;
  /** The instant the values are for: now, or the end time for a finished league. */
  valuedAt: DateTime;
  /** True when the stored final result is shown (never recomputed). */
  isFinal: boolean;
  rows: LeaderboardRow[];
}

/**
 * The league table. Returns and ranks are visible to every member at every visibility
 * level, so this view contains no holdings. After finalization the stored result is used.
 */
export async function loadLeaderboard(
  db: Executor,
  provider: PriceProvider,
  leagueId: string,
  now: DateTime,
): Promise<LeaderboardView | null> {
  const league = await loadLeague(db, leagueId);
  if (!league) return null;
  const status = deriveLeagueStatus(league, now);
  const members = await loadActiveMembers(db, leagueId);
  const events = await loadLeagueEvents(db, league);
  const valuedAt = now.toMillis() < league.endsAt.toMillis() ? now : league.endsAt;
  const yesterdayEnd = startOfAppDay(valuedAt);

  // A member always counts with at least their starting deposit (matters only if "now" is
  // before they joined, e.g. with the dev time machine).
  const stateNow = members.map((member) =>
    replayUntil(
      league.currency,
      events.get(member.memberId) ?? [],
      member.joinedAt > valuedAt ? member.joinedAt : valuedAt,
    ),
  );
  const earlier = members.filter((member) => member.joinedAt.toMillis() < yesterdayEnd.toMillis());
  const stateBefore = earlier.map((member) =>
    replayUntil(league.currency, events.get(member.memberId) ?? [], yesterdayEnd),
  );
  const [current, previous] = await Promise.all([
    valueStates(db, provider, league.currency, stateNow, valuedAt),
    valueStates(db, provider, league.currency, stateBefore, yesterdayEnd),
  ]);

  const ranked = rankLeaderboard(
    members.map((member, index) => ({
      memberId: member.memberId,
      value: must(current.values[index], "value"),
      startAmount: league.startAmount,
      lastTradeAt: must(stateNow[index], "state").lastTradeAt,
    })),
  );
  const previousValues = new Map(
    earlier.map((member, index) => [
      member.memberId,
      must(previous.values[index], "previous value"),
    ]),
  );
  const movement = rankMovement(
    ranked,
    rankLeaderboard(
      earlier.map((member, index) => ({
        memberId: member.memberId,
        value: must(previous.values[index], "previous value"),
        startAmount: league.startAmount,
        lastTradeAt: must(stateBefore[index], "previous state").lastTradeAt,
      })),
    ),
  );
  const byId = new Map(members.map((member) => [member.memberId, member]));
  const isFinal =
    league.finalizedAt !== null && members.every((member) => member.finalRank !== null);

  const rows: LeaderboardRow[] = ranked.map((entry) => {
    const member = must(byId.get(entry.memberId), "member");
    const before = previousValues.get(entry.memberId);
    if (isFinal) {
      return {
        memberId: member.memberId,
        userId: member.userId,
        displayName: member.displayName,
        rank: must(member.finalRank, "final rank"),
        isTied: members.some((other) => other !== member && other.finalRank === member.finalRank),
        value: Money.of(member.finalValue ?? entry.value.amount.toFixed(), league.currency),
        returnFraction: member.finalReturn ? decimal(member.finalReturn) : entry.returnFraction,
        lastTradeAt: entry.lastTradeAt,
        dayChange: null,
        movement: null,
        isWinner: member.isWinner,
      };
    }
    return {
      memberId: member.memberId,
      userId: member.userId,
      displayName: member.displayName,
      rank: entry.rank,
      isTied: entry.isTied,
      value: entry.value,
      returnFraction: entry.returnFraction,
      lastTradeAt: entry.lastTradeAt,
      dayChange: before ? valueChange(entry.value, before) : null,
      movement: movement.get(entry.memberId) ?? null,
      isWinner: status === "finished" && entry.rank === 1,
    };
  });
  if (isFinal) rows.sort((a, b) => a.rank - b.rank);

  return { league, status, valuedAt, isFinal, rows };
}
