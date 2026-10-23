import { randomUUID } from "node:crypto";

import {
  decimal,
  defaultLeagueSettings,
  fixedClock,
  instant,
  type LeagueSettings,
  type PriceProvider,
  type TradeSide,
} from "@aksjeliga/core";
import { eq, sql } from "drizzle-orm";
import type { DateTime } from "luxon";

import {
  createDatabase,
  createLeague,
  createMockPriceProvider,
  createQuote,
  type Database,
  type DatabaseHandle,
  joinLeague,
  loadExchanges,
  loadRootEnv,
  requireEnv,
  schema,
} from "../src";

loadRootEnv();

export function connect(maxConnections = 10): DatabaseHandle {
  return createDatabase(requireEnv("DATABASE_URL"), { maxConnections });
}

/**
 * Tuesday 27 Oct 2026, 15:00 UTC: Oslo (until 15:20Z), Stockholm, Copenhagen and the US
 * exchanges (from 13:30Z) are all open. Tests pass explicit times; nothing reads the clock.
 */
export const T = instant("2026-10-27T15:00:00Z");
export const LEAGUE_CREATED = instant("2026-10-25T12:00:00Z");
export const LEAGUE_STARTS = instant("2026-10-26T00:00:00Z");
/** Thursday 31 Dec 2026 23:00 Oslo: after the US close. */
export const LEAGUE_ENDS = instant("2026-12-31T22:00:00Z");

/**
 * A user straight in auth.users (local test database only); the profile comes from the
 * trigger. The token columns must be '' rather than NULL, or Supabase Auth fails to read
 * the users table ("Database error finding users").
 */
export async function createTestUser(db: Database, name: string): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`
    insert into auth.users (
      id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    )
    values (
      ${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      ${`${name.toLowerCase()}-${id.slice(0, 8)}@test.local`},
      ${JSON.stringify({ display_name: name })}::jsonb, now(), now(),
      '', '', '', '', '', '', '', ''
    )
  `);
  return id;
}

export async function createTestLeague(
  db: Database,
  ownerId: string,
  overrides: Partial<LeagueSettings> = {},
  now: DateTime = LEAGUE_CREATED,
): Promise<{ leagueId: string; memberId: string; inviteCode: string }> {
  const exchanges = await loadExchanges(db);
  const result = await createLeague(db, {
    ownerId,
    now,
    settings: {
      ...defaultLeagueSettings("NOK", exchanges),
      name: "Testliga",
      description: "",
      startsAt: LEAGUE_STARTS,
      endsAt: LEAGUE_ENDS,
      ...overrides,
    },
  });
  if (!result.ok) throw new Error(`createLeague failed: ${JSON.stringify(result.errors)}`);
  return result;
}

export async function addTestMember(
  db: Database,
  inviteCode: string,
  userId: string,
): Promise<string> {
  const joined = await joinLeague(db, {
    userId,
    inviteCode,
    now: LEAGUE_CREATED.plus({ minutes: 5 }),
  });
  if (!joined.ok || joined.status !== "joined")
    throw new Error(`join failed: ${JSON.stringify(joined)}`);
  return joined.memberId;
}

export async function instrumentId(db: Database, ticker: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.instruments.id })
    .from(schema.instruments)
    .where(eq(schema.instruments.ticker, ticker));
  if (!row) throw new Error(`Instrument ${ticker} is not seeded. Run pnpm db:seed.`);
  return row.id;
}

export async function provider(db: Database, now: DateTime = T): Promise<PriceProvider> {
  return createMockPriceProvider(db, { clock: fixedClock(now) });
}

export async function quoteFor(
  db: Database,
  prices: PriceProvider,
  input: {
    userId: string;
    leagueId: string;
    ticker: string;
    side?: TradeSide;
    quantity: string;
    now?: DateTime;
  },
) {
  const result = await createQuote(db, prices, {
    userId: input.userId,
    leagueId: input.leagueId,
    order: {
      type: "market",
      side: input.side ?? "buy",
      instrumentId: await instrumentId(db, input.ticker),
      quantity: decimal(input.quantity),
    },
    now: input.now ?? T,
  });
  if (!result.ok) throw new Error(`createQuote failed: ${JSON.stringify(result.rejections)}`);
  return result.quote;
}

export async function memberRow(db: Database, memberId: string) {
  const [row] = await db
    .select()
    .from(schema.leagueMembers)
    .where(eq(schema.leagueMembers.id, memberId));
  if (!row) throw new Error(`Member ${memberId} not found`);
  return row;
}

/**
 * Awaits a query that must fail and returns the Postgres error text (message, constraint and
 * code). Drizzle wraps the driver error in `cause`.
 */
export async function databaseError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    const {
      message,
      constraint_name: constraint,
      code,
    } = cause as {
      message?: string;
      constraint_name?: string;
      code?: string;
    };
    return [message, constraint, code].filter(Boolean).join(" | ");
  }
  throw new Error("Expected the query to fail, but it succeeded");
}
