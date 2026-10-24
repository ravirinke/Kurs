import { randomUUID } from "node:crypto";

import {
  convert,
  type CorporateAction,
  decimal,
  EXCHANGES,
  fixedClock,
  instant,
  lockFxRate,
  Money,
  type PriceProvider,
  replayUntil,
  startOfExchangeDay,
  type TradeSide,
} from "@aksjeliga/core";
import { and, eq } from "drizzle-orm";
import type { DateTime } from "luxon";
import { afterAll, describe, expect, it } from "vitest";

import {
  createMockPriceProvider,
  createQuote,
  executeTrade,
  finalizeLeagueIfDue,
  loadLeaderboard,
  loadLeagueEvents,
  processCorporateActions,
  schema,
  takeDailySnapshots,
  valueStates,
} from "../src";

import {
  addTestMember,
  connect,
  createTestLeague,
  createTestUser,
  instrumentId,
  memberRow,
  T,
} from "./helpers";

const { db, close } = connect();
afterAll(close);

const NASDAQ = EXCHANGES.find((exchange) => exchange.id === "XNAS")!;
/** Thursday 29 Oct 2026, 06:30 in Oslo: when the daily run happens. */
const THURSDAY_RUN = instant("2026-10-29T05:30:00Z");

function prices(now: DateTime, corporateActions: CorporateAction[] = []): Promise<PriceProvider> {
  return createMockPriceProvider(db, { clock: fixedClock(now), corporateActions });
}

async function trade(
  provider: PriceProvider,
  input: {
    userId: string;
    leagueId: string;
    ticker: string;
    quantity: string;
    side?: TradeSide;
    at?: DateTime;
  },
) {
  const at = input.at ?? T;
  const quote = await createQuote(db, provider, {
    userId: input.userId,
    leagueId: input.leagueId,
    order: {
      type: "market",
      side: input.side ?? "buy",
      instrumentId: await instrumentId(db, input.ticker),
      quantity: decimal(input.quantity),
    },
    now: at,
  });
  if (!quote.ok) return quote;
  return executeTrade(db, provider, {
    userId: input.userId,
    quoteId: quote.quote.id,
    idempotencyKey: randomUUID(),
    now: at.plus({ seconds: 1 }),
  });
}

async function mustTrade(provider: PriceProvider, input: Parameters<typeof trade>[1]) {
  const result = await trade(provider, input);
  if (!result.ok) throw new Error(JSON.stringify(result.rejections));
}

async function split(ticker: string, effectiveDate: string, from: string, to: string) {
  return {
    kind: "split",
    id: randomUUID(),
    instrumentId: await instrumentId(db, ticker),
    effectiveDate,
    ratioFrom: decimal(from),
    ratioTo: decimal(to),
  } satisfies CorporateAction;
}

async function dividend(ticker: string, exDate: string, payDate: string, amount: Money) {
  return {
    kind: "dividend",
    id: randomUUID(),
    instrumentId: await instrumentId(db, ticker),
    exDate,
    payDate,
    amountPerShare: amount,
  } satisfies CorporateAction;
}

async function transactionsOf(memberId: string, type: "split" | "dividend") {
  return db
    .select()
    .from(schema.transactions)
    .where(and(eq(schema.transactions.memberId, memberId), eq(schema.transactions.type, type)));
}

async function holding(memberId: string, ticker: string) {
  const [row] = await db
    .select()
    .from(schema.holdings)
    .where(
      and(
        eq(schema.holdings.memberId, memberId),
        eq(schema.holdings.instrumentId, await instrumentId(db, ticker)),
      ),
    );
  return row?.quantity ?? "0";
}

/** A member's portfolio value at an instant, from the ledger alone. */
async function valueAt(leagueId: string, memberId: string, at: DateTime, provider: PriceProvider) {
  const events = await loadLeagueEvents(db, { id: leagueId, currency: "NOK" });
  const state = replayUntil("NOK", events.get(memberId) ?? [], at);
  return (await valueStates(db, provider, "NOK", [state], at)).values[0]!;
}

