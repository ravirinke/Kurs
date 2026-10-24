import { randomUUID } from "node:crypto";

import {
  computeDividendEvent,
  computeSplitEvent,
  type CorporateAction,
  type Exchange,
  type Instrument,
  type League,
  type LedgerEvent,
  lockFxRate,
  type PriceProvider,
  quantityHeldBefore,
  startOfExchangeDay,
} from "@aksjeliga/core";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Database } from "../client";
import { toDbTime } from "../mappers";
import { must } from "../must";
import {
  markCorporateActionsProcessed,
  type StoredCorporateAction,
  storeCorporateActions,
} from "../repositories/corporate-actions";
import { lockMember } from "../repositories/leagues";
import { appendEvent, loadMemberEvents, rebuildMemberCache } from "../repositories/ledger";
import { loadExchanges, loadInstruments } from "../repositories/reference";
import { leagues, transactions } from "../schema";
import { loadActiveMembers } from "../services/leaderboard";

import { type JobScope, leaguesForJob } from "./scope";

/** How far back each run asks the provider, so a missed run (or a late report) is caught up. */
export const CORPORATE_ACTION_LOOKBACK_DAYS = 60;

export interface CorporateActionReport {
  /** Actions the provider reported in the lookback window. */
  reported: number;
  /** Transactions written in this run (one per member per action). */
  booked: number;
}

/** When an action takes effect, and the instant that decides who is entitled. */
export function corporateActionTimes(
  action: CorporateAction,
  exchange: Exchange,
): { dueAt: DateTime; entitledAt: DateTime } {
  if (action.kind === "split") {
    const dueAt = startOfExchangeDay(exchange, action.effectiveDate);
    return { dueAt, entitledAt: dueAt };
  }
  return {
    dueAt: startOfExchangeDay(exchange, action.payDate),
    entitledAt: startOfExchangeDay(exchange, action.exDate),
  };
}

/** The action is booked (or nothing was due) for this member. */
export function hasBooked(events: readonly LedgerEvent[], corporateActionId: string): boolean {
  return events.some(
    (event) =>
      (event.type === "split" || event.type === "dividend") &&
      event.corporateActionId === corporateActionId,
  );
}

/**
 * Asks the provider for splits and dividends in every instrument traded in a running (or
 * recently ended) league, stores them, and books the ones that are due.
 *
 * Idempotent: each member gets at most one transaction per action (the member row is locked,
 * like a trade, and a unique index backs it up). A split is booked at the start of its
 * effective date and a dividend at the start of its pay date, even if the job runs later,
 * so the ledger looks as if it had run on time. Actions due after a league's end are not
 * booked in that league: its result is frozen at the end.
 */
export async function processCorporateActions(
  db: Database,
  provider: PriceProvider,
  input: { now: DateTime } & JobScope,
): Promise<CorporateActionReport> {
  const { now } = input;
  const from = now.minus({ days: CORPORATE_ACTION_LOOKBACK_DAYS });
  const candidates = await leaguesForJob(db, input, [
    lte(leagues.startsAt, toDbTime(now)),
    gt(leagues.endsAt, toDbTime(from)),
  ]);
  if (candidates.length === 0) return { reported: 0, booked: 0 };

  const traded = await db
    .selectDistinct({ instrumentId: transactions.instrumentId })
    .from(transactions)
    .where(
      and(
        inArray(
          transactions.leagueId,
          candidates.map((league) => league.id),
        ),
        eq(transactions.type, "buy"),
      ),
    );
  const instruments = await loadInstruments(
    db,
    traded.flatMap((row) => (row.instrumentId ? [row.instrumentId] : [])),
  );
  const reported = (
    await Promise.all(
      instruments.map((instrument) => provider.getCorporateActions(instrument.id, from, now)),
    )
  ).flat();
  const stored = await storeCorporateActions(db, reported);

  const exchanges = new Map((await loadExchanges(db)).map((exchange) => [exchange.id, exchange]));
  const instrumentsById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  let booked = 0;
  const done: string[] = [];
  for (const entry of stored.values()) {
    const instrument = must(instrumentsById.get(entry.action.instrumentId), "instrument");
    const exchange = must(exchanges.get(instrument.exchangeId), "exchange");
    const times = corporateActionTimes(entry.action, exchange);
    if (times.dueAt.toMillis() > now.toMillis()) continue;

    for (const league of candidates) {
      // Shares can only be held from the start; nothing counts once the league has ended.
      if (league.startsAt.toMillis() >= times.entitledAt.toMillis()) continue;
      if (times.dueAt.toMillis() >= league.endsAt.toMillis()) continue;
      for (const member of await loadActiveMembers(db, league.id)) {
        if (await bookForMember(db, provider, { entry, instrument, league, member, times }))
          booked += 1;
      }
    }
    // Scoped runs (one league, a test) have not looked at every league yet.
    if (!input.leagueIds) done.push(entry.action.id);
  }
  await markCorporateActionsProcessed(db, done, now);
  return { reported: reported.length, booked };
}

async function bookForMember(
  db: Database,
  provider: PriceProvider,
  input: {
    entry: StoredCorporateAction;
    instrument: Instrument;
    league: League;
    member: { memberId: string };
    times: { dueAt: DateTime; entitledAt: DateTime };
  },
): Promise<boolean> {
  const { entry, instrument, league, times } = input;
  const { action } = entry;
  return db.transaction(async (tx) => {
    // Same lock as a trade, so a trade and the job never see a half-updated member.
    const member = await lockMember(tx, input.member.memberId);
    if (!member || member.removedAt) return false;
    const events = await loadMemberEvents(tx, member.id, league.currency);
    if (hasBooked(events, action.id)) return false;
    const quantity = quantityHeldBefore(league.currency, events, instrument.id, times.entitledAt);
    if (!quantity.greaterThan(0)) return false;

    let event: LedgerEvent | null;
    if (action.kind === "split") {
      // The last close before the split, at the pre-split price.
      const close = await provider.getLastClose(
        instrument.id,
        times.dueAt.minus({ milliseconds: 1 }),
      );
      const rate = await provider.getFxRate(instrument.currency, league.currency, close.closedAt);
      event = computeSplitEvent({
        action,
        eventId: randomUUID(),
        at: times.dueAt,
        quantityBefore: quantity,
        lastClose: close.price,
        fxRate: lockFxRate(rate),
      });
    } else {
      const rate = await provider.getFxRate(
        action.amountPerShare.currency,
        league.currency,
        times.dueAt,
      );
      event = computeDividendEvent({
        action,
        eventId: randomUUID(),
        at: times.dueAt,
        quantityHeld: quantity,
        fxRate: lockFxRate(rate),
      });
    }
    if (!event) return false;

    await appendEvent(tx, event, { leagueId: league.id, memberId: member.id });
    // The event may lie before later trades, so rebuild from the ledger in order.
    await rebuildMemberCache(tx, member.id, league.currency);
    return true;
  });
}
