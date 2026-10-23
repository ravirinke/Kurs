import { randomUUID } from "node:crypto";

import { Money, type Visibility } from "@aksjeliga/core";
import type { DateTime } from "luxon";
import { afterAll, describe, expect, it } from "vitest";

import {
  executeTrade,
  joinLeague,
  loadActivity,
  loadInstrumentDetail,
  loadInstrumentQuotes,
  loadInvitePreview,
  loadLeaderboard,
  loadMyLeagues,
  loadPendingJoinRequests,
  loadPortfolio,
  loadTradingHome,
} from "../src";

import {
  addTestMember,
  connect,
  createTestLeague,
  createTestUser,
  instrumentId,
  provider,
  quoteFor,
  T,
} from "./helpers";

const { db, close } = connect();
afterAll(close);

/** Ola and Kari in a league; Kari buys 20 EQNR at T. */
async function setup(visibility: Visibility = "delayed") {
  const ola = await createTestUser(db, "Ola");
  const kari = await createTestUser(db, "Kari");
  const league = await createTestLeague(db, ola, { visibility });
  const kariMember = await addTestMember(db, league.inviteCode, kari);
  const prices = await provider(db);
  const quote = await quoteFor(db, prices, {
    userId: kari,
    leagueId: league.leagueId,
    ticker: "EQNR",
    quantity: "20",
  });
  const trade = await executeTrade(db, prices, {
    userId: kari,
    quoteId: quote.id,
    idempotencyKey: randomUUID(),
    now: T,
  });
  if (!trade.ok) throw new Error(JSON.stringify(trade.rejections));
  return { ola, kari, kariMember, ...league, quote };
}

const portfolioAs = async (
  viewerUserId: string,
  leagueId: string,
  memberId: string,
  at: DateTime,
) => loadPortfolio(db, await provider(db, at), { leagueId, memberId, viewerUserId, now: at });

describe("loadLeaderboard", () => {
  it("ranks members by value with day change and movement", async () => {
    const { leagueId, ola, kari } = await setup();
    const board = await loadLeaderboard(db, await provider(db), leagueId, T.plus({ minutes: 5 }));
    expect(board?.status).toBe("active");
    expect(board?.rows).toHaveLength(2);
    expect(board?.rows.map((row) => row.userId).sort()).toEqual([ola, kari].sort());
    for (const row of board?.rows ?? []) {
      expect(row.value.currency).toBe("NOK");
      expect(row.dayChange).not.toBeNull();
      expect(row.movement).not.toBeNull();
    }
    // Ola never traded and has exactly the start amount.
    const olaRow = board?.rows.find((row) => row.userId === ola);
    expect(olaRow?.value.toString()).toBe("100000 NOK");
    expect(olaRow?.returnFraction.toString()).toBe("0");
  });
});

describe("loadPortfolio follows the visibility rule", () => {
  it("delayed: others see holdings only once they are 24 hours old, but always the return", async () => {
    const { ola, leagueId, kariMember } = await setup("delayed");
    const soon = await portfolioAs(ola, leagueId, kariMember, T.plus({ hours: 1 }));
    expect(soon?.access.kind).toBe("delayed");
    expect(soon?.holdings).toEqual([]);
    expect(soon?.trades).toEqual([]);
    expect(soon?.summary.value.currency).toBe("NOK");

    const later = await portfolioAs(ola, leagueId, kariMember, T.plus({ hours: 25 }));
    expect(
      later?.holdings.map((holding) => [holding.instrument.ticker, holding.quantity.toString()]),
    ).toEqual([["EQNR", "20"]]);
    expect(later?.trades).toHaveLength(1);
  });

  it("hidden: others see only the return", async () => {
    const { ola, leagueId, kariMember } = await setup("hidden");
    const view = await portfolioAs(ola, leagueId, kariMember, T.plus({ hours: 25 }));
    expect(view?.access.kind).toBe("returnOnly");
    expect(view?.holdings).toEqual([]);
    expect(view?.cash).toBeNull();
    expect(view?.allocation).toBeNull();
  });

  it("own portfolio: everything, with allocation and history", async () => {
    const { kari, leagueId, kariMember, quote } = await setup("hidden");
    const view = await portfolioAs(kari, leagueId, kariMember, T.plus({ minutes: 1 }));
    expect(view?.isOwn).toBe(true);
    expect(view?.cash?.equals(Money.of("100000", "NOK").minus(quote.totalAmount))).toBe(true);
    expect(view?.holdings).toHaveLength(1);
    expect(view?.trades[0]?.totalAmount.equals(quote.totalAmount)).toBe(true);
    const fractions = [...(view?.allocation?.byInstrument ?? []), view!.allocation!.cash].map(
      (part) => part.fraction,
    );
    expect(
      fractions
        .reduce((sum, fraction) => sum.plus(fraction))
        .toDecimalPlaces(6)
        .toString(),
    ).toBe("1");
    expect(view?.history.length).toBeGreaterThan(1);
  });

  it("refuses non-members", async () => {
    const { leagueId, kariMember } = await setup();
    const outsider = await createTestUser(db, "Outsider");
    expect(await portfolioAs(outsider, leagueId, kariMember, T)).toBeNull();
  });
});

