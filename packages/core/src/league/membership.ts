import type { DateTime } from "luxon";

import type { DepositEvent } from "../ledger";

import { deriveLeagueStatus } from "./status";
import type { League } from "./types";

export type JoinRejection =
  | { code: "ALREADY_MEMBER" }
  | { code: "LEAGUE_FINISHED" }
  | { code: "LATE_JOIN_DISABLED" }
  | { code: "LEAGUE_FULL"; maxMembers: number };

export interface JoinContext {
  league: Pick<League, "startsAt" | "endsAt" | "lateJoinAllowed" | "maxMembers">;
  memberCount: number;
  isAlreadyMember: boolean;
  now: DateTime;
}

export function checkJoin(context: JoinContext): JoinRejection[] {
  const { league, memberCount, isAlreadyMember, now } = context;
  if (isAlreadyMember) return [{ code: "ALREADY_MEMBER" }];

  const status = deriveLeagueStatus(league, now);
  if (status === "finished") return [{ code: "LEAGUE_FINISHED" }];

  const rejections: JoinRejection[] = [];
  if (status === "active" && !league.lateJoinAllowed)
    rejections.push({ code: "LATE_JOIN_DISABLED" });
  if (memberCount >= league.maxMembers)
    rejections.push({ code: "LEAGUE_FULL", maxMembers: league.maxMembers });
  return rejections;
}

/** Every member, also a late one, starts with the full start amount. */
export function startingDeposit(
  league: Pick<League, "startAmount">,
  eventId: string,
  joinedAt: DateTime,
): DepositEvent {
  return { id: eventId, type: "deposit", at: joinedAt, amount: league.startAmount };
}