describe("corporate actions job", () => {
  it("books a 10:1 split once: ten times the shares, same value", async () => {
    const userId = await createTestUser(db, "Splitt");
    const { leagueId, memberId } = await createTestLeague(db, userId);
    await mustTrade(await prices(T), { userId, leagueId, ticker: "AAPL", quantity: "10" });
    const action = await split("AAPL", "2026-10-28", "1", "10");
    const provider = await prices(THURSDAY_RUN, [action]);

    const first = await processCorporateActions(db, provider, {
      now: THURSDAY_RUN,
      leagueIds: [leagueId],
    });
    const again = await processCorporateActions(db, provider, {
      now: THURSDAY_RUN,
      leagueIds: [leagueId],
    });

    expect(first.booked).toBe(1);
    expect(again.booked).toBe(0);
    expect(await transactionsOf(memberId, "split")).toHaveLength(1);
    expect(await holding(memberId, "AAPL")).toBe("100");
    const effective = startOfExchangeDay(NASDAQ, "2026-10-28");
    const before = await valueAt(
      leagueId,
      memberId,
      effective.minus({ milliseconds: 1 }),
      provider,
    );
    const after = await valueAt(leagueId, memberId, effective, provider);
    expect(after.amount.toFixed(2)).toBe(before.amount.toFixed(2));
  });

  it("pays a USD dividend in NOK to those who held the shares on the ex-date, on the pay date", async () => {
    const userId = await createTestUser(db, "Utbytte");
    const lateId = await createTestUser(db, "Sen");
    const { leagueId, memberId, inviteCode } = await createTestLeague(db, userId);
    const lateMemberId = await addTestMember(db, inviteCode, lateId);
    await mustTrade(await prices(T), { userId, leagueId, ticker: "AAPL", quantity: "10" });
    // Bought on the ex-date itself: too late for the dividend.
    const exDay = instant("2026-10-28T15:00:00Z");
    await mustTrade(await prices(exDay), {
      userId: lateId,
      leagueId,
      ticker: "AAPL",
      quantity: "10",
      at: exDay,
    });
    const action = await dividend("AAPL", "2026-10-28", "2026-10-30", Money.of("0.25", "USD"));

    const beforePayDay = await processCorporateActions(db, await prices(THURSDAY_RUN, [action]), {
      now: THURSDAY_RUN,
      leagueIds: [leagueId],
    });
    expect(beforePayDay.booked).toBe(0);

    const cashBefore = (await memberRow(db, memberId)).cashBalance;
    const saturday = instant("2026-10-31T05:30:00Z");
    const provider = await prices(saturday, [action]);
    const onPayDay = await processCorporateActions(db, provider, {
      now: saturday,
      leagueIds: [leagueId],
    });

    expect(onPayDay.booked).toBe(1);
    const payStart = startOfExchangeDay(NASDAQ, "2026-10-30");
    const rate = lockFxRate(await provider.getFxRate("USD", "NOK", payStart));
    const expected = convert(Money.of("2.5", "USD"), rate).round();
    const [row] = await transactionsOf(memberId, "dividend");
    expect(decimal(row?.amount ?? "0").toFixed(2)).toBe(expected.amount.toFixed(2));
    expect(row?.occurredAt.getTime()).toBe(payStart.toMillis());
    expect(decimal((await memberRow(db, memberId)).cashBalance).toFixed(2)).toBe(
      decimal(cashBefore).plus(expected.amount).toFixed(2),
    );
    expect(await transactionsOf(lateMemberId, "dividend")).toHaveLength(0);
  });

  it("books nothing in a league that ended before the pay date", async () => {
    const userId = await createTestUser(db, "Etterpå");
    const { leagueId, memberId } = await createTestLeague(db, userId, {
      endsAt: instant("2026-10-30T22:00:00Z"),
    });
    await mustTrade(await prices(T), { userId, leagueId, ticker: "AAPL", quantity: "10" });
    const action = await dividend("AAPL", "2026-10-29", "2026-11-02", Money.of("0.25", "USD"));
    const now = instant("2026-11-03T05:30:00Z");

    const report = await processCorporateActions(db, await prices(now, [action]), {
      now,
      leagueIds: [leagueId],
    });

    expect(report.booked).toBe(0);
    expect(await transactionsOf(memberId, "dividend")).toHaveLength(0);
  });

  it("books a split once even when two runs overlap", async () => {
    const userId = await createTestUser(db, "Samtidig");
    const { leagueId, memberId } = await createTestLeague(db, userId);
    await mustTrade(await prices(T), { userId, leagueId, ticker: "AAPL", quantity: "10" });
    const provider = await prices(THURSDAY_RUN, [await split("AAPL", "2026-10-28", "1", "4")]);

    const reports = await Promise.all(
      [1, 2, 3].map(() =>
        processCorporateActions(db, provider, { now: THURSDAY_RUN, leagueIds: [leagueId] }),
      ),
    );

    expect(reports.reduce((sum, report) => sum + report.booked, 0)).toBe(1);
    expect(await transactionsOf(memberId, "split")).toHaveLength(1);
    expect(await holding(memberId, "AAPL")).toBe("40");
  });
});

