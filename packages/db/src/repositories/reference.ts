import { EXCHANGES, type Exchange, type Instrument } from "@aksjeliga/core";
import { and, asc, count, eq, ilike, inArray, or, sql } from "drizzle-orm";

import type { Executor } from "../client";
import { toExchange, toInstrument } from "../mappers";
import { exchangeHolidays, exchanges, exchangeTradingHours, instruments } from "../schema";

export async function loadExchanges(db: Executor): Promise<Exchange[]> {
  const [rows, hours, holidays] = await Promise.all([
    db.select().from(exchanges).orderBy(exchanges.id),
    db.select().from(exchangeTradingHours),
    db.select().from(exchangeHolidays),
  ]);
  // In the order of the reference data (Oslo first), then any added later by id.
  const order = (id: string) => {
    const index = EXCHANGES.findIndex((exchange) => exchange.id === id);
    return index === -1 ? EXCHANGES.length : index;
  };
  rows.sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));
  return rows.map((row) =>
    toExchange(
      row,
      hours.filter((hour) => hour.exchangeId === row.id).sort((a, b) => a.weekday - b.weekday),
      holidays.filter((holiday) => holiday.exchangeId === row.id),
    ),
  );
}

export async function loadInstrument(db: Executor, id: string): Promise<Instrument | null> {
  const [row] = await db.select().from(instruments).where(eq(instruments.id, id));
  return row ? toInstrument(row) : null;
}

export async function loadInstruments(
  db: Executor,
  ids?: readonly string[],
): Promise<Instrument[]> {
  if (ids?.length === 0) return [];
  const query = db.select().from(instruments);
  const rows = ids ? await query.where(inArray(instruments.id, [...ids])) : await query;
  return rows.map(toInstrument);
}

/** Escapes the wildcards of LIKE, so a search for "50%" means those characters. */
function likePattern(text: string): string {
  return text.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Active instruments on the given exchanges, optionally matching a search in the name or
 * ticker. An exact ticker comes first, then tickers that start with the search, then names.
 */
export async function searchInstruments(
  db: Executor,
  input: { exchangeIds: readonly string[]; search?: string; limit: number; offset?: number },
): Promise<Instrument[]> {
  if (input.exchangeIds.length === 0) return [];
  const needle = input.search?.trim() ?? "";
  const escaped = likePattern(needle);
  const rows = await db
    .select()
    .from(instruments)
    .where(
      and(
        eq(instruments.isActive, true),
        inArray(instruments.exchangeId, [...input.exchangeIds]),
        needle === ""
          ? undefined
          : or(ilike(instruments.name, `%${escaped}%`), ilike(instruments.ticker, `%${escaped}%`)),
      ),
    )
    .orderBy(
      sql`case when upper(${instruments.ticker}) = upper(${needle}) then 0
               when ${instruments.ticker} ilike ${`${escaped}%`} then 1
               else 2 end`,
      asc(sql`lower(${instruments.name})`),
      asc(instruments.id),
    )
    .limit(input.limit)
    .offset(input.offset ?? 0);
  return rows.map(toInstrument);
}

/** Number of active instruments per exchange. */
export async function countInstruments(
  db: Executor,
  exchangeIds: readonly string[],
): Promise<Map<string, number>> {
  if (exchangeIds.length === 0) return new Map();
  const rows = await db
    .select({ exchangeId: instruments.exchangeId, total: count() })
    .from(instruments)
    .where(and(eq(instruments.isActive, true), inArray(instruments.exchangeId, [...exchangeIds])))
    .groupBy(instruments.exchangeId);
  return new Map(rows.map((row) => [row.exchangeId, row.total]));
}

/** The well-known instruments on the given exchanges (for the list of movers). */
export async function loadFeaturedInstruments(
  db: Executor,
  exchangeIds: readonly string[],
): Promise<Instrument[]> {
  if (exchangeIds.length === 0) return [];
  const rows = await db
    .select()
    .from(instruments)
    .where(
      and(
        eq(instruments.isActive, true),
        eq(instruments.isFeatured, true),
        inArray(instruments.exchangeId, [...exchangeIds]),
      ),
    );
  return rows.map(toInstrument);
}
