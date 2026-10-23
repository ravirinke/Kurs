import {
  checkCancelLeague,
  checkRegenerateInviteCode,
  checkRemoveMember,
  type OwnerActionRejection,
} from "@aksjeliga/core";
import { and, eq } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Database, Transaction } from "../client";
import { toDbTime } from "../mappers";
import { findMember, loadLeague } from "../repositories/leagues";
import { leagueJoinRequests, leagues, leagueMembers } from "../schema";

import { generateInviteCode } from "./leagues";

export type OwnerActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; rejection: OwnerActionRejection | { code: "LEAGUE_NOT_FOUND" } };

/** Locks the league row and loads it, so owner actions never interleave. */
async function lockedLeague(tx: Transaction, leagueId: string) {
  await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, leagueId)).for("update");
  return loadLeague(tx, leagueId);
}

/** A new invite code; the old code and link stop working. */
export async function regenerateInviteCode(
  db: Database,
  input: { leagueId: string; userId: string; now: DateTime },
): Promise<OwnerActionResult<{ inviteCode: string }>> {
  return db.transaction(async (tx) => {
    const league = await lockedLeague(tx, input.leagueId);
    if (!league) return { ok: false, rejection: { code: "LEAGUE_NOT_FOUND" } };
    const rejection = checkRegenerateInviteCode({ league, actorId: input.userId, now: input.now });
    if (rejection) return { ok: false, rejection };

    const inviteCode = generateInviteCode();
    await tx.update(leagues).set({ inviteCode }).where(eq(leagues.id, league.id));
    return { ok: true, inviteCode };
  });
}

/**
 * Removes a member: they disappear from the league and lose access, their transactions stay
 * (immutable), and they can never join again. Their pending quotes become unusable because
 * trading requires an active membership.
 */
export async function removeMember(
  db: Database,
  input: { leagueId: string; userId: string; targetUserId: string; now: DateTime },
): Promise<OwnerActionResult> {
  return db.transaction(async (tx) => {
    const league = await lockedLeague(tx, input.leagueId);
    if (!league) return { ok: false, rejection: { code: "LEAGUE_NOT_FOUND" } };
    const target = await findMember(tx, league.id, input.targetUserId);
    const rejection = checkRemoveMember({
      league,
      actorId: input.userId,
      targetUserId: input.targetUserId,
      targetIsActiveMember: target !== null && target.removedAt === null,
      now: input.now,
    });
    if (rejection || !target)
      return { ok: false, rejection: rejection ?? { code: "NOT_A_MEMBER" } };

    // Take the member lock too, so a trade in flight finishes before the removal.
    await tx
      .select({ id: leagueMembers.id })
      .from(leagueMembers)
      .where(eq(leagueMembers.id, target.id))
      .for("update");
    await tx
      .update(leagueMembers)
      .set({ removedAt: toDbTime(input.now) })
      .where(eq(leagueMembers.id, target.id));
    return { ok: true };
  });
}

/** Cancels a league before it starts. It disappears from everyone's lists. */
export async function cancelLeague(
  db: Database,
  input: { leagueId: string; userId: string; now: DateTime },
): Promise<OwnerActionResult> {
  return db.transaction(async (tx) => {
    const league = await lockedLeague(tx, input.leagueId);
    if (!league) return { ok: false, rejection: { code: "LEAGUE_NOT_FOUND" } };
    const rejection = checkCancelLeague({ league, actorId: input.userId, now: input.now });
    if (rejection) return { ok: false, rejection };

    await tx
      .update(leagues)
      .set({ cancelledAt: toDbTime(input.now) })
      .where(eq(leagues.id, league.id));
    // Nobody can be approved into a cancelled league; close open requests.
    await tx
      .update(leagueJoinRequests)
      .set({ status: "declined", decidedAt: toDbTime(input.now), decidedBy: input.userId })
      .where(
        and(eq(leagueJoinRequests.leagueId, league.id), eq(leagueJoinRequests.status, "pending")),
      );
    return { ok: true };
  });
}
