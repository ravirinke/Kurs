import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, schema } from "../src";

import { connect, createTestUser, databaseError, instrumentId } from "./helpers";

/*
 * RLS is tested with the database's real clock (now()), because that is what the policies
 * use. Rows are inserted directly as the server role, then read back as each user.
 */

const { db, close } = connect();
afterAll(close);

type Case = "open" | "delayed" | "hidden" | "finishedHidden";

let viewer: string; // A: owner of every league, a member
let target: string; // B: a member whose portfolio A looks at
let outsider: string; // C: not a member, has a pending join request
const leagueIds = {} as Record<Case, string>;
const targetMember = {} as Record<Case, string>;
const viewerMember = {} as Record<Case, string>;

async function insertLeague(
  visibility: "open" | "delayed" | "hidden",
  finished: boolean,
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.leagues).values({
    id,
    ownerId: viewer,
    name: `RLS ${visibility}${finished ? " (ferdig)" : ""}`,
    currency: "NOK",
    startAmount: "100000",
    startsAt: sql`now() - interval '10 days'`,
    endsAt: finished ? sql`now() - interval '1 hour'` : sql`now() + interval '30 days'`,
    visibility,
    feeRate: "0.0005",
    feeMinimum: "29",
    inviteCode: randomUUID().slice(0, 8).toUpperCase(),
  });
  await db.insert(schema.leagueAllowedExchanges).values({ leagueId: id, exchangeId: "XOSL" });
  return id;
}

async function insertMember(leagueId: string, userId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.leagueMembers).values({
    id,
    leagueId,
    userId,
    joinedAt: sql`now() - interval '9 days'`,
    cashBalance: "100000",
  });
  return id;
}

async function deposit(leagueId: string, memberId: string, hoursAgo: number) {
  await db.insert(schema.transactions).values({
    leagueId,
    memberId,
    type: "deposit",
    occurredAt: sql`now() - make_interval(hours => ${hoursAgo})`,
    amount: "100",
  });
}

beforeAll(async () => {
  [viewer, target, outsider] = await Promise.all([
    createTestUser(db, "Viewer"),
    createTestUser(db, "Target"),
    createTestUser(db, "Outsider"),
  ]);
  const eqnr = await instrumentId(db, "EQNR");

  const cases: [Case, "open" | "delayed" | "hidden", boolean][] = [
    ["open", "open", false],
    ["delayed", "delayed", false],
    ["hidden", "hidden", false],
    ["finishedHidden", "hidden", true],
  ];
  for (const [name, visibility, finished] of cases) {
    const leagueId = await insertLeague(visibility, finished);
    leagueIds[name] = leagueId;
    viewerMember[name] = await insertMember(leagueId, viewer);
    targetMember[name] = await insertMember(leagueId, target);
    // One event older than 24 hours and one newer.
    await deposit(leagueId, targetMember[name], 48);
    await deposit(leagueId, targetMember[name], 1);
    await deposit(leagueId, viewerMember[name], 1);
    await db.insert(schema.holdings).values({
      memberId: targetMember[name],
      instrumentId: eqnr,
      quantity: "10",
      costBasis: "2650",
    });
    await db.insert(schema.portfolioSnapshots).values({
      leagueId,
      memberId: targetMember[name],
      date: "2026-10-22",
      value: "101000",
      cash: "50000",
      returnFraction: "0.01",
      takenAt: sql`now()`,
    });
  }

  await db.insert(schema.quotes).values({
    leagueId: leagueIds.open,
    memberId: targetMember.open,
    instrumentId: eqnr,
    side: "buy",
    quantity: "1",
    price: "265",
    priceCurrency: "NOK",
    fxRate: "1",
    grossAmount: "265",
    fee: "29",
    totalAmount: "294",
    createdAt: sql`now()`,
    expiresAt: sql`now() + interval '15 seconds'`,
  });
  await db
    .insert(schema.leagueJoinRequests)
    .values({ leagueId: leagueIds.open, userId: outsider, requestedAt: sql`now()` });
});

