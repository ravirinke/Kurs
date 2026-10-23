import {
  deriveLeagueStatus,
  type League,
  type LeagueStatus,
  type PriceProvider,
} from "@aksjeliga/core";
import { and, eq, isNull } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Executor } from "../client";
import { toDateTime } from "../mappers";
import { loadLeague, loadLeagueByInviteCode } from "../repositories/leagues";
import { leagueJoinRequests, leagueMembers, profiles } from "../schema";

import { type LeaderboardRow, loadLeaderboard } from "./leaderboard";

export interface LeagueCard {
  league: League;
  status: LeagueStatus;
  memberCount: number;
  isOwner: boolean;
  /** The viewer's row in the table. */
  me: LeaderboardRow | null;
  /** Winners' names, when finished. */
  winners: string[];
  /** For the owner: join requests waiting for a decision. */
  pendingRequestCount: number;
}

export interface MyLeagues {
  active: LeagueCard[];
  upcoming: LeagueCard[];
  /** Leagues the viewer asked to join (after the start) and that await the owner. */
  awaitingApproval: { league: League; status: LeagueStatus; requestedAt: DateTime }[];
  finished: LeagueCard[];
}

async function pendingRequestCount(db: Executor, leagueId: string): Promise<number> {
  const rows = await db
    .select({ id: leagueJoinRequests.id })
    .from(leagueJoinRequests)
    .where(
      and(eq(leagueJoinRequests.leagueId, leagueId), eq(leagueJoinRequests.status, "pending")),
    );
  return rows.length;
}

/** The home page: the viewer's leagues by section. Cancelled leagues are left out. */
export async function loadMyLeagues(
  db: Executor,
  provider: PriceProvider,
  input: { userId: string; now: DateTime },
): Promise<MyLeagues> {
  const memberships = await db
    .select({ leagueId: leagueMembers.leagueId })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.userId, input.userId), isNull(leagueMembers.removedAt)));

  const cards: LeagueCard[] = [];
  for (const { leagueId } of memberships) {
    const board = await loadLeaderboard(db, provider, leagueId, input.now);
    if (!board || board.status === "cancelled") continue;
    const isOwner = board.league.ownerId === input.userId;
    cards.push({
      league: board.league,
      status: board.status,
      memberCount: board.rows.length,
      isOwner,
      me: board.rows.find((row) => row.userId === input.userId) ?? null,
      winners:
        board.status === "finished"
          ? board.rows.filter((row) => row.rank === 1).map((row) => row.displayName)
          : [],
      pendingRequestCount: isOwner ? await pendingRequestCount(db, leagueId) : 0,
    });
  }

  const requests = await db
    .select({ leagueId: leagueJoinRequests.leagueId, requestedAt: leagueJoinRequests.requestedAt })
    .from(leagueJoinRequests)
    .where(
      and(eq(leagueJoinRequests.userId, input.userId), eq(leagueJoinRequests.status, "pending")),
    );
  const awaitingApproval: MyLeagues["awaitingApproval"] = [];
  for (const request of requests) {
    const league = await loadLeague(db, request.leagueId);
    if (!league) continue;
    const status = deriveLeagueStatus(league, input.now);
    if (status === "cancelled" || status === "finished") continue;
    awaitingApproval.push({ league, status, requestedAt: toDateTime(request.requestedAt) });
  }

  const byEnd = (a: LeagueCard, b: LeagueCard) =>
    a.league.endsAt.toMillis() - b.league.endsAt.toMillis();
  return {
    active: cards.filter((card) => card.status === "active").sort(byEnd),
    upcoming: cards
      .filter((card) => card.status === "upcoming")
      .sort((a, b) => a.league.startsAt.toMillis() - b.league.startsAt.toMillis()),
    awaitingApproval,
    finished: cards.filter((card) => card.status === "finished").sort((a, b) => -byEnd(a, b)),
  };
}

export interface InvitePreview {
  league: League;
  status: LeagueStatus;
  memberCount: number;
  ownerName: string;
  viewer: "member" | "removed" | "pending" | "none";
}

/** What the invite link page shows before joining. Null for an unknown code. */
export async function loadInvitePreview(
  db: Executor,
  input: { inviteCode: string; userId: string; now: DateTime },
): Promise<InvitePreview | null> {
  const league = await loadLeagueByInviteCode(db, input.inviteCode);
  if (!league) return null;
  const members = await db
    .select({ userId: leagueMembers.userId, removedAt: leagueMembers.removedAt })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, league.id));
  const [owner] = await db
    .select({ name: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, league.ownerId));
  const mine = members.find((member) => member.userId === input.userId);
  const [pending] = await db
    .select({ id: leagueJoinRequests.id })
    .from(leagueJoinRequests)
    .where(
      and(
        eq(leagueJoinRequests.leagueId, league.id),
        eq(leagueJoinRequests.userId, input.userId),
        eq(leagueJoinRequests.status, "pending"),
      ),
    );
  return {
    league,
    status: deriveLeagueStatus(league, input.now),
    memberCount: members.filter((member) => member.removedAt === null).length,
    ownerName: owner?.name ?? "",
    viewer: mine ? (mine.removedAt ? "removed" : "member") : pending ? "pending" : "none",
  };
}

export interface JoinRequestView {
  requestId: string;
  userId: string;
  displayName: string;
  requestedAt: DateTime;
}

/** Pending join requests for a league, oldest first (for the owner's banner). */
export async function loadPendingJoinRequests(
  db: Executor,
  leagueId: string,
): Promise<JoinRequestView[]> {
  const rows = await db
    .select({
      requestId: leagueJoinRequests.id,
      userId: leagueJoinRequests.userId,
      displayName: profiles.displayName,
      requestedAt: leagueJoinRequests.requestedAt,
    })
    .from(leagueJoinRequests)
    .innerJoin(profiles, eq(profiles.id, leagueJoinRequests.userId))
    .where(and(eq(leagueJoinRequests.leagueId, leagueId), eq(leagueJoinRequests.status, "pending")))
    .orderBy(leagueJoinRequests.requestedAt);
  return rows.map((row) => ({ ...row, requestedAt: toDateTime(row.requestedAt) }));
}
