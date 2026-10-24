import {
  APP_TIME_ZONE,
  localDate,
  type PriceProvider,
  replayUntil,
  returnFraction,
  startOfAppDay,
} from "@aksjeliga/core";
import { eq, gt, lt } from "drizzle-orm";
import { DateTime } from "luxon";

import type { Database } from "../client";
import { toDbTime, toNumeric } from "../mappers";
import { must } from "../must";
import { leagues, portfolioSnapshots } from "../schema";
import { loadActiveMembers, loadLeagueEvents, valueStates } from "../services/leaderboard";

import { type JobScope, leaguesForJob } from "./scope";

/** How many missed days a run fills in at most. */
export const SNAPSHOT_LOOKBACK_DAYS = 31;

function nextDate(date: string): string {
  return must(
    DateTime.fromISO(date, { zone: APP_TIME_ZONE }).plus({ days: 1 }).toISODate(),
    "date",
  );
}

/**
 * Stores each member's portfolio value at the end of every finished day (Europe/Oslo) of a
 * league, for charts and history. Today is never snapshotted: it is not over yet. Days the
 * job missed are filled in (up to SNAPSHOT_LOOKBACK_DAYS back); existing snapshots are left
 * alone, so running it twice changes nothing. The last day of a league is valued at the end
 * time, like the final result.
 */
export async function takeDailySnapshots(
  db: Database,
  provider: PriceProvider,
  input: { now: DateTime } & JobScope,
): Promise<{ taken: number }> {
  const today = startOfAppDay(input.now);
  const earliest = today.minus({ days: SNAPSHOT_LOOKBACK_DAYS });
  const candidates = await leaguesForJob(db, input, [
    lt(leagues.startsAt, toDbTime(today)),
    gt(leagues.endsAt, toDbTime(earliest)),
  ]);

  let taken = 0;
  for (const league of candidates) {
    const members = await loadActiveMembers(db, league.id);
    if (members.length === 0) continue;
    const events = await loadLeagueEvents(db, league);
    const existing = new Set(
      (
        await db
          .select({ memberId: portfolioSnapshots.memberId, date: portfolioSnapshots.date })
          .from(portfolioSnapshots)
          .where(eq(portfolioSnapshots.leagueId, league.id))
      ).map((row) => `${row.memberId}|${row.date}`),
    );

    const first = league.startsAt.toMillis() > earliest.toMillis() ? league.startsAt : earliest;
    const todayDate = localDate(today, APP_TIME_ZONE);
    for (let date = localDate(first, APP_TIME_ZONE); date < todayDate; date = nextDate(date)) {
      const startOfDay = DateTime.fromISO(date, { zone: APP_TIME_ZONE }).toUTC();
      if (league.endsAt.toMillis() <= startOfDay.toMillis()) break;
      const endOfDay = DateTime.fromISO(nextDate(date), { zone: APP_TIME_ZONE }).toUTC();
      const at = endOfDay.toMillis() < league.endsAt.toMillis() ? endOfDay : league.endsAt;
      const due = members.filter(
        (member) =>
          member.joinedAt.toMillis() <= at.toMillis() &&
          !existing.has(`${member.memberId}|${date}`),
      );
      if (due.length === 0) continue;

      const states = due.map((member) =>
        replayUntil(league.currency, events.get(member.memberId) ?? [], at),
      );
      const { values } = await valueStates(db, provider, league.currency, states, at);
      const rows = due.map((member, index) => {
        const value = must(values[index], "value");
        return {
          leagueId: league.id,
          memberId: member.memberId,
          date,
          value: toNumeric(value.amount),
          cash: toNumeric(must(states[index], "state").cash.round().amount),
          returnFraction: toNumeric(returnFraction(value, league.startAmount)),
          takenAt: toDbTime(input.now),
        };
      });
      const inserted = await db
        .insert(portfolioSnapshots)
        .values(rows)
        .onConflictDoNothing()
        .returning({ memberId: portfolioSnapshots.memberId });
      taken += inserted.length;
    }
  }
  return { taken };
}