const transactionsSeenBy = (userId: string, memberId: string) =>
  asUser(db, userId, (tx) =>
    tx
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(eq(schema.transactions.memberId, memberId)),
  );

const holdingsSeenBy = (userId: string, memberId: string) =>
  asUser(db, userId, (tx) =>
    tx
      .select({ quantity: schema.holdings.quantity })
      .from(schema.holdings)
      .where(eq(schema.holdings.memberId, memberId)),
  );

describe("RLS: another member's portfolio follows the league's visibility", () => {
  it.each([
    ["open: everything", "open", 2, 1],
    ["delayed: only events older than 24 hours, no current holdings", "delayed", 1, 0],
    ["hidden: nothing", "hidden", 0, 0],
    ["finished (was hidden): everything", "finishedHidden", 2, 1],
  ] as const)("%s", async (_label, name, expectedTransactions, expectedHoldings) => {
    expect(await transactionsSeenBy(viewer, targetMember[name])).toHaveLength(expectedTransactions);
    expect(await holdingsSeenBy(viewer, targetMember[name])).toHaveLength(expectedHoldings);
  });

  it("always shows members their own portfolio", async () => {
    expect(await transactionsSeenBy(viewer, viewerMember.hidden)).toHaveLength(1);
    expect(await transactionsSeenBy(target, targetMember.hidden)).toHaveLength(2);
    expect(await holdingsSeenBy(target, targetMember.hidden)).toHaveLength(1);
  });

  it("shows nothing to someone outside the league", async () => {
    for (const name of ["open", "finishedHidden"] as const) {
      expect(await transactionsSeenBy(outsider, targetMember[name])).toHaveLength(0);
      expect(await holdingsSeenBy(outsider, targetMember[name])).toHaveLength(0);
    }
  });
});

describe("RLS: leagues and members", () => {
  it("shows a league only to its members", async () => {
    const ids = Object.values(leagueIds);
    const seenByViewer = await asUser(db, viewer, (tx) =>
      tx
        .select({ id: schema.leagues.id })
        .from(schema.leagues)
        .where(inArray(schema.leagues.id, ids)),
    );
    const seenByOutsider = await asUser(db, outsider, (tx) =>
      tx
        .select({ id: schema.leagues.id })
        .from(schema.leagues)
        .where(inArray(schema.leagues.id, ids)),
    );
    expect(seenByViewer).toHaveLength(4);
    expect(seenByOutsider).toHaveLength(0);
  });

  it("shows fellow members and their final results, but never their cash balance", async () => {
    const members = await asUser(db, viewer, (tx) =>
      tx
        .select({ id: schema.leagueMembers.id, finalRank: schema.leagueMembers.finalRank })
        .from(schema.leagueMembers)
        .where(eq(schema.leagueMembers.leagueId, leagueIds.hidden)),
    );
    expect(members).toHaveLength(2);

    const cash = asUser(db, viewer, (tx) =>
      tx.select({ cash: schema.leagueMembers.cashBalance }).from(schema.leagueMembers),
    );
    expect(await databaseError(cash)).toMatch(/permission denied/);
    const lastTrade = asUser(db, viewer, (tx) =>
      tx.select({ at: schema.leagueMembers.lastTradeAt }).from(schema.leagueMembers),
    );
    expect(await databaseError(lastTrade)).toMatch(/permission denied/);
  });

  it("shows snapshot values to members, but not the cash in them", async () => {
    const values = await asUser(db, viewer, (tx) =>
      tx
        .select({ value: schema.portfolioSnapshots.value })
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.leagueId, leagueIds.hidden)),
    );
    expect(values).toEqual([{ value: "101000" }]);
    const cash = asUser(db, viewer, (tx) =>
      tx.select({ cash: schema.portfolioSnapshots.cash }).from(schema.portfolioSnapshots),
    );
    expect(await databaseError(cash)).toMatch(/permission denied/);
  });

  it("shows profiles of fellow members only", async () => {
    const profile = (as: string, of: string) =>
      asUser(db, as, (tx) =>
        tx
          .select({ name: schema.profiles.displayName })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, of)),
      );
    expect(await profile(viewer, target)).toEqual([{ name: "Target" }]);
    expect(await profile(outsider, viewer)).toEqual([]);
    expect(await profile(outsider, outsider)).toEqual([{ name: "Outsider" }]);
  });
});

