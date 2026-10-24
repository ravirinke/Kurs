import type { League } from "@aksjeliga/core";
import { and, inArray, isNull, type SQL } from "drizzle-orm";

import type { Executor } from "../client";
import { loadLeague } from "../repositories/leagues";
import { leagues } from "../schema";

/**
 * Limits a job run to some leagues: one league (finalization when someone opens it), or
 * the leagues a test created. Without a scope a job covers every league.
 */
export interface JobScope {
  leagueIds?: readonly string[];
}

/** Leagues that are not cancelled, match the conditions and are inside the scope. */
export async function leaguesForJob(
  db: Executor,
  scope: JobScope,
  conditions: readonly SQL[],
): Promise<League[]> {
  if (scope.leagueIds?.length === 0) return [];
  const rows = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(
      and(
        isNull(leagues.cancelledAt),
        ...conditions,
        scope.leagueIds ? inArray(leagues.id, [...scope.leagueIds]) : undefined,
      ),
    )
    .orderBy(leagues.endsAt);
  const loaded = await Promise.all(rows.map((row) => loadLeague(db, row.id)));
  return loaded.filter((league): league is League => league !== null);
}
