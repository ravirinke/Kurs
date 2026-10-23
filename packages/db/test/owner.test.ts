import { randomUUID } from "node:crypto";

import { decimal, instant } from "@aksjeliga/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  asUser,
  cancelLeague,
  createQuote,
  executeTrade,
  joinLeague,
  loadLeaderboard,
  loadMyLeagues,
  loadProfile,
  regenerateInviteCode,
  removeMember,
  schema,
  updateDisplayName,
} from "../src";

import {
  addTestMember,
  connect,
  createTestLeague,
  createTestUser,
  instrumentId,
  LEAGUE_CREATED,
  provider,
  quoteFor,
  T,
} from "./helpers";

const { db, close } = connect();
afterAll(close);

async function leagueWithMember() {
  const owner = await createTestUser(db, "Owner");
  const member = await createTestUser(db, "Member");
  const league = await createTestLeague(db, owner);
  await addTestMember(db, league.inviteCode, member);
  return { owner, member, ...league };
}

describe("regenerateInviteCode", () => {
  it("makes the old code stop working and the new one work", async () => {
    const { owner, leagueId, inviteCode } = await leagueWithMember();
    const result = await regenerateInviteCode(db, { leagueId, userId: owner, now: T });
    expect(result.ok).toBe(true);
    const newCode = result.ok ? result.inviteCode : "";
    expect(newCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(newCode).not.toBe(inviteCode);

    const guest = await createTestUser(db, "Guest");
    expect(await joinLeague(db, { userId: guest, inviteCode, now: T })).toEqual({
      ok: false,
      rejection: { code: "INVITE_NOT_FOUND" },
    });
    expect((await joinLeague(db, { userId: guest, inviteCode: newCode, now: T })).ok).toBe(true);
  });

  it("is only for the owner", async () => {
    const { member, leagueId } = await leagueWithMember();
    expect(await regenerateInviteCode(db, { leagueId, userId: member, now: T })).toEqual({
      ok: false,
      rejection: { code: "NOT_OWNER" },
    });
  });
});

describe("removeMember", () => {
  it("takes the member out of the table, trading and the league, and they cannot rejoin", async () => {
    const { owner, member, leagueId, inviteCode } = await leagueWithMember();
    const prices = await provider(db);
    const quote = await quoteFor(db, prices, {
      userId: member,
      leagueId,
      ticker: "EQNR",
      quantity: "1",
    });

    expect(
      await removeMember(db, { leagueId, userId: owner, targetUserId: member, now: T }),
    ).toEqual({ ok: true });

    const board = await loadLeaderboard(db, prices, leagueId, T);
    expect(board?.rows.map((row) => row.userId)).toEqual([owner]);

    const lateTrade = await executeTrade(db, prices, {
      userId: member,
      quoteId: quote.id,
      idempotencyKey: randomUUID(),
      now: T,
    });
    expect(lateTrade).toEqual({ ok: false, rejections: [{ code: "NOT_A_MEMBER" }] });
    const newQuote = await createQuote(db, prices, {
      userId: member,
      leagueId,
      order: {
        type: "market",
        side: "buy",
        instrumentId: await instrumentId(db, "EQNR"),
        quantity: decimal("1"),
      },
      now: T,
    });
    expect(newQuote).toEqual({ ok: false, rejections: [{ code: "NOT_A_MEMBER" }] });

    expect(await joinLeague(db, { userId: member, inviteCode, now: T })).toEqual({
      ok: false,
      rejection: { code: "REMOVED_FROM_LEAGUE" },
    });

    const visible = await asUser(db, member, (tx) =>
      tx
        .select({ id: schema.leagues.id })
        .from(schema.leagues)
        .where(eq(schema.leagues.id, leagueId)),
    );
    expect(visible).toHaveLength(0);
    expect((await loadMyLeagues(db, prices, { userId: member, now: T })).active).toHaveLength(0);
  });

  it("keeps the removed member's transactions", async () => {
    const { owner, member, leagueId } = await leagueWithMember();
    await removeMember(db, { leagueId, userId: owner, targetUserId: member, now: T });
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.transactions)
      .innerJoin(schema.leagueMembers, eq(schema.leagueMembers.id, schema.transactions.memberId))
      .where(
        and(eq(schema.transactions.leagueId, leagueId), eq(schema.leagueMembers.userId, member)),
      );
    expect(row?.count).toBe(1);
  });

  it("does not let the owner remove themselves, or others remove anyone", async () => {
    const { owner, member, leagueId } = await leagueWithMember();
    expect(
      await removeMember(db, { leagueId, userId: owner, targetUserId: owner, now: T }),
    ).toEqual({
      ok: false,
      rejection: { code: "CANNOT_REMOVE_OWNER" },
    });
    expect(
      await removeMember(db, { leagueId, userId: member, targetUserId: owner, now: T }),
    ).toEqual({
      ok: false,
      rejection: { code: "NOT_OWNER" },
    });
  });
});

