import { randomInt, randomUUID } from "node:crypto";

import {
  checkJoin,
  checkJoinDecision,
  type JoinDecisionRejection,
  type JoinRejection,
  type League,
  type LeagueSettings,
  type LeagueSettingsError,
  type LeagueSettingsPatch,
  startingDeposit,
  validateLeagueSettings,
  validateLeagueUpdate,
} from "@aksjeliga/core";
import { and, eq } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Database, Executor } from "../client";
import { toDbTime, toNumeric } from "../mappers";
import { findMember, loadLeague, loadLeagueByInviteCode } from "../repositories/leagues";
import { appendEvent, rebuildMemberCache } from "../repositories/ledger";
import { loadExchanges } from "../repositories/reference";
import { leagueAllowedExchanges, leagueJoinRequests, leagueMembers, leagues } from "../schema";

/** No 0/O, 1/I/L: easy to read out loud and type. */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_LENGTH = 8;

export function generateInviteCode(): string {
  return Array.from(
    { length: INVITE_LENGTH },
    () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)],
  ).join("");
}

/** Adds a member with the full start amount, deposited at `joinedAt`. */
async function addMember(
  db: Executor,
  league: League,
  userId: string,
  joinedAt: DateTime,
): Promise<string> {
  const memberId = randomUUID();
  await db.insert(leagueMembers).values({
    id: memberId,
    leagueId: league.id,
    userId,
    joinedAt: toDbTime(joinedAt),
    cashBalance: "0",
  });
  await appendEvent(db, startingDeposit(league, randomUUID(), joinedAt), {
    leagueId: league.id,
    memberId,
  });
  await rebuildMemberCache(db, memberId, league.currency);
  return memberId;
}

export type CreateLeagueResult =
  | { ok: true; leagueId: string; memberId: string; inviteCode: string }
  | { ok: false; errors: LeagueSettingsError[] };

export async function createLeague(
  db: Database,
  input: { ownerId: string; settings: LeagueSettings; now: DateTime; inviteCode?: string },
): Promise<CreateLeagueResult> {
  const { settings, now } = input;
  const errors = validateLeagueSettings(settings, await loadExchanges(db), now);
  if (errors.length > 0) return { ok: false, errors };

  return db.transaction(async (tx) => {
    const leagueId = randomUUID();
    const inviteCode = input.inviteCode ?? generateInviteCode();
    await tx.insert(leagues).values({
      id: leagueId,
      ownerId: input.ownerId,
      name: settings.name.trim(),
      description: settings.description,
      currency: settings.currency,
      startAmount: toNumeric(settings.startAmount.amount),
      startsAt: toDbTime(settings.startsAt),
      endsAt: toDbTime(settings.endsAt),
      visibility: settings.visibility,
      feeRate: toNumeric(settings.feeRule.rate),
      feeMinimum: toNumeric(settings.feeRule.minimum.amount),
      maxPositionShare: settings.maxPositionShare ? toNumeric(settings.maxPositionShare) : null,
      inviteCode,
      createdAt: toDbTime(now),
    });
    await tx
      .insert(leagueAllowedExchanges)
      .values(settings.allowedExchangeIds.map((exchangeId) => ({ leagueId, exchangeId })));

    const league = await loadLeague(tx, leagueId);
    if (!league) throw new Error("League vanished during creation");
    const memberId = await addMember(tx, league, input.ownerId, now);
    return { ok: true, leagueId, memberId, inviteCode };
  });
}

export type JoinLeagueResult =
  | { ok: true; status: "joined"; leagueId: string; memberId: string }
  | { ok: true; status: "requested"; leagueId: string; requestId: string }
  | { ok: false; rejection: JoinRejection | { code: "INVITE_NOT_FOUND" } };

