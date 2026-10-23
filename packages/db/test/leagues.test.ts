import { instant, Money } from "@aksjeliga/core";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createLeague,
  decideJoinRequest,
  joinLeague,
  loadExchanges,
  schema,
  updateLeague,
} from "../src";

import {
  connect,
  createTestLeague,
  createTestUser,
  LEAGUE_CREATED,
  LEAGUE_ENDS,
  memberRow,
  T,
} from "./helpers";

const { db, close } = connect();
afterAll(close);

async function deposits(memberId: string) {
  return db
    .select()
    .from(schema.transactions)
    .where(
      and(eq(schema.transactions.memberId, memberId), eq(schema.transactions.type, "deposit")),
    );
}

describe("createLeague", () => {
  it("makes the owner a member with the full start amount", async () => {
    const owner = await createTestUser(db, "Owner");
    const { memberId, inviteCode } = await createTestLeague(db, owner, {
      startAmount: Money.of("250000", "NOK"),
    });
    expect(inviteCode).toMatch(/^[A-Z2-9]{8}$/);
    expect((await memberRow(db, memberId)).cashBalance).toBe("250000");
    expect((await deposits(memberId)).map((row) => row.amount)).toEqual(["250000"]);
  });

  it("validates the settings with the rules from core", async () => {
    const owner = await createTestUser(db, "Owner");
    const result = await createLeague(db, {
      ownerId: owner,
      now: LEAGUE_CREATED,
      settings: {
        name: "",
        description: "",
        currency: "NOK",
        startAmount: Money.of("0", "NOK"),
        startsAt: LEAGUE_CREATED,
        // Wednesday 25 Nov 20:00 Oslo, before the US close.
        endsAt: instant("2026-11-25T19:00:00Z"),
        visibility: "delayed",
        allowedExchangeIds: (await loadExchanges(db)).map((exchange) => exchange.id),
        feeRule: { rate: Money.of("0.0005", "NOK").amount, minimum: Money.of("29", "NOK") },
        maxPositionShare: null,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["NAME_REQUIRED", "START_AMOUNT_INVALID", "END_BEFORE_MARKET_CLOSE"]),
    );
  });
});

describe("joining", () => {
  it("is direct before the start, with the full start amount", async () => {
    const owner = await createTestUser(db, "Owner");
    const guest = await createTestUser(db, "Guest");
    const { inviteCode } = await createTestLeague(db, owner);
    const result = await joinLeague(db, {
      userId: guest,
      inviteCode,
      now: LEAGUE_CREATED.plus({ hours: 1 }),
    });
    expect(result.ok && result.status).toBe("joined");
    if (result.ok && result.status === "joined")
      expect((await memberRow(db, result.memberId)).cashBalance).toBe("100000");
  });

  it("accepts the invite code in any case and with spaces or dashes", async () => {
    const owner = await createTestUser(db, "Owner");
    const guest = await createTestUser(db, "Guest");
    const { inviteCode } = await createTestLeague(db, owner);
    const sloppy = `${inviteCode.slice(0, 4).toLowerCase()}-${inviteCode.slice(4)} `;
    expect(
      (await joinLeague(db, { userId: guest, inviteCode: sloppy, now: LEAGUE_CREATED })).ok,
    ).toBe(true);
  });

  it("rejects an unknown invite code and a second join", async () => {
    const owner = await createTestUser(db, "Owner");
    const { inviteCode } = await createTestLeague(db, owner);
    expect(
      await joinLeague(db, { userId: owner, inviteCode: "NOPE2345", now: LEAGUE_CREATED }),
    ).toEqual({
      ok: false,
      rejection: { code: "INVITE_NOT_FOUND" },
    });
    expect(await joinLeague(db, { userId: owner, inviteCode, now: LEAGUE_CREATED })).toEqual({
      ok: false,
      rejection: { code: "ALREADY_MEMBER" },
    });
  });

  it("adds a member only once when the join button is pressed twice at the same time", async () => {
    const owner = await createTestUser(db, "Owner");
    const guest = await createTestUser(db, "Guest");
    const { inviteCode, leagueId } = await createTestLeague(db, owner);
    const results = await Promise.all([
      joinLeague(db, { userId: guest, inviteCode, now: LEAGUE_CREATED }),
      joinLeague(db, { userId: guest, inviteCode, now: LEAGUE_CREATED }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const members = await db
      .select()
      .from(schema.leagueMembers)
      .where(
        and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.userId, guest)),
      );
    expect(members).toHaveLength(1);
  });

  describe("after the start", () => {
    async function leagueWithRequest() {
      const owner = await createTestUser(db, "Owner");
      const late = await createTestUser(db, "Late");
      const { inviteCode, leagueId } = await createTestLeague(db, owner);
      const result = await joinLeague(db, { userId: late, inviteCode, now: T });
      if (!result.ok || result.status !== "requested") throw new Error(JSON.stringify(result));
      return { owner, late, inviteCode, leagueId, requestId: result.requestId };
    }

    it("creates a request instead of a membership", async () => {
      const { late, leagueId } = await leagueWithRequest();
      const members = await db
        .select()
        .from(schema.leagueMembers)
        .where(
          and(eq(schema.leagueMembers.leagueId, leagueId), eq(schema.leagueMembers.userId, late)),
        );
      expect(members).toHaveLength(0);
    });

    it("refuses a second request while one is pending", async () => {
      const { late, inviteCode } = await leagueWithRequest();
      expect(
        await joinLeague(db, { userId: late, inviteCode, now: T.plus({ minutes: 1 }) }),
      ).toEqual({
        ok: false,
        rejection: { code: "ALREADY_REQUESTED" },
      });
    });

    it("lets the owner approve: the member gets the full start amount at the approval time", async () => {
      const { owner, requestId } = await leagueWithRequest();
      const approvedAt = T.plus({ hours: 2 });
      const result = await decideJoinRequest(db, {
        requestId,
        deciderId: owner,
        decision: "approve",
        now: approvedAt,
      });
      expect(result.ok).toBe(true);
      const memberId = result.ok ? result.memberId! : "";
      const member = await memberRow(db, memberId);
      expect(member.cashBalance).toBe("100000");
      expect(member.joinedAt.toISOString()).toBe(approvedAt.toJSDate().toISOString());
      expect((await deposits(memberId)).map((row) => row.occurredAt.toISOString())).toEqual([
        approvedAt.toJSDate().toISOString(),
      ]);
    });

    it("lets the owner decline, after which nothing more can be decided", async () => {
      const { owner, requestId } = await leagueWithRequest();
      expect(
        (await decideJoinRequest(db, { requestId, deciderId: owner, decision: "decline", now: T }))
          .ok,
      ).toBe(true);
      expect(
        await decideJoinRequest(db, { requestId, deciderId: owner, decision: "approve", now: T }),
      ).toEqual({
        ok: false,
        rejection: { code: "REQUEST_NOT_PENDING" },
      });
    });

    it("lets only the owner decide", async () => {
      const { late, requestId } = await leagueWithRequest();
      expect(
        await decideJoinRequest(db, { requestId, deciderId: late, decision: "approve", now: T }),
      ).toEqual({
        ok: false,
        rejection: { code: "NOT_OWNER" },
      });
    });

    it("cannot approve after the league has ended", async () => {
      const { owner, requestId } = await leagueWithRequest();
      expect(
        await decideJoinRequest(db, {
          requestId,
          deciderId: owner,
          decision: "approve",
          now: LEAGUE_ENDS,
        }),
      ).toEqual({
        ok: false,
        rejection: { code: "LEAGUE_FINISHED" },
      });
    });
  });

  it("is refused after the league has ended", async () => {
    const owner = await createTestUser(db, "Owner");
    const guest = await createTestUser(db, "Guest");
    const { inviteCode } = await createTestLeague(db, owner);
    expect(await joinLeague(db, { userId: guest, inviteCode, now: LEAGUE_ENDS })).toEqual({
      ok: false,
      rejection: { code: "LEAGUE_FINISHED" },
    });
  });
});

describe("updateLeague", () => {
  it("lets the owner rename and move the end after the start, but not change locked settings", async () => {
    const owner = await createTestUser(db, "Owner");
    const { leagueId } = await createTestLeague(db, owner);
    const newEnd = instant("2027-01-29T22:00:00Z");
    expect(
      await updateLeague(db, {
        leagueId,
        userId: owner,
        patch: { name: "Nytt navn", endsAt: newEnd },
        now: T,
      }),
    ).toEqual({ ok: true });

    const locked = await updateLeague(db, {
      leagueId,
      userId: owner,
      patch: { visibility: "open" },
      now: T,
    });
    expect(locked.ok ? [] : locked.errors.map((error) => error.code)).toEqual(["FIELD_LOCKED"]);

    const [row] = await db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId));
    expect(row?.name).toBe("Nytt navn");
    expect(row?.visibility).toBe("delayed");
    expect(row?.endsAt.toISOString()).toBe(newEnd.toJSDate().toISOString());
  });

  it("refuses changes from anyone but the owner", async () => {
    const owner = await createTestUser(db, "Owner");
    const other = await createTestUser(db, "Other");
    const { leagueId } = await createTestLeague(db, owner);
    expect(
      await updateLeague(db, { leagueId, userId: other, patch: { name: "Kuppet" }, now: T }),
    ).toEqual({
      ok: false,
      errors: [{ code: "NOT_OWNER" }],
    });
  });
});
