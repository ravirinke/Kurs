import type { DateTime } from "luxon";

import type { DepositEvent } from "../ledger";

import { deriveLeagueStatus } from "./status";
import type { League } from "./types";

/*
 * Joining (docs/decisions.md):
 * - Before the start, anyone with the invite joins directly.
 * - After the start, a join is a request the league owner must approve.
 * - Nobody can join, or be approved, once the league has finished.
 * There is no member limit.
 */

export type JoinRejection =
  { code: "ALREADY_MEMBER" } | { code: "ALREADY_REQUESTED" } | { code: "LEAGUE_FINISHED" };

export type JoinOutcome =
  | { ok: true; mode: "direct" }
  | { ok: true; mode: "needs_approval" }
  | { ok: false; rejection: JoinRejection };

export interface JoinContext {
  league: Pick<League, "startsAt" | "endsAt">;
  isAlreadyMember: boolean;
  hasPendingRequest: boolean;
  now: DateTime;
}

export function checkJoin(context: JoinContext): JoinOutcome {
  const { league, isAlreadyMember, hasPendingRequest, now } = context;
  if (isAlreadyMember) return { ok: false, rejection: { code: "ALREADY_MEMBER" } };

  const status = deriveLeagueStatus(league, now);
  if (status === "finished") return { ok: false, rejection: { code: "LEAGUE_FINISHED" } };
  if (status === "upcoming") return { ok: true, mode: "direct" };
  if (hasPendingRequest) return { ok: false, rejection: { code: "ALREADY_REQUESTED" } };
  return { ok: true, mode: "needs_approval" };
}

export type JoinRequestStatus = "pending" | "approved" | "declined";

export interface JoinRequest {
  id: string;
  leagueId: string;
  userId: string;
  requestedAt: DateTime;
  status: JoinRequestStatus;
  decidedAt: DateTime | null;
}

export type JoinDecisionRejection =
  { code: "NOT_OWNER" } | { code: "REQUEST_NOT_PENDING" } | { code: "LEAGUE_FINISHED" };

export interface JoinDecisionContext {
  league: Pick<League, "ownerId" | "startsAt" | "endsAt">;
  request: Pick<JoinRequest, "status">;
  deciderId: string;
  decision: "approve" | "decline";
  now: DateTime;
}

/** Only the owner decides, only once, and approvals stop when the league finishes. */
export function checkJoinDecision(context: JoinDecisionContext): JoinDecisionRejection | null {
  const { league, request, deciderId, decision, now } = context;
  if (deciderId !== league.ownerId) return { code: "NOT_OWNER" };
  if (request.status !== "pending") return { code: "REQUEST_NOT_PENDING" };
  if (decision === "approve" && deriveLeagueStatus(league, now) === "finished") {
    return { code: "LEAGUE_FINISHED" };
  }
  return null;
}

/**
 * Every member, also a late one, starts with the full start amount. For an approved late
 * join, `joinedAt` is the approval time.
 */
export function startingDeposit(
  league: Pick<League, "startAmount">,
  eventId: string,
  joinedAt: DateTime,
): DepositEvent {
  return { id: eventId, type: "deposit", at: joinedAt, amount: league.startAmount };
}
