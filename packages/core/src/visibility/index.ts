import type { DateTime } from "luxon";

import type { LedgerEvent } from "../ledger";
import type { LeagueStatus, Visibility } from "../league/types";

export const DELAYED_VISIBILITY_HOURS = 24;

/**
 * What a viewer may see of a member's portfolio:
 * - none: not a member of the league.
 * - full: holdings and trades as they are now.
 * - delayed: holdings and trades as they were at `asOf`.
 * - returnOnly: only the return (and rank), no holdings or trades.
 *
 * Returns and ranks on the leaderboard are always live for members.
 */
export type PortfolioAccess =
  | { kind: "none" }
  | { kind: "full" }
  | { kind: "delayed"; asOf: DateTime }
  | { kind: "returnOnly" };

export interface VisibilityContext {
  visibility: Visibility;
  leagueStatus: LeagueStatus;
  viewerIsMember: boolean;
  viewerMemberId: string | null;
  targetMemberId: string;
  now: DateTime;
}

/**
 * THE visibility rule. Enforced on the server and mirrored by RLS in the database;
 * the UI only reflects it.
 */
export function resolvePortfolioAccess(context: VisibilityContext): PortfolioAccess {
  if (!context.viewerIsMember) return { kind: "none" };
  if (context.viewerMemberId === context.targetMemberId) return { kind: "full" };
  if (context.leagueStatus === "finished") return { kind: "full" };

  switch (context.visibility) {
    case "open":
      return { kind: "full" };
    case "delayed":
      return { kind: "delayed", asOf: context.now.minus({ hours: DELAYED_VISIBILITY_HOURS }) };
    case "hidden":
      return { kind: "returnOnly" };
  }
}

/** The events a viewer may see, given their access. */
export function visibleEvents<E extends LedgerEvent>(
  events: readonly E[],
  access: PortfolioAccess,
): E[] {
  switch (access.kind) {
    case "full":
      return [...events];
    case "delayed":
      return events.filter((event) => event.at.toMillis() <= access.asOf.toMillis());
    case "none":
    case "returnOnly":
      return [];
  }
}

export function canSeeHoldings(access: PortfolioAccess): boolean {
  return access.kind === "full" || access.kind === "delayed";
}