describe("trading while a split waits to be booked", () => {
  it("rejects holders until the job has booked it, and lets others trade", async () => {
    const userId = await createTestUser(db, "Venter");
    const otherId = await createTestUser(db, "Annen");
    const { leagueId, inviteCode } = await createTestLeague(db, userId);
    await addTestMember(db, inviteCode, otherId);
    await mustTrade(await prices(T), { userId, leagueId, ticker: "AAPL", quantity: "10" });
    const action = await split("AAPL", "2026-10-28", "1", "10");
    const wednesday = instant("2026-10-28T15:00:00Z");
    const provider = await prices(wednesday, [action]);

    const blocked = await trade(provider, {
      userId,
      leagueId,
      ticker: "AAPL",
      quantity: "5",
      side: "sell",
      at: wednesday,
    });
    expect(blocked).toEqual({ ok: false, rejections: [{ code: "SPLIT_PENDING" }] });
    const other = await trade(provider, {
      userId: otherId,
      leagueId,
      ticker: "AAPL",
      quantity: "5",
      at: wednesday,
    });
    expect(other.ok).toBe(true);

    await processCorporateActions(db, provider, { now: wednesday, leagueIds: [leagueId] });
    const allowed = await trade(provider, {
      userId,
      leagueId,
      ticker: "AAPL",
      quantity: "5",
      side: "sell",
      at: wednesday,
    });
    expect(allowed.ok).toBe(true);
  });
});

