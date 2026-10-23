import { randomUUID } from "node:crypto";

import { decimal, instant, type PriceProvider } from "@aksjeliga/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createQuote, executeTrade, schema } from "../src";

import {
  addTestMember,
  connect,
  createTestLeague,
  createTestUser,
  instrumentId,
  memberRow,
  provider,
  quoteFor,
  T,
} from "./helpers";

const { db, close } = connect(12);
let prices: PriceProvider;

beforeAll(async () => {
  prices = await provider(db);
});
afterAll(close);

async function freshMember(overrides: Parameters<typeof createTestLeague>[2] = {}) {
  const userId = await createTestUser(db, "Trader");
  const league = await createTestLeague(db, userId, overrides);
  return { userId, ...league };
}

function codes(result: { ok: boolean; rejections?: { code: string }[] }) {
  return result.ok ? [] : (result.rejections ?? []).map((rejection) => rejection.code);
}

async function tradeCount(memberId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.memberId, memberId),
        sql`${schema.transactions.type} in ('buy', 'sell')`,
      ),
    );
  return row?.count ?? 0;
}

describe("concurrency: the same money can never be spent twice", () => {
  it("two simultaneous buys that each need 60 % of the cash: one succeeds, one is rejected", async () => {
    const { userId, leagueId, memberId } = await freshMember();
    // ~230 × 265 NOK ≈ 61 000 of 100 000 each. Both quotes are valid on their own.
    const [first, second] = await Promise.all([
      quoteFor(db, prices, { userId, leagueId, ticker: "EQNR", quantity: "230" }),
      quoteFor(db, prices, { userId, leagueId, ticker: "EQNR", quantity: "230" }),
    ]);

    const results = await Promise.all(
      [first, second].map((quote) =>
        executeTrade(db, prices, {
          userId,
          quoteId: quote.id,
          idempotencyKey: randomUUID(),
          now: T.plus({ seconds: 2 }),
        }),
      ),
    );

    const succeeded = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    expect(succeeded).toHaveLength(1);
    expect(rejected.flatMap(codes)).toEqual(["INSUFFICIENT_CASH"]);

    const member = await memberRow(db, memberId);
    expect(decimal(member.cashBalance).toFixed(2)).toBe(
      decimal("100000").minus(first.totalAmount.amount).toFixed(2),
    );
    expect(await tradeCount(memberId)).toBe(1);
  });

  it("five simultaneous buys of ~30 % each: exactly three go through and cash stays ≥ 0", async () => {
    const { userId, leagueId, memberId } = await freshMember();
    const quotes = await Promise.all(
      Array.from({ length: 5 }, () =>
        quoteFor(db, prices, { userId, leagueId, ticker: "DNB", quantity: "125" }),
      ),
    );
    const totalEach = quotes[0]!.totalAmount.amount;
    expect(totalEach.greaterThan("25000") && totalEach.lessThan("33333")).toBe(true);

    const results = await Promise.all(
      quotes.map((quote) =>
        executeTrade(db, prices, {
          userId,
          quoteId: quote.id,
          idempotencyKey: randomUUID(),
          now: T.plus({ seconds: 2 }),
        }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(await tradeCount(memberId)).toBe(3);
    const cash = decimal((await memberRow(db, memberId)).cashBalance);
    expect(cash.isNegative()).toBe(false);
    expect(cash.toFixed(2)).toBe(decimal("100000").minus(totalEach.times(3)).toFixed(2));
  });

  it("a double click (same idempotency key, at the same time) trades once and returns the same result", async () => {
    const { userId, leagueId, memberId } = await freshMember();
    const quote = await quoteFor(db, prices, { userId, leagueId, ticker: "AAPL", quantity: "3" });
    const key = randomUUID();

    const results = await Promise.all([
      executeTrade(db, prices, {
        userId,
        quoteId: quote.id,
        idempotencyKey: key,
        now: T.plus({ seconds: 1 }),
      }),
      executeTrade(db, prices, {
        userId,
        quoteId: quote.id,
        idempotencyKey: key,
        now: T.plus({ seconds: 1 }),
      }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    const ids = results.map((result) => (result.ok ? result.transactionId : null));
    expect(ids[0]).toBe(ids[1]);
    expect(results.map((result) => result.ok && result.replayed).sort()).toEqual([false, true]);
    expect(await tradeCount(memberId)).toBe(1);
  });

  it("buys by different members of the same league do not block each other's cash", async () => {
    const owner = await freshMember();
    const otherUser = await createTestUser(db, "Other");
    await addTestMember(db, owner.inviteCode, otherUser);
    const [a, b] = await Promise.all([
      quoteFor(db, prices, {
        userId: owner.userId,
        leagueId: owner.leagueId,
        ticker: "EQNR",
        quantity: "300",
      }),
      quoteFor(db, prices, {
        userId: otherUser,
        leagueId: owner.leagueId,
        ticker: "EQNR",
        quantity: "300",
      }),
    ]);
    const results = await Promise.all([
      executeTrade(db, prices, {
        userId: owner.userId,
        quoteId: a.id,
        idempotencyKey: randomUUID(),
        now: T.plus({ seconds: 2 }),
      }),
      executeTrade(db, prices, {
        userId: otherUser,
        quoteId: b.id,
        idempotencyKey: randomUUID(),
        now: T.plus({ seconds: 2 }),
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
  });
});

describe("executeTrade", () => {
  it("executes at exactly the locked price, even if the market has moved", async () => {
    const { userId, leagueId, memberId } = await freshMember();
    const quote = await quoteFor(db, prices, { userId, leagueId, ticker: "AAPL", quantity: "4" });
    const later = T.plus({ seconds: 14 });
    const result = await executeTrade(db, prices, {
      userId,
      quoteId: quote.id,
      idempotencyKey: randomUUID(),
      now: later,
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.quoteId, quote.id));
    expect(row?.price).toBe(quote.price.amount.toFixed());
    expect(row?.fxRate).toBe(quote.fxRate.rate.toFixed());
    expect(row?.amount).toBe(quote.totalAmount.amount.negated().toFixed());
    expect(row?.occurredAt.toISOString()).toBe(later.toJSDate().toISOString());
    const [holding] = await db
      .select()
      .from(schema.holdings)
      .where(eq(schema.holdings.memberId, memberId));
    expect(holding?.quantity).toBe("4");
  });

  it("rejects a quote confirmed after 30 seconds", async () => {
    const { userId, leagueId } = await freshMember();
    const quote = await quoteFor(db, prices, { userId, leagueId, ticker: "EQNR", quantity: "1" });
    const result = await executeTrade(db, prices, {
      userId,
      quoteId: quote.id,
      idempotencyKey: randomUUID(),
      now: T.plus({ seconds: 30 }),
    });
    expect(codes(result)).toEqual(["QUOTE_EXPIRED"]);
  });

  it("rejects when the exchange closes between quote and confirmation", async () => {
    const { userId, leagueId } = await freshMember();
    // Oslo Børs closes 16:20 local = 15:20Z on 27 Oct (winter time).
    const quote = await quoteFor(db, prices, {
      userId,
      leagueId,
      ticker: "EQNR",
      quantity: "1",
      now: instant("2026-10-27T15:19:55Z"),
    });
    const result = await executeTrade(db, prices, {
      userId,
      quoteId: quote.id,
      idempotencyKey: randomUUID(),
      now: instant("2026-10-27T15:20:01Z"),
    });
    expect(codes(result)).toEqual(["MARKET_CLOSED"]);
  });

  it("uses a quote only once", async () => {
    const { userId, leagueId } = await freshMember();
    const quote = await quoteFor(db, prices, { userId, leagueId, ticker: "EQNR", quantity: "1" });
    const now = T.plus({ seconds: 2 });
    expect(
      (
        await executeTrade(db, prices, {
          userId,
          quoteId: quote.id,
          idempotencyKey: randomUUID(),
          now,
        })
      ).ok,
    ).toBe(true);
    const again = await executeTrade(db, prices, {
      userId,
      quoteId: quote.id,
      idempotencyKey: randomUUID(),
      now,
    });
    expect(codes(again)).toEqual(["QUOTE_ALREADY_USED"]);
  });

  it("refuses an idempotency key reused for a different quote", async () => {
    const { userId, leagueId } = await freshMember();
    const [a, b] = await Promise.all([
      quoteFor(db, prices, { userId, leagueId, ticker: "EQNR", quantity: "1" }),
      quoteFor(db, prices, { userId, leagueId, ticker: "EQNR", quantity: "2" }),
    ]);
    const key = randomUUID();
    const now = T.plus({ seconds: 2 });
    await executeTrade(db, prices, { userId, quoteId: a.id, idempotencyKey: key, now });
    expect(
      codes(await executeTrade(db, prices, { userId, quoteId: b.id, idempotencyKey: key, now })),
    ).toEqual(["IDEMPOTENCY_KEY_REUSED"]);
  });

  it("does not let someone else execute my quote", async () => {
    const { userId, leagueId, inviteCode } = await freshMember();
    const intruder = await createTestUser(db, "Intruder");
    await addTestMember(db, inviteCode, intruder);
    const quote = await quoteFor(db, prices, { userId, leagueId, ticker: "EQNR", quantity: "1" });
    const result = await executeTrade(db, prices, {
      userId: intruder,
      quoteId: quote.id,
      idempotencyKey: randomUUID(),
      now: T,
    });
    expect(codes(result)).toEqual(["QUOTE_NOT_FOUND"]);
  });
});

describe("createQuote", () => {
  it("books foreign stocks in the league currency with the provider's FX rate", async () => {
    const { userId, leagueId } = await freshMember();
    const quote = await quoteFor(db, prices, { userId, leagueId, ticker: "AAPL", quantity: "10" });
    const rate = await prices.getFxRate("USD", "NOK", T);
    expect(quote.price.currency).toBe("USD");
    expect(quote.grossAmount.currency).toBe("NOK");
    expect(quote.fxRate.rate.toFixed()).toBe(rate.rate.toDecimalPlaces(6).toFixed());
    expect(quote.grossAmount.amount.toFixed(2)).toBe(
      decimal("10").times(quote.price.amount).times(quote.fxRate.rate).toFixed(2),
    );
  });

  it("is refused for someone who is not a member", async () => {
    const { leagueId } = await freshMember();
    const outsider = await createTestUser(db, "Outsider");
    const result = await createQuote(db, prices, {
      userId: outsider,
      leagueId,
      order: {
        type: "market",
        side: "buy",
        instrumentId: await instrumentId(db, "EQNR"),
        quantity: decimal("1"),
      },
      now: T,
    });
    expect(codes(result)).toEqual(["NOT_A_MEMBER"]);
  });

  it.each([
    ["selling more than held", { side: "sell" as const, quantity: "1" }, ["INSUFFICIENT_HOLDINGS"]],
    ["a fraction of a share", { side: "buy" as const, quantity: "0.5" }, ["FRACTIONAL_QUANTITY"]],
    [
      "more than the cash balance",
      { side: "buy" as const, quantity: "1000" },
      ["INSUFFICIENT_CASH"],
    ],
  ])("rejects %s", async (_label, order, expected) => {
    const { userId, leagueId } = await freshMember();
    const result = await createQuote(db, prices, {
      userId,
      leagueId,
      order: {
        type: "market",
        instrumentId: await instrumentId(db, "EQNR"),
        side: order.side,
        quantity: decimal(order.quantity),
      },
      now: T,
    });
    expect(codes(result)).toEqual(expected);
  });

  it("rejects a buy above the league's max position share", async () => {
    const { userId, leagueId } = await freshMember({ maxPositionShare: decimal("0.25") });
    const order = {
      type: "market" as const,
      side: "buy" as const,
      instrumentId: await instrumentId(db, "EQNR"),
    };
    // ~120 × 265 ≈ 31 800 > 25 % of 100 000
    const tooMuch = await createQuote(db, prices, {
      userId,
      leagueId,
      order: { ...order, quantity: decimal("120") },
      now: T,
    });
    expect(codes(tooMuch)).toEqual(["MAX_POSITION_SHARE_EXCEEDED"]);
    const fine = await createQuote(db, prices, {
      userId,
      leagueId,
      order: { ...order, quantity: decimal("80") },
      now: T,
    });
    expect(fine.ok).toBe(true);
  });

  it("rejects trading on a closed exchange, with when it opens", async () => {
    const { userId, leagueId } = await freshMember();
    const saturday = instant("2026-10-31T12:00:00Z");
    const result = await createQuote(db, prices, {
      userId,
      leagueId,
      order: {
        type: "market",
        side: "buy",
        instrumentId: await instrumentId(db, "EQNR"),
        quantity: decimal("1"),
      },
      now: saturday,
    });
    expect(codes(result)).toEqual(["MARKET_CLOSED"]);
    const rejection = result.ok ? null : result.rejections[0];
    expect(rejection?.code === "MARKET_CLOSED" && rejection.nextOpenAt?.toUTC().toISO()).toBe(
      "2026-11-02T08:00:00.000Z",
    );
  });

  it("rejects an exchange the league does not allow", async () => {
    const { userId, leagueId } = await freshMember({ allowedExchangeIds: ["XOSL"] });
    const result = await createQuote(db, prices, {
      userId,
      leagueId,
      order: {
        type: "market",
        side: "buy",
        instrumentId: await instrumentId(db, "AAPL"),
        quantity: decimal("1"),
      },
      now: T,
    });
    expect(codes(result)).toEqual(["EXCHANGE_NOT_ALLOWED"]);
  });

  it("stores nothing for a rejected quote", async () => {
    const { userId, leagueId, memberId } = await freshMember();
    await createQuote(db, prices, {
      userId,
      leagueId,
      order: {
        type: "market",
        side: "buy",
        instrumentId: await instrumentId(db, "EQNR"),
        quantity: decimal("1000"),
      },
      now: T,
    });
    const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.memberId, memberId));
    expect(rows).toHaveLength(0);
  });
});
