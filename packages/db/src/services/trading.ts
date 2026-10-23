import { randomUUID } from "node:crypto";

import {
  buildQuote,
  type Currency,
  deriveLeagueStatus,
  executeQuote,
  type Instrument,
  type LedgerState,
  type Money,
  type Order,
  type PriceProvider,
  type Quote,
  replay,
  resolveMarks,
  type TradeContext,
  type TradeRejection,
  validateOrder,
  validateTrade,
  valuePortfolio,
} from "@aksjeliga/core";
import { and, eq } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Database, Executor } from "../client";
import { quoteToRow, toDbTime, toQuote } from "../mappers";
import { findMember, loadLeague, lockMember } from "../repositories/leagues";
import { appendEvent, loadMemberEvents, writeMemberCache } from "../repositories/ledger";
import { loadInstrument, loadInstruments } from "../repositories/reference";
import { quotes, transactions } from "../schema";

/** Rejections that come from the service layer rather than the trading rules. */
export type ServiceRejection =
  | { code: "NOT_A_MEMBER" }
  | { code: "INSTRUMENT_NOT_FOUND" }
  | { code: "QUOTE_NOT_FOUND" }
  | { code: "QUOTE_ALREADY_USED" }
  | { code: "IDEMPOTENCY_KEY_REUSED" };

export type TradingRejection = TradeRejection | ServiceRejection;

/** Portfolio value at an instant, for the max-position-share rule. */
async function portfolioValueAt(
  db: Executor,
  provider: PriceProvider,
  state: LedgerState,
  currency: Currency,
  at: DateTime,
): Promise<Money> {
  const held: Instrument[] = await loadInstruments(db, [...state.positions.keys()]);
  const marks = await resolveMarks(provider, held, currency, at);
  return valuePortfolio(state, marks).totalValue;
}

async function tradeContext(
  db: Executor,
  provider: PriceProvider,
  input: {
    quote: Quote;
    instrument: Instrument;
    state: LedgerState;
    leagueId: string;
    now: DateTime;
  },
): Promise<TradeContext> {
  const league = await loadLeague(db, input.leagueId);
  if (!league) throw new Error(`League ${input.leagueId} not found`);
  const needsValue = input.quote.side === "buy" && league.maxPositionShare !== null;
  return {
    quote: input.quote,
    instrument: input.instrument,
    rules: {
      leagueStatus: deriveLeagueStatus(league, input.now),
      allowedExchangeIds: league.allowedExchangeIds,
      maxPositionShare: league.maxPositionShare,
    },
    marketStatus: await provider.getMarketStatus(input.instrument.exchangeId, input.now),
    ledger: input.state,
    portfolioValue: needsValue
      ? await portfolioValueAt(db, provider, input.state, league.currency, input.quote.createdAt)
      : input.state.cash,
    now: input.now,
  };
}

export type CreateQuoteResult =
  { ok: true; quote: Quote } | { ok: false; rejections: TradingRejection[] };

/**
 * Step 1 of a trade: the server prices the order and locks the price for 30 seconds.
 * The client sends only instrument, side and quantity.
 */
export async function createQuote(
  db: Database,
  provider: PriceProvider,
  input: { userId: string; leagueId: string; order: Order; now: DateTime },
): Promise<CreateQuoteResult> {
  const { order, now } = input;
  const orderCheck = validateOrder(order);
  if (!orderCheck.ok) return orderCheck;

  const member = await findMember(db, input.leagueId, input.userId);
  if (!member || member.removedAt) return { ok: false, rejections: [{ code: "NOT_A_MEMBER" }] };
  const league = await loadLeague(db, input.leagueId);
  if (!league) return { ok: false, rejections: [{ code: "NOT_A_MEMBER" }] };
  const instrument = await loadInstrument(db, order.instrumentId);
  if (!instrument) return { ok: false, rejections: [{ code: "INSTRUMENT_NOT_FOUND" }] };

  const [price, rate] = await Promise.all([
    provider.getQuote(instrument.id, now),
    provider.getFxRate(instrument.currency, league.currency, now),
  ]);
  const quote = buildQuote({
    id: randomUUID(),
    leagueId: league.id,
    memberId: member.id,
    order,
    instrument,
    marketPrice: price.price,
    marketFxRate: rate,
    feeRule: league.feeRule,
    now,
  });

  const state = replay(league.currency, await loadMemberEvents(db, member.id, league.currency));
  const validation = validateTrade(
    await tradeContext(db, provider, { quote, instrument, state, leagueId: league.id, now }),
  );
  if (!validation.ok) return validation;

  await db.insert(quotes).values(quoteToRow(quote));
  return { ok: true, quote };
}