describe("loadActivity", () => {
  it("shows own trades at once and others' only after the delay", async () => {
    const { ola, kari, leagueId } = await setup("delayed");
    const asKari = await loadActivity(db, {
      leagueId,
      viewerUserId: kari,
      now: T.plus({ hours: 1 }),
    });
    expect(asKari?.items.map((item) => item.isOwn)).toEqual([true]);
    const asOla = await loadActivity(db, {
      leagueId,
      viewerUserId: ola,
      now: T.plus({ hours: 1 }),
    });
    expect(asOla?.items).toEqual([]);
    expect(asOla?.delayedUntil).not.toBeNull();
    const asOlaLater = await loadActivity(db, {
      leagueId,
      viewerUserId: ola,
      now: T.plus({ hours: 25 }),
    });
    expect(
      asOlaLater?.items.map((item) => `${item.displayName} ${item.side} ${item.instrument.ticker}`),
    ).toEqual(["Kari buy EQNR"]);
  });
});

describe("market views", () => {
  it("lists the league's exchanges with status and today's movers", async () => {
    const { leagueId } = await setup();
    const home = await loadTradingHome(db, await provider(db), { leagueId, now: T });
    expect(home?.exchanges.map((entry) => entry.exchange.id).sort()).toEqual([
      "XCSE",
      "XNAS",
      "XNYS",
      "XOSL",
      "XSTO",
    ]);
    expect(home?.exchanges.find((entry) => entry.exchange.id === "XNAS")?.status.isOpen).toBe(true);
    expect(home?.winners.every((entry) => entry.quote.changeFraction.greaterThan(0))).toBe(true);
    expect(home?.losers.every((entry) => entry.quote.changeFraction.lessThan(0))).toBe(true);
  });

  it("searches by name and ticker within the league's exchanges", async () => {
    const ola = await createTestUser(db, "Ola");
    const { leagueId } = await createTestLeague(db, ola, { allowedExchangeIds: ["XOSL"] });
    const prices = await provider(db);
    expect(
      (await loadInstrumentQuotes(db, prices, { leagueId, search: "equi", now: T }))?.map(
        (entry) => entry.instrument.ticker,
      ),
    ).toEqual(["EQNR"]);
    expect(await loadInstrumentQuotes(db, prices, { leagueId, search: "AAPL", now: T })).toEqual(
      [],
    );
    expect(
      (await loadInstrumentQuotes(db, prices, { leagueId, exchangeId: "XOSL", now: T }))?.length,
    ).toBe(10);
  });

  it("shows the stock page with periods and who owns it, following visibility", async () => {
    const { ola, leagueId } = await setup("open");
    const detail = await loadInstrumentDetail(db, await provider(db), {
      leagueId,
      instrumentId: await instrumentId(db, "EQNR"),
      viewerUserId: ola,
      now: T,
    });
    expect(Object.keys(detail?.periodReturns ?? {})).toEqual(["1d", "1w", "1m", "3m", "1y"]);
    expect(detail?.history["1d"].length).toBeGreaterThan(10);
    expect(detail?.history["1y"].length).toBeGreaterThan(200);
    expect(detail?.ownQuantity?.toString()).toBe("0");
    expect(detail?.owners.map((owner) => [owner.displayName, owner.quantity.toString()])).toEqual([
      ["Kari", "20"],
    ]);
  });

  it("hides owners in a hidden league", async () => {
    const { ola, leagueId } = await setup("hidden");
    const detail = await loadInstrumentDetail(db, await provider(db), {
      leagueId,
      instrumentId: await instrumentId(db, "EQNR"),
      viewerUserId: ola,
      now: T,
    });
    expect(detail?.owners).toEqual([]);
    expect(detail?.ownersHidden).toBe(true);
  });
});

describe("home page and invites", () => {
  it("sorts leagues into sections and shows the viewer's place", async () => {
    const { kari } = await setup();
    const mine = await loadMyLeagues(db, await provider(db), {
      userId: kari,
      now: T.plus({ minutes: 1 }),
    });
    expect(mine.active).toHaveLength(1);
    expect(mine.active[0]?.memberCount).toBe(2);
    expect(mine.active[0]?.me?.userId).toBe(kari);
    expect(mine.active[0]?.isOwner).toBe(false);
  });

  it("shows a late join request to the requester and the owner", async () => {
    const { ola, leagueId, inviteCode } = await setup();
    const per = await createTestUser(db, "Per");
    expect((await loadInvitePreview(db, { inviteCode, userId: per, now: T }))?.viewer).toBe("none");
    await joinLeague(db, { userId: per, inviteCode, now: T });

    const preview = await loadInvitePreview(db, { inviteCode, userId: per, now: T });
    expect(preview?.viewer).toBe("pending");
    expect(preview?.ownerName).toBe("Ola");
    expect(preview?.memberCount).toBe(2);

    const prices = await provider(db);
    expect(
      (await loadMyLeagues(db, prices, { userId: per, now: T })).awaitingApproval,
    ).toHaveLength(1);
    expect(
      (await loadMyLeagues(db, prices, { userId: ola, now: T })).active[0]?.pendingRequestCount,
    ).toBe(1);
    expect(
      (await loadPendingJoinRequests(db, leagueId)).map((request) => request.displayName),
    ).toEqual(["Per"]);
  });
});
