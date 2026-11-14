import { type Currency, decimal, type Decimal } from "@aksjeliga/core";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Executor } from "../client";
import { toDateTime, toDbTime, toNumeric } from "../mappers";
import { fxRates, latestQuotes, priceFetchState, prices } from "../schema";

/*
 * Database access for the price cache: stored bars, latest quotes, FX points and the
 * bookkeeping of what was fetched when. No rules here; see cached-provider.ts.
 */

/** FX is stored from USD only; other pairs are derived. */
const FX_BASE: Currency = "USD";
const ERROR_MAX_LENGTH = 300;

export type PriceKind = "close" | "intraday";

export interface StoredPrice {
  price: Decimal;
  at: DateTime;
  fetchedAt: DateTime;
}

export interface StoredQuote extends StoredPrice {
  delayed: boolean;
}

export interface FetchState {
  attemptedAt: DateTime;
  fetchedAt: DateTime | null;
  coveredFrom: DateTime | null;
  failedAt: DateTime | null;
}

/**
 * Claims the right to fetch: returns the keys nobody has attempted in the last
 * `minAgeSeconds`. One atomic statement, so many server instances asking at once do not all
 * fetch the same thing, and a failing source is tried at most once per period.
 */
export async function claimFetch(
  db: Executor,
  keys: readonly string[],
  now: DateTime,
  minAgeSeconds: number,
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const claimed = await db
    .insert(priceFetchState)
    .values(keys.map((key) => ({ key, attemptedAt: toDbTime(now) })))
    .onConflictDoUpdate({
      target: priceFetchState.key,
      set: { attemptedAt: sql`excluded.attempted_at` },
      setWhere: lte(priceFetchState.attemptedAt, toDbTime(now.minus({ seconds: minAgeSeconds }))),
    })
    .returning({ key: priceFetchState.key });
  return new Set(claimed.map((row) => row.key));
}

export async function loadFetchState(db: Executor, key: string): Promise<FetchState | null> {
  const [row] = await db.select().from(priceFetchState).where(eq(priceFetchState.key, key));
  if (!row) return null;
  return {
    attemptedAt: toDateTime(row.attemptedAt),
    fetchedAt: row.fetchedAt ? toDateTime(row.fetchedAt) : null,
    coveredFrom: row.coveredFrom ? toDateTime(row.coveredFrom) : null,
    failedAt: row.lastErrorAt ? toDateTime(row.lastErrorAt) : null,
  };
}

export async function markFetched(
  db: Executor,
  keys: readonly string[],
  now: DateTime,
  coveredFrom?: DateTime,
): Promise<void> {
  if (keys.length === 0) return;
  await db
    .update(priceFetchState)
    .set({
      fetchedAt: toDbTime(now),
      lastError: null,
      lastErrorAt: null,
      ...(coveredFrom ? { coveredFrom: toDbTime(coveredFrom) } : {}),
    })
    .where(inArray(priceFetchState.key, [...keys]));
}

export async function markFailed(
  db: Executor,
  keys: readonly string[],
  now: DateTime,
  error: unknown,
): Promise<void> {
  if (keys.length === 0) return;
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(priceFetchState)
    .set({ lastError: message.slice(0, ERROR_MAX_LENGTH), lastErrorAt: toDbTime(now) })
    .where(inArray(priceFetchState.key, [...keys]));
}

