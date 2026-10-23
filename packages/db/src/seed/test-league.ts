import { randomUUID } from "node:crypto";

import {
  decimal,
  defaultLeagueSettings,
  type Exchange,
  getSession,
  localDate,
  type PriceProvider,
  suggestEndTime,
  type TradeSide,
} from "@aksjeliga/core";
import { eq } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Database } from "../client";
import { loadExchanges } from "../repositories/reference";
import { instruments, leagues } from "../schema";
import { createLeague, joinLeague } from "../services/leagues";
import { createQuote, executeTrade } from "../services/trading";

export const TEST_LEAGUE_INVITE_CODE = "TEST26";

interface PlannedTrade {
  user: "ola" | "kari";
  ticker: string;
  side: TradeSide;
  quantity: string;
  /** Which trading day after the start (0 = first). */
  day: number;
}

const PLANNED_TRADES: readonly PlannedTrade[] = [
  { user: "ola", ticker: "EQNR", side: "buy", quantity: "100", day: 0 },
  { user: "kari", ticker: "NOVO B", side: "buy", quantity: "20", day: 0 },
  { user: "ola", ticker: "AAPL", side: "buy", quantity: "10", day: 0 },
  { user: "kari", ticker: "VOLV B", side: "buy", quantity: "100", day: 1 },
  { user: "ola", ticker: "DNB", side: "buy", quantity: "50", day: 1 },
  { user: "kari", ticker: "MSFT", side: "buy", quantity: "5", day: 1 },
  { user: "ola", ticker: "EQNR", side: "sell", quantity: "30", day: 2 },
  { user: "ola", ticker: "NVDA", side: "buy", quantity: "5", day: 2 },
  { user: "kari", ticker: "KO", side: "buy", quantity: "20", day: 2 },
];

/** The n-th session of an exchange that opens after `from`, at one hour after the open. */
function tradingInstant(exchange: Exchange, from: DateTime, n: number): DateTime | null {
  let found = 0;
  for (let offset = 0; offset < 30; offset++) {
    const session = getSession(exchange, localDate(from.plus({ days: offset }), exchange.timeZone));
    if (!session || session.opensAt.toMillis() < from.toMillis()) continue;
    if (found === n) return session.opensAt.plus({ hours: 1 });
    found++;
  }
  return null;
}

/**
 * «Testligaen»: NOK, started a week ago, ends in about a month. Ola owns it, Kari is a member,
 * Per is not (to try invitations and approval). Both members have traded on several
 * exchanges, through the real quote → execute services.
 */
export async function seedTestLeague(
  db: Database,
  provider: PriceProvider,
  userIds: { ola: string; kari: string },
  now: DateTime,
): Promise<"created" | "exists"> {
  const [existing] = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.inviteCode, TEST_LEAGUE_INVITE_CODE));
  if (existing) return "exists";

  const exchanges = await loadExchanges(db);
  const createdAt = now.minus({ days: 7 }).startOf("hour");
  const startsAt = createdAt.plus({ minutes: 30 });
  const endDate = localDate(now.plus({ days: 30 }), "Europe/Oslo");

  const created = await createLeague(db, {
    ownerId: userIds.ola,
    now: createdAt,
    inviteCode: TEST_LEAGUE_INVITE_CODE,
    settings: {
      ...defaultLeagueSettings("NOK", exchanges),
      name: "Testligaen",
      description: "Testliga med Ola og Kari. Per kan be om å bli med.",
      startsAt,
      endsAt: suggestEndTime(endDate, "Europe/Oslo", exchanges),
    },
  });
  if (!created.ok)
    throw new Error(`Could not create test league: ${JSON.stringify(created.errors)}`);

  const joined = await joinLeague(db, {
    userId: userIds.kari,
    inviteCode: TEST_LEAGUE_INVITE_CODE,
    now: createdAt.plus({ minutes: 10 }),
  });
  if (!joined.ok || joined.status !== "joined")
    throw new Error(`Kari could not join: ${JSON.stringify(joined)}`);

  const catalogue = await db.select().from(instruments);
  for (const planned of PLANNED_TRADES) {
    const instrument = catalogue.find((row) => row.ticker === planned.ticker);
    const exchange = exchanges.find((candidate) => candidate.id === instrument?.exchangeId);
    if (!instrument || !exchange) throw new Error(`Unknown instrument ${planned.ticker}`);
    const at = tradingInstant(exchange, startsAt, planned.day);
    if (!at || at.toMillis() >= now.toMillis()) continue; // not enough trading days yet

    const userId = userIds[planned.user];
    const quote = await createQuote(db, provider, {
      userId,
      leagueId: created.leagueId,
      order: {
        type: "market",
        side: planned.side,
        instrumentId: instrument.id,
        quantity: decimal(planned.quantity),
      },
      now: at,
    });
    if (!quote.ok)
      throw new Error(`Quote for ${planned.ticker} failed: ${JSON.stringify(quote.rejections)}`);
    const trade = await executeTrade(db, provider, {
      userId,
      quoteId: quote.quote.id,
      idempotencyKey: randomUUID(),
      now: at.plus({ seconds: 3 }),
    });
    if (!trade.ok)
      throw new Error(`Trade ${planned.ticker} failed: ${JSON.stringify(trade.rejections)}`);
  }
  return "created";
}
