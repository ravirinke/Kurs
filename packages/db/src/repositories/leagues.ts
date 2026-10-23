import type { League } from "@aksjeliga/core";
import { and, eq } from "drizzle-orm";

import type { Executor } from "../client";
import { toLeague } from "../mappers";
import { leagueAllowedExchanges, leagueMembers, leagues } from "../schema";

export async function loadLeague(db: Executor, id: string): Promise<League | null> {
  const [row] = await db.select().from(leagues).where(eq(leagues.id, id));
  if (!row) return null;
  const allowed = await db
    .select({ exchangeId: leagueAllowedExchanges.exchangeId })
    .from(leagueAllowedExchanges)
    .where(eq(leagueAllowedExchanges.leagueId, id))
    .orderBy(leagueAllowedExchanges.exchangeId);
  return toLeague(
    row,
    allowed.map((entry) => entry.exchangeId),
  );
}

export async function loadLeagueByInviteCode(
  db: Executor,
  inviteCode: string,
): Promise<League | null> {
  const [row] = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.inviteCode, normalizeInviteCode(inviteCode)));
  return row ? loadLeague(db, row.id) : null;
}

export type MemberRow = typeof leagueMembers.$inferSelect;

export async function findMember(
  db: Executor,
  leagueId: string,
  userId: string,
): Promise<MemberRow | null> {
  const [row] = await db
    .select()
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)));
  return row ?? null;
}

/** Locks the member row for the rest of the transaction. Every trade takes this lock. */
export async function lockMember(db: Executor, memberId: string): Promise<MemberRow | null> {
  const [row] = await db
    .select()
    .from(leagueMembers)
    .where(eq(leagueMembers.id, memberId))
    .for("update");
  return row ?? null;
}

/** Invite codes are case-insensitive and ignore spaces and dashes. */
export function normalizeInviteCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}