/** Joins directly before the start; after the start, asks the owner for approval. */
export async function joinLeague(
  db: Database,
  input: { userId: string; inviteCode: string; now: DateTime },
): Promise<JoinLeagueResult> {
  const found = await loadLeagueByInviteCode(db, input.inviteCode);
  if (!found) return { ok: false, rejection: { code: "INVITE_NOT_FOUND" } };

  return db.transaction(async (tx) => {
    // Serialises joins per league, so a double click cannot add someone twice.
    await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, found.id)).for("update");
    const league = (await loadLeague(tx, found.id)) ?? found;

    const [pending] = await tx
      .select({ id: leagueJoinRequests.id })
      .from(leagueJoinRequests)
      .where(
        and(
          eq(leagueJoinRequests.leagueId, league.id),
          eq(leagueJoinRequests.userId, input.userId),
          eq(leagueJoinRequests.status, "pending"),
        ),
      );
    const outcome = checkJoin({
      league,
      isAlreadyMember: (await findMember(tx, league.id, input.userId)) !== null,
      hasPendingRequest: pending !== undefined,
      now: input.now,
    });
    if (!outcome.ok) return { ok: false, rejection: outcome.rejection };

    if (outcome.mode === "direct") {
      const memberId = await addMember(tx, league, input.userId, input.now);
      return { ok: true, status: "joined", leagueId: league.id, memberId };
    }

    const requestId = randomUUID();
    await tx.insert(leagueJoinRequests).values({
      id: requestId,
      leagueId: league.id,
      userId: input.userId,
      requestedAt: toDbTime(input.now),
    });
    return { ok: true, status: "requested", leagueId: league.id, requestId };
  });
}

export type JoinDecisionResult =
  | { ok: true; memberId: string | null }
  | { ok: false; rejection: JoinDecisionRejection | { code: "REQUEST_NOT_FOUND" } };

/** The owner approves (member added with the full start amount now) or declines. */
export async function decideJoinRequest(
  db: Database,
  input: { requestId: string; deciderId: string; decision: "approve" | "decline"; now: DateTime },
): Promise<JoinDecisionResult> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(leagueJoinRequests)
      .where(eq(leagueJoinRequests.id, input.requestId))
      .for("update");
    if (!request) return { ok: false, rejection: { code: "REQUEST_NOT_FOUND" } };
    const league = await loadLeague(tx, request.leagueId);
    if (!league) return { ok: false, rejection: { code: "REQUEST_NOT_FOUND" } };

    const rejection = checkJoinDecision({
      league,
      request,
      deciderId: input.deciderId,
      decision: input.decision,
      now: input.now,
    });
    if (rejection) return { ok: false, rejection };

    await tx
      .update(leagueJoinRequests)
      .set({
        status: input.decision === "approve" ? "approved" : "declined",
        decidedAt: toDbTime(input.now),
        decidedBy: input.deciderId,
      })
      .where(eq(leagueJoinRequests.id, request.id));

    if (input.decision === "decline") return { ok: true, memberId: null };
    const existing = await findMember(tx, league.id, request.userId);
    const memberId = existing?.id ?? (await addMember(tx, league, request.userId, input.now));
    return { ok: true, memberId };
  });
}

export type UpdateLeagueResult =
  | { ok: true }
  | {
      ok: false;
      errors: (LeagueSettingsError | { code: "NOT_OWNER" } | { code: "LEAGUE_NOT_FOUND" })[];
    };

/** Owner-only. After the start only name, description and end time may change. */
export async function updateLeague(
  db: Database,
  input: { leagueId: string; userId: string; patch: LeagueSettingsPatch; now: DateTime },
): Promise<UpdateLeagueResult> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: leagues.id })
      .from(leagues)
      .where(eq(leagues.id, input.leagueId))
      .for("update");
    const league = await loadLeague(tx, input.leagueId);
    if (!league) return { ok: false, errors: [{ code: "LEAGUE_NOT_FOUND" }] };
    if (league.ownerId !== input.userId) return { ok: false, errors: [{ code: "NOT_OWNER" }] };

    const errors = validateLeagueUpdate(league, input.patch, await loadExchanges(tx), input.now);
    if (errors.length > 0) return { ok: false, errors };

    const next = { ...league, ...input.patch };
    await tx
      .update(leagues)
      .set({
        name: next.name.trim(),
        description: next.description,
        currency: next.currency,
        startAmount: toNumeric(next.startAmount.amount),
        startsAt: toDbTime(next.startsAt),
        endsAt: toDbTime(next.endsAt),
        visibility: next.visibility,
        feeRate: toNumeric(next.feeRule.rate),
        feeMinimum: toNumeric(next.feeRule.minimum.amount),
        maxPositionShare: next.maxPositionShare ? toNumeric(next.maxPositionShare) : null,
      })
      .where(eq(leagues.id, league.id));

    if (input.patch.allowedExchangeIds) {
      await tx.delete(leagueAllowedExchanges).where(eq(leagueAllowedExchanges.leagueId, league.id));
      await tx
        .insert(leagueAllowedExchanges)
        .values(next.allowedExchangeIds.map((exchangeId) => ({ leagueId: league.id, exchangeId })));
    }
    return { ok: true };
  });
}