export type ExecuteTradeResult =
  | { ok: true; transactionId: string; replayed: boolean; quote: Quote }
  | { ok: false; rejections: TradingRejection[] };

/**
 * Step 2: executes a quote at exactly its locked price, atomically.
 *
 * In one database transaction it locks the member row (SELECT … FOR UPDATE), so concurrent
 * trades by the same member run one after the other and the second sees the first one's
 * effect on cash. The idempotency key makes a retried or double-clicked request return the
 * original result instead of trading twice.
 */
export async function executeTrade(
  db: Database,
  provider: PriceProvider,
  input: { userId: string; quoteId: string; idempotencyKey: string; now: DateTime },
): Promise<ExecuteTradeResult> {
  return db.transaction(async (tx) => {
    const [unlocked] = await tx.select().from(quotes).where(eq(quotes.id, input.quoteId));
    if (!unlocked) return { ok: false, rejections: [{ code: "QUOTE_NOT_FOUND" }] };

    // Lock order is always member, then quote: no deadlocks between concurrent trades.
    const member = await lockMember(tx, unlocked.memberId);
    if (member?.userId !== input.userId)
      return { ok: false, rejections: [{ code: "QUOTE_NOT_FOUND" }] };
    if (member.removedAt) return { ok: false, rejections: [{ code: "NOT_A_MEMBER" }] };

    const [previous] = await tx
      .select({ id: transactions.id, quoteId: transactions.quoteId })
      .from(transactions)
      .where(
        and(
          eq(transactions.memberId, member.id),
          eq(transactions.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (previous) {
      if (previous.quoteId !== input.quoteId)
        return { ok: false, rejections: [{ code: "IDEMPOTENCY_KEY_REUSED" }] };
      // The quote of the original trade (the unlocked read above), for the receipt.
      const replayedLeague = await loadLeague(tx, unlocked.leagueId);
      if (!replayedLeague) return { ok: false, rejections: [{ code: "QUOTE_NOT_FOUND" }] };
      return {
        ok: true,
        transactionId: previous.id,
        replayed: true,
        quote: toQuote(unlocked, replayedLeague.currency),
      };
    }

    const [row] = await tx.select().from(quotes).where(eq(quotes.id, input.quoteId)).for("update");
    if (!row) return { ok: false, rejections: [{ code: "QUOTE_NOT_FOUND" }] };
    if (row.usedAt) return { ok: false, rejections: [{ code: "QUOTE_ALREADY_USED" }] };

    const league = await loadLeague(tx, row.leagueId);
    const instrument = await loadInstrument(tx, row.instrumentId);
    if (!league || !instrument) return { ok: false, rejections: [{ code: "QUOTE_NOT_FOUND" }] };

    const quote = toQuote(row, league.currency);
    const events = await loadMemberEvents(tx, member.id, league.currency);
    const state = replay(league.currency, events);
    const validation = validateTrade(
      await tradeContext(tx, provider, {
        quote,
        instrument,
        state,
        leagueId: league.id,
        now: input.now,
      }),
    );
    if (!validation.ok) return validation;

    const event = executeQuote(quote, randomUUID(), input.now);
    await appendEvent(tx, event, {
      leagueId: league.id,
      memberId: member.id,
      idempotencyKey: input.idempotencyKey,
    });
    await tx
      .update(quotes)
      .set({ usedAt: toDbTime(input.now) })
      .where(eq(quotes.id, quote.id));
    await writeMemberCache(tx, member.id, replay(league.currency, [...events, event]));

    return { ok: true, transactionId: event.id, replayed: false, quote };
  });
}
