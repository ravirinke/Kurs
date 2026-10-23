import { type Currency, type LedgerEvent, type LedgerState, replay } from "@aksjeliga/core";
import { asc, eq } from "drizzle-orm";

import type { Executor } from "../client";
import { eventToRow, rowToEvent, toDbTime, toNumeric } from "../mappers";
import { holdings, leagueMembers, transactions } from "../schema";

/** All of a member's events, in the order they happened. */
export async function loadMemberEvents(
  db: Executor,
  memberId: string,
  currency: Currency,
): Promise<LedgerEvent[]> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.memberId, memberId))
    .orderBy(asc(transactions.occurredAt), asc(transactions.sequence));
  return rows.map((row) => rowToEvent(row, currency));
}

export async function appendEvent(
  db: Executor,
  event: LedgerEvent,
  context: { leagueId: string; memberId: string; idempotencyKey?: string },
): Promise<void> {
  await db.insert(transactions).values(eventToRow(event, context));
}

/** Writes the cached cash, last trade time and holdings for a member from a ledger state. */
export async function writeMemberCache(
  db: Executor,
  memberId: string,
  state: LedgerState,
): Promise<void> {
  await db
    .update(leagueMembers)
    .set({
      cashBalance: toNumeric(state.cash.round().amount),
      lastTradeAt: state.lastTradeAt ? toDbTime(state.lastTradeAt) : null,
    })
    .where(eq(leagueMembers.id, memberId));

  await db.delete(holdings).where(eq(holdings.memberId, memberId));
  const rows = [...state.positions.values()].map((position) => ({
    memberId,
    instrumentId: position.instrumentId,
    quantity: toNumeric(position.quantity),
    costBasis: toNumeric(position.costBasis.amount),
  }));
  if (rows.length > 0) await db.insert(holdings).values(rows);
}

/**
 * Rebuilds a member's cash and holdings from their transactions alone. The cache can be
 * thrown away at any time; this brings it back.
 */
export async function rebuildMemberCache(
  db: Executor,
  memberId: string,
  currency: Currency,
): Promise<LedgerState> {
  const state = replay(currency, await loadMemberEvents(db, memberId, currency));
  await writeMemberCache(db, memberId, state);
  return state;
}
