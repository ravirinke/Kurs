import {
  computeFinalStandings,
  needsFinalization,
  type PriceProvider,
  replayUntil,
} from "@aksjeliga/core";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Database } from "../client";
import { toDbTime, toNumeric } from "../mappers";
import { must } from "../must";
import { loadLeague } from "../repositories/leagues";
import { leagueMembers, leagues } from "../schema";
import { loadActiveMembers, loadLeagueEvents, valueStates } from "../services/leaderboard";

import { processCorporateActions } from "./corporate-actions";
import { type JobScope, leaguesForJob } from "./scope";

/**
 * Stores the final result of a league that has ended: every portfolio valued at the end
 * time (last closes, FX frozen at each close), the final rank, value and return per member,
 * and the winner(s). Returns false when there was nothing to do.
 *
 * Idempotent and the same whenever it runs: the values are for `endsAt`, not for now, and
 * once `finalized_at` is set the result is never touched again. Splits and dividends due
 * before the end are booked first, so the frozen result includes them.
 */
export async function finalizeLeagueIfDue(
  db: Database,
  provider: PriceProvider,
  input: { leagueId: string; now: DateTime },
): Promise<boolean> {
  const { leagueId, now } = input;
  const before = await loadLeague(db, leagueId);
  if (!before || !needsFinalization(before, now)) return false;
  await processCorporateActions(db, provider, { now, leagueIds: [leagueId] });

  return db.transaction(async (tx) => {
    // Two runs at once (the daily job and someone opening the league): the second waits
    // here and then sees finalized_at.
    await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, leagueId)).for("update");
    const league = await loadLeague(tx, leagueId);
    if (!league || !needsFinalization(league, now)) return false;

    const members = await loadActiveMembers(tx, leagueId);
    const events = await loadLeagueEvents(tx, league);
    const states = members.map((member) =>
      replayUntil(league.currency, events.get(member.memberId) ?? [], league.endsAt),
    );
    const { values } = await valueStates(tx, provider, league.currency, states, league.endsAt);
    const { standings, winnerIds } = computeFinalStandings(
      members.map((member, index) => ({
        memberId: member.memberId,
        value: must(values[index], "value"),
        startAmount: league.startAmount,
        lastTradeAt: must(states[index], "state").lastTradeAt,
      })),
    );

    for (const entry of standings) {
      await tx
        .update(leagueMembers)
        .set({
          finalRank: entry.rank,
          finalValue: toNumeric(entry.value.round().amount),
          finalReturn: toNumeric(entry.returnFraction),
          isWinner: winnerIds.includes(entry.memberId),
        })
        .where(eq(leagueMembers.id, entry.memberId));
    }
    await tx
      .update(leagues)
      .set({ finalizedAt: toDbTime(now) })
      .where(eq(leagues.id, leagueId));
    return true;
  });
}

/**
 * Finalizes every league that has ended without a stored result. `userId` limits it to the
 * leagues a user is in (the home page). Returns how many were finalized.
 */
export async function finalizeDueLeagues(
  db: Database,
  provider: PriceProvider,
  input: { now: DateTime; userId?: string } & JobScope,
): Promise<number> {
  const due = await leaguesForJob(
    db,
    input,
    [
      isNull(leagues.finalizedAt),
      lte(leagues.endsAt, toDbTime(input.now)),
      input.userId
        ? inArray(
            leagues.id,
            db
              .select({ id: leagueMembers.leagueId })
              .from(leagueMembers)
              .where(and(eq(leagueMembers.userId, input.userId), isNull(leagueMembers.removedAt))),
          )
        : undefined,
    ].filter((condition) => condition !== undefined),
  );
  let finalized = 0;
  for (const league of due) {
    if (await finalizeLeagueIfDue(db, provider, { leagueId: league.id, now: input.now }))
      finalized += 1;
  }
  return finalized;
}
