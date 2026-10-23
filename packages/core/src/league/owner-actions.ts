import type { DateTime } from "luxon";

import { deriveLeagueStatus } from "./status";
import type { League } from "./types";

/*
 * What only the league owner may do, and when (docs/decisions.md). Editing settings is in
 * settings.ts (validateLeagueUpdate) and approving joins in membership.ts.
 */

export type OwnerActionRejection =
  | { code: "NOT_OWNER" }
  | { code: "LEAGUE_FINISHED" }
  | { code: "LEAGUE_CANCELLED" }
  | { code: "LEAGUE_ALREADY_STARTED" }
  | { code: "CANNOT_REMOVE_OWNER" }
  | { code: "NOT_A_MEMBER" };

type OwnedLeague = Pick<League, "ownerId" | "startsAt" | "endsAt" | "cancelledAt">;

interface OwnerContext {
  league: OwnedLeague;
  actorId: string;
  now: DateTime;
}

function ownerAndOpen(context: OwnerContext): OwnerActionRejection | null {
  if (context.actorId !== context.league.ownerId) return { code: "NOT_OWNER" };
  const status = deriveLeagueStatus(context.league, context.now);
  if (status === "cancelled") return { code: "LEAGUE_CANCELLED" };
  if (status === "finished") return { code: "LEAGUE_FINISHED" };
  return null;
}

/** A new invite code makes the old code and link stop working. Allowed until the end. */
export function checkRegenerateInviteCode(context: OwnerContext): OwnerActionRejection | null {
  return ownerAndOpen(context);
}

/**
 * Removing a member hides them from the league and takes away their access. Their
 * transactions stay (they are immutable), and they can never join again.
 */
export function checkRemoveMember(
  context: OwnerContext & { targetUserId: string; targetIsActiveMember: boolean },
): OwnerActionRejection | null {
  const rejection = ownerAndOpen(context);
  if (rejection) return rejection;
  if (context.targetUserId === context.league.ownerId) return { code: "CANNOT_REMOVE_OWNER" };
  if (!context.targetIsActiveMember) return { code: "NOT_A_MEMBER" };
  return null;
}

/** A league can only be cancelled before it starts. */
export function checkCancelLeague(context: OwnerContext): OwnerActionRejection | null {
  const rejection = ownerAndOpen(context);
  if (rejection) return rejection;
  if (deriveLeagueStatus(context.league, context.now) !== "upcoming") {
    return { code: "LEAGUE_ALREADY_STARTED" };
  }
  return null;
}
