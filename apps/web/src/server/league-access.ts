import "server-only";

import { findMember, loadLeague } from "@aksjeliga/db";
import { notFound } from "next/navigation";

import { getDb } from "./db";
import { requireProfile } from "./session";

/**
 * Every league page starts here: the viewer must be signed in and an active member. Anyone
 * else (outsiders, removed members, cancelled leagues) gets a 404, so league ids leak nothing.
 */
export async function requireLeagueMember(leagueId: string, path: string) {
  const session = await requireProfile(path);
  const db = getDb();
  const [league, member] = await Promise.all([
    loadLeague(db, leagueId),
    findMember(db, leagueId, session.user.id),
  ]);
  if (!league || league.cancelledAt || !member || member.removedAt) notFound();
  return { ...session, league, member, isOwner: league.ownerId === session.user.id };
}
