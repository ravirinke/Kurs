import {
  type Decimal,
  deriveLeagueStatus,
  type Instrument,
  type Money,
  resolvePortfolioAccess,
  type TradeEvent,
  visibleEvents,
} from "@aksjeliga/core";
import type { DateTime } from "luxon";

import type { Executor } from "../client";
import { must } from "../must";
import { loadLeague } from "../repositories/leagues";
import { loadInstruments } from "../repositories/reference";

import { loadActiveMembers, loadLeagueEvents } from "./leaderboard";

export interface ActivityItem {
  id: string;
  at: DateTime;
  memberId: string;
  displayName: string;
  isOwn: boolean;
  side: "buy" | "sell";
  instrument: Instrument;
  quantity: Decimal;
  price: Money;
}

type PendingItem = Omit<ActivityItem, "instrument"> & { instrumentId: string };

export interface ActivityView {
  items: ActivityItem[];
  /** Set when others' trades are only shown up to this time (delayed visibility). */
  delayedUntil: DateTime | null;
  /** True when others' trades are not shown at all (hidden visibility). */
  othersHidden: boolean;
}

/** Recent trades in the league, as the viewer may see them. Null if not a member. */
export async function loadActivity(
  db: Executor,
  input: { leagueId: string; viewerUserId: string; now: DateTime; limit?: number },
): Promise<ActivityView | null> {
  const league = await loadLeague(db, input.leagueId);
  if (!league) return null;
  const members = await loadActiveMembers(db, league.id);
  const viewer = members.find((member) => member.userId === input.viewerUserId);
  if (!viewer) return null;

  const events = await loadLeagueEvents(db, league);
  const leagueStatus = deriveLeagueStatus(league, input.now);
  const items: PendingItem[] = [];
  const instrumentIds = new Set<string>();
  let delayedUntil: DateTime | null = null;
  let othersHidden = false;

  for (const member of members) {
    const access = resolvePortfolioAccess({
      visibility: league.visibility,
      leagueStatus,
      viewerIsMember: true,
      viewerMemberId: viewer.memberId,
      targetMemberId: member.memberId,
      now: input.now,
    });
    if (access.kind === "delayed") delayedUntil = access.asOf;
    if (access.kind === "returnOnly") othersHidden = true;
    const trades = visibleEvents(events.get(member.memberId) ?? [], access).filter(
      (event): event is TradeEvent => event.type === "buy" || event.type === "sell",
    );
    for (const trade of trades) {
      instrumentIds.add(trade.instrumentId);
      items.push({
        id: trade.id,
        at: trade.at,
        memberId: member.memberId,
        displayName: member.displayName,
        isOwn: member.memberId === viewer.memberId,
        side: trade.type,
        quantity: trade.quantity,
        price: trade.price,
        instrumentId: trade.instrumentId,
      });
    }
  }

  const instruments = new Map(
    (await loadInstruments(db, [...instrumentIds])).map((instrument) => [
      instrument.id,
      instrument,
    ]),
  );
  const sorted = items
    .sort((a, b) => b.at.toMillis() - a.at.toMillis())
    .slice(0, input.limit ?? 50)
    .map(({ instrumentId, ...item }) => ({
      ...item,
      instrument: must(instruments.get(instrumentId), "instrument"),
    }));
  return { items: sorted, delayedUntil, othersHidden };
}