describe("RLS: quotes and join requests", () => {
  it("shows quotes only to the member they belong to", async () => {
    const quotesOf = (as: string) =>
      asUser(db, as, (tx) =>
        tx
          .select({ id: schema.quotes.id })
          .from(schema.quotes)
          .where(eq(schema.quotes.memberId, targetMember.open)),
      );
    expect(await quotesOf(target)).toHaveLength(1);
    expect(await quotesOf(viewer)).toHaveLength(0);
  });

  it("shows a join request to the requester and the owner, not to other members", async () => {
    const requestsSeenBy = (as: string) =>
      asUser(db, as, (tx) =>
        tx
          .select({ id: schema.leagueJoinRequests.id })
          .from(schema.leagueJoinRequests)
          .where(
            and(
              eq(schema.leagueJoinRequests.leagueId, leagueIds.open),
              eq(schema.leagueJoinRequests.userId, outsider),
            ),
          ),
      );
    expect(await requestsSeenBy(outsider)).toHaveLength(1);
    expect(await requestsSeenBy(viewer)).toHaveLength(1);
    expect(await requestsSeenBy(target)).toHaveLength(0);
  });
});

describe("RLS: users can never write directly", () => {
  it("refuses inserting a transaction", async () => {
    const insert = asUser(db, target, (tx) =>
      tx.insert(schema.transactions).values({
        leagueId: leagueIds.open,
        memberId: targetMember.open,
        type: "deposit",
        occurredAt: new Date(),
        amount: "1000000",
      }),
    );
    expect(await databaseError(insert)).toMatch(/permission denied/);
  });

  it("refuses changing their own cash or a league", async () => {
    const cash = asUser(db, target, (tx) =>
      tx
        .update(schema.leagueMembers)
        .set({ cashBalance: "9999999" })
        .where(eq(schema.leagueMembers.id, targetMember.open)),
    );
    expect(await databaseError(cash)).toMatch(/permission denied/);
    const league = asUser(db, viewer, (tx) =>
      tx
        .update(schema.leagues)
        .set({ name: "Hacket" })
        .where(eq(schema.leagues.id, leagueIds.open)),
    );
    expect(await databaseError(league)).toMatch(/permission denied/);
  });

  it("refuses deleting holdings", async () => {
    const remove = asUser(db, target, (tx) =>
      tx.delete(schema.holdings).where(eq(schema.holdings.memberId, targetMember.open)),
    );
    expect(await databaseError(remove)).toMatch(/permission denied/);
  });

  it("lets users change only their own display name", async () => {
    await asUser(db, outsider, (tx) =>
      tx
        .update(schema.profiles)
        .set({ displayName: "Ny Outsider" })
        .where(eq(schema.profiles.id, outsider)),
    );
    await asUser(db, outsider, (tx) =>
      tx
        .update(schema.profiles)
        .set({ displayName: "Kuppet" })
        .where(eq(schema.profiles.id, viewer)),
    );
    const [mine] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, outsider));
    const [theirs] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, viewer));
    expect(mine?.displayName).toBe("Ny Outsider");
    expect(theirs?.displayName).toBe("Viewer");
  });
});

describe("RLS: reference data", () => {
  it("is readable by signed-in users", async () => {
    const exchanges = await asUser(db, outsider, (tx) =>
      tx.select({ id: schema.exchanges.id }).from(schema.exchanges),
    );
    expect(exchanges.length).toBeGreaterThanOrEqual(5);
  });

  it("is not readable without signing in", async () => {
    const anonymous = db.transaction(async (tx) => {
      await tx.execute(sql`set local role anon`);
      return tx.select({ id: schema.exchanges.id }).from(schema.exchanges);
    });
    expect(await databaseError(anonymous)).toMatch(/permission denied/);
  });
});
