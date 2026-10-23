import { randomUUID } from "node:crypto";

import { decimal } from "@aksjeliga/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { executeTrade, rebuildMemberCache, schema } from "../src";

import {
  connect,
  createTestLeague,
  createTestUser,
  databaseError,
  memberRow,
  provider,
  quoteFor,
  T,
} from "./helpers";

const { db, close } = connect();
afterAll(close);

async function memberWithTrades() {
  const userId = await createTestUser(db, "Ledger");
  const { leagueId, memberId } = await createTestLeague(db, userId);
  const prices = await provider(db);
  for (const [ticker, quantity, side] of [
    ["EQNR", "50", "buy"],
    ["AAPL", "8", "buy"],
    ["EQNR", "20", "sell"],
    ["VOLV B", "30", "buy"],
  ] as const) {
    const quote = await quoteFor(db, prices, { userId, leagueId, ticker, quantity, side });
    const result = await executeTrade(db, prices, {
      userId,
      quoteId: quote.id,
      idempotencyKey: randomUUID(),
      now: T.plus({ seconds: 1 }),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));
  }
  return { leagueId, memberId };
}

async function firstTransactionId(memberId: string) {
  const [row] = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(eq(schema.transactions.memberId, memberId));
  return row!.id;
}

async function holdingsOf(memberId: string) {
  return (await db.select().from(schema.holdings).where(eq(schema.holdings.memberId, memberId)))
    .map((row) => ({
      instrumentId: row.instrumentId,
      quantity: row.quantity,
      costBasis: decimal(row.costBasis).toFixed(8),
    }))
    .sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
}

describe("transactions are immutable", () => {
  it("refuses UPDATE", async () => {
    const { memberId } = await memberWithTrades();
    const id = await firstTransactionId(memberId);
    const update = db
      .update(schema.transactions)
      .set({ amount: "999999" })
      .where(eq(schema.transactions.id, id));
    expect(await databaseError(update)).toMatch(/immutable/);
  });

  it("refuses DELETE", async () => {
    const { memberId } = await memberWithTrades();
    const id = await firstTransactionId(memberId);
    const remove = db.delete(schema.transactions).where(eq(schema.transactions.id, id));
    expect(await databaseError(remove)).toMatch(/immutable/);
  });

  it("refuses TRUNCATE", async () => {
    expect(await databaseError(db.execute(sql`truncate public.transactions cascade`))).toMatch(
      /immutable/,
    );
  });
});

describe("the database rejects values the rules forbid", () => {
  it("refuses an amount with more than 2 decimals instead of rounding it silently", async () => {
    const userId = await createTestUser(db, "Scale");
    const { leagueId, memberId } = await createTestLeague(db, userId);
    const insert = db.insert(schema.transactions).values({
      leagueId,
      memberId,
      type: "deposit",
      occurredAt: T.toJSDate(),
      amount: "100.005",
    });
    expect(await databaseError(insert)).toMatch(/amount_scale/);
  });

  it("refuses a negative cash balance", async () => {
    const userId = await createTestUser(db, "Negative");
    const { memberId } = await createTestLeague(db, userId);
    const update = db
      .update(schema.leagueMembers)
      .set({ cashBalance: "-0.01" })
      .where(eq(schema.leagueMembers.id, memberId));
    expect(await databaseError(update)).toMatch(/cash_not_negative/);
  });

  it("refuses a buy without the locked price and FX rate", async () => {
    const userId = await createTestUser(db, "Incomplete");
    const { leagueId, memberId } = await createTestLeague(db, userId);
    const insert = db
      .insert(schema.transactions)
      .values({ leagueId, memberId, type: "buy", occurredAt: T.toJSDate(), amount: "-100" });
    expect(await databaseError(insert)).toMatch(/trade_fields/);
  });
});

describe("the holdings cache can always be rebuilt from transactions", () => {
  it("rebuilds exactly the same cash and holdings after the cache is wiped", async () => {
    const { memberId } = await memberWithTrades();
    const before = {
      cash: (await memberRow(db, memberId)).cashBalance,
      holdings: await holdingsOf(memberId),
    };
    expect(before.holdings).toHaveLength(3);

    await db
      .update(schema.leagueMembers)
      .set({ cashBalance: "0", lastTradeAt: null })
      .where(eq(schema.leagueMembers.id, memberId));
    await db.delete(schema.holdings).where(eq(schema.holdings.memberId, memberId));

    await rebuildMemberCache(db, memberId, "NOK");
    const after = {
      cash: (await memberRow(db, memberId)).cashBalance,
      holdings: await holdingsOf(memberId),
    };
    expect(after).toEqual(before);
    expect((await memberRow(db, memberId)).lastTradeAt).not.toBeNull();
  });

  it("cash equals the sum of all transaction amounts", async () => {
    const { memberId } = await memberWithTrades();
    const [sum] = await db
      .select({ total: sql<string>`sum(${schema.transactions.amount})` })
      .from(schema.transactions)
      .where(eq(schema.transactions.memberId, memberId));
    expect(decimal(sum!.total).equals(decimal((await memberRow(db, memberId)).cashBalance))).toBe(
      true,
    );
  });
});