export async function loadLatestQuotes(
  db: Executor,
  instrumentIds: readonly string[],
): Promise<Map<string, StoredQuote>> {
  if (instrumentIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(latestQuotes)
    .where(inArray(latestQuotes.instrumentId, [...instrumentIds]));
  return new Map(
    rows.map((row) => [
      row.instrumentId,
      {
        price: decimal(row.price),
        at: toDateTime(row.at),
        fetchedAt: toDateTime(row.fetchedAt),
        delayed: row.delayed,
      },
    ]),
  );
}

export async function saveLatestQuotes(
  db: Executor,
  quotes: readonly {
    instrumentId: string;
    currency: Currency;
    price: Decimal;
    at: DateTime;
    delayed: boolean;
  }[],
  now: DateTime,
): Promise<void> {
  if (quotes.length === 0) return;
  await db
    .insert(latestQuotes)
    .values(
      quotes.map((quote) => ({
        instrumentId: quote.instrumentId,
        currency: quote.currency,
        price: toNumeric(quote.price),
        at: toDbTime(quote.at),
        fetchedAt: toDbTime(now),
        delayed: quote.delayed,
      })),
    )
    .onConflictDoUpdate({
      target: latestQuotes.instrumentId,
      set: {
        price: sql`excluded.price`,
        at: sql`excluded.at`,
        fetchedAt: sql`excluded.fetched_at`,
        delayed: sql`excluded.delayed`,
      },
    });
}

/**
 * Stores bars. An intraday bar is simply replaced. A close is only replaced while the stored
 * one is provisional (fetched less than `settleMinutes` after the close): once final, a
 * close never changes.
 */
export async function savePrices(
  db: Executor,
  input: {
    instrumentId: string;
    currency: Currency;
    kind: PriceKind;
    points: readonly { at: DateTime; price: Decimal }[];
    now: DateTime;
    settleMinutes: number;
  },
): Promise<void> {
  if (input.points.length === 0) return;
  await db
    .insert(prices)
    .values(
      input.points.map((point) => ({
        instrumentId: input.instrumentId,
        kind: input.kind,
        at: toDbTime(point.at),
        price: toNumeric(point.price),
        currency: input.currency,
        fetchedAt: toDbTime(input.now),
      })),
    )
    .onConflictDoUpdate({
      target: [prices.instrumentId, prices.kind, prices.at],
      set: { price: sql`excluded.price`, fetchedAt: sql`excluded.fetched_at` },
      ...(input.kind === "close"
        ? {
            setWhere: sql`${prices.fetchedAt} < ${prices.at} + make_interval(mins => ${input.settleMinutes})`,
          }
        : {}),
    });
}

function toStoredPrice(row: { price: string; at: Date; fetchedAt: Date }): StoredPrice {
  return {
    price: decimal(row.price),
    at: toDateTime(row.at),
    fetchedAt: toDateTime(row.fetchedAt),
  };
}

/** The newest stored price at or before an instant (of one kind, or of any kind). */
export async function lastPriceAtOrBefore(
  db: Executor,
  instrumentId: string,
  at: DateTime,
  kind?: PriceKind,
): Promise<StoredPrice | null> {
  const [row] = await db
    .select({ price: prices.price, at: prices.at, fetchedAt: prices.fetchedAt })
    .from(prices)
    .where(
      and(
        eq(prices.instrumentId, instrumentId),
        lte(prices.at, toDbTime(at)),
        kind ? eq(prices.kind, kind) : undefined,
      ),
    )
    .orderBy(desc(prices.at))
    .limit(1);
  return row ? toStoredPrice(row) : null;
}

export async function pricesBetween(
  db: Executor,
  instrumentId: string,
  kind: PriceKind,
  from: DateTime,
  to: DateTime,
): Promise<StoredPrice[]> {
  const rows = await db
    .select({ price: prices.price, at: prices.at, fetchedAt: prices.fetchedAt })
    .from(prices)
    .where(
      and(
        eq(prices.instrumentId, instrumentId),
        eq(prices.kind, kind),
        gte(prices.at, toDbTime(from)),
        lte(prices.at, toDbTime(to)),
      ),
    )
    .orderBy(asc(prices.at));
  return rows.map(toStoredPrice);
}

/** Stores units of `currency` per 1 USD at the given instants. */
export async function saveFxPoints(
  db: Executor,
  currency: Currency,
  points: readonly { at: DateTime; rate: Decimal }[],
): Promise<void> {
  if (points.length === 0) return;
  await db
    .insert(fxRates)
    .values(
      points.map((point) => ({
        fromCurrency: FX_BASE,
        toCurrency: currency,
        at: toDbTime(point.at),
        rate: toNumeric(point.rate),
      })),
    )
    .onConflictDoUpdate({
      target: [fxRates.fromCurrency, fxRates.toCurrency, fxRates.at],
      set: { rate: sql`excluded.rate` },
    });
}

/** Units of `currency` per 1 USD: the newest stored rate at or before an instant. */
export async function fxAtOrBefore(
  db: Executor,
  currency: Currency,
  at?: DateTime,
): Promise<{ rate: Decimal; at: DateTime } | null> {
  const [row] = await db
    .select({ rate: fxRates.rate, at: fxRates.at })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.fromCurrency, FX_BASE),
        eq(fxRates.toCurrency, currency),
        at ? lte(fxRates.at, toDbTime(at)) : undefined,
      ),
    )
    .orderBy(desc(fxRates.at))
    .limit(1);
  return row ? { rate: decimal(row.rate), at: toDateTime(row.at) } : null;
}

/** Deletes 5-minute bars older than `before`: only recent ones are ever shown. */
export async function pruneIntradayPrices(db: Executor, before: DateTime): Promise<void> {
  await db.delete(prices).where(and(eq(prices.kind, "intraday"), lte(prices.at, toDbTime(before))));
}