describe("cancelLeague", () => {
  it("cancels before the start: hidden from lists and nobody can join", async () => {
    const owner = await createTestUser(db, "Owner");
    const { leagueId, inviteCode } = await createTestLeague(db, owner);
    const prices = await provider(db);
    const before = LEAGUE_CREATED.plus({ hours: 1 });

    expect(await cancelLeague(db, { leagueId, userId: owner, now: before })).toEqual({ ok: true });
    expect((await loadMyLeagues(db, prices, { userId: owner, now: before })).upcoming).toHaveLength(
      0,
    );

    const guest = await createTestUser(db, "Guest");
    expect(await joinLeague(db, { userId: guest, inviteCode, now: before })).toEqual({
      ok: false,
      rejection: { code: "LEAGUE_CANCELLED" },
    });
  });

  it("is refused after the start", async () => {
    const owner = await createTestUser(db, "Owner");
    const { leagueId } = await createTestLeague(db, owner);
    expect(await cancelLeague(db, { leagueId, userId: owner, now: T })).toEqual({
      ok: false,
      rejection: { code: "LEAGUE_ALREADY_STARTED" },
    });
  });

  it("stops trading in a cancelled league", async () => {
    const owner = await createTestUser(db, "Owner");
    const { leagueId } = await createTestLeague(db, owner, {
      startsAt: instant("2026-10-26T00:00:00Z"),
    });
    await db
      .update(schema.leagues)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.leagues.id, leagueId));
    const result = await createQuote(db, await provider(db), {
      userId: owner,
      leagueId,
      order: {
        type: "market",
        side: "buy",
        instrumentId: await instrumentId(db, "EQNR"),
        quantity: decimal("1"),
      },
      now: T,
    });
    expect(result.ok ? [] : result.rejections.map((rejection) => rejection.code)).toEqual([
      "LEAGUE_NOT_ACTIVE",
    ]);
  });
});

describe("display names", () => {
  it("counts a name given at sign-up as confirmed", async () => {
    const userId = await createTestUser(db, "Named");
    expect((await loadProfile(db, userId))?.nameConfirmed).toBe(true);
  });

  it("asks users without a name, and confirms the one they choose", async () => {
    const userId = randomUUID();
    await db.execute(sql`
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
      values (${userId}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        ${`noname-${userId.slice(0, 8)}@test.local`}, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '')
    `);
    const before = await loadProfile(db, userId);
    expect(before?.nameConfirmed).toBe(false);
    expect(before?.displayName).toMatch(/^noname-/);

    expect(await updateDisplayName(db, { userId, displayName: "  " })).toEqual({
      ok: false,
      error: { code: "NAME_REQUIRED" },
    });
    expect(await updateDisplayName(db, { userId, displayName: "  Kari   Nordmann " })).toEqual({
      ok: true,
    });
    expect(await loadProfile(db, userId)).toEqual({
      id: userId,
      displayName: "Kari Nordmann",
      nameConfirmed: true,
    });
  });
});