describe("finalization job", () => {
  const ENDS = instant("2026-10-30T22:00:00Z");
  const SATURDAY = instant("2026-10-31T05:30:00Z");

  it("stores ranks, values and shared winners once, valued at the end time", async () => {
    const ownerId = await createTestUser(db, "Eier");
    const bId = await createTestUser(db, "Bente");
    const cId = await createTestUser(db, "Carl");
    const { leagueId, memberId, inviteCode } = await createTestLeague(db, ownerId, {
      endsAt: ENDS,
    });
    const bMember = await addTestMember(db, inviteCode, bId);
    const cMember = await addTestMember(db, inviteCode, cId);
    // The owner buys and sells at once: only the brokerage is lost, so they end last.
    const provider = await prices(T);
    await mustTrade(provider, { userId: ownerId, leagueId, ticker: "EQNR", quantity: "10" });
    await mustTrade(provider, {
      userId: ownerId,
      leagueId,
      ticker: "EQNR",
      quantity: "10",
      side: "sell",
    });

    const early = await finalizeLeagueIfDue(db, await prices(T), { leagueId, now: T });
    const done = await finalizeLeagueIfDue(db, await prices(SATURDAY), {
      leagueId,
      now: SATURDAY,
    });
    const [league] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId));
    const later = instant("2026-11-10T12:00:00Z");
    const again = await finalizeLeagueIfDue(db, await prices(later), { leagueId, now: later });

    expect(early).toBe(false);
    expect(done).toBe(true);
    expect(again).toBe(false);
    const [owner, b, c] = await Promise.all(
      [memberId, bMember, cMember].map((id) => memberRow(db, id)),
    );
    expect([b?.finalRank, c?.finalRank, owner?.finalRank]).toEqual([1, 1, 3]);
    expect([b?.isWinner, c?.isWinner, owner?.isWinner]).toEqual([true, true, false]);
    expect(decimal(b?.finalValue ?? "0").toFixed(2)).toBe("100000.00");
    expect(decimal(b?.finalReturn ?? "1").isZero()).toBe(true);
    expect(decimal(owner?.finalReturn ?? "0").isNegative()).toBe(true);
    const [unchanged] = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId));
    expect(unchanged?.finalizedAt).toEqual(league?.finalizedAt);
    expect(league?.finalizedAt?.getTime()).toBe(SATURDAY.toMillis());

    const board = await loadLeaderboard(db, await prices(later), leagueId, later);
    expect(board?.isFinal).toBe(true);
    expect(
      board?.rows
        .filter((row) => row.isWinner)
        .map((row) => row.displayName)
        .sort(),
    ).toEqual(["Bente", "Carl"]);
  });

  it("books a split that took effect before the end before freezing the result", async () => {
    const userId = await createTestUser(db, "Frys");
    const { leagueId, memberId } = await createTestLeague(db, userId, { endsAt: ENDS });
    await mustTrade(await prices(T), { userId, leagueId, ticker: "AAPL", quantity: "10" });
    const action = await split("AAPL", "2026-10-28", "1", "10");
    const provider = await prices(SATURDAY, [action]);

    await finalizeLeagueIfDue(db, provider, { leagueId, now: SATURDAY });

    expect(await transactionsOf(memberId, "split")).toHaveLength(1);
    const final = decimal((await memberRow(db, memberId)).finalValue ?? "0");
    expect(final.toFixed(2)).toBe(
      (await valueAt(leagueId, memberId, ENDS, provider)).amount.toFixed(2),
    );
  });
});

describe("snapshot job", () => {
  it("stores one snapshot per member per finished day, fills missed days, never twice", async () => {
    const userId = await createTestUser(db, "Snapshot");
    const { leagueId, memberId } = await createTestLeague(db, userId);
    await mustTrade(await prices(T), { userId, leagueId, ticker: "EQNR", quantity: "10" });

    // Wednesday morning: Monday 26 and Tuesday 27 are over.
    const wednesday = instant("2026-10-28T05:30:00Z");
    const first = await takeDailySnapshots(db, await prices(wednesday), {
      now: wednesday,
      leagueIds: [leagueId],
    });
    const repeat = await takeDailySnapshots(db, await prices(wednesday), {
      now: wednesday,
      leagueIds: [leagueId],
    });
    // Friday morning, a day missed: Wednesday and Thursday are filled in.
    const friday = instant("2026-10-30T05:30:00Z");
    const later = await takeDailySnapshots(db, await prices(friday), {
      now: friday,
      leagueIds: [leagueId],
    });

    expect([first.taken, repeat.taken, later.taken]).toEqual([2, 0, 2]);
    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.memberId, memberId))
      .orderBy(schema.portfolioSnapshots.date);
    expect(rows.map((row) => row.date)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
    ]);
    expect(decimal(rows[0]?.value ?? "0").toFixed(2)).toBe("100000.00");
    const endOfTuesday = instant("2026-10-27T23:00:00Z");
    expect(decimal(rows[1]?.value ?? "0").toFixed(2)).toBe(
      (await valueAt(leagueId, memberId, endOfTuesday, await prices(friday))).amount.toFixed(2),
    );
  });
});
