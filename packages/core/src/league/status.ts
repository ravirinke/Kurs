import type { DateTime } from "luxon";

import type { LeagueStatus } from "./types";

/**
 * Status follows from the times: trading stops the moment `endsAt` passes, even before the
 * finalization job has stored the results. A cancelled league stays cancelled.
 */
export function deriveLeagueStatus(
  league: { startsAt: DateTime; endsAt: DateTime; cancelledAt?: DateTime | null },
  now: DateTime,
): LeagueStatus {
  if (league.cancelledAt) return "cancelled";
  const t = now.toMillis();
  if (t < league.startsAt.toMillis()) return "upcoming";
  if (t < league.endsAt.toMillis()) return "active";
  return "finished";
}

/** True when the league has ended but the finalization job has not stored results yet. */
export function needsFinalization(
  league: { endsAt: DateTime; finalizedAt: DateTime | null; cancelledAt?: DateTime | null },
  now: DateTime,
): boolean {
  if (league.cancelledAt) return false;
  return league.finalizedAt === null && now.toMillis() >= league.endsAt.toMillis();
}
